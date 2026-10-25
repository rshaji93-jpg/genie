"use client";

import { ArrowUpRight, AudioLines, Check, ChevronDown, LockKeyhole, Menu, MoreHorizontal, Search, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import AdminDashboard from "@/components/genie/AdminDashboard";
import AdminPasskey, {
  LOCAL_ADMIN_UNLOCK_TOKEN,
  LOCAL_CREDENTIAL_STORAGE_KEY,
} from "@/components/genie/AdminPasskey";
import ChatCanvas, { type ChatMessage } from "@/components/genie/ChatCanvas";
import CommandSearchModal from "@/components/genie/CommandSearchModal";
import OmniComposer, { type Attachment, type ChatMode, type SubmitTarget } from "@/modules/composer/OptionAComposer";
import RightSideRail, { type CallSignal, type RoomPerson } from "@/components/genie/RightSideRail";
import FixedGroups5x5Modal, { type FixedGroupFriend } from "@/components/genie/modules/FixedGroups5x5Modal";
import PrivacySecurityModal, {
  type BlockedPrivacyUser,
  type FriendRequestSetting,
  type ProfileVisibility,
} from "@/components/genie/modules/PrivacySecurityModal";
import SettingsDialog from "@/components/genie/SettingsDialog";
import RoomInviteModal from "@/components/genie/RoomInviteModal";
import Sidebar, { type DeletedThreadItem, type ThreadItem, type WorkspaceView } from "@/components/genie/Sidebar";
import WorkspacePanel from "@/components/genie/WorkspacePanel";
import {
  ApiError,
  apiFetch,
  apiFetchWithFallback,
  apiRequest,
  approveProposedMemory,
  compressProfileAvatar,
  createFutureSelfEntry,
  randomToken,
  requestVoiceTts,
  saveLibraryItem,
  saveSocialProfile,
  type SocialProfile,
  type SocialProfileUpdate,
  websocketUrl,
} from "@/lib/api";
import { decryptRoomMessage, encryptRoomMessage } from "@/lib/roomCrypto";
import PdfArtifactPreview from "@/modules/scanner_pdf/PdfArtifactPreview";
import ForwardToRoomModal from "@/modules/messages_arrows/ForwardToRoomModal";
import MultiUserTypingBar from "@/modules/voice_presence/MultiUserTypingBar";
import IdealGLogo from "@/modules/brand/IdealGLogo";
import { enrollUserPasskey, loginWithUserPasskey } from "@/lib/userPasskeys";
import VoiceStudioModal, { type GenieVoiceId } from "@/components/genie/VoiceStudioModal";
import type { BackupSnapshot } from "@/components/genie/UserCloudBackupVault";

interface Identity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}
interface Room {
  id: string;
  name: string;
  owner_sub?: string;
  voice_dialect?: string;
  member_count?: number;
  group_slot?: number | null;
  group_icon?: string;
  auto_saved?: boolean;
}
interface PrivacySettings {
  profile_visibility: ProfileVisibility;
  friend_request_setting: FriendRequestSetting;
  friends_only_calls: boolean;
  prompt_before_screen_share: boolean;
}
interface ThreadRecord extends ThreadItem {
  messages: ChatMessage[];
}
type DeletedThreadRecord = ThreadRecord & DeletedThreadItem;
interface SavedItem { id: string; content: string; createdAt: string }
interface FriendRequestItem { id: string; sender_name: string; sender_username: string; sender_sub?: string; receiver_sub?: string }
interface OutgoingFriendRequestItem { id: string; receiver_name: string; receiver_username: string; sender_sub?: string; receiver_sub?: string }
interface FriendItem { user_sub: string; user_name: string; username: string | null; avatar_data_url?: string | null }
interface GroupInvitationItem {
  id: string;
  room_id: string;
  group_name: string;
  inviter_name: string;
}
interface AIAvailability {
  genie_pro_configured: boolean;
  genie_pro_available: boolean;
  genie_pro_retry_seconds: number;
  genie_master_configured: boolean;
  genie_master_available: boolean;
  genie_master_retry_seconds: number;
}
interface GenieVoice {
  id: GenieVoiceId;
  label: string;
  lang: string;
  pitch: number;
  rate: number;
  sample: string;
}
type TemporaryChatMode = "personalized" | "unpersonalized" | null;
interface QueuedAttachment {
  text: string;
  secret: boolean;
  attachment: Attachment & { document_data?: { name: string; mime_type: string; data: string } };
  model: string;
  thinkingLevel: string;
  target: SubmitTarget;
}
type GenieDocumentAttachment = Attachment & {
  document_data: { name: string; mime_type: string; data: string };
};
interface SpeechRecognitionResultLike {
  readonly 0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
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
  request_id?: string;
  sender?: { id?: string; user_sub?: string; name?: string; username?: string | null };
  receiver?: { id?: string; user_sub?: string; name?: string; username?: string | null };
  message?: WireMessage | string;
  messages?: WireMessage[];
  ai_responses?: {
    id: string;
    owner_sub: string;
    ciphertext: string;
    created_at: string;
    ai_responded_at: string;
  }[];
  id?: string;
  owner_sub?: string;
  created_at?: string;
  ai_responded_at?: string;
  target_type?: "user_message" | "ai_response";
  counts?: Record<string, number>;
  reaction_emoji?: string;
  reactor_username?: string;
  notification_message?: string;
  reaction_counts?: Record<string, Record<string, number>>;
  message_id?: string;
  message_ids?: string[];
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
  sender_sub?: string;
  sender_name?: string;
  ciphertext?: string;
  updated_at?: string;
  edited_by?: string;
  activity?: "typing" | "recording" | "prompting" | null;
  user_name?: string;
  cooldown_until?: string;
  recipient_sub?: string;
  recipient_name?: string;
  amount?: number;
  voice_dialect?: string;
  updated_by?: string;
}
interface TokenCooldownInfo {
  cooldownUntil: string;
  message: string;
}

class ChatCooldownError extends Error {
  constructor(message: string, readonly cooldownUntil: string) {
    super(message);
  }
}

function getCooldownDetail(payload: unknown): TokenCooldownInfo | null {
  if (!payload || typeof payload !== "object") return null;
  const detail = "detail" in payload ? payload.detail : undefined;
  if (!detail || typeof detail !== "object" || !("status" in detail) || detail.status !== "cooldown") return null;
  const cooldownUntil = "cooldown_until" in detail && typeof detail.cooldown_until === "string"
    ? detail.cooldown_until
    : "";
  const message = "message" in detail && typeof detail.message === "string"
    ? detail.message
    : "Your AI allowance is temporarily cooling down.";
  return cooldownUntil ? { cooldownUntil, message } : null;
}

interface ProfilePreferences {
  geo_region_hash: string | null;
  friend_circle_mode: "everyone" | "local_geo_circle_mutuals" | "mutuals_only";
  lookup_visibility: "everyone" | "mutual_contacts_only" | "invite_link_only";
  allow_broader_discovery: boolean;
  default_dialect: string;
  presence_override: "online" | "away" | "busy";
  telemetry_enabled: boolean | number;
  selected_voice_id?: string;
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
  selected_voice_id?: string;
  username?: string | null;
  discoverable?: boolean;
  profile_completed?: boolean;
  skills_offered?: string[];
  avatar_data_url?: string | null;
}

const THREAD_STORAGE = "genie_new_threads";
const TRASH_STORAGE = "genie_new_trash";
const LIBRARY_STORAGE = "genie_new_library";
const SECRET_MARKER = "[ENCRYPTED_SECRET_BLOCK]";
const LOCAL_ROOMS_STORAGE = "genie_local_rooms";
const LOCAL_REQUESTS_STORAGE = "genie_local_friend_requests";
const LOCAL_FRIENDS_STORAGE = "genie_local_friends";
const LOCAL_PROFILE_STORAGE = "genie_local_profile";
const LOCAL_VOICE_STORAGE = "genie_selected_voice";
const ADMIN_LOCAL_VERIFIED_CREDENTIAL_STORAGE_KEY = "genie_admin_verified_local_credential_id";
const GENIE_VOICES: GenieVoice[] = [
  { id: "genie-assistant", label: "Genie Assistant", lang: "en-IN", pitch: 1.08, rate: 1, sample: "Hello, I am your Genie Assistant. I can help with everyday questions, explain ideas clearly, and make your next step easier with a calm, thoughtful voice." },
  { id: "genie-master", label: "Genie Master", lang: "en-IN", pitch: 1.12, rate: 0.96, sample: "Hello, I am Genie Master. I bring careful reasoning to complex questions, code, and documents, then share a clear and considerate explanation you can act on." },
];
function isGenieVoiceId(value: unknown): value is GenieVoiceId {
  return value === "genie-assistant" || value === "genie-master";
}
const PHOTO_CREATION_INTENT = /\b(?:create|generate|make|draw|produce)\b.{0,40}\b(?:photo|image|picture|portrait|artwork)\b|\b(?:photo|image|picture|portrait)\b.{0,40}\b(?:create|generate|make|draw|produce)\b/i;
const PROHIBITED_PHOTO_CONTENT = /\b(?:nudity|nsfw|explicit|porn|adult|erotic|sexual|uncensored)\b|18\s*\+/i;
const PHOTO_POLICY_MESSAGE = "⚠️ Policy Restriction: Photo creation involving explicit or 18+ adult content is strictly prohibited on Personal AI Genie.";

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

const PLACEHOLDER_CONVERSATION_NAMES = new Set([
  "private room",
  "group 1",
  "group 2",
  "group 3",
  "group 4",
  "group 5",
]);

function isPlaceholderConversationName(name: string): boolean {
  return PLACEHOLDER_CONVERSATION_NAMES.has(name.trim().replace(/\.+$/, "").toLocaleLowerCase());
}

function cleanRecentThreads(threads: ThreadRecord[]): ThreadRecord[] {
  return threads.filter((thread) => !isPlaceholderConversationName(thread.title));
}

