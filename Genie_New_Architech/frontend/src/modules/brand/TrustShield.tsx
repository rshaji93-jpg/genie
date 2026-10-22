"use client";

import { ShieldCheck } from "lucide-react";

export const TRUST_SHIELD_POLICY =
  "All messages and 90-second voice notes are end-to-end encrypted with local-only decryption, and Genie operates on strict zero-secret retention—never storing your private data in memory and returning sensitive outputs exclusively in encrypted blocks only when you explicitly ask.";

interface TrustShieldProps {
  onOpenPrivacy?: () => void;
}

export default function TrustShield({ onOpenPrivacy }: TrustShieldProps) {
  return (
    <button
      aria-label="Trust and privacy policy"
      className="trust-shield"
      onClick={onOpenPrivacy}
      title={TRUST_SHIELD_POLICY}
      type="button"
    >
      <ShieldCheck aria-hidden="true" size={17} />
    </button>
  );
}
