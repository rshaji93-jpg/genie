"use client";

// ========================================================================= //
// SECTION 1: IMPORTS, CONSTANTS & THEME PRESETS                             //
// ========================================================================= //

import React, { useState, useRef, useEffect, useCallback } from "react";
import Script from "next/script";
import StudentBanner from "../../components/StudentBanner";
import UnifiedStudyEngine from "../../components/UnifiedStudyEngine";
import MessageBubble from "../../components/MessageBubble";
import VoiceMic from "../../components/VoiceMic";
import DynamicTeamModal, { type RoomCapacityMode } from "./DynamicTeamModal";
import HeaderBar from "./HeaderBar";
import SlideDockDrawer from "./SlideDockDrawer";
import {
  decryptArchiveMessages,
  decryptRoomMessage,
  encryptArchiveMessages,
  encryptRoomMessage,
  loadRoomCryptoIdentity,
  type RoomCiphertext,
  type RoomCryptoIdentity,
} from "./roomCrypto";

// Import from your engine file
import {
  checkWakeWordTrigger,
  callActiveGeminiCascade,
  getBackendBaseUrl,
} from "../../app/engine";

// Import Lucide icons
import {
  User,
  Briefcase,
  Plus,
  MessageSquare,
  MoreVertical,
  Share2,
  Pin,
  Edit2,
  Trash2,
  Settings as SettingsIcon,
  X,
  ExternalLink,
  GraduationCap,
  Key,
  ChevronLeft,
  ChevronRight,
  Send,
  Globe,
  Users,
  SendHorizontal,
  RotateCcw,
  Copy,
  Check,
  Smile,
  Reply,
  Forward,
  UserCheck,
  UserX,
  Ban,
  ChevronDown,
  ChevronUp,
  Lock,
  ShieldCheck,
  Loader2,
  LogOut,
  Sparkles,
  Eye,
  EyeOff,
  Code2,
  Link as LinkIcon,
  RefreshCw,
  Mail,
  QrCode,
  Palette,
  AlertTriangle,
  FileCode,
  Download,
  Cloud,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2,
  FileText,
  FileUp,
  BookOpen,
  CheckSquare,
  Calculator,
  Square,
} from "lucide-react";

interface IndianLanguage {
  code: string;
  label: string;
}

const INDIAN_LANGUAGES: IndianLanguage[] = [
  { code: "en-IN", label: "EN (India)" },
  { code: "ta-IN", label: "தமிழ்" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "te-IN", label: "తెలుగు" },
  { code: "ml-IN", label: "മലയാളം" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
  { code: "bn-IN", label: "বাংলা" },
];

interface QuickEmoji {
  symbol: string;
  tooltip: string;
}

const QUICK_EMOJIS: QuickEmoji[] = [
  { symbol: "👍", tooltip: "Thumbs Up / Agree" },
  { symbol: "❤️", tooltip: "Love / Appreciate" },
  { symbol: "😊", tooltip: "Happy / Pleased" },
  { symbol: "🔥", tooltip: "Trending / Fire" },
  { symbol: "🙏", tooltip: "Namaste / Thanks" },
  { symbol: "🎉", tooltip: "Celebration / Success" },
  { symbol: "💡", tooltip: "Bright Idea / Insight" },
  { symbol: "📚", tooltip: "Study / Documentation" },
  { symbol: "🎯", tooltip: "Target / Goal Met" },
  { symbol: "👏", tooltip: "Applause / Well Done" },
  { symbol: "✨", tooltip: "Genie Magic / Sparkles" },
  { symbol: "🚀", tooltip: "Fast Launch / Progress" },
];

interface ThemePreset {
  id: string;
  name: string;
  primaryClass: string;
  bgLightClass: string;
  borderClass: string;
  textClass: string;
  gradientClass: string;
  canvasClass: string;
  canvasTextClass: string;
  canvasGradientClass: string;
  sidebarClass: string;
  chromeClass: string;
  chromeSurfaceClass: string;
  chromeBorderClass: string;
  chromeTextClass: string;
  chromeMutedTextClass: string;
}

const THEME_PRESETS: ThemePreset[] = [
  {
    id: "purple",
    name: "Royal Purple",
    primaryClass: "bg-purple-600 hover:bg-purple-700",
    bgLightClass: "bg-purple-50",
    borderClass: "border-purple-200",
    textClass: "text-purple-700",
    gradientClass: "from-purple-600 to-indigo-600",
    canvasClass: "bg-violet-50",
    canvasTextClass: "text-violet-950",
    canvasGradientClass: "from-violet-50 via-purple-50 to-indigo-50",
    sidebarClass: "bg-violet-100/95",
    chromeClass: "bg-violet-100",
    chromeSurfaceClass: "bg-white",
    chromeBorderClass: "border-purple-200",
    chromeTextClass: "text-slate-800",
    chromeMutedTextClass: "text-slate-600",
  },
  {
    id: "ocean",
    name: "Ocean Azure",
    primaryClass: "bg-sky-600 hover:bg-sky-700",
    bgLightClass: "bg-sky-50",
    borderClass: "border-sky-200",
    textClass: "text-sky-700",
    gradientClass: "from-sky-600 to-cyan-600",
    canvasClass: "bg-[#F0F2F6]",
    canvasTextClass: "text-sky-950",
    canvasGradientClass: "from-[#F0F2F6] via-sky-50 to-cyan-50",
    sidebarClass: "bg-sky-100/95",
    chromeClass: "bg-sky-100",
    chromeSurfaceClass: "bg-white",
    chromeBorderClass: "border-sky-200",
    chromeTextClass: "text-slate-800",
    chromeMutedTextClass: "text-slate-600",
  },
  {
    id: "emerald",
    name: "Emerald Forest",
    primaryClass: "bg-emerald-600 hover:bg-emerald-700",
    bgLightClass: "bg-emerald-50",
    borderClass: "border-emerald-200",
    textClass: "text-emerald-700",
    gradientClass: "from-emerald-600 to-teal-600",
    canvasClass: "bg-emerald-50",
    canvasTextClass: "text-emerald-950",
    canvasGradientClass: "from-emerald-50 via-green-50 to-teal-50",
    sidebarClass: "bg-emerald-100/95",
    chromeClass: "bg-emerald-100",
    chromeSurfaceClass: "bg-white",
    chromeBorderClass: "border-emerald-200",
    chromeTextClass: "text-slate-800",
    chromeMutedTextClass: "text-slate-600",
  },
  {
    id: "rose",
    name: "Sunset Rose",
    primaryClass: "bg-rose-600 hover:bg-rose-700",
    bgLightClass: "bg-rose-50",
    borderClass: "border-rose-200",
    textClass: "text-rose-700",
    gradientClass: "from-rose-600 to-pink-600",
    canvasClass: "bg-rose-50",
    canvasTextClass: "text-rose-950",
    canvasGradientClass: "from-rose-50 via-pink-50 to-orange-50",
    sidebarClass: "bg-rose-100/95",
    chromeClass: "bg-rose-100",
    chromeSurfaceClass: "bg-white",
    chromeBorderClass: "border-rose-200",
    chromeTextClass: "text-slate-800",
    chromeMutedTextClass: "text-slate-600",
  },
  {
    id: "amber",
    name: "Amber Flame",
    primaryClass: "bg-amber-600 hover:bg-amber-700",
    bgLightClass: "bg-amber-50",
    borderClass: "border-amber-200",
    textClass: "text-amber-700",
    gradientClass: "from-amber-600 to-orange-600",
    canvasClass: "bg-amber-50",
    canvasTextClass: "text-amber-950",
    canvasGradientClass: "from-amber-50 via-yellow-50 to-orange-50",
    sidebarClass: "bg-amber-100/95",
    chromeClass: "bg-amber-100",
    chromeSurfaceClass: "bg-white",
    chromeBorderClass: "border-amber-200",
    chromeTextClass: "text-slate-800",
    chromeMutedTextClass: "text-slate-600",
  },
  {
    id: "obsidian",
    name: "Midnight Obsidian",
    primaryClass: "bg-slate-800 hover:bg-slate-900",
    bgLightClass: "bg-slate-100",
    borderClass: "border-slate-300",
    textClass: "text-slate-800",
    gradientClass: "from-slate-800 to-slate-950",
    canvasClass: "bg-slate-100",
    canvasTextClass: "text-slate-900",
    canvasGradientClass: "from-slate-100 via-slate-200 to-zinc-100",
    sidebarClass: "bg-slate-200/95",
    chromeClass: "bg-slate-200",
    chromeSurfaceClass: "bg-white",
    chromeBorderClass: "border-slate-300",
    chromeTextClass: "text-slate-900",
    chromeMutedTextClass: "text-slate-600",
  },
];

const THEME_STORAGE_KEY = "genie_workspace_theme";
const ADMIN_EMAILS = ["rshaji93@gmail.com"];
const VIP_ALLOWED_EMAILS = ["rshaji93@gmail.com", "manoharlumina@gmail.com", "ratnaraja007@gmail.com"];
const DEVELOPER_EMAIL = "ratnaraja007@gmail.com";
const SUPPORT_DISPATCH_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@genie.ai";
const DAILY_FREE_LIMIT = 20;

interface RoomMember {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: "sovereign" | "admin" | "developer" | "member";
  status: "active" | "inactive";
  publicKey?: JsonWebKey;
  attendeeType?: "required" | "optional";
}

interface DiscoverableFriend {
  user_id: string;
  display_name: string;
  handle: string;
  avatar_url: string;
  is_online: boolean;
}

interface BlockedFriendProfile {
  user_id: string;
  display_name: string;
  handle: string;
  avatar_url: string;
}

interface SovereignRoomSummary {
  room_id: string;
  title: string;
  host_id: string;
  members: RoomMember[];
  updated_at: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
  text?: string;
  sender_id?: string;
  sender_name?: string;
  detail?: string;
  is_edited?: boolean;
  is_deleted?: boolean;
  delivered_to?: string[];
  read_by?: string[];
  reactions?: Record<string, string[]>;
  encrypted_payloads?: Record<string, RoomCiphertext>;
  sender_public_key?: JsonWebKey;
  senderName?: string;
  senderEmail?: string;
  source?: "gemini-3.8-flash" | "openrouter-fallback" | "backend-manifest" | "cloud_ai" | "local_agent" | "platform_engine";
  provider?: string;
  providerModel?: string;
  autoFallback?: boolean;
  agentName?: string;
  agentOutput?: {
    agent_name: string;
    status: string;
    logs: string[];
    actions: { label: string; value: string }[];
    results?: {
      title?: string;
      company?: string;
      location?: string;
      score?: number;
      verdict?: string;
      matched_skills?: string[];
      url?: string;
    }[];
  };
  replyTo?: { author: string; content: string };
  triggeredByRainbow?: boolean;
  isIntervention?: boolean;
  modelUsed?: string;
  extractedCode?: {
    title: string;
    language: string;
    code: string;
  };
}

interface ChatSession {
  id: string;
  title: string;
  isPinned: boolean;
  messages: Message[];
  topicId?: string;
  isSharedArchive?: boolean;
}

interface TopicChannel {
  id: string;
  title: string;
  icon: string;
  messages: Message[];
  message_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface ArchiveSummary {
  archive_key: string;
  message_count: number;
  saved_at: string;
  title?: string;
  room_id?: string;
  room_title?: string;
  host_name?: string;
  linked_handle?: string;
  meta_user_id?: string;
  thread_id?: string;
}

interface ArchiveManifest {
  personal: ArchiveSummary | null;
  social: ArchiveSummary[];
  team_rooms: ArchiveSummary[];
}

interface RestoredArchive extends ArchiveSummary {
  messages: Message[];
  executive_reviews?: Message[];
}

interface MetaAuthResponse {
  accessToken?: string;
  userID?: string;
}

interface MetaProfile {
  id?: string;
  name?: string;
  email?: string;
  picture?: { data?: { url?: string } };
}

interface RoomSocketEvent {
  type: string;
  action?: string;
  status?: "delivered" | "read";
  message?: Message;
  messages?: Message[];
  members?: Array<{ id?: string; user_id?: string; name?: string; display_name?: string; email?: string; avatar_url?: string; public_key?: JsonWebKey; status?: "active" | "inactive" }>;
  users?: Array<{ user_id: string; display_name: string; email?: string; avatar_url?: string; public_key?: JsonWebKey; status?: "active" | "inactive" }>;
  message_id?: string;
  id?: string;
  member_id?: string;
  user_id?: string;
  user_ids?: string[];
  delivered_to?: string[];
  read_by?: string[];
  reactions?: Record<string, string[]>;
  content?: string;
  text?: string;
  sender_id?: string;
  sender_name?: string;
  detail?: string;
}

const QUICK_ROOM_REACTIONS = ["❤️", "👍", "👏", "😂", "🔥", "🎉"];
const ROOM_EMOJI_OPTIONS = [
  ...QUICK_ROOM_REACTIONS, "😊", "🙏", "💡", "📚", "🎯", "✨", "🚀", "😍", "🥰",
  "🤔", "😮", "😢", "😡", "🤝", "✅", "❌", "⭐", "💯", "👀", "🙌", "🤩",
  "😎", "🥳", "💪", "🫡", "👏🏻", "💚", "💙", "💜", "🧡", "🤍", "🤣", "😴",
];

function normalizeRoomMessage(raw: Message): Message {
  const wire = raw as Message & {
    message_id?: string;
    user_id?: string;
    display_name?: string;
    edited?: boolean;
    deleted?: boolean;
    agent_name?: string;
    agent_output?: Message["agentOutput"];
  };
  const senderName = String(wire.sender_name || wire.display_name || wire.senderName || "Room member");
  const role = wire.role === "assistant" || senderName.includes("Personal AI Genie") ? "assistant" : "user";
  const content = String(wire.content || wire.text || "");
  return {
    ...wire,
    id: String(wire.id || wire.message_id || ""),
    role,
    content: wire.is_deleted || wire.deleted ? "This message was deleted" : content,
    text: wire.is_deleted || wire.deleted ? "This message was deleted" : content,
    sender_id: String(wire.sender_id || wire.user_id || ""),
    sender_name: senderName,
    senderName,
    agentName: wire.agentName || wire.agent_name,
    agentOutput: wire.agentOutput || wire.agent_output,
    is_edited: Boolean(wire.is_edited || wire.edited),
    is_deleted: Boolean(wire.is_deleted || wire.deleted),
    delivered_to: Array.isArray(wire.delivered_to) ? wire.delivered_to : [],
    read_by: Array.isArray(wire.read_by) ? wire.read_by : [],
    reactions: wire.reactions && typeof wire.reactions === "object" ? wire.reactions : {},
  };
}

function isRoomCiphertext(value: unknown): value is RoomCiphertext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RoomCiphertext>;
  return candidate.v === 1 && typeof candidate.iv === "string" && typeof candidate.ciphertext === "string";
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string"
  );
}

async function decryptArchivedMessages(storedMessages: unknown[]): Promise<Message[]> {
  let parsed: unknown[] = storedMessages;
  if (storedMessages.length === 1 && isRoomCiphertext(storedMessages[0])) {
    parsed = await decryptArchiveMessages(storedMessages[0]);
  }
  if (!parsed.every(isMessage)) {
    throw new Error("The selected archive contains an invalid message payload.");
  }
  return parsed;
}

interface MetaSdk {
  init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
  login: (
    callback: (response: { authResponse?: MetaAuthResponse }) => void,
    options: { scope: string }
  ) => void;
  api: (
    path: string,
    callback: (profile: MetaProfile & { error?: { message?: string } }) => void
  ) => void;
}

interface MetaWindow extends Window {
  FB?: MetaSdk;
  fbAsyncInit?: () => void;
  __genieMetaInitialized?: boolean;
}

