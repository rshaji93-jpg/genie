function fromBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes.buffer;
}

function toBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function encryptRoomMessage(keyText: string, message: unknown): Promise<string> {
  const key = await crypto.subtle.importKey("raw", fromBase64Url(keyText), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(message));
  const plaintext = new Uint8Array(new ArrayBuffer(encoded.length));
  plaintext.set(encoded);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return JSON.stringify({ v: 1, iv: toBase64Url(iv), ciphertext: toBase64Url(ciphertext) });
}

export async function decryptRoomMessage(keyText: string, ciphertext: string): Promise<unknown> {
  const envelope = JSON.parse(ciphertext) as { v: number; iv: string; ciphertext: string };
  if (envelope.v !== 1) throw new Error("Unsupported encrypted room message.");
  const key = await crypto.subtle.importKey("raw", fromBase64Url(keyText), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(envelope.iv) },
    key,
    fromBase64Url(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
}
