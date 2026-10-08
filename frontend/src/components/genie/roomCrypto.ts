export interface RoomCiphertext {
  v: 1;
  iv: string;
  ciphertext: string;
}

export interface RoomCryptoIdentity {
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
}

export interface RoomCryptoPeer {
  id: string;
  publicKey?: JsonWebKey;
}

interface StoredKeyRecord {
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
}

const DATABASE_NAME = "genie-crypto";
const STORE_NAME = "keys";
const ROOM_KEY = "room-identity-v1";
const ARCHIVE_KEY = "archive-key-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the secure key store."));
  });
}

async function readKey<T>(name: string): Promise<T | undefined> {
  const database = await openKeyDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(name);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error || new Error("Could not read the secure key store."));
    });
  } finally {
    database.close();
  }
}

async function writeKey<T>(name: string, value: T): Promise<void> {
  const database = await openKeyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, name);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save the secure key."));
      transaction.onabort = () => reject(transaction.error || new Error("Secure key storage was aborted."));
    });
  } finally {
    database.close();
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function loadRoomCryptoIdentity(): Promise<RoomCryptoIdentity> {
  const stored = await readKey<StoredKeyRecord>(ROOM_KEY);
  if (stored?.privateKey && stored.publicKey) return stored;

  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  ) as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const identity = { privateKey: pair.privateKey, publicKey };
  await writeKey(ROOM_KEY, identity);
  return identity;
}

export async function encryptArchiveMessages(messages: unknown[]): Promise<RoomCiphertext> {
  let key = await readKey<CryptoKey>(ARCHIVE_KEY);
  if (!key) {
    key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await writeKey(ARCHIVE_KEY, key);
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(messages))
  );
  return { v: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) };
}

export async function decryptArchiveMessages(envelope: RoomCiphertext): Promise<unknown[]> {
  const key = await readKey<CryptoKey>(ARCHIVE_KEY);
  if (!key || envelope.v !== 1) throw new Error("This archive is not available in this browser's secure key store.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64(envelope.iv)) },
    key,
    toArrayBuffer(fromBase64(envelope.ciphertext))
  );
  const parsed: unknown = JSON.parse(decoder.decode(plaintext));
  if (!Array.isArray(parsed)) throw new Error("The encrypted archive payload is invalid.");
  return parsed;
}

async function derivePeerKey(
  ownPrivateKey: CryptoKey,
  peerPublicJwk: JsonWebKey,
  ownId: string,
  peerId: string
): Promise<CryptoKey> {
  const peerPublicKey = await crypto.subtle.importKey(
    "jwk",
    peerPublicJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    ownPrivateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  const participantIds = [ownId, peerId].sort().join(":");
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(participantIds),
      info: encoder.encode("personal-ai-genie-room-message-v1"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptRoomMessage(
  text: string,
  identity: RoomCryptoIdentity,
  ownId: string,
  peers: RoomCryptoPeer[]
): Promise<Record<string, RoomCiphertext>> {
  const recipients = new Map<string, JsonWebKey>();
  recipients.set(ownId, identity.publicKey);
  peers.forEach((peer) => {
    if (peer.id && peer.publicKey?.x && peer.publicKey.y) recipients.set(peer.id, peer.publicKey);
  });
  const encryptedPayloads: Record<string, RoomCiphertext> = {};
  await Promise.all([...recipients.entries()].map(async ([recipientId, publicKey]) => {
    const key = await derivePeerKey(identity.privateKey, publicKey, ownId, recipientId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(text)
    );
    encryptedPayloads[recipientId] = {
      v: 1,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
  }));
  return encryptedPayloads;
}

export async function decryptRoomMessage(
  payloads: Record<string, RoomCiphertext>,
  identity: RoomCryptoIdentity,
  ownId: string,
  senderId: string,
  senderPublicKey: JsonWebKey
): Promise<string> {
  const envelope = payloads[ownId];
  if (!envelope || envelope.v !== 1) {
    throw new Error("This room message was not encrypted for this device identity.");
  }
  const key = await derivePeerKey(identity.privateKey, senderPublicKey, ownId, senderId);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64(envelope.iv)) },
    key,
    toArrayBuffer(fromBase64(envelope.ciphertext))
  );
  return decoder.decode(plaintext);
}