function GenieAvatar({
  src,
  alt,
  className = "w-8 h-8 rounded-full",
}: {
  src?: string;
  alt?: string;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const isInvalid = !src || hasError || src.includes("default-user");

  if (isInvalid) {
    return (
      <div
        className={`${className} flex items-center justify-center bg-gradient-to-tr from-violet-600 via-pink-500 to-amber-400 text-white shadow-xs select-none p-1.5 flex-shrink-0`}
        title={alt || "Personal AI Genie"}
      >
        <Sparkles className="w-full h-full text-white drop-shadow-sm" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || "Avatar"}
      onError={() => setHasError(true)}
      className={`${className} object-cover flex-shrink-0`}
    />
  );
}

function sanitizeGenieOutput(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/#{1,6}\s?/g, "")
    .trim();
}

function extractCodeBlock(raw: string): { title: string; language: string; code: string } | null {
  const match = raw.match(/```(\w+)?\n([\s\S]*?)```/);
  if (match) {
    return {
      language: match[1] || "typescript",
      title: "Personal AI Genie Code Artifact",
      code: match[2].trim(),
    };
  }
  return null;
}

// ========================================================================= //
// SECTION 2: AUTHENTICATION, INITIALIZATION & PERSISTED SESSION STORAGE     //
// ========================================================================= //

function MainChatApp() {
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemePreset>(THEME_PRESETS[1]);
  const selectedTheme = currentTheme;
  const setSelectedTheme = setCurrentTheme;
  const [themeReady, setThemeReady] = useState(false);

  const [hasAgreedToTerms, setHasAgreedToTerms] = useState(false);
  const [termsPromptWarning, setTermsPromptWarning] = useState(false);

  const [spaceMode, setSpaceMode] = useState<"personal" | "workspace">("personal");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDockHidden, setIsDockHidden] = useState(false);
  const [isTeamMode, setIsTeamMode] = useState(false);
  const [isObserverActive, setIsObserverActive] = useState(false);

  const [dailyUsageCount, setDailyUsageCount] = useState<number>(0);
  const [isVipSessionActive, setIsVipSessionActive] = useState(false);
  const [vipSessionLimitReached, setVipSessionLimitReached] = useState(false);
  const [activeVipSessionCount, setActiveVipSessionCount] = useState(0);
  const [quotaExceededModalOpen, setQuotaExceededModalOpen] = useState(false);
  const [activeModelName, setActiveModelName] = useState<string>("gemini-3.8-flash");

  const [roomId, setRoomId] = useState("GENIE-TEAM-MAIN");
  const [roomTitle, setRoomTitle] = useState("GENIE TEAM MAIN");
  const [roomPasscode, setRoomPasscode] = useState("842-109");
  const [roomPasscodeRoomId, setRoomPasscodeRoomId] = useState("");
  const [enteredRoomPasscode, setEnteredRoomPasscode] = useState("");
  const [isRoomUnlocked, setIsRoomUnlocked] = useState(false);
  const [roomGateError, setRoomGateError] = useState(false);
  const [confirmRegenerateModalOpen, setConfirmRegenerateModalOpen] = useState(false);

  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const [requiredAttendees, setRequiredAttendees] = useState("");
  const [optionalAttendees, setOptionalAttendees] = useState("");
  const [meetingAgenda, setMeetingAgenda] = useState("");
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  const [activeCanvas, setActiveCanvas] = useState<{
    title: string;
    language: string;
    code: string;
  } | null>(null);
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [canvasCopied, setCanvasCopied] = useState(false);

  const [userProfile, setUserProfile] = useState({
    name: "Guest User",
    email: "",
    avatarUrl: "",
    role: "professional" as "student" | "professional",
    profession: "Healthcare Revenue Cycle & Client Operations",
    ageGroup: "pro",
    gender: "male",
    customApiKey: "",
    totpPasscode: "",
    authProvider: "" as "" | "google" | "meta",
    providerId: "",
    socialHandle: "",
    socialAvatarUrl: "",
    socialProfileId: "",
    isDiscoverable: false,
  });
  const [googleIdToken, setGoogleIdToken] = useState("");
  const [guestId, setGuestId] = useState("");

  const [isTotpVerified, setIsTotpVerified] = useState(false);
  const [isTotpVerifying, setIsTotpVerifying] = useState(false);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [roomCryptoIdentity, setRoomCryptoIdentity] = useState<RoomCryptoIdentity | null>(null);
  const [discoverableFriends, setDiscoverableFriends] = useState<DiscoverableFriend[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedFriendProfile[]>([]);
  const [blockTarget, setBlockTarget] = useState<BlockedFriendProfile | DiscoverableFriend | null>(null);
  const [friendMenuUserId, setFriendMenuUserId] = useState<string | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [sovereignRooms, setSovereignRooms] = useState<SovereignRoomSummary[]>([]);
  const [friendsQueueOpen, setFriendsQueueOpen] = useState(false);
  const [friendsQueueError, setFriendsQueueError] = useState<string | null>(null);
  const [isFriendsLoading, setIsFriendsLoading] = useState(false);
  const [roomAdminOpen, setRoomAdminOpen] = useState(false);
  const [roomCapacityMode, setRoomCapacityMode] = useState<RoomCapacityMode>("unlimited");
  const [customRoomCapacity, setCustomRoomCapacity] = useState(10);

  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: "1", title: "New Session", isPinned: false, messages: [] },
  ]);
  const [sessionsHydrated, setSessionsHydrated] = useState(false);
  const [topics, setTopics] = useState<TopicChannel[]>([
    { id: "topic_1", title: "General", icon: "💬", messages: [] },
  ]);
  const [activeTopicId, setActiveTopicId] = useState("topic_1");
  const [isTopicLoading, setIsTopicLoading] = useState(false);
  const [topicsStorageOwner, setTopicsStorageOwner] = useState("");
  const [personalMessages, setPersonalMessages] = useState<Message[]>([]);
  const [roomMessages, setRoomMessages] = useState<Message[]>([]);
  const [archivedRoomMessages, setArchivedRoomMessages] = useState<Record<string, Message[]>>({});
  const [archivedRoomKinds, setArchivedRoomKinds] = useState<Record<string, "social" | "team_rooms">>({});
  const [currentSessionId, setCurrentSessionId] = useState("1");
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const [replyTarget, setReplyTarget] = useState<{ author: string; content: string } | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareSessionId, setShareSessionId] = useState<string | null>(null);
  const [shareInviteSessionId, setShareInviteSessionId] = useState<string | null>(null);
  const shareTranscriptRef = useRef<Message[] | null>(null);
  const shareTranscriptOwnerRef = useRef("");
  const shareTranscriptSentRef = useRef(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveManifest, setArchiveManifest] = useState<ArchiveManifest>({
    personal: null,
    social: [],
    team_rooms: [],
  });
  const [selectedArchiveItems, setSelectedArchiveItems] = useState<Set<string>>(new Set());
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [isSavingArchive, setIsSavingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<"profile" | "developer" | "totp" | "theme" | "docs" | "blocked">("profile");
  const [reportType, setReportType] = useState<"ai_issue" | "ui_request">("ai_issue");
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketStatus, setTicketStatus] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [metaLoginError, setMetaLoginError] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState<IndianLanguage>(INDIAN_LANGUAGES[0]);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingPreview, setStreamingPreview] = useState("");
  const [streamingProvider, setStreamingProvider] = useState<{ provider: string; model: string } | null>(null);
  const [streamingAutoFallback, setStreamingAutoFallback] = useState(false);
  const activeChatAbortControllerRef = useRef<AbortController | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const vipSessionIdRef = useRef<string | null>(null);
  const roomSocketRef = useRef<WebSocket | null>(null);
  const archivePromptedRef = useRef(false);
  const readReceiptIdsRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const API_BASE = getBackendBaseUrl();

  const GOOGLE_CLIENT_ID =
    "767453349146-honr4mjea5jgv23andq145fqtcjdor0t.apps.googleusercontent.com";
  const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID?.trim() || "";

  const isCorporateDomain =
    Boolean(userProfile.email) &&
    !userProfile.email.endsWith("@gmail.com") &&
    !userProfile.email.endsWith("@yahoo.com") &&
    !userProfile.email.endsWith("@outlook.com") &&
    !userProfile.email.endsWith("@hotmail.com") &&
    userProfile.email.includes("@");

  const isDevUser = userProfile.email.toLowerCase() === DEVELOPER_EMAIL.toLowerCase();
  const isMasterAdmin = userProfile.email.trim().toLowerCase() === "rshaji93@gmail.com";
  const isPlatformHost = ADMIN_EMAILS.includes(userProfile.email.toLowerCase());
  const isKeyOwner = Boolean(userProfile.customApiKey) || isPlatformHost;

  const isVipEligible =
    Boolean(googleIdToken) && VIP_ALLOWED_EMAILS.includes(userProfile.email.toLowerCase());
  const isVipUser = isVipEligible && isVipSessionActive;

  const isQuotaEnforced = !isMasterAdmin && !isVipUser && !userProfile.customApiKey;
  const remainingDailyChats = isMasterAdmin ? 999999 : Math.max(0, DAILY_FREE_LIMIT - dailyUsageCount);
  const activeRoomMemberCount = members.filter((member) => member.status === "active").length;
  const roomMemberCount = members.length;
  const roomCapacityLimit =
    roomCapacityMode === "pair"
      ? 2
      : roomCapacityMode === "squad"
      ? 10
      : roomCapacityMode === "custom"
      ? customRoomCapacity
      : null;
  const roomCapacityLabel = roomCapacityLimit === null ? "Unlimited" : roomCapacityLimit.toString();

  const currentSession = sessions.find((s) => s.id === currentSessionId) || sessions[0];
  const activeTopic = topics.find((topic) => topic.id === activeTopicId) || topics[0];
  const messages = isTeamMode
    ? roomMessages
    : currentSession?.isSharedArchive
    ? currentSession.messages
    : activeTopic?.messages || personalMessages;
  const roomIdentity = userProfile.providerId ? `google:${userProfile.providerId}` : "";

  function sendRoomEvent(event: Record<string, unknown>): boolean {
    const socket = roomSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setChatError("The shared room is not connected yet. Please wait for the room to reconnect.");
      return false;
    }
    socket.send(JSON.stringify(event));
    return true;
  }

  async function sendEncryptedRoomEvent(event: Record<string, unknown>): Promise<boolean> {
    return encryptAndSendRoomEvent(event, members);
  }

  async function encryptAndSendRoomEvent(
    event: Record<string, unknown>,
    roomMembers: RoomMember[]
  ): Promise<boolean> {
    const content = event.content;
    if (typeof content !== "string" || !roomCryptoIdentity) {
      setChatError("Encrypted room messaging is not ready. Please wait for the secure room to connect.");
      return false;
    }
    try {
      const encryptedPayloads = await encryptRoomMessage(
        content,
        roomCryptoIdentity,
        roomIdentity,
        roomMembers.map((member) => ({ id: member.id, publicKey: member.publicKey }))
      );
      const encryptedEvent: Record<string, unknown> = {
        ...event,
        encrypted_payloads: encryptedPayloads,
      };
      delete encryptedEvent.content;
      return sendRoomEvent(encryptedEvent);
    } catch (error) {
      console.error("Room message encryption failed:", error);
      setChatError(error instanceof Error ? error.message : "Could not encrypt the room message.");
      return false;
    }
  }

  async function publishPendingShareTranscript(roomMembers: RoomMember[]) {
    const transcript = shareTranscriptRef.current;
    if (
      !transcript ||
      shareTranscriptSentRef.current ||
      !roomId.startsWith("share_") ||
      roomIdentity !== shareTranscriptOwnerRef.current ||
      roomMembers.filter((member) => member.status === "active").length < 2
    ) {
      return;
    }
    shareTranscriptSentRef.current = true;
    for (const message of transcript) {
      if (message.is_deleted) continue;
      const sent = await encryptAndSendRoomEvent(
        {
          type: "message.send",
          content: message.content,
          sender_name: message.senderName || message.sender_name || userProfile.name,
          sender_type: message.role === "assistant" ? "assistant" : "user",
        },
        roomMembers
      );
      if (!sent) {
        setChatError("The shared transcript could not be transferred to the invite room.");
        return;
      }
    }
    shareTranscriptRef.current = null;
  }

  async function decodeRoomWireMessage(message: Message): Promise<Message> {
    const normalized = normalizeRoomMessage(message);
    if (normalized.is_deleted) return normalized;
    if (!message.encrypted_payloads || !roomCryptoIdentity) {
      return {
        ...normalized,
        content: "This message is unavailable because it is not encrypted for this room.",
        text: "This message is unavailable because it is not encrypted for this room.",
      };
    }
    if (!message.encrypted_payloads[roomIdentity]) {
      return {
        ...normalized,
        content: "This message is unavailable to this room member.",
        text: "This message is unavailable to this room member.",
      };
    }
    const content = await decryptRoomMessage(
      message.encrypted_payloads,
      roomCryptoIdentity,
      roomIdentity,
      normalized.sender_id || "",
      message.sender_public_key || {}
    );
    return { ...normalized, content, text: content };
  }

  // Restore authenticated session from localStorage on initial load
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const pathShareRoom = window.location.pathname.match(/^\/room\/(share_[A-Za-z0-9_-]+)\/?$/)?.[1];
        const initialRoomId =
          pathShareRoom || new URLSearchParams(window.location.search).get("room");
        if (initialRoomId) {
          setRoomId(initialRoomId);
          setIsTeamMode(true);
          if (initialRoomId.startsWith("share_")) setIsRoomUnlocked(true);
        }
        const storedSessions =
          localStorage.getItem("genie_chat_sessions_v2") ||
          localStorage.getItem("genie_chat_sessions");
        if (storedSessions) {
          const parsedSessions: unknown = JSON.parse(storedSessions);
          const restoredSessions = Array.isArray(parsedSessions)
            ? parsedSessions
            : (parsedSessions as { sessions?: unknown[] }).sessions;
          if (Array.isArray(restoredSessions) && restoredSessions.length > 0) {
            const validSessions = restoredSessions.filter(
              (session): session is ChatSession =>
                Boolean(session) &&
                typeof session === "object" &&
                typeof (session as ChatSession).id === "string" &&
                typeof (session as ChatSession).title === "string" &&
                Array.isArray((session as ChatSession).messages)
            );
            if (validSessions.length > 0) {
              setSessions(validSessions);
              setCurrentSessionId(validSessions[0].id);
            }
          }
        }
        setSessionsHydrated(true);
        const savedGuestId = localStorage.getItem("genie_guest_id");
        if (savedGuestId) setGuestId(savedGuestId);
        else {
          const newGuestId = window.crypto.randomUUID();
          localStorage.setItem("genie_guest_id", newGuestId);
          setGuestId(newGuestId);
        }
        const restoredGoogleToken = sessionStorage.getItem("genie_google_id_token") || "";
        setGoogleIdToken(restoredGoogleToken);

        try {
          const storedThemeId = localStorage.getItem(THEME_STORAGE_KEY);
          const storedTheme = THEME_PRESETS.find((theme) => theme.id === storedThemeId);
          if (storedTheme) setCurrentTheme(storedTheme);
        } catch (error) {
          console.error("Theme restoration error", error);
        }

        if (window.innerWidth >= 1024) {
          setSidebarOpen(true);
        }

        try {
          const savedAuth = localStorage.getItem("genie_is_authenticated");
          const savedProfile = localStorage.getItem("genie_user_profile");
          const savedAgreed = localStorage.getItem("genie_terms_agreed");

          if (savedAuth === "true" && savedProfile) {
            const parsedProfile = JSON.parse(savedProfile);
            setUserProfile((prev) => ({ ...prev, ...parsedProfile, customApiKey: "" }));
            setIsAuthenticated(parsedProfile.authProvider === "google" && Boolean(restoredGoogleToken));
            setHasAgreedToTerms(savedAgreed === "true");
          }
        } catch (error) {
          console.error("Session restoration error", error);
        }
      }
    } catch (error) {
      console.error("Workspace initialization error", error);
    } finally {
      setThemeReady(true);
      setMounted(true);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let active = true;
    void loadRoomCryptoIdentity()
      .then((identity) => {
        if (active) setRoomCryptoIdentity(identity);
      })
      .catch((error: unknown) => {
        console.error("Secure room identity initialization failed:", error);
        setChatError(
          error instanceof Error
            ? `Secure room identity initialization failed: ${error.message}`
            : "Secure room identity initialization failed."
        );
      });
    return () => {
      active = false;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const storageOwner = userProfile.providerId || guestId || "guest";
    try {
      const storedTopics = localStorage.getItem(`genie_topics_v1_${storageOwner}`);
      if (storedTopics) {
        const parsed: unknown = JSON.parse(storedTopics);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.length <= 10 &&
          parsed.every((topic) =>
            typeof topic?.id === "string" &&
            typeof topic?.title === "string" &&
            typeof topic?.icon === "string" &&
            Array.isArray(topic?.messages)
          )
        ) {
          setTopics(parsed as TopicChannel[]);
          setActiveTopicId((current) => parsed.some((topic) => topic.id === current) ? current : parsed[0].id);
        }
      }
      setTopicsStorageOwner(storageOwner);
    } catch (error) {
      console.error("Topic channel restoration failed:", error);
      setChatError("Saved topic channels could not be restored from this browser.");
    }
  }, [mounted, userProfile.providerId, guestId]);

  useEffect(() => {
    if (!mounted || !topicsStorageOwner) return;
    try {
      localStorage.setItem(
        `genie_topics_v1_${topicsStorageOwner}`,
        JSON.stringify(topics.slice(0, 10))
      );
    } catch (error) {
      console.error("Topic channel persistence failed:", error);
      setChatError("Topic channel changes could not be saved in this browser.");
    }
  }, [mounted, topics, topicsStorageOwner]);

  useEffect(() => {
    if (!mounted || !isAuthenticated || !googleIdToken || !userProfile.providerId) return;
    let active = true;
    setIsTopicLoading(true);
    void fetch(
      `${API_BASE}/api/personal/topics?user_id=${encodeURIComponent(userProfile.providerId)}`,
      { headers: { Authorization: `Bearer ${googleIdToken}` } }
    )
      .then(async (response) => {
        const result = (await response.json()) as {
          topics?: TopicChannel[];
          detail?: string;
        };
        if (!response.ok) throw new Error(result.detail || `Topic channels failed to load (HTTP ${response.status}).`);
        if (!Array.isArray(result.topics) || result.topics.length < 1 || result.topics.length > 10) {
          throw new Error("The topic service returned an invalid channel list.");
        }
        if (!active) return;
        setTopics(result.topics);
        setActiveTopicId((current) => result.topics!.some((topic) => topic.id === current) ? current : result.topics![0].id);
        setTopicsStorageOwner(userProfile.providerId);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("Topic channel sync failed:", error);
        setChatError(error instanceof Error ? error.message : "Topic channels could not be synchronized.");
      })
      .finally(() => {
        if (active) setIsTopicLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mounted, isAuthenticated, googleIdToken, userProfile.providerId, API_BASE]);

  useEffect(() => {
    if (!mounted) return;
    try {
      if (roomId.startsWith("share_")) {
        setRoomPasscode("842-109");
        setEnteredRoomPasscode("842-109");
        setIsRoomUnlocked(true);
        setRoomPasscodeRoomId(roomId);
        return;
      }
      const savedPasscode = localStorage.getItem(`genie_room_passcode_${roomId}`);
      setRoomPasscode(savedPasscode || "842-109");
      setEnteredRoomPasscode(savedPasscode || "");
      setIsRoomUnlocked(Boolean(savedPasscode));
      setRoomGateError(false);
    } catch (error) {
      console.error("Room passcode restoration failed:", error);
      setRoomPasscode("842-109");
      setEnteredRoomPasscode("");
      setIsRoomUnlocked(false);
    }
    setRoomPasscodeRoomId(roomId);
  }, [mounted, roomId]);

  useEffect(() => {
    if (!roomCryptoIdentity || !googleIdToken) return;
    void fetch(`${API_BASE}/api/crypto/public-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        google_id_token: googleIdToken,
        public_key: roomCryptoIdentity.publicKey,
      }),
    })
      .then(async (response) => {
        const result = (await response.json()) as { detail?: string };
        if (!response.ok) {
          throw new Error(result.detail || `Secure identity registration failed (HTTP ${response.status}).`);
        }
      })
      .catch((error: unknown) => {
        console.error("Secure identity registration failed:", error);
        setChatError(error instanceof Error ? error.message : "Could not register the secure room identity.");
      });
  }, [roomCryptoIdentity, googleIdToken, API_BASE]);

  useEffect(() => {
    if (isTeamMode) return;
    const selectedSession = sessions.find((session) => session.id === currentSessionId);
    if (selectedSession) {
      setPersonalMessages(selectedSession.messages);
      if (selectedSession.topicId) setActiveTopicId(selectedSession.topicId);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (!mounted || !sessionsHydrated) return;
    try {
      localStorage.setItem("genie_chat_sessions_v2", JSON.stringify(sessions));
    } catch (error) {
      console.error("Chat session persistence failed:", error);
    }
  }, [mounted, sessionsHydrated, sessions]);

  useEffect(() => {
    if (themeReady) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, currentTheme.id);
      } catch (error) {
        console.error("Theme persistence error", error);
      }
    }
  }, [currentTheme, themeReady]);

  useEffect(() => {
    if (!mounted || !isAuthenticated || !googleIdToken || archivePromptedRef.current) return;
    archivePromptedRef.current = true;
    void loadArchiveManifest(true);
  }, [mounted, isAuthenticated, googleIdToken]);

  useEffect(() => {
    if (!isTeamMode || !archivedRoomMessages[roomId]) return;
    setRoomMessages(archivedRoomMessages[roomId]);
  }, [roomId, isTeamMode, archivedRoomMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (userProfile.email && typeof window !== "undefined") {
      const today = new Date().toISOString().split("T")[0];
      const storageKey = `genie_quota_${userProfile.email}_${today}`;
      const savedCount = parseInt(localStorage.getItem(storageKey) || "0", 10);
      setDailyUsageCount(savedCount);
    }
  }, [userProfile.email]);

  useEffect(() => {
    if (
      !mounted ||
      !isAuthenticated ||
      !isTeamMode ||
      !roomCryptoIdentity ||
      roomPasscodeRoomId !== roomId ||
      archivedRoomKinds[roomId] === "social" ||
      (!isRoomUnlocked && !isKeyOwner)
    ) {
      roomSocketRef.current?.close();
      roomSocketRef.current = null;
      return;
    }

    if (!googleIdToken || !roomIdentity) {
      setChatError("Sign in with Google before joining a shared room.");
      return;
    }

    const socketBase = API_BASE.replace(/^http/, "ws");
    const socket = new WebSocket(
      `${socketBase}/ws/rooms/${encodeURIComponent(roomId)}`
    );
    roomSocketRef.current = socket;
    readReceiptIdsRef.current.clear();

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "room.join",
          google_id_token: googleIdToken,
          display_name: userProfile.socialHandle || userProfile.name,
          avatar_url: userProfile.socialAvatarUrl || userProfile.avatarUrl,
          public_key: roomCryptoIdentity.publicKey,
          room_title: roomTitle,
          host_id: roomIdentity,
          room_passcode: enteredRoomPasscode.trim() || roomPasscode,
        })
      );
    });

    socket.addEventListener("message", (event) => {
      let update: RoomSocketEvent;
      try {
        update = JSON.parse(event.data) as RoomSocketEvent;
      } catch (error) {
        console.error("Ignoring malformed room WebSocket event:", error);
        return;
      }

      if (update.type === "room_state") {
        try {
          localStorage.setItem(
            `genie_room_passcode_${roomId}`,
            enteredRoomPasscode.trim() || roomPasscode
          );
        } catch (error) {
          console.error("Could not persist the authorized room passcode:", error);
        }
        if (Array.isArray(update.messages)) {
          const restoredMessages = archivedRoomMessages[roomId] || [];
          void Promise.all(update.messages.map(decodeRoomWireMessage))
            .then((decodedMessages) => {
              const combinedMessages = new Map(restoredMessages.map((message) => [message.id, message]));
              decodedMessages.forEach((message) => combinedMessages.set(message.id, message));
              setRoomMessages([...combinedMessages.values()]);
            })
            .catch((error: unknown) => {
              console.error("Could not decrypt restored room messages:", error);
              setChatError(error instanceof Error ? error.message : "Could not decrypt room history.");
            });
        }
        if (Array.isArray(update.members)) {
          setMembers(update.members.map((member) => {
            const id = member.id || member.user_id || "";
            return {
              id,
              name: member.name || member.display_name || "Room member",
              email: member.email || id.replace(/^google:/, ""),
              avatarUrl: member.avatar_url,
              publicKey: member.public_key,
              role: id === roomIdentity ? "sovereign" : "member",
              status: member.status || "active",
            };
          }));
        }
        return;
      }

      if (update.type === "presence" && update.users) {
        const nextMembers: RoomMember[] = update.users.map((member) => ({
          id: member.user_id,
          name: member.display_name,
          email: member.email || "",
          avatarUrl: member.avatar_url,
          publicKey: member.public_key,
          role: member.user_id === roomIdentity ? "sovereign" : "member",
          status: member.status || "active",
        }));
        setMembers(nextMembers);
        void publishPendingShareTranscript(nextMembers);
        return;
      }

      if (update.type === "message" && update.message) {
        void decodeRoomWireMessage(update.message)
          .then((message) => {
            setRoomMessages((previous) => {
              const exists = previous.some((item) => item.id === message.id);
              if (update.action === "edit" || update.action === "delete") {
                return previous.map((item) => item.id === message.id ? message : item);
              }
              return exists ? previous : [...previous, message];
            });
          })
          .catch((error: unknown) => {
            console.error("Could not decrypt a room message:", error);
            setChatError(error instanceof Error ? error.message : "Could not decrypt a room message.");
          });
        return;
      }

      const messageId = update.message_id || update.id;
      if (update.type === "message_reaction" && messageId && update.reactions) {
        setRoomMessages((previous) =>
          previous.map((message) =>
            message.id === messageId ? { ...message, reactions: update.reactions } : message
          )
        );
        return;
      }
      if (update.type === "receipt" && messageId && update.status) {
        setRoomMessages((previous) =>
          previous.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  delivered_to:
                    update.status === "delivered"
                      ? update.user_ids || [...(message.delivered_to || []), update.user_id || ""]
                      : message.delivered_to,
                  read_by:
                    update.status === "read"
                      ? update.user_ids || [...(message.read_by || []), update.user_id || ""]
                      : message.read_by,
                }
              : message
          )
        );
      } else if (update.type === "error") {
        setChatError(update.detail || "The room service rejected an event.");
      }
    });

    socket.addEventListener("error", (error) => {
      console.error("Room WebSocket error:", error);
      setChatError("Room connection failed. Check the backend WebSocket service and try reconnecting.");
    });
    socket.addEventListener("close", (event) => {
      if (event.code === 1008) {
        setChatError(event.reason || "Google identity verification failed for the shared room.");
        if (/passcode|membership|room access/i.test(event.reason)) {
          setIsRoomUnlocked(false);
          setEnteredRoomPasscode("");
        }
      }
    });

    return () => {
      socket.close();
      if (roomSocketRef.current === socket) roomSocketRef.current = null;
    };
  }, [
    mounted,
    isAuthenticated,
    isTeamMode,
    isRoomUnlocked,
    isKeyOwner,
    roomId,
    archivedRoomKinds,
    archivedRoomMessages,
    API_BASE,
    userProfile.providerId,
    userProfile.name,
    userProfile.socialHandle,
    userProfile.email,
    userProfile.avatarUrl,
    userProfile.socialAvatarUrl,
    googleIdToken,
    roomIdentity,
    roomCryptoIdentity,
    roomTitle,
    enteredRoomPasscode,
    roomPasscode,
    roomPasscodeRoomId,
  ]);

  useEffect(() => {
    if (!isTeamMode || roomSocketRef.current?.readyState !== WebSocket.OPEN) return;
    roomMessages.forEach((message) => {
      if (
        message.id &&
        message.sender_id !== roomIdentity &&
        !message.is_deleted
        && !readReceiptIdsRef.current.has(message.id)
      ) {
        readReceiptIdsRef.current.add(message.id);
        roomSocketRef.current?.send(
          JSON.stringify({
            type: "receipt.read",
            message_id: message.id,
          })
        );
      }
    });
  }, [roomMessages, isTeamMode, roomIdentity]);

  useEffect(() => {
    if (!mounted || !isAuthenticated || !isVipEligible) {
      setIsVipSessionActive(false);
      setVipSessionLimitReached(false);
      setActiveVipSessionCount(0);
      return;
    }

    let active = true;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    const vipSessionId =
      vipSessionIdRef.current || (vipSessionIdRef.current = window.crypto.randomUUID());

    const updateSession = async (action: "acquire" | "heartbeat" | "release") => {
      try {
        const response = await fetch(`${API_BASE}/api/vip/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: vipSessionId,
            user_email: userProfile.email,
            google_id_token: googleIdToken,
            is_vip: true,
            action,
          }),
          keepalive: action === "release",
        });
        const result = (await response.json()) as {
          active?: boolean;
          active_count?: number;
          limit?: number;
          detail?: string;
        };
        if (!response.ok) throw new Error(result.detail || `VIP session request failed (${response.status}).`);
        if (active && action !== "release") {
          setIsVipSessionActive(result.active === true);
          setVipSessionLimitReached(result.active === false);
          setActiveVipSessionCount(result.active_count || 0);
        }
      } catch (error) {
        if (active && action !== "release") {
          setIsVipSessionActive(false);
          setVipSessionLimitReached(false);
          console.error("VIP session presence update failed:", error);
        }
      }
    };

    void updateSession("acquire");
    heartbeatTimer = setInterval(() => void updateSession("heartbeat"), 30_000);

    return () => {
      active = false;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      void updateSession("release");
    };
  }, [mounted, isAuthenticated, isVipEligible, userProfile.email, googleIdToken, API_BASE]);

  // Google OAuth Initializer
  useEffect(() => {
    if (!mounted || !GOOGLE_CLIENT_ID) return;

    const setupGoogleAuth = () => {
      const google = (window as any).google;
      if (!google?.accounts?.id) return;
      if ((window as any).__gsi_auth_active) return;

      try {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response: any) => {
            try {
              const base64Url = response.credential.split(".")[1];
              const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
              const jsonPayload = decodeURIComponent(
                atob(base64)
                  .split("")
                  .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                  .join("")
              );
              const data = JSON.parse(jsonPayload);

              const updatedProfile = {
                name: data.name || "User",
                email: data.email || "",
                avatarUrl: data.picture || "",
                authProvider: "google" as const,
                providerId: data.sub || "",
                role: "professional" as const,
                profession: "Healthcare Revenue Cycle & Client Operations",
                ageGroup: "pro",
                gender: "male",
                customApiKey: "",
                totpPasscode: "",
                socialHandle: "",
                socialAvatarUrl: "",
                socialProfileId: "",
              };

              setUserProfile((prev) => ({ ...prev, ...updatedProfile }));
              setGoogleIdToken(response.credential);
              setIsAuthenticated(true);
              setHasAgreedToTerms(true);

              if (typeof window !== "undefined") {
                localStorage.setItem("genie_is_authenticated", "true");
                localStorage.setItem("genie_user_profile", JSON.stringify(updatedProfile));
                localStorage.setItem("genie_terms_agreed", "true");
                sessionStorage.setItem("genie_google_id_token", response.credential);
              }
            } catch (err) {
              console.error("Token decoding error", err);
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        (window as any).__gsi_auth_active = true;

        if (!isAuthenticated) {
          const btnContainer = document.getElementById("googleSignInBtn");
          if (btnContainer) {
            google.accounts.id.renderButton(btnContainer, {
              theme: "outline",
              size: "large",
              width: 300,
              text: "continue_with",
              shape: "pill",
            });
          }
        }
      } catch (e) {
        console.error("Google Auth init failed", e);
      }
    };

    if ((window as any).google?.accounts?.id) {
      setupGoogleAuth();
    } else {
      const timer = setInterval(() => {
        if ((window as any).google?.accounts?.id) {
          clearInterval(timer);
          setupGoogleAuth();
        }
      }, 350);
      return () => clearInterval(timer);
    }
  }, [mounted, GOOGLE_CLIENT_ID, isAuthenticated]);

  const initializeMetaSdk = () => {
    if (!FACEBOOK_APP_ID || typeof window === "undefined") return;
    const metaWindow = window as MetaWindow;
    const initialize = () => {
      if (!metaWindow.FB || metaWindow.__genieMetaInitialized) return;
      metaWindow.FB.init({
        appId: FACEBOOK_APP_ID,
        cookie: true,
        xfbml: false,
        version: "v19.0",
      });
      metaWindow.__genieMetaInitialized = true;
    };
    if (metaWindow.FB) initialize();
    else metaWindow.fbAsyncInit = initialize;
  };

  useEffect(() => {
    if (mounted && FACEBOOK_APP_ID) initializeMetaSdk();
  }, [mounted, FACEBOOK_APP_ID]);

  const handleMetaLogin = () => {
    setMetaLoginError(null);
    if (!isAuthenticated) {
      setMetaLoginError("Sign in with Google before linking an optional social profile.");
      return;
    }
    if (!FACEBOOK_APP_ID) {
      setMetaLoginError("Meta login is not configured. Set NEXT_PUBLIC_FACEBOOK_APP_ID and restart the frontend.");
      return;
    }

    const metaWindow = window as MetaWindow;
    if (!metaWindow.FB || !metaWindow.__genieMetaInitialized) {
      setMetaLoginError("Meta login is still initializing. Please try again in a moment.");
      return;
    }

    metaWindow.FB.login(
      (loginResponse) => {
        if (!loginResponse.authResponse?.userID) {
          setMetaLoginError("Meta sign-in was cancelled or could not be authorized.");
          return;
        }

        metaWindow.FB?.api("/me?fields=id,name,picture", (profile) => {
          if (profile.error || !profile.id) {
            setMetaLoginError(profile.error?.message || "Could not load your Meta profile.");
            return;
          }

          const metaAccessToken = loginResponse.authResponse?.accessToken;
          if (!metaAccessToken) {
            setMetaLoginError("Meta did not provide a profile-verification token.");
            return;
          }
          void fetch(`${API_BASE}/api/social/discovery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              google_id_token: googleIdToken,
              meta_access_token: metaAccessToken,
              meta_user_id: profile.id,
              handle: profile.name || profile.id,
            }),
          })
            .then(async (response) => {
              const result = (await response.json()) as { detail?: string; is_discoverable?: boolean };
              if (!response.ok || !result.is_discoverable) {
                throw new Error(result.detail || `Meta profile verification failed (HTTP ${response.status}).`);
              }
              setUserProfile((previous) => {
                const updatedProfile = {
                  ...previous,
                  socialProfileId: profile.id!,
                  socialHandle: profile.name || profile.id!,
                  socialAvatarUrl: profile.picture?.data?.url || "",
                  isDiscoverable: true,
                };
                try {
                  localStorage.setItem(
                    "genie_user_profile",
                    JSON.stringify({ ...updatedProfile, customApiKey: "", totpPasscode: "" })
                  );
                } catch (error) {
                  console.error("Could not persist the removed social link:", error);
                }
                return updatedProfile;
              });
              void loadFriendsQueue();
            })
            .catch((error: unknown) => {
              console.error("Meta discovery registration failed:", error);
              setMetaLoginError(error instanceof Error ? error.message : "Could not verify Meta profile.");
            });
        });
      },
      { scope: "public_profile" }
    );
  };

  const loadFriendsQueue = useCallback(async () => {
   if (!googleIdToken) return;
   setIsFriendsLoading(true);
   setFriendsQueueError(null);
   try {
     const headers = { Authorization: `Bearer ${googleIdToken}` };
     const [friendsResponse, roomsResponse] = await Promise.all([
       fetch(`${API_BASE}/api/social/friends`, { headers }),
       fetch(`${API_BASE}/api/rooms`, { headers }),
     ]);
     const [friendResult, roomResult] = await Promise.all([
       friendsResponse.json() as Promise<{ friends?: DiscoverableFriend[]; detail?: string }>,
       roomsResponse.json() as Promise<{ rooms?: SovereignRoomSummary[]; detail?: string }>,
     ]);
     if (!friendsResponse.ok) {
       throw new Error(friendResult.detail || `Friends Queue failed (HTTP ${friendsResponse.status}).`);
     }
     if (!roomsResponse.ok) {
       throw new Error(roomResult.detail || `Saved rooms failed (HTTP ${roomsResponse.status}).`);
     }
     setDiscoverableFriends(friendResult.friends || []);
     setSovereignRooms(roomResult.rooms || []);
   } catch (error) {
     console.error("Friends Queue refresh failed:", error);
     setFriendsQueueError(error instanceof Error ? error.message : "Could not refresh social presence.");
   } finally {
     setIsFriendsLoading(false);
   }
  }, [API_BASE, googleIdToken]);

  async function createTopicChannel() {
    if (topics.length >= 10) return;
    const titleInput = window.prompt("Name this topic channel:", "New Topic");
    const title = titleInput?.trim();
    if (!title) return;
    const iconInput = window.prompt("Choose a topic icon:", "💡");
    const icon = iconInput?.trim() || "💬";
    if (title.length > 80 || [...icon].length > 16) {
      setChatError("Topic titles must be 80 characters or fewer, and icons must be 16 characters or fewer.");
      return;
    }
    try {
      let newTopic: TopicChannel;
      if (isAuthenticated && googleIdToken && userProfile.providerId) {
        const response = await fetch(`${API_BASE}/api/personal/topics/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            google_id_token: googleIdToken,
            user_id: userProfile.providerId,
            title,
            icon,
          }),
        });
        const result = (await response.json()) as { topic?: TopicChannel; detail?: string };
        if (!response.ok || !result.topic) {
          throw new Error(result.detail || `Topic could not be created (HTTP ${response.status}).`);
        }
        newTopic = result.topic;
      } else {
        const existingIds = new Set(topics.map((topic) => topic.id));
        const id = Array.from({ length: 10 }, (_, index) => `topic_${index + 1}`).find((item) => !existingIds.has(item));
        if (!id) return;
        newTopic = { id, title, icon, messages: [] };
      }
      setTopics((previous) => [...previous, newTopic]);
      setActiveTopicId(newTopic.id);
      setIsTeamMode(false);
    } catch (error) {
      console.error("Topic channel creation failed:", error);
      setChatError(error instanceof Error ? error.message : "Topic channel could not be created.");
    }
  }

  async function editTopicChannel(topic: TopicChannel) {
    const titleInput = window.prompt("Update topic title:", topic.title);
    if (titleInput === null) return;
    const iconInput = window.prompt("Update topic icon:", topic.icon);
    if (iconInput === null) return;
    const title = titleInput.trim();
    const icon = iconInput.trim();
    if (!title || title.length > 80 || !icon || [...icon].length > 16) {
      setChatError("Enter a topic title (up to 80 characters) and an icon (up to 16 characters).");
      return;
    }
    try {
      if (isAuthenticated && googleIdToken && userProfile.providerId) {
        const response = await fetch(`${API_BASE}/api/personal/topics/${encodeURIComponent(topic.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            google_id_token: googleIdToken,
            user_id: userProfile.providerId,
            title,
            icon,
          }),
        });
        const result = (await response.json()) as { topic?: TopicChannel; detail?: string };
        if (!response.ok || !result.topic) {
          throw new Error(result.detail || `Topic could not be updated (HTTP ${response.status}).`);
        }
      }
      setTopics((previous) => previous.map((item) => item.id === topic.id ? { ...item, title, icon } : item));
    } catch (error) {
      console.error("Topic channel update failed:", error);
      setChatError(error instanceof Error ? error.message : "Topic channel could not be updated.");
    }
  }

  async function clearTopicChannel(topic: TopicChannel) {
    if (!window.confirm(`Clear all messages in "${topic.title}"? Other topic channels will not be changed.`)) return;
    try {
      if (isAuthenticated && googleIdToken && userProfile.providerId) {
        const response = await fetch(
          `${API_BASE}/api/personal/topics/${encodeURIComponent(topic.id)}/clear`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              google_id_token: googleIdToken,
              user_id: userProfile.providerId,
            }),
          }
        );
        const result = (await response.json()) as { detail?: string };
        if (!response.ok) throw new Error(result.detail || `Topic history could not be cleared (HTTP ${response.status}).`);
      }
      setTopics((previous) => previous.map((item) => item.id === topic.id ? { ...item, messages: [], message_count: 0 } : item));
      if (activeTopicId === topic.id) setPersonalMessages([]);
    } catch (error) {
      console.error("Topic history clear failed:", error);
      setChatError(error instanceof Error ? error.message : "Topic history could not be cleared.");
    }
  }

  async function startSharedConversationInvite() {
    if (!shareSessionId || !isAuthenticated || !googleIdToken || !roomIdentity) {
      setChatError("Sign in with Google before inviting someone to a shared conversation.");
      return;
    }
    if (!roomCryptoIdentity) {
      setChatError("Secure room setup is still initializing. Please try again in a moment.");
      return;
    }
    const session = sessions.find((item) => item.id === shareSessionId);
    if (!session) {
      setChatError("The selected conversation could not be found.");
      return;
    }
    const transcript =
      session.messages.length > 0
        ? session.messages
        : currentSessionId === session.id
        ? activeTopic?.messages || personalMessages
        : [];
    const inviteSessionId = shareInviteSessionId || `${session.id}_${window.crypto.randomUUID()}`;
    const sharedRoomId = `share_${inviteSessionId}`;
    const inviteUrl = `${window.location.origin}/room/${sharedRoomId}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch (error) {
      console.error("Shared room invite link could not be copied:", error);
      setChatError("The invite link could not be copied. Check clipboard permissions and try again.");
      return;
    }
    shareTranscriptRef.current = transcript.map((message) => ({ ...message }));
    shareTranscriptOwnerRef.current = roomIdentity;
    shareTranscriptSentRef.current = false;
    setRoomId(sharedRoomId);
    setRoomTitle(session.title);
    setRoomMessages([]);
    setMembers([]);
    setRoomPasscode("842-109");
    setEnteredRoomPasscode("842-109");
    setRoomPasscodeRoomId(sharedRoomId);
    setIsRoomUnlocked(true);
    setIsTeamMode(true);
    setIsObserverActive(false);
    setShareModalOpen(false);
    setChatError(null);
  }

  function saveSharedConversationToArchive() {
    if (!roomId.startsWith("share_")) return;
    const savedId = `shared_${roomId}`;
    const savedSession: ChatSession = {
      id: savedId,
      title: `Shared: ${roomTitle || roomId}`,
      isPinned: false,
      isSharedArchive: true,
      messages: roomMessages.map((message) => ({ ...message })),
    };
    setSessions((previous) => [
      savedSession,
      ...previous.filter((session) => session.id !== savedId),
    ]);
    setChatError(null);
  }

  async function loadBlockedUsers() {
    if (!googleIdToken || !userProfile.providerId) return;
    try {
      const response = await fetch(
        `${API_BASE}/api/friends/blocked-list?user_id=${encodeURIComponent(userProfile.providerId)}`,
        { headers: { Authorization: `Bearer ${googleIdToken}` } }
      );
      const result = (await response.json()) as {
        blocked_users?: BlockedFriendProfile[];
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail || `Blocked users could not be loaded (HTTP ${response.status}).`);
      setBlockedUsers(result.blocked_users || []);
    } catch (error) {
      console.error("Blocked users refresh failed:", error);
      setChatError(error instanceof Error ? error.message : "Blocked users could not be loaded.");
    }
  }

  async function confirmBlockUser() {
    if (!googleIdToken || !userProfile.providerId || !blockTarget) return;
    try {
      const response = await fetch(`${API_BASE}/api/friends/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          user_id: userProfile.providerId,
          target_user_id: blockTarget.user_id,
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `User could not be blocked (HTTP ${response.status}).`);
      setDiscoverableFriends((previous) => previous.filter((friend) => friend.user_id !== blockTarget.user_id));
      if (roomId.startsWith("direct:") && members.some((member) => member.id === `google:${blockTarget.user_id}`)) {
        roomSocketRef.current?.close(1008, "This direct room is unavailable because of a block.");
        setIsTeamMode(false);
        setIsRoomUnlocked(false);
      }
      setBlockTarget(null);
      setFriendMenuUserId(null);
      setChatError(null);
      if (settingsTab === "blocked") void loadBlockedUsers();
      void loadFriendsQueue();
    } catch (error) {
      console.error("Block user request failed:", error);
      setChatError(error instanceof Error ? error.message : "User could not be blocked.");
    }
  }

  async function unblockUser(target: BlockedFriendProfile) {
    if (!googleIdToken || !userProfile.providerId) return;
    try {
      const response = await fetch(`${API_BASE}/api/friends/unblock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          user_id: userProfile.providerId,
          target_user_id: target.user_id,
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `User could not be unblocked (HTTP ${response.status}).`);
      setBlockedUsers((previous) => previous.filter((user) => user.user_id !== target.user_id));
      void loadFriendsQueue();
    } catch (error) {
      console.error("Unblock user request failed:", error);
      setChatError(error instanceof Error ? error.message : "User could not be unblocked.");
    }
  }

  useEffect(() => {
    if (settingsOpen && settingsTab === "blocked") void loadBlockedUsers();
  }, [settingsOpen, settingsTab, googleIdToken, userProfile.providerId]);

  async function openDirectFriendRoom(friend: DiscoverableFriend) {
   if (!googleIdToken) return;
   try {
     const response = await fetch(`${API_BASE}/api/social/direct-room`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ google_id_token: googleIdToken, target_user_id: friend.user_id }),
     });
     const result = (await response.json()) as { room_id?: string; title?: string; detail?: string };
     if (!response.ok || !result.room_id) {
       throw new Error(result.detail || `Direct room could not be opened (HTTP ${response.status}).`);
     }
     setRoomId(result.room_id);
     setRoomTitle(result.title || friend.handle);
     setArchivedRoomKinds((previous) => {
       const next = { ...previous };
       delete next[result.room_id!];
       return next;
     });
     setIsTeamMode(true);
     setIsRoomUnlocked(true);
     setIsObserverActive(false);
     setFriendsQueueOpen(false);
   } catch (error) {
     console.error("Could not open direct friend room:", error);
     setFriendsQueueError(error instanceof Error ? error.message : "Could not open the direct room.");
   }
  }

  async function unlinkSocialDiscovery() {
   if (!googleIdToken) return;
   try {
     const response = await fetch(`${API_BASE}/api/social/discovery`, {
       method: "DELETE",
       headers: { Authorization: `Bearer ${googleIdToken}` },
     });
     const result = (await response.json()) as { detail?: string };
     if (!response.ok) throw new Error(result.detail || `Unlink failed (HTTP ${response.status}).`);
     setUserProfile((previous) => {
       const updatedProfile = {
         ...previous,
         socialProfileId: "",
         socialHandle: "",
         socialAvatarUrl: "",
         isDiscoverable: false,
       };
       localStorage.setItem(
         "genie_user_profile",
         JSON.stringify({ ...updatedProfile, customApiKey: "", totpPasscode: "" })
       );
       return updatedProfile;
     });
     void loadFriendsQueue();
   } catch (error) {
     console.error("Meta discovery unlink failed:", error);
     setMetaLoginError(error instanceof Error ? error.message : "Could not remove the social link.");
   }
  }

  async function saveSocialHandle(handle: string) {
   const cleanHandle = handle.trim();
   if (!cleanHandle) return;
   if (userProfile.isDiscoverable && googleIdToken) {
     try {
       const response = await fetch(`${API_BASE}/api/social/discovery`, {
         method: "PUT",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ google_id_token: googleIdToken, handle: cleanHandle }),
       });
       const result = (await response.json()) as { detail?: string };
       if (!response.ok) throw new Error(result.detail || `Handle update failed (HTTP ${response.status}).`);
     } catch (error) {
       console.error("Could not update the discoverable social handle:", error);
       setMetaLoginError(error instanceof Error ? error.message : "Could not update the social handle.");
     }
   }
   try {
     localStorage.setItem(
       "genie_user_profile",
       JSON.stringify({ ...userProfile, socialHandle: cleanHandle, customApiKey: "", totpPasscode: "" })
     );
   } catch (error) {
     console.error("Could not persist social handle:", error);
   }
  }

  function openSovereignRoom(room: SovereignRoomSummary) {
   setRoomId(room.room_id);
   setRoomTitle(room.title);
   setArchivedRoomKinds((previous) => {
     const next = { ...previous };
     delete next[room.room_id];
     return next;
   });
   setIsTeamMode(true);
   setIsRoomUnlocked(true);
   setIsObserverActive(false);
   setFriendsQueueOpen(false);
  }

  useEffect(() => {
   if (!friendsQueueOpen || !isAuthenticated || !googleIdToken) return;
   void loadFriendsQueue();
   const refreshTimer = window.setInterval(() => void loadFriendsQueue(), 15000);
   return () => window.clearInterval(refreshTimer);
  }, [friendsQueueOpen, isAuthenticated, googleIdToken, loadFriendsQueue]);

  async function loadArchiveManifest(openWhenAvailable: boolean) {
    if (!isAuthenticated || !googleIdToken || !userProfile.providerId) {
      setArchiveManifest({ personal: null, social: [], team_rooms: [] });
      setArchiveError(null);
      return;
    }
    setArchiveError(null);
    setIsArchiveLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/archive/manifest?user_id=${encodeURIComponent(userProfile.providerId)}`,
        { headers: { Authorization: `Bearer ${googleIdToken}` } }
      );
      const manifest = (await response.json()) as ArchiveManifest & {
        detail?: string;
        status?: string;
        error?: string;
        manifest?: unknown[];
      };
      if (response.status === 401 || manifest.status === "unauthenticated") {
        setArchiveManifest({ personal: null, social: [], team_rooms: [] });
        setArchiveError(null);
        return;
      }
      if (!response.ok) {
        throw new Error(manifest.detail || `Archive manifest request failed (HTTP ${response.status}).`);
      }
      const safeManifest: ArchiveManifest = {
        personal: manifest.personal || null,
        social: Array.isArray(manifest.social) ? manifest.social : [],
        team_rooms: Array.isArray(manifest.team_rooms) ? manifest.team_rooms : [],
      };
      setArchiveManifest(safeManifest);
      const hasArchives = Boolean(
        safeManifest.personal || safeManifest.social.length || safeManifest.team_rooms.length
      );
      if (!hasArchives) {
        setArchiveError(null);
        return;
      }
      if (openWhenAvailable && hasArchives) {
        setSelectedArchiveItems(new Set());
        setArchiveModalOpen(true);
      }
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : "Unknown archive manifest error.";
      console.error("Archive manifest request failed:", error);
      setArchiveError(diagnostic);
      if (openWhenAvailable) setChatError(`Archive manifest request failed: ${diagnostic}`);
    } finally {
      setIsArchiveLoading(false);
    }
  }

  function openArchiveRestore() {
    setSettingsOpen(false);
    setSelectedArchiveItems(new Set());
    setArchiveModalOpen(true);
    void loadArchiveManifest(false);
  }

  function toggleArchiveItem(key: string) {
    setSelectedArchiveItems((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSaveArchive() {
    if (!googleIdToken) {
      setArchiveError("Sign in with Google before saving an archive.");
      return;
    }
    setIsSavingArchive(true);
    setArchiveError(null);
    setArchiveStatus(null);

    const isDirectFriendRoom = roomId.startsWith("direct:");
    const isSocialThread = roomId.startsWith("social:") || isDirectFriendRoom;
    const socialThreadId = isDirectFriendRoom
      ? roomId
      : isSocialThread
      ? roomId.slice("social:".length)
      : "";
    try {
      const personalArchive = await encryptArchiveMessages(personalMessages);
      const socialThreads = await Promise.all(
        Object.entries(archivedRoomKinds)
          .filter(([threadRoomId, kind]) => kind === "social")
          .map(async ([threadRoomId]) => {
            const [, metaUserId, ...threadIdParts] = threadRoomId.split(":");
            const messagesForThread =
              threadRoomId === roomId ? roomMessages : archivedRoomMessages[threadRoomId] || [];
            return {
              meta_user_id: threadRoomId.startsWith("direct:")
                ? userProfile.socialProfileId
                : metaUserId || userProfile.socialProfileId,
              thread_id: threadRoomId.startsWith("direct:")
                ? threadRoomId
                : threadIdParts.join(":"),
              linked_handle: userProfile.socialHandle,
              message_count: messagesForThread.length,
              messages: [await encryptArchiveMessages(messagesForThread)],
            };
          })
      );
      if (
        isSocialThread &&
        userProfile.socialProfileId &&
        !archivedRoomKinds[roomId]
      ) {
        socialThreads.push({
          meta_user_id: userProfile.socialProfileId,
          thread_id: socialThreadId,
          linked_handle: userProfile.socialHandle,
          message_count: roomMessages.length,
          messages: [await encryptArchiveMessages(roomMessages)],
        });
      }
      const teamRoomSnapshot =
        isTeamMode && !isSocialThread
          ? [
              {
                room_id: roomId,
                room_title: roomTitle,
                host_name: userProfile.name,
                messages: [],
                executive_reviews: [
                  await encryptArchiveMessages(
                    roomMessages.filter(
                      (message) =>
                        message.senderName?.includes("Observer") ||
                        message.content.toLowerCase().includes("executive review")
                    )
                  ),
                ],
              },
            ]
          : [];
      const response = await fetch(`${API_BASE}/api/archive/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          personal_messages: [personalArchive],
          personal_message_count: personalMessages.length,
          social_threads: socialThreads,
          team_rooms: teamRoomSnapshot,
        }),
      });
      const result = (await response.json()) as {
        status?: string;
        saved_at?: string;
        detail?: string;
      };
      if (!response.ok || result.status !== "success") {
        throw new Error(result.detail || `Archive save failed (HTTP ${response.status}).`);
      }
      setArchiveStatus("Archive saved successfully");
      await loadArchiveManifest(false);
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : "Unknown archive save error.";
      console.error("Archive save failed:", error);
      setArchiveError(diagnostic);
    } finally {
      setIsSavingArchive(false);
    }
  }

  async function handleRestoreArchive() {
    if (!selectedArchiveItems.size || !googleIdToken || !userProfile.providerId) return;
    setIsArchiveLoading(true);
    setArchiveError(null);

    const selectedSocial = archiveManifest.social.filter((item) =>
      selectedArchiveItems.has(`social:${item.archive_key}`) &&
      item.meta_user_id === userProfile.socialProfileId
    );
    const selectedRooms = archiveManifest.team_rooms.filter((item) =>
      selectedArchiveItems.has(`team_rooms:${item.room_id || item.archive_key}`)
    );
    const restoreTargets = [
      ...(selectedArchiveItems.has("personal") ? ["personal"] : []),
      ...(selectedSocial.length ? ["social"] : []),
      ...(selectedRooms.length ? ["team_rooms"] : []),
    ];

    try {
      const response = await fetch(`${API_BASE}/api/archive/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          user_id: userProfile.providerId,
          restore_targets: restoreTargets,
          room_ids: selectedRooms.map((room) => room.room_id || room.archive_key),
          social_archive_keys: selectedSocial.map((thread) => thread.archive_key),
          meta_user_id: userProfile.socialProfileId || undefined,
        }),
      });
      const restored = (await response.json()) as {
        status?: string;
        personal?: RestoredArchive[];
        social?: RestoredArchive[];
        team_rooms?: RestoredArchive[];
        detail?: string;
      };
      if (!response.ok || restored.status !== "success") {
        throw new Error(restored.detail || `Archive restore failed (HTTP ${response.status}).`);
      }

      const personalMessagesRestored = await decryptArchivedMessages(
        restored.personal?.[0]?.messages || []
      );
      if (selectedArchiveItems.has("personal")) {
        setPersonalMessages(personalMessagesRestored);
        setSessions((previous) => previous.map((session) =>
          session.id === currentSessionId
            ? { ...session, title: restored.personal?.[0]?.title || "Personal AI Genie Thread", messages: personalMessagesRestored }
            : session
        ));
      }

      const roomMessageMap: Record<string, Message[]> = {};
      const roomKindMap: Record<string, "social" | "team_rooms"> = {};
      for (const thread of restored.social || []) {
        const threadId = thread.thread_id || thread.archive_key;
        const key = threadId.startsWith("direct:")
          ? threadId
          : `social:${thread.meta_user_id || ""}:${threadId}`;
        roomMessageMap[key] = await decryptArchivedMessages(thread.messages);
        roomKindMap[key] = "social";
      }
      for (const room of restored.team_rooms || []) {
        const key = room.room_id || room.archive_key;
        roomMessageMap[key] = await Promise.all(room.messages.map((message) =>
          message.encrypted_payloads
            ? decodeRoomWireMessage(message)
            : Promise.resolve(normalizeRoomMessage(message))
        ));
        roomKindMap[key] = "team_rooms";
      }
      if (Object.keys(roomMessageMap).length) {
        setArchivedRoomMessages((previous) => ({ ...previous, ...roomMessageMap }));
        setArchivedRoomKinds((previous) => ({ ...previous, ...roomKindMap }));
        const firstRoomId = Object.keys(roomMessageMap)[0];
        setRoomId(firstRoomId);
        setRoomTitle(
          (restored.social || []).find((thread) => {
            const threadId = thread.thread_id || thread.archive_key;
            const restoredThreadId = threadId.startsWith("direct:")
              ? threadId
              : `social:${thread.meta_user_id || ""}:${threadId}`;
            return restoredThreadId === firstRoomId;
          })?.title ||
          (restored.team_rooms || []).find((room) => (room.room_id || room.archive_key) === firstRoomId)?.room_title ||
          firstRoomId
        );
        setRoomMessages(roomMessageMap[firstRoomId]);
        setIsTeamMode(true);
        setIsRoomUnlocked(true);
      } else if (selectedArchiveItems.has("personal")) {
        setIsTeamMode(false);
      }

      setArchiveModalOpen(false);
      setArchiveStatus("Selected archive items restored to their separate conversations.");
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : "Unknown archive restore error.";
      console.error("Archive restore failed:", error);
      setArchiveError(diagnostic);
    } finally {
      setIsArchiveLoading(false);
    }
  }

  const handleSignOut = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("genie_is_authenticated");
      localStorage.removeItem("genie_user_profile");
      localStorage.removeItem("genie_terms_agreed");
      sessionStorage.removeItem("genie_google_id_token");
      if ((window as any).google?.accounts?.id) {
        (window as any).google.accounts.id.disableAutoSelect();
        (window as any).__gsi_auth_active = false;
      }
    }
    setIsAuthenticated(false);
    setIsRoomUnlocked(false);
    setIsTotpVerified(false);
    setHasAgreedToTerms(false);
    setGoogleIdToken("");
    setIsTeamMode(false);
    setIsObserverActive(false);
    setPersonalMessages([]);
    setRoomMessages([]);
    setMembers([]);
    setDiscoverableFriends([]);
    setSovereignRooms([]);
    setFriendsQueueOpen(false);
    setArchivedRoomMessages({});
    setArchivedRoomKinds({});
    setArchiveManifest({ personal: null, social: [], team_rooms: [] });
    setSelectedArchiveItems(new Set());
    setArchiveModalOpen(false);
    archivePromptedRef.current = false;
    setUserProfile({
      name: "Guest User",
      email: "",
      avatarUrl: "",
      role: "professional",
      profession: "Healthcare Revenue Cycle & Client Operations",
      ageGroup: "pro",
      gender: "male",
      customApiKey: "",
      totpPasscode: "",
      authProvider: "",
      providerId: "",
      socialHandle: "",
      socialAvatarUrl: "",
      socialProfileId: "",
      isDiscoverable: false,
    });
  };

  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = userProfile.totpPasscode.trim().replace(/\s|-/g, "");
    if (!/^\d{6}$/.test(clean)) {
      alert("Please enter a valid 6-digit Authenticator code.");
      return;
    }

    setIsTotpVerifying(true);
    try {
      const response = await fetch("/api/genie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_totp", code: clean }),
      });
      const result = (await response.json()) as { valid?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(result.error || `Authenticator verification failed (HTTP ${response.status}).`);
      }
      if (!result.valid) {
        alert("The Authenticator code is invalid or expired.");
        return;
      }

      setIsTotpVerified(true);
      setUserProfile((profile) => ({ ...profile, totpPasscode: "" }));
      alert(
        isCorporateDomain
          ? "Corporate Authenticator verified! Departmental VIP and Room Governance active."
          : "Platform Master Authenticator verified! VIP Pass active."
      );
    } catch (error) {
      console.error("Authenticator verification failed:", error);
      alert(error instanceof Error ? error.message : "Authenticator verification failed.");
    } finally {
      setIsTotpVerifying(false);
    }
  };

  const handleUnlockRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEntered = enteredRoomPasscode.trim().replace(/[-\s]/g, "");

    if (cleanEntered.length >= 6 || isKeyOwner) {
      const acceptedPasscode = cleanEntered || roomPasscode.trim();
      setRoomPasscode(acceptedPasscode);
      setIsRoomUnlocked(true);
      setRoomGateError(false);
    } else {
      setRoomGateError(true);
    }
  };

  const handleExitRoomToPersonal = () => {
    if (!mounted) return;
    setIsTeamMode(false);
    setIsObserverActive(false);
    setIsRoomUnlocked(false);
    setRoomGateError(false);
    setEnteredRoomPasscode("");
    setRoomId("GENIE-TEAM-MAIN");
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  };

  const executePasscodeRegeneration = async () => {
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    const formatted = `${newCode.slice(0, 3)}-${newCode.slice(3)}`;
    if (!googleIdToken) {
      setChatError("Google sign-in is required to change the sovereign room passcode.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/rooms/passcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ google_id_token: googleIdToken, room_id: roomId, passcode: formatted }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `Passcode update failed (HTTP ${response.status}).`);
      setRoomPasscode(formatted);
      try {
        localStorage.setItem(`genie_room_passcode_${roomId}`, formatted);
      } catch (error) {
        console.error("Could not persist the updated room passcode:", error);
      }
      setConfirmRegenerateModalOpen(false);
    } catch (error) {
      console.error("Room passcode update failed:", error);
      setChatError(error instanceof Error ? error.message : "Room passcode update failed.");
    }
  };

  const handlePromoteAdmin = (memberId: string) => {
    if (!isKeyOwner) {
      alert("Sovereign Policy: Only the API Key Owner can designate or demote Room Admins.");
      return;
    }
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id === memberId) {
          const nextRole = m.role === "admin" ? "member" : "admin";
          return { ...m, role: nextRole };
        }
        return m;
      })
    );
  };

  const handleToggleTeamMode = () => {
    const nextState = !isTeamMode;
    setIsTeamMode(nextState);
    if (nextState) setRoomMessages([]);
    else setIsObserverActive(false);
  };

  const handleSendDirectInvites = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requiredAttendees.trim() && !optionalAttendees.trim()) {
      alert("Please provide at least one required or optional attendee email address.");
      return;
    }

    const requiredInvitees = requiredAttendees.split(",").map((email) => email.trim()).filter(Boolean);
    const optionalInvitees = optionalAttendees.split(",").map((email) => email.trim()).filter(Boolean);
    const uniqueInviteeCount = new Set(
      [...requiredInvitees, ...optionalInvitees].map((email) => email.toLowerCase())
    ).size;
    if (
      roomCapacityLimit !== null &&
      activeRoomMemberCount + uniqueInviteeCount > roomCapacityLimit
    ) {
      alert(
        `This room has capacity for ${roomCapacityLimit} people and already has ${activeRoomMemberCount} active member(s). Increase the room capacity or invite fewer people.`
      );
      return;
    }

    setDispatchStatus("Dispatching direct meeting invites via API credit...");

    const payload = {
      google_id_token: googleIdToken,
      room_id: roomId,
      room_passcode: roomPasscode,
      host_name: userProfile.name,
      host_email: userProfile.email,
      required_attendees: requiredInvitees,
      optional_attendees: optionalInvitees,
      agenda: meetingAgenda.trim() || "Genie Multi-User Team Session",
      share_url: `${window.location.origin}/?room=${roomId}`,
    };

    try {
      const response = await fetch(`${API_BASE}/api/room/send-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `Invitation failed (HTTP ${response.status}).`);
      setDispatchStatus("Direct invites successfully sent! 1 dispatch credit consumed.");
      setTimeout(() => setDispatchStatus(null), 4000);
    } catch (error) {
      console.error("Room invitation dispatch failed:", error);
      setDispatchStatus(error instanceof Error ? error.message : "Room invitation could not be sent.");
      setTimeout(() => setDispatchStatus(null), 4000);
    }
  };

  const copyFormattedInviteNote = () => {
    const text = `Personal AI Genie — Team Room Invite\nRoom: ${roomId}\nJoin Link: ${window.location.origin}/?room=${roomId}\nRoom Security Passcode: ${roomPasscode}\nRequired Attendees: ${requiredAttendees || "None"}\nOptional Attendees: ${optionalAttendees || "None"}\nAgenda: ${meetingAgenda || "General Session"}\n\nSign in with Google and enter the Room Passcode to join.`;
    navigator.clipboard.writeText(text);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2500);
  };

  const copyRoomInvite = () => {
    const shareUrl = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(shareUrl);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2500);
  };

  const copyCanvasCode = () => {
    if (activeCanvas?.code) {
      navigator.clipboard.writeText(activeCanvas.code);
      setCanvasCopied(true);
      setTimeout(() => setCanvasCopied(false), 2000);
    }
  };

  const exportCanvasCode = (format: "code" | "md" | "txt") => {
    if (!activeCanvas) return;
    let extension = format === "md" ? "md" : format === "txt" ? "txt" : activeCanvas.language || "tsx";
    if (extension === "typescript" || extension === "react") extension = "tsx";

    const blob = new Blob([activeCanvas.code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Genie_Code_${Date.now()}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  };

  const shareCanvasCode = () => {
    if (!activeCanvas) return;
    navigator.clipboard.writeText(activeCanvas.code);
    alert("Code snippet copied to clipboard! Ready to share in chat or team rooms.");
  };

  const handleDownloadProjectDocumentation = () => {
    const docs = `# Personal AI Genie — Comprehensive Architecture & User Disclaimer
**Platform Version:** 5.0.0 High-Performance
**Date:** ${new Date().toLocaleDateString()}

---

## 1. DUAL PARALLEL MULTI-MODEL CASCADE
- Fast-fail racing across Google Gemini endpoints ensures rapid conversational intelligence.
- 8s initial boundary failover guarantees zero hung spinners.

---

## 2. SOVEREIGN GOVERNANCE & PRIVACY
- Free Tier: 20 free daily messages per Google account.
- BYOK: Unlimited token execution directly against Google APIs.

## 3. Selective Archive Backup & Restoration
- Archive snapshots are partitioned by verified Google identity into private Genie threads, linked Meta direct chats, and team-room logs with review metadata.
- Restore requires Google authentication; personal messages and room transcripts are restored into separate workspace state.
- Team-room archive snapshots are available to verified room participants. Social-chat restores require the matching linked Meta profile.

## 4. Encrypted Rooms and Opt-In Genie Context
- Room message bodies are encrypted in the browser with P-256 ECDH, HKDF-SHA-256, and AES-GCM before WebSocket relay. Non-extractable private keys are stored in browser IndexedDB; the backend persists ciphertext and room metadata only.
- Human-to-human room text is not sent to the AI provider. When a participant explicitly invokes Genie or Observer Review, the client decrypts and submits only the latest 20 room messages over the configured backend connection.
- Personal and social archive snapshots are encrypted in the browser before upload and can be decrypted only in the browser profile holding the non-exportable archive key.
- Meta discovery is optional and requires server-side verification of the Meta access token. The token is not stored; users can remove themselves from discovery in Settings.
`;

    const blob = new Blob([docs], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Personal_AI_Genie_Documentation.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyMessage = (content: string, index: number) => {
    navigator.clipboard.writeText(content);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketDescription.trim()) return;

    try {
      await fetch(`${API_BASE}/api/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: userProfile.email,
          user_name: userProfile.name,
          developer_destination: SUPPORT_DISPATCH_EMAIL,
          track: reportType,
          description: ticketDescription,
          context: "Submitted via Genie Workspace Preferences",
        }),
      });
      setTicketStatus(`Dispatched successfully to ${SUPPORT_DISPATCH_EMAIL}.`);
      setTicketDescription("");
      setTimeout(() => setTicketStatus(null), 3500);
    } catch {
      setTicketStatus("Queued for Active Core Support Dispatch.");
      setTicketDescription("");
      setTimeout(() => setTicketStatus(null), 3500);
    }
  };

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      {FACEBOOK_APP_ID && (
        <Script
          src="https://connect.facebook.net/en_US/sdk.js"
          strategy="afterInteractive"
          onLoad={initializeMetaSdk}
        />
      )}

      {/* Primary Authentication Gate */}
      {!isAuthenticated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 flex flex-col items-center text-center space-y-4">
            <div className={`w-14 h-14 ${selectedTheme.bgLightClass} ${selectedTheme.textClass} rounded-full flex items-center justify-center shadow-inner`}>
              <Lock className="w-6 h-6" />
            </div>

            <div>
              <h2 className="text-xl font-extrabold text-slate-800">Personal AI Genie</h2>
              <p className="text-xs text-slate-500 mt-1">
                Autonomous Multi-User Workspace & Personal AI Companion
              </p>
            </div>

            <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-left space-y-2">
              <div className="flex items-center gap-1.5 text-slate-800 text-xs font-bold">
                <ShieldCheck className="w-4 h-4 text-purple-600" />
                <span>Terms & AI Disclaimer Notice</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Sign in with Google to use Personal AI Genie and shared rooms. Social profiles can optionally be linked later for roster display. Free accounts receive 20 AI messages per day.
              </p>

              <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasAgreedToTerms}
                  onChange={(e) => {
                    setHasAgreedToTerms(e.target.checked);
                    setTermsPromptWarning(false);
                  }}
                  className="mt-0.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="text-[11px] text-slate-700 font-medium">
                  I agree to the{" "}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLegalModalOpen(true);
                    }}
                    className="text-purple-600 font-bold hover:underline"
                  >
                    Terms of Service, User Disclaimer & Privacy Policy
                  </button>
                </span>
              </label>

              {termsPromptWarning && (
                <p className="text-[10px] text-rose-600 font-bold">
                  Please review and check the terms agreement box to proceed.
                </p>
              )}
            </div>

            <div
              className={`flex justify-center w-full min-h-[40px] transition-opacity ${
                hasAgreedToTerms ? "opacity-100" : "opacity-40 pointer-events-none"
              }`}
            >
              <div id="googleSignInBtn" />
            </div>
            {!hasAgreedToTerms && (
              <p className="text-[10px] text-slate-400">
                Check the agreement box above to activate Google Sign-In.
              </p>
            )}
          </div>
        </div>
      )}
      {isTeamMode && roomId.startsWith("share_") && (
        <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-cyan-200 bg-cyan-50/90 px-3 py-2 shadow-sm">
          <span className="text-xs font-semibold text-cyan-950">
            🔒 2-Member Shared Room
          </span>
          <button
            type="button"
            onClick={saveSharedConversationToArchive}
            disabled={sessions.some((session) => session.id === `shared_${roomId}`)}
            className="rounded-lg border border-cyan-300 bg-white px-3 py-1.5 text-[10px] font-semibold text-cyan-900 hover:bg-cyan-100 disabled:cursor-default disabled:opacity-70"
          >
            {sessions.some((session) => session.id === `shared_${roomId}`)
              ? "✓ Saved to My Archived Chats"
              : "💾 Save to My Archived Chats"}
          </button>
        </div>
      )}

      {/* Room Security Passcode Gate */}
      {isAuthenticated && isTeamMode && !isRoomUnlocked && !isKeyOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 flex flex-col items-center text-center space-y-4 relative">
            <button
              onClick={handleExitRoomToPersonal}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition-colors"
              title="Close and Return to Personal Space"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center shadow-inner">
              <Key className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-800">Room Security Passcode</h3>
              <p className="text-xs text-slate-500 mt-1">
                Enter the passcode provided by the meeting host to access room <span className={`font-mono font-bold ${selectedTheme.textClass}`}>{roomId}</span>.
              </p>
            </div>

            <form onSubmit={handleUnlockRoom} className="w-full space-y-3">
              <input
                type="text"
                value={enteredRoomPasscode}
                onChange={(e) => {
                  setEnteredRoomPasscode(e.target.value);
                  setRoomGateError(false);
                }}
                placeholder="e.g. 842-109 or 842109"
                className="w-full text-center text-sm font-mono font-bold tracking-widest border border-slate-300 rounded-xl px-4 py-2.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
              />

              {roomGateError && (
                <p className="text-[11px] text-rose-600 font-semibold">
                  Invalid room passcode. Please check with your meeting host.
                </p>
              )}

              <button
                type="submit"
                className={`w-full py-2.5 ${selectedTheme.primaryClass} text-white font-bold text-xs rounded-xl shadow-md transition-all`}
              >
                Unlock Room
              </button>

              <button
                type="button"
                onClick={handleExitRoomToPersonal}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs rounded-xl transition-all"
              >
                Cancel and Exit to Personal Space
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Main Responsive Layout Wrapper */}
      <div className={`flex h-[100dvh] max-h-[100dvh] w-full overflow-hidden ${currentTheme.canvasClass} ${currentTheme.canvasTextClass} antialiased font-sans`}>
        {(chatError || archiveError || archiveStatus || vipSessionLimitReached) && (
          <div
            role={chatError || archiveError ? "alert" : "status"}
            className={`fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,48rem)] -translate-x-1/2 items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs shadow-xl ${
              chatError || archiveError
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            <span className="min-w-0 break-words">
              {chatError ||
                archiveError ||
                archiveStatus ||
                "All 20 concurrent VIP sessions are in use. This account is in the standard tier until a VIP session becomes available."}
            </span>
            {(chatError || archiveError || archiveStatus) && (
              <button
                type="button"
                onClick={() => {
                  setChatError(null);
                  setArchiveError(null);
                  setArchiveStatus(null);
                }}
                className="shrink-0 font-semibold underline"
                aria-label="Dismiss chat error"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
        {/* Mobile Backdrop Overlay */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs lg:hidden"
          />
        )}

        {/* SECTION 3: SIDEBAR */}
        <aside
          className={`${
            sidebarOpen ? "translate-x-0 w-72" : "-translate-x-full w-0 lg:w-0"
          } fixed lg:static inset-y-0 left-0 z-40 ${currentTheme.sidebarClass} backdrop-blur-xl border-r ${currentTheme.chromeBorderClass} transition-all duration-300 ease-in-out flex flex-col overflow-hidden shadow-2xl lg:shadow-none`}
        >
          <div className={`flex items-center justify-between border-b p-4 ${currentTheme.chromeBorderClass}`}>
            <div className="flex items-center gap-3">
              <GenieAvatar
                src={userProfile.avatarUrl}
                alt={userProfile.name}
                className={`w-9 h-9 rounded-full border-2 ${selectedTheme.borderClass} shadow-sm`}
              />
              <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 bg-clip-text text-transparent truncate">
                Personal AI Genie
              </span>
            </div>

            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg transition-colors"
              title="Hide Sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3">
            <button
              onClick={() => {
                const newId = Date.now().toString();
                setSessions((prev) => [
                  { id: newId, title: "New Session", isPinned: false, messages: [] },
                  ...prev,
                ]);
                setIsTeamMode(false);
                setPersonalMessages([]);
                setCurrentSessionId(newId);
                if (typeof window !== "undefined" && window.innerWidth < 1024) {
                  setSidebarOpen(false);
                }
              }}
              className={`w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold ${selectedTheme.primaryClass} text-white rounded-xl transition-all shadow-sm`}
            >
              <Plus className="w-4 h-4" /> New Chat
            </button>
            <button
              type="button"
              disabled={!isAuthenticated}
              onClick={() => setFriendsQueueOpen(true)}
              className={`mt-2 w-full flex items-center justify-between gap-2 rounded-xl border ${currentTheme.chromeBorderClass} ${currentTheme.chromeSurfaceClass} px-3 py-2 text-xs font-semibold ${currentTheme.chromeTextClass} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span className="flex items-center gap-2"><Users className="h-4 w-4" /> Friends Queue</span>
              <span className="text-[10px] text-slate-500">
                {discoverableFriends.filter((friend) => friend.is_online).length} online
              </span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 space-y-1">
            {!isTeamMode && (
              <section className="mb-3 rounded-xl border border-slate-200 bg-white/80 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    Topics ({topics.length}/10)
                  </h2>
                  {isTopicLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-label="Loading topics" />}
                </div>
                <div className="space-y-1">
                  {topics.map((topic) => (
                    <div
                      key={topic.id}
                      className={`group/topic flex items-center gap-1 rounded-lg border px-1.5 py-1 ${
                        activeTopicId === topic.id
                          ? `${selectedTheme.borderClass} ${selectedTheme.bgLightClass}`
                          : "border-transparent hover:bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTopicId(topic.id);
                          setIsTeamMode(false);
                          if (typeof window !== "undefined" && window.innerWidth < 1024) setSidebarOpen(false);
                        }}
                        aria-current={activeTopicId === topic.id ? "page" : undefined}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs ${
                          activeTopicId === topic.id ? `${selectedTheme.textClass} font-semibold` : "text-slate-600"
                        }`}
                      >
                        <span className="shrink-0 text-sm" aria-hidden="true">{topic.icon}</span>
                        <span className="truncate">{topic.title}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void editTopicChannel(topic)}
                        title={`Edit ${topic.title}`}
                        aria-label={`Edit ${topic.title}`}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void clearTopicChannel(topic)}
                        title={`Clear ${topic.title} history`}
                        aria-label={`Clear ${topic.title} history`}
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void createTopicChannel()}
                  disabled={topics.length >= 10 || isTopicLoading}
                  className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed ${selectedTheme.borderClass} px-2 py-1.5 text-[11px] font-semibold ${selectedTheme.textClass} hover:${selectedTheme.bgLightClass} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Topic
                </button>
              </section>
            )}
            <div className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Chat History
            </div>

            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => {
                  setCurrentSessionId(session.id);
                  setIsTeamMode(false);
                  setPersonalMessages(session.messages);
                  if (typeof window !== "undefined" && window.innerWidth < 1024) {
                    setSidebarOpen(false);
                  }
                }}
                className={`group relative flex items-center justify-between px-3 py-2 text-xs rounded-xl cursor-pointer transition-all ${
                  currentSessionId === session.id
                    ? `bg-white ${selectedTheme.textClass} font-semibold shadow-sm border border-[#D9DFEA]`
                    : "text-slate-600 hover:bg-white/50"
                }`}
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  {session.isPinned ? (
                    <Pin className={`w-3.5 h-3.5 ${selectedTheme.textClass} flex-shrink-0`} />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  )}
                  <span className="truncate">{session.title}</span>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuId(activeMenuId === session.id ? null : session.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-slate-900 text-slate-400 rounded transition-opacity"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>

                  {activeMenuId === session.id && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl py-1 w-44 z-50 text-slate-700"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShareSessionId(session.id);
                          setShareInviteSessionId(`${session.id}_${window.crypto.randomUUID()}`);
                          setShareModalOpen(true);
                          setActiveMenuId(null);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:${selectedTheme.bgLightClass} ${selectedTheme.textClass} font-medium`}
                      >
                        <Share2 className="w-3.5 h-3.5" /> Share conversation
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSessions((prev) =>
                            prev.map((s) => (s.id === session.id ? { ...s, isPinned: !s.isPinned } : s))
                          );
                          setActiveMenuId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50"
                      >
                        <Pin className="w-3.5 h-3.5 text-slate-500" /> {session.isPinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const newName = window.prompt("Rename session:");
                          if (newName?.trim()) {
                            setSessions((prev) =>
                              prev.map((s) => (s.id === session.id ? { ...s, title: newName.trim() } : s))
                            );
                          }
                          setActiveMenuId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-slate-500" /> Rename
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (sessions.length > 1) {
                            setSessions((prev) => prev.filter((s) => s.id !== session.id));
                            if (currentSessionId === session.id) {
                              setCurrentSessionId(sessions.find((s) => s.id !== session.id)!.id);
                            }
                          }
                          setActiveMenuId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-500" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={`space-y-2 border-t p-3 ${currentTheme.chromeBorderClass} ${currentTheme.chromeClass}`}>
            <SlideDockDrawer
              statusLabel={
                  isMasterAdmin
                    ? "⚡ Unlimited Admin Engine"
                    : isQuotaEnforced
                    ? `⚡ ${remainingDailyChats} / ${DAILY_FREE_LIMIT} Chats Left`
                    : isVipUser
                    ? `★ VIP Unlimited · ${activeVipSessionCount}/20`
                    : "★ BYOK Unlimited"
                }
              statusTone={isMasterAdmin || isVipUser ? "vip" : isQuotaEnforced ? "quota" : "byok"}
              surfaceClass={currentTheme.chromeSurfaceClass}
              borderClass={currentTheme.borderClass}
              textClass={currentTheme.chromeTextClass}
              mutedTextClass={currentTheme.chromeMutedTextClass}
              accentClass={currentTheme.textClass}
            >
              <StudentBanner onSelectPrompt={(t) => setPrompt(t)} compact />
              <UnifiedStudyEngine
                onInjectPrompt={(t) => setPrompt(t)}
                userEmail={userProfile?.email}
                compact
              />
            </SlideDockDrawer>

            <div className="flex items-center justify-between bg-white/70 p-2 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2 min-w-0">
                <GenieAvatar
                  src={userProfile.avatarUrl}
                  alt={userProfile.name}
                  className={`w-7 h-7 rounded-full border ${selectedTheme.borderClass} flex-shrink-0`}
                />
                <div className="flex flex-col truncate">
                  <span className="text-[11px] font-bold text-slate-800 leading-tight truncate">
                    {userProfile.name}
                  </span>
                  {isMasterAdmin && (
                    <span className="truncate text-[8px] font-extrabold text-amber-700">
                      🛡️ ★ MASTER ADMIN VIP (UNLIMITED ACCESS)
                    </span>
                  )}
                  <span className="text-[9px] text-slate-500 truncate">{userProfile.email || "Guest"}</span>
                </div>
              </div>

              <button
                onClick={() => setSpaceMode(spaceMode === "personal" ? "workspace" : "personal")}
                className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all ${
                  spaceMode === "workspace"
                    ? `${selectedTheme.primaryClass} text-white`
                    : "bg-pink-50 text-pink-700 border-pink-300"
                }`}
              >
                {spaceMode === "workspace" ? "Work" : "Personal"}
              </button>
            </div>
            {/* Direct Sidebar Chat Vault */}
            <div className="bg-white/80 border border-slate-200 rounded-xl p-2 space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-700">Chat Vault</span>
                <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded font-semibold border border-emerald-200">Auto-Persist</span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const stored = localStorage.getItem("genie_chat_sessions_v2") || localStorage.getItem("genie_chat_sessions");
                    const blob = new Blob([stored || JSON.stringify(sessions)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `Genie_Backup_${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex-1 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  <span>Backup</span>
                </button>
                <label className="flex-1 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer">
                  <FileUp className="w-3 h-3" />
                  <span>Restore</span>
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          try {
                            const parsed = JSON.parse(event.target?.result as string);
                            const sessionsToLoad = Array.isArray(parsed) ? parsed : parsed.sessions;
                            if (Array.isArray(sessionsToLoad) && sessionsToLoad.length > 0) {
                              setSessions(sessionsToLoad);
                              setCurrentSessionId(sessionsToLoad[0].id);
                              setIsTeamMode(false);
                              setPersonalMessages(sessionsToLoad[0].messages || []);
                              localStorage.setItem("genie_chat_sessions_v2", JSON.stringify(sessionsToLoad));
                              alert("Chat history restored successfully!");
                            }
                          } catch {
                            alert("Invalid backup JSON file.");
                          }
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            
            <div className="flex items-center justify-between px-1">
              <button
                onClick={() => setLegalModalOpen(true)}
                className="text-[10px] text-slate-500 hover:text-purple-700 underline font-medium"
              >
                Disclaimer & Terms
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className={`p-1 text-slate-500 hover:${selectedTheme.textClass} hover:bg-slate-200/60 rounded-md transition-colors`}
                title="Preferences & Governance"
              >
                <SettingsIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed top-3 left-3 z-30 p-2 bg-white/95 hover:bg-white text-slate-700 rounded-xl shadow-md border border-slate-200 transition-all"
            title="Open Sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* SECTION 4: MAIN HEADER & WORKSPACE */}
        <main className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-b ${currentTheme.canvasGradientClass}`}>
          <HeaderBar
            spaceMode={spaceMode}
            onSpaceModeChange={setSpaceMode}
            isTeamMode={isTeamMode}
            onToggleTeamMode={handleToggleTeamMode}
            isCorporateDomain={isCorporateDomain}
            workspaceName={isCorporateDomain ? "Corp Active" : spaceMode === "workspace" ? "Workspace" : "Personal"}
            activeMemberCount={activeRoomMemberCount}
            capacityLabel={roomCapacityLabel}
            chromeClass={currentTheme.chromeClass}
            chromeSurfaceClass={currentTheme.chromeSurfaceClass}
            chromeBorderClass={currentTheme.chromeBorderClass}
            chromeTextClass={currentTheme.chromeTextClass}
            chromeMutedTextClass={currentTheme.chromeMutedTextClass}
            accentBorderClass={currentTheme.borderClass}
            accentTextClass={currentTheme.textClass}
            activeClass={currentTheme.primaryClass}
            onOpenRoom={() => setRoomAdminOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          {/* SECTION 5: CHAT THREAD & CANVAS */}
          <div className="flex-1 min-h-0 flex relative overflow-hidden">
            <div className={`flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-4 sm:py-6 transition-all ${activeCanvas ? "w-1/2 pr-2" : "w-full"}`}>
              {isTeamMode && roomId.startsWith("direct:") && (
                <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/85 px-3 py-2 shadow-sm">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-800">{roomTitle}</p>
                    <p className="text-[10px] text-slate-500">Encrypted direct room</p>
                  </div>
                  {members
                    .filter((member) => member.id !== roomIdentity)
                    .map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => setBlockTarget({
                          user_id: member.id.replace(/^google:/, ""),
                          display_name: member.name,
                          handle: member.name,
                          avatar_url: member.avatarUrl || "",
                        })}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Block User
                      </button>
                    ))}
                </div>
              )}
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-tr from-violet-600 via-pink-500 to-amber-400 text-white shadow-lg p-3.5 mb-4 select-none">
                    <Sparkles className="w-full h-full text-white drop-shadow-md animate-pulse" />
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 mb-2">
                    Where should we start?
                  </h2>
                  <p className="text-xs text-slate-500 max-w-sm">
                    {isTeamMode
                      ? `Google-verified shared room ${roomId}. Human messages are shared with room members; mention Genie when AI assistance is needed.`
                      : spaceMode === "workspace"
                      ? `Workspace active in ${userProfile.profession}. Multi-AI context and team pooling ready.`
                      : `Personal companion for ${userProfile.name}. Clean natural language advice, coding assistance, and document analysis ready.`}
                  </p>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto space-y-4 pb-4">
                  {messages.map((msg, index) => (
                    <div
                      key={msg.id || index}
                      className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                    >
                      {(msg.senderName || msg.source) && (
                        <span
                          title={
                            msg.source === "cloud_ai"
                              ? "Generated by a live cloud AI model."
                              : msg.source === "platform_engine"
                              ? "Answered instantly by the local Personal AI Genie platform engine."
                              : msg.source === "local_agent"
                              ? `Executed by the local ${msg.agentName || "Python"} agent.`
                              : msg.source === "gemini-3.8-flash"
                              ? "Generated by the Personal AI Genie cloud API."
                              : msg.source === "backend-manifest"
                              ? "Answered by the built-in Personal AI Genie platform guide."
                              : msg.source === "openrouter-fallback"
                              ? "Generated by an OpenRouter fallback model."
                              : undefined
                          }
                          className={`mb-1 px-1 text-[10px] font-semibold ${
                            msg.source ? "cursor-help text-slate-500" : "text-slate-400"
                          }`}
                        >
                          {msg.source === "cloud_ai"
                            ? "✨ Personal AI Genie (Live AI)"
                            : msg.source === "platform_engine"
                            ? "⚙️ Personal AI Genie (Local Engine)"
                            : msg.source === "local_agent"
                            ? `⚡ Local Agent Engine: ${msg.agentName || "Python Agent"}`
                            : msg.source === "gemini-3.8-flash" || msg.source === "openrouter-fallback"
                            ? "✨ Personal AI Genie (Live AI)"
                            : msg.source === "backend-manifest"
                            ? "⚙️ Personal AI Genie (Platform Engine)"
                            : msg.senderName || "Personal AI Genie"}
                        </span>
                      )}

                      {msg.role === "user" ? (
                        <div className="group relative flex items-center gap-2">
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                            <button
                              onClick={() =>
                                setReplyTarget({
                                  author: msg.senderName || "User",
                                  content: msg.content,
                                })
                              }
                              className={`p-1 text-slate-400 hover:${selectedTheme.textClass}`}
                              title="Reply to message"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                            {isTeamMode &&
                              msg.role === "user" &&
                              msg.sender_id === roomIdentity &&
                              msg.id &&
                              !msg.is_deleted && (
                                <>
                                  <button
                                    onClick={() => {
                                      setEditingMessageId(msg.id!);
                                      setEditDraft(msg.content);
                                    }}
                                    className="p-1 text-slate-400 hover:text-sky-700"
                                    title="Edit message"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteRoomMessage(msg)}
                                    className="p-1 text-slate-400 hover:text-rose-600"
                                    title="Delete message"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            <button
                              onClick={() => setForwardMessage(msg)}
                              className={`p-1 text-slate-400 hover:${selectedTheme.textClass}`}
                              title="Forward message"
                            >
                              <Forward className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div
                            className={`group relative max-w-[85%] rounded-2xl px-4 py-3 text-sm text-white rounded-br-none shadow-sm space-y-1 ${
                              msg.triggeredByRainbow
                                ? "bg-gradient-to-r from-violet-600 via-pink-600 to-indigo-600 border border-amber-300"
                                : `bg-gradient-to-r ${selectedTheme.gradientClass}`
                            }`}
                          >
                            {msg.replyTo && (
                              <div className="bg-white/20 border-l-2 border-white/50 p-2 rounded text-xs text-white/90 mb-1">
                                <span className="font-bold block text-[10px]">
                                  Replying to {msg.replyTo.author}
                                </span>
                                <span className="truncate block opacity-90">{msg.replyTo.content}</span>
                              </div>
                            )}
                            {editingMessageId === msg.id ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editDraft}
                                  onChange={(event) => setEditDraft(event.target.value)}
                                  className="w-full min-w-48 rounded-lg border border-white/40 bg-white/15 p-2 text-sm text-white outline-none"
                                  aria-label="Edit room message"
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => setEditingMessageId(null)}
                                    className="rounded px-2 py-1 text-xs text-white/80 hover:bg-white/15"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleEditRoomMessage(msg)}
                                    className="rounded bg-white/20 px-2 py-1 text-xs font-semibold text-white hover:bg-white/30"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className={`whitespace-pre-wrap ${msg.is_deleted ? "italic opacity-75" : ""}`}>
                                {msg.content}
                                {msg.is_edited && !msg.is_deleted && (
                                  <span className="ml-2 text-[10px] opacity-70">(edited)</span>
                                )}
                              </p>
                            )}
                            {renderRoomReactions(msg)}
                          </div>
                          {isTeamMode && msg.role === "user" && msg.sender_id === roomIdentity && (
                            <div
                              className="room-receipts px-1 text-right text-xs"
                              aria-label={
                                (msg.read_by?.length || 0) >= Math.max(roomMemberCount - 1, 1) &&
                                roomMemberCount > 1
                                  ? "Read by all room members"
                                  : (msg.delivered_to?.length || 0) >= Math.max(roomMemberCount - 1, 1) &&
                                    roomMemberCount > 1
                                  ? "Delivered to all room members"
                                  : "Sent to room server"
                              }
                            >
                              {roomMemberCount > 1 &&
                              (msg.read_by?.length || 0) >= roomMemberCount - 1 ? (
                                <span className="rainbow-read-ticks">✓✓</span>
                              ) : roomMemberCount > 1 &&
                                (msg.delivered_to?.length || 0) >= roomMemberCount - 1 ? (
                                <span className="text-slate-400">✓✓</span>
                              ) : (
                                <span className="text-slate-400">✓</span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-full max-w-[85%] space-y-1.5">
                          <MessageBubble
                            provider={msg.provider || (msg.source === "openrouter-fallback" ? "OpenRouter" : msg.source === "cloud_ai" ? "Google Gemini" : "Personal AI Genie")}
                            model={msg.providerModel || msg.modelUsed || (msg.source === "platform_engine" ? "platform engine" : "AI response")}
                            autoFallback={msg.autoFallback}
                            className={`group relative max-w-full rounded-2xl rounded-bl-none px-4 py-3 text-sm leading-relaxed border shadow-sm ${
                              msg.isIntervention
                                ? `${selectedTheme.bgLightClass} ${selectedTheme.textClass} ${selectedTheme.borderClass}`
                                : "bg-white text-slate-800 border-slate-200"
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                            {(msg.source === "local_agent" || msg.source === "platform_engine") && msg.agentOutput && (
                              <div className="mt-3 space-y-2 border-t border-slate-200/80 pt-3 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold">{msg.agentOutput.agent_name}</span>
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                    {msg.agentOutput.status.replaceAll("_", " ")}
                                  </span>
                                </div>
                                {msg.agentOutput.logs.length > 0 && (
                                  <ul className="space-y-1 text-[10px] text-slate-500">
                                    {msg.agentOutput.logs.map((log, logIndex) => (
                                      <li key={`${logIndex}-${log}`}>• {log}</li>
                                    ))}
                                  </ul>
                                )}
                                {msg.agentOutput.results && msg.agentOutput.results.length > 0 && (
                                  <div className="space-y-1.5">
                                    {msg.agentOutput.results.map((result, resultIndex) => (
                                      <div
                                        key={`${resultIndex}-${result.title || result.company || "result"}`}
                                        className="rounded-lg border border-slate-200 bg-slate-50/80 p-2"
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <span className="font-semibold text-slate-700">
                                            {[result.title, result.company].filter(Boolean).join(" · ") || "Agent result"}
                                          </span>
                                          {typeof result.score === "number" && (
                                            <span className="shrink-0 font-bold text-emerald-700">{result.score}%</span>
                                          )}
                                        </div>
                                        {result.location && <p className="mt-0.5 text-[10px] text-slate-500">{result.location}</p>}
                                        {result.verdict && <p className="mt-0.5 text-[10px] text-slate-600">{result.verdict}</p>}
                                        {result.matched_skills && result.matched_skills.length > 0 && (
                                          <p className="mt-0.5 text-[10px] text-slate-500">
                                            Matched: {result.matched_skills.join(", ")}
                                          </p>
                                        )}
                                        {result.url && /^https?:\/\//i.test(result.url) && (
                                          <a href={result.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10px] font-semibold text-cyan-700 hover:underline">
                                            Open listing
                                          </a>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {renderRoomReactions(msg)}

                            {/* Code Canvas Preview Banner */}
                            {msg.extractedCode && (
                              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border">
                                <div className="flex items-center gap-2">
                                  <FileCode className={`w-4 h-4 ${selectedTheme.textClass}`} />
                                  <span className="text-xs font-bold text-slate-700">
                                    {msg.extractedCode.title} ({msg.extractedCode.language})
                                  </span>
                                </div>
                                <button
                                  onClick={() => setActiveCanvas(msg.extractedCode || null)}
                                  className={`px-3 py-1 ${selectedTheme.primaryClass} text-white rounded-lg text-xs font-bold shadow-xs transition-all`}
                                >
                                  Open Code Canvas
                                </button>
                              </div>
                            )}
                          </MessageBubble>

                          <div className="flex items-center gap-1.5 text-slate-400 px-1">
                            <button
                              onClick={() => handleSendMessage(undefined, false, messages[index - 1]?.content || "")}
                              className="p-1 hover:text-slate-700 rounded transition-colors"
                              title="Regenerate"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleCopyMessage(msg.content, index)}
                              className="p-1 hover:text-slate-700 rounded transition-colors"
                              title="Copy text"
                            >
                              {copiedIndex === index ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => setForwardMessage(msg)}
                              className={`p-1 hover:${selectedTheme.textClass} rounded transition-colors`}
                              title="Forward"
                            >
                              <Forward className="w-3.5 h-3.5" />
                            </button>

                            {/* Host Intervention Trigger */}
                            {isKeyOwner && isTeamMode && (
                              <button
                                onClick={() => handleHostIntervention(index)}
                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors"
                                title="Deep review audit"
                              >
                                <Sparkles className="w-3 h-3 text-amber-600" />
                                <span>Intervene & Review</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {isStreaming && (
                    streamingPreview ? (
                      <MessageBubble
                        provider={streamingProvider?.provider || "Google Gemini"}
                        model={streamingProvider?.model || "Connecting"}
                        autoFallback={streamingAutoFallback}
                        className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-none border border-cyan-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 shadow-sm"
                      >
                        {streamingPreview}
                      </MessageBubble>
                    ) : (
                      <div className="flex items-center gap-3 rounded-2xl border border-cyan-200/70 bg-white/90 p-3 shadow-[0_0_24px_rgba(14,165,233,0.12)]">
                        <span className="flex h-9 w-9 animate-pulse items-center justify-center rounded-full bg-gradient-to-br from-cyan-100 via-violet-100 to-pink-100 text-xl shadow-[0_0_16px_rgba(14,165,233,0.32)]" aria-hidden="true">
                          🤖
                        </span>
                        <span className="flex flex-col gap-1">
                          <span className="bg-gradient-to-r from-cyan-600 via-violet-600 to-pink-500 bg-clip-text text-xs font-semibold text-transparent animate-pulse">
                            Genie is crafting your response...
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-cyan-600" aria-label="Generating response">
                            <span className="animate-bounce">●</span>
                            <span className="animate-bounce [animation-delay:150ms]">●</span>
                            <span className="animate-bounce [animation-delay:300ms]">●</span>
                          </span>
                        </span>
                      </div>
                    )
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Code Canvas Panel */}
            {activeCanvas && (
              <div
                className={`${
                  isCanvasFullscreen
                    ? "fixed inset-4 z-50 rounded-2xl shadow-2xl border"
                    : "w-1/2 border-l"
                } bg-white border-slate-200 flex flex-col transition-all overflow-hidden`}
              >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white select-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-xs text-slate-800 truncate">
                      {activeCanvas.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span title="Cloud synced" className="text-slate-400 hover:text-slate-600 p-1 rounded">
                      <Cloud className="w-4 h-4 text-emerald-600" />
                    </span>
                    <button
                      title="Undo"
                      onClick={() => alert("Reverted to previous revision.")}
                      className="text-slate-400 hover:text-slate-700 p-1 rounded"
                    >
                      <Undo2 className="w-4 h-4" />
                    </button>
                    <button
                      title="Redo"
                      onClick={() => alert("Redo applied.")}
                      className="text-slate-400 hover:text-slate-700 p-1 rounded"
                    >
                      <Redo2 className="w-4 h-4" />
                    </button>

                    <div className="relative">
                      <button
                        onClick={() => setExportMenuOpen(!exportMenuOpen)}
                        className="flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-xs font-semibold transition-colors"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-600" />
                        <span>Export</span>
                        <ChevronDown className="w-3 h-3 text-slate-500" />
                      </button>

                      {exportMenuOpen && (
                        <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl py-1 w-44 z-50 text-xs">
                          <button
                            onClick={() => exportCanvasCode("code")}
                            className="w-full text-left px-3 py-1.5 hover:bg-purple-50 hover:text-purple-700 flex items-center gap-2"
                          >
                            <FileCode className="w-3.5 h-3.5" />
                            <span>Download ({activeCanvas.language || "tsx"})</span>
                          </button>
                          <button
                            onClick={() => exportCanvasCode("md")}
                            className="w-full text-left px-3 py-1.5 hover:bg-purple-50 hover:text-purple-700 flex items-center gap-2"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download Markdown (.md)</span>
                          </button>
                          <button
                            onClick={() => exportCanvasCode("txt")}
                            className="w-full text-left px-3 py-1.5 hover:bg-purple-50 hover:text-purple-700 flex items-center gap-2"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download Plain Text (.txt)</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      title="Share / Copy Snippet"
                      onClick={shareCanvasCode}
                      className="text-slate-400 hover:text-slate-700 p-1 rounded"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>

                    <button
                      title={isCanvasFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                      onClick={() => setIsCanvasFullscreen(!isCanvasFullscreen)}
                      className="text-slate-400 hover:text-slate-700 p-1 rounded"
                    >
                      {isCanvasFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>

                    <button
                      title="Close Canvas"
                      onClick={() => setActiveCanvas(null)}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto bg-slate-950 text-slate-100 font-mono text-xs p-4 leading-relaxed select-text">
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-800 text-slate-400 select-none">
                    <span className="text-[11px] font-bold uppercase tracking-wider">{activeCanvas.language}</span>
                    <button
                      onClick={copyCanvasCode}
                      className="flex items-center gap-1 text-[11px] hover:text-white bg-slate-800 px-2 py-1 rounded"
                    >
                      {canvasCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{canvasCopied ? "Copied" : "Copy Code"}</span>
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap">{activeCanvas.code}</pre>
                </div>
              </div>
            )}
          </div>

          {/* Floating Show Input Dock Pill */}
          {isDockHidden && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
              <button
                onClick={() => setIsDockHidden(false)}
                className={`flex items-center gap-1.5 px-4 py-2 bg-white/95 hover:bg-white ${selectedTheme.textClass} font-semibold text-xs border ${selectedTheme.borderClass} rounded-full shadow-lg backdrop-blur-md transition-all hover:scale-105`}
              >
                <ChevronUp className="w-4 h-4" />
                <span>Show Input Dock</span>
              </button>
            </div>
          )}

          {/* SECTION 6: CHAT INPUT DOCK */}
          {!isDockHidden && (
            <div className={`flex-shrink-0 w-full px-2 sm:px-4 py-2 sm:py-3 bg-white/95 backdrop-blur-md border-t ${selectedTheme.borderClass} shadow-lg transition-transform duration-300 pb-[max(0.75rem,env(safe-area-inset-bottom))]`}>
              {replyTarget && (
                <div className={`max-w-3xl mx-auto mb-2 flex items-center justify-between p-2 ${selectedTheme.bgLightClass} border ${selectedTheme.borderClass} rounded-xl text-xs`}>
                  <div className="truncate">
                    <span className={`font-bold ${selectedTheme.textClass}`}>Replying to {replyTarget.author}: </span>
                    <span className="text-slate-600 italic truncate">{replyTarget.content}</span>
                  </div>
                  <button onClick={() => setReplyTarget(null)} className="p-1 text-slate-400 hover:text-slate-700">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Status Header */}
              <div className="max-w-3xl mx-auto mb-1.5 sm:mb-2 flex items-center justify-between px-2.5 sm:px-3 py-1 bg-slate-50/90 border border-slate-200 rounded-xl text-[10px] sm:text-[11px]">
                <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                  {isTeamMode && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 text-white shadow-xs">
                      <Users className="w-3 h-3" />
                      <span className="truncate max-w-[120px] sm:max-w-none">Team • {userProfile.name}</span>
                    </span>
                  )}
                  {!isTeamMode && isQuotaEnforced && isObserverActive && (
                    <span className={`flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold ${remainingDailyChats > 5 ? "bg-purple-100 text-purple-800" : "bg-amber-100 text-amber-800"}`}>
                      <Sparkles className="w-3 h-3" />
                      <span>⚡ {remainingDailyChats} / {DAILY_FREE_LIMIT} Chats Left</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleObserverToggle()}
                    aria-pressed={isObserverActive}
                    className={`shrink-0 rounded-lg border px-2 py-1 text-[9px] font-bold transition-all sm:text-[10px] ${
                      isObserverActive
                        ? "border-cyan-300 bg-emerald-50 text-emerald-800 shadow-xs"
                        : "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {isObserverActive
                      ? "👁️ Observer ON"
                      : "👁️‍🗨️ Observer OFF"}
                  </button>
                </div>

                <span className={`hidden xs:inline text-[10px] ${selectedTheme.textClass} font-semibold truncate`}>
                  Type @Genie to query
                </span>
              </div>

              <div className="w-full max-w-3xl mx-auto relative">
                {attachmentMenuOpen && (
                  <div className="absolute left-2 bottom-full mb-3 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 z-50 w-72 text-slate-800 animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5 text-purple-600" />
                        <span>Productivity & Uploads</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setAttachmentMenuOpen(false)}
                        className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setAttachmentMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-purple-50 text-slate-700 hover:text-purple-700 rounded-xl transition-colors font-medium text-left"
                      >
                        <FileUp className="w-4 h-4 text-purple-600 shrink-0" />
                        <div>
                          <p className="font-semibold text-slate-800 text-[11px]">Upload Document / Data</p>
                          <p className="text-[10px] text-slate-400">PDF, Excel, Word, CSV, or Text</p>
                        </div>
                      </button>

                      {userProfile.role === "student" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setPrompt("Please summarize these study notes and generate key takeaways:");
                              setAttachmentMenuOpen(false);
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-purple-50 text-slate-700 hover:text-purple-700 rounded-xl transition-colors font-medium text-left"
                          >
                            <BookOpen className="w-4 h-4 text-emerald-600 shrink-0" />
                            <div>
                              <p className="font-semibold text-slate-800 text-[11px]">Summarize Study Notes</p>
                              <p className="text-[10px] text-slate-400">Exam preparation & revision</p>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPrompt("Help me debug and explain this code line-by-line:");
                              setAttachmentMenuOpen(false);
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-purple-50 text-slate-700 hover:text-purple-700 rounded-xl transition-colors font-medium text-left"
                          >
                            <Code2 className="w-4 h-4 text-sky-600 shrink-0" />
                            <div>
                              <p className="font-semibold text-slate-800 text-[11px]">Debug & Explain Code</p>
                              <p className="text-[10px] text-slate-400">Coding assignment walkthrough</p>
                            </div>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setPrompt("Draft an executive email regarding the following discussion points:");
                              setAttachmentMenuOpen(false);
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-purple-50 text-slate-700 hover:text-purple-700 rounded-xl transition-colors font-medium text-left"
                          >
                            <Mail className="w-4 h-4 text-indigo-600 shrink-0" />
                            <div>
                              <p className="font-semibold text-slate-800 text-[11px]">Draft Executive Email</p>
                              <p className="text-[10px] text-slate-400">Client operations communication</p>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPrompt("Analyze this operational revenue cycle audit data and highlight discrepancies:");
                              setAttachmentMenuOpen(false);
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-purple-50 text-slate-700 hover:text-purple-700 rounded-xl transition-colors font-medium text-left"
                          >
                            <Calculator className="w-4 h-4 text-amber-600 shrink-0" />
                            <div>
                              <p className="font-semibold text-slate-800 text-[11px]">Audit Table / Revenue Data</p>
                              <p className="text-[10px] text-slate-400">Financial discrepancy check</p>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPrompt("Synthesize our meeting notes into clear action items and assignees:");
                              setAttachmentMenuOpen(false);
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-purple-50 text-slate-700 hover:text-purple-700 rounded-xl transition-colors font-medium text-left"
                          >
                            <CheckSquare className="w-4 h-4 text-teal-600 shrink-0" />
                            <div>
                              <p className="font-semibold text-slate-800 text-[11px]">Meeting Minutes & Action Items</p>
                              <p className="text-[10px] text-slate-400">Team alignment summary</p>
                            </div>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Emoji Bar */}
                {emojiPickerOpen && (
                  <div className="absolute left-2 sm:left-10 bottom-full mb-3 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 sm:p-3 z-50 flex items-center gap-1 sm:gap-2 overflow-x-auto max-w-[95vw]">
                    {QUICK_EMOJIS.map((emoji) => (
                      <div key={emoji.symbol} className="relative group shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setPrompt((prev) => prev + emoji.symbol);
                            setEmojiPickerOpen(false);
                          }}
                          className="text-base sm:text-lg hover:scale-125 transition-transform p-1 rounded-lg hover:bg-slate-100"
                        >
                          {emoji.symbol}
                        </button>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-slate-900 text-white text-[10px] font-semibold py-1 px-2 rounded-md whitespace-nowrap shadow-lg pointer-events-none z-50">
                          {emoji.tooltip}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <form
                  onSubmit={(e) => handleSendMessage(e, false)}
                  className="w-full flex items-center bg-white border border-slate-200 shadow-md rounded-2xl sm:rounded-full px-2 sm:px-4 py-1.5 sm:py-2 hover:shadow-lg focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100 transition-all gap-1 sm:gap-2"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        setPrompt((prev) =>
                          prev ? `${prev} [Attached File: ${f.name}]` : `[Attached File: ${f.name}] `
                        );
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setAttachmentMenuOpen(!attachmentMenuOpen);
                      setEmojiPickerOpen(false);
                    }}
                    className="p-1 sm:p-2 text-slate-400 hover:text-purple-600 transition-colors shrink-0"
                    title="Productivity Boosters & File Upload"
                  >
                    <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEmojiPickerOpen(!emojiPickerOpen);
                      setAttachmentMenuOpen(false);
                    }}
                    className="p-1 sm:p-2 text-slate-400 hover:text-amber-500 transition-colors shrink-0"
                    title="Add quick emoji reaction"
                  >
                    <Smile className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>

                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      isListening
                        ? `Listening in ${selectedLang.label}...`
                        : isTeamMode
                        ? `Message team or @Genie...`
                        : isObserverActive && isQuotaEnforced && remainingDailyChats === 0
                        ? "Daily quota reached..."
                        : "Ask Genie anything..."
                    }
                    disabled={isObserverActive && isQuotaEnforced && remainingDailyChats === 0}
                    className="flex-1 min-w-0 bg-transparent px-1 sm:px-3 text-slate-900 placeholder-slate-400 text-xs sm:text-sm focus:outline-none disabled:opacity-50"
                  />

                  <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setLangMenuOpen(!langMenuOpen)}
                        className={`flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-[11px] font-semibold ${selectedTheme.textClass} ${selectedTheme.bgLightClass} border ${selectedTheme.borderClass} px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full transition-colors`}
                      >
                        <Globe className="w-3 h-3" />
                        <span className="hidden sm:inline">{selectedLang.label}</span>
                        <span className="sm:hidden">{selectedLang.code.split("-")[0].toUpperCase()}</span>
                        <ChevronDown className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      </button>

                      {langMenuOpen && (
                        <div className="absolute right-0 bottom-full mb-2 bg-white border border-slate-200 rounded-xl shadow-xl py-1 w-36 z-50">
                          {INDIAN_LANGUAGES.map((lang) => (
                            <button
                              key={lang.code}
                              type="button"
                              onClick={() => {
                                setSelectedLang(lang);
                                setLangMenuOpen(false);
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:${selectedTheme.bgLightClass} transition-colors flex items-center justify-between ${
                                selectedLang.code === lang.code
                                  ? `${selectedTheme.textClass} font-semibold ${selectedTheme.bgLightClass}`
                                  : "text-slate-700"
                              }`}
                            >
                              <span>{lang.label}</span>
                              <span className="text-[10px] text-slate-400">{lang.code.split("-")[0]}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <VoiceMic
                      backendUrl={API_BASE}
                      disabled={isStreaming}
                      onRecordingChange={setIsListening}
                      onTranscription={(text) => {
                        setIsListening(false);
                        void handleSendMessage(undefined, false, text);
                      }}
                    />

                    {isStreaming ? (
                      <button
                        type="button"
                        onClick={() => activeChatAbortControllerRef.current?.abort()}
                        className="rounded-full bg-rose-600 p-1.5 text-white shadow-sm transition-colors hover:bg-rose-700 sm:p-2"
                        title="Stop generating"
                        aria-label="Stop generating"
                      >
                        <Square className="h-3.5 w-3.5 fill-current sm:h-4 sm:w-4" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!prompt.trim() || (isObserverActive && isQuotaEnforced && remainingDailyChats === 0)}
                        className={`p-1.5 sm:p-2 bg-gradient-to-r ${selectedTheme.gradientClass} text-white rounded-full disabled:opacity-40 transition-all shadow-xs shrink-0`}
                        title="Send message"
                      >
                        <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </button>
                    )}

                    {/* Rainbow Send */}
                    {isTeamMode && (
                      <button
                        type="button"
                        onClick={(e) => handleSendMessage(e, true)}
                        disabled={isStreaming || (isObserverActive && isQuotaEnforced && remainingDailyChats === 0)}
                        className="p-1.5 sm:p-2 bg-gradient-to-r from-violet-600 via-pink-500 via-amber-400 to-emerald-400 text-white rounded-full hover:scale-105 transition-all shadow-xs animate-pulse shrink-0"
                        title="Rainbow Send: Prompt Genie to observe and respond immediately"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setIsDockHidden(true)}
                      className="hidden sm:block p-1.5 text-slate-400 hover:text-slate-700 rounded-full transition-colors shrink-0"
                      title="Hide chat dock"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </form>

                {/* Visible User Disclaimer */}
                <div className="flex items-center justify-center gap-1.5 sm:gap-2 mt-1.5 sm:mt-2 select-none text-[10px] sm:text-[11px] text-slate-400">
                  <p className="truncate">Personal AI Genie can make mistakes.</p>
                  <span>•</span>
                  <button
                    onClick={() => setLegalModalOpen(true)}
                    className="text-purple-600 hover:underline font-semibold shrink-0"
                  >
                    Terms & Disclaimer
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* SECTION 7: MODALS */}
      {legalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-600" />
                <h3 className="font-bold text-slate-800 text-base">Terms of Service, Disclaimer & Legal Notice</h3>
              </div>
              <button onClick={() => setLegalModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-700" />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-4 leading-relaxed">
              <div>
                <h4 className="font-bold text-slate-800 text-sm mb-1">1. User Agreement & Acceptable Use</h4>
                <p>
                  By accessing or utilizing Personal AI Genie, you accept full accountability for your prompts and integrations. You agree not to use the service for unauthorized security penetration, automated high-frequency abuse, or generating malicious code payloads.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 text-sm mb-1">2. AI Accuracy & Non-Professional Advice Disclaimer</h4>
                <p>
                  Outputs generated by Personal AI Genie are algorithmically synthesized using large language model inference. They are provided strictly for educational, organizational, and general productivity assistance. Outputs do NOT constitute professional medical, legal, financial, architectural, or security advice.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 text-sm mb-1">3. Quota Limits, Sovereign Rooms & BYOK</h4>
                <p>
                  - <strong>Free Quota</strong>: Standard consumer accounts receive twenty (20) interactions per rolling 24-hour cycle.
                  <br />
                  - <strong>Bring Your Own Key (BYOK)</strong>: When supplying your own Gemini API keys, token billing and quota terms are directly between you and the respective model provider.
                  <br />
                  - <strong>Room Sovereignty</strong>: Meeting hosts hold sole authority over Room Security Passcodes, attendee delegation, and observer deep-review audits.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-slate-800 text-sm mb-1">4. Privacy & Data Handling Policy</h4>
                <p>
                  Personal AI Genie does not sell user information. Identity data retrieved from Google OAuth (name, email, and avatar) is used to verify archive ownership and render user presence. Human room message bodies are encrypted client-side before relay and encrypted room transcripts are persisted; private threads are never copied into room state. Only when a user explicitly invokes Genie or Observer Review is a bounded, client-decrypted room context sent to the configured AI proxy. Personal and social archive snapshots are also encrypted client-side. Archive encryption keys are browser-profile bound and are not recoverable if browser storage is cleared.
                </p>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t">
              <button
                onClick={handleDownloadProjectDocumentation}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save Terms & Docs (.md)</span>
              </button>

              <button
                onClick={() => setLegalModalOpen(false)}
                className={`px-5 py-2 ${selectedTheme.primaryClass} text-white rounded-xl text-xs font-bold transition-all shadow-sm`}
              >
                I Understand & Agree
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmRegenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-bold text-slate-800">Regenerate Room Passcode?</h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                Warning: Generating a new room passcode will immediately <strong className="text-rose-600">inactivate and terminate</strong> the current active passcode ({roomPasscode}). Anyone with previous links will be locked out and must receive the new passcode.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmRegenerateModalOpen(false)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executePasscodeRegeneration}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm"
              >
                Yes, Terminate & Replace
              </button>
            </div>
          </div>
        </div>
      )}

      {quotaExceededModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="w-14 h-14 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <Sparkles className="w-7 h-7" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-bold text-slate-800">Daily Free Limit Reached (20/20)</h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                You have used all 20 free messages for today. Your free quota resets every 24 hours. Want unlimited access right now?
              </p>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => {
                  setQuotaExceededModalOpen(false);
                  setSettingsOpen(true);
                  setSettingsTab("developer");
                }}
                className={`w-full py-2.5 ${selectedTheme.primaryClass} text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2`}
              >
                <Key className="w-4 h-4" />
                <span>Bring Your Own Key (BYOK) for Unlimited Chats</span>
              </button>

              <button
                onClick={() => {
                  setQuotaExceededModalOpen(false);
                  setSettingsOpen(true);
                  setSettingsTab("totp");
                }}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
              >
                <QrCode className="w-4 h-4" />
                <span>Enter VIP Passcode / Authenticator</span>
              </button>
            </div>

            <button
              onClick={() => setQuotaExceededModalOpen(false)}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-600 pt-1"
            >
              Close and wait for midnight reset
            </button>
          </div>
        </div>
      )}

      {roomAdminOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Room Members & Governance</h3>
                <p className="text-[11px] text-slate-400">
                  Sovereign: {isKeyOwner ? "You (API Key Owner)" : "Host Delegated"}
                </p>
              </div>
              <button onClick={() => setRoomAdminOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-700" />
              </button>
            </div>

            <DynamicTeamModal
              mode={roomCapacityMode}
              customCapacity={customRoomCapacity}
              activeMembers={activeRoomMemberCount}
              panelClass={currentTheme.bgLightClass}
              borderClass={currentTheme.borderClass}
              textClass={currentTheme.textClass}
              mutedTextClass="text-slate-500"
              surfaceClass="bg-white"
              onModeChange={setRoomCapacityMode}
              onCustomCapacityChange={setCustomRoomCapacity}
            />

            <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Room Security Passcode</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-mono font-bold bg-white px-2 py-1 rounded-lg border ${selectedTheme.textClass}`}>
                    {roomPasscode}
                  </span>
                  {isKeyOwner && (
                    <button
                      onClick={() => setConfirmRegenerateModalOpen(true)}
                      className={`p-1 hover:${selectedTheme.textClass} text-slate-400`}
                      title="Regenerate Passcode"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Room URL Link</span>
                <button
                  type="button"
                  onClick={copyRoomInvite}
                  className={`flex items-center gap-1.5 text-xs font-semibold ${selectedTheme.textClass} hover:underline`}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>{inviteCopied ? "Copied!" : "Copy Link"}</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleSendDirectInvites} className={`${selectedTheme.bgLightClass} border ${selectedTheme.borderClass} rounded-2xl p-3.5 space-y-2.5`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Mail className={`w-4 h-4 ${selectedTheme.textClass}`} />
                  <span className={`text-xs font-bold ${selectedTheme.textClass}`}>Direct Meeting Invite Dispatcher</span>
                </div>
                <span className={`text-[10px] ${selectedTheme.textClass} font-semibold`}>Uses 1 Dispatch Credit</span>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-700 block">Required Attendees (comma-separated):</label>
                <input
                  type="text"
                  value={requiredAttendees}
                  onChange={(e) => setRequiredAttendees(e.target.value)}
                  placeholder="e.g. lead@domain.com, teammate@domain.com"
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-700 block">Optional Attendees (comma-separated):</label>
                <input
                  type="text"
                  value={optionalAttendees}
                  onChange={(e) => setOptionalAttendees(e.target.value)}
                  placeholder="e.g. observer@domain.com, guest@domain.com"
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-700 block">Agenda / Meeting Note:</label>
                <input
                  type="text"
                  value={meetingAgenda}
                  onChange={(e) => setMeetingAgenda(e.target.value)}
                  placeholder="e.g. Reviewing Q4 Strategy & AI Genie Onboarding"
                  className="w-full text-xs border border-slate-200 rounded-xl px-3 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>

              {dispatchStatus && (
                <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 p-2 rounded-lg">
                  {dispatchStatus}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  className={`flex-1 py-1.5 ${selectedTheme.primaryClass} text-white rounded-xl text-xs font-bold transition-all shadow-xs`}
                >
                  Send Direct Invites
                </button>
                <button
                  type="button"
                  onClick={copyFormattedInviteNote}
                  className={`px-3 py-1.5 bg-white border ${selectedTheme.borderClass} ${selectedTheme.textClass} hover:${selectedTheme.bgLightClass} rounded-xl text-xs font-semibold transition-all shadow-xs`}
                >
                  Copy Note
                </button>
              </div>
            </form>

            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                Active Member Roster
              </span>

              {members.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  No teammates connected yet. Share the invite link above!
                </div>
              ) : (
                members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GenieAvatar
                        src={member.avatarUrl}
                        alt={member.name}
                        className={`w-7 h-7 rounded-full border ${selectedTheme.borderClass} flex-shrink-0`}
                      />
                      <div className="truncate">
                        <span className="font-semibold text-slate-800 block truncate">{member.name}</span>
                        <span className="text-[10px] text-slate-400 block truncate">{member.email}</span>
                      </div>
                      {member.role === "sovereign" && (
                        <span className="text-[9px] bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded flex-shrink-0">
                          SOVEREIGN
                        </span>
                      )}
                      {member.role === "admin" && (
                        <span className="text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded flex-shrink-0">
                          ADMIN
                        </span>
                      )}
                      {member.role === "developer" && (
                        <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded flex-shrink-0">
                          DEV
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isKeyOwner && member.role !== "sovereign" && (
                        <button
                          onClick={() => handlePromoteAdmin(member.id)}
                          className="px-2 py-0.5 text-[10px] font-bold bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-slate-700"
                        >
                          {member.role === "admin" ? "Demote" : "Make Admin"}
                        </button>
                      )}

                      {member.role !== "sovereign" && (
                        <button
                          onClick={() =>
                            setMembers((prev) =>
                              prev.map((m) =>
                                m.id === member.id
                                  ? {
                                      ...m,
                                      status: m.status === "active" ? "inactive" : "active",
                                    }
                                  : m
                              )
                            )
                          }
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl font-bold text-[10px] transition-all ml-1 flex-shrink-0 ${
                            member.status === "active"
                              ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                              : "bg-rose-100 text-rose-800 hover:bg-rose-200"
                          }`}
                        >
                          {member.status === "active" ? (
                            <>
                              <UserCheck className="w-3 h-3" /> Active
                            </>
                          ) : (
                            <>
                              <UserX className="w-3 h-3" /> Inactive
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {shareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <span className="font-bold text-slate-800 text-sm">Invite Friend to this Conversation</span>
              <button type="button" onClick={() => setShareModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <p className="text-xs text-slate-600 font-medium truncate">
              {sessions.find((session) => session.id === shareSessionId)?.title || currentSession?.title}
            </p>
            <p className="text-[11px] text-slate-500">
              This encrypted invite creates a room for you and one friend. The selected transcript is added
              after your friend joins.
            </p>
            <div className={`rounded-xl border ${selectedTheme.borderClass} ${selectedTheme.bgLightClass} p-3`}>
              <label htmlFor="shared-room-invite" className="mb-1 block text-[10px] font-semibold text-slate-500">
                One-click invite link
              </label>
              <input
                id="shared-room-invite"
                readOnly
                value={
                  typeof window === "undefined" || !shareInviteSessionId
                    ? ""
                    : `${window.location.origin}/room/share_${shareInviteSessionId}`
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] text-slate-700"
              />
            </div>
            <button
              type="button"
              onClick={() => void startSharedConversationInvite()}
              className={`flex w-full items-center justify-center gap-2 rounded-xl ${selectedTheme.primaryClass} px-3 py-2.5 text-xs font-bold text-white shadow-sm`}
            >
              <Copy className="h-3.5 w-3.5" />
              Start Secure Room & Copy Invite
            </button>
          </div>
        </div>
      )}

      {blockTarget && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="block-user-title"
            className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-rose-50 p-2 text-rose-700"><Ban className="h-5 w-5" /></div>
              <div>
                <h2 id="block-user-title" className="text-sm font-bold text-slate-900">
                  Block {blockTarget.handle || blockTarget.display_name}?
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  Blocked users cannot message you or invite you to rooms. You will no longer see each other’s online status, and their messages will be hidden from you in shared rooms. You can unblock them in Settings.
                </p>
              </div>
            </div>
            {chatError && (
              <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{chatError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBlockTarget(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmBlockUser()}
                className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Block User
              </button>
            </div>
          </section>
        </div>
      )}

      {friendsQueueOpen && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFriendsQueueOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="friends-queue-title"
            className={`max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-3xl border ${selectedTheme.borderClass} bg-white p-5 shadow-2xl sm:p-7`}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id="friends-queue-title" className="text-lg font-bold text-slate-900">Friends Queue</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Verified, discoverable Meta links only. Direct messages are encrypted for each room member.
                </p>
              </div>
              <button type="button" onClick={() => setFriendsQueueOpen(false)} aria-label="Close Friends Queue" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            {isFriendsLoading && <p role="status" className="mb-3 text-xs text-slate-500">Refreshing friends and rooms...</p>}
            {friendsQueueError && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{friendsQueueError}</p>}
            <div className="mb-5 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Discoverable friends</h3>
              {discoverableFriends.length ? discoverableFriends.map((friend) => (
                <div key={friend.user_id} className="relative flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <GenieAvatar src={friend.avatar_url} alt={friend.handle} className="h-9 w-9 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800">{friend.handle || friend.display_name}</p>
                    <p className={`text-[11px] ${friend.is_online ? "text-emerald-600" : "text-slate-400"}`}>
                      <span aria-hidden="true">{friend.is_online ? "●" : "○"}</span> {friend.is_online ? "Online" : "Offline"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openDirectFriendRoom(friend)}
                    className={`shrink-0 rounded-lg px-3 py-2 text-[11px] font-semibold text-white ${selectedTheme.primaryClass}`}
                  >
                    Open chat
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      aria-label={`More options for ${friend.handle || friend.display_name}`}
                      aria-expanded={friendMenuUserId === friend.user_id}
                      onClick={() => setFriendMenuUserId((current) => current === friend.user_id ? null : friend.user_id)}
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {friendMenuUserId === friend.user_id && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                        <button
                          type="button"
                          onClick={() => setBlockTarget({
                            user_id: friend.user_id,
                            display_name: friend.display_name,
                            handle: friend.handle,
                            avatar_url: friend.avatar_url,
                          })}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          <Ban className="h-3.5 w-3.5" /> Block User
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )) : (
                <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
                  No discoverable friends yet. Link and verify Meta in Settings → Profile to join the directory.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Permanent sovereign rooms</h3>
              {sovereignRooms.length ? sovereignRooms.map((room) => (
                <button
                  key={room.room_id}
                  type="button"
                  onClick={() => openSovereignRoom(room)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-slate-800">{room.title}</span>
                    <span className="mt-1 block text-[10px] text-slate-500">{room.members.length} member(s) · Host {room.host_id.replace(/^google:/, "")}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-400">{new Date(room.updated_at).toLocaleDateString()}</span>
                </button>
              )) : (
                <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">No permanent rooms are associated with this account yet.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {archiveModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setArchiveModalOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-dialog-title"
            className={`max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border ${selectedTheme.borderClass} bg-white p-5 shadow-2xl sm:p-7`}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id="archive-dialog-title" className="text-lg font-bold text-slate-900">
                  Restore Your Genie Archive
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Choose which independent archive buckets or room transcripts to restore.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setArchiveModalOpen(false)}
                aria-label="Close archive restore dialog"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isArchiveLoading && (
              <p role="status" className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Loading archive data...
              </p>
            )}

            {archiveError && (
              <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {archiveError}
              </p>
            )}

            {archiveStatus && (
              <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {archiveStatus}
              </p>
            )}

            <div className="space-y-3">
              <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border ${selectedTheme.borderClass} p-4 ${archiveManifest.personal ? "hover:bg-slate-50" : "opacity-60"}`}>
                <input
                  type="checkbox"
                  disabled={!archiveManifest.personal || isArchiveLoading}
                  checked={selectedArchiveItems.has("personal")}
                  onChange={() => toggleArchiveItem("personal")}
                  className="mt-1 rounded"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">Personal AI Genie Thread</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {archiveManifest.personal
                      ? `${archiveManifest.personal.message_count} messages · Last saved ${new Date(archiveManifest.personal.saved_at).toLocaleString()}`
                      : "No personal thread backup found"}
                  </span>
                </span>
              </label>

              <section className={`rounded-2xl border ${selectedTheme.borderClass} p-4 ${userProfile.socialProfileId ? "" : "opacity-60"}`}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    disabled={!userProfile.socialProfileId || !archiveManifest.social.length || isArchiveLoading}
                    checked={
                      archiveManifest.social.some((item) => item.meta_user_id === userProfile.socialProfileId) &&
                      archiveManifest.social
                        .filter((item) => item.meta_user_id === userProfile.socialProfileId)
                        .every((item) => selectedArchiveItems.has(`social:${item.archive_key}`))
                    }
                    onChange={() => {
                      const next = new Set(selectedArchiveItems);
                      const keys = archiveManifest.social
                        .filter((item) => item.meta_user_id === userProfile.socialProfileId)
                        .map((item) => `social:${item.archive_key}`);
                      if (keys.every((key) => next.has(key))) keys.forEach((key) => next.delete(key));
                      else keys.forEach((key) => next.add(key));
                      setSelectedArchiveItems(next);
                    }}
                    className="mt-1 rounded"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">Direct Friend Chats</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {!userProfile.socialProfileId
                        ? "Link Meta in Profile preferences to restore these chats."
                        : archiveManifest.social.length
                        ? `${archiveManifest.social.filter((item) => item.meta_user_id === userProfile.socialProfileId).length} matching saved thread(s) · Linked as ${userProfile.socialHandle || "Meta profile"}`
                        : "No Meta-synced direct chat backups found"}
                    </span>
                  </span>
                </label>
                {archiveManifest.social.map((thread) => (
                  <label key={thread.archive_key} className="ml-7 mt-3 flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      disabled={!userProfile.socialProfileId || thread.meta_user_id !== userProfile.socialProfileId || isArchiveLoading}
                      checked={selectedArchiveItems.has(`social:${thread.archive_key}`)}
                      onChange={() => toggleArchiveItem(`social:${thread.archive_key}`)}
                      className="mt-0.5 rounded"
                    />
                    <span className="text-xs text-slate-600">
                      {thread.linked_handle || thread.title || "Direct chat"} · {thread.message_count} messages · {new Date(thread.saved_at).toLocaleString()}
                    </span>
                  </label>
                ))}
              </section>

              <section className={`rounded-2xl border ${selectedTheme.borderClass} p-4`}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    disabled={!archiveManifest.team_rooms.length || isArchiveLoading}
                    checked={
                      archiveManifest.team_rooms.length > 0 &&
                      archiveManifest.team_rooms.every((room) =>
                        selectedArchiveItems.has(`team_rooms:${room.room_id || room.archive_key}`)
                      )
                    }
                    onChange={() => {
                      const next = new Set(selectedArchiveItems);
                      const keys = archiveManifest.team_rooms.map(
                        (room) => `team_rooms:${room.room_id || room.archive_key}`
                      );
                      if (keys.every((key) => next.has(key))) keys.forEach((key) => next.delete(key));
                      else keys.forEach((key) => next.add(key));
                      setSelectedArchiveItems(next);
                    }}
                    className="mt-1 rounded"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">Sovereign Team Rooms &amp; Executive Reviews</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {archiveManifest.team_rooms.length
                        ? `${archiveManifest.team_rooms.length} saved room(s)`
                        : "No team room backups found"}
                    </span>
                  </span>
                </label>
                {archiveManifest.team_rooms.map((room) => {
                  const itemKey = `team_rooms:${room.room_id || room.archive_key}`;
                  return (
                    <label key={itemKey} className="ml-7 mt-3 flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        disabled={isArchiveLoading}
                        checked={selectedArchiveItems.has(itemKey)}
                        onChange={() => toggleArchiveItem(itemKey)}
                        className="mt-0.5 rounded"
                      />
                      <span className="text-xs text-slate-600">
                        {room.room_title || room.title || room.room_id} · Host: {room.host_name || "Unknown"} · {room.message_count} messages · {new Date(room.saved_at).toLocaleString()}
                      </span>
                    </label>
                  );
                })}
              </section>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <span className="text-xs text-slate-500" aria-live="polite">
                {selectedArchiveItems.size} archive item(s) selected
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setArchiveModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedArchiveItems.size || isArchiveLoading}
                  onClick={() => void handleRestoreArchive()}
                  className={`rounded-xl ${selectedTheme.primaryClass} px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {isArchiveLoading
                    ? "Restoring..."
                    : `Restore Selected (${selectedArchiveItems.size})`}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className={`flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border ${selectedTheme.borderClass} bg-white shadow-2xl`}>
            <div className={`flex flex-shrink-0 items-center justify-between border-b ${selectedTheme.borderClass} ${selectedTheme.bgLightClass} px-6 py-4`}>
              <div className="flex items-center gap-2.5">
                <div className={`p-2 ${selectedTheme.bgLightClass} rounded-xl ${selectedTheme.textClass}`}>
                  <SettingsIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Genie Workspace Preferences</h3>
                  <p className="text-[11px] text-slate-400">
                    Active Engine:                     <span className={`font-mono ${selectedTheme.textClass} font-bold`}>{activeModelName}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openArchiveRestore}
                  className={`rounded-lg border ${selectedTheme.borderClass} bg-white px-3 py-2 text-[11px] font-semibold ${selectedTheme.textClass}`}
                >
                  Restore Archive
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveArchive()}
                  disabled={isSavingArchive}
                  className={`rounded-lg ${selectedTheme.primaryClass} px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60`}
                >
                  {isSavingArchive ? "Saving..." : "Save Archive"}
                </button>
                <button onClick={() => setSettingsOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <nav
                role="tablist"
                aria-orientation="vertical"
                aria-label="Workspace preference sections"
                className={`flex w-36 flex-shrink-0 flex-col gap-1 border-r ${selectedTheme.borderClass} ${selectedTheme.bgLightClass} p-2 sm:w-48 sm:p-3`}
              >
                {([
                  { id: "profile", label: "Profile", icon: User },
                  { id: "theme", label: "Theme", icon: Palette },
                  { id: "developer", label: "BYOK", icon: Key },
                  { id: "totp", label: "Authenticator", icon: QrCode },
                  { id: "blocked", label: "Blocked Users", icon: UserX },
                  { id: "docs", label: "Docs", icon: FileText },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    id={`${id}-tab`}
                    type="button"
                    role="tab"
                    onClick={() => setSettingsTab(id)}
                    aria-controls={`${id}-panel`}
                    aria-selected={settingsTab === id}
                    className={`flex w-full items-center gap-2 rounded-xl border-l-2 px-2.5 py-2.5 text-left text-xs font-bold transition-colors sm:px-3 ${
                      settingsTab === id
                        ? `${selectedTheme.borderClass} ${selectedTheme.bgLightClass} ${selectedTheme.textClass}`
                        : "border-transparent text-slate-500 hover:bg-white hover:text-slate-800"
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </nav>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                  id={`${settingsTab}-panel`}
                  role="tabpanel"
                  aria-labelledby={`${settingsTab}-tab`}
                  className="min-h-0 flex-1 overflow-y-auto"
                >

            {settingsTab === "profile" && (
              <div className="space-y-4 p-5 sm:p-7">
                <div className={`flex items-center justify-between p-3 ${selectedTheme.bgLightClass} border ${selectedTheme.borderClass} rounded-2xl`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <GenieAvatar
                      src={userProfile.avatarUrl}
                      alt={userProfile.name}
                      className={`w-11 h-11 rounded-full border-2 ${selectedTheme.borderClass} shadow-sm flex-shrink-0`}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-sm text-slate-800 block truncate">{userProfile.name}</span>
                      <span className="text-xs text-slate-500 block truncate">{userProfile.email || "No email bound"}</span>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1 mt-0.5 ${
                          isDevUser
                            ? "text-amber-600"
                            : isVipUser
                            ? "text-emerald-600"
                            : selectedTheme.textClass
                        }`}
                      >
                        {isDevUser ? (
                          <>
                            <Code2 className="w-3 h-3" /> Lead Developer & Support Engineer
                          </>
                        ) : isVipUser ? (
                          <>
                            <ShieldCheck className="w-3 h-3" /> ★ Primary VIP Account
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="w-3 h-3" /> Free Tier ({remainingDailyChats}/20 Left Today)
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      handleSignOut();
                      setSettingsOpen(false);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-xl transition-all shadow-xs ml-2 flex-shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">Workflow Persona</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setUserProfile((p) => ({ ...p, role: "student" }))}
                      className={`flex items-center justify-center gap-2 p-2.5 rounded-2xl border text-xs font-semibold transition-all ${
                        userProfile.role === "student"
                          ? `${selectedTheme.borderClass} ${selectedTheme.bgLightClass} ${selectedTheme.textClass} shadow-sm`
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <GraduationCap className="w-4 h-4" />
                      <span>Student Mode</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setUserProfile((p) => ({ ...p, role: "professional" }))}
                      className={`flex items-center justify-center gap-2 p-2.5 rounded-2xl border text-xs font-semibold transition-all ${
                        userProfile.role === "professional"
                          ? `${selectedTheme.borderClass} ${selectedTheme.bgLightClass} ${selectedTheme.textClass} shadow-sm`
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <Briefcase className="w-4 h-4" />
                      <span>Professional Pro</span>
                    </button>
                  </div>
                </div>

                {userProfile.role === "professional" && (
                  <div className={`p-3 ${selectedTheme.bgLightClass} border ${selectedTheme.borderClass} rounded-2xl space-y-1.5`}>
                    <label className={`text-xs font-bold ${selectedTheme.textClass} block`}>
                      Profession / Industry Domain:
                    </label>
                    <input
                      type="text"
                      value={userProfile.profession}
                      onChange={(e) => setUserProfile({ ...userProfile, profession: e.target.value })}
                      placeholder="e.g. Healthcare Revenue Cycle & Client Operations"
                      className="w-full text-xs border border-slate-300 rounded-xl px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                )}

                <section className={`space-y-2 rounded-2xl border ${selectedTheme.borderClass} p-3`}>
                  <div className="flex items-center gap-2">
                    <Users className={`h-4 w-4 ${selectedTheme.textClass}`} />
                    <h4 className="text-xs font-bold text-slate-800">Optional Social Sync</h4>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Google remains your sign-in identity. Verified Meta linking opts you into the discoverable Friends Queue; your Meta access token is verified server-side and is never stored.
                  </p>
                  {FACEBOOK_APP_ID ? (
                    <div className="flex items-center gap-3">
                      {userProfile.socialAvatarUrl && (
                        <GenieAvatar
                          src={userProfile.socialAvatarUrl}
                          alt={userProfile.socialHandle || "Linked social profile"}
                          className="h-8 w-8 rounded-full"
                        />
                      )}
                      <input
                        type="text"
                        value={userProfile.socialHandle}
                        onChange={(event) =>
                          setUserProfile((previous) => ({ ...previous, socialHandle: event.target.value }))
                        }
                        onBlur={(event) => {
                          const handle = event.currentTarget.value.trim();
                          setUserProfile((previous) => ({ ...previous, socialHandle: handle }));
                          void saveSocialHandle(handle);
                        }}
                        placeholder="Instagram or Facebook handle"
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700"
                      />
                      <button
                        type="button"
                        onClick={handleMetaLogin}
                        className={`rounded-xl border ${selectedTheme.borderClass} px-3 py-2 text-[11px] font-semibold ${selectedTheme.textClass} hover:${selectedTheme.bgLightClass}`}
                      >
                        {userProfile.socialHandle ? "Update link" : "Link Meta"}
                      </button>
                    </div>
                  ) : (
                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-500">
                      Social linking is optional and inactive in local dev.
                    </span>
                  )}
                  {userProfile.isDiscoverable && (
                    <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                      <span>Discoverable to Genie users</span>
                      <button
                        type="button"
                        onClick={() => void unlinkSocialDiscovery()}
                        className="font-semibold underline"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  {FACEBOOK_APP_ID && metaLoginError && (
                    <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                      {metaLoginError}
                    </p>
                  )}
                </section>
              </div>
            )}

            {settingsTab === "theme" && (
              <div className="space-y-4 p-5 sm:p-7">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Customize Workspace Theme</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Choose a personalized theme preset for your Genie workspace.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {THEME_PRESETS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTheme(t)}
                      className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                        selectedTheme.id === t.id
                          ? `${t.borderClass} ${t.bgLightClass} shadow-sm`
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-800">{t.name}</span>
                        {selectedTheme.id === t.id && (
                          <Check className={`w-3.5 h-3.5 ${selectedTheme.textClass}`} />
                        )}
                      </div>
                      <div className={`w-full h-3 rounded-full bg-gradient-to-r ${t.gradientClass}`} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {settingsTab === "developer" && (
              <div className="space-y-4 p-5 sm:p-7">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Key className="w-4 h-4 text-amber-500" />
                      <span className="text-xs font-bold text-slate-800">Bring Your Own Key (BYOK)</span>
                    </div>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className={`flex items-center gap-1 text-[11px] font-semibold ${selectedTheme.textClass} hover:underline`}
                    >
                      <span>Get Gemini Key</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={userProfile.customApiKey}
                      onChange={(e) => setUserProfile({ ...userProfile, customApiKey: e.target.value })}
                      placeholder={userProfile.customApiKey ? "••••••••" : "Paste Gemini API key"}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-10 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-200"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((visible) => !visible)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800"
                      aria-label={showApiKey ? "Hide API key" : "Show API key"}
                      aria-pressed={showApiKey}
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Adding your API key removes the 20 messages/day limit and activates all fallback models.
                  </p>
                </div>

                <div className="p-4 bg-violet-50/70 border border-violet-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-violet-900 block">
                        Direct Developer Pipeline
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Direct dispatches to support: <span className="font-semibold text-violet-700">{SUPPORT_DISPATCH_EMAIL}</span>
                      </span>
                    </div>
                    <span className="text-[10px] font-semibold text-violet-700 bg-white px-2.5 py-0.5 rounded-full border border-violet-200">
                      🔒 Active Support
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setReportType("ai_issue")}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                        reportType === "ai_issue"
                          ? "bg-violet-600 text-white border-violet-700"
                          : "bg-white text-slate-700 border-slate-200"
                      }`}
                    >
                      Report AI Mistake
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportType("ui_request")}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                        reportType === "ui_request"
                          ? "bg-violet-600 text-white border-violet-700"
                          : "bg-white text-slate-700 border-slate-200"
                      }`}
                    >
                      Request Feature
                    </button>
                  </div>

                  <form onSubmit={handleTicketSubmit} className="space-y-2">
                    <textarea
                      rows={2}
                      value={ticketDescription}
                      onChange={(e) => setTicketDescription(e.target.value)}
                      placeholder="Describe your issue or feature request..."
                      className="w-full text-xs border border-violet-300 rounded-xl p-2.5 bg-white text-slate-800 focus:outline-none"
                    />

                    {ticketStatus && (
                      <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                        {ticketStatus}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={!ticketDescription.trim()}
                      className="w-full flex items-center justify-center gap-1.5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-xl transition-all shadow-xs disabled:opacity-50"
                    >
                      <SendHorizontal className="w-3.5 h-3.5" />
                      <span>Submit to Developer Pipeline</span>
                    </button>
                  </form>
                </div>
              </div>
            )}

            {settingsTab === "totp" && (
              <div className="space-y-4 p-5 sm:p-7">
                <div className={`p-4 ${selectedTheme.bgLightClass} border ${selectedTheme.borderClass} rounded-2xl space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <QrCode className={`w-5 h-5 ${selectedTheme.textClass}`} />
                      <span className={`text-xs font-bold ${selectedTheme.textClass}`}>
                        {isCorporateDomain
                          ? "Model B: Corporate Authenticator Hub"
                          : "Model A: Personal Platform Authenticator"}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isTotpVerified
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-amber-100 text-amber-800 border border-amber-300"
                      }`}
                    >
                      {isTotpVerified ? "Verified Active" : "Pending Code"}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    {isCorporateDomain
                      ? "Enterprise Mode: Enter the 6-digit rolling code from your company's Google Authenticator app to unlock departmental governance."
                      : "Personal Tier: Enter the 6-digit rolling code issued by the Master Google Authenticator to activate one of the 10 VIP platform passes."}
                  </p>

                  <form onSubmit={handleVerifyTotp} className="space-y-2.5">
                    <input
                      type="text"
                      maxLength={7}
                      value={userProfile.totpPasscode}
                      disabled={isTotpVerifying}
                      onChange={(e) =>
                        setUserProfile({ ...userProfile, totpPasscode: e.target.value })
                      }
                      placeholder="000 000"
                      className="w-full text-center text-sm font-mono font-bold tracking-widest border border-slate-300 rounded-xl px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />

                    <button
                      type="submit"
                      disabled={isTotpVerifying}
                      className={`w-full py-2 ${selectedTheme.primaryClass} text-white text-xs font-bold rounded-xl transition-all shadow-xs disabled:cursor-wait disabled:opacity-60`}
                    >
                      {isTotpVerifying ? "Verifying..." : "Verify Authenticator Code"}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {settingsTab === "docs" && (
              <div className="space-y-4 p-5 sm:p-7">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Documentation & User Terms</h4>
                    <p className="text-[11px] text-slate-500">Review disclaimers and save specifications internally.</p>
                  </div>
                  <button
                    onClick={handleDownloadProjectDocumentation}
                    className={`flex items-center gap-1.5 px-3 py-1.5 ${selectedTheme.primaryClass} text-white rounded-xl text-xs font-bold transition-all shadow-xs`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download (.md)</span>
                  </button>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 space-y-2">
                  <p className="font-semibold text-slate-800">Active Multi-Model Failover Highlights:</p>
                  <ul className="list-disc pl-4 space-y-1 text-[11px]">
                    <li>Active cascade across authorized Google Gemini endpoints.</li>
                    <li>RFC 6238 TOTP two-tier authentication and 20 free daily quota enforcement.</li>
                    <li>Non-professional algorithmic output: verify all code and technical data.</li>
                  </ul>
                  <button
                    onClick={() => {
                      setSettingsOpen(false);
                      setLegalModalOpen(true);
                    }}
                    className="text-xs text-purple-600 font-bold hover:underline pt-1 block"
                  >
                    Open Full Legal Agreement & Disclaimer ➔
                  </button>
                </div>
              </div>
            )}

            {settingsTab === "blocked" && (
              <div className="space-y-4 p-5 sm:p-7">
                <div>
                  <h4 className="text-sm font-bold text-slate-800">Blocked Users</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Blocked users cannot message or invite you. Their presence and shared-room messages are hidden from you.
                  </p>
                </div>
                {blockedUsers.length ? (
                  <div className="space-y-2">
                    {blockedUsers.map((blockedUser) => (
                      <div key={blockedUser.user_id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                        <GenieAvatar
                          src={blockedUser.avatar_url}
                          alt={blockedUser.handle}
                          className="h-9 w-9 rounded-full"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-800">
                            {blockedUser.handle || blockedUser.display_name}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void unblockUser(blockedUser)}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">You have not blocked anyone.</p>
                )}
              </div>
            )}

                </div>
            <div className={`flex flex-shrink-0 justify-end gap-2 border-t ${selectedTheme.borderClass} ${selectedTheme.bgLightClass} p-4`}>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className={`px-5 py-2 text-xs font-bold text-white ${selectedTheme.primaryClass} rounded-xl transition-all shadow-sm`}
              >
                Done
              </button>
            </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ========================================================================= //
  // SECTION 8: AI CORE ENGINE (LINKED TO ENGINE.TS & RENDER BACKEND)          //
  // ========================================================================= //

  async function handleHostIntervention(faultyAiIndex: number) {
    if (isStreaming || !isTeamMode) return;
    setIsStreaming(true);

    try {
      const cascadeResult = await callActiveGeminiCascade(
        "Conduct a master synthesis on the discussion so far, resolving conflicts with clear next steps.",
        roomMessages.filter((message) => !message.is_deleted).slice(-20),
        selectedLang.label,
        userProfile.customApiKey || undefined,
        googleIdToken
      );
      const extracted = extractCodeBlock(cascadeResult.text);
      const sanitized = sanitizeGenieOutput(cascadeResult.text);

      const interventionMsg: Message = {
        role: "assistant",
        content: `[★ Verified Synthesis • Host Intervention Audit]\n\n${sanitized}`,
        senderName: "Personal AI Genie",
        source: cascadeResult.model.toLowerCase().includes("openrouter")
          ? "openrouter-fallback"
          : "gemini-3.8-flash",
        isIntervention: true,
        extractedCode: extracted || undefined,
      };

      await sendEncryptedRoomEvent({
        type: "message.send",
        content: interventionMsg.content,
        sender_type: "assistant",
        sender_name: interventionMsg.senderName,
        source: interventionMsg.source,
      });

      if (extracted) setActiveCanvas(extracted);
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : "Unknown synthesis error.";
      console.error("Host intervention failed:", error);
      setChatError(`Host intervention failed: ${diagnostic}`);
    } finally {
      setIsStreaming(false);
    }
  }

  async function handleObserverToggle() {
    const nextActive = !isObserverActive;
    if (!nextActive) {
      setIsObserverActive(false);
      return;
    }
    setIsObserverActive(true);
    if (!isTeamMode) {
      return;
    }
    if (!googleIdToken) {
      setIsObserverActive(false);
      setChatError("Observer review is available after Google sign-in.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/team/summarize-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          google_id_token: googleIdToken,
          custom_api_key: userProfile.customApiKey || undefined,
          context_messages: roomMessages
            .filter((message) => !message.is_deleted)
            .slice(-20)
            .map((message) => ({
              role: message.role,
              content: message.content,
              sender_name: message.sender_name || message.senderName || userProfile.name,
            })),
        }),
      });
      const result = (await response.json()) as {
        condensed_digest?: string;
        executive_review?: string;
        detail?: string;
        source?: Message["source"];
      };
      if (!response.ok || !result.executive_review?.trim()) {
        throw new Error(result.detail || `Observer review failed (HTTP ${response.status}).`);
      }
      await sendEncryptedRoomEvent({
        type: "message.send",
        sender_type: "assistant",
        sender_name: "Personal AI Genie • Observer",
        source: result.source || "gemini-3.8-flash",
        content: `Team digest:\n${result.condensed_digest || ""}\n\nExecutive review:\n${result.executive_review}`,
      });
    } catch (error) {
      const diagnostic = error instanceof Error ? error.message : "Unknown Observer review error.";
      console.error("Observer review failed:", error);
      setChatError(`Observer review failed: ${diagnostic}`);
    }
  }

  async function handleEditRoomMessage(message: Message) {
    if (!message.id || message.sender_id !== roomIdentity || message.role !== "user") return;
    if (!editDraft.trim()) return;
    await sendEncryptedRoomEvent({
      type: "message.edit",
      message_id: message.id,
      content: editDraft.trim(),
    });
    setEditingMessageId(null);
    setEditDraft("");
  }

  function handleDeleteRoomMessage(message: Message) {
    if (!message.id || message.sender_id !== roomIdentity || message.role !== "user") return;
    sendRoomEvent({ type: "message.delete", message_id: message.id });
  }

  function handleToggleRoomReaction(message: Message, emoji: string) {
    if (!isTeamMode || !message.id || !roomIdentity || message.is_deleted) return;
    const selected = message.reactions?.[emoji]?.includes(roomIdentity) || false;
    sendRoomEvent({
      type: "message_reaction",
      room_id: roomId,
      message_id: message.id,
      user_id: roomIdentity,
      emoji,
      action: selected ? "remove" : "add",
    });
    setReactionPickerMessageId(null);
  }

  function renderRoomReactions(message: Message) {
    if (!isTeamMode || !message.id || message.is_deleted) return null;
    const reactions = Object.entries(message.reactions || {}).filter(([, userIds]) => userIds.length > 0);
    return (
      <div className="relative mt-2 flex flex-wrap items-center gap-1">
        {reactions.map(([emoji, userIds]) => {
          const selected = userIds.includes(roomIdentity);
          const memberNames = userIds.map((userId) =>
            members.find((member) => member.id === userId)?.name || userId.replace(/^google:/, "Room member")
          );
          return (
            <button
              key={emoji}
              type="button"
              title={memberNames.join(", ")}
              aria-label={`${emoji}, ${userIds.length} reaction${userIds.length === 1 ? "" : "s"}. Reacted by ${memberNames.join(", ")}`}
              onClick={() => handleToggleRoomReaction(message, emoji)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                selected
                  ? `${selectedTheme.borderClass} ${selectedTheme.bgLightClass} ${selectedTheme.textClass}`
                  : "border-slate-200 bg-white/90 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {emoji} {userIds.length}
            </button>
          );
        })}
        <div className="absolute bottom-full left-0 z-20 mb-1 flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-1 shadow-lg opacity-100 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100">
          {QUICK_ROOM_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={`React ${emoji}`}
              aria-label={`React with ${emoji}`}
              onClick={() => handleToggleRoomReaction(message, emoji)}
              className="rounded-full p-1 text-sm hover:bg-slate-100"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            title="More reactions"
            aria-label="Open full emoji picker"
            aria-expanded={reactionPickerMessageId === message.id}
            onClick={() => setReactionPickerMessageId((current) => current === message.id ? null : message.id || null)}
            className="rounded-full p-1 text-slate-600 hover:bg-slate-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {reactionPickerMessageId === message.id && (
          <div className="absolute bottom-full left-0 z-30 mb-10 grid max-h-40 w-52 grid-cols-7 gap-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            {ROOM_EMOJI_OPTIONS.map((emoji, index) => (
              <button
                key={`${emoji}-${index}`}
                type="button"
                aria-label={`React with ${emoji}`}
                onClick={() => handleToggleRoomReaction(message, emoji)}
                className="rounded-md p-1 text-base hover:bg-slate-100"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  async function handleSendMessage(e?: React.FormEvent, forceRainbowTrigger = false, customText?: string) {
    if (e) e.preventDefault();
    const textToSend = customText !== undefined ? customText : prompt;
    if (!textToSend.trim() && !forceRainbowTrigger) return;
    if (isStreaming) return;
    const topicIdForRequest = activeTopic?.id || "topic_1";
    const sessionArchiveForRequest = !isTeamMode && Boolean(currentSession?.isSharedArchive);
    const routedPersonalTopic =
      !isTeamMode &&
      !sessionArchiveForRequest &&
      isAuthenticated &&
      Boolean(googleIdToken && userProfile.providerId);

    const actualText = textToSend.trim() || (forceRainbowTrigger ? "Genie, please analyze the conversation and assist." : "");
    const shouldWakeGenie =
      !isTeamMode ||
      forceRainbowTrigger ||
      checkWakeWordTrigger(actualText);
    if (shouldWakeGenie && isObserverActive && isQuotaEnforced && dailyUsageCount >= DAILY_FREE_LIMIT) {
      setQuotaExceededModalOpen(true);
      return;
    }

    const sentReplyTarget = replyTarget;
    if (
      isTeamMode &&
      !(await sendEncryptedRoomEvent({
        type: "message.send",
        content: actualText,
        sender_name: userProfile.socialHandle || userProfile.name,
      }))
    ) return;

    setPrompt("");
    setReplyTarget(null);
    setEmojiPickerOpen(false);
    setAttachmentMenuOpen(false);

    const userMsg: Message = {
      role: "user",
      content: actualText,
      id: window.crypto.randomUUID(),
      text: actualText,
      sender_id: isTeamMode ? roomIdentity : undefined,
      sender_name: isTeamMode ? userProfile.name : undefined,
      senderName: isTeamMode ? userProfile.name : undefined,
      senderEmail: isTeamMode ? userProfile.email : undefined,
      replyTo: sentReplyTarget || undefined,
      triggeredByRainbow: forceRainbowTrigger,
    };

    const updatedMessages = [...messages, userMsg];

    if (!isTeamMode) {
      if (sessionArchiveForRequest && currentSession) {
        setSessions((previous) => previous.map((session) =>
          session.id === currentSession.id ? { ...session, messages: updatedMessages } : session
        ));
      } else {
        setTopics((previous) => previous.map((topic) =>
          topic.id === topicIdForRequest
            ? { ...topic, messages: updatedMessages, message_count: updatedMessages.length }
            : topic
        ));
      }
      setPersonalMessages(updatedMessages);
    }

    if (shouldWakeGenie && isObserverActive && isQuotaEnforced) {
      const newCount = dailyUsageCount + 1;
      setDailyUsageCount(newCount);
      if (userProfile.email && typeof window !== "undefined") {
        const today = new Date().toISOString().split("T")[0];
        localStorage.setItem(`genie_quota_${userProfile.email}_${today}`, newCount.toString());
      }
    }

    if (!shouldWakeGenie) return;

    setIsStreaming(true);
    setChatError(null);

    let finalReply = "";
    let finalModel = "gemini-3.8-flash";
    let finalSource: Message["source"] = "gemini-3.8-flash";
    let finalAgentOutput: Message["agentOutput"];
    let finalProvider: string | undefined;
    let finalProviderModel: string | undefined;
    let finalAutoFallback = false;
    const useChatStream = isObserverActive && !routedPersonalTopic;
    setStreamingPreview("");
    setStreamingProvider(null);
    setStreamingAutoFallback(false);

    const controller = new AbortController();
    activeChatAbortControllerRef.current = controller;

    try {
      let historyForRequest = isTeamMode
        ? [...roomMessages, userMsg].filter((message) => !message.is_deleted).slice(-20)
        : updatedMessages;
      if (isTeamMode && isObserverActive && updatedMessages.length > 0) {
        const reviewResponse = await fetch(`${API_BASE}/api/team/summarize-review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            room_id: roomId,
            google_id_token: googleIdToken,
            custom_api_key: userProfile.customApiKey || undefined,
            context_messages: historyForRequest.map((message) => ({
              role: message.role,
              content: message.content,
              sender_name: message.sender_name || message.senderName || userProfile.name,
              is_deleted: message.is_deleted || false,
            })),
          }),
        });
        const reviewData = (await reviewResponse.json()) as {
          condensed_digest?: string;
          executive_review?: string;
          detail?: string;
        };
        if (!reviewResponse.ok || !reviewData.executive_review?.trim()) {
          throw new Error(
            reviewData.detail || `Observer review summarization failed (HTTP ${reviewResponse.status}).`
          );
        }
        historyForRequest = [
          {
            role: "assistant",
            content: `Condensed team digest:\n${reviewData.condensed_digest || ""}\n\nExecutive review:\n${reviewData.executive_review.trim()}`,
          },
          ...updatedMessages.slice(-4),
        ];
      }

      const chatPayload = routedPersonalTopic
        ? {
            google_id_token: googleIdToken,
            user_id: userProfile.providerId,
            topic_id: topicIdForRequest,
            message: actualText,
            message_id: userMsg.id,
            custom_api_key: userProfile.customApiKey || undefined,
            observer_mode: isObserverActive,
          }
        : {
            user_email: userProfile.email,
            google_id_token: googleIdToken,
            prompt: actualText,
            space_mode: spaceMode,
            conversation_history: historyForRequest,
            provider: "gemini",
            models_cascade: ["gemini-3.8-flash", "gemini-3.7-flash"],
            custom_api_key: userProfile.customApiKey || undefined,
            profession_context:
              userProfile.role === "professional" ? userProfile.profession : undefined,
            gender_context: userProfile.gender,
            language_code: selectedLang.code,
            is_team_chat: false,
            observer_mode: isObserverActive,
            quoted_message: sentReplyTarget
              ? { author: sentReplyTarget.author, content: sentReplyTarget.content }
              : undefined,
          };
      const res = await fetch(
        `${API_BASE}${routedPersonalTopic ? "/api/personal/chat" : useChatStream ? "/api/chat/stream" : "/api/chat"}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatPayload),
        }
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || errorData.error || `Chat backend returned HTTP ${res.status}.`);
      }
      if (useChatStream) {
        if (!res.body) throw new Error("Chat backend did not provide a readable event stream.");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        const handleSseBlock = (block: string) => {
          let eventName = "message";
          const dataLines: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) return;
          const eventData = JSON.parse(dataLines.join("\n")) as {
            provider?: string;
            model?: string;
            text?: string;
            failed?: string;
            message?: string;
          };
          if (eventName === "meta" && eventData.provider && eventData.model) {
            finalProvider = eventData.provider;
            finalProviderModel = eventData.model;
            finalModel = eventData.model;
            setStreamingProvider({ provider: eventData.provider, model: eventData.model });
          } else if (eventName === "fallback") {
            finalAutoFallback = true;
            setStreamingAutoFallback(true);
          } else if (eventName === "token" && eventData.text) {
            finalReply += eventData.text;
            setStreamingPreview(finalReply);
          } else if (eventName === "error") {
            throw new Error(eventData.message || "All configured chat providers are unavailable.");
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          pending = pending.replace(/\r\n/g, "\n");
          let eventBoundary = pending.indexOf("\n\n");
          while (eventBoundary !== -1) {
            handleSseBlock(pending.slice(0, eventBoundary));
            pending = pending.slice(eventBoundary + 2);
            eventBoundary = pending.indexOf("\n\n");
          }
          if (done) break;
        }
        if (pending.trim()) handleSseBlock(pending);
        if (!finalReply.trim()) throw new Error("Chat backend returned an empty response.");
        finalSource = "cloud_ai";
      } else {
        const data = await res.json();
        if (typeof data.reply !== "string" || !data.reply.trim()) {
          throw new Error("Chat backend returned an empty response.");
        }
        finalReply = data.reply;
        finalModel = data.model_used || "gemini-3.8-flash";
        finalAgentOutput = data.agent_output;
        finalProvider = data.provider_source === "openrouter-fallback"
          ? "OpenRouter"
          : data.provider_source === "gemini"
            ? "Google Gemini"
            : undefined;
        finalProviderModel = finalModel;
        finalSource =
          data.source === "local_agent" ||
          data.source === "platform_engine" ||
          data.source === "cloud_ai" ||
          data.source === "backend-manifest" ||
          data.source === "openrouter-fallback"
            ? data.source
            : isObserverActive
            ? "cloud_ai"
            : "local_agent";
      }
    } catch (primaryError) {
      if (
        controller.signal.aborted ||
        (primaryError instanceof Error && primaryError.name === "AbortError")
      ) {
        setChatError(null);
      } else if (routedPersonalTopic || !isObserverActive) {
        const diagnostic = primaryError instanceof Error ? primaryError.message : "Topic chat request failed.";
        console.error("Personal topic chat request failed:", primaryError);
        setChatError(`${isObserverActive ? "Personal topic chat" : "Platform engine"} failed: ${diagnostic}`);
      } else try {
        console.warn("Primary chat backend request failed; attempting server fallback.", primaryError);
        const raceResult = await callActiveGeminiCascade(
          actualText,
          isTeamMode
            ? [...roomMessages, userMsg].filter((message) => !message.is_deleted).slice(-20)
            : updatedMessages,
          selectedLang.label,
          userProfile.customApiKey || undefined,
          googleIdToken,
          controller.signal
        );
        finalReply = raceResult.text;
        finalModel = raceResult.model;
        finalSource = "cloud_ai";
        finalProvider = "Google Gemini";
        finalProviderModel = raceResult.model;
        setActiveModelName(raceResult.model);
      } catch (fallbackError) {
        if (
          controller.signal.aborted ||
          (fallbackError instanceof Error && fallbackError.name === "AbortError")
        ) {
          setChatError(null);
          return;
        }
        console.error("Chat completion failed after backend and server fallback attempts.", fallbackError);
        const diagnostic =
          fallbackError instanceof Error
            ? fallbackError.message
            : "An unknown error prevented the chat request from completing.";
        const authorizationFailure = /HTTP 401\b|HTTP 403\b/.test(diagnostic);
        const noProviderKey =
          /no (?:chat )?providers? are configured|no ai providers are configured/i.test(diagnostic);
        setChatError(
          isMasterAdmin
            ? `Chat request failed: ${diagnostic}`
            : noProviderKey
            ? "No AI provider key is configured. Add your Gemini API key in Settings > BYOK, or ask your administrator to configure the server key."
            : authorizationFailure
            ? "AI provider authorization failed. Update your API key in Settings > BYOK, or ask your administrator to check the server credentials."
            : `Chat request failed: ${diagnostic}`
        );
      }
    } finally {
      if (activeChatAbortControllerRef.current === controller) {
        activeChatAbortControllerRef.current = null;
      }
      if (finalReply.trim()) {
        const extracted = extractCodeBlock(finalReply);
        const sanitized = sanitizeGenieOutput(finalReply);

        const responseMessage = {
          role: "assistant" as const,
          content: sanitized,
          senderName: "Personal AI Genie",
          sender_name: "Personal AI Genie",
          modelUsed: finalModel,
          source: finalSource,
          provider: finalProvider,
          providerModel: finalProviderModel,
          autoFallback: finalAutoFallback,
          agentName: finalAgentOutput?.agent_name,
          agentOutput: finalAgentOutput,
          extractedCode: extracted || undefined,
        };
        if (isTeamMode) {
          await sendEncryptedRoomEvent({
            type: "message.send",
            content: sanitized,
            sender_type: "assistant",
            sender_name: responseMessage.sender_name,
            source: responseMessage.source,
            agent_name: responseMessage.agentName,
          });
        } else {
          if (sessionArchiveForRequest && currentSession) {
            setSessions((previous) => previous.map((session) =>
              session.id === currentSession.id
                ? { ...session, messages: [...session.messages, responseMessage] }
                : session
            ));
          } else {
            setTopics((previous) => previous.map((topic) => {
              if (topic.id !== topicIdForRequest) return topic;
              const nextMessages = [...topic.messages, responseMessage];
              return { ...topic, messages: nextMessages, message_count: nextMessages.length };
            }));
          }
          if (activeTopicId === topicIdForRequest) {
            setPersonalMessages((previous) => [...previous, responseMessage]);
          }
        }

        if (extracted) setActiveCanvas(extracted);
      }
      setStreamingPreview("");
      setStreamingProvider(null);
      setStreamingAutoFallback(false);
      setIsStreaming(false);
    }
  }
}

function WorkspaceContainer() {
  return <MainChatApp />;
}

export { WorkspaceContainer };
export default WorkspaceContainer;
