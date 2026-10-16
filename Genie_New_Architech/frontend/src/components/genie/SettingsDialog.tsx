"use client";

import { Fingerprint, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import DialectSelector from "@/modules/composer/DialectSelector";

interface ProfileDetails {
  display_name: string;
  bio: string;
  city_region: string;
  custom_picture_data: string | null;
  profile_visibility: "public" | "mutuals" | "private";
  presence_visibility: "public" | "mutuals" | "private";
  directory_visibility: "public" | "mutuals" | "private";
  default_dialect: string;
  preview_profile: boolean;
}

interface Preferences {
  geo_region_hash: string | null;
  friend_circle_mode: "everyone" | "local_geo_circle_mutuals" | "mutuals_only";
  lookup_visibility: "everyone" | "mutual_contacts_only" | "invite_link_only";
  allow_broader_discovery: boolean;
  default_dialect: string;
  presence_override: "online" | "away" | "busy";
  telemetry_enabled: boolean | number;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  preferences: Preferences;
  onSavePreferences: (preferences: Preferences) => Promise<void>;
  profile: ProfileDetails;
  onSaveProfile: (profile: ProfileDetails) => Promise<void>;
  onSetupPasskey: () => Promise<void>;
  onSignOut: () => void;
  onRemoveAccount: () => Promise<void>;
  onPurgeLocalCache: () => void;
}

export default function SettingsDialog(props: SettingsDialogProps) {
  const [preferences, setPreferences] = useState<Preferences>(props.preferences);
  const [profile, setProfile] = useState<ProfileDetails>(props.profile);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [removingAccount, setRemovingAccount] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  useEffect(() => {
    setPreferences(props.preferences);
    setProfile(props.profile);
  }, [props.preferences, props.profile]);
  if (!props.open) return null;
  async function savePreferences() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await props.onSavePreferences({ ...preferences, telemetry_enabled: Boolean(preferences.telemetry_enabled) });
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Privacy preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  async function saveProfile() {
    setSavingProfile(true);
    setError("");
    setProfileSaved(false);
    try {
      await props.onSaveProfile(profile);
      setProfileSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Profile could not be saved.");
    } finally {
      setSavingProfile(false);
    }
  }
  function readProfilePicture(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2_000_000) {
      setError("Choose a JPG, PNG, or WebP image no larger than 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        const imageData = reader.result;
        setProfile((current) => ({ ...current, custom_picture_data: imageData }));
        setError("");
      }
    };
    reader.onerror = () => setError("The profile image could not be read.");
    reader.readAsDataURL(file);
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <div><span className="eyebrow">WORKSPACE</span><h2 id="settings-title">Settings & privacy</h2></div>
          <button className="icon-button" onClick={props.onClose} aria-label="Close settings"><X size={18} /></button>
        </header>
        <section className="settings-policy">
          <h3><ShieldCheck size={17} /> Encryption & data policy</h3>
          <p>Room messages and attachments are encrypted in this browser before relay. The room key is in the invitation link fragment; anyone with that complete link can read room history.</p>
          <p>Secret-mode messages bypass AI and saved history. Standard AI requests are sent to the configured Gemini provider. Saved personal threads, notebooks, and reminders stay in this browser.</p>
          <p>Room review sends only the non-secret context you approve. Provider requests may incur usage costs; token metering is not a payment.</p>
        </section>
        <section className="settings-policy">
          <h3>Profile</h3>
          <label>Display name<input maxLength={100} value={profile.display_name} onChange={(event) => setProfile((value) => ({ ...value, display_name: event.target.value }))} /></label>
          <label>Bio<textarea maxLength={500} rows={3} value={profile.bio} onChange={(event) => setProfile((value) => ({ ...value, bio: event.target.value }))} /></label>
          <label>City / region<input maxLength={120} value={profile.city_region} onChange={(event) => setProfile((value) => ({ ...value, city_region: event.target.value }))} /></label>
          <label>Profile picture (JPG, PNG, WebP; up to 2 MB)<input accept="image/jpeg,image/png,image/webp" onChange={(event) => readProfilePicture(event.target.files?.[0])} type="file" /></label>
          {profile.custom_picture_data && <button className="settings-passkey-button" onClick={() => setProfile((value) => ({ ...value, custom_picture_data: null }))} type="button">Use Google profile picture instead</button>}
          <label>Profile visibility<select value={profile.profile_visibility} onChange={(event) => setProfile((value) => ({ ...value, profile_visibility: event.target.value as ProfileDetails["profile_visibility"] }))}><option value="public">Public</option><option value="mutuals">Mutual friends</option><option value="private">Private</option></select></label>
          <label>Presence visibility<select value={profile.presence_visibility} onChange={(event) => setProfile((value) => ({ ...value, presence_visibility: event.target.value as ProfileDetails["presence_visibility"] }))}><option value="public">Public</option><option value="mutuals">Mutual friends</option><option value="private">Private</option></select></label>
          <label>Directory visibility<select value={profile.directory_visibility} onChange={(event) => setProfile((value) => ({ ...value, directory_visibility: event.target.value as ProfileDetails["directory_visibility"] }))}><option value="public">Public</option><option value="mutuals">Mutual friends</option><option value="private">Private</option></select></label>
          <label className="settings-checkbox"><input checked={profile.preview_profile} onChange={(event) => setProfile((value) => ({ ...value, preview_profile: event.target.checked }))} type="checkbox" /> Preview my profile to other members</label>
          <button className="primary-button compact" disabled={savingProfile} onClick={() => void saveProfile()} type="button">{savingProfile ? "Saving…" : "Save profile"}</button>
          {profileSaved && <p role="status">Profile saved.</p>}
        </section>
        <section className="settings-policy">
          <h3>Friend discovery & privacy</h3>
          <label>Friend circle
            <select value={preferences.friend_circle_mode} onChange={(event) => setPreferences((value) => ({ ...value, friend_circle_mode: event.target.value as Preferences["friend_circle_mode"] }))}>
              <option value="everyone">Everyone</option>
              <option value="local_geo_circle_mutuals">Local geo-circle + mutuals</option>
              <option value="mutuals_only">Mutuals only</option>
            </select>
          </label>
          <label>Lookup visibility
            <select value={preferences.lookup_visibility} onChange={(event) => setPreferences((value) => ({ ...value, lookup_visibility: event.target.value as Preferences["lookup_visibility"] }))}>
              <option value="everyone">Everyone</option>
              <option value="mutual_contacts_only">Mutual contacts only</option>
              <option value="invite_link_only">Invite link only</option>
            </select>
          </label>
          <label>Coarse region hash (optional; never enter GPS coordinates)
            <input maxLength={128} onChange={(event) => setPreferences((value) => ({ ...value, geo_region_hash: event.target.value || null }))} value={preferences.geo_region_hash || ""} />
          </label>
          <label className="settings-checkbox"><input checked={preferences.allow_broader_discovery} onChange={(event) => setPreferences((value) => ({ ...value, allow_broader_discovery: event.target.checked }))} type="checkbox" /> Allow broader discovery beyond mutual friends</label>
          <label>Presence
            <select value={preferences.presence_override} onChange={(event) => setPreferences((value) => ({ ...value, presence_override: event.target.value as Preferences["presence_override"] }))}>
              <option value="online">Online</option><option value="away">Away</option><option value="busy">Busy / in another section</option>
            </select>
          </label>
          <label>Default dialect</label>
          <DialectSelector value={preferences.default_dialect} onChange={(value) => setPreferences((current) => ({ ...current, default_dialect: value }))} />
          <label className="settings-checkbox"><input checked={Boolean(preferences.telemetry_enabled)} onChange={(event) => setPreferences((value) => ({ ...value, telemetry_enabled: event.target.checked }))} type="checkbox" /> Opt in to identity-blind usage telemetry</label>
          <button className="primary-button compact" disabled={saving} onClick={() => void savePreferences()} type="button">{saving ? "Saving…" : "Save privacy preferences"}</button>
          {saved && <p role="status">Preferences saved.</p>}
          {error && <p className="section-error" role="alert">{error}</p>}
        </section>
        <section className="settings-policy">
          <h3>Terms & responsible use</h3>
          <p>Use Genie lawfully and share room invitations only with intended participants. AI responses can be inaccurate and should be independently checked for important decisions.</p>
          <p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> (drafts for legal review)</p>
        </section>
        <button className="settings-passkey-button" onClick={props.onPurgeLocalCache} type="button">Purge local room decryption cache</button>
        <section className="settings-policy">
          <h3>Account security</h3>
          <button className="settings-passkey-button" onClick={() => void props.onSetupPasskey()} type="button">
            <Fingerprint size={17} /> Set up a device passkey
          </button>
          <button className="settings-passkey-button" onClick={props.onSignOut} type="button">Sign out</button>
          <button className="settings-passkey-button danger-action" disabled={removingAccount} onClick={async () => {
            if (!window.confirm("Remove your profile and passkeys? Encrypted room history will remain available to room participants.")) return;
            setRemovingAccount(true);
            try { await props.onRemoveAccount(); }
            catch (caught) { setError(caught instanceof Error ? caught.message : "Account removal failed."); }
            finally { setRemovingAccount(false); }
          }} type="button">{removingAccount ? "Removing…" : "Remove account"}</button>
        </section>
      </section>
    </div>
  );
}
