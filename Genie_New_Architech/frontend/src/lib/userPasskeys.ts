import { apiFetch } from "@/lib/api";

export interface PasskeyIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
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

export async function enrollUserPasskey(credential: string): Promise<void> {
  const options = await apiFetch<Record<string, unknown>>(
    "/api/auth/passkeys/enroll/options",
    credential,
    { method: "POST", body: "{}" },
  );
  const user = options.user as { id: string; name: string; displayName: string };
  const excluded = (options.excludeCredentials || []) as Array<{
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
    excludeCredentials: excluded.map((item) => ({ ...item, id: decodeBase64Url(item.id) })),
  };
  const passkey = await navigator.credentials.create({ publicKey });
  if (!(passkey instanceof PublicKeyCredential)) throw new Error("The device did not create a passkey.");
  await apiFetch("/api/auth/passkeys/enroll/verify", credential, {
    method: "POST",
    body: JSON.stringify({ credential: serializeCredential(passkey) }),
  });
}

export async function loginWithUserPasskey(email: string): Promise<{
  session_token: string;
  identity: PasskeyIdentity;
}> {
  const options = await apiFetch<Record<string, unknown>>(
    "/api/auth/passkeys/login/options",
    "",
    { method: "POST", body: JSON.stringify({ email }) },
  );
  const allowed = (options.allowCredentials || []) as Array<{
    id: string; type: "public-key"; transports?: AuthenticatorTransport[];
  }>;
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: decodeBase64Url(String(options.challenge)),
    rpId: typeof options.rpId === "string" ? options.rpId : undefined,
    timeout: typeof options.timeout === "number" ? options.timeout : undefined,
    userVerification: options.userVerification as UserVerificationRequirement,
    allowCredentials: allowed.map((item) => ({ ...item, id: decodeBase64Url(item.id) })),
  };
  const passkey = await navigator.credentials.get({ publicKey });
  if (!(passkey instanceof PublicKeyCredential)) throw new Error("Passkey authentication was cancelled.");
  return apiFetch<{ session_token: string; identity: PasskeyIdentity }>("/api/auth/passkeys/login/verify", "", {
    method: "POST",
    body: JSON.stringify({ email, credential: serializeCredential(passkey) }),
  });
}
