# Personal AI Genie — New Architecture

This directory is an isolated Next.js/FastAPI workspace. It does not import from or modify the legacy `backend/` or `frontend/` application.

## Layout

```text
Genie_New_Architech/
  backend/
    main.py                 FastAPI endpoints, SQLite persistence, room WebSocket relay
    gemini_pool.py          Gemini chat, streaming, review synthesis, usage calculation
    security.py             Google identity, secret gate, ciphertext validation
    requirements.txt
    tests/
  frontend/
    src/app/                Next.js PWA shell and workspace entry point
    src/components/genie/   Sidebar, chat canvas, composer, voice, utility rail, passkeys
    src/lib/                API client and browser room encryption
    src/modules/            Isolated provider, privacy, scanner, social, ledger, and voice features
    public/                 PWA manifest, icon, and conservative service worker
```

## Local development

1. Create a Google OAuth web client whose authorized origin is `http://localhost:3000`, and configure the same client ID in both applications.
2. Copy `backend/.env.example` to `backend/.env` and set the Google client ID, free Gemini key pool, and separate Genie Master key pool. Generate independent admin-signing, inline-reply signing, and MetaSync hashing secrets with a cryptographically secure random generator; do not use example values.
3. Copy `frontend/.env.example` to `frontend/.env.local` and set the same Google client ID and backend URL.
4. Install the isolated dependencies and run each application:

```powershell
cd Genie_New_Architech\backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --ws-max-size 16777216 --workers 1

cd ..\frontend
npm install
npm run dev
```

The backend creates its SQLite database at `backend/data/genie_archive.sqlite3` by default. Its email-primary `users` table retains unique OAuth subject identifiers and unique registered phone numbers; existing isolated-workspace user rows are migrated in place without importing or modifying the legacy database. The database also defines personal `chats`/encrypted `messages`, encrypted `rooms`, and room `room_messages`, with additive archive, attachment, passcode-invite, receipt, and privacy-preference tables. Set `GENIE_DB_PATH` to a durable local-disk path for deployments. Do not place a live SQLite database or its WAL files in a cloud-synced folder.

## Modular features and launch checklist

- Backend helpers are grouped under `backend/modules/` by database, provider orchestration, secret handling, social discovery, voice, document scanning, room presence, message ledger, push, and VIP administration. Frontend feature modules live under `frontend/src/modules/`; the application page remains the workspace coordinator.
- Friend discovery, lookup visibility, coarse-region hash, dialect, presence, profile visibility, and opt-in identity-blind telemetry are controlled in Settings. Never enter precise GPS coordinates. The local room-key purge removes this device's saved room encryption keys and invitation credentials.
- Offline push replies use a short-lived, one-use HMAC token bound to a room member. The `text` value must already be an AES-GCM room ciphertext envelope; the server rejects plaintext, stores it as a no-AI secret relay, and never invokes a provider.
- `/privacy` and `/terms` are product-specific drafts marked for legal review, not legal advice or compliance certification. Review actual provider, retention, and jurisdictional practices and replace or approve the copy before public launch.
- Optional OCR requires a separate Tesseract installation. Optional gTTS speech synthesis sends text to its external service; WebRTC calls may require a configured TURN server. Scanner, TTS, push, and external provider integrations should be individually configured and tested before enabling them in production.
- The default Gemini Free pool and separate Genie Master pool are configured by backend environment variables. The API-key fallback pool is opt-in by provider key and applies only to non-Master requests. Provider charges are separate from Genie user-token metering.

## Security and operational boundaries

- Google ID tokens are verified server-side, and room APIs enforce membership before reading or changing room state. First-time registration requires the verified Google email, an international phone number, a full name, and a city/region. Phone numbers are stored for account discovery; configure a private `GENIE_METASYNC_HASH_KEY` before registration.
- Returning users can authenticate with a platform WebAuthn passkey. The signed user session is short-lived and stored only in the current tab's `sessionStorage`; set `GENIE_SESSION_SIGNING_KEY` to a unique secret of at least 32 bytes, independent from `SESSION_SIGNING_KEY` and `GENIE_ADMIN_SIGNING_KEY`. The remembered returning email is only a UI hint and is not an authentication factor. Gemini keys remain server-side. Free keys rotate and rate-limited keys receive cooldowns; Genie Master keys use a separate pool. `/api/ai/status` exposes model availability and retry timers but never provider keys.
- MetaSync normalizes registered E.164-style phone numbers and persists HMAC-SHA256 contact hashes only; uploaded contact numbers are not saved in clear text. Configure a stable, private `GENIE_METASYNC_HASH_KEY` (at least 32 bytes) before registering phones or using mutual discovery. Contact upload requests must be sent over HTTPS.
- Room message bodies are AES-GCM encrypted in the browser before WebSocket delivery or SQLite storage. The decryption key and invite code are shared in the invitation URL fragment; fragments are not sent in HTTP requests. The server stores an invite-code hash, ciphertext, and limited delivery/audit metadata—not room plaintext.
- This is a self-contained encrypted relay, not a security-audited WhatsApp protocol implementation: the room currently uses one shared AES-GCM key, does not implement a ratchet or forward secrecy, and does not independently verify member key fingerprints. Anyone with the complete invitation link can join and decrypt messages encrypted with that room key. Treat the URL fragment as a room secret and rotate/reissue rooms after a link is exposed.
- Secret-mode personal messages are handled locally and bypass the provider and persistent thread/library storage. In rooms, the marker and content are encrypted before relay and an `is_secret` bit is retained for review gating. Because the backend cannot inspect ciphertext, it cannot prove a modified client applied the marker; only send room secrets from the supplied client. AI room review sends a bounded, client-decrypted, non-secret context to the provider only after an explicit review action.
- “Silent Pro” review summarization is free of *Genie user tokens* but still makes a Gemini provider request and can incur provider charges. The token ledger attributes the dynamic 1+ token charge to the authenticated triggering user; it is a metering ledger, not a wallet/payment debit.
- SQLite is intentionally used for this self-contained version. Run one backend process/worker on one host: WebSocket presence and signaling are in-process. Back up the database with a SQLite-consistent procedure. Multi-replica delivery needs a shared broker and a production database, neither is silently emulated here.
- Serve over HTTPS in production. Set exact frontend origins, Google client ID, WebAuthn RP ID and origin, and strong independent signing keys. Ordinary registered users can enroll and use their own verified passkeys; Sovereign Admin passkey and Genesis/TOTP routes remain restricted to the verified `rshaji93@gmail.com` identity. The three-tap avatar gesture is only a UI trigger, not an authorization check. Admin grants expire after five minutes.
- Account removal clears profile details, passkeys, contact/discovery records, personal chats, and active room membership. Encrypted room history remains available to the other room participants, with the removed member's display name anonymized.
- Voice calls use browser WebRTC with STUN by default. Configure a trusted TURN service for reliable connectivity across restrictive networks. P2P audio signaling is relayed only to a room member and is not archived.
- The service worker caches only the app shell/static assets; it intentionally excludes API traffic and authorization-bearing requests. It does not provide offline AI inference.

Before a public production launch, complete a security review, validate the deployment's TLS/CORS/WebAuthn settings, configure backups and monitoring, and exercise room-key recovery, provider billing, and TURN connectivity in the target environment.
