"use client";

import { Fingerprint, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

const ADMIN_SESSION_STORAGE_KEY = "genie_admin_signed_session";

interface AdminPasskeyProps {
  open: boolean;
  credential: string;
  onClose: () => void;
  onUnlocked: (token: string) => void;
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function serializeCredential(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response;
  const result: Record<string, unknown> = {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
  if (response instanceof AuthenticatorAttestationResponse) {
    result.response = {
      attestationObject: encodeBase64Url(response.attestationObject),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      transports: response.getTransports(),
    };
  } else if (response instanceof AuthenticatorAssertionResponse) {
    result.response = {
      authenticatorData: encodeBase64Url(response.authenticatorData),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      signature: encodeBase64Url(response.signature),
      userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null,
    };
  }
  return result;
}

export default function AdminPasskey(props: AdminPasskeyProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function enroll() {
    setBusy(true);
    setError("");
    try {
      const options = await apiFetch<Record<string, unknown>>(
        "/api/admin/passkeys/enroll/options", props.credential, { method: "POST", body: "{}" },
      );
      const user = options.user as { id: string; name: string; displayName: string };
      const excludeCredentials = (options.excludeCredentials || []) as Array<{
        id: string; type: "public-key"; transports?: AuthenticatorTransport[];
      }>;
      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: decodeBase64Url(String(options.challenge)),
        rp: {
          ...(options.rp as PublicKeyCredentialRpEntity),
          id: window.location.hostname,
        },
        user: { ...user, id: decodeBase64Url(user.id) },
        pubKeyCredParams: options.pubKeyCredParams as PublicKeyCredentialParameters[],
        timeout: typeof options.timeout === "number" ? options.timeout : undefined,
        attestation: options.attestation as AttestationConveyancePreference,
        authenticatorSelection: options.authenticatorSelection as AuthenticatorSelectionCriteria,
        excludeCredentials: excludeCredentials.map((item) => ({
          ...item, id: decodeBase64Url(item.id),
        })),
      };
      const passkey = await navigator.credentials.create({ publicKey });
      if (!(passkey instanceof PublicKeyCredential)) throw new Error("The device did not create a passkey.");
      await apiFetch("/api/admin/passkeys/enroll/verify", props.credential, {
        method: "POST", body: JSON.stringify({ credential: serializeCredential(passkey) }),
      });
      setStatus("Device passkey enrolled. Now use it to unlock the dashboard.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Passkey enrollment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    setBusy(true);
    setError("");
    try {
      const options = await apiFetch<Record<string, unknown>>(
        "/api/admin/passkeys/auth/options", props.credential, { method: "POST", body: "{}" },
      );
      const allowCredentials = (options.allowCredentials || []) as Array<{
        id: string; type: "public-key"; transports?: AuthenticatorTransport[];
      }>;
      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: decodeBase64Url(String(options.challenge)),
        rpId: typeof options.rpId === "string" ? options.rpId : undefined,
        timeout: typeof options.timeout === "number" ? options.timeout : undefined,
        userVerification: options.userVerification as UserVerificationRequirement,
        allowCredentials: allowCredentials.map((item) => ({
          ...item, id: decodeBase64Url(item.id),
        })),
      };
      const passkey = await navigator.credentials.get({ publicKey });
      if (!(passkey instanceof PublicKeyCredential)) throw new Error("Passkey authentication was cancelled.");
      const result = await apiFetch<{ admin_session: string }>(
        "/api/admin/passkeys/auth/verify", props.credential,
        { method: "POST", body: JSON.stringify({ credential: serializeCredential(passkey) }) },
      );
      if (!result.admin_session) throw new Error("The server did not issue an admin session.");
      // Persist only the server-signed token returned after WebAuthn verification.
      localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, result.admin_session);
      props.onUnlocked(result.admin_session);
      props.onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Passkey verification failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!props.open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <button className="icon-button modal-close" onClick={props.onClose} aria-label="Close"><X size={17} /></button>
        <div className="admin-lock"><Fingerprint size={25} /></div>
        <span className="eyebrow">DEVICE-BOUND ACCESS</span>
        <h2 id="admin-title">Super Admin Dashboard</h2>
        <p>Verify with a platform passkey. This device's biometric or screen-lock verification stays with your authenticator.</p>
        <button className="passkey-primary" disabled={busy} onClick={() => void unlock()}><ShieldCheck size={17} />{busy ? "Verifying…" : "Unlock with passkey"}</button>
        <button className="passkey-secondary" disabled={busy} onClick={() => void enroll()}>{busy ? "Working…" : "Enroll this device passkey"}</button>
        {status && <p className="passkey-status" role="status">{status}</p>}
        {error && <p className="passkey-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
