"use client";

import Script from "next/script";
import { useState } from "react";

export interface BackupMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sent_at?: string;
}

export interface BackupThread {
  id: string;
  title: string;
  messages: BackupMessage[];
}

export interface BackupSnapshot {
  format: "genie-chat-backup-v1";
  created_at: string;
  threads: BackupThread[];
  active_messages: BackupMessage[];
}

interface EncryptedBackup {
  format: "genie-encrypted-backup-v1";
  created_at: string;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

interface DriveFile {
  id: string;
  name: string;
  createdTime?: string;
}

interface UserCloudBackupVaultProps {
  threads: BackupThread[];
  activeMessages: BackupMessage[];
  gmailAddress: string;
  onImport: (snapshot: BackupSnapshot) => void;
}

const ITERATIONS = 600_000;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function encryptSnapshot(snapshot: BackupSnapshot, masterPasskey: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(masterPasskey),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(snapshot)),
  );
  return {
    format: "genie-encrypted-backup-v1",
    created_at: snapshot.created_at,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptSnapshot(value: unknown, masterPasskey: string): Promise<BackupSnapshot> {
  if (
    !isRecord(value)
    || value.format !== "genie-encrypted-backup-v1"
    || value.algorithm !== "AES-GCM"
    || value.kdf !== "PBKDF2-SHA-256"
    || typeof value.salt !== "string"
    || typeof value.iv !== "string"
    || typeof value.ciphertext !== "string"
    || typeof value.iterations !== "number"
    || value.iterations < 100_000
    || value.iterations > 1_000_000
  ) {
    throw new Error("This is not a supported encrypted Genie backup.");
  }
  const salt = base64ToBytes(value.salt);
  const iv = base64ToBytes(value.iv);
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(masterPasskey),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: value.iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(value.ciphertext));
  const snapshot: unknown = JSON.parse(new TextDecoder().decode(clear));
  if (!isRecord(snapshot) || snapshot.format !== "genie-chat-backup-v1" || !Array.isArray(snapshot.threads)) {
    throw new Error("The decrypted backup has an invalid structure.");
  }
  return snapshot as unknown as BackupSnapshot;
}

