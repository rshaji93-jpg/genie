"use client";

import { ArrowUpRight, AudioLines, MoreHorizontal, Search, Settings2, ShieldCheck, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import AdminDashboard from "@/components/genie/AdminDashboard";
import AdminPasskey from "@/components/genie/AdminPasskey";
import ChatCanvas, { type ChatMessage } from "@/components/genie/ChatCanvas";
import CommandSearchModal from "@/components/genie/CommandSearchModal";
import OmniComposer, { type Attachment, type SubmitTarget } from "@/modules/composer/OptionAComposer";
import RightSideRail, { type CallSignal, type RoomPerson } from "@/components/genie/RightSideRail";
import SettingsDialog from "@/components/genie/SettingsDialog";
import RoomInviteModal from "@/components/genie/RoomInviteModal";
import Sidebar, { type ThreadItem, type WorkspaceView } from "@/components/genie/Sidebar";
import WorkspacePanel from "@/components/genie/WorkspacePanel";
import { apiFetch, apiFetchWithFallback, randomToken, websocketUrl } from "@/lib/api";
import { decryptRoomMessage, encryptRoomMessage } from "@/lib/roomCrypto";
import PdfArtifactPreview from "@/modules/scanner_pdf/PdfArtifactPreview";
import ForwardToRoomModal from "@/modules/messages_arrows/ForwardToRoomModal";
import MultiUserTypingBar from "@/modules/voice_presence/MultiUserTypingBar";
import IdealGLogo from "@/modules/brand/IdealGLogo";
import { enrollUserPasskey, loginWithUserPasskey } from "@/lib/userPasskeys";

interface Identity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}
interface Room {
  id: string;
  name: string;
  member_count?: number;
}
interface ThreadRecord extends ThreadItem {
  messages: ChatMessage[];
}
interface SavedItem { id: string; content: string; createdAt: string }
interface FriendRequestItem { id: string; sender_name: string; email: string }
interface FriendItem { user_sub: string; user_name: string; email: string }
interface AIAvailability {
  genie_pro_configured: boolean;
  genie_pro_available: boolean;
  genie_pro_retry_seconds: number;
  genie_master_configured: boolean;
  genie_master_available: boolean;
  genie_master_retry_seconds: number;
}
interface WireMessage {
  id: string;
  sender_sub: string;
  sender_name: string;
  ciphertext: string;
  is_secret: boolean;
  tick_status: ChatMessage["tick_status"];
  sent_at: string;
  delivered_at?: string;
  read_at?: string;
  review_at?: string;
  review_triggered_by?: string;
  review_cost?: number;
  review_breakdown?: string;
  ai_reply?: string | null;
  review_ciphertext?: string | null;
  verified_at?: string;
  verified_by?: string;
  updated_at?: string;
  is_edited?: boolean;
}
interface RoomEvent {
  type: string;
  message?: WireMessage;
  messages?: WireMessage[];
  message_id?: string;
  tick_status?: ChatMessage["tick_status"] | "red" | "green";
  delivered_at?: string;
  read_at?: string;
  review_at?: string;
  verified_at?: string;
  verified_by_sub?: string;
  triggered_by?: string;
  triggered_by_sub?: string;
  tokens_burned?: number;
  breakdown?: string;
  ai_reply?: string;
  user_sub?: string;
  online?: boolean;
  client_id?: string;
  from_sub?: string;
  payload?: CallSignal["payload"];
  detail?: string;
  ciphertext?: string;
  updated_at?: string;
  edited_by?: string;
  activity?: "typing" | "recording" | "prompting" | null;
  user_name?: string;
}

interface ProfilePreferences {
  geo_region_hash: string | null;
  friend_circle_mode: "everyone" | "local_geo_circle_mutuals" | "mutuals_only";
  lookup_visibility: "everyone" | "mutual_contacts_only" | "invite_link_only";
  allow_broader_discovery: boolean;
  default_dialect: string;
  presence_override: "online" | "away" | "busy";
  telemetry_enabled: boolean | number;
}

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

interface ProfileResponse extends ProfilePreferences, ProfileDetails {
  registration_complete: boolean;
  email: string;
  user_name: string;
  picture_url?: string | null;
  phone?: string | null;
}

const THREAD_STORAGE = "genie_new_threads";
const LIBRARY_STORAGE = "genie_new_library";
const SECRET_MARKER = "[ENCRYPTED_SECRET_BLOCK]";
const LOCAL_ROOMS_STORAGE = "genie_local_rooms";
const LOCAL_REQUESTS_STORAGE = "genie_local_friend_requests";
const LOCAL_FRIENDS_STORAGE = "genie_local_friends";
const LOCAL_PROFILE_STORAGE = "genie_local_profile";

function userStorageKey(base: string, userSub: string): string {
  return `${base}_${encodeURIComponent(userSub)}`;
}

