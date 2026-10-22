import Link from "next/link";

export type LegalPolicy = "privacy" | "terms";

const privacySections = [
  {
    title: "Google API Services and Limited Use",
    text: "Genie requests only the Google OpenID Connect basic scopes openid, email, and profile for sign-in and account display. Google user data is used to authenticate your account, identify your Genie profile, and display your name and avatar. It is not sold, used for advertising, or used to train generalized AI models. Provider requests use only the conversation content you actively submit for AI processing; Google OAuth tokens are not sent to Gemini or other AI providers. These practices are intended to follow the Google API Services User Data Policy, including Limited Use requirements, and must be verified against the deployed configuration before launch.",
  },
  {
    title: "Room messages and encryption",
    text: "The browser encrypts room messages and attachments with AES-GCM before sending them to the service. Room keys are held by participating clients and may be shared in the URL fragment (for example, #key=xyz), which browsers do not include in ordinary HTTP requests. The service relays and stores ciphertext and limited delivery metadata. Anyone who obtains a complete invitation including its key may be able to decrypt room content. The current shared-key design is not a ratcheting protocol and does not provide forward secrecy.",
  },
  {
    title: "AI processing and sensitive content",
    text: "Standard prompts and explicitly selected attachments are sent to the configured AI provider. Room AI review is an explicit action and can send the selected, client-decrypted context to that provider. Secret mode is intended to bypass AI and saved conversation history. Sensitive patterns in eligible room-review context are redacted as [REDACTED_SECRET]. An explicitly requested sensitive result may be displayed to the client in an encrypted block; the server cannot promise that a third-party AI provider never processes content that was submitted to it. Provider billing and retention are governed by that provider's current terms.",
  },
  {
    title: "Profile, phone, and coarse region",
    text: "A registered phone number is normalized and HMAC-hashed for mutual contact matching; uploaded address-book numbers are not retained in plaintext. If you choose to set a coarse geo-region hash, it is used for friend discovery filters and cross-region personal-attestation prompts. Do not submit precise GPS coordinates or sensitive location details. You can change these values and privacy preferences in profile settings.",
  },
  {
    title: "Telemetry and service data",
    text: "The schema supports identity-blind usage metrics using one-way HMAC-SHA256 pseudonyms (displayed as Node-#XXXX), without room message content. Pseudonymized data is still potentially personal data under some laws. Do not enable collection or retain telemetry until its purpose, retention period, access controls, and deletion behavior have been reviewed and disclosed for the deployed service.",
  },
  {
    title: "Document scanning, voice, and notifications",
    text: "Document deskewing and PDF generation can be performed without Gemini tokens. Local OCR requires an installed Tesseract runtime. Optional gTTS speech synthesis sends text to Google's text-to-speech web service; browser speech recognition may also use browser-vendor services. Web Push stores an encrypted-at-rest subscription endpoint and keys where configured. These services are optional and should be disclosed and configured before production use.",
  },
  {
    title: "Retention, deletion, and your choices",
    text: "Room ciphertext and account metadata remain in the configured service database until deleted under the service's retention policy. Personal thread history may also remain in browser storage. Use sign-out and the local cache purge controls on shared devices. Ask the service operator to exercise applicable access, correction, export, or deletion rights. The operator must define and implement retention and deletion timelines before production. This draft is not a legal certification under India's DPDP Act, GDPR, or any other law.",
  },
];

const termsSections = [
  {
    title: "Service and account",
    text: "Genie provides chat, encrypted room relay, AI integrations, friend discovery, and optional voice and document tools. You are responsible for securing your Google account, room links, passkeys, and device. You must be authorized to share any content you submit.",
  },
  {
    title: "Encryption and room links",
    text: "Room content is encrypted by the client before relay, but the current shared-key implementation is not independently security-audited and does not provide forward secrecy. Keep invitation fragments private, remove access when needed, and rotate a room key after a link is exposed. Do not treat the service as a substitute for a certified secure-messaging product.",
  },
  {
    title: "AI providers and limitations",
    text: "AI features may send your prompts and selected attachments to the provider configured by the operator. AI can be inaccurate, incomplete, biased, or unsuitable for consequential decisions. Review important output independently. Provider availability, retention, pricing, and usage limits may change.",
  },
  {
    title: "Acceptable use and availability",
    text: "Do not use Genie to violate law, infringe others' rights, abuse provider services, bypass usage limits, or interfere with service security. The service is provided as available; the operator must establish applicable warranties, liability limits, consumer terms, and governing law with qualified counsel before publication.",
  },
  {
    title: "Draft status",
    text: "This is a product-specific draft for review and is not legal advice or a representation of compliance with the India DPDP Act, GDPR, Google policies, or other laws. The service operator must verify actual data flows, providers, jurisdiction, retention, user rights, and contact details before production.",
  },
];

export default function LegalPoliciesContent({ policy }: { policy: LegalPolicy }) {
  const isPrivacy = policy === "privacy";
  const sections = isPrivacy ? privacySections : termsSections;
  return (
    <main className="legal-page">
      <nav className="legal-nav">
        <Link href="/">Genie</Link>
        <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
      </nav>
      <article className="legal-document">
        <span className="eyebrow">PERSONAL AI GENIE · DRAFT FOR LEGAL REVIEW</span>
        <h1>{isPrivacy ? "Privacy Policy" : "Terms of Service"}</h1>
        <p className="legal-updated">Draft prepared October 16, 2026. Review and replace before production.</p>
        <p className="legal-draft-warning">
          This product-specific draft is provided for review, not as legal advice or a claim of regulatory certification.
        </p>
        {sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.text}</p>
          </section>
        ))}
        <footer><Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms of Service</Link></footer>
      </article>
    </main>
  );
}