function saveFile(name: string, mimeType: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function UserCloudBackupVault(props: UserCloudBackupVaultProps) {
  const [masterPasskey, setMasterPasskey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [file, setFile] = useState<File | null>(null);

  function requireMasterPasskey(): string {
    if (!/^\d{6}$/.test(masterPasskey)) {
      throw new Error("Enter a six-digit vault master passkey.");
    }
    return masterPasskey;
  }

  function createSnapshot(): BackupSnapshot {
    return {
      format: "genie-chat-backup-v1",
      created_at: new Date().toISOString(),
      threads: props.threads,
      active_messages: props.activeMessages,
    };
  }

  async function createEncryptedFiles() {
    const snapshot = createSnapshot();
    const encrypted = await encryptSnapshot(snapshot, requireMasterPasskey());
    const json = JSON.stringify(encrypted, null, 2);
    const html = `<!doctype html><meta charset="utf-8"><title>Encrypted Genie backup</title><p>This backup is encrypted. Import the companion JSON or this HTML file in Genie.</p><script type="application/json" id="genie-backup">${json.replace(/</g, "\\u003c")}</script>`;
    const stamp = snapshot.created_at.replace(/[:.]/g, "-");
    return {
      json,
      html,
      name: `genie-backup-${stamp}`,
    };
  }

  async function requestGoogleToken(scopes: string): Promise<string> {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const tokenClient = window.google?.accounts?.oauth2;
    if (!clientId || !tokenClient) {
      throw new Error("Google Drive/Gmail OAuth is not configured for this app.");
    }
    return new Promise((resolve, reject) => {
      const client = tokenClient.initTokenClient({
        client_id: clientId,
        scope: scopes,
        callback: (response) => {
          if (!response.access_token) {
            reject(new Error(response.error || "Google did not grant vault access."));
            return;
          }
          resolve(response.access_token);
        },
        error_callback: (result) => reject(new Error(result.message || "Google authorization failed.")),
      });
      client.requestAccessToken({ prompt: "" });
    });
  }

  async function uploadDrive(token: string, name: string, mimeType: string, content: string) {
    const boundary = `genie_${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, parents: ["appDataFolder"] });
    const body = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}`,
      `--${boundary}--`,
    ].join("\r\n");
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!response.ok) throw new Error(`Google Drive upload failed (${response.status}).`);
  }

  async function downloadBackups() {
    const token = await requestGoogleToken(DRIVE_SCOPE);
    const response = await fetch("https://www.googleapis.com/drive/v3/files?q='appDataFolder'+in+parents+and+trashed=false&fields=files(id,name,createdTime)&orderBy=createdTime+desc&pageSize=50", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Drive vault could not be listed (${response.status}).`);
    const result = await response.json() as { files?: DriveFile[] };
    setDriveFiles(result.files || []);
  }

  async function restoreDrive(fileId: string) {
    const token = await requestGoogleToken(DRIVE_SCOPE);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Cloud backup download failed (${response.status}).`);
    const filename = driveFiles.find((item) => item.id === fileId)?.name || "";
    await restoreEncrypted(parseBackupText(await response.text(), filename.toLowerCase().endsWith(".html")));
  }

  async function restoreEncrypted(value: unknown) {
    const snapshot = await decryptSnapshot(value, requireMasterPasskey());
    props.onImport(snapshot);
    setStatus(`Restored backup from ${new Date(snapshot.created_at).toLocaleString()}.`);
  }

  function parseBackupText(text: string, isHtml: boolean): unknown {
    if (!isHtml) return JSON.parse(text);
    const encoded = text.match(/<script type="application\/json" id="genie-backup">([\s\S]*?)<\/script>/i)?.[1];
    if (!encoded) throw new Error("This HTML file does not contain an encrypted Genie backup.");
    return JSON.parse(encoded.replace(/\\u003c/g, "<"));
  }

  async function importFile() {
    if (!file) throw new Error("Choose a JSON or HTML backup file first.");
    const text = await file.text();
    await restoreEncrypted(parseBackupText(text, file.name.toLowerCase().endsWith(".html")));
  }

  async function sendGmail() {
    const token = await requestGoogleToken(GMAIL_SCOPE);
    const files = await createEncryptedFiles();
    const boundary = `genie_${crypto.randomUUID()}`;
    const attachment = (filename: string, content: string) => [
      `--${boundary}`,
      "Content-Type: application/octet-stream",
      `Content-Disposition: attachment; filename="${filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      bytesToBase64(new TextEncoder().encode(content)),
    ].join("\r\n");
    const mime = [
      `To: ${props.gmailAddress}`,
      "Subject: Encrypted Genie chat backup",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Attached is your encrypted Genie chat backup. Keep the six-digit vault master passkey separate.",
      attachment(`${files.name}.json`, files.json),
      attachment(`${files.name}.html`, files.html),
      `--${boundary}--`,
    ].join("\r\n");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encodeBase64Url(mime) }),
    });
    if (!response.ok) throw new Error(`Gmail could not send the backup (${response.status}).`);
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
      if (success) setStatus(success);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cloud backup operation failed.");
    } finally {
      setBusy(false);
      setMasterPasskey("");
    }
  }

  return (
    <section className="settings-policy" aria-labelledby="cloud-vault-title">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      <h3 id="cloud-vault-title">User-owned Cloud Backup Vault</h3>
      <p>Backups are encrypted in this browser with PBKDF2 and AES-GCM before download or upload. The passkey is never sent to Genie or Google.</p>
      <p role="note">A six-digit passkey has limited entropy and an exposed backup could be guessed offline. Keep encrypted backups private and use a device lock.</p>
      <label>Set up or enter your 6-digit vault master passkey
        <input
          autoComplete="new-password"
          inputMode="numeric"
          maxLength={6}
          onChange={(event) => setMasterPasskey(event.target.value.replace(/\D/g, "").slice(0, 6))}
          pattern="[0-9]{6}"
          type="password"
          value={masterPasskey}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="settings-passkey-button" disabled={busy} onClick={() => void run(async () => {
          const files = await createEncryptedFiles();
          saveFile(`${files.name}.json`, "application/json", files.json);
          saveFile(`${files.name}.html`, "text/html", files.html);
        }, "Encrypted JSON and HTML backups downloaded.")} type="button">Export JSON + HTML</button>
        <button className="settings-passkey-button" disabled={busy} onClick={() => void run(sendGmail, "Encrypted backups sent to your Gmail.")} type="button">Send encrypted backup to Gmail</button>
        <button className="settings-passkey-button" disabled={busy} onClick={() => void run(async () => {
          const token = await requestGoogleToken(DRIVE_SCOPE);
          const files = await createEncryptedFiles();
          await Promise.all([
            uploadDrive(token, `${files.name}.json`, "application/json", files.json),
            uploadDrive(token, `${files.name}.html`, "text/html", files.html),
          ]);
        }, "Encrypted JSON and HTML backups saved in your Google Drive appDataFolder.")} type="button">Save to Google Drive</button>
        <button className="settings-passkey-button" disabled={busy} onClick={() => void run(downloadBackups, "")} type="button">Restore from Cloud Vault</button>
      </div>
      <label>Import encrypted backup file
        <input accept=".json,.html,application/json,text/html" onChange={(event) => setFile(event.target.files?.[0] || null)} type="file" />
      </label>
      <button className="settings-passkey-button" disabled={busy || !file} onClick={() => void run(importFile, "")} type="button">Import Backup File</button>
      {driveFiles.map((driveFile) => (
        <button className="settings-passkey-button" disabled={busy} key={driveFile.id} onClick={() => void run(() => restoreDrive(driveFile.id), "")} type="button">
          Restore {driveFile.name}{driveFile.createdTime ? ` · ${new Date(driveFile.createdTime).toLocaleDateString()}` : ""}
        </button>
      ))}
      {status && <p role="status">{status}</p>}
      {error && <p className="section-error" role="alert">{error}</p>}
    </section>
  );
}