function cleanRecentRooms(rooms: Room[]): Room[] {
  return rooms.filter((room) => !isPlaceholderConversationName(room.name));
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

function roomInviteUrl(roomId: string, key: string, invite: string, groupSlot?: number | null): string {
  const url = new URL(window.location.href);
  url.search = "";
  const fragment = new URLSearchParams({ room: roomId, key, invite });
  if (groupSlot) fragment.set("group", String(groupSlot));
  url.hash = fragment.toString();
  return url.toString();
}

function fromWire(message: WireMessage, decrypted: unknown): ChatMessage {
  const data = typeof decrypted === "object" && decrypted !== null
    ? decrypted as {
      content?: unknown;
      chat_mode?: unknown;
      attachment?: { mime_type?: unknown; data?: unknown };
    }
    : {};
  const attachment = data.attachment && typeof data.attachment.mime_type === "string" && typeof data.attachment.data === "string"
    ? { mime_type: data.attachment.mime_type, data: data.attachment.data }
    : undefined;
  return {
    id: message.id,
    role: "user",
    content: typeof data.content === "string" ? data.content.replace(SECRET_MARKER, "") : "",
    chat_mode: data.chat_mode === "friends_only" ? "friends_only" : "ai_room",
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
  const registrationRef = useRef(registration);
  registrationRef.current = registration;
  const googleButton = useRef<HTMLDivElement>(null);
  const registrationCompleted = useRef(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<GenieVoiceId>("genie-assistant");
  const [voiceStudioOpen, setVoiceStudioOpen] = useState(false);
  const [studioDictationText, setStudioDictationText] = useState("");
  const [previewingVoiceId, setPreviewingVoiceId] = useState("");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimerRef = useRef<number | undefined>(undefined);
  const replyAudioRef = useRef<HTMLAudioElement | null>(null);
  const [temporaryChatActive, setTemporaryChatActive] = useState(false);
  const [temporaryChatMode, setTemporaryChatMode] = useState<TemporaryChatMode>(null);
  const [chatMode, setChatMode] = useState<ChatMode>("ai_room");
  const [privacyMenuOpen, setPrivacyMenuOpen] = useState(false);
  const wakeMessageIdsRef = useRef(new Set<string>());
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceSubsRef = useRef<string[]>([]);
  const sendMessageRef = useRef<(text: string, secret: boolean, attachment?: Attachment, model?: string, thinkingLevel?: string, target?: SubmitTarget, transcriptContext?: ChatMessage, voiceReply?: boolean, voiceDialect?: string, regenerate?: { prompt: ChatMessage; responseId: string; visibility: "private" | "group"; context: ChatMessage[] }, requestChatMode?: ChatMode, liveCallResponse?: boolean) => Promise<void>>(async () => {});
  const [queuedAttachment, setQueuedAttachment] = useState<QueuedAttachment | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [view, setView] = useState<WorkspaceView>("chat");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
    profile_visibility: "friends",
    friend_request_setting: "everyone",
    friends_only_calls: true,
    prompt_before_screen_share: true,
  });
  const [blockedPrivacyUsers, setBlockedPrivacyUsers] = useState<BlockedPrivacyUser[]>([]);
  const [momEmailEnabled, setMomEmailEnabled] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [invitePasscode, setInvitePasscode] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageSelectionMode, setMessageSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [reactionCounts, setReactionCounts] = useState<Record<string, Record<string, number>>>({});
  const [sending, setSending] = useState(false);
  const [tokenCooldown, setTokenCooldown] = useState<TokenCooldownInfo | null>(null);
  const [roomCooldownNotice, setRoomCooldownNotice] = useState<{
    userSub: string; userName: string; cooldownUntil: string;
  } | null>(null);
  const [transcribeRequest, setTranscribeRequest] = useState(0);
  const callSummonTranscript = useRef("");
  const [room, setRoom] = useState<Room | null>(null);
  const [roomVoiceDialect, setRoomVoiceDialect] = useState("en-IN");
  const [roomKey, setRoomKey] = useState("");
  const roomKeyRef = useRef("");
  const socketRef = useRef<WebSocket | null>(null);
  const [roomStatus, setRoomStatus] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [groupEditorRoom, setGroupEditorRoom] = useState<Room | null>(null);
  const [pendingGroupInvitations, setPendingGroupInvitations] = useState<GroupInvitationItem[]>([]);
  const [members, setMembers] = useState<RoomPerson[]>([]);
  const [onlineSubs, setOnlineSubs] = useState<string[]>([]);
  const [voiceSubs, setVoiceSubs] = useState<string[]>([]);
  const [callSignal, setCallSignal] = useState<CallSignal>();
  const [callAudioStream, setCallAudioStream] = useState<MediaStream | null>(null);
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [deletedThreads, setDeletedThreads] = useState<DeletedThreadRecord[]>([]);
  const [loadedThreadsFor, setLoadedThreadsFor] = useState("");
  const [threadId, setThreadId] = useState("");
  const threadsRef = useRef(threads);
  const [library, setLibrary] = useState<SavedItem[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequestItem[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<OutgoingFriendRequestItem[]>([]);
  const friendRequestNoticeInitialized = useRef(false);
  const friendRequestIdsRef = useRef(new Set<string>());
  const friendRefreshErrorShown = useRef(false);
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
  const switchToLocalAdminView = useCallback(() => {
    const verifiedCredentialId = sessionStorage.getItem(ADMIN_LOCAL_VERIFIED_CREDENTIAL_STORAGE_KEY);
    if (
      !verifiedCredentialId
      || localStorage.getItem(LOCAL_CREDENTIAL_STORAGE_KEY) !== verifiedCredentialId
    ) return false;

    setAdminToken(LOCAL_ADMIN_UNLOCK_TOKEN);
    setAdminStats({
      rooms: 0,
      users: 0,
      reviews: 0,
      review_tokens: 0,
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
    setToast("Device passkey confirmed locally. Showing the dashboard with baseline telemetry.");
    return true;
  }, []);
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
  const [socialProfile, setSocialProfile] = useState<SocialProfile>({
    user_id: "",
    email: "",
    username: null,
    display_name: "",
    avatar_data_url: null,
    bio: "",
    skills_offered: [],
    discoverable: false,
    profile_completed: false,
  });
  useEffect(() => {
    const collapseSidebar = () => {
      setSidebarCollapsed(true);
      setMobileSidebarOpen(false);
    };
    window.addEventListener("genie:composer-typing", collapseSidebar);
    return () => window.removeEventListener("genie:composer-typing", collapseSidebar);
  }, []);

  useEffect(() => {
    if (!credential || !identity) return;
    let disposed = false;
    const refreshIncomingRequests = () => {
      void apiFetch<FriendRequestItem[] | { requests?: FriendRequestItem[] }>("/api/social/requests", credential)
        .then((result) => {
          if (!disposed) {
            friendRefreshErrorShown.current = false;
            setFriendRequests(Array.isArray(result) ? result : result.requests || []);
          }
        })
        .catch(() => {
          if (!disposed && !friendRefreshErrorShown.current) {
            friendRefreshErrorShown.current = true;
            setToast("Incoming friend requests could not be refreshed.");
          }
        });
    };
    refreshIncomingRequests();
    const timer = window.setInterval(refreshIncomingRequests, 15_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [credential, identity?.sub]);
  useEffect(() => {
    if (!credential || !identity) return;
    let disposed = false;
    const refresh = () => {
      void apiFetch<GroupInvitationItem[] | { invitations?: GroupInvitationItem[] }>(
        "/api/group-invitations/pending",
        credential,
      )
        .then((result) => {
          const invitations = Array.isArray(result) ? result : result.invitations || [];
          if (!disposed) setPendingGroupInvitations(invitations);
        })
        .catch((error: unknown) => {
          if (!disposed) setToast(error instanceof Error ? error.message : "Group invitations could not be loaded.");
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [credential, identity?.sub]);
  useEffect(() => {
    if (!credential || !identity) return;
    let disposed = false;
    void Promise.all([
      apiFetch<PrivacySettings>("/api/privacy/settings", credential),
      apiFetch<BlockedPrivacyUser[]>("/api/privacy/blocked-users", credential),
    ]).then(([settings, blockedUsers]) => {
      if (disposed) return;
      setPrivacySettings(settings);
      setBlockedPrivacyUsers(blockedUsers);
    }).catch((error: unknown) => {
      if (!disposed) setToast(error instanceof Error ? error.message : "Privacy settings could not be loaded.");
    });
    return () => { disposed = true; };
  }, [credential, identity?.sub]);
  const [quoteText, setQuoteText] = useState("");
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [pdfArtifactUrl, setPdfArtifactUrl] = useState("");
  const [roomActivities, setRoomActivities] = useState<Record<string, { name: string; activity: string }>>({});

  useEffect(() => { threadsRef.current = threads; }, [threads]);
  useEffect(() => { voiceSubsRef.current = voiceSubs; }, [voiceSubs]);
  useEffect(() => {
    setMessageSelectionMode(false);
    setSelectedMessageIds([]);
  }, [threadId, room?.id]);
  useEffect(() => {
    if (!pdfArtifactUrl) return;
    return () => URL.revokeObjectURL(pdfArtifactUrl);
  }, [pdfArtifactUrl]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    const closeHeaderMenu = () => {
      setHeaderMenuOpen(false);
      setPrivacyMenuOpen(false);
    };
    const closeIfOutside = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".header-actions-menu, .privacy-mode-selector")) return;
      closeHeaderMenu();
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeHeaderMenu();
        setPrivacyMenuOpen(false);
        setMobileSidebarOpen(false);
      }
      if (event.target instanceof Element && event.target.closest(".omni-composer")) {
        closeHeaderMenu();
        window.dispatchEvent(new Event("genie:close-sidebar-menu"));
      }
    };
    const closeOnComposerFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest(".omni-composer")) {
        closeHeaderMenu();
        window.dispatchEvent(new Event("genie:close-sidebar-menu"));
      }
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("touchstart", closeIfOutside);
    document.addEventListener("keydown", closeOnKeyDown);
    document.addEventListener("focusin", closeOnComposerFocus);
    window.addEventListener("genie:close-header-menu", closeHeaderMenu);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("touchstart", closeIfOutside);
      document.removeEventListener("keydown", closeOnKeyDown);
      document.removeEventListener("focusin", closeOnComposerFocus);
      window.removeEventListener("genie:close-header-menu", closeHeaderMenu);
    };
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
        sessionStorage.removeItem(ADMIN_LOCAL_VERIFIED_CREDENTIAL_STORAGE_KEY);
      }
      const hint = localStorage.getItem("genie_returning_email") || "";
      setLoginEmail(hint);
      const savedVoice = localStorage.getItem(LOCAL_VOICE_STORAGE);
      setSelectedVoiceId(isGenieVoiceId(savedVoice) ? savedVoice : "genie-assistant");
      const draftText = localStorage.getItem("genie_registration_draft");
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
            setRegistration((current) => ({ ...current, ...restoredDraft }));
          }
        } catch {
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
            const registrationDraft = registrationRef.current;
            setRegistration((current) => ({
              ...current,
              email: decoded.email,
              full_name: registrationDraft.full_name.trim() || decoded.name,
              phone: registrationDraft.phone,
              city_region: registrationDraft.city_region,
            }));
            setAuthError("");
            const phoneDigits = registrationDraft.phone.replace(/\D/g, "");
            const completeRegistration = Boolean(
              registrationDraft.full_name.trim()
              && registrationDraft.city_region.trim()
              && /^\+[0-9\s().-]+$/.test(registrationDraft.phone)
              && phoneDigits.length >= 7
              && phoneDigits.length <= 15,
            );
            if (completeRegistration) {
              const draft = {
                full_name: registrationDraft.full_name.trim(),
                phone: registrationDraft.phone.trim(),
                city_region: registrationDraft.city_region.trim(),
              };
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
        theme: "outline", size: "large", text: "continue_with", shape: "pill", width: "320",
      });
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
    if (identity.sub === "local-development") {
      setThreads([]);
      setDeletedThreads([]);
      setLibrary([]);
      setRooms([]);
      setFriendRequests([]);
      setOutgoingFriendRequests([]);
      setOutgoingFriendRequests([]);
      setFriends([]);
      setLoadedThreadsFor(identity.sub);
      setAccountStatus("ready");
      return;
    }
    const savedVoice = localStorage.getItem(userStorageKey(LOCAL_VOICE_STORAGE, identity.sub));
    if (isGenieVoiceId(savedVoice)) {
      setSelectedVoiceId(savedVoice);
      setProfilePreferences((current) => ({ ...current, selected_voice_id: savedVoice }));
    }
    const localThreads = cleanRecentThreads(readStored<ThreadRecord[]>(userStorageKey(THREAD_STORAGE, identity.sub), []));
    localStorage.setItem(userStorageKey(THREAD_STORAGE, identity.sub), JSON.stringify(localThreads));
    setThreads(localThreads);
    setDeletedThreads(readStored<DeletedThreadRecord[]>(userStorageKey(TRASH_STORAGE, identity.sub), []));
    setLibrary(readStored<SavedItem[]>(userStorageKey(LIBRARY_STORAGE, identity.sub), []));
    const localRooms = cleanRecentRooms(readStored<Room[]>(userStorageKey(LOCAL_ROOMS_STORAGE, identity.sub), []));
    localStorage.setItem(userStorageKey(LOCAL_ROOMS_STORAGE, identity.sub), JSON.stringify(localRooms));
    const localRequests = readStored<FriendRequestItem[]>(userStorageKey(LOCAL_REQUESTS_STORAGE, identity.sub), []);
    const localOutgoingRequests = readStored<OutgoingFriendRequestItem[]>(userStorageKey("genie_local_outgoing_friend_requests", identity.sub), []);
    const localFriends = readStored<FriendItem[]>(userStorageKey(LOCAL_FRIENDS_STORAGE, identity.sub), []);
    const localProfile = readStored<Partial<ProfileResponse>>(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), {});
    setRooms(localRooms);
    setFriendRequests(localRequests);
    setOutgoingFriendRequests(localOutgoingRequests);
    setFriends(localFriends);
    setLoadedThreadsFor(identity.sub);
    void Promise.all([
      apiFetch<Room[]>("/api/rooms", credential).catch(() => [] as Room[]),
      apiFetch<FriendRequestItem[] | { requests?: FriendRequestItem[] }>("/api/social/requests", credential)
        .then((result) => Array.isArray(result) ? result : result.requests || [])
        .catch(() => [] as FriendRequestItem[]),
      apiFetch<OutgoingFriendRequestItem[]>("/api/social/requests/outgoing", credential).catch(() => [] as OutgoingFriendRequestItem[]),
      apiFetch<FriendItem[]>("/api/social/friends", credential).catch(() => [] as FriendItem[]),
      apiFetch<ProfileResponse>("/api/profile", credential).catch((): ProfileResponse => ({
        email: identity.email, user_name: identity.name, display_name: identity.name,
        registration_complete: false, geo_region_hash: null, friend_circle_mode: "mutuals_only",
        lookup_visibility: "mutual_contacts_only", allow_broader_discovery: false,
        default_dialect: "en-IN", presence_override: "online", telemetry_enabled: false,
        bio: "", city_region: "", custom_picture_data: null, profile_visibility: "mutuals",
        presence_visibility: "mutuals", directory_visibility: "mutuals", preview_profile: false,
      })),
    ]).then(([roomList, requests, outgoingRequests, friendList, profile]) => {
      const mergedProfile = { ...profile, ...localProfile };
      const storedSocialProfile = profile.profile_completed !== undefined ? profile : mergedProfile;
      setSocialProfile({
        user_id: identity.sub,
        email: storedSocialProfile.email || identity.email,
        username: storedSocialProfile.username || null,
        display_name: storedSocialProfile.display_name || storedSocialProfile.user_name || identity.name,
        avatar_data_url: storedSocialProfile.avatar_data_url || storedSocialProfile.custom_picture_data || storedSocialProfile.picture_url || null,
        bio: storedSocialProfile.bio || "",
        skills_offered: storedSocialProfile.skills_offered || [],
        discoverable: Boolean(storedSocialProfile.discoverable),
        profile_completed: Boolean(storedSocialProfile.profile_completed),
      });
      const profileVoice = mergedProfile.selected_voice_id;
      if (isGenieVoiceId(profileVoice)) {
        setSelectedVoiceId(profileVoice);
        localStorage.setItem(userStorageKey(LOCAL_VOICE_STORAGE, identity.sub), profileVoice);
      }
      setRooms(Array.from(new Map([...localRooms, ...cleanRecentRooms(roomList)].map((item) => [item.id, item] as const)).values()));
      setFriendRequests(Array.from(new Map([...localRequests, ...requests].map((item) => [item.id, item] as const)).values()));
      setOutgoingFriendRequests(Array.from(new Map([...localOutgoingRequests, ...outgoingRequests].map((item) => [item.id, item] as const)).values()));
      setFriends(Array.from(new Map([...localFriends, ...friendList].map((item) => [item.user_sub, item] as const)).values()));
      setProfilePreferences({
        ...mergedProfile,
        telemetry_enabled: Boolean(mergedProfile.telemetry_enabled),
      });
      setProfileDetails({
        display_name: storedSocialProfile.display_name || storedSocialProfile.user_name || identity.name,
        bio: storedSocialProfile.bio || "",
        city_region: mergedProfile.city_region || "",
        custom_picture_data: storedSocialProfile.avatar_data_url || storedSocialProfile.custom_picture_data || null,
        profile_visibility: mergedProfile.profile_visibility || "mutuals",
        presence_visibility: mergedProfile.presence_visibility || "mutuals",
        directory_visibility: mergedProfile.directory_visibility || "mutuals",
        default_dialect: mergedProfile.default_dialect || "en-IN",
        preview_profile: Boolean(mergedProfile.preview_profile),
      });
      setIdentity((current) => current ? {
        ...current,
        name: storedSocialProfile.display_name || storedSocialProfile.user_name || current.name,
        picture: storedSocialProfile.avatar_data_url || storedSocialProfile.custom_picture_data || storedSocialProfile.picture_url || current.picture,
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
          setRoomVoiceDialect(joined.voice_dialect || "en-IN");
          setRoomKey(key);
          window.history.replaceState(null, "", `/?join=${encodeURIComponent(joined.id)}#key=${encodeURIComponent(key)}`);
        }).catch((error: unknown) => setRoomStatus(error instanceof Error ? error.message : "Room invitation failed."));
      } else {
        const roomId = params.get("join") || params.get("room");
        const savedRoomKey = roomId ? localStorage.getItem(`genie_room_key_${roomId}`) : null;
        const existing = roomId ? roomList.find((candidate) => candidate.id === roomId) : undefined;
        if (existing && savedRoomKey) {
          setRoom(existing);
          setRoomVoiceDialect(existing.voice_dialect || "en-IN");
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
    if (!statusCredential.trim() || !statusSubject || statusSubject === "local-development") return;
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
        .catch(() => {
          if (!disposed) {
            setAIAvailability(null);
            setAIAvailabilityError("");
          }
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [credential ?? "", identity?.sub ?? ""]);

  useEffect(() => {
    if (identity?.sub && loadedThreadsFor === identity.sub) {
      const cleaned = cleanRecentThreads(threads);
      if (cleaned.length !== threads.length) setThreads(cleaned);
      localStorage.setItem(userStorageKey(THREAD_STORAGE, identity.sub), JSON.stringify(cleaned));
    }
  }, [identity?.sub, loadedThreadsFor, threads]);
  useEffect(() => {
    if (identity?.sub && loadedThreadsFor === identity.sub) {
      localStorage.setItem(userStorageKey(TRASH_STORAGE, identity.sub), JSON.stringify(deletedThreads));
    }
  }, [identity?.sub, loadedThreadsFor, deletedThreads]);
  useEffect(() => {
    if (identity?.sub && loadedThreadsFor === identity.sub) {
      localStorage.setItem(userStorageKey(LIBRARY_STORAGE, identity.sub), JSON.stringify(library));
    }
  }, [identity?.sub, loadedThreadsFor, library]);
  useEffect(() => {
    if (!identity?.sub || loadedThreadsFor !== identity.sub) return;
    const cleaned = cleanRecentRooms(rooms);
    if (cleaned.length !== rooms.length) setRooms(cleaned);
    localStorage.setItem(userStorageKey(LOCAL_ROOMS_STORAGE, identity.sub), JSON.stringify(cleaned));
    localStorage.setItem(userStorageKey(LOCAL_REQUESTS_STORAGE, identity.sub), JSON.stringify(friendRequests));
    localStorage.setItem(userStorageKey("genie_local_outgoing_friend_requests", identity.sub), JSON.stringify(outgoingFriendRequests));
    localStorage.setItem(userStorageKey(LOCAL_FRIENDS_STORAGE, identity.sub), JSON.stringify(friends));
  }, [identity?.sub, loadedThreadsFor, rooms, friendRequests, outgoingFriendRequests, friends]);

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
          if (incoming.type === "friend_request_received" && incoming.request_id && incoming.sender) {
            const requestId = incoming.request_id;
            const sender = incoming.sender;
            const senderSub = sender.user_sub || sender.id;
            if (senderSub) {
              setFriendRequests((current) => current.some((request) => request.id === requestId)
                ? current
                : [{
                  id: requestId,
                  sender_sub: senderSub,
                  sender_name: sender.name || "Genie member",
                  sender_username: sender.username || "",
                }, ...current]);
            }
            return;
          }
          if (incoming.type === "friend_request_accepted") {
            setOutgoingFriendRequests((current) => current.filter((request) => request.id !== incoming.request_id));
            await refreshSocial();
            return;
          }
          if (incoming.type === "history" && incoming.messages) {
            if (incoming.voice_dialect) setRoomVoiceDialect(incoming.voice_dialect);
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
            for (const response of incoming.ai_responses || []) {
              try {
                const payload = await decryptRoomMessage(roomKeyRef.current, response.ciphertext) as {
                  content?: unknown;
                  response_type?: unknown;
                };
                if (typeof payload.content !== "string") continue;
                const isLiveCallResponse = payload.response_type === "live_call";
                decoded.push({
                  id: response.id,
                  role: "assistant",
                  content: payload.content,
                  sender_sub: response.owner_sub,
                  sender_name: isLiveCallResponse
                    ? "Genie · Live call"
                    : response.owner_sub === identity?.sub ? "You · Genie" : "Room member · Genie",
                  sent_at: response.ai_responded_at || response.created_at,
                  is_group_shared_ai_response: true,
                  is_live_call_response: isLiveCallResponse,
                });
              } catch {
                setRoomStatus("A shared AI response could not be decrypted on this device.");
              }
            }
            decoded.sort((left, right) => (left.sent_at || "").localeCompare(right.sent_at || ""));
            setMessages(decoded);
            setReactionCounts(incoming.reaction_counts || {});
          } else if (
            incoming.type === "ai_response.shared"
            && incoming.id && incoming.owner_sub && incoming.ciphertext
          ) {
            const payload = await decryptRoomMessage(roomKeyRef.current, incoming.ciphertext) as {
              content?: unknown;
              response_type?: unknown;
            };
            if (typeof payload.content === "string") {
              const isLiveCallResponse = payload.response_type === "live_call";
              const sharedResponse: ChatMessage = {
                id: incoming.id,
                role: "assistant",
                content: payload.content,
                sender_sub: incoming.owner_sub,
                sender_name: isLiveCallResponse
                  ? "Genie · Live call"
                  : incoming.owner_sub === identity?.sub
                  ? "You · Genie"
                  : `${incoming.sender_name || "Room member"} · Genie`,
                sent_at: incoming.ai_responded_at || incoming.created_at,
                is_group_shared_ai_response: true,
                is_live_call_response: isLiveCallResponse,
              };
              setMessages((current) => current.some((message) => message.id === sharedResponse.id)
                ? current.map((message) => message.id === sharedResponse.id ? sharedResponse : message)
                : [...current, sharedResponse].sort((left, right) => (left.sent_at || "").localeCompare(right.sent_at || "")));
            }
          } else if (incoming.type === "ai_response.unshared" && incoming.id) {
            if (incoming.owner_sub === identity?.sub) {
              setMessages((current) => current.map((message) => message.id === incoming.id
                ? { ...message, is_group_shared_ai_response: false }
                : message));
            } else {
              setMessages((current) => current.filter((message) => message.id !== incoming.id));
            }
            setReactionCounts((current) => {
              const next = { ...current };
              delete next[`ai_response:${incoming.id}`];
              return next;
            });
          } else if (incoming.type === "messages.deleted" && Array.isArray(incoming.message_ids)) {
            const deletedIds = new Set(incoming.message_ids.filter((id: unknown): id is string => typeof id === "string"));
            setMessages((current) => current.filter((message) => !deletedIds.has(message.id)));
            setReactionCounts((current) => {
              const next = { ...current };
              for (const id of deletedIds) {
                delete next[`user_message:${id}`];
                delete next[`ai_response:${id}`];
              }
              return next;
            });
          } else if (
            incoming.type === "message.reaction"
            && incoming.message_id && incoming.target_type && incoming.counts
          ) {
            setReactionCounts((current) => ({
              ...current,
              [`${incoming.target_type}:${incoming.message_id}`]: incoming.counts!,
            }));
          } else if (incoming.type === "notification.created" && typeof incoming.message === "string") {
            setToast(incoming.message);
          } else if (
            (incoming.type === "message.new" || incoming.type === "message.ack")
            && incoming.message && typeof incoming.message === "object"
          ) {
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
                const wakePhrase = /\b(?:hey\s+genie|ok(?:ay)?\s+genie|genie)\b/i;
                if (
                  room && voiceSubsRef.current.length > 0 && !decoded.is_secret
                  && wakePhrase.test(decoded.content)
                  && !wakeMessageIdsRef.current.has(decoded.id)
                ) {
                  wakeMessageIdsRef.current.add(decoded.id);
                  void sendMessageRef.current(
                    `Answer this peer's wake request: ${decoded.content}`,
                    false,
                    undefined,
                    "genie-pro",
                    "pro",
                    "agent",
                    decoded,
                    true,
                    profilePreferences.default_dialect,
                  );
                }
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
          } else if (incoming.type === "token.cooldown" && incoming.user_sub && incoming.cooldown_until) {
            if (incoming.user_sub !== identity?.sub) {
              setRoomCooldownNotice({
                userSub: incoming.user_sub,
                userName: incoming.user_name || "A room member",
                cooldownUntil: incoming.cooldown_until,
              });
            }
          } else if (incoming.type === "token.shared" && incoming.recipient_sub) {
            setRoomCooldownNotice((current) => current?.userSub === incoming.recipient_sub ? null : current);
            if (incoming.recipient_sub === identity?.sub) {
              setTokenCooldown(null);
              setRoomCooldownNotice(null);
              setToast(`${incoming.sender_name || "A room member"} shared energy with you.`);
            } else if (incoming.sender_sub === identity?.sub) {
              setToast(`Shared ${incoming.amount || 0} energy with ${incoming.recipient_name || "your room member"}.`);
            }
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
            if (incoming.online) {
              void apiFetch<RoomPerson[]>(`/api/rooms/${encodeURIComponent(room.id)}/members`, credential)
                .then((roomMembers) => {
                  setMembers(roomMembers);
                  setRooms((current) => current.map((item) => item.id === room.id
                    ? {
                        ...item,
                        member_count: roomMembers.length,
                        auto_saved: Boolean(item.auto_saved || roomMembers.length >= 2),
                      }
                    : item));
                })
                .catch(() => setRoomStatus("Room member updates could not be refreshed."));
            }
          } else if (incoming.type === "call.signal" && incoming.from_sub && incoming.payload) {
            setCallSignal({ from_sub: incoming.from_sub, payload: incoming.payload });
          } else if (incoming.type === "ROOM_VOICE_CONFIG_UPDATE" && incoming.voice_dialect) {
            setRoomVoiceDialect(incoming.voice_dialect);
            setRoom((current) => current
              ? { ...current, voice_dialect: incoming.voice_dialect }
              : current);
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
    if (!credential || !identity?.sub) return;
    let disposed = false;
    const checkIncomingRequests = async () => {
      try {
        const requestResult = await apiFetch<FriendRequestItem[] | { requests?: FriendRequestItem[] }>("/api/social/requests", credential);
        const requests = Array.isArray(requestResult) ? requestResult : requestResult.requests || [];
        if (disposed) return;
        if (friendRequestNoticeInitialized.current) {
          const newRequest = requests.find((request) => !friendRequestIdsRef.current.has(request.id));
          if (newRequest) {
            setToast(`Friend request received from ${newRequest.sender_name}.`);
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("Friend request received", { body: `${newRequest.sender_name} wants to connect.` });
            }
          }
        }
        friendRequestNoticeInitialized.current = true;
        friendRequestIdsRef.current = new Set(requests.map((request) => request.id));
        setFriendRequests(requests);
      } catch {
        // Polling is best-effort; the Friends view reports actionable request errors.
      }
    };
    void checkIncomingRequests();
    const timer = window.setInterval(() => void checkIncomingRequests(), 10_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [credential, identity?.sub]);

  useEffect(() => {
    if (!room?.group_slot || members.length < 2 || !identity?.sub) return;
    const activeGroupsKey = userStorageKey("genie_active_group_chats", identity.sub);
    const activeGroups = readStored<number[]>(activeGroupsKey, []);
    if (!activeGroups.includes(room.group_slot)) {
      localStorage.setItem(activeGroupsKey, JSON.stringify([...activeGroups, room.group_slot]));
    }
    setRooms((current) => current.map((item) => item.id === room.id
      ? { ...item, member_count: members.length, auto_saved: true }
      : item));
  }, [room?.id, room?.group_slot, members.length, identity?.sub]);

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
    if (!isMounted || !identity?.sub) return;
    const storageKey = `genie_temporary_chat_${encodeURIComponent(identity.sub)}`;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { mode?: TemporaryChatMode; messages?: ChatMessage[] };
      if (
        (parsed.mode === "personalized" || parsed.mode === "unpersonalized")
        && Array.isArray(parsed.messages)
      ) {
        setRoom(null);
        setRoomKey("");
        setThreadId("");
        setTemporaryChatMode(parsed.mode);
        setTemporaryChatActive(true);
        setMessages(parsed.messages.slice(-40));
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }, [identity?.sub, isMounted]);

  useEffect(() => {
    if (!temporaryChatActive || !temporaryChatMode || !identity?.sub) return;
    const localMessages = messages
      .filter((message) => !message.is_secret && message.chat_mode !== "private_ai" && !message.content.includes(SECRET_MARKER))
      .slice(-40)
      .map(({ attachment: _attachment, ...message }) => message);
    try {
      sessionStorage.setItem(
        `genie_temporary_chat_${encodeURIComponent(identity.sub)}`,
        JSON.stringify({ mode: temporaryChatMode, messages: localMessages }),
      );
    } catch (error) {
      setToast(error instanceof Error ? "Temporary chat could not be saved in this browser session." : "Temporary chat storage is unavailable.");
    }
  }, [temporaryChatActive, temporaryChatMode, identity?.sub, messages]);

  useEffect(() => {
    if (temporaryChatActive || !threadId || room || !messages.length) return;
    const archivedMessages = messages
      .filter((message) => !message.is_secret && message.chat_mode !== "private_ai" && !message.content.includes(SECRET_MARKER))
      .slice(-60)
      .map(({ attachment: _attachment, ...message }) => message);
    if (!archivedMessages.length) return;
    const firstUser = archivedMessages.find((message) => message.role === "user");
    const title = firstUser?.content.trim().slice(0, 48) || "Image conversation";
    setThreads((current) => {
      const existing = current.find((item) => item.id === threadId);
      const updated: ThreadRecord = { id: threadId, title, messages: archivedMessages };
      const next = [updated, ...current.filter((item) => item.id !== threadId)].slice(0, 60);
      if (JSON.stringify(existing) !== JSON.stringify(updated)) return next;
      return current;
    });
  }, [threadId, room, messages, temporaryChatActive]);

  function startNewChat() {
    setTemporaryChatActive(false);
    setTemporaryChatMode(null);
    setChatMode("ai_room");
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
    setTemporaryChatActive(false);
    setTemporaryChatMode(null);
    setChatMode("ai_room");
    setRoom(null);
    setRoomKey("");
    setThreadId(id);
    setMessages(selected.messages);
    setView("chat");
    setSearchOpen(false);
  }

  function deleteThread(id: string) {
    const thread = threadsRef.current.find((item) => item.id === id);
    if (!thread) return;
    setThreads((current) => current.filter((item) => item.id !== id));
    setDeletedThreads((current) => [
      { ...thread, deleted_at: new Date().toISOString() },
      ...current.filter((item) => item.id !== id),
    ]);
    if (threadId === id) {
      setThreadId("");
      setMessages([]);
    }
  }

  function renameThread(id: string) {
    const thread = threadsRef.current.find((item) => item.id === id);
    if (!thread) return;
    const title = window.prompt("Rename chat", thread.title)?.trim();
    if (!title || title === thread.title) return;
    setThreads((current) => current.map((item) => item.id === id ? { ...item, title } : item));
  }

  function pinThread(id: string) {
    setThreads((current) => current
      .map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item)
      .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))));
  }

  function restoreThread(id: string) {
    const deleted = deletedThreads.find((item) => item.id === id);
    if (!deleted) return;
    const { deleted_at: _deletedAt, ...thread } = deleted;
    setThreads((current) => [thread, ...current.filter((item) => item.id !== id)]);
    setDeletedThreads((current) => current.filter((item) => item.id !== id));
  }

  function permanentlyDeleteThread(id: string) {
    setDeletedThreads((current) => current.filter((item) => item.id !== id));
  }

  function clearCurrentChat() {
    if (room) {
      setToast("Room history is shared. Use room privacy controls to manage shared messages.");
      return;
    }
    if (threadId) deleteThread(threadId);
    else setMessages([]);
  }

  function enterMessageSelection(messageId?: string) {
    setMessageSelectionMode(true);
    setSelectedMessageIds(messageId ? [messageId] : []);
  }

  function toggleMessageSelection(messageId: string) {
    setSelectedMessageIds((current) => current.includes(messageId)
      ? current.filter((id) => id !== messageId)
      : [...current, messageId]);
  }

  function selectAllDeletableMessages() {
    const currentSub = identity?.sub;
    setSelectedMessageIds(messages
      .filter((message) => !room
        || Boolean(currentSub && (message.sender_sub === currentSub || message.owner_sub === currentSub)))
      .map((message) => message.id));
  }

  function cancelMessageSelection() {
    setMessageSelectionMode(false);
    setSelectedMessageIds([]);
  }

  async function deleteSelectedMessages() {
    const ids = new Set(selectedMessageIds);
    if (!ids.size) return;
    try {
      if (room) {
        const persistedIds = messages
          .filter((message) => ids.has(message.id)
            && (message.role === "user" || message.is_group_shared_ai_response))
          .map((message) => message.id);
        if (persistedIds.length) {
          await apiFetch(`/api/rooms/${room.id}/messages/delete`, credential, {
            method: "POST",
            body: JSON.stringify({ message_ids: persistedIds }),
          });
        }
      }
      setMessages((current) => current.filter((message) => !ids.has(message.id)));
      cancelMessageSelection();
      setToast(`Deleted ${ids.size} selected message${ids.size === 1 ? "" : "s"}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Selected messages could not be deleted.");
    }
  }

  function importChatBackup(snapshot: BackupSnapshot) {
    const sortMessages = (items: ChatMessage[]) => Array.from(
      new Map(items.map((message) => [message.id, message] as const)).values(),
    ).sort((left, right) => (left.sent_at || "").localeCompare(right.sent_at || ""));
    const importedThreads: ThreadRecord[] = snapshot.threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      messages: sortMessages(thread.messages as ChatMessage[]),
    }));
    if (!importedThreads.length && snapshot.active_messages.length) {
      importedThreads.push({
        id: crypto.randomUUID(),
        title: snapshot.active_messages.find((message) => message.role === "user")?.content.slice(0, 48) || "Restored chat",
        messages: sortMessages(snapshot.active_messages as ChatMessage[]),
      });
    }
    setThreads((current) => {
      const merged = new Map(current.map((thread) => [thread.id, thread]));
      for (const thread of importedThreads) {
        const existing = merged.get(thread.id);
        merged.set(thread.id, existing
          ? { ...thread, messages: sortMessages([...existing.messages, ...thread.messages]) }
          : thread);
      }
      return Array.from(merged.values()).sort((left, right) => {
        const leftDate = left.messages.at(-1)?.sent_at || "";
        const rightDate = right.messages.at(-1)?.sent_at || "";
        return rightDate.localeCompare(leftDate);
      });
    });
    setDeletedThreads((current) => current.filter(
      (thread) => !importedThreads.some((item) => item.id === thread.id),
    ));
    if (importedThreads.length) {
      const selected = importedThreads[0];
      const existing = threads.find((thread) => thread.id === selected.id);
      const selectedMessages = sortMessages([...(existing?.messages || []), ...selected.messages]);
      setThreadId(selected.id);
      setMessages(selectedMessages);
      setRoom(null);
      setRoomKey("");
      setView("chat");
    } else {
      setMessages((current) => sortMessages([...current, ...snapshot.active_messages as ChatMessage[]]));
    }
    setToast("Backup messages merged into your local chat history.");
  }

  function endTemporaryChat() {
    if (identity) {
      try {
        sessionStorage.removeItem(`genie_temporary_chat_${encodeURIComponent(identity.sub)}`);
      } catch {
        setToast("Temporary chat session storage could not be cleared.");
      }
    }
    setTemporaryChatActive(false);
    setTemporaryChatMode(null);
    setMessages([]);
    setThreadId(crypto.randomUUID());
  }

  async function distributeRoomInvite(link: URL, passcode?: string, inviteText?: string) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Personal AI Genie encrypted room",
          text: inviteText || `Join my encrypted Personal AI Genie room: ${link.toString()}${passcode ? `\nPasscode: ${passcode}` : ""}`,
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

  async function transcribeVoiceAudio(dataUrl: string, dialect: string): Promise<string> {
    if (!credential) throw new Error("Sign in before transcribing a voice note.");
    const [header, audioBase64] = dataUrl.split(",", 2);
    const mimeType = header?.match(/^data:([^;]+)/)?.[1] || "audio/webm";
    const result = await apiFetch<{ text: string }>("/api/voice/stt", credential, {
      method: "POST",
      body: JSON.stringify({ audio_base64: audioBase64, mime_type: mimeType, dialect }),
    });
    return result.text;
  }

  async function createRoom(groupSlot?: number) {
    if (!credential) return;
    if (groupSlot !== undefined) {
      const existing = rooms.find((candidate) => candidate.group_slot === groupSlot);
      if (existing) {
        await openRoom(existing.id);
        return;
      }
    }
    const invite = randomToken(32);
    const key = randomToken(32);
    const passcode = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const localRoomId = `local-${crypto.randomUUID()}`;
    const created = await apiFetchWithFallback<Room>("/api/rooms", credential, {
      method: "POST",
      body: JSON.stringify({
        name: groupSlot === undefined ? "Private room" : `Group ${groupSlot}`,
        invite_code: invite,
        passcode,
        max_uses: 20,
        ...(groupSlot === undefined ? {} : { group_slot: groupSlot }),
      }),
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
    const fullRoom = {
      ...roomData,
      owner_sub: identity?.sub,
      voice_dialect: "en-IN",
      member_count: 1,
      group_slot: groupSlot,
      auto_saved: false,
    };
    setRooms((current) => [fullRoom, ...current.filter((item) => item.id !== fullRoom.id)]);
    setMessages([]);
    setRoom(fullRoom);
    setRoomVoiceDialect("en-IN");
    setRoomKey(key);
    setThreadId("");
    setView("chat");
    setInviteLink(roomInviteUrl(roomId, key, invite, groupSlot));
    setInvitePasscode(passcode);
    setInviteOpen(true);
  }

  async function regenerateRoomInvite(customInviteCode: string) {
    if (!room || !credential) throw new Error("Open a connected group before regenerating its invite.");
    const currentInvite = localStorage.getItem(`genie_room_invite_${room.id}`);
    const key = localStorage.getItem(`genie_room_key_${room.id}`);
    const passcode = localStorage.getItem(`genie_room_passcode_${room.id}`);
    if (!currentInvite || !key || !passcode) {
      throw new Error("This device does not have the current room invite credentials.");
    }
    const result = await apiFetch<{ invite_code: string; passcode: string }>(
      `/api/rooms/${encodeURIComponent(room.id)}/invites`,
      credential,
      {
        method: "POST",
        body: JSON.stringify({
          replace_invite_code: currentInvite,
          max_uses: 4,
          passcode,
          ...(customInviteCode ? { custom_invite_code: customInviteCode } : {}),
        }),
      },
    );
    localStorage.setItem(`genie_room_invite_${room.id}`, result.invite_code);
    localStorage.setItem(`genie_room_passcode_${room.id}`, result.passcode);
    setInviteLink(roomInviteUrl(room.id, key, result.invite_code, room.group_slot));
    setInvitePasscode(result.passcode);
  }

  async function respondGroupInvitation(invitationId: string, accept: boolean) {
    if (!credential) return;
    try {
      const result = await apiFetch<{ room_id: string; accepted: boolean }>(
        `/api/group-invitations/${encodeURIComponent(invitationId)}/respond`,
        credential,
        { method: "POST", body: JSON.stringify({ accept }) },
      );
      setPendingGroupInvitations((current) => current.filter((item) => item.id !== invitationId));
      if (result.accepted) {
        const refreshedRooms = await apiFetch<Room[]>("/api/rooms", credential);
        setRooms(refreshedRooms);
        await openRoom(result.room_id);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Group invitation could not be updated.");
    }
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
    setRoomVoiceDialect(joined.voice_dialect || "en-IN");
    setRoomKey(secretKey);
    setMessages([]);
    setThreadId("");
    setView("chat");
    window.history.replaceState(null, "", `/?join=${encodeURIComponent(joined.id)}#key=${encodeURIComponent(secretKey)}`);
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
    setRoomVoiceDialect(selected.voice_dialect || "en-IN");
    setRoomKey(key);
    setThreadId("");
    setView("chat");
    window.history.replaceState(null, "", `/?join=${encodeURIComponent(id)}#key=${encodeURIComponent(key)}`);
  }

  async function shareRoomEnergy(recipientSub: string, amount: number) {
    if (!room || !credential) return;
    try {
      await apiFetch(`/api/rooms/${room.id}/share-tokens`, credential, {
        method: "POST",
        body: JSON.stringify({ recipient_sub: recipientSub, amount }),
      });
      setToast("Room energy shared.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Room energy could not be shared.");
    }
  }

  async function shareRoomAiResponse(responseId: string, content: string, liveCallResponse = false) {
    if (!room || !credential || !roomKeyRef.current) return;
    try {
      const ciphertext = await encryptRoomMessage(roomKeyRef.current, {
        content,
        ...(liveCallResponse ? { response_type: "live_call", speaker: "Genie" } : {}),
      });
      const result = await apiFetch<{ ai_responded_at: string }>(
        `/api/rooms/${encodeURIComponent(room.id)}/ai-responses/${encodeURIComponent(responseId)}/share`,
        credential,
        { method: "POST", body: JSON.stringify({ ciphertext }) },
      );
      setMessages((current) => current.map((message) => message.id === responseId
        ? {
            ...message,
            sent_at: result.ai_responded_at,
            sender_sub: identity?.sub,
            sender_name: liveCallResponse ? "Genie · Live call" : "You · Genie",
            is_group_shared_ai_response: true,
            is_live_call_response: liveCallResponse,
          }
        : message));
    } catch (error) {
      setToast(error instanceof Error
        ? `The response stayed private because room sharing failed: ${error.message}`
        : "The response stayed private because room sharing failed.");
    }
  }

  async function sendMessage(
    text: string,
    secret: boolean,
    attachment?: Attachment & { document_data?: { name: string; mime_type: string; data: string } },
    model = "genie-pro",
    thinkingLevel = "pro",
    target: SubmitTarget = "agent",
    transcriptContext?: ChatMessage,
    voiceReply = false,
    voiceDialect?: string,
    regenerate?: { prompt: ChatMessage; responseId: string; visibility: "private" | "group"; context: ChatMessage[] },
    requestChatMode: ChatMode = "ai_room",
    liveCallResponse = false,
  ) {
    if (!identity || !credential) return;
    const content = secret ? `${SECRET_MARKER}${text}` : text;
    const timestamp = new Date().toISOString();
    if (!room && !threadId && !temporaryChatActive && requestChatMode !== "private_ai") setThreadId(crypto.randomUUID());
    const userMessage: ChatMessage = regenerate?.prompt || {
      id: crypto.randomUUID(), role: "user", content: text, is_secret: secret,
      chat_mode: requestChatMode,
      sender_sub: identity.sub,
      attachment: attachment ? { mime_type: attachment.mime_type, data: attachment.data } : undefined,
      tick_status: "sent", sent_at: timestamp,
    };
    if (!regenerate) setMessages((current) => [...current, userMessage]);

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
          chat_mode: requestChatMode,
          attachment: attachment ? { mime_type: attachment.mime_type, data: attachment.data } : undefined,
        });
        socket.send(JSON.stringify({ type: "message.send", ciphertext, is_secret: secret, client_id: userMessage.id }));
      } catch {
        setRoomStatus("Message encryption failed. Nothing was sent.");
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
      }
      return;
    }

    if (room && requestChatMode === "ai_room") {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !roomKeyRef.current) {
        setRoomStatus("Room is not connected. Your prompt was not sent.");
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        return;
      }
      try {
        const ciphertext = await encryptRoomMessage(roomKeyRef.current, {
          content,
          chat_mode: requestChatMode,
          attachment: attachment ? { mime_type: attachment.mime_type, data: attachment.data } : undefined,
        });
        socket.send(JSON.stringify({ type: "message.send", ciphertext, is_secret: false, client_id: userMessage.id }));
      } catch {
        setRoomStatus("Message encryption failed. Nothing was sent.");
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        return;
      }
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

    if (PHOTO_CREATION_INTENT.test(text) && PROHIBITED_PHOTO_CONTENT.test(text)) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: PHOTO_POLICY_MESSAGE,
        tick_status: "read_no_ai",
        sent_at: new Date().toISOString(),
      }]);
      return;
    }

    const context = [
      ...(regenerate ? regenerate.context : activeThreadMessages),
      ...(transcriptContext ? [transcriptContext] : []),
      ...(regenerate ? [] : [userMessage]),
    ]
      .filter((message) => message.role === "user" || message.role === "assistant")
      .filter((message) => message.chat_mode !== "private_ai")
      .filter((message) => !room || message.role === "user" || message.is_group_shared_ai_response)
      .filter((message) => !message.is_secret && !message.content.includes(SECRET_MARKER))
      .slice(-39)
      .map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.sender_name ? { sender: message.sender_name } : {}),
        ...(message.id === userMessage.id && attachment
          ? attachment.document_data
            ? { document_data: attachment.document_data }
            : { image_data: { mime_type: attachment.mime_type, data: attachment.data } }
          : {}),
      }));
    const assistantId = regenerate?.responseId || crypto.randomUUID();
    setMessages((current) => regenerate
      ? current.map((message) => message.id === assistantId
        ? { ...message, content: "", is_group_shared_ai_response: false }
        : message)
      : [...current, {
        id: assistantId,
        role: "assistant",
        content: "",
        sender_sub: identity.sub,
        chat_mode: requestChatMode,
      }]);
    setSending(true);
    const modelTier: "genie-pro" | "genie-lite" | "genie-master" = model === "genie-master"
      ? "genie-master"
      : model === "genie-lite"
        ? "genie-lite"
        : "genie-pro";
    const currentPrompt = [...context].reverse().find((item) => item.role === "user");
    const requestBody = {
      messages: context,
      message: currentPrompt?.content || text,
      history: context.slice(0, -1).map((item) => ({
        role: item.role,
        content: item.content,
        ...("sender" in item && item.sender ? { sender: item.sender } : {}),
      })),
      model: modelTier,
      model_tier: modelTier,
      room_mode: Boolean(room),
      room_members: room
        ? members.map((member) => member.user_sub)
        : [identity.sub],
      chat_mode: requestChatMode,
      thinking_level: thinkingLevel,
      user_name: profileDetails.display_name || identity.name,
      response_visibility: regenerate?.visibility || (room && requestChatMode === "ai_room" ? "group" : "private"),
      is_secret: false,
      room_id: room?.id,
    };

    try {
      const response = await apiRequest("/api/py/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
        body: JSON.stringify(requestBody),
        cache: "no-store",
      });

      if (!response.ok) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        const cooldown = getCooldownDetail(payload);
        if (response.status === 429 && cooldown) {
          setTokenCooldown(cooldown);
          setMessages((current) => current.filter((message) => message.id !== assistantId));
          setToast(cooldown.message);
          return;
        }
        const detail = payload && typeof payload === "object" && "detail" in payload
          ? payload.detail
          : undefined;
        const message = typeof detail === "string"
          ? detail
          : detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string"
            ? detail.message
            : `Chat request failed (${response.status}).`;
        setMessages((current) => current.map((item) => item.id === assistantId
          ? { ...item, content: `⚠️ ${message}` }
          : item));
        setToast(message);
        return;
      }

      const contentType = response.headers.get("content-type") || "";

      // Handle standard JSON response directly
      if (contentType.includes("application/json")) {
        const data = await response.json() as {
          reply?: string;
          response?: string;
          content?: string;
          message?: string;
          text?: string;
          detail?: string;
          sub_agents?: string[];
          proposed_memory?: ChatMessage["proposed_memory"];
          proposed_memory_id?: string;
          master_quota?: ChatMessage["master_quota"];
        };
        const replyText = data.reply || data.response || data.content || data.message || data.text;

        if (!replyText) {
          throw new Error("Chat response did not contain valid text.");
        }

        setMessages((current) => current.map((message) => message.id === assistantId
          ? {
              ...message,
              content: replyText,
              sub_agents: data.sub_agents,
              proposed_memory: data.proposed_memory,
              proposed_memory_id: data.proposed_memory_id,
              master_quota: data.master_quota,
            }
          : message));
        if (room && (requestChatMode === "ai_room" || regenerate?.visibility === "group")) {
          await shareRoomAiResponse(assistantId, replyText, liveCallResponse);
        }
        if (voiceReply && target === "agent" && !replyText.startsWith("🔒 Secret received.")) {
          void speakGenieReply(replyText, voiceDialect);
        }
      } else {
        // Handle streaming response if content-type is event-stream or body exists as a stream
        const reader = response.body?.getReader();
        if (!reader) {
          const textFallback = await response.text();
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: textFallback } : message));
          if (room && (requestChatMode === "ai_room" || regenerate?.visibility === "group")) {
            await shareRoomAiResponse(assistantId, textFallback, liveCallResponse);
          }
          if (voiceReply && target === "agent") void speakGenieReply(textFallback, voiceDialect);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let streamError = "";
        let spokenReply = "";
        let streamReceivedReply = false;

        const readFrames = (chunk: string) => {
          buffer += chunk;
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const eventType = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
            const dataLine = frame.match(/^data:\s*(.+)$/m)?.[1];
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine) as {
                text?: string;
                detail?: string;
                reply?: string;
                response?: string;
                content?: string;
                sub_agents?: string[];
                proposed_memory?: ChatMessage["proposed_memory"];
                proposed_memory_id?: string;
                master_quota?: ChatMessage["master_quota"];
              };
              const textVal = payload.text || payload.reply || payload.response || payload.content;
              if (eventType === "metadata" && (
                payload.sub_agents
                || payload.proposed_memory
                || payload.proposed_memory_id
                || payload.master_quota
              )) {
                setMessages((current) => current.map((message) => message.id === assistantId
                  ? {
                      ...message,
                      sub_agents: payload.sub_agents,
                      proposed_memory: payload.proposed_memory as ChatMessage["proposed_memory"],
                      proposed_memory_id: typeof payload.proposed_memory_id === "string" ? payload.proposed_memory_id : undefined,
                      master_quota: payload.master_quota,
                    }
                  : message));
              } else if ((eventType === "token" || eventType === "message") && textVal) {
                streamReceivedReply = true;
                spokenReply += textVal;
                setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + textVal } : message));
              } else if (eventType === "confirmation" && textVal) {
                streamReceivedReply = true;
                spokenReply = textVal;
                setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: textVal, tick_status: "yellow_no_ai" } : message));
              } else if (eventType === "error") {
                streamError = payload.detail || "AI provider request failed.";
              }
            } catch { /* JSON parse error on frame */ }
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          readFrames(decoder.decode(value, { stream: true }));
        }
        readFrames(decoder.decode());

        if (streamError) throw new Error(streamError);

        // If stream finished but accumulated no text, try parsing the whole body as plain text/JSON
        if (!streamReceivedReply || !spokenReply.trim()) {
          throw new Error("Chat stream ended before a reply arrived.");
        }
        if (room && (requestChatMode === "ai_room" || regenerate?.visibility === "group")) {
          await shareRoomAiResponse(assistantId, spokenReply, liveCallResponse);
        }
        if (voiceReply && target === "agent" && !spokenReply.startsWith("🔒 Secret received.")) {
          void speakGenieReply(spokenReply, voiceDialect);
        }
      }
    } catch {
      try {
        const fallbackResponse = await apiRequest("/api/py/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
          body: JSON.stringify(requestBody),
          cache: "no-store",
        });
        const responseText = await fallbackResponse.text();
        let parsedFallback: unknown;
        try {
          parsedFallback = JSON.parse(responseText) as unknown;
        } catch {
          throw new Error(`Chat fallback returned invalid JSON (${fallbackResponse.status}).`);
        }
        const fallbackPayload = parsedFallback && typeof parsedFallback === "object" && !Array.isArray(parsedFallback)
          ? parsedFallback as Record<string, unknown>
          : {};

        if (!fallbackResponse.ok) {
          const cooldown = getCooldownDetail(parsedFallback);
          if (fallbackResponse.status === 429 && cooldown) {
            throw new ChatCooldownError(cooldown.message, cooldown.cooldownUntil);
          }
          const detail = fallbackPayload.detail;
          throw new Error(typeof detail === "string"
            ? detail
            : `Chat fallback failed (${fallbackResponse.status}).`);
        }

        const replyField = [
          fallbackPayload.reply,
          fallbackPayload.response,
          fallbackPayload.content,
          fallbackPayload.message,
          fallbackPayload.text,
          fallbackPayload.output,
          fallbackPayload.answer,
        ].find((value): value is string => typeof value === "string" && value.length > 0);
        const firstTextValue = Object.values(fallbackPayload)
          .find((value): value is string => typeof value === "string" && value.length > 0);
        const reply = typeof parsedFallback === "string"
          ? parsedFallback
          : replyField || firstTextValue || JSON.stringify(parsedFallback) || "";

        if (!reply) {
          const detail = fallbackPayload.detail;
          throw new Error((typeof detail === "string" ? detail : "") || `Chat fallback did not return a reply (${fallbackResponse.status}).`);
        }

        setMessages((current) => current.some((message) => message.id === assistantId)
          ? current.map((message) => message.id === assistantId ? { ...message, content: reply } : message)
          : [...current, { id: assistantId, role: "assistant", content: reply }]);
        if (voiceReply && target === "agent") void speakGenieReply(reply, voiceDialect);
      } catch (fallbackError) {
        const cooldown = fallbackError instanceof ChatCooldownError
          ? { cooldownUntil: fallbackError.cooldownUntil, message: fallbackError.message }
          : null;
        if (cooldown) {
          setTokenCooldown(cooldown);
          setMessages((current) => current.filter((message) => message.id !== assistantId));
          setToast(cooldown.message);
          return;
        }
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: `⚠️ ${fallbackError instanceof Error ? fallbackError.message : "Chat could not be completed."}` } : message));
        setToast(fallbackError instanceof Error ? fallbackError.message : "Chat could not be completed.");
      }
    } finally {
      setSending(false);
    }
  }

  sendMessageRef.current = sendMessage;

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
      const apiPreferences = { ...preferences };
      delete apiPreferences.selected_voice_id;
      await apiFetch("/api/profile/preferences", credential, {
        method: "PUT",
        body: JSON.stringify({
          ...apiPreferences,
          telemetry_enabled: Boolean(preferences.telemetry_enabled),
        }),
      });
    } catch {
      setToast("Preferences saved on this device; account sync is unavailable.");
    }
    setProfilePreferences((current) => ({
      ...preferences,
      telemetry_enabled: Boolean(preferences.telemetry_enabled),
      selected_voice_id: current.selected_voice_id,
    }));
    if (identity) {
      localStorage.setItem(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), JSON.stringify({
        ...profileDetails,
        ...preferences,
        selected_voice_id: selectedVoiceId,
        registration_complete: true,
        email: identity.email,
        user_name: identity.name,
      }));
    }
  }

  async function saveSocialProfileChanges(profile: SocialProfileUpdate) {
    if (!credential || !identity) throw new Error("Sign in before saving your social profile.");
    const optimistic: SocialProfile = {
    user_id: identity.sub,
    email: identity.email,
    ...profile,
    profile_completed: Boolean(profile.display_name.trim() && profile.username.trim()),
    };
    setSocialProfile(optimistic);
    setProfileDetails((current) => ({
    ...current,
    display_name: optimistic.display_name,
    bio: optimistic.bio,
    custom_picture_data: optimistic.avatar_data_url,
    }));
    setIdentity((current) => current ? {
    ...current,
    name: optimistic.display_name,
    picture: optimistic.avatar_data_url || current.picture,
    } : current);
    const stored = readStored<Partial<ProfileResponse>>(
      userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), {},
    );
    localStorage.setItem(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), JSON.stringify({
      ...stored,
      ...profile,
      email: identity.email,
      user_name: profile.display_name,
      display_name: profile.display_name,
      custom_picture_data: profile.avatar_data_url,
      avatar_data_url: profile.avatar_data_url,
      profile_completed: optimistic.profile_completed,
      registration_complete: true,
    }));
    const saved = await saveSocialProfile(profile, credential);
    setSocialProfile((current) => ({ ...current, profile_completed: saved.profile_completed }));
    localStorage.setItem(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), JSON.stringify({
      ...readStored<Partial<ProfileResponse>>(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), {}),
      profile_completed: saved.profile_completed,
    }));
    setToast("Social profile saved.");
  }

  async function uploadProfileAvatar(file: File) {
    const avatar = await compressProfileAvatar(file);
    await saveSocialProfileChanges({
      display_name: socialProfile.display_name || identity?.name || "",
      username: socialProfile.username || "",
      avatar_data_url: avatar,
      bio: socialProfile.bio,
      skills_offered: socialProfile.skills_offered,
      discoverable: socialProfile.discoverable,
    });
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
        selected_voice_id: selectedVoiceId,
        registration_complete: true,
        email: identity.email,
        user_name: details.display_name,
      }));
      setIdentity((current) => current ? {
        ...current,
        name: details.display_name,
        picture: details.custom_picture_data || current.picture,
      } : current);
      try {
        await saveSocialProfileChanges({
          display_name: details.display_name,
          username: socialProfile.username || "",
          avatar_data_url: details.custom_picture_data,
          bio: details.bio,
          skills_offered: socialProfile.skills_offered,
          discoverable: socialProfile.discoverable,
        });
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Social profile details could not be synced.");
      }
    }
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
    localStorage.removeItem("genie_admin_signed_session");
    setAdminToken("");
    setAdminStats(null);
    window.google?.accounts.id.disableAutoSelect();
    setCredential("");
    setIdentity(null);
    registrationCompleted.current = false;
    setAccountStatus("checking");
    setLoadedThreadsFor("");
    setRoom(null);
    setRoomKey("");
    setMessages([]);
    setThreads([]);
    setDeletedThreads([]);
    setFriends([]);
    setFriendRequests([]);
    setAIAvailability(null);
    setAIAvailabilityError("");
    setSettingsOpen(false);
  }

  function enterLocalDevelopmentChat() {
    setCredential("local-dev");
    setIdentity({
      sub: "local-development",
      email: "local@localhost",
      name: "Local user",
    });
    setAccountStatus("ready");
    setAuthError("");
  }

  async function removeAccount() {
    if (identity) {
      localStorage.removeItem(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub));
      localStorage.removeItem(userStorageKey(LOCAL_ROOMS_STORAGE, identity.sub));
      localStorage.removeItem(userStorageKey(LOCAL_REQUESTS_STORAGE, identity.sub));
      localStorage.removeItem(userStorageKey("genie_local_outgoing_friend_requests", identity.sub));
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
    setQueuedAttachment({
      text: "Analyze the scanned PDF document.",
      secret: false,
      attachment: {
        mime_type: "application/pdf",
        data: pdfBase64,
        name: "scanned-document.pdf",
        document_data: { mime_type: "application/pdf", name: "scanned-document.pdf", data: pdfBase64 },
      },
      model: "genie-pro",
      thinkingLevel: "pro",
      target: "agent",
    });
  }

  async function chooseDocument(file?: File) {
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop() || "";
    const types: Record<string, string> = {
      txt: "text/plain",
      md: "text/markdown",
      csv: "text/csv",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    const mimeType = types[extension];
    if (!mimeType) {
      setToast("Choose a TXT, Markdown, CSV, DOC, DOCX, or PDF document.");
      return;
    }
    if (file.size > 8_000_000) {
      setToast("Document exceeds the 8 MB upload limit.");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Document could not be read."));
        reader.onerror = () => reject(new Error("Document could not be read."));
        reader.readAsDataURL(file);
      });
      const data = dataUrl.split(",", 2)[1] || "";
      const documentData = { name: file.name, mime_type: mimeType, data };
      const documentAttachment: GenieDocumentAttachment = {
        mime_type: mimeType,
        data,
        name: file.name,
        document_data: documentData,
      };
      setQueuedAttachment({
        text: `Analyze the attached document: ${file.name}`,
        secret: false,
        attachment: documentAttachment,
        model: "genie-pro",
        thinkingLevel: "pro",
        target: "agent",
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Document could not be read.");
    }
  }

  async function choosePlusAttachment(file: File) {
    if (file.type.startsWith("image/")) {
      if (file.size > 8_000_000) {
        setToast("Image exceeds the 8 MB upload limit.");
        return;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image could not be read."));
          reader.onerror = () => reject(new Error("Image could not be read."));
          reader.readAsDataURL(file);
        });
        const attachment: Attachment = {
          mime_type: file.type,
          data: dataUrl.split(",", 2)[1] || "",
          name: file.name,
        };
        setQueuedAttachment({
          text: `Review the attached image: ${file.name}`,
          secret: false,
          attachment,
          model: "genie-pro",
          thinkingLevel: "pro",
          target: "agent",
        });
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Image could not be read.");
      }
      return;
    }
    await chooseDocument(file);
  }

  function sendQueuedAttachment(model: string) {
    if (!queuedAttachment) return;
    const queued = queuedAttachment;
    setQueuedAttachment(null);
    void sendMessage(
      queued.text,
      queued.secret,
      queued.attachment,
      model,
      queued.thinkingLevel,
      queued.target,
    );
  }

  function submitComposerMessage(
    text: string,
    secret: boolean,
    attachment?: Attachment,
    model = "genie-pro",
    thinkingLevel = "pro",
    target: SubmitTarget = "agent",
  ) {
    const isLiveCallResponse = Boolean(callSummonTranscript.current)
      && text.trim() === callSummonTranscript.current.trim();
    if (isLiveCallResponse) callSummonTranscript.current = "";
    const asksGenieInStandby = chatMode === "friends_only" && /@genie\b/i.test(text);
    const effectiveTarget: SubmitTarget = asksGenieInStandby ? "agent" : target;
    const effectiveChatMode: ChatMode = asksGenieInStandby || isLiveCallResponse ? "ai_room" : chatMode;
    const selectedModel = model === "genie-lite" || model === "genie-master" ? "genie-pro" : model;
    if (attachment && !secret && effectiveTarget === "agent" && selectedModel !== "genie-master") {
      setQueuedAttachment({ text, secret, attachment, model: selectedModel, thinkingLevel, target: effectiveTarget });
      return;
    }
    void sendMessage(
      text,
      secret,
      attachment,
      selectedModel,
      "pro",
      effectiveTarget,
      undefined,
      isLiveCallResponse,
      undefined,
      undefined,
      effectiveChatMode,
      isLiveCallResponse,
    );
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

  async function saveResponseToLibrary(message: ChatMessage) {
    if (!credential) throw new Error("Sign in before saving a response.");
    const localItem: SavedItem = {
      id: message.id,
      content: message.content,
      createdAt: message.sent_at || new Date().toISOString(),
    };
    try {
      const saved = await saveLibraryItem(message.content, credential, {
        message_id: message.id,
        source: "chat",
      });
      const item = { ...localItem, id: saved.id || localItem.id, createdAt: saved.created_at || localItem.createdAt };
      setLibrary((current) => current.some((existing) => existing.id === item.id) ? current : [item, ...current]);
      setToast("Response saved to your Library.");
    } catch {
      setLibrary((current) => current.some((existing) => existing.id === localItem.id)
        ? current
        : [localItem, ...current]);
      setToast("Saved on this device. The Library service is unavailable right now.");
    }
  }

  async function approveMemoryFromResponse(message: ChatMessage) {
    const memory = typeof message.proposed_memory === "object" && message.proposed_memory
      ? message.proposed_memory
      : undefined;
    const proposalId = memory?.id
      || memory?.proposal_id
      || message.proposed_memory_id
      || (typeof message.proposed_memory === "string" && /^[\w-]{8,}$/.test(message.proposed_memory)
        ? message.proposed_memory
        : "");
    if (!proposalId) {
      setToast("This memory proposal is missing its approval identifier.");
      throw new Error("Memory proposal ID is missing.");
    }
    try {
      await approveProposedMemory(proposalId, credential);
      setMessages((current) => current.map((item) => item.id === message.id
        ? { ...item, memory_status: "approved" }
        : item));
      setToast("Suggested memory approved.");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Memory approval failed.");
      throw caught;
    }
  }

  async function addResponseToFutureSelf(message: ChatMessage) {
    try {
      await createFutureSelfEntry(message.content, credential, message.id);
      setToast("Response added to Future Self.");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Future Self could not be updated.");
      throw caught;
    }
  }

  async function reactToChatMessage(
    message: ChatMessage,
    targetType: "user_message" | "ai_response",
    emoji: string,
  ) {
    if (!room || !credential) return;
    try {
      const result = await apiFetch<{ counts: Record<string, number> }>(
        `/api/rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(message.id)}/reactions`,
        credential,
        {
          method: "POST",
          body: JSON.stringify({ target_type: targetType, reaction_emoji: emoji }),
        },
      );
      setReactionCounts((current) => ({
        ...current,
        [`${targetType}:${message.id}`]: result.counts,
      }));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Your reaction could not be saved.");
    }
  }

  async function sendResponseFeedback(message: ChatMessage, rating: "up" | "down") {
      try {
        await apiFetch("/api/feedback", credential, {
          method: "POST",
          body: JSON.stringify({
            message_id: message.id,
            rating,
            question: messages.find((item) => item.role === "user")?.content || "",
          }),
        });
        setToast(rating === "up" ? "Thanks for the feedback." : "Thanks. We’ll avoid reusing that answer.");
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Feedback could not be saved.");
      }
  }

  async function downloadCurrentTranscript() {
      if (!identity) {
        setToast("Sign in before downloading a transcript.");
        return;
      }
      const conversationId = room?.id || `solo:${identity.sub}`;
      try {
        const response = await apiRequest(`/api/calls/${encodeURIComponent(conversationId)}/transcript-download`, {
          headers: credential ? { Authorization: `Bearer ${credential}` } : {},
        });
        if (!response.ok) throw new ApiError("Transcript download failed.", response.status);
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `genie-mom-${conversationId.slice(0, 30)}.txt`;
        link.click();
        URL.revokeObjectURL(objectUrl);
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Transcript download failed.");
      }
  }

  async function setMomEmailPreference(enabled: boolean) {
      if (!identity) {
        setToast("Sign in before changing MOM email preferences.");
        return;
      }
      const conversationId = room?.id || `solo:${identity.sub}`;
      try {
        await apiFetch(`/api/calls/${encodeURIComponent(conversationId)}/mom-email-preference`, credential, {
          method: "PUT",
          body: JSON.stringify({ enabled }),
        });
        setMomEmailEnabled(enabled);
        setToast(`MOM email opt-in ${enabled ? "enabled" : "disabled"}.`);
      } catch (error) {
        setToast(error instanceof Error ? error.message : "MOM email preference could not be saved.");
    }
  }

  async function updatePrivacySettings(patch: Partial<PrivacySettings>) {
    if (!credential) {
    setToast("Sign in before changing privacy settings.");
    return;
    }
    const next = { ...privacySettings, ...patch };
    try {
    const saved = await apiFetch<PrivacySettings>("/api/privacy/settings", credential, {
      method: "PUT",
      body: JSON.stringify(next),
    });
    setPrivacySettings(saved);
    } catch (error) {
    setToast(error instanceof Error ? error.message : "Privacy settings could not be saved.");
    }
  }

  async function blockPrivacyUser(user: BlockedPrivacyUser) {
    if (!credential) return;
    try {
    const blocked = await apiFetch<BlockedPrivacyUser>("/api/privacy/blocked-users", credential, {
      method: "POST",
      body: JSON.stringify({ user_id: user.id, user_name: user.name }),
    });
    setBlockedPrivacyUsers((current) => [
      blocked,
      ...current.filter((item) => item.id !== blocked.id),
    ]);
    } catch (error) {
    setToast(error instanceof Error ? error.message : "That user could not be blocked.");
    }
  }

  async function unblockPrivacyUser(userId: string) {
    if (!credential) return;
    try {
    await apiFetch(`/api/privacy/blocked-users/${encodeURIComponent(userId)}`, credential, {
      method: "DELETE",
    });
    setBlockedPrivacyUsers((current) => current.filter((item) => item.id !== userId));
    } catch (error) {
    setToast(error instanceof Error ? error.message : "That user could not be unblocked.");
    }
  }

  async function toggleRoomAiResponseVisibility(message: ChatMessage) {
    if (!room || !credential || message.sender_sub !== identity?.sub) return;
    if (message.is_group_shared_ai_response) {
      try {
        await apiFetch(
          `/api/rooms/${encodeURIComponent(room.id)}/ai-responses/${encodeURIComponent(message.id)}/share`,
          credential,
          { method: "DELETE" },
        );
        setMessages((current) => current.map((item) => item.id === message.id
          ? { ...item, is_group_shared_ai_response: false }
          : item));
        setToast("This response is now private to your device.");
      } catch (error) {
        setToast(error instanceof Error ? error.message : "This response could not be made private.");
      }
      return;
    }
    await shareRoomAiResponse(message.id, message.content);
  }

  function regenerateAssistantResponse(message: ChatMessage) {
    if (message.sender_sub !== identity?.sub) {
      setToast("Only the response owner can regenerate it.");
      return;
    }
    const responseIndex = messages.findIndex((item) => item.id === message.id);
    const context = messages.slice(0, responseIndex);
    const prompt = [...context].reverse().find((item) => item.role === "user" && !item.is_secret);
    if (!prompt) {
      setToast("The prompt for this response is no longer available.");
      return;
    }
    const attachment = prompt.attachment
      ? { ...prompt.attachment, name: "previous-attachment" }
      : undefined;
    void sendMessage(
      prompt.content,
      false,
      attachment,
      "genie-pro",
      "pro",
      "agent",
      undefined,
      false,
      undefined,
      {
        prompt,
        responseId: message.id,
        visibility: message.is_group_shared_ai_response ? "group" : "private",
        context,
      },
      message.chat_mode || "ai_room",
    );
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
  query.delete("join");
  query.delete("invite");
  window.history.replaceState(null, "", `${window.location.pathname}${query.size ? `?${query}` : ""}`);
  setRoom(null);
  setRoomKey("");
  setMessages([]);
  setRoomStatus("Saved room keys and invite credentials removed from this device.");
  }

  async function refreshSocial() {
    if (!credential) return;
    const [requestList, outgoingRequestList, friendList, roomList] = await Promise.all([
      apiFetch<FriendRequestItem[] | { requests?: FriendRequestItem[] }>("/api/social/requests", credential)
        .then((result) => Array.isArray(result) ? result : result.requests || [])
        .catch(() => [] as FriendRequestItem[]),
      apiFetch<OutgoingFriendRequestItem[]>("/api/social/requests/outgoing", credential).catch(() => [] as OutgoingFriendRequestItem[]),
      apiFetch<FriendItem[]>("/api/social/friends", credential).catch(() => [] as FriendItem[]),
      apiFetch<Room[]>("/api/rooms", credential).catch(() => [] as Room[]),
    ]);
    setFriendRequests(requestList);
    setOutgoingFriendRequests(outgoingRequestList);
    setFriends((current) => Array.from(new Map([...current, ...friendList].map((item) => [item.user_sub, item] as const)).values()));
    setRooms((current) => Array.from(new Map([...current, ...roomList].map((item) => [item.id, item] as const)).values()));
  }

  async function acceptFriendRequest(id: string) {
    if (!credential) return;
    const request = friendRequests.find((item) => item.id === id);
    setFriendRequests((current) => current.filter((item) => item.id !== id));
    if (request) setFriends((current) => current.some((friend) => friend.username === request.sender_username)
      ? current
      : [...current, {
        user_sub: `local:${request.sender_username}`,
        user_name: request.sender_name,
        username: request.sender_username,
      }]);
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

  async function sendFriendRequest(username: string) {
    if (!credential) return;
    const normalizedUsername = username.trim().replace(/^@/, "").toLowerCase();
    const request = {
      id: `local:${crypto.randomUUID()}`,
      receiver_name: normalizedUsername,
      receiver_username: normalizedUsername,
    };
    setOutgoingFriendRequests((current) => current.some((item) => item.receiver_username === normalizedUsername)
      ? current
      : [request, ...current]);
    try {
      const created = await apiFetch<{ id: string }>("/api/social/requests", credential, {
        method: "POST",
        body: JSON.stringify({ username: normalizedUsername }),
      });
      setOutgoingFriendRequests((current) => current.map((item) => item.id === request.id
        ? { ...item, id: created.id }
        : item));
      await refreshSocial();
    } catch (error) {
      setOutgoingFriendRequests((current) => current.filter((item) => item.id !== request.id));
      throw error;
    }
  }

  async function cancelFriendRequest(id: string) {
    if (!credential) return;
    setOutgoingFriendRequests((current) => current.filter((item) => item.id !== id));
    try {
      await apiFetch(`/api/social/requests/${encodeURIComponent(id)}/cancel`, credential, { method: "POST", body: "{}" });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The friend request could not be cancelled.");
    }
    await refreshSocial();
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
    const key = localStorage.getItem(`genie_room_key_${room.id}`);
    const invite = localStorage.getItem(`genie_room_invite_${room.id}`);
    const passcode = localStorage.getItem(`genie_room_passcode_${room.id}`);
    if (!key || !invite || !passcode) {
      setToast("This device does not have the complete room invitation.");
      return;
    }
    setInviteLink(roomInviteUrl(room.id, key, invite, room.group_slot));
    setInvitePasscode(passcode);
    setInviteOpen(true);
  }

  function handleAvatarTap() {
    if (identity?.email.toLowerCase() !== "rshaji93@gmail.com") {
      setSettingsOpen(true);
      setVoiceStudioOpen(true);
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
    if (callAudioStream) {
      callSummonTranscript.current = "";
      setTranscribeRequest((request) => request + 1);
      setToast("Listening through the active call mic. Review the transcript, then send it to Genie.");
      return;
    }
    const recognitionWindow = window as SpeechRecognitionWindow;
    const Recognition = recognitionWindow.SpeechRecognition || recognitionWindow.webkitSpeechRecognition;
    if (!Recognition) {
      callSummonTranscript.current = "";
      setToast("Live voice input is unavailable here. Use the composer microphone and send with ↑.");
      setTranscribeRequest((request) => request + 1);
      return;
    }
    const recognition = new Recognition();
    const voiceDialect = room ? roomVoiceDialect : selectedVoice().lang;
    recognition.lang = voiceDialect;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript.trim();
      if (transcript) {
        void sendMessage(
          transcript,
          false,
          undefined,
          "genie-pro",
          "pro",
          "agent",
          undefined,
          true,
          voiceDialect,
          undefined,
          "ai_room",
          true,
        );
      }
    };
    recognition.onerror = (event) => setToast(`Voice capture failed: ${event.error}.`);
    recognition.onend = () => {
      if (voiceRecognitionRef.current === recognition) voiceRecognitionRef.current = null;
    };
    try {
      voiceRecognitionRef.current?.stop();
      voiceRecognitionRef.current = recognition;
      recognition.start();
      setToast("Listening for your Genie request…");
    } catch {
      voiceRecognitionRef.current = null;
      setToast("Could not start voice capture. Allow microphone access and try again.");
    }
  }

  function selectedVoice(): GenieVoice {
    return GENIE_VOICES.find((voice) => voice.id === selectedVoiceId) || GENIE_VOICES[0];
  }

  function stopVoicePreview() {
    if (previewTimerRef.current !== undefined) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = undefined;
    previewAudioRef.current?.pause();
    if (previewAudioRef.current) previewAudioRef.current.currentTime = 0;
    window.speechSynthesis?.cancel();
    setPreviewingVoiceId("");
  }

  function startBrowserSpeech(text: string, voice: GenieVoice, preview = false) {
    if (!("speechSynthesis" in window)) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*#`]/g, ""));
    utterance.lang = voice.lang;
    utterance.pitch = voice.pitch;
    utterance.rate = voice.rate;
    const nativeVoice = window.speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase() === voice.lang.toLowerCase())
      || window.speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith(voice.lang.slice(0, 2).toLowerCase()));
    if (nativeVoice) utterance.voice = nativeVoice;
    if (preview) {
      utterance.onend = () => setPreviewingVoiceId("");
      utterance.onerror = () => setPreviewingVoiceId("");
    }
    window.speechSynthesis.speak(utterance);
    if (preview) previewTimerRef.current = window.setTimeout(stopVoicePreview, 10_000);
    return true;
  }

  async function previewVoice(voice: GenieVoice) {
    if (previewingVoiceId === voice.id) {
      stopVoicePreview();
      return;
    }
    stopVoicePreview();
    setPreviewingVoiceId(voice.id);
    try {
      if (credential) {
        const response = await apiRequest("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
          body: JSON.stringify({ text: voice.sample, dialect: voice.lang }),
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Server voice preview is unavailable.");
        const result = await response.json() as { audio_base64?: string; mime_type?: string };
        if (result.audio_base64) {
          const audio = new Audio(`data:${result.mime_type || "audio/mpeg"};base64,${result.audio_base64}`);
          previewAudioRef.current = audio;
          audio.onended = () => setPreviewingVoiceId("");
          await audio.play();
          previewTimerRef.current = window.setTimeout(stopVoicePreview, 10_000);
          return;
        }
      }
    } catch {
      // Use browser speech synthesis when the authenticated TTS provider is unavailable.
    }
    if (!startBrowserSpeech(voice.sample, voice, true)) {
      setPreviewingVoiceId("");
      setToast("Voice preview is unavailable in this browser.");
    }
  }

  function chooseVoice(voice: GenieVoice) {
    setSelectedVoiceId(voice.id);
    setProfilePreferences((current) => ({ ...current, selected_voice_id: voice.id }));
    if (identity) {
      localStorage.setItem(userStorageKey(LOCAL_VOICE_STORAGE, identity.sub), voice.id);
      const profile = readStored<Partial<ProfileResponse>>(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), {});
      localStorage.setItem(userStorageKey(LOCAL_PROFILE_STORAGE, identity.sub), JSON.stringify({
        ...profile,
        ...profilePreferences,
        selected_voice_id: voice.id,
        email: identity.email,
        user_name: identity.name,
      }));
    } else {
      localStorage.setItem(LOCAL_VOICE_STORAGE, voice.id);
    }
  }

  async function speakGenieReply(text: string, dialect = selectedVoice().lang) {
    const speech = text.replace(/[*#`]/g, "").trim();
    if (!speech) return;
    const voice = GENIE_VOICES.find((candidate) => candidate.lang === dialect) || selectedVoice();
    try {
      const result = await requestVoiceTts(speech, dialect, voice.id, credential);
      if (!result.audio_base64) throw new Error("Native speech synthesis returned no audio.");
      const audio = new Audio(`data:${result.mime_type || "audio/wav"};base64,${result.audio_base64}`);
      replyAudioRef.current?.pause();
      replyAudioRef.current = audio;
      await audio.play();
    } catch {
      if (!startBrowserSpeech(speech, voice)) {
        setToast("Voice output is unavailable in this browser.");
      }
    }
  }

  useEffect(() => () => {
    if (previewTimerRef.current !== undefined) window.clearTimeout(previewTimerRef.current);
    previewAudioRef.current?.pause();
    replyAudioRef.current?.pause();
    window.speechSynthesis?.cancel();
    voiceRecognitionRef.current?.stop();
  }, []);

  function sendCallSignal(toSub: string, payload: CallSignal["payload"]) {
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
              <div className="registration-form">
                <label>Full name<input autoComplete="name" maxLength={100} value={registration.full_name} onChange={(event) => {
                  const next = { ...registration, full_name: event.target.value };
                  setRegistration(next);
                  localStorage.setItem("genie_registration_draft", JSON.stringify(next));
                }} /></label>
                <label>Phone with international country code<input autoComplete="tel" placeholder="+1 555 123 4567" type="tel" value={registration.phone} onChange={(event) => {
                  const next = { ...registration, phone: event.target.value };
                  setRegistration(next);
                  localStorage.setItem("genie_registration_draft", JSON.stringify(next));
                }} /></label>
                <label>City / region<input autoComplete="address-level2" maxLength={120} value={registration.city_region} onChange={(event) => {
                  const next = { ...registration, city_region: event.target.value };
                  setRegistration(next);
                  localStorage.setItem("genie_registration_draft", JSON.stringify(next));
                }} /></label>
              </div>
              <div
                ref={googleButton}
                className="flex justify-center my-3 min-h-[44px] google-button-container"
              />
              {process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname) && (
                <button className="subtle-button" onClick={enterLocalDevelopmentChat} type="button">
                  Continue to local chat without Google
                </button>
              )}
              {!clientId && <p className="login-config">Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in frontend/.env.local and GENIE_GOOGLE_CLIENT_ID in the backend environment.</p>}
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
  const privacyModeLabel = chatMode === "friends_only"
    ? "⏸️ AI Standby"
    : chatMode === "private_ai"
      ? "🔒 Private AI"
      : "🔓 AI + Room";
  const privacyModeOptions: Array<{ mode: ChatMode; label: string; description: string }> = [
    { mode: "ai_room", label: "🔓 AI + Room", description: "Standard AI and room chat" },
    { mode: "friends_only", label: "⏸️ AI Standby", description: "Chat with room members; ask Genie when needed" },
    { mode: "private_ai", label: "🔒 AI Private", description: "Private whisper, visible only to you and Genie" },
  ];
  return (
    <main className="application-shell h-dvh max-h-dvh overflow-hidden flex flex-col">
      <Sidebar
        collapsed={sidebarCollapsed && !mobileSidebarOpen}
        mobileOpen={mobileSidebarOpen}
        view={view}
        threads={threads}
        deletedThreads={deletedThreads}
        selectedThreadId={threadId}
        onlineMembers={onlineNames}
        rooms={rooms}
        currentRoomId={room?.id}
        displayName={profileDetails.display_name || identity.name}
        pictureUrl={profileDetails.custom_picture_data || identity.picture}
        incomingRequestCount={friendRequests.length}
        onToggle={() => {
          if (mobileSidebarOpen) setMobileSidebarOpen(false);
          else setSidebarCollapsed((current) => !current);
        }}
        onViewChange={(nextView) => { setView(nextView); setMobileSidebarOpen(false); }}
        onNewChat={() => { startNewChat(); setMobileSidebarOpen(false); }}
        onThreadSelect={(id) => { selectThread(id); setMobileSidebarOpen(false); }}
        onDeleteThread={deleteThread}
        onRenameThread={renameThread}
        onPinThread={pinThread}
        onClearCurrentChat={clearCurrentChat}
        onRestoreThread={restoreThread}
        onPermanentlyDeleteThread={permanentlyDeleteThread}
        onSearch={() => setSearchOpen(true)}
        onInviteRoom={() => room ? void shareCurrentRoom() : void createRoom()}
        onOpenSettings={() => setSettingsOpen(true)}
        onProfileTap={handleAvatarTap}
        onAvatarSelected={(file) => { void uploadProfileAvatar(file).catch((error: unknown) => setToast(error instanceof Error ? error.message : "Profile picture could not be saved.")); }}
        onOpenRoom={(id) => void openRoom(id)}
        onCreateGroupSlot={(slot) => void createRoom(slot)}
        onEditGroup={(sidebarRoom) => {
          const selected = rooms.find((candidate) => candidate.id === sidebarRoom.id);
          if (selected) {
            void openRoom(selected.id).then(() => setGroupEditorRoom(selected));
          }
        }}
      />
      <FixedGroups5x5Modal
        open={Boolean(groupEditorRoom)}
        friends={friends.map((friend): FixedGroupFriend => ({
          id: friend.user_sub,
          name: friend.username ? `@${friend.username}` : friend.user_name,
          avatarUrl: friend.avatar_data_url || undefined,
        }))}
        currentMembers={members
          .filter((member) => member.user_sub !== identity.sub)
          .map((member) => ({
            id: member.user_sub,
            name: member.username ? `@${member.username}` : member.user_name,
            avatarUrl: member.avatar_data_url || undefined,
          }))}
        currentUserId={identity.sub}
        roomTitle={groupEditorRoom?.name || ""}
        roomIcon={groupEditorRoom?.group_icon || ""}
        onClose={() => setGroupEditorRoom(null)}
        onSaveSettings={async (name, icon) => {
          if (!groupEditorRoom) return;
          await apiFetch(`/api/rooms/${encodeURIComponent(groupEditorRoom.id)}/settings`, credential, {
            method: "PATCH",
            body: JSON.stringify({ name, icon }),
          });
          setRooms((current) => current.map((candidate) => candidate.id === groupEditorRoom.id
            ? { ...candidate, name, group_icon: icon }
            : candidate));
          setRoom((current) => current?.id === groupEditorRoom.id
            ? { ...current, name, group_icon: icon }
            : current);
        }}
        onUpdateMembers={async (memberIds) => {
          if (!groupEditorRoom) return;
          await apiFetch(`/api/rooms/${encodeURIComponent(groupEditorRoom.id)}/members`, credential, {
            method: "PUT",
            body: JSON.stringify({ member_ids: memberIds }),
          });
          const updatedMembers = await apiFetch<RoomPerson[]>(
            `/api/rooms/${encodeURIComponent(groupEditorRoom.id)}/members`,
            credential,
          );
          setMembers(updatedMembers);
        }}
      />
      {mobileSidebarOpen && (
        <button
          aria-label="Close workspace navigation"
          className="mobile-sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
          type="button"
        />
      )}
      <div className="workspace-main">
        <header className="workspace-topbar" style={{ display: "none" }}>
          <div className="workspace-heading">
            <button
              aria-expanded={mobileSidebarOpen}
              aria-label="Open workspace navigation"
              className="mobile-sidebar-trigger"
              onClick={() => setMobileSidebarOpen((open) => !open)}
              type="button"
            ><Menu size={19} /></button>
            <div className="workspace-location">
              <span>{room ? room.name : "Genie"}</span>
            </div>
            <div className="model-control-group">
              <div className="privacy-mode-selector">
                <button
                  aria-expanded={privacyMenuOpen}
                  aria-haspopup="listbox"
                  aria-label={`Privacy mode: ${privacyModeLabel}`}
                  className={`privacy-mode-trigger privacy-mode-${chatMode}`}
                  onClick={() => setPrivacyMenuOpen((open) => !open)}
                  type="button"
                >
                  <LockKeyhole size={14} aria-hidden="true" />
                  <span>{privacyModeLabel}</span>
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                {privacyMenuOpen && (
                  <div className="privacy-mode-popover" role="listbox" aria-label="Choose chat privacy mode">
                    {privacyModeOptions.map((option) => (
                      <button
                        aria-selected={chatMode === option.mode}
                        className={`privacy-mode-option privacy-mode-option-${option.mode}`}
                        key={option.mode}
                        onClick={() => {
                          if (option.mode === "friends_only" && !room) {
                            setToast("Join an encrypted room before switching to Friends Only.");
                            setPrivacyMenuOpen(false);
                            return;
                          }
                          setChatMode(option.mode);
                          setPrivacyMenuOpen(false);
                        }}
                        role="option"
                        type="button"
                      >
                        <span><strong>{option.label}</strong><small>{option.description}</small></span>
                        {chatMode === option.mode && <Check size={16} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="workspace-top-actions">
            {room && <button className="room-control" onClick={() => void shareCurrentRoom()} title="Copy encrypted room invite"><ArrowUpRight size={14} /> Invite</button>}
            {room && <div className="room-roster">
              <button className="room-roster-trigger" onClick={() => {
                setHeaderMenuOpen(false);
                setRailOpen(false);
                setRosterOpen((open) => !open);
              }} aria-expanded={rosterOpen} aria-label="Show conversation people">
                <UsersRound size={15} /><span>People</span>
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
            <div className="header-actions-menu">
              <button className="utility-trigger header-menu-trigger" onClick={() => {
                setRailOpen(false);
                setRosterOpen(false);
                if (!headerMenuOpen) window.dispatchEvent(new Event("genie:close-sidebar-menu"));
                setHeaderMenuOpen((open) => !open);
              }} aria-label="Open workspace actions" aria-expanded={headerMenuOpen}><MoreHorizontal size={16} /></button>
              {headerMenuOpen && <div className="header-actions-popover" role="menu">
                <button role="menuitem" onClick={() => { setSearchOpen(true); setHeaderMenuOpen(false); }}><Search size={15} /> Search chats</button>
                <button className="header-danger-menu-item" role="menuitem" onClick={() => {
                  setHeaderMenuOpen(false);
                  if (messages.length) enterMessageSelection();
                  else setToast("There are no messages to delete.");
                }}><Trash2 size={15} /> Delete Chat</button>
                <button role="menuitem" onClick={() => { setSettingsOpen(true); setHeaderMenuOpen(false); }}><span aria-hidden="true">☁</span> Cloud Backup Vault</button>
                <button role="menuitem" onClick={() => { setView("friends"); setHeaderMenuOpen(false); }}><UsersRound size={15} /> Friend Requests</button>
                <button role="menuitem" onClick={() => { setPrivacyModalOpen(true); setHeaderMenuOpen(false); }}><ShieldCheck size={15} /> Trust &amp; privacy</button>
              </div>}
            </div>
          </div>
        </header>
        {pendingGroupInvitations.length > 0 && (
          <section aria-label="Pending group invitations" className="mx-auto mt-3 flex w-full max-w-[850px] flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            <strong>Group invitations</strong>
            {pendingGroupInvitations.map((invitation) => (
              <span className="inline-flex flex-wrap items-center gap-2" key={invitation.id}>
                {invitation.inviter_name} invited you to {invitation.group_name}.
                <button className="utility-trigger" onClick={() => void respondGroupInvitation(invitation.id, true)} type="button">Accept</button>
                <button className="utility-trigger" onClick={() => void respondGroupInvitation(invitation.id, false)} type="button">Decline</button>
              </span>
            ))}
          </section>
        )}
        {temporaryChatActive && (
          <div className="mx-auto mt-2 flex w-full max-w-[850px] items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-stone-800">
            <span>Temporary chat · {temporaryChatMode === "personalized" ? "Personalized" : "Unpersonalized"} · this device session only</span>
            <button className="utility-trigger" onClick={endTemporaryChat} type="button">End temporary chat</button>
          </div>
        )}
        {sectionView ? (
          <WorkspacePanel
            view={sectionView}
            credential={credential}
            savedItems={library}
            onRemoveSaved={(id) => setLibrary((items) => items.filter((item) => item.id !== id))}
            rooms={rooms}
            currentRoomId={room?.id}
            activeMembers={room
              ? members.filter((member) => member.user_sub === identity.sub || onlineSubs.includes(member.user_sub))
              : []}
            currentUserSub={identity.sub}
            profile={socialProfile}
            onSaveProfile={saveSocialProfileChanges}
            onAvatarSelected={uploadProfileAvatar}
            onCallFriend={(userSub) => {
              if (!room) {
                setToast("Open an encrypted room with this friend to start a call.");
                if (rooms[0]) void openRoom(rooms[0].id);
                return;
              }
              if (!members.some((member) => member.user_sub === userSub)) {
                setToast("Invite this friend into an encrypted room before calling.");
                return;
              }
              setRailOpen(true);
              setToast("Choose your friend in the call panel, then start the call.");
            }}
            requests={friendRequests}
            outgoingRequests={outgoingFriendRequests}
            friends={friends}
            onAcceptRequest={acceptFriendRequest}
            onRejectRequest={rejectFriendRequest}
            onCancelRequest={cancelFriendRequest}
            onSendFriendRequest={sendFriendRequest}
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
            isGroupRoom={Boolean(room && room.group_slot !== null && room.group_slot !== undefined)}
            isMultiUserRoom={Boolean(room)}
            roomId={room?.id}
            credential={credential}
            mySub={identity.sub}
            chatMode={chatMode}
            onChatModeChange={(mode) => {
              if (mode === "friends_only" && !room) {
                setToast("Join an encrypted room before switching to Friends Only.");
                return;
              }
              setChatMode(mode);
            }}
            onShowPeople={() => setRailOpen(true)}
            onOpenFriends={() => setView("friends")}
            onOpenSettings={() => setSettingsOpen(true)}
            conversationName={room?.name || threads.find((thread) => thread.id === threadId)?.title || "Genie"}
            temporaryChat={temporaryChatActive}
            momEmailEnabled={momEmailEnabled}
            onTemporaryChatChange={(enabled) => {
              setTemporaryChatActive(enabled);
              setToast(enabled ? "Temporary chat is on for this conversation." : "Temporary chat is off.");
            }}
            onShareConversation={() => {
              if (room) void shareCurrentRoom();
              else setToast("Open or create a group conversation to share an invite.");
            }}
            onClearConversation={clearCurrentChat}
            onDownloadTranscript={() => void downloadCurrentTranscript()}
            onMomEmailChange={(enabled) => void setMomEmailPreference(enabled)}
            onLeaveGroup={() => {
              if (!room) return;
              void apiFetch(`/api/rooms/${encodeURIComponent(room.id)}/members/me`, credential, { method: "DELETE" })
                .then(() => { setRoom(null); setMessages([]); setToast("You left the group."); })
                .catch((error: unknown) => setToast(error instanceof Error ? error.message : "Could not leave the group."));
            }}
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
            onApproveProposedMemory={approveMemoryFromResponse}
            onSaveToLibrary={saveResponseToLibrary}
            onFutureSelf={addResponseToFutureSelf}
            reactionCounts={reactionCounts}
            onReact={(message, target, emoji) => void reactToChatMessage(message, target, emoji)}
            onFeedback={(message, rating) => void sendResponseFeedback(message, rating)}
            onReadAloud={(message) => void speakGenieReply(message.content)}
            onCopyResponse={(message) => {
              void navigator.clipboard.writeText(message.content)
                .then(() => setToast("Response copied."))
                .catch(() => setToast("Clipboard access is unavailable."));
            }}
            onRegenerateResponse={regenerateAssistantResponse}
            onToggleResponseVisibility={(message) => void toggleRoomAiResponseVisibility(message)}
            selectionMode={messageSelectionMode}
            selectedMessageIds={selectedMessageIds}
            onEnterMessageSelection={enterMessageSelection}
            onToggleMessageSelection={toggleMessageSelection}
            onSelectAllMessages={selectAllDeletableMessages}
            onCancelMessageSelection={cancelMessageSelection}
            onDeleteSelectedMessages={() => void deleteSelectedMessages()}
          >
            {tokenCooldown && (
              <div className="mx-auto mb-2 w-full max-w-[850px] rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
                <strong>AI is cooling down for this account.</strong>
                <span className="ml-2">Try again after {new Date(tokenCooldown.cooldownUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</span>
                {room && <p className="mt-1">Room members have been notified that you could use some energy.</p>}
              </div>
            )}
            {room && roomCooldownNotice && (
              <div className="mx-auto mb-2 flex w-full max-w-[850px] flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-3 text-sm text-slate-900" role="status">
                <span><strong>Help {roomCooldownNotice.userName}</strong> keep chatting. Their daily AI allowance is cooling down.</span>
                <div className="flex flex-wrap gap-2">
                  {[1, 5, 10].map((amount) => (
                    <button
                      className="utility-trigger"
                      key={amount}
                      onClick={() => void shareRoomEnergy(roomCooldownNotice.userSub, amount)}
                      type="button"
                    >
                      Share {amount} energy
                    </button>
                  ))}
                  <button className="utility-trigger" onClick={() => setRoomCooldownNotice(null)} type="button">Dismiss</button>
                </div>
              </div>
            )}
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
              model="genie-pro"
              onTranscribeAudio={transcribeVoiceAudio}
              sharedAudioStream={callAudioStream}
              onOpenCall={() => {
                if (callAudioStream) {
                  setToast("Use + Add member in the live call dock to invite more room members.");
                  return;
                }
                setHeaderMenuOpen(false);
                setRailOpen(true);
              }}
              queuedAttachmentPreview={queuedAttachment ? {
                name: queuedAttachment.attachment.name,
                mime_type: queuedAttachment.attachment.mime_type,
                data: queuedAttachment.attachment.data,
              } : undefined}
              onSendQueuedAttachment={() => sendQueuedAttachment("genie-pro")}
              onRemoveQueuedAttachment={() => setQueuedAttachment(null)}
              chatMode={chatMode}
              sending={sending}
              aiAvailability={aiAvailability || undefined}
              availabilityError={aiAvailabilityError || undefined}
              quoteText={quoteText}
              defaultDialect={profilePreferences.default_dialect}
              recentContext={messages.slice(-8).map((message) => message.content).join("\n")}
              wakeWordActive={voiceSubs.length > 0}
              onWakeWordPrompt={(text, dialect) => {
                void sendMessage(
                  text,
                  false,
                  undefined,
                  "genie-pro",
                  "pro",
                  "agent",
                  undefined,
                  true,
                  dialect,
                );
              }}
              onClearQuote={() => setQuoteText("")}
              onActivity={broadcastActivity}
              onPdfScanned={setScannedPdf}
              onAttachmentFile={(file) => void choosePlusAttachment(file)}
              transcribeRequest={transcribeRequest}
              onCallTranscript={(text) => { callSummonTranscript.current = text.trim(); }}
              externalTranscription={studioDictationText}
              onSubmit={submitComposerMessage}
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
        onLocalStreamChange={setCallAudioStream}
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
        threads={threads}
        activeMessages={messages.filter((message) => message.chat_mode !== "private_ai")}
        gmailAddress={identity.email}
        onImportBackup={importChatBackup}
        onOpenVoiceStudio={() => setVoiceStudioOpen(true)}
      />
      <PrivacySecurityModal
        open={privacyModalOpen}
        profileVisibility={privacySettings.profile_visibility}
        friendRequestSetting={privacySettings.friend_request_setting}
        friendsOnlyCalls={privacySettings.friends_only_calls}
        promptBeforeScreenShare={privacySettings.prompt_before_screen_share}
        blockedUsers={blockedPrivacyUsers}
        onClose={() => setPrivacyModalOpen(false)}
        onProfileVisibilityChange={(profile_visibility) => void updatePrivacySettings({ profile_visibility })}
        onFriendRequestSettingChange={(friend_request_setting) => void updatePrivacySettings({ friend_request_setting })}
        onFriendsOnlyCallsChange={(friends_only_calls) => void updatePrivacySettings({ friends_only_calls })}
        onPromptBeforeScreenShareChange={(prompt_before_screen_share) => void updatePrivacySettings({ prompt_before_screen_share })}
        onBlockUser={blockPrivacyUser}
        onUnblockUser={unblockPrivacyUser}
      />
      <VoiceStudioModal
        open={voiceStudioOpen}
        credential={credential}
        selectedVoiceId={selectedVoiceId}
        onClose={() => setVoiceStudioOpen(false)}
        onSelect={(voiceId) => chooseVoice(GENIE_VOICES.find((voice) => voice.id === voiceId) || GENIE_VOICES[0])}
        onTranscription={setStudioDictationText}
      />
      <RoomInviteModal
        open={inviteOpen}
        link={inviteLink}
        passcode={invitePasscode}
        groupSlot={room?.group_slot}
        onRegenerate={regenerateRoomInvite}
        onClose={() => setInviteOpen(false)}
        onShare={(text) => {
          try {
            void distributeRoomInvite(new URL(inviteLink), invitePasscode, text);
          } catch {
            setToast("Room invitation link is invalid.");
          }
        }}
        onCopy={() => navigator.clipboard.writeText(`${inviteLink}\nPasscode: ${invitePasscode}`)}
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
        onUnlocked={(token, localOnly = false, credentialId = "") => {
          if (credentialId) {
            sessionStorage.setItem(ADMIN_LOCAL_VERIFIED_CREDENTIAL_STORAGE_KEY, credentialId);
          }
          if (localOnly) {
            if (!switchToLocalAdminView()) {
              setToast("This device passkey could not be matched to its local enrollment.");
            }
            return;
          }
          setAdminToken(token);
          setAdminStats({
            rooms: 0,
            users: 0,
            reviews: 0,
            review_tokens: 0,
            expires_at: Math.floor(Date.now() / 1000) + 300,
          });
          void apiFetch<{
            status: string; rooms: number; users: number; reviews: number; review_tokens: number; expires_at: number;
          }>("/api/admin/status", token)
            .then((result) => {
              setAdminStats(result);
              setToast(`Secure Admin Dashboard ${result.status}.`);
            })
            .catch((error: unknown) => {
              if (
                (error instanceof TypeError || (error instanceof ApiError && [401, 404].includes(error.status)))
                && switchToLocalAdminView()
              ) return;
              setToast(error instanceof Error ? error.message : "Admin session rejected.");
            });
        }}
      />
      {adminToken && adminStats && <div className="admin-session-badge"><ShieldCheck size={13} /> {adminToken === LOCAL_ADMIN_UNLOCK_TOKEN ? "Device-verified local view" : "Secure Admin session active"} <button onClick={() => setAdminStats(adminStats)}>Open dashboard</button><button onClick={() => { localStorage.removeItem("genie_admin_signed_session"); sessionStorage.removeItem(ADMIN_LOCAL_VERIFIED_CREDENTIAL_STORAGE_KEY); setAdminToken(""); setAdminStats(null); }}>Lock</button></div>}
      <AdminDashboard
        stats={adminStats}
        credential={credential}
        adminToken={adminToken}
        localOnly={adminToken === LOCAL_ADMIN_UNLOCK_TOKEN}
        onLocalFallback={switchToLocalAdminView}
        onClose={() => { localStorage.removeItem("genie_admin_signed_session"); sessionStorage.removeItem(ADMIN_LOCAL_VERIFIED_CREDENTIAL_STORAGE_KEY); setAdminStats(null); setAdminToken(""); }}
      />
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