function decodeIdentity(token: string): Identity | null {
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as Record<string, unknown>;
    if (typeof claims.sub !== "string" || typeof claims.email !== "string") return null;
    return {
      sub: claims.sub,
      email: claims.email.toLowerCase(),
      name: typeof claims.name === "string" ? claims.name : claims.email.split("@")[0],
      picture: typeof claims.picture === "string" ? claims.picture : undefined,
    };
  } catch {
    return null;
  }
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function parseRoomFragment(hash: string): { key: string; invite: string } {
  const fragment = hash.replace(/^#/, "");
  if (fragment.includes("=")) {
    const values = new URLSearchParams(fragment);
    return { key: values.get("key") || "", invite: values.get("invite") || "" };
  }
  const [key = "", invite = ""] = fragment.split(".", 2);
  return { key, invite };
}

function fromWire(message: WireMessage, decrypted: unknown): ChatMessage {
  const data = typeof decrypted === "object" && decrypted !== null
    ? decrypted as { content?: unknown; attachment?: { mime_type?: unknown; data?: unknown } }
    : {};
  const attachment = data.attachment && typeof data.attachment.mime_type === "string" && typeof data.attachment.data === "string"
    ? { mime_type: data.attachment.mime_type, data: data.attachment.data }
    : undefined;
  return {
    id: message.id,
    role: "user",
    content: typeof data.content === "string" ? data.content.replace(SECRET_MARKER, "") : "",
    attachment,
    is_secret: message.is_secret,
    tick_status: message.tick_status || "sent",
    sent_at: message.sent_at,
    delivered_at: message.delivered_at,
    read_at: message.read_at,
    review_at: message.review_at,
    review_triggered_by: message.review_triggered_by,
    review_cost: message.review_cost,
    review_breakdown: message.review_breakdown,
    ai_reply: message.ai_reply || undefined,
    verified_at: message.verified_at,
    verified_by: message.verified_by,
    sender_sub: message.sender_sub,
    sender_name: message.sender_name,
    updated_at: message.updated_at,
    is_edited: message.is_edited,
  };
}

async function decryptWireMessage(message: WireMessage, roomKey: string): Promise<ChatMessage> {
  const decoded = fromWire(message, await decryptRoomMessage(roomKey, message.ciphertext));
  if (message.review_ciphertext) {
    const review = await decryptRoomMessage(roomKey, message.review_ciphertext);
    if (typeof review === "object" && review !== null && "content" in review && typeof review.content === "string") {
      decoded.ai_reply = review.content;
    }
  }
  return decoded;
}

export default function Home() {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
  const [isMounted, setIsMounted] = useState(false);
  const [credential, setCredential] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [authError, setAuthError] = useState("");
  const [accountStatus, setAccountStatus] = useState<"checking" | "registration" | "passkey-setup" | "ready">("checking");
  const [loginEmail, setLoginEmail] = useState("");
  const [showPasskeyLogin, setShowPasskeyLogin] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [registration, setRegistration] = useState({ full_name: "", email: "", phone: "", city_region: "" });
  const googleButton = useRef<HTMLDivElement>(null);
  const pendingRegistration = useRef<{ full_name: string; phone: string; city_region: string } | null>(null);
  const promptWhenReady = useRef(false);
  const registrationCompleted = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [view, setView] = useState<WorkspaceView>("chat");
  const [activeModel, setActiveModel] = useState("Genie Pro");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [invitePasscode, setInvitePasscode] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [stagedVoiceNote, setStagedVoiceNote] = useState<{ id: string; dataUrl: string; durationSeconds: number }>();
  const [transcribeRequest, setTranscribeRequest] = useState(0);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomKey, setRoomKey] = useState("");
  const roomKeyRef = useRef("");
  const socketRef = useRef<WebSocket | null>(null);
  const [roomStatus, setRoomStatus] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [members, setMembers] = useState<RoomPerson[]>([]);
  const [onlineSubs, setOnlineSubs] = useState<string[]>([]);
  const [voiceSubs, setVoiceSubs] = useState<string[]>([]);
  const [callSignal, setCallSignal] = useState<CallSignal>();
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [loadedThreadsFor, setLoadedThreadsFor] = useState("");
  const [archivedRoomIds, setArchivedRoomIds] = useState<string[]>([]);
  const [archivedRoomsFor, setArchivedRoomsFor] = useState("");
  const [threadId, setThreadId] = useState("");
  const threadsRef = useRef(threads);
  const [library, setLibrary] = useState<SavedItem[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequestItem[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [aiAvailability, setAIAvailability] = useState<AIAvailability | null>(null);
  const [aiAvailabilityError, setAIAvailabilityError] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [adminStats, setAdminStats] = useState<{
    rooms: number; users: number; reviews: number; review_tokens: number; expires_at: number;
  } | null>(null);
  const [toast, setToast] = useState("");
  const avatarTaps = useRef<number[]>([]);
  const [profilePreferences, setProfilePreferences] = useState<ProfilePreferences>({
    geo_region_hash: null,
    friend_circle_mode: "mutuals_only",
    lookup_visibility: "mutual_contacts_only",
    allow_broader_discovery: false,
    default_dialect: "en-IN",
    presence_override: "online",
    telemetry_enabled: false,
  });
  const [profileDetails, setProfileDetails] = useState<ProfileDetails>({
    display_name: "",
    bio: "",
    city_region: "",
    custom_picture_data: null,
    profile_visibility: "mutuals",
    presence_visibility: "mutuals",
    directory_visibility: "mutuals",
    default_dialect: "en-IN",
    preview_profile: false,
  });
  const [quoteText, setQuoteText] = useState("");
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [pdfArtifactUrl, setPdfArtifactUrl] = useState("");
  const [roomActivities, setRoomActivities] = useState<Record<string, { name: string; activity: string }>>({});

  useEffect(() => { threadsRef.current = threads; }, [threads]);
  useEffect(() => {
    if (!pdfArtifactUrl) return;
    return () => URL.revokeObjectURL(pdfArtifactUrl);
  }, [pdfArtifactUrl]);
  useEffect(() => {
    if (!room && activeModel === "Individual Chat") setActiveModel("Genie Pro");
  }, [room, activeModel]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("genie_user_session") || sessionStorage.getItem("genie_google_credential");
      const restoredIdentity = saved ? decodeIdentity(saved) : null;
      if (saved && restoredIdentity) {
        setCredential(saved);
        setIdentity(restoredIdentity);
      } else if (saved) {
        sessionStorage.removeItem("genie_google_credential");
        sessionStorage.removeItem("genie_user_session");
      }
      const hint = localStorage.getItem("genie_returning_email") || "";
      setLoginEmail(hint);
      const draftText = sessionStorage.getItem("genie_pending_registration")
        || localStorage.getItem("genie_registration_draft");
      if (draftText) {
        try {
          const draft: unknown = JSON.parse(draftText);
          if (
            typeof draft === "object" && draft !== null
            && "full_name" in draft && typeof draft.full_name === "string"
            && "phone" in draft && typeof draft.phone === "string"
            && "city_region" in draft && typeof draft.city_region === "string"
          ) {
            const restoredDraft = {
              full_name: draft.full_name,
              phone: draft.phone,
              city_region: draft.city_region,
            };
            pendingRegistration.current = restoredDraft;
            setRegistration((current) => ({ ...current, ...restoredDraft }));
          }
        } catch {
          sessionStorage.removeItem("genie_pending_registration");
          localStorage.removeItem("genie_registration_draft");
        }
      }
    } catch {
      setCredential("");
      setIdentity(null);
      setLoginEmail("");
    } finally {
      setIsMounted(true);
    }
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches) setSidebarCollapsed(true);
  }, []);
  useEffect(() => {
    if (!clientId || credential || !isMounted || showPasskeyLogin) return;
    let cancelled = false;
    const setup = () => {
      if (cancelled || !window.google || !googleButton.current) return;
      const gsiWindow = window as typeof window & { __genieGsiInitialized?: boolean };
      if (!gsiWindow.__genieGsiInitialized) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response) => {
            const decoded = decodeIdentity(response.credential);
            if (!decoded) {
              setAuthError("Google sign-in returned an invalid identity.");
              return;
            }
            sessionStorage.setItem("genie_google_credential", response.credential);
            setCredential(response.credential);
            setIdentity(decoded);
            setAccountStatus("checking");
            setRegistration((current) => ({
              ...current,
              email: decoded.email,
              full_name: pendingRegistration.current?.full_name || current.full_name.trim() || decoded.name,
              phone: pendingRegistration.current?.phone || current.phone,
              city_region: pendingRegistration.current?.city_region || current.city_region,
            }));
            setAuthError("");
            if (pendingRegistration.current) {
              const draft = pendingRegistration.current;
              pendingRegistration.current = null;
              registrationCompleted.current = true;
              const localProfile: ProfileResponse = {
                geo_region_hash: null,
                friend_circle_mode: "mutuals_only",
                lookup_visibility: "mutual_contacts_only",
                allow_broader_discovery: false,
                default_dialect: "en-IN",
                presence_override: "online",
                telemetry_enabled: false,
                display_name: draft.full_name,
                bio: "",
                city_region: draft.city_region,
                custom_picture_data: null,
                profile_visibility: "mutuals",
                presence_visibility: "mutuals",
                directory_visibility: "mutuals",
                preview_profile: false,
                registration_complete: true,
                email: decoded.email,
                user_name: draft.full_name,
                phone: draft.phone,
              };
              localStorage.setItem(userStorageKey(LOCAL_PROFILE_STORAGE, decoded.sub), JSON.stringify(localProfile));
              localStorage.setItem("genie_returning_email", decoded.email);
              sessionStorage.removeItem("genie_pending_registration");
              try {
                await apiFetch("/api/auth/register", response.credential, {
                  method: "POST",
                  body: JSON.stringify({
                    full_name: draft.full_name,
                    email: decoded.email,
                    phone: draft.phone,
                    city_region: draft.city_region,
                  }),
                });
              } catch {
                setToast("Profile saved on this device; account sync is unavailable.");
              }
              setAccountStatus("passkey-setup");
            } else {
              setAccountStatus("checking");
            }
          },
        });
        gsiWindow.__genieGsiInitialized = true;
      }
      googleButton.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButton.current, {
        theme: "outline", size: "large", shape: "pill", text: "signin_with", width: "320",
      });
      if (promptWhenReady.current) {
        promptWhenReady.current = false;
        window.google.accounts.id.prompt();
      }
    };
    if (window.google) {
      setup();
      return () => { cancelled = true; };
    }
    const scriptUrl = "https://accounts.google.com/gsi/client";
    let script = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.defer = true;
    }
    script.addEventListener("load", setup);
    const onScriptError = () => setAuthError("Google sign-in could not be loaded.");
    script.addEventListener("error", onScriptError, { once: true });
    if (!script.isConnected) document.head.appendChild(script);
    return () => {
      cancelled = true;
      script?.removeEventListener("load", setup);
      script?.removeEventListener("error", onScriptError);
    };
  }, [clientId, credential, isMounted, showPasskeyLogin]);

  useEffect(() => {
    if (!credential?.trim() || !identity?.sub) return;
    setThreads(readStored<ThreadRecord[]>(userStorageKey(THREAD_STORAGE, identity.sub), []));
    setLibrary(readStored<SavedItem[]>(userStorageKey(LIBRARY_STORAGE, identity.sub), []));
    setArchivedRoomIds(readStored<string[]>(userStorageKey("genie_archived_rooms", identity.sub), []));
    const localRooms = readStored<Room[]>(userStorageKey(LOCAL_ROOMS_STORAGE, identity.sub), []);
    const localRequests = readStored<FriendRequestItem[]>(userStorageKey(LOCAL_REQUESTS_STORAGE, identity.sub), []);
    const localFriends = readStored<FriendItem[]>(userStorageKey(LOCAL_FRIENDS_STORAGE, identity.sub), []);
    const localProfile = readStored<Partial<ProfileResponse>>(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), {});
    setRooms(localRooms);
    setFriendRequests(localRequests);
    setFriends(localFriends);
    setArchivedRoomsFor(identity.sub);
    setLoadedThreadsFor(identity.sub);
    void Promise.all([
      apiFetch<Room[]>("/api/rooms", credential).catch(() => [] as Room[]),
      apiFetch<FriendRequestItem[]>("/api/social/requests", credential).catch(() => [] as FriendRequestItem[]),
      apiFetch<FriendItem[]>("/api/social/friends", credential).catch(() => [] as FriendItem[]),
      apiFetch<ProfileResponse>("/api/profile", credential).catch(() => ({
        email: identity.email, user_name: identity.name, display_name: identity.name,
        registration_complete: false, geo_region_hash: null, friend_circle_mode: "mutuals_only",
        lookup_visibility: "mutual_contacts_only", allow_broader_discovery: false,
        default_dialect: "en-IN", presence_override: "online", telemetry_enabled: false,
        bio: "", city_region: "", custom_picture_data: null, profile_visibility: "mutuals",
        presence_visibility: "mutuals", directory_visibility: "mutuals", preview_profile: false,
      } satisfies ProfileResponse)),
    ]).then(([roomList, requests, friendList, profile]) => {
      const mergedProfile = { ...profile, ...localProfile };
      setRooms(Array.from(new Map([...localRooms, ...roomList].map((item) => [item.id, item] as const)).values()));
      setFriendRequests(Array.from(new Map([...localRequests, ...requests].map((item) => [item.id, item] as const)).values()));
      setFriends(Array.from(new Map([...localFriends, ...friendList].map((item) => [item.user_sub, item] as const)).values()));
      setProfilePreferences({
        ...mergedProfile,
        telemetry_enabled: Boolean(mergedProfile.telemetry_enabled),
      });
      setProfileDetails({
        display_name: mergedProfile.display_name || mergedProfile.user_name || identity.name,
        bio: mergedProfile.bio || "",
        city_region: mergedProfile.city_region || "",
        custom_picture_data: mergedProfile.custom_picture_data || null,
        profile_visibility: mergedProfile.profile_visibility || "mutuals",
        presence_visibility: mergedProfile.presence_visibility || "mutuals",
        directory_visibility: mergedProfile.directory_visibility || "mutuals",
        default_dialect: mergedProfile.default_dialect || "en-IN",
        preview_profile: Boolean(mergedProfile.preview_profile),
      });
      setIdentity((current) => current ? {
        ...current,
        name: mergedProfile.display_name || mergedProfile.user_name || current.name,
        picture: mergedProfile.custom_picture_data || mergedProfile.picture_url || current.picture,
      } : current);
      setRegistration((current) => ({
        ...current,
        full_name: mergedProfile.display_name || mergedProfile.user_name || identity.name,
        email: mergedProfile.email || identity.email,
        phone: mergedProfile.phone || "",
        city_region: mergedProfile.city_region || "",
      }));
      if (!registrationCompleted.current) {
        setAccountStatus(mergedProfile.registration_complete ? "ready" : "registration");
      }
      if (mergedProfile.email) {
        localStorage.setItem("genie_returning_email", mergedProfile.email);
        setLoginEmail(mergedProfile.email);
      }
      const params = new URLSearchParams(window.location.search);
      const { key, invite: fragmentInvite } = parseRoomFragment(window.location.hash);
      const invite = params.get("invite") || fragmentInvite;
      if (invite && key) {
        const passcode = window.prompt("Enter the six-digit room invitation passcode") || "";
        if (!/^[0-9]{6}$/.test(passcode)) {
          setRoomStatus("Room invitation passcode is required.");
          return;
        }
        void apiFetch<Room>("/api/rooms/join", credential, {
          method: "POST", body: JSON.stringify({ invite_code: invite, passcode }),
        }).then((joined) => {
          if (!joined.id) throw new Error("This invitation requires a reachable room service.");
          localStorage.setItem(`genie_room_key_${joined.id}`, key);
          localStorage.setItem(`genie_room_invite_${joined.id}`, invite);
          localStorage.setItem(`genie_room_passcode_${joined.id}`, passcode);
          setRooms((current) => current.some((candidate) => candidate.id === joined.id) ? current : [...current, joined]);
          setRoom(joined);
          setRoomKey(key);
          window.history.replaceState(null, "", `/?room=${joined.id}#key=${encodeURIComponent(key)}`);
        }).catch((error: unknown) => setRoomStatus(error instanceof Error ? error.message : "Room invitation failed."));
      } else {
        const roomId = params.get("room");
        const savedRoomKey = roomId ? localStorage.getItem(`genie_room_key_${roomId}`) : null;
        const existing = roomId ? roomList.find((candidate) => candidate.id === roomId) : undefined;
        if (existing && savedRoomKey) {
          setRoom(existing);
          setRoomKey(savedRoomKey);
        }
      }
    }).catch(() => {
      setAccountStatus("registration");
      setAuthError("");
    });
  }, [credential, identity?.sub]);

  useEffect(() => {
    const statusCredential = credential ?? "";
    const statusSubject = identity?.sub ?? "";
    if (!statusCredential.trim() || !statusSubject) return;
    let disposed = false;
    const refresh = () => {
      if (!statusCredential.trim() || !statusSubject) return;
      void apiFetch<AIAvailability>("/api/ai/status", statusCredential)
        .then((status) => {
          if (!disposed) {
            setAIAvailability(status);
            setAIAvailabilityError("");
          }
        })
        .catch((error: unknown) => {
          if (!disposed) {
            setAIAvailability(null);
            setAIAvailabilityError(error instanceof Error ? error.message : "Could not load provider status.");
          }
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [credential ?? "", identity?.sub ?? ""]);

  useEffect(() => {
    if (identity?.sub && loadedThreadsFor === identity.sub && threads.length) {
      localStorage.setItem(userStorageKey(THREAD_STORAGE, identity.sub), JSON.stringify(threads));
    }
  }, [identity?.sub, loadedThreadsFor, threads]);
  useEffect(() => {
    if (identity?.sub && loadedThreadsFor === identity.sub) {
      localStorage.setItem(userStorageKey(LIBRARY_STORAGE, identity.sub), JSON.stringify(library));
    }
  }, [identity?.sub, loadedThreadsFor, library]);
  useEffect(() => {
    if (identity?.sub && archivedRoomsFor === identity.sub) {
      localStorage.setItem(userStorageKey("genie_archived_rooms", identity.sub), JSON.stringify(archivedRoomIds));
    }
  }, [identity?.sub, archivedRoomsFor, archivedRoomIds]);
  useEffect(() => {
    if (!identity?.sub || loadedThreadsFor !== identity.sub) return;
    localStorage.setItem(userStorageKey(LOCAL_ROOMS_STORAGE, identity.sub), JSON.stringify(rooms));
    localStorage.setItem(userStorageKey(LOCAL_REQUESTS_STORAGE, identity.sub), JSON.stringify(friendRequests));
    localStorage.setItem(userStorageKey(LOCAL_FRIENDS_STORAGE, identity.sub), JSON.stringify(friends));
  }, [identity?.sub, loadedThreadsFor, rooms, friendRequests, friends]);

  useEffect(() => {
    if (!room || !credential || !roomKey) return;
    roomKeyRef.current = roomKey;
    let disposed = false;
    let reconnectTimer: number | undefined;
    let socket: WebSocket;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(websocketUrl(`/api/rooms/${room.id}/socket`));
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ credential }));
        setRoomStatus("Connected · encrypted relay");
      };
      socket.onmessage = (event) => {
        void (async () => {
          const incoming = JSON.parse(String(event.data)) as RoomEvent;
          if (incoming.type === "history" && incoming.messages) {
            const decoded: ChatMessage[] = [];
            for (const wire of incoming.messages) {
              try {
                decoded.push(await decryptWireMessage(wire, roomKeyRef.current));
                if (wire.sender_sub !== identity?.sub && wire.tick_status !== "read_no_ai" && wire.tick_status !== "ai_review_active" && wire.tick_status !== "ai_verified") {
                  socket.send(JSON.stringify({ type: "message.read", message_id: wire.id }));
                }
              } catch {
                setRoomStatus("Some room history could not be decrypted on this device.");
              }
            }
            setMessages(decoded);
          } else if ((incoming.type === "message.new" || incoming.type === "message.ack") && incoming.message) {
            try {
              const decoded = fromWire(incoming.message, await decryptRoomMessage(roomKeyRef.current, incoming.message.ciphertext));
              setMessages((current) => {
                if (incoming.type === "message.ack" && incoming.client_id) {
                  return current.map((item) => item.id === incoming.client_id ? decoded : item);
                }
                return current.some((item) => item.id === decoded.id) ? current : [...current, decoded];
              });
              if (incoming.message.sender_sub !== identity?.sub) {
                socket.send(JSON.stringify({ type: "message.read", message_id: incoming.message.id }));
              }
            } catch {
              setRoomStatus("A room message could not be decrypted. Verify that this invite contains the correct key.");
            }
          } else if (incoming.type === "message.tick" && incoming.message_id) {
            setMessages((current) => current.map((message) => message.id === incoming.message_id ? {
              ...message,
              tick_status: incoming.tick_status === "red" ? "ai_review_active" : incoming.tick_status === "green" ? "ai_verified" : incoming.tick_status,
              delivered_at: incoming.delivered_at || message.delivered_at,
              read_at: incoming.read_at || message.read_at,
            } : message));
          } else if (incoming.type === "message.ai_review" && incoming.message_id) {
            setMessages((current) => current.map((message) => message.id === incoming.message_id ? {
              ...message, tick_status: "ai_review_active", ai_reply: incoming.ai_reply,
              review_at: incoming.review_at, review_triggered_by: incoming.triggered_by_sub,
              triggered_by: incoming.triggered_by, tokens_burned: incoming.tokens_burned,
              breakdown: incoming.breakdown,
            } : message));
          } else if (incoming.type === "message.ai_verified" && incoming.message_id) {
            setMessages((current) => current.map((message) => message.id === incoming.message_id ? {
              ...message, tick_status: "ai_verified", verified_at: incoming.verified_at,
              verified_by: incoming.verified_by_sub,
            } : message));
          } else if (incoming.type === "message.edited" && incoming.message_id && incoming.ciphertext) {
            const decoded = await decryptRoomMessage(roomKeyRef.current, incoming.ciphertext) as { content?: unknown };
            if (typeof decoded.content === "string") {
              const content = decoded.content;
              setMessages((current) => current.map((message) => message.id === incoming.message_id ? {
                ...message,
                content,
                updated_at: incoming.updated_at,
                is_edited: true,
              } : message));
            }
          } else if (incoming.type === "activity" && incoming.user_sub) {
            const userSub = incoming.user_sub;
            setRoomActivities((current) => {
              const next = { ...current };
              if (!incoming.activity) delete next[userSub];
              else next[userSub] = {
                name: incoming.user_name || "A room member",
                activity: incoming.activity,
              };
              return next;
            });
          } else if (incoming.type === "presence" && incoming.user_sub) {
            setOnlineSubs((current) => incoming.online
              ? current.includes(incoming.user_sub!) ? current : [...current, incoming.user_sub!]
              : current.filter((sub) => sub !== incoming.user_sub));
          } else if (incoming.type === "call.signal" && incoming.from_sub && incoming.payload) {
            setCallSignal({ from_sub: incoming.from_sub, payload: incoming.payload });
          }
        })().catch(() => setRoomStatus("An encrypted room event could not be processed."));
      };
      socket.onerror = () => setRoomStatus("Room connection interrupted.");
      socket.onclose = () => {
        if (!disposed) {
          setRoomStatus("Reconnecting to encrypted room…");
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socketRef.current === socket) socketRef.current = null;
      socket?.close();
      roomKeyRef.current = "";
      setOnlineSubs([]);
      setMembers([]);
      setRoomActivities({});
    };
  }, [room?.id, credential, roomKey, identity?.sub]);

  useEffect(() => {
    if (!room || !credential) return;
    void apiFetch<RoomPerson[]>(`/api/rooms/${room.id}/members`, credential)
      .then(setMembers)
      .catch((error: unknown) => setRoomStatus(error instanceof Error ? error.message : "Room members could not be loaded."));
  }, [room?.id, credential]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onlineNames = useMemo(
    () => members.filter((member) => onlineSubs.includes(member.user_sub)).map((member) => member.user_name),
    [members, onlineSubs],
  );
  const updateVoiceSubs = useCallback((userSubs: string[]) => {
    setVoiceSubs((current) => current.length === userSubs.length && current.every((sub) => userSubs.includes(sub))
      ? current
      : userSubs);
  }, []);
  const activeThreadMessages = messages;

  useEffect(() => {
    if (!threadId || room || !messages.length) return;
    const archivedMessages = messages
      .filter((message) => !message.is_secret && !message.content.includes(SECRET_MARKER))
      .slice(-60)
      .map(({ attachment: _attachment, ...message }) => message);
    const firstUser = archivedMessages.find((message) => message.role === "user");
    const title = firstUser?.content.trim().slice(0, 48) || "Image conversation";
    setThreads((current) => {
      const existing = current.find((item) => item.id === threadId);
      const updated: ThreadRecord = { id: threadId, title, messages: archivedMessages };
      const next = [updated, ...current.filter((item) => item.id !== threadId)].slice(0, 60);
      if (JSON.stringify(existing) !== JSON.stringify(updated)) return next;
      return current;
    });
  }, [threadId, room, messages]);

  function startNewChat() {
    setRoom(null);
    setRoomKey("");
    setView("chat");
    const id = crypto.randomUUID();
    setThreadId(id);
    setMessages([]);
  }

  function selectThread(id: string) {
    const selected = threadsRef.current.find((thread) => thread.id === id);
    if (!selected) return;
    setRoom(null);
    setRoomKey("");
    setThreadId(id);
    setMessages(selected.messages);
    setView("chat");
    setSearchOpen(false);
  }

  async function distributeRoomInvite(link: URL, passcode?: string) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Personal AI Genie encrypted room",
          text: passcode
            ? `Join my private, encrypted Genie room. Room passcode: ${passcode}`
            : "Join my private, encrypted Genie room.",
          url: link.toString(),
        });
        setToast("Encrypted room invitation shared.");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setToast("Room invitation sharing was cancelled.");
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(
        passcode ? `${link.toString()}\nRoom passcode: ${passcode}` : link.toString(),
      );
      setToast("Encrypted room invitation copied.");
    } catch {
      setToast("Clipboard access is unavailable. Copy the invitation from your browser.");
    }
  }

  async function createRoom() {
    if (!credential) return;
    const invite = randomToken(32);
    const key = randomToken(32);
    const passcode = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const localRoomId = `local-${crypto.randomUUID()}`;
    const created = await apiFetchWithFallback<Room>("/api/rooms", credential, {
      method: "POST",
      body: JSON.stringify({ name: "Private room", invite_code: invite, passcode, max_uses: 20 }),
    }, () => ({ id: localRoomId, name: "Private room" }), () => {
      setToast("Room created locally; room invites and relay need a valid backend session.");
    });
    const roomId = created.id || localRoomId;
    if (!created.id) {
      setToast("Room created locally; room invites and relay need a valid backend session.");
    }
    const roomData = { ...created, id: roomId };
    localStorage.setItem(`genie_room_key_${roomData.id}`, key);
    localStorage.setItem(`genie_room_invite_${roomData.id}`, invite);
    localStorage.setItem(`genie_room_passcode_${roomData.id}`, passcode);
    const fullRoom = { ...roomData, member_count: 1 };
    setRooms((current) => [fullRoom, ...current.filter((item) => item.id !== fullRoom.id)]);
    setMessages([]);
    setRoom(fullRoom);
    setRoomKey(key);
    setThreadId("");
    setView("chat");
    const link = new URL(window.location.href);
    link.search = "";
    link.searchParams.set("room", roomData.id);
    link.hash = `key=${encodeURIComponent(key)}&invite=${encodeURIComponent(invite)}`;
    setInviteLink(link.toString());
    setInvitePasscode(passcode);
    setInviteOpen(true);
  }

  async function joinRoom(inviteInput: string) {
    if (!credential) return;
    let invite = inviteInput.trim();
    let secretKey = "";
    let passcode = "";
    try {
      const parsed = new URL(inviteInput);
      const { key, invite: fragmentInvite } = parseRoomFragment(parsed.hash);
      invite = parsed.searchParams.get("invite") || fragmentInvite || invite;
      secretKey = key;
    } catch {
      const { key, invite: fragmentInvite } = parseRoomFragment(window.location.hash);
      secretKey = key;
      if (!invite && fragmentInvite) invite = fragmentInvite;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(secretKey)) {
      throw new Error("Paste the full room link, including its private key fragment.");
    }
    passcode = window.prompt("Enter the six-digit room invitation passcode") || "";
    if (!/^[0-9]{6}$/.test(passcode)) throw new Error("A six-digit room passcode is required.");
    const joined = await apiFetch<Room>("/api/rooms/join", credential, {
      method: "POST",
      body: JSON.stringify({ invite_code: invite, passcode }),
    });
    if (!joined.id) throw new Error("This invitation requires a reachable room service.");
    localStorage.setItem(`genie_room_key_${joined.id}`, secretKey);
    localStorage.setItem(`genie_room_invite_${joined.id}`, invite);
    localStorage.setItem(`genie_room_passcode_${joined.id}`, passcode);
    setRooms((current) => current.some((item) => item.id === joined.id) ? current : [...current, joined]);
    setRoom(joined);
    setRoomKey(secretKey);
    setMessages([]);
    setThreadId("");
    setView("chat");
  }

  async function openRoom(id: string) {
    const selected = rooms.find((item) => item.id === id);
    const key = localStorage.getItem(`genie_room_key_${id}`);
    if (!selected || !key) {
      setToast("This device does not have the room key. Open the original invitation link.");
      return;
    }
    setMessages([]);
    setRoom(selected);
    setRoomKey(key);
    setThreadId("");
    setView("chat");
  }

  function setRoomArchived(id: string, archived: boolean) {
    setArchivedRoomIds((current) => archived
      ? current.includes(id) ? current : [...current, id]
      : current.filter((roomId) => roomId !== id));
  }

  async function sendMessage(
    text: string,
    secret: boolean,
    attachment?: Attachment,
    model = "genie-pro",
    thinkingLevel = "pro",
    target: SubmitTarget = "agent",
  ) {
    if (!identity || !credential) return;
    const content = secret ? `${SECRET_MARKER}${text}` : text;
    const timestamp = new Date().toISOString();
    if (!room && !threadId) setThreadId(crypto.randomUUID());
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(), role: "user", content: text, is_secret: secret,
      sender_sub: identity.sub,
      attachment: attachment ? { mime_type: attachment.mime_type, data: attachment.data } : undefined,
      tick_status: "sent", sent_at: timestamp,
    };
    setMessages((current) => [...current, userMessage]);

    if (room && (target === "peers" || secret)) {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !roomKeyRef.current) {
        setRoomStatus("Room is not connected. Your message was not sent.");
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        return;
      }
      try {
        const ciphertext = await encryptRoomMessage(roomKeyRef.current, {
          content,
          attachment: attachment ? { mime_type: attachment.mime_type, data: attachment.data } : undefined,
        });
        socket.send(JSON.stringify({ type: "message.send", ciphertext, is_secret: secret, client_id: userMessage.id }));
      } catch {
        setRoomStatus("Message encryption failed. Nothing was sent.");
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
      }
      return;
    }

    if (secret) {
      const confirmation: ChatMessage = {
        id: crypto.randomUUID(), role: "assistant",
        content: "🔒 Secret received. It was not sent to an AI provider or archive.",
        tick_status: "yellow_no_ai", sent_at: new Date().toISOString(),
      };
      setMessages((current) => [...current, confirmation]);
      return;
    }

    const context = [...activeThreadMessages, userMessage]
      .filter((message) => message.role === "user" || message.role === "assistant")
      .filter((message) => !message.is_secret && !message.content.includes(SECRET_MARKER))
      .slice(-39)
      .map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.id === userMessage.id && attachment
          ? { image_data: { mime_type: attachment.mime_type, data: attachment.data } }
          : {}),
      }));
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, { id: assistantId, role: "assistant", content: "" }]);
    setSending(true);
    try {
      const response = await fetch("/api/py/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
        body: JSON.stringify({
          messages: context,
          model: model === "individual" ? "genie-pro" : model,
          thinking_level: thinkingLevel,
          is_secret: false,
        }),
        cache: "no-store",
      });
      if (!response.ok || !response.body) {
        let detail = `Chat request failed (${response.status}).`;
        try {
          const payload = await response.json() as { detail?: string };
          detail = payload.detail || detail;
        } catch { /* The response may be empty. */ }
        throw new Error(detail);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = "";
      const readFrames = (chunk: string) => {
        buffer += chunk;
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const eventType = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
          const dataLine = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine) as { text?: string; detail?: string; reply?: string };
          if (eventType === "token" && payload.text) {
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + payload.text } : message));
          } else if (eventType === "confirmation" && payload.reply) {
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: payload.reply!, tick_status: "yellow_no_ai" } : message));
          } else if (eventType === "error") {
            streamError = payload.detail || "AI provider request failed.";
          }
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        readFrames(decoder.decode(value, { stream: true }));
      }
      readFrames(decoder.decode());
      if (streamError) throw new Error(streamError);
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setToast(error instanceof Error ? error.message : "Chat could not be completed.");
    } finally {
      setSending(false);
    }
  }

  const reviewMessage = useCallback(async (messageId: string) => {
    if (!room || !credential) return;
    const context = messages.slice(-20)
      .filter((message) => !message.is_secret && !message.content.includes(SECRET_MARKER))
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({ role: message.role, content: message.content, is_secret: false }));
    setRoomStatus("Preparing private review…");
    try {
      const result = await apiFetch<{
        type: string; message_id: string; tick_status: string; triggered_by: string;
        triggered_by_sub: string; tokens_burned: number; breakdown: string;
        ai_reply: string; review_at: string;
      }>(`/api/rooms/${room.id}/messages/${messageId}/review`, credential, {
        method: "POST", body: JSON.stringify({ context }),
      });
      setMessages((current) => current.map((message) => message.id === messageId ? {
        ...message, tick_status: "ai_review_active", ai_reply: result.ai_reply,
        review_at: result.review_at, review_triggered_by: result.triggered_by_sub,
        triggered_by: result.triggered_by, tokens_burned: result.tokens_burned,
        breakdown: result.breakdown,
      } : message));
      try {
        const encryptedReview = await encryptRoomMessage(roomKeyRef.current, { content: result.ai_reply });
        await apiFetch(
          `/api/rooms/${room.id}/messages/${messageId}/review-ciphertext`,
          credential,
          { method: "POST", body: JSON.stringify({ ciphertext: encryptedReview }) },
        );
      } catch (error) {
        setRoomStatus(error instanceof Error
          ? `Review delivered but its encrypted history could not be stored: ${error.message}`
          : "Review delivered but its encrypted history could not be stored.");
        setToast(error instanceof Error
          ? `Review delivered, but encrypted history could not be stored: ${error.message}`
          : "Review delivered, but encrypted history could not be stored.");
        return;
      }
      setRoomStatus(`Review complete · ${result.tokens_burned} tokens charged to your account.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI review failed.";
      setRoomStatus(message);
      setToast(message);
    }
  }, [room, credential, messages]);

  async function verifyMessage(messageId: string) {
    if (!room || !credential) return;
    try {
      await apiFetch(`/api/rooms/${room.id}/messages/${messageId}/verify`, credential, { method: "POST", body: "{}" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review could not be verified.";
      setRoomStatus(message);
      setToast(message);
    }
  }

  async function updateProfilePreferences(preferences: ProfilePreferences) {
    if (!credential) throw new Error("Sign in before updating privacy preferences.");
    try {
      await apiFetch("/api/profile/preferences", credential, {
        method: "PUT",
        body: JSON.stringify({
          ...preferences,
          telemetry_enabled: Boolean(preferences.telemetry_enabled),
        }),
      });
    } catch {
      setToast("Preferences saved on this device; account sync is unavailable.");
    }
    setProfilePreferences({ ...preferences, telemetry_enabled: Boolean(preferences.telemetry_enabled) });
    if (identity) {
      localStorage.setItem(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), JSON.stringify({
        ...profileDetails,
        ...preferences,
        registration_complete: true,
        email: identity.email,
        user_name: identity.name,
      }));
    }
  }

  async function updateProfileDetails(details: ProfileDetails) {
    if (!credential) throw new Error("Sign in before updating your profile.");
    try {
      await apiFetch("/api/profile/details", credential, {
        method: "PUT",
        body: JSON.stringify(details),
      });
    } catch {
      setToast("Profile saved on this device; account sync is unavailable.");
    }
    setProfileDetails(details);
    setProfilePreferences((current) => ({ ...current, default_dialect: details.default_dialect }));
    if (identity) {
      localStorage.setItem(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), JSON.stringify({
        ...profilePreferences,
        ...details,
        registration_complete: true,
        email: identity.email,
        user_name: details.display_name,
      }));
    }
    setIdentity((current) => current ? {
      ...current,
      name: details.display_name,
      picture: details.custom_picture_data || current.picture,
    } : current);
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!credential || !identity) return;
    setPasskeyBusy(true);
    setAuthError("");
    try {
      const profile: ProfileResponse = {
        ...profilePreferences,
        ...profileDetails,
        display_name: registration.full_name.trim(),
        city_region: registration.city_region.trim(),
        registration_complete: true,
        email: registration.email.trim().toLowerCase(),
        user_name: registration.full_name.trim(),
        phone: registration.phone.trim(),
      };
      localStorage.setItem(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), JSON.stringify(profile));
      await apiFetch("/api/auth/register", credential, {
        method: "POST",
        body: JSON.stringify(registration),
      });
      localStorage.setItem("genie_returning_email", registration.email.trim().toLowerCase());
      setIdentity((current) => current ? { ...current, name: registration.full_name.trim() } : current);
      setAccountStatus("passkey-setup");
    } catch {
      setToast("Registration is saved on this device; account sync is unavailable.");
      setAccountStatus("passkey-setup");
    } finally {
      setPasskeyBusy(false);
    }
  }

  function beginGoogleRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = {
      full_name: registration.full_name.trim(),
      phone: registration.phone.trim(),
      city_region: registration.city_region.trim(),
    };
    const digits = draft.phone.replace(/\D/g, "");
    if (!draft.full_name || !draft.city_region || !/^\+[0-9\s().-]+$/.test(draft.phone) || digits.length < 7 || digits.length > 15) {
      setAuthError("Enter your full name, an international phone number, and city or region.");
      return;
    }
    if (!clientId) {
      setAuthError("Google sign-in is not configured for this app.");
      return;
    }
    pendingRegistration.current = draft;
    sessionStorage.setItem("genie_pending_registration", JSON.stringify(draft));
    localStorage.setItem("genie_registration_draft", JSON.stringify(draft));
    setAuthError("Complete Google sign-in in the prompt to securely finish registration.");
    if (!window.google?.accounts?.id) {
      promptWhenReady.current = true;
      setAuthError("Google sign-in is still loading. Please try again.");
      return;
    }
    try {
      window.google.accounts.id.prompt();
    } catch {
      setAuthError("Google sign-in could not open. Enable pop-ups and try again; no authenticated session was created.");
    }
  }

  async function loginWithPasskey() {
    const email = loginEmail.trim().toLowerCase();
    if (!email) {
      setAuthError("Enter your registered email to continue with a passkey.");
      return;
    }
    setPasskeyBusy(true);
    setAuthError("");
    try {
      const result = await loginWithUserPasskey(email);
      sessionStorage.removeItem("genie_google_credential");
      sessionStorage.setItem("genie_user_session", result.session_token);
      localStorage.setItem("genie_returning_email", result.identity.email);
      setCredential(result.session_token);
      setIdentity(result.identity);
      setAccountStatus("checking");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Passkey sign-in failed.");
      setShowPasskeyLogin(false);
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function setupUserPasskey() {
    try {
      await enrollUserPasskey(credential);
      setToast("This device passkey is ready for your next sign-in.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Passkey setup failed.");
    }
  }

  async function finishInitialPasskeySetup() {
    setPasskeyBusy(true);
    setAuthError("");
    try {
      await enrollUserPasskey(credential);
      setAccountStatus("ready");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Passkey setup failed.");
    } finally {
      setPasskeyBusy(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem("genie_google_credential");
    sessionStorage.removeItem("genie_user_session");
    window.google?.accounts.id.disableAutoSelect();
    setCredential("");
    setIdentity(null);
    registrationCompleted.current = false;
    pendingRegistration.current = null;
    sessionStorage.removeItem("genie_pending_registration");
    setAccountStatus("checking");
    setLoadedThreadsFor("");
    setRoom(null);
    setRoomKey("");
    setMessages([]);
    setThreads([]);
    setFriends([]);
    setFriendRequests([]);
    setAIAvailability(null);
    setAIAvailabilityError("");
    setSettingsOpen(false);
  }

  async function removeAccount() {
    if (identity) {
      localStorage.removeItem(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub));
      localStorage.removeItem(userStorageKey(LOCAL_ROOMS_STORAGE, identity.sub));
      localStorage.removeItem(userStorageKey(LOCAL_REQUESTS_STORAGE, identity.sub));
      localStorage.removeItem(userStorageKey(LOCAL_FRIENDS_STORAGE, identity.sub));
    }
    try {
      await apiFetch("/api/profile/account", credential, { method: "DELETE" });
    } catch {
      setToast("Local profile removed; account sync is unavailable.");
    }
    signOut();
    setToast("Profile and passkeys removed. Encrypted room history remains with room participants.");
  }

  async function loadMessageLedger(messageId: string) {
  if (!room || !credential) return {};
  return apiFetch<Partial<ChatMessage>>(
    `/api/rooms/${room.id}/messages/${messageId}/ledger`,
    credential,
  );
  }

  async function editRoomMessage(message: ChatMessage, content: string) {
  if (!room || !roomKey || !socketRef.current || !message.sender_sub) return;
  const ciphertext = await encryptRoomMessage(roomKey, { content });
  socketRef.current.send(JSON.stringify({
    type: "message.edit",
    message_id: message.id,
    ciphertext,
  }));
  }

  async function forwardMessageToRoom(destinationRoomId: string) {
  if (!forwardingMessage || !credential || destinationRoomId === room?.id) {
    throw new Error("Choose a different room with access on this device.");
  }
  const destinationKey = localStorage.getItem(`genie_room_key_${destinationRoomId}`);
  if (!destinationKey) throw new Error("This device does not have the destination room key.");
  const ciphertext = await encryptRoomMessage(destinationKey, {
    content: forwardingMessage.content,
    attachment: forwardingMessage.attachment,
  });
  await apiFetch(`/api/rooms/${destinationRoomId}/messages`, credential, {
    method: "POST",
    body: JSON.stringify({ ciphertext, is_secret: forwardingMessage.is_secret || false }),
  });
  }

  function broadcastActivity(activity: "typing" | "recording" | "prompting" | "idle") {
  if (socketRef.current?.readyState === WebSocket.OPEN) {
    socketRef.current.send(JSON.stringify({ type: activity }));
  }
  }

  function setScannedPdf(pdfBase64: string) {
  const bytes = Uint8Array.from(atob(pdfBase64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  setPdfArtifactUrl(url);
  }

  function downloadScannedPdf() {
  if (!pdfArtifactUrl) return;
  const link = document.createElement("a");
  link.href = pdfArtifactUrl;
  link.download = "genie-clean-scan.pdf";
  link.click();
  }

  async function saveEditedMessage(message: ChatMessage, content: string) {
  if (room) {
    await editRoomMessage(message, content);
    return;
  }
  const updatedAt = new Date().toISOString();
  setMessages((current) => current.map((item) => item.id === message.id
    ? { ...item, content, updated_at: updatedAt, is_edited: true }
    : item));
  }

  function purgeLocalRoomKeys() {
  if (!window.confirm("Remove this device's saved room keys and invite credentials? Encrypted rooms cannot be opened here until rejoined.")) return;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key && /^genie_room_(key|invite|passcode)_/.test(key)) localStorage.removeItem(key);
  }
  socketRef.current?.close();
  socketRef.current = null;
  roomKeyRef.current = "";
  const query = new URLSearchParams(window.location.search);
  query.delete("room");
  query.delete("invite");
  window.history.replaceState(null, "", `${window.location.pathname}${query.size ? `?${query}` : ""}`);
  setRoom(null);
  setRoomKey("");
  setMessages([]);
  setRoomStatus("Saved room keys and invite credentials removed from this device.");
  }

  async function refreshSocial() {
    if (!credential) return;
    const [requestList, friendList, roomList] = await Promise.all([
      apiFetch<FriendRequestItem[]>("/api/social/requests", credential).catch(() => [] as FriendRequestItem[]),
      apiFetch<FriendItem[]>("/api/social/friends", credential).catch(() => [] as FriendItem[]),
      apiFetch<Room[]>("/api/rooms", credential).catch(() => [] as Room[]),
    ]);
    setFriendRequests((current) => Array.from(new Map([...current, ...requestList].map((item) => [item.id, item] as const)).values()));
    setFriends((current) => Array.from(new Map([...current, ...friendList].map((item) => [item.user_sub, item] as const)).values()));
    setRooms((current) => Array.from(new Map([...current, ...roomList].map((item) => [item.id, item] as const)).values()));
  }

  async function acceptFriendRequest(id: string) {
    if (!credential) return;
    const request = friendRequests.find((item) => item.id === id);
    setFriendRequests((current) => current.filter((item) => item.id !== id));
    if (request) setFriends((current) => current.some((friend) => friend.email === request.email)
      ? current
      : [...current, { user_sub: `local:${request.email.toLowerCase()}`, user_name: request.sender_name, email: request.email }]);
    try {
      await apiFetch(`/api/social/requests/${id}/accept`, credential, { method: "POST", body: "{}" });
    } catch {
      setToast("Friend acceptance is saved on this device; account sync is unavailable.");
    }
    await refreshSocial();
  }

  async function rejectFriendRequest(id: string) {
    if (!credential) return;
    setFriendRequests((current) => current.filter((item) => item.id !== id));
    try {
      await apiFetch(`/api/social/requests/${id}/reject`, credential, { method: "POST", body: "{}" });
    } catch {
      setToast("Friend request removal is saved on this device; account sync is unavailable.");
    }
    await refreshSocial();
  }

  async function sendFriendRequest(email: string) {
    if (!credential) return;
    const normalizedEmail = email.trim().toLowerCase();
    const request = { id: `local:${crypto.randomUUID()}`, sender_name: normalizedEmail.split("@")[0], email: normalizedEmail };
    setFriendRequests((current) => current.some((item) => item.email.toLowerCase() === normalizedEmail)
      ? current
      : [request, ...current]);
    try {
      await apiFetch("/api/social/requests", credential, { method: "POST", body: JSON.stringify({ email: normalizedEmail }) });
    } catch {
      setToast("Friend request is saved on this device; account sync is unavailable.");
    }
    await refreshSocial();
  }

  async function registerPhone(phone: string) {
    if (!credential) return;
    await apiFetch("/api/profile/phone", credential, {
      method: "PUT",
      body: JSON.stringify({ phone }),
    });
  }

  async function runMetaSync(phoneNumbers: string[]) {
    if (!credential) return [];
    return apiFetch<FriendItem[]>("/api/social/metasync", credential, {
      method: "POST",
      body: JSON.stringify({ phone_numbers: phoneNumbers }),
    });
  }

  async function searchDirectory(query: string) {
    if (!credential) return [];
    return apiFetch<FriendItem[]>(
      `/api/social/directory?query=${encodeURIComponent(query)}`,
      credential,
    );
  }

  async function shareCurrentRoom() {
    if (!room) return;
    const invite = localStorage.getItem(`genie_room_invite_${room.id}`);
    const key = localStorage.getItem(`genie_room_key_${room.id}`);
    if (!invite || !key) {
      setToast("No complete shareable room invitation is stored on this device.");
      return;
    }
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("room", room.id);
    url.hash = `key=${encodeURIComponent(key)}&invite=${encodeURIComponent(invite)}`;
    setInviteLink(url.toString());
    setInvitePasscode(localStorage.getItem(`genie_room_passcode_${room.id}`) || "");
    setInviteOpen(true);
  }

  function handleAvatarTap() {
    if (identity?.email.toLowerCase() !== "rshaji93@gmail.com") {
      setSettingsOpen(true);
      return;
    }
    const now = Date.now();
    avatarTaps.current = [...avatarTaps.current.filter((time) => now - time < 1500), now];
    if (avatarTaps.current.length >= 3) {
      avatarTaps.current = [];
      setAdminOpen(true);
    }
  }

  function onCallGenie() {
    setRailOpen(false);
    setToast("Use the microphone in the composer to start a voice conversation.");
  }

  function sendUtilityVoiceNote(dataUrl: string, durationSeconds: number) {
    if (!room) {
      setToast("Open an encrypted room before sending a peer voice note.");
      return;
    }
    const [header, data] = dataUrl.split(",", 2);
    const mimeType = header?.match(/data:([^;]+)/)?.[1] || "audio/webm";
    void sendMessage(
      `[VOICE_NOTE] ${durationSeconds}s`,
      false,
      { mime_type: mimeType, data: data || "", name: `voice-note-${durationSeconds}s` },
      "genie-pro",
      "pro",
      "peers",
    );
  }

  function sendCallSignal(toSub: string, payload: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setRoomStatus("Room is not connected. The call signal was not sent.");
      return;
    }
    socket.send(JSON.stringify({ type: "call.signal", to_sub: toSub, payload }));
  }

  if (!isMounted) {
    return <main className="login-shell"><section className="login-card"><IdealGLogo className="login-logo" size={54} /><h1>Preparing your workspace</h1></section></main>;
  }

  if (!credential || !identity) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <IdealGLogo className="login-logo" size={54} />
          <h1>{showPasskeyLogin ? "Welcome back" : "Create your Genie account"}</h1>
          <p>{showPasskeyLogin ? "Sign in securely with your registered device passkey." : "Enter your details, then continue with Google to verify your account."}</p>
          {showPasskeyLogin ? (
            <form className="passkey-login-form" onSubmit={(event) => { event.preventDefault(); void loginWithPasskey(); }}>
              <label htmlFor="passkey-email">Registered email</label>
              <input id="passkey-email" autoComplete="email" type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="you@example.com" />
              <button className="passkey-primary" disabled={passkeyBusy} type="submit">
                {passkeyBusy ? "Waiting for device…" : "Continue with passkey"}
              </button>
              <button className="subtle-button" onClick={() => { setShowPasskeyLogin(false); setAuthError(""); }} type="button">New user? Register with Google</button>
            </form>
          ) : (
            <>
              <form className="registration-form google-registration-form" onSubmit={beginGoogleRegistration}>
                <label>Full name<input autoComplete="name" maxLength={100} required value={registration.full_name} onChange={(event) => setRegistration((current) => ({ ...current, full_name: event.target.value }))} /></label>
                <label>Phone with international country code<input autoComplete="tel" placeholder="+1 555 123 4567" required type="tel" value={registration.phone} onChange={(event) => setRegistration((current) => ({ ...current, phone: event.target.value }))} /></label>
                <label>City / region<input autoComplete="address-level2" maxLength={120} required value={registration.city_region} onChange={(event) => setRegistration((current) => ({ ...current, city_region: event.target.value }))} /></label>
                <button className="google-react-button" disabled={passkeyBusy} type="submit"><span className="google-letter">G</span>Sign in with Google</button>
              </form>
              {!clientId ? (
                <p className="login-config">Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in frontend/.env.local and GENIE_GOOGLE_CLIENT_ID in the backend environment.</p>
              ) : (
                <div className="google-button-container" ref={googleButton} />
              )}
              <button className="subtle-button" onClick={() => { setShowPasskeyLogin(true); setAuthError(""); }} type="button">Already registered user?</button>
            </>
          )}
          {authError && <p className="login-error" role="alert">{authError}</p>}
          <footer className="login-legal-links"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></footer>
        </section>
      </main>
    );
  }

  if (accountStatus === "checking") {
    return <main className="login-shell"><section className="login-card"><IdealGLogo className="login-logo" size={54} /><h1>Preparing your workspace</h1><p>Verifying your account and loading your profile…</p>{authError && <p className="login-error" role="alert">{authError}</p>}</section></main>;
  }

  if (accountStatus === "passkey-setup") {
    return (
      <main className="login-shell">
        <section className="login-card registration-card">
          <IdealGLogo className="login-logo" size={54} />
          <span className="eyebrow">SECURE YOUR ACCOUNT</span>
          <h1>Set up a device passkey</h1>
          <p>Use this device’s passkey for secure sign-in next time. You can also set it up later in Settings.</p>
          <button className="passkey-primary" disabled={passkeyBusy} onClick={() => void finishInitialPasskeySetup()} type="button">
            {passkeyBusy ? "Setting up passkey…" : "Set up passkey"}
          </button>
          {authError && <p className="login-error" role="alert">{authError}</p>}
          <button className="subtle-button" disabled={passkeyBusy} onClick={() => setAccountStatus("ready")} type="button">Continue without a passkey</button>
          <footer className="login-legal-links"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></footer>
        </section>
      </main>
    );
  }

  if (accountStatus === "registration") {
    return (
      <main className="login-shell">
        <section className="login-card registration-card">
          <IdealGLogo className="login-logo" size={54} />
          <span className="eyebrow">FIRST-TIME SETUP</span>
          <h1>Create your Genie profile</h1>
          <p>Your verified Google account is used only to establish this account. Provide the required details to continue.</p>
          <form className="registration-form" onSubmit={(event) => void submitRegistration(event)}>
            <label>Full name<input autoComplete="name" maxLength={100} required value={registration.full_name} onChange={(event) => setRegistration((value) => ({ ...value, full_name: event.target.value }))} /></label>
            <label>Google email<input autoComplete="email" readOnly required type="email" value={registration.email} /></label>
            <label>Phone with international country code<input autoComplete="tel" placeholder="+1 555 123 4567" required type="tel" value={registration.phone} onChange={(event) => setRegistration((value) => ({ ...value, phone: event.target.value }))} /></label>
            <label>City / region<input autoComplete="address-level2" maxLength={120} required value={registration.city_region} onChange={(event) => setRegistration((value) => ({ ...value, city_region: event.target.value }))} /></label>
            <button className="passkey-primary" disabled={passkeyBusy} type="submit">{passkeyBusy ? "Saving account…" : "Create account"}</button>
          </form>
          {authError && <p className="login-error" role="alert">{authError}</p>}
          <button className="subtle-button" onClick={signOut} type="button">Cancel and sign out</button>
          <footer className="login-legal-links"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></footer>
        </section>
      </main>
    );
  }

  const sectionView = view === "chat" ? null : view;
  return (
    <main className="application-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        view={view}
        threads={threads}
        selectedThreadId={threadId}
        onlineMembers={onlineNames}
        displayName={profileDetails.display_name || identity.name}
        pictureUrl={profileDetails.custom_picture_data || identity.picture}
        activeModel={activeModel}
        onToggle={() => setSidebarCollapsed((current) => !current)}
        onViewChange={setView}
        onNewChat={startNewChat}
        onThreadSelect={selectThread}
        onSearch={() => setSearchOpen(true)}
        onInviteRoom={() => room ? void shareCurrentRoom() : void createRoom()}
        onOpenSettings={() => setSettingsOpen(true)}
        onProfileTap={handleAvatarTap}
      />
      <div className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-location">
            <span>{room ? room.name : "Personal AI Genie"}</span>
            {room && <><span>·</span><span className={`presence-light ${roomStatus.startsWith("Connected") ? "green" : "yellow"}`} /><span>{roomStatus || "Connecting…"}</span></>}
          </div>
          <div className="workspace-top-actions">
            {room && <button className="room-control" onClick={() => void shareCurrentRoom()} title="Copy encrypted room invite"><ArrowUpRight size={14} /> Invite</button>}
            {room && <div className="room-roster">
              <button className="room-roster-trigger" onClick={() => {
                setHeaderMenuOpen(false);
                setRailOpen(false);
                setRosterOpen((open) => !open);
              }} aria-expanded={rosterOpen} aria-label={`Room participants, ${members.length} total`}>
                <UsersRound size={15} /><span>{members.filter((member) => member.user_sub === identity.sub || onlineSubs.includes(member.user_sub)).length}/{members.length} active</span>
              </button>
              {rosterOpen && <div className="room-roster-popover" role="list" aria-label="Active room members">
                {members.map((member) => {
                  const online = member.user_sub === identity.sub || onlineSubs.includes(member.user_sub);
                  const voiceActive = voiceSubs.includes(member.user_sub);
                  return <div className="room-roster-person" key={member.user_sub} role="listitem">
                    <b className="room-person-avatar">{member.user_name.slice(0, 1).toLocaleUpperCase()}</b>
                    <span><strong>{member.user_name}{member.user_sub === identity.sub ? " (you)" : ""}</strong><small>{voiceActive ? "On voice" : online ? "Online" : "Offline"}</small></span>
                    <i className={`presence-light ${voiceActive ? "yellow" : online ? "green" : "red"}`} />
                    {voiceActive && <AudioLines size={12} aria-label="Voice connected" />}
                  </div>;
                })}
              </div>}
            </div>}
            <button className="utility-trigger" onClick={() => {
              setHeaderMenuOpen(false);
              setRosterOpen(false);
              setRailOpen((open) => !open);
            }} aria-label="Open workspace utilities" aria-expanded={railOpen}><Settings2 size={15} /><span>Utilities</span></button>
            <div className="header-actions-menu">
              <button className="utility-trigger header-menu-trigger" onClick={() => {
                setRailOpen(false);
                setRosterOpen(false);
                setHeaderMenuOpen((open) => !open);
              }} aria-label="Open workspace actions" aria-expanded={headerMenuOpen}><MoreHorizontal size={16} /></button>
              {headerMenuOpen && <div className="header-actions-popover" role="menu">
                <button role="menuitem" onClick={() => { setSearchOpen(true); setHeaderMenuOpen(false); }}><Search size={15} /> Search chats</button>
              </div>}
            </div>
          </div>
        </header>
        {sectionView ? (
          <WorkspacePanel
            view={sectionView}
            savedItems={library}
            onRemoveSaved={(id) => setLibrary((items) => items.filter((item) => item.id !== id))}
            rooms={rooms}
            archivedRoomIds={archivedRoomIds}
            onArchiveRoom={(id) => setRoomArchived(id, true)}
            onUnarchiveRoom={(id) => setRoomArchived(id, false)}
            currentRoomId={room?.id}
            requests={friendRequests}
            friends={friends}
            onAcceptRequest={acceptFriendRequest}
            onRejectRequest={rejectFriendRequest}
            onSendFriendRequest={sendFriendRequest}
            onRegisterPhone={registerPhone}
            onMetaSync={runMetaSync}
            onSearchDirectory={searchDirectory}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            onOpenRoom={(id) => void openRoom(id)}
          />
        ) : (
          <ChatCanvas
            messages={messages}
            loading={sending}
            activeRoom={Boolean(room)}
            mySub={identity.sub}
            onReview={(id) => void reviewMessage(id)}
            onVerify={(id) => void verifyMessage(id)}
            onRefine={() => setToast("Each room message can receive one AI review. The current review remains available above.")}
            onQuote={(message) => setQuoteText(`Replying to ${message.sender_name || "message"}:\n${message.content}`)}
            onForward={(message) => setForwardingMessage(message)}
            onReferToGenie={(message) => {
              if (room) void reviewMessage(message.id);
              else setQuoteText(`Context for Genie:\n${message.content}`);
            }}
            onEdit={(message, content) => void saveEditedMessage(message, content)}
            onLoadLedger={loadMessageLedger}
          >
            <MultiUserTypingBar
              activities={Object.values(roomActivities).map(({ name, activity }) => (
                activity === "typing" ? `${name} is typing to the room…`
                  : activity === "recording" ? `${name} is recording a voice note…`
                    : `${name} is prompting Genie…`
              ))}
            />
            <OmniComposer
              isMultiUserRoom={Boolean(room)}
              memberCount={room ? members.length : 1}
              participants={members.filter((member) => member.user_sub !== identity.sub).map((member) => member.user_name)}
              sending={sending}
              aiAvailability={aiAvailability || undefined}
              availabilityError={aiAvailabilityError || undefined}
              quoteText={quoteText}
              defaultDialect={profilePreferences.default_dialect}
              onClearQuote={() => setQuoteText("")}
              onActivity={broadcastActivity}
              onPdfScanned={setScannedPdf}
              stagedVoiceNote={stagedVoiceNote}
              transcribeRequest={transcribeRequest}
              onOpenPrivacy={() => setSettingsOpen(true)}
              onModelChange={(model) => setActiveModel(model === "genie-master" ? "Genie Master" : model === "individual" ? "Individual Chat" : "Genie Pro")}
              onSubmit={(text, secret, attachment, model, thinkingLevel, target) => void sendMessage(text, secret, attachment, model, thinkingLevel, target)}
            />
          </ChatCanvas>
        )}
      </div>
      <RightSideRail
        open={railOpen}
        roomId={room?.id}
        mySub={identity.sub}
        members={members}
        onlineSubs={onlineSubs}
        incomingSignal={callSignal}
        onClose={() => setRailOpen(false)}
        onCallGenie={onCallGenie}
        onSendVoiceNote={sendUtilityVoiceNote}
        onStageVoiceNote={(dataUrl, durationSeconds) => setStagedVoiceNote({
          id: crypto.randomUUID(), dataUrl, durationSeconds,
        })}
        onTranscribeLive={() => setTranscribeRequest((request) => request + 1)}
        onOpenSettings={() => setSettingsOpen(true)}
        onVoiceParticipantsChange={updateVoiceSubs}
        onSendSignal={sendCallSignal}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        preferences={profilePreferences}
        onSavePreferences={updateProfilePreferences}
        profile={profileDetails}
        onSaveProfile={updateProfileDetails}
        onSetupPasskey={setupUserPasskey}
        onSignOut={signOut}
        onRemoveAccount={removeAccount}
        onPurgeLocalCache={purgeLocalRoomKeys}
      />
      <RoomInviteModal
        open={inviteOpen}
        link={inviteLink}
        passcode={invitePasscode}
        onClose={() => setInviteOpen(false)}
        onShare={() => {
          try {
            void distributeRoomInvite(new URL(inviteLink), invitePasscode);
          } catch {
            setToast("Room invitation link is invalid.");
          }
        }}
        onCopy={() => {
          void navigator.clipboard.writeText(`${inviteLink}\nRoom passcode: ${invitePasscode}`)
            .then(() => setToast("Encrypted room invitation copied."))
            .catch(() => setToast("Clipboard access is unavailable. Copy the invitation link manually."));
        }}
      />
      <CommandSearchModal
        open={searchOpen}
        threads={threads}
        onClose={() => setSearchOpen(false)}
        onSelect={selectThread}
      />
      <AdminPasskey
        open={adminOpen}
        credential={credential}
        onClose={() => setAdminOpen(false)}
        onUnlocked={(token) => {
          setAdminToken(token);
        void apiFetch<{
          status: string; rooms: number; users: number; reviews: number; review_tokens: number; expires_at: number;
        }>("/api/admin/status", token)
          .then((result) => {
            setAdminStats(result);
            setToast(`Secure Admin Dashboard ${result.status}.`);
          })
          .catch((error: unknown) => setToast(error instanceof Error ? error.message : "Admin session rejected."));
        }}
      />
      {adminToken && adminStats && <div className="admin-session-badge"><ShieldCheck size={13} /> Secure Admin session active <button onClick={() => setAdminStats(adminStats)}>Open dashboard</button><button onClick={() => { setAdminToken(""); setAdminStats(null); }}>Lock</button></div>}
      <AdminDashboard stats={adminStats} onClose={() => { setAdminStats(null); setAdminToken(""); }} />
      <ForwardToRoomModal
        open={Boolean(forwardingMessage)}
        source={forwardingMessage || undefined}
        rooms={rooms.filter((item) => item.id !== room?.id)}
        onClose={() => setForwardingMessage(null)}
        onForward={forwardMessageToRoom}
      />
      {pdfArtifactUrl && <PdfArtifactPreview url={pdfArtifactUrl} onDownload={downloadScannedPdf} onClose={() => {
        setPdfArtifactUrl("");
      }} />}
      {toast && <div className="toast-message" role="status">{toast}<button onClick={() => setToast("")}>Dismiss</button></div>}
    </main>
  );
}
