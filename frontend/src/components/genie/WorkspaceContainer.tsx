"use client";

// ========================================================================= //
// SECTION 1: IMPORTS, CONSTANTS & THEME PRESETS                             //
// ========================================================================= //

import React, { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Script from "next/script";
import { useRouter } from "next/navigation";
import StudentBanner from "../../components/StudentBanner";
import UnifiedStudyEngine from "../../components/UnifiedStudyEngine";
import MessageBubble from "../../components/MessageBubble";
import VoiceMic from "../../components/VoiceMic";
import DynamicTeamModal, { type RoomCapacityMode } from "./DynamicTeamModal";
import GenieBrandAvatar, { BrandAvatar } from "./GenieBrandAvatar";
import HeaderBar from "./HeaderBar";
import SessionMetadataBar from "./SessionMetadataBar";
import VoiceCallModal, {
  type VoiceCallTranscript,
  type VoiceCallTurn,
} from "./VoiceCallModal";
import {
  getSpeechLocale,
  INDIAN_DIALECT_MAP,
  playRegionalAudio,
  stopActiveRegionalAudio,
} from "./voiceAudio";
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
  getBackendApiUrl,
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
  Send,
  Globe,
  Users,
  SendHorizontal,
  Copy,
  Check,
  CheckCheck,
  Smile,
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
  Menu,
  Cloud,
  ArrowDown,
  Volume2,
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
  UserPlus,
  Search,
  ImagePlus,
  CircleHelp,
} from "lucide-react";

interface IndianLanguage {
  code: string;
  label: string;
}

type VoicePreset = "Aoede" | "Charon" | "Kore" | "Fenrir" | "Puck";

const VOICE_PRESETS: {
  key: VoicePreset;
  gender: string;
  description: string;
  sample: string;
  pitch: number;
  rate: number;
}[] = [
  {
    key: "Aoede",
    gender: "Female",
    description: "Soft, breezy, conversational",
    sample: "Hey there! I'm Aoede. Take a breath, relax, and let's tackle your day together.",
    pitch: 1.12,
    rate: 0.94,
  },
  {
    key: "Charon",
    gender: "Male",
    description: "Calm, steady, professional",
    sample: "Greetings. I'm Charon. Steady focus and clarity—let's examine what needs to be solved.",
    pitch: 0.88,
    rate: 0.92,
  },
  {
    key: "Kore",
    gender: "Female",
    description: "Firm, crisp, analytical",
    sample: "Hello! Kore here. Direct, structured, and organized—what's our primary objective?",
    pitch: 1.04,
    rate: 1.02,
  },
  {
    key: "Fenrir",
    gender: "Male",
    description: "Deep, authoritative, resolute",
    sample: "Fenrir standing by. Big ideas, bold strategy—let's make things happen.",
    pitch: 0.74,
    rate: 0.96,
  },
  {
    key: "Puck",
    gender: "Male / Youthful",
    description: "Playful, witty, high-energy",
    sample: "Hey! Puck's in the room. Quick thoughts, clever moves—ready when you are!",
    pitch: 1.22,
    rate: 1.12,
  },
];

const INDIAN_LANGUAGES: IndianLanguage[] = [
  { code: "en-IN", label: "EN (India)" },
  { code: "ta-IN", label: "தமிழ்" },
  { code: "ml-IN", label: "മലയാളം" },
  { code: "te-IN", label: "తెలుగు" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "bn-IN", label: "বাংলা" },
  { code: "mr-IN", label: "मराठी" },
  { code: "gu-IN", label: "ગુજરાતી" },
  { code: "pa-IN", label: "ਪੰਜਾਬੀ" },
  { code: "or-IN", label: "ଓଡ଼ିଆ" },
  { code: "ur-IN", label: "اردو" },
  { code: "as-IN", label: "অসমীয়া" },
  { code: "sa-IN", label: "संस्कृतम्" },
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

function scrubSensitiveClientTokens(text: string): string {
  return text.replace(
    /AIza[0-9A-Za-z_-]{20,}|sk-or-(?:v1-)?[0-9A-Za-z_-]{16,}|\bsk-[0-9A-Za-z_-]{20,}|\bgh[pousr]_[0-9A-Za-z]{20,}\b|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
    "[PROTECTED_CREDENTIAL]",
  );
}

interface RoomMember {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: "origin_admin" | "delegated_admin" | "sovereign" | "admin" | "developer" | "member" | "guest";
  status: "active" | "inactive" | "different_room";
  is_host?: boolean;
  joined_at?: string;
  can_export?: boolean;
  can_view_history?: boolean;
  is_origin_admin?: boolean;
  publicKey?: JsonWebKey;
  attendeeType?: "required" | "optional";
}

interface DiscoverableFriend {
  user_id: string;
  display_name: string;
  handle: string;
  avatar_url: string;
  is_online: boolean;
  active_room_id?: string;
  relationship?: "none" | "following" | "follower" | "friend" | "request_sent" | "request_received";
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
  isForwarded?: boolean;
  forwardedFrom?: string;
  is_deleted?: boolean;
  isVoiceRecord?: boolean;
  isCallRecord?: boolean;
  isVoiceSessionSummary?: boolean;
  callTranscript?: VoiceCallTranscript;
  delivered_to?: string[];
  read_by?: string[];
  reactions?: Record<string, string[]>;
  encrypted_payloads?: Record<string, RoomCiphertext>;
  sender_public_key?: JsonWebKey;
  senderName?: string;
  senderEmail?: string;
  timestamp?: string;
  avatarSrc?: string;
  source?: "gemini-3.6-flash" | "openrouter-fallback" | "backend-manifest" | "cloud_ai" | "local_agent" | "platform_engine" | "local_mock";
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
  createdAt?: string;
  topicId?: string;
  isSharedArchive?: boolean;
  isDeleted?: boolean;
  isArchived?: boolean;
  deletedAt?: string;
  deletedBy?: string;
}

interface AdminTelemetry {
  total_registered: number;
  live_active: number;
  active_vips: number;
  vip_pool_remaining: number;
}

interface VoiceCallTurnResult {
  text: string;
  audioData?: string;
  audioMimeType?: string;
}

function parseMarkdownChatBackup(markdown: string): ChatSession[] {
  const documents = markdown
    .split(/(?=^#\s+(?:Chat|Conversation):\s*)/im)
    .map((document) => document.trim())
    .filter(Boolean);

  return documents.map((document) => {
    const title = document.match(/^#\s+(?:Chat|Conversation):?\s*(.+)$/im)?.[1]?.trim()
      || document.match(/^#\s+(.+)$/m)?.[1]?.trim()
      || "Imported Chat";
    const messages: Message[] = [];
    let currentRole: Message["role"] | null = null;
    let currentContent: string[] = [];

    const saveMessage = () => {
      const content = currentContent.join("\n").trim();
      if (currentRole && content) messages.push({ role: currentRole, content });
    };

    for (const line of document.split(/\r?\n/)) {
      const headingRole = line.match(/^#{1,3}\s+(user|assistant|you|genie)\s*:?\s*$/i);
      const inlineRole = line.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(user|assistant|you|genie)(?:\*\*)?:\s*(.*)$/i);
      const role = headingRole?.[1] || inlineRole?.[1];
      if (role) {
        saveMessage();
        currentRole = /^(user|you)$/i.test(role) ? "user" : "assistant";
        currentContent = inlineRole?.[2] ? [inlineRole[2]] : [];
      } else if (currentRole) {
        currentContent.push(line);
      }
    }
    saveMessage();
    if (!messages.length) {
      throw new Error(`No User/Assistant messages were found in "${title}".`);
    }

    return {
      id: window.crypto.randomUUID(),
      title,
      isPinned: false,
      messages,
    };
  });
}

function ensureMessageTimestamps(messages: Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    timestamp: message.timestamp || new Date().toISOString(),
  }));
}

interface SocialInvite {
  invite_id: string;
  sender_name: string;
  room_id: string;
  room_title: string;
  invite_url: string;
}

interface PendingFriendRequest {
  user_id: string;
  display_name: string;
  avatar_url: string;
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
  members?: Array<{ id?: string; user_id?: string; name?: string; display_name?: string; email?: string; avatar_url?: string; public_key?: JsonWebKey; role?: "origin_admin" | "delegated_admin" | "sovereign" | "admin" | "developer" | "member" | "guest"; status?: "active" | "inactive" | "different_room"; is_host?: boolean; joined_at?: string; can_export?: boolean; can_view_history?: boolean; is_origin_admin?: boolean }>;
  users?: Array<{ id?: string; user_id: string; display_name: string; email?: string; avatar_url?: string; public_key?: JsonWebKey; role?: "origin_admin" | "delegated_admin" | "sovereign" | "admin" | "developer" | "member" | "guest"; status?: "active" | "inactive" | "different_room"; is_host?: boolean; joined_at?: string; can_export?: boolean; can_view_history?: boolean; is_origin_admin?: boolean }>;
  policy?: { space_mode?: "personal" | "workspace"; history_visible_before_join?: boolean; allow_member_export?: boolean };
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
  call_id?: string;
  started_by?: string;
  turn_id?: string;
  speaker?: { id: string; name: string; avatar_url?: string | null; role: "user" | "assistant" };
  timestamp?: string;
  is_rejoin?: boolean;
  requester?: { user_id?: string; display_name?: string; avatar_url?: string };
  inviter?: { user_id?: string; display_name?: string; avatar_url?: string };
  room_id?: string;
  participants?: Array<{ id: string; name: string; avatar_url?: string | null }>;
  started_at?: string;
  encrypted_payloads?: Record<string, RoomCiphertext>;
  sender_public_key?: JsonWebKey;
}


function normalizeRoomMessage(raw: Message): Message {
  const wire = raw as Message & {
    message_id?: string;
    user_id?: string;
    display_name?: string;
    edited?: boolean;
    deleted?: boolean;
    is_voice_record?: boolean;
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
    isVoiceRecord: Boolean(wire.isVoiceRecord || wire.is_voice_record),
    isCallRecord: Boolean((wire as Message & { is_call_record?: boolean }).isCallRecord || (wire as Message & { is_call_record?: boolean }).is_call_record),
    isVoiceSessionSummary: Boolean((wire as Message & { is_voice_session_summary?: boolean }).is_voice_session_summary),
    delivered_to: Array.isArray(wire.delivered_to) ? wire.delivered_to : [],
    read_by: Array.isArray(wire.read_by) ? wire.read_by : [],
    reactions: wire.reactions && typeof wire.reactions === "object" ? wire.reactions : {},
  };
}

function formatVoiceCallTranscript(transcript: VoiceCallTranscript): string {
  const turns = transcript.turns.map((turn) => {
    const timestamp = new Date(turn.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const speaker = turn.role === "assistant" ? "Genie Master" : turn.userName;
    return `${speaker} · ${timestamp}\n${turn.text}`;
  });
  return [
    "📞 Genie Master Voice Session Summary",
    `Duration: ${Math.floor(transcript.durationSeconds / 60)}m ${transcript.durationSeconds % 60}s`,
    `Dialect: ${transcript.dialect}`,
    `Participants: ${transcript.participants.map((participant) => participant.name).join(", ") || "You"}`,
    "",
    ...turns,
  ].join("\n\n");
}

function createDocxBlob(
  title: string,
  createdAt: string,
  exportedAt: Date,
  transcript: Array<{ message: Message }>,
): Blob {
  const escapeXml = (value: string) =>
    value.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    })[character] || character);
  const paragraph = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  const paragraphs = [
    paragraph(title, "Title"),
    paragraph(`Created: ${createdAt ? new Date(createdAt).toLocaleString() : "Unknown"}`),
    paragraph(`Exported: ${exportedAt.toLocaleString()}`),
    ...transcript.flatMap(({ message }) => {
      const author = message.senderName || (message.role === "assistant" ? "Genie Master" : "You");
      const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : "";
      return [
        paragraph(`${author}${timestamp ? ` · ${timestamp}` : ""}`, "Heading2"),
        ...message.content.split(/\r?\n/).map((line) => paragraph(line)),
      ];
    }),
  ];
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr/></w:body></w:document>`;
  const entries = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "word/styles.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
    },
    { name: "word/document.xml", content: documentXml },
  ];
  const encoder = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
  const crc32 = (bytes: Uint8Array) => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.content);
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);
  const archiveParts = [...localParts, ...centralParts, endRecord];
  const archive = new Uint8Array(archiveParts.reduce((total, part) => total + part.length, 0));
  let archiveOffset = 0;
  for (const part of archiveParts) {
    archive.set(part, archiveOffset);
    archiveOffset += part.length;
  }
  return new Blob([archive.buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
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

  const legacyPresetAssets: Record<string, string> = {
    "genie-preset:guardian": "/avatars/Profile-1.png",
    "genie-preset:vapor": "/avatars/Profile-2.png",
    "genie-preset:cosmic": "/avatars/Profile-3.png",
    "genie-preset:neutral": "/avatars/Profile-3.png",
    "genie-preset:option_a": "/avatars/Profile-1.png",
    "genie-preset:option_b": "/avatars/Profile-2.png",
    "genie-preset:option_c": "/avatars/Profile-3.png",
    "/avatars/Profile 1.png": "/avatars/Profile-1.png",
    "/avatars/Profile 2.png": "/avatars/Profile-2.png",
    "/avatars/Profile 3.png": "/avatars/Profile-3.png",
    "/avatars/option_a.svg": "/avatars/Profile-1.png",
    "/avatars/option_b.svg": "/avatars/Profile-2.png",
    "/avatars/option_c.svg": "/avatars/Profile-3.png",
  };
  const resolvedSrc = src && legacyPresetAssets[src]
    ? legacyPresetAssets[src]
    : src && !src.includes("default-user")
    ? src
    : "/avatars/Profile-3.png";
  const initials = (alt || "Genie")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

  return (
    hasError ? (
      <span
        aria-label={`${alt || "User"} avatar`}
        role="img"
        className={`${className} inline-flex items-center justify-center rounded-full bg-cyan-100 font-bold text-cyan-900 flex-shrink-0`}
      >
        {initials}
      </span>
    ) : (
      <img
        src={resolvedSrc}
        alt={alt || "Genie profile avatar"}
        onError={() => setHasError(true)}
        className={`${className} rounded-full object-cover flex-shrink-0`}
      />
    )
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

function getAssistantPersona(message: Message) {
  if (message.avatarSrc === "/avatars/Genie PRO.png") {
    return {
      variant: "faceless-weaver" as const,
      badge: "Genie Pro",
    };
  }
  const resolved =
    message.isIntervention ||
    message.senderName?.includes("Intervention") ||
    message.sender_name?.includes("Intervention") ||
    message.content.startsWith("[★ Verified Synthesis");
  if (resolved) {
    return {
      variant: "void-shaman" as const,
      badge: "Genie · Reviewed",
    };
  }
  if (
    message.source === "platform_engine" ||
    message.source === "local_mock" ||
    message.source === "backend-manifest" ||
    message.source === "local_agent"
  ) {
    return {
      variant: "faceless-weaver" as const,
      badge: "Genie Pro",
    };
  }
  return {
    variant: "cosmic-shadow" as const,
    badge: "Genie",
  };
}

function getRoomMessageReadStatus(message: Message, roomMembers: RoomMember[]) {
  const activeMembers = roomMembers.filter((member) => member.status === "active");
  const readBy = new Set(message.read_by || []);
  if (message.sender_id) readBy.add(message.sender_id);
  const seenCount = activeMembers.filter((member) => readBy.has(member.id)).length;

  return {
    seenCount,
    activeCount: activeMembers.length,
    isReadByAll:
      activeMembers.length > 0 &&
      activeMembers.every((member) => readBy.has(member.id)),
  };
}

function SearchMessageGroup({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: Message[];
  onSelect: (message: Message) => void;
}) {
  return (
    <section className="space-y-1">
      <h3 className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      {items.map((message, index) => (
        <button
          key={message.id || `${message.role}-${index}`}
          type="button"
          onClick={() => onSelect(message)}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
        >
          {message.role === "assistant" ? (
            <BrandAvatar variant={getAssistantPersona(message).variant} className="mt-0.5 h-6 w-6" label="AI result avatar" />
          ) : (
            <User className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
          )}
          <span className="min-w-0">
            {message.role === "assistant" && <span className="block text-[9px] font-semibold text-violet-700">{getAssistantPersona(message).badge}</span>}
            <span className="line-clamp-2 text-[11px] text-slate-700">{message.content}</span>
          </span>
        </button>
      ))}
    </section>
  );
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

function getAuthApiUrl(apiBase: string, path: string): string {
  const apiPrefix = apiBase.endsWith("/api/py") ? "" : "/api";
  return `${apiBase}${apiPrefix}/${path.replace(/^\/+/, "")}`;
}

function getLocalDevelopmentToken(): string {
  if (
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  ) {
    return "dev-token-local-bypass";
  }
  return "";
}

async function fetchAuthenticatorSetup(
  email: string,
  token: string,
  apiBase: string,
): Promise<{ qr_code: string; secret: string }> {
  const query = `?email=${encodeURIComponent(email)}`;
  const headers = token && token !== "dev-token-local-bypass"
    ? { Authorization: `Bearer ${token}` }
    : undefined;
  const response = await fetch(`${getAuthApiUrl(apiBase, "auth/totp/setup")}${query}`, {
    cache: "no-store",
    headers,
  });
  const result = (await response.json()) as {
    qr_code?: string;
    secret?: string;
    manual_secret?: string;
    detail?: string;
  };
  const secret = result.manual_secret || result.secret;
  if (!response.ok || !result.qr_code || !secret) {
    throw new Error(result.detail || `Authenticator setup could not be started (HTTP ${response.status}).`);
  }
  return { qr_code: result.qr_code, secret };
}

// ========================================================================= //
// SECTION 2: AUTHENTICATION, INITIALIZATION & PERSISTED SESSION STORAGE     //
// ========================================================================= //

function MainChatApp() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemePreset>(THEME_PRESETS[1]);
  const selectedTheme = currentTheme;
  const setSelectedTheme = setCurrentTheme;
  const [themeReady, setThemeReady] = useState(false);

  const [registrationRequired, setRegistrationRequired] = useState(false);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [showDevAuthBypass, setShowDevAuthBypass] = useState(false);
  const [registrationTermsAccepted, setRegistrationTermsAccepted] = useState(false);
  const [registrationPrivacyAccepted, setRegistrationPrivacyAccepted] = useState(false);
  const [authenticatorEnabled, setAuthenticatorEnabled] = useState(false);
  const [authenticatorSetupOpen, setAuthenticatorSetupOpen] = useState(false);
  const [authenticatorSetup, setAuthenticatorSetup] = useState<{ qr_code: string; secret: string } | null>(null);
  const [authenticatorSetupCode, setAuthenticatorSetupCode] = useState("");
  const [authenticatorSetupBusy, setAuthenticatorSetupBusy] = useState(false);
  const [authenticatorSetupError, setAuthenticatorSetupError] = useState<string | null>(null);
  const [authenticatorLoginEmail, setAuthenticatorLoginEmail] = useState("");
  const [authenticatorLoginCode, setAuthenticatorLoginCode] = useState("");
  const [authenticatorLoginError, setAuthenticatorLoginError] = useState<string | null>(null);
  const [authenticatorLoginBusy, setAuthenticatorLoginBusy] = useState(false);
  const [authenticatorResetMessage, setAuthenticatorResetMessage] = useState<string | null>(null);
  const [authenticatorResetCode, setAuthenticatorResetCode] = useState("");
  const [authenticatorResetPending, setAuthenticatorResetPending] = useState(false);
  const [authenticatorResetBusy, setAuthenticatorResetBusy] = useState(false);
  const [registrationReauthRequired, setRegistrationReauthRequired] = useState(false);
  const registrationReauthRequiredRef = useRef(false);
  const [verifiedArchiveOwner, setVerifiedArchiveOwner] = useState<{
    providerId: string;
    email: string;
  } | null>(null);

  const [spaceMode, setSpaceMode] = useState<"personal" | "workspace">("personal");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDockHidden, setIsDockHidden] = useState(false);
  const [isTeamMode, setIsTeamMode] = useState(false);
  const [isObserverActive, setIsObserverActiveState] = useState(false);

  const [dailyUsageCount, setDailyUsageCount] = useState<number>(0);
  const [isVipSessionActive, setIsVipSessionActive] = useState(false);
  const [vipSessionLimitReached, setVipSessionLimitReached] = useState(false);
  const [activeVipSessionCount, setActiveVipSessionCount] = useState(0);
  const [quotaExceededModalOpen, setQuotaExceededModalOpen] = useState(false);
  const [activeModelName, setActiveModelName] = useState<string>("Genie");

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
    mobileNumber: "",
    mobileVerified: false,
    recoveryEmail: "",
    allowRoomInvites: "mutual_friends" as "mutual_friends" | "everyone",
    isCreator: false,
    avatarUrl: "genie-preset:neutral",
    googleAvatarUrl: "",
    role: "professional" as "student" | "professional",
    preferredVoice: "Aoede" as VoicePreset,
    profession: "Healthcare Revenue Cycle & Client Operations",
    institution: "",
    studyFocus: "",
    studyLevel: "",
    ageGroup: "pro",
    gender: "",
    customApiKey: "",
    totpPasscode: "",
    totpEnabled: false,
    authProvider: "" as "" | "google" | "meta",
    providerId: "",
    socialHandle: "",
    socialAvatarUrl: "",
    socialProfileId: "",
    isDiscoverable: false,
  });
  const userProfileRef = useRef(userProfile);
  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);
  const customAvatar =
    userProfile.avatarUrl && !userProfile.avatarUrl.startsWith("genie-preset:")
      ? userProfile.avatarUrl
      : "";
  const selectedAvatar =
    userProfile.avatarUrl.startsWith("genie-preset:") && userProfile.avatarUrl !== "genie-preset:neutral"
      ? userProfile.avatarUrl
      : "";
  const profileAvatar = customAvatar || selectedAvatar || userProfile.googleAvatarUrl || "/default-avatar.png";
  useEffect(() => () => {
    if (profileTotpToastTimerRef.current) clearTimeout(profileTotpToastTimerRef.current);
  }, []);
  const [googleIdToken, setGoogleIdToken] = useState("");
  const [corporateTenantId, setCorporateTenantId] = useState("");
  const [corporateAvatarUrl, setCorporateAvatarUrl] = useState("");
  const [scopeVerifiedToken, setScopeVerifiedToken] = useState("");
  const [isSuperAdminSession, setIsSuperAdminSession] = useState(false);
  const [adminTelemetry, setAdminTelemetry] = useState<AdminTelemetry | null>(null);
  const [adminTelemetryError, setAdminTelemetryError] = useState("");
  const isSuperAdminVerified =
    isAuthenticated && isSuperAdminSession && scopeVerifiedToken === googleIdToken;
  useEffect(() => {
    if (!googleIdToken) {
      setCorporateTenantId("");
      setCorporateAvatarUrl("");
      setScopeVerifiedToken("");
      return;
    }

    let active = true;
    void fetch(getBackendApiUrl("/api/auth/session-scope"), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${googleIdToken}` },
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          scope?: "personal" | "workspace";
          tenant_id?: string | null;
          corporate_avatar_url?: string;
          is_super_admin?: boolean;
        };
        if (!response.ok) {
          throw new Error(`Session scope could not be verified (HTTP ${response.status}).`);
        }
        if (!active) return;
        const tenantId = result.scope === "workspace" ? result.tenant_id || "" : "";
        setCorporateTenantId(tenantId);
        setCorporateAvatarUrl(tenantId ? result.corporate_avatar_url || "" : "");
        setIsSuperAdminSession(result.is_super_admin === true);
        setScopeVerifiedToken(googleIdToken);
        if (tenantId) setSpaceMode("workspace");
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("Verified account scope could not be loaded:", error);
        setCorporateTenantId("");
        setCorporateAvatarUrl("");
        setIsSuperAdminSession(false);
        setAdminTelemetry(null);
        setSecurityToast("Account scope could not be verified. Workspace actions are restricted until sign-in is refreshed.");
      });
    return () => {
      active = false;
    };
  }, [googleIdToken]);
  useEffect(() => {
    if (!isSuperAdminVerified || !googleIdToken) return;
    let active = true;
    let timer: number | undefined;
    const refreshTelemetry = async () => {
      try {
        const response = await fetch(getBackendApiUrl("/api/admin/telemetry"), {
          cache: "no-store",
          headers: { Authorization: `Bearer ${googleIdToken}` },
        });
        if (!response.ok) {
          throw new Error(`Telemetry unavailable (HTTP ${response.status}).`);
        }
        const result = (await response.json()) as AdminTelemetry;
        if (!active) return;
        setAdminTelemetry(result);
        setAdminTelemetryError("");
      } catch (error) {
        if (!active) return;
        console.error("Super-admin telemetry refresh failed:", error);
        setAdminTelemetryError(error instanceof Error ? error.message : "Telemetry could not be loaded.");
      } finally {
        if (active) timer = window.setTimeout(() => void refreshTelemetry(), 10000);
      }
    };
    void refreshTelemetry();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isSuperAdminVerified, googleIdToken]);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [profileSaveBusy, setProfileSaveBusy] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [byokApiKey, setByokApiKey] = useState("");
  const [byokVerified, setByokVerified] = useState(false);
  const [byokTesting, setByokTesting] = useState(false);
  const [byokStatus, setByokStatus] = useState<string | null>(null);
  const [byokError, setByokError] = useState<string | null>(null);
  const [byokHelpOpen, setByokHelpOpen] = useState(false);
  const [voicePreset, setVoicePreset] = useState<VoicePreset>("Aoede");
  const [activeVoicePreview, setActiveVoicePreview] = useState<VoicePreset | null>(null);
  const voicePreviewUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [profileTotpSetup, setProfileTotpSetup] = useState<{ qr_code: string; secret: string } | null>(null);
  const [profileTotpCode, setProfileTotpCode] = useState("");
  const [profileTotpBusy, setProfileTotpBusy] = useState(false);
  const [profileTotpError, setProfileTotpError] = useState<string | null>(null);
  const [profileTotpMessage, setProfileTotpMessage] = useState<string | null>(null);
  const [profileTotpToast, setProfileTotpToast] = useState<string | null>(null);
  const profileTotpToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [profileEditor, setProfileEditor] = useState({
    name: "",
    mobileNumber: "",
    recoveryEmail: "",
    avatarUrl: "genie-preset:neutral",
    gender: "",
  });
  const [guestId, setGuestId] = useState("");

  const [members, setMembers] = useState<RoomMember[]>([]);
  const [historyVisibleBeforeJoin, setHistoryVisibleBeforeJoin] = useState(false);
  const [allowMemberExport, setAllowMemberExport] = useState(false);
  const [roomCryptoIdentity, setRoomCryptoIdentity] = useState<RoomCryptoIdentity | null>(null);
  const [discoverableFriends, setDiscoverableFriends] = useState<DiscoverableFriend[]>([]);
  const [pendingFriendRequests, setPendingFriendRequests] = useState<PendingFriendRequest[]>([]);
  const [realtimeToast, setRealtimeToast] = useState<{
    type: "friend" | "call";
    userId: string;
    displayName: string;
    callId?: string;
    roomId?: string;
  } | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<BlockedFriendProfile[]>([]);
  const [blockTarget, setBlockTarget] = useState<BlockedFriendProfile | DiscoverableFriend | null>(null);
  const [friendMenuUserId, setFriendMenuUserId] = useState<string | null>(null);
  const [sovereignRooms, setSovereignRooms] = useState<SovereignRoomSummary[]>([]);
  const [friendsQueueOpen, setFriendsQueueOpen] = useState(false);
  const [friendsQueueError, setFriendsQueueError] = useState<string | null>(null);
  const [isFriendsLoading, setIsFriendsLoading] = useState(false);
  const [socialInvites, setSocialInvites] = useState<SocialInvite[]>([]);
  const [friendSearchOpen, setFriendSearchOpen] = useState(false);
  const [friendSearchEmail, setFriendSearchEmail] = useState("");
  const [friendSearchResult, setFriendSearchResult] = useState<DiscoverableFriend | null>(null);
  const [friendSearchNotFound, setFriendSearchNotFound] = useState(false);
  const [friendSearchBusy, setFriendSearchBusy] = useState(false);
  const [omniSearchQuery, setOmniSearchQuery] = useState("");
  const [omniSearchResults, setOmniSearchResults] = useState<DiscoverableFriend[]>([]);
  const [omniSearchNotFound, setOmniSearchNotFound] = useState(false);
  const [omniSearchBusy, setOmniSearchBusy] = useState(false);
  const [omniSearchError, setOmniSearchError] = useState<string | null>(null);
  const [inviteEmailBusy, setInviteEmailBusy] = useState(false);
  const [inviteEmailStatus, setInviteEmailStatus] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [sharedChatsOpen, setSharedChatsOpen] = useState(true);
  const [trashSessions, setTrashSessions] = useState<ChatSession[]>([]);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [chatVaultOpen, setChatVaultOpen] = useState(false);
  const [chatVaultError, setChatVaultError] = useState<string | null>(null);
  const [roomAdminOpen, setRoomAdminOpen] = useState(false);
  const [roomCapacityMode, setRoomCapacityMode] = useState<RoomCapacityMode>("unlimited");
  const [customRoomCapacity, setCustomRoomCapacity] = useState(10);

  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: "1", title: "New Session", isPinned: false, messages: [], createdAt: new Date().toISOString() },
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
  const [isTopicConversation, setIsTopicConversation] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const [replyTarget, setReplyTarget] = useState<{ author: string; content: string } | null>(null);
  const [longPressMenu, setLongPressMenu] = useState<{ message: Message; index: number; x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [messageSearchMode, setMessageSearchMode] = useState<"ai" | "chat" | null>(null);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
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
  const [settingsTab, setSettingsTab] = useState<"profile" | "developer" | "totp" | "theme" | "docs" | "blocked" | "tools" | "audio">("profile");
  const [voiceCallGateNotice, setVoiceCallGateNotice] = useState("");
  const [reportType, setReportType] = useState<"ai_issue" | "ui_request">("ai_issue");
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketStatus, setTicketStatus] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [securityToast, setSecurityToast] = useState<string | null>(null);
  const suppressAuthWarning =
    (showDevAuthBypass || isAuthenticated) &&
    Boolean(chatError && /google sign-in could not be verified|google identity verification failed|ID token may be expired|platform engine failed.*google sign-in/i.test(chatError));
  const visibleChatError = suppressAuthWarning ? null : chatError;
  const [metaLoginError, setMetaLoginError] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState<IndianLanguage>(INDIAN_LANGUAGES[0]);
  const [isVoiceCallOpen, setIsVoiceCallOpen] = useState(false);
  const [voiceCallId, setVoiceCallId] = useState("");
  const [activeRoomVoiceCallId, setActiveRoomVoiceCallId] = useState("");
  const [activeRoomCallOwnerId, setActiveRoomCallOwnerId] = useState("");
  const [joinedRoomVoiceCallId, setJoinedRoomVoiceCallId] = useState("");
  const [voiceCallStartedAt, setVoiceCallStartedAt] = useState<string | null>(null);
  const [voiceCallParticipants, setVoiceCallParticipants] = useState<RoomMember[]>([]);
  const [activeVoiceSpeakerId, setActiveVoiceSpeakerId] = useState("");
  const voiceSpeakerTimerRef = useRef<number | null>(null);
  const [vipClaimGranted, setVipClaimGranted] = useState(false);
  const [remoteVoiceTurns, setRemoteVoiceTurns] = useState<VoiceCallTurn[]>([]);
  const [pendingCallTranscript, setPendingCallTranscript] = useState<VoiceCallTranscript | null>(null);
  const roomIdentity = userProfile.providerId ? `google:${userProfile.providerId}` : "";
  const setIsObserverActive = useCallback((active: boolean) => {
    if (!active) {
      setIsVoiceCallOpen(false);
      if (isTeamMode && activeRoomVoiceCallId) {
        sendRoomEvent({ type: "USER_LEFT_CALL", call_id: activeRoomVoiceCallId });
        if (activeRoomCallOwnerId === roomIdentity) {
          sendRoomEvent({ type: "voice_session.end", call_id: activeRoomVoiceCallId });
          setActiveRoomVoiceCallId("");
          setActiveRoomCallOwnerId("");
        }
        setJoinedRoomVoiceCallId("");
        setVoiceCallStartedAt(null);
      }
    }
    setIsObserverActiveState(active);
  }, [activeRoomCallOwnerId, activeRoomVoiceCallId, isTeamMode, roomIdentity]);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingPreview, setStreamingPreview] = useState("");
  const [streamingAutoFallback, setStreamingAutoFallback] = useState(false);
  const activeChatAbortControllerRef = useRef<AbortController | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [bufferingAudioId, setBufferingAudioId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
  const [selectedExportFormat, setSelectedExportFormat] = useState<"pdf" | "docx">("pdf");
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const audioRequestIdRef = useRef(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const vipSessionIdRef = useRef<string | null>(null);
  const roomSocketRef = useRef<WebSocket | null>(null);
  const roomHeartbeatRef = useRef<number | null>(null);
  const presenceLastActivityRef = useRef(Date.now());
  const archivePromptedRef = useRef(false);
  const readReceiptIdsRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (realtimeToast?.type !== "call") return;
    const audioContext = new window.AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 440;
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();

    const pulse = () => {
      const now = audioContext.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.14, now + 0.04);
      gain.gain.setValueAtTime(0.14, now + 0.32);
      gain.gain.linearRampToValueAtTime(0, now + 0.4);
    };
    pulse();
    let nextFrequency = 880;
    const ringTimer = window.setInterval(() => {
      oscillator.frequency.setValueAtTime(nextFrequency, audioContext.currentTime);
      nextFrequency = nextFrequency === 440 ? 880 : 440;
      pulse();
    }, 1500);
    void audioContext.resume().catch((error: unknown) => {
      console.warn("Incoming call ringtone could not start:", error);
    });

    return () => {
      window.clearInterval(ringTimer);
      oscillator.stop();
      oscillator.disconnect();
      gain.disconnect();
      void audioContext.close().catch((error: unknown) => {
        console.warn("Incoming call ringtone could not be closed cleanly:", error);
      });
    };
  }, [realtimeToast?.type, realtimeToast?.callId]);

  useEffect(() => () => {
    if (voiceSpeakerTimerRef.current !== null) {
      window.clearTimeout(voiceSpeakerTimerRef.current);
    }
  }, []);

  const API_BASE = getBackendBaseUrl();

  const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || "";
  const FACEBOOK_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID?.trim() || "";

  const isCorporateDomain = Boolean(
    googleIdToken && scopeVerifiedToken === googleIdToken && corporateTenantId,
  );
  const isDevUser = userProfile.email.toLowerCase() === DEVELOPER_EMAIL.toLowerCase();
  const isMasterAdmin = userProfile.email.trim().toLowerCase() === "rshaji93@gmail.com";
  const effectiveUserAvatar = isMasterAdmin
    ? "/admin-avatar.png"
    : isCorporateDomain
      ? corporateAvatarUrl
      : profileAvatar;
  const canAccessVoiceCall = useCallback(() => {
    if (!isObserverActive) return false;
    if (userProfile.email.trim().toLowerCase() === "rshaji93@gmail.com") return true;
    try {
      return Boolean(localStorage.getItem("genie_user_byok_key")?.trim());
    } catch (error) {
      console.warn("BYOK key could not be checked for voice call access:", error);
      return false;
    }
  }, [isObserverActive, userProfile.email]);
  const hasVoiceCallAccess = canAccessVoiceCall();
  const isPlatformHost = ADMIN_EMAILS.includes(userProfile.email.toLowerCase());
  const isKeyOwner = byokVerified || isPlatformHost;
  const isOwner =
    isAuthenticated &&
    verifiedArchiveOwner?.providerId === userProfile.providerId &&
    verifiedArchiveOwner.email.toLowerCase() === userProfile.email.trim().toLowerCase();

  const isVipEligible =
    Boolean(googleIdToken) && VIP_ALLOWED_EMAILS.includes(userProfile.email.toLowerCase());
  const isVipUser = isVipSessionActive && (isVipEligible || vipClaimGranted);

  const isQuotaEnforced = !isMasterAdmin && !isVipUser && !byokVerified;
  const remainingDailyChats = isMasterAdmin ? 999999 : Math.max(0, DAILY_FREE_LIMIT - dailyUsageCount);
  const activeRoomMemberCount = members.filter((member) => member.status === "active").length;
  const roomMemberCount = members.length;
  const isCurrentRoomHost = members.some(
    (member) => member.id === roomIdentity && (member.is_host || member.role === "sovereign"),
  );
  const isCurrentRoomOriginAdmin = members.some(
    (member) => member.id === roomIdentity && member.is_origin_admin,
  );
  const canManageRoomPolicy = spaceMode === "personal"
    ? isCurrentRoomHost
    : isCurrentRoomOriginAdmin;
  const currentRoomMember = members.find((member) => member.id === roomIdentity);
  const canExportActiveChat = !isTeamMode
    ? !isCorporateDomain
    : spaceMode === "personal"
    ? isCurrentRoomHost
    : isCurrentRoomOriginAdmin || Boolean(currentRoomMember?.can_export);
  const exportDisabledReason = spaceMode === "personal"
    ? "Export disabled in multi-user Personal Mode"
    : "Export disabled by Workspace Administrator";
  useEffect(() => {
    const printingRestricted = !canExportActiveChat;
    document.body.classList.toggle("print-restricted", printingRestricted);
    const handlePrintShortcut = (event: KeyboardEvent) => {
      if (
        printingRestricted &&
        event.key.toLowerCase() === "p" &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        setSecurityToast("Printing is disabled because you do not have export permission for this session.");
        window.setTimeout(() => setSecurityToast(null), 4000);
      }
    };
    window.addEventListener("keydown", handlePrintShortcut, true);
    return () => {
      document.body.classList.remove("print-restricted");
      window.removeEventListener("keydown", handlePrintShortcut, true);
    };
  }, [canExportActiveChat]);
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
    : isTopicConversation
    ? activeTopic?.messages || []
    : currentSession?.isSharedArchive
    ? currentSession.messages
    : currentSession?.messages || personalMessages;
  const searchableMessages = sessions.filter((session) => !session.isDeleted).flatMap((session) => session.messages)
    .concat(topics.flatMap((topic) => topic.messages), personalMessages);
  const searchMatches = messageSearchQuery.trim()
    ? [...new Map(searchableMessages.filter((message) =>
        message.content.toLowerCase().includes(messageSearchQuery.trim().toLowerCase())
      ).map((message) => [message.id || `${message.role}:${message.content}`, message])).values()].slice(0, 8)
    : [];
  const chatSearchMatches = searchMatches.filter((message) => message.role === "user");
  const aiSearchMatches = searchMatches.filter((message) => message.role === "assistant");
  const observerPreferenceOwner =
    userProfile.providerId || userProfile.email.toLowerCase() || guestId || "guest";

  useEffect(() => {
    if (!mounted) return;
    let active = true;
    try {
      const savedPreference = localStorage.getItem(
        `genie_observer_mode_${observerPreferenceOwner}`
      );
      if (savedPreference === "true" || savedPreference === "false") {
        queueMicrotask(() => {
          if (active) setIsObserverActive(savedPreference === "true");
        });
      }
    } catch (error) {
      console.error("Observer mode preference could not be restored:", error);
      queueMicrotask(() => {
        if (active) setChatError("Observer mode preference could not be restored from this browser.");
      });
    }
    return () => {
      active = false;
    };
  }, [mounted, observerPreferenceOwner]);

  const updateCurrentPersonalMessages = (updateMessages: (current: Message[]) => Message[]) => {
    if (!isTeamMode && currentSession?.isArchived) {
      setSecurityToast("Archived sessions are read-only. Clone the transcript to continue editing.");
      return;
    }
    if (currentSession?.isSharedArchive) {
      setSessions((previous) =>
        previous.map((session) =>
          session.id === currentSession.id
            ? { ...session, messages: updateMessages(session.messages) }
            : session
        )
      );
      return;
    }

    if (isTopicConversation && activeTopic) {
      setTopics((previous) =>
        previous.map((topic) => {
          if (topic.id !== activeTopic.id) return topic;
          const updatedMessages = updateMessages(topic.messages);
          return {
            ...topic,
            messages: updatedMessages,
            message_count: updatedMessages.length,
          };
        })
      );
      setPersonalMessages(updateMessages);
      return;
    }
    if (currentSession) {
      setSessions((previous) =>
        previous.map((session) =>
          session.id === currentSession.id
            ? { ...session, messages: updateMessages(session.messages) }
            : session
        )
      );
    }
    setPersonalMessages(updateMessages);
  };

  function stopCurrentChatGeneration() {
    activeChatAbortControllerRef.current?.abort();
    activeChatAbortControllerRef.current = null;
    setStreamingPreview("");
    setStreamingAutoFallback(false);
    setChatError(null);
    setIsStreaming(false);
  }

  function toggleSidebar() {
    if (window.innerWidth < 768) {
      setSidebarOpen((open) => !open);
      return;
    }
    setSidebarCollapsed((collapsed) => !collapsed);
  }

  function handleSelectSession(session: ChatSession) {
    stopCurrentChatGeneration();
    setCurrentSessionId(session.id);
    setIsTopicConversation(Boolean(session.topicId));
    setIsTeamMode(false);
    setPersonalMessages(session.messages);
    setPrompt("");
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }

  function handleCreateNewChat() {
    stopCurrentChatGeneration();
    const newId = window.crypto.randomUUID();
    setSessions((previous) => [
      { id: newId, title: "New Session", isPinned: false, messages: [], createdAt: new Date().toISOString() },
      ...previous,
    ]);
    setCurrentSessionId(newId);
    setIsTopicConversation(false);
    setIsTeamMode(false);
    setPersonalMessages([]);
    setPrompt("");
    window.requestAnimationFrame(() => promptInputRef.current?.focus());
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }

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

  function startVoiceCall(inviteRoomParticipants = false) {
    if (!canAccessVoiceCall()) {
      setVoiceCallGateNotice("Live Voice Calls are exclusive to BYOK users. Please add your Gemini API key in Settings > BYOK to start voice calls.");
      setSettingsTab("developer");
      setSettingsOpen(true);
      return;
    }
    setVoiceCallGateNotice("");
    const callId = isTeamMode && activeRoomVoiceCallId
      ? activeRoomVoiceCallId
      : window.crypto.randomUUID();
    setVoiceCallStartedAt(new Date().toISOString());
    if (isTeamMode && !activeRoomVoiceCallId) {
      if (!sendRoomEvent({
        type: "voice_session.start",
        call_id: callId,
        voice_name: voicePreset,
      })) return;
      setActiveRoomVoiceCallId(callId);
      setActiveRoomCallOwnerId(roomIdentity);
      setJoinedRoomVoiceCallId(callId);
      setVoiceCallParticipants(members.filter((member) => member.status === "active"));
      setRemoteVoiceTurns([]);
    }
    if (isTeamMode && activeRoomVoiceCallId && joinedRoomVoiceCallId !== callId) {
      if (!sendRoomEvent({ type: "USER_JOINED_CALL", call_id: callId })) return;
      setJoinedRoomVoiceCallId(callId);
    } else if (inviteRoomParticipants && isTeamMode && activeRoomMemberCount >= 2) {
      if (!sendRoomEvent({ type: "INCOMING_CALL", call_id: callId })) return;
    }
    setVoiceCallId(callId);
    setIsVoiceCallOpen(true);
  }

  async function claimVipSecretPass(code: string, days: number) {
    if (!googleIdToken) throw new Error("Sign in with Google before claiming VIP access.");
    const response = await fetch(getBackendApiUrl("/api/vip/claim-secret-pass"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${googleIdToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, days }),
    });
    const result = await response.json().catch(() => ({})) as { detail?: string; status?: string; expires_at?: string };
    if (!response.ok || result.status !== "SUCCESS") {
      throw new Error(result.detail || "VIP claim could not be completed.");
    }
    try {
      localStorage.setItem(`genie_vip_claimed_${userProfile.email.toLowerCase()}`, "true");
    } catch (error) {
      console.warn("VIP entitlement is active but could not be cached on this device:", error);
    }
    setVipClaimGranted(true);
    setIsVipSessionActive(true);
    setSecurityToast(`VIP access activated until ${new Date(result.expires_at || "").toLocaleString()}.`);
    window.setTimeout(() => setSecurityToast(null), 5000);
  }

  function endActiveCallFromHeader() {
    if (isTeamMode && activeRoomVoiceCallId) {
      sendRoomEvent({ type: "USER_LEFT_CALL", call_id: activeRoomVoiceCallId });
      if (activeRoomCallOwnerId === roomIdentity) {
        sendRoomEvent({ type: "voice_session.end", call_id: activeRoomVoiceCallId });
        setActiveRoomVoiceCallId("");
        setActiveRoomCallOwnerId("");
      }
      setJoinedRoomVoiceCallId("");
      setVoiceCallStartedAt(null);
    }
    setVoiceCallStartedAt(null);
    setIsVoiceCallOpen(false);
  }

  function changeVoiceCallLanguage(languageCode: string) {
    if (spaceMode === "workspace") return;
    const language = INDIAN_LANGUAGES.find((item) => item.code === languageCode);
    if (!language) return;
    setSelectedLang(language);
    if (isTeamMode) {
      sendRoomEvent({ type: "UPDATE_USER_LANGUAGE", language: languageCode });
    }
  }

  function markVoiceSpeaker(userId: string) {
    setActiveVoiceSpeakerId(userId);
    if (voiceSpeakerTimerRef.current !== null) {
      window.clearTimeout(voiceSpeakerTimerRef.current);
    }
    voiceSpeakerTimerRef.current = window.setTimeout(() => {
      setActiveVoiceSpeakerId("");
      voiceSpeakerTimerRef.current = null;
    }, 1800);
  }

  async function broadcastVoiceTurn(turn: VoiceCallTurn, callId: string) {
    if (!isTeamMode) return;
    if (turn.role === "user") markVoiceSpeaker(turn.userId);
    const sent = await sendEncryptedRoomEvent({
      type: "voice_session.turn",
      content: turn.text,
      call_id: callId,
      turn_id: turn.id,
      role: turn.role,
      timestamp: turn.timestamp,
    });
    if (!sent) {
      throw new Error("Voice turn could not be broadcast to the room.");
    }
  }

  async function handleVoiceCallEnd(transcript: VoiceCallTranscript) {
    setIsVoiceCallOpen(false);
    setVoiceCallStartedAt(null);
    if (isTeamMode) {
      sendRoomEvent({
        type: "USER_LEFT_CALL",
        call_id: transcript.callId,
      });
      if (activeRoomCallOwnerId === roomIdentity) {
        sendRoomEvent({ type: "voice_session.end", call_id: transcript.callId });
        setActiveRoomVoiceCallId("");
        setActiveRoomCallOwnerId("");
      }
      setJoinedRoomVoiceCallId("");
      const canSaveRoomCallLog = spaceMode === "personal"
        ? isCurrentRoomHost
        : isCurrentRoomOriginAdmin;
      if (!canSaveRoomCallLog) return;
      if (spaceMode === "personal") {
        setPendingCallTranscript(transcript);
        return;
      }
      const content = JSON.stringify(transcript);
      const sent = await sendEncryptedRoomEvent({
        type: "message.send",
        content,
        sender_name: "Genie Master",
        sender_type: "assistant",
        is_voice_record: true,
        is_voice_session_summary: true,
        call_id: transcript.callId,
      });
      if (!sent) {
        setChatError("The mandatory Genie Master call transcript could not be saved to this room.");
        return;
      }
      return;
    }
    if (spaceMode === "workspace") {
      updateCurrentPersonalMessages((current) => [
        ...current,
        {
          id: transcript.callId,
          role: "assistant",
          content: formatVoiceCallTranscript(transcript),
          text: formatVoiceCallTranscript(transcript),
          timestamp: new Date().toISOString(),
          senderName: "Genie Master",
          isCallRecord: true,
          callTranscript: transcript,
        },
      ]);
      return;
    }
    setPendingCallTranscript(transcript);
  }

  function savePendingCallTranscript() {
    const canSaveRoomCallLog = spaceMode === "personal"
      ? isCurrentRoomHost
      : isCurrentRoomOriginAdmin;
    if (!pendingCallTranscript || (isTeamMode && !canSaveRoomCallLog)) return;
    const record = pendingCallTranscript;
    if (isTeamMode) {
      void sendEncryptedRoomEvent({
        type: "message.send",
        content: JSON.stringify(record),
        sender_name: "Genie Master",
        sender_type: "assistant",
        is_voice_record: true,
        is_voice_session_summary: true,
        call_id: record.callId,
      }).then((sent) => {
        if (!sent) {
          setChatError("The call log could not be saved to this room.");
          return;
        }
        setPendingCallTranscript(null);
      });
      return;
    }
    updateCurrentPersonalMessages((current) => [
      ...current,
      {
        id: record.callId,
        role: "assistant",
        content: formatVoiceCallTranscript(record),
        text: formatVoiceCallTranscript(record),
        timestamp: new Date().toISOString(),
        senderName: "Genie Master",
        isCallRecord: true,
        callTranscript: record,
      },
    ]);
    setPendingCallTranscript(null);
  }

  function purgeLocalChatContext() {
    const newSession: ChatSession = {
      id: window.crypto.randomUUID(),
      title: "New Session",
      isPinned: false,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    try {
      localStorage.removeItem("genie_chat_sessions_v2");
      localStorage.removeItem("genie_chat_sessions");
      if (topicsStorageOwner) localStorage.removeItem(`genie_topics_v1_${topicsStorageOwner}`);
      setChatError(null);
    } catch (error) {
      console.error("Local chat context purge failed:", error);
      setChatError("Some local chat history could not be removed from browser storage.");
    }
    setSessions([newSession]);
    setCurrentSessionId(newSession.id);
    setPersonalMessages([]);
    setTopics((previous) => previous.map((topic) => ({ ...topic, messages: [], message_count: 0 })));
    setArchivedRoomMessages({});
    setPendingCallTranscript(null);
    if (isTeamMode) setRoomMessages([]);
  }

  function archiveCurrentSession() {
    if (!currentSession || currentSession.isArchived) return;
    setSessions((previous) => previous.map((session) =>
      session.id === currentSession.id ? { ...session, isArchived: true } : session
    ));
    setSecurityToast("Session moved to Archive and is now read-only.");
  }

  async function exportAndArchiveCurrentSession() {
    if (!currentSession || currentSession.isArchived) return;
    if (await exportCurrentSessionTranscript("markdown")) archiveCurrentSession();
  }

  function wipeClientCacheAndTokens() {
    try {
      const preservedTranscriptKeys = new Set(["genie_chat_sessions_v2", "genie_chat_sessions"]);
      for (const key of Object.keys(localStorage)) {
        if (!preservedTranscriptKeys.has(key) && (
          key.startsWith("genie_") ||
          key === "token" ||
          key === "auth_token" ||
          key === "access_token"
        )) {
          localStorage.removeItem(key);
        }
      }
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith("genie_") || key === "token" || key === "auth_token" || key === "access_token") {
          sessionStorage.removeItem(key);
        }
      }
      setGoogleIdToken("");
      setIsAuthenticated(false);
      setSecurityToast("Genie cache and sign-in tokens cleared. Chat transcripts were preserved.");
    } catch (error) {
      console.error("Client cache and token wipe failed:", error);
      setSecurityToast("Some browser state could not be cleared.");
    }
  }

  function fullEphemeralReset() {
    if (!window.confirm("This permanently clears Genie session traces and local conversations from this browser. Continue?")) return;
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("genie_") || key === "token" || key === "auth_token" || key === "access_token") {
          localStorage.removeItem(key);
        }
      }
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith("genie_") || key === "token" || key === "auth_token" || key === "access_token") {
          sessionStorage.removeItem(key);
        }
      }
      setGoogleIdToken("");
      setIsAuthenticated(false);
      purgeLocalChatContext();
      setSecurityToast("Local Genie session traces were cleared.");
    } catch (error) {
      console.error("Full ephemeral reset failed:", error);
      setSecurityToast("The full local reset could not be completed.");
    }
  }

  function duplicateCurrentTranscript(forkAtCurrentMessage: boolean) {
    if (!currentSession) return;
    const source = messages.filter((message) => !message.is_deleted);
    const copiedMessages = (forkAtCurrentMessage ? source.slice(0, source.length) : source).map((message) => ({
      ...message,
      id: window.crypto.randomUUID(),
    }));
    const clone: ChatSession = {
      id: window.crypto.randomUUID(),
      title: `${forkAtCurrentMessage ? "Fork" : "Sandbox"} · ${currentSession.title}`.slice(0, 120),
      isPinned: false,
      messages: copiedMessages,
      createdAt: new Date().toISOString(),
    };
    setSessions((previous) => [clone, ...previous]);
    setCurrentSessionId(clone.id);
    setIsTopicConversation(false);
    setIsTeamMode(false);
    setPersonalMessages(copiedMessages);
    setPrompt("");
    setSecurityToast(forkAtCurrentMessage ? "Session fork created." : "Full transcript cloned to a sandbox.");
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
      transcript &&
      !historyVisibleBeforeJoin &&
      (roomId.startsWith("share_") || roomId.startsWith("invite_")) &&
      roomIdentity === shareTranscriptOwnerRef.current
    ) {
      shareTranscriptRef.current = null;
      shareTranscriptSentRef.current = true;
      return;
    }
    if (
      !transcript ||
      shareTranscriptSentRef.current ||
      (!roomId.startsWith("share_") && !roomId.startsWith("invite_")) ||
      roomIdentity !== shareTranscriptOwnerRef.current ||
      !historyVisibleBeforeJoin ||
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
          is_history_replay: true,
          is_voice_record: Boolean(
            message.isVoiceRecord || message.isVoiceSessionSummary || message.isCallRecord,
          ),
          is_voice_session_summary: Boolean(message.isVoiceSessionSummary),
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
    let callTranscript: VoiceCallTranscript | undefined;
    if (normalized.isVoiceSessionSummary) {
      try {
        callTranscript = JSON.parse(content) as VoiceCallTranscript;
      } catch (error) {
        console.error("Room voice session summary is malformed:", error);
      }
    }
    const displayContent = callTranscript ? formatVoiceCallTranscript(callTranscript) : content;
    return { ...normalized, content: displayContent, text: displayContent, callTranscript };
  }

  // Restore authenticated session from localStorage on initial load
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const pathShareRoom = window.location.pathname.match(/^\/room\/((?:share|invite)_[A-Za-z0-9_-]+)\/?$/)?.[1];
        const initialRoomId =
          pathShareRoom || new URLSearchParams(window.location.search).get("room");
        if (initialRoomId) {
          setRoomId(initialRoomId);
          setIsTeamMode(true);
          if (initialRoomId.startsWith("share_") || initialRoomId.startsWith("invite_")) setIsRoomUnlocked(true);
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
              const recentSessions = validSessions.filter((session) =>
                !session.isDeleted ||
                !session.deletedAt ||
                Date.now() - new Date(session.deletedAt).getTime() <= 30 * 86400000
              );
              const activeSessions = recentSessions.filter((session) => !session.isDeleted);
              const deletedSessions = recentSessions.filter((session) => session.isDeleted);
              const sessionsForUse = activeSessions.length
                ? activeSessions
                : [{ id: Date.now().toString(), title: "New Session", isPinned: false, messages: [] }];
              const normalizedSessions = sessionsForUse.map((session) => ({
                ...session,
                messages: ensureMessageTimestamps(session.messages),
                createdAt: session.createdAt || session.messages[0]?.timestamp || new Date().toISOString(),
              }));
              const normalizedDeleted = deletedSessions.map((session) => ({
                ...session,
                messages: ensureMessageTimestamps(session.messages),
                createdAt: session.createdAt || session.messages[0]?.timestamp || new Date().toISOString(),
              }));
              setSessions([...normalizedSessions, ...normalizedDeleted]);
              setTrashSessions(normalizedDeleted);
              setCurrentSessionId(sessionsForUse[0].id);
              setIsTopicConversation(Boolean(sessionsForUse[0].topicId));
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
        const restoredGoogleToken =
          localStorage.getItem("genie_session_token") ||
          sessionStorage.getItem("genie_google_id_token") ||
          "";
        setGoogleIdToken(restoredGoogleToken);

        try {
          const storedThemeId = localStorage.getItem(THEME_STORAGE_KEY);
          const storedTheme = THEME_PRESETS.find((theme) => theme.id === storedThemeId);
          if (storedTheme) setCurrentTheme(storedTheme);
        } catch (error) {
          console.error("Theme restoration error", error);
        }

        if (window.innerWidth >= 768) {
          setSidebarOpen(true);
        }

        try {
          const savedAuth = localStorage.getItem("genie_is_authenticated");
          const savedProfile = localStorage.getItem("genie_user_profile");
          if (savedAuth === "true" && savedProfile) {
            const parsedProfile = JSON.parse(savedProfile);
            setVipClaimGranted(
              localStorage.getItem(`genie_vip_claimed_${String(parsedProfile.email || "").toLowerCase()}`) === "true",
            );
            const isDevSession = localStorage.getItem("genie_session_token") === "dev-token-local-bypass";
            const isLocalRegistrationFallback =
              localStorage.getItem("genie_local_registration_fallback") === "true";
            setUserProfile((prev) => ({
              ...prev,
              ...parsedProfile,
              providerId: parsedProfile.providerId || (isDevSession ? "dev-admin" : prev.providerId),
              authProvider: parsedProfile.authProvider || (isDevSession ? "google" : prev.authProvider),
              avatarUrl: parsedProfile.avatarUrl || (isDevSession ? "genie-preset:guardian" : prev.avatarUrl),
              totpEnabled: Boolean(parsedProfile.totpEnabled),
              customApiKey: "",
            }));
            setAuthenticatorEnabled(Boolean(parsedProfile.totpEnabled));
            setIsAuthenticated(isDevSession || isLocalRegistrationFallback);
          }
        } catch (error) {
          console.error("Session restoration error", error);
        }
      }
    } catch (error) {
      console.error("Workspace initialization error", error);
    } finally {
      setThemeReady(true);
      setShowDevAuthBypass(
        process.env.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
      );
      setMounted(true);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!googleIdToken || !userProfile.providerId || googleIdToken === "dev-token-local-bypass") return;
    let active = true;
    setRegistrationBusy(true);
    void fetch(getAuthApiUrl(API_BASE, "registration/me"), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${googleIdToken}` },
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          registered?: boolean;
          requires_setup?: boolean;
          email?: string;
          profile?: {
            display_name?: string;
            email?: string;
            google_avatar_url?: string;
            mobile_number?: string;
            mobile_verified?: boolean;
            recovery_email?: string;
            allow_room_invites?: "mutual_friends" | "everyone";
            is_creator?: boolean;
            avatar_url?: string;
            gender?: string;
          };
          session_token?: string;
          totp_enabled?: boolean;
          profile_complete?: boolean;
          detail?: string;
        };
        if (response.status === 401) {
          if (localStorage.getItem("genie_local_registration_fallback") === "true") {
            throw new Error("The registration service could not verify the saved local session.");
          }
          registrationReauthRequiredRef.current = true;
          setRegistrationReauthRequired(true);
          sessionStorage.removeItem("genie_google_id_token");
          localStorage.removeItem("genie_session_token");
          throw new Error("Your Google sign-in expired or could not be verified. Re-authenticate with Google to continue.");
        }
        if (response.status === 404) {
          if (!active) return;
          const email = userProfile.email || authenticatorLoginEmail || "rshaji93@gmail.com";
          setAuthenticatorLoginEmail(email);
          setUserProfile((previous) => ({ ...previous, email }));
          setRegistrationRequired(true);
          setIsAuthenticated(false);
          return;
        }
        if (!response.ok) throw new Error(result.detail || `Registration status could not be checked (HTTP ${response.status}).`);
        if (!active) return;
        setAuthenticatorEnabled(Boolean(result.totp_enabled));
        setUserProfile((previous) => ({ ...previous, totpEnabled: Boolean(result.totp_enabled) }));
        const hasLocalRegistrationFallback =
          localStorage.getItem("genie_local_registration_fallback") === "true";
        if (hasLocalRegistrationFallback && !result.registered) {
          setRegistrationRequired(false);
          setIsAuthenticated(true);
          return;
        }
        if (!result.registered) {
          const email = result.email || result.profile?.email || userProfile.email || authenticatorLoginEmail || "rshaji93@gmail.com";
          setAuthenticatorLoginEmail(email);
          setUserProfile((previous) => ({
            ...previous,
            name: result.profile?.display_name || previous.name,
            email,
            mobileNumber: result.profile?.mobile_number || previous.mobileNumber,
            mobileVerified: result.profile?.mobile_verified === true,
            recoveryEmail: result.profile?.recovery_email || previous.recoveryEmail,
            avatarUrl: result.profile?.avatar_url || previous.avatarUrl,
            gender: result.profile?.gender || previous.gender,
          }));
          setIsAuthenticated(false);
          setRegistrationRequired(true);
          return;
        }
        const profile = {
          ...userProfile,
          name: result.profile?.display_name || userProfile.name,
          email: result.profile?.email || userProfile.email,
          googleAvatarUrl: result.profile?.google_avatar_url || userProfile.googleAvatarUrl,
          mobileNumber: result.profile?.mobile_number || "",
          mobileVerified: result.profile?.mobile_verified === true,
          recoveryEmail: result.profile?.recovery_email || "",
          allowRoomInvites: result.profile?.allow_room_invites || "mutual_friends",
          isCreator: Boolean(result.profile?.is_creator),
          avatarUrl: result.profile?.avatar_url || "genie-preset:neutral",
          totpEnabled: Boolean(result.totp_enabled),
          gender: result.profile?.gender || "",
        };
        const sessionToken = googleIdToken.startsWith("genie1.")
          ? result.session_token || googleIdToken
          : result.session_token || "";
        if (!sessionToken) {
          setAuthMode("login");
          setAuthenticatorLoginEmail(result.profile?.email || userProfile.email);
          setIsAuthenticated(false);
          return;
        }
        if (sessionToken !== googleIdToken) setGoogleIdToken(sessionToken);
        sessionStorage.setItem("genie_google_id_token", sessionToken);
        if (sessionToken.startsWith("genie1.")) {
          localStorage.setItem("genie_session_token", sessionToken);
        }
        setUserProfile(profile);
        localStorage.setItem("genie_user_profile", JSON.stringify({ ...profile, customApiKey: "", totpPasscode: "" }));
        localStorage.setItem("genie_is_authenticated", "true");
        localStorage.setItem("genie_terms_agreed", "true");
        localStorage.removeItem("genie_local_registration_fallback");
        if (profile.providerId && profile.email.trim()) {
          setVerifiedArchiveOwner({
            providerId: profile.providerId,
            email: profile.email.trim(),
          });
        }
        setRegistrationRequired(false);
        setIsAuthenticated(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("Mandatory registration verification failed:", error);
        if (localStorage.getItem("genie_local_registration_fallback") === "true") {
          setRegistrationRequired(false);
          setIsAuthenticated(true);
          return;
        }
        setRegistrationRequired(true);
        setIsAuthenticated(false);
        setRegistrationError(error instanceof Error ? error.message : "Registration status could not be checked.");
      })
      .finally(() => {
        if (active) setRegistrationBusy(false);
      });
    return () => {
      active = false;
    };
  }, [mounted, googleIdToken, userProfile.providerId, userProfile.email, authenticatorLoginEmail, registrationRequired, API_BASE]);

  useEffect(() => {
    if (!mounted || !registrationRequired || !registrationReauthRequired) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const renderReauthenticationButton = () => {
      const google = (window as any).google;
      const container = document.getElementById("googleRegistrationReauthBtn");
      if (!google?.accounts?.id || !(window as any).__gsi_auth_active || !container) return false;
      if (container.childElementCount === 0) {
        google.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          width: 300,
          text: "signin_with",
          shape: "pill",
        });
      }
      return true;
    };
    if (!renderReauthenticationButton()) {
      timer = setInterval(() => {
        if (active && renderReauthenticationButton() && timer) clearInterval(timer);
      }, 350);
    }
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [mounted, registrationRequired, registrationReauthRequired]);

  function requireGoogleReauthentication(message: string) {
    registrationReauthRequiredRef.current = true;
    setRegistrationReauthRequired(true);
    sessionStorage.removeItem("genie_google_id_token");
    setRegistrationError(message);
  }

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
    if (!mounted || isCorporateDomain || !isAuthenticated || !googleIdToken || !userProfile.providerId) return;
    let active = true;
    setIsTopicLoading(true);
    void fetch(
      getBackendApiUrl(`/api/personal/topics?user_id=${encodeURIComponent(userProfile.providerId)}`),
      { headers: { Authorization: `Bearer ${googleIdToken}` } }
    )
      .then(async (response) => {
        const result = (await response.json()) as {
          topics?: TopicChannel[];
          detail?: string;
        };
if (!response.ok || !Array.isArray(result.topics)) {
    console.warn("Topic channels unavailable or invalid, applying fallback.");
    return;
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
  }, [mounted, isCorporateDomain, isAuthenticated, googleIdToken, userProfile.providerId, API_BASE]);

  useEffect(() => {
    if (!mounted) return;
    try {
      if (roomId.startsWith("share_") || roomId.startsWith("invite_")) {
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
    if (!roomCryptoIdentity || !googleIdToken?.startsWith("genie1.")) return;
    void fetch(getBackendApiUrl("/api/crypto/public-key"), {
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
    if (!mounted) return;
    const timeout = window.setTimeout(() => {
      try {
        const savedKey = localStorage.getItem("genie_user_byok_key") || "";
        setByokApiKey(savedKey);
        setByokStatus(savedKey ? "Saved on this device · test to activate" : null);
        const savedProfile = JSON.parse(localStorage.getItem("genie_user_profile") || "{}") as {
          preferredVoice?: string;
        };
        const savedVoice =
          localStorage.getItem("genie_preferred_voice") ||
          localStorage.getItem("genie_tts_voice_preset") ||
          savedProfile.preferredVoice ||
          "Aoede";
        if (VOICE_PRESETS.some(({ key }) => key === savedVoice)) {
          const preset = savedVoice as VoicePreset;
          setVoicePreset(preset);
          setUserProfile((previous) => ({ ...previous, preferredVoice: preset }));
        }
      } catch (error) {
        console.error("Device preferences could not be loaded:", error);
        setByokError("Device preferences could not be loaded from local storage.");
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [mounted]);

  function selectVoicePreset(preset: VoicePreset) {
    setVoicePreset(preset);
    setUserProfile((previous) => ({ ...previous, preferredVoice: preset }));
    try {
      localStorage.setItem("genie_preferred_voice", preset);
      localStorage.setItem("genie_tts_voice_preset", preset);
      const updatedProfile = { ...userProfile, preferredVoice: preset };
      localStorage.setItem(
        "genie_user_profile",
        JSON.stringify({ ...updatedProfile, customApiKey: "", totpPasscode: "" }),
      );
    } catch (error) {
      console.error("Voice preference could not be saved:", error);
      setChatError("Voice preference was selected but could not be saved to this browser.");
    }
    if (activeVoicePreview) stopVoicePreview();
  }

  function stopVoicePreview() {
    window.speechSynthesis.cancel();
    voicePreviewUtteranceRef.current = null;
    setActiveVoicePreview(null);
  }

  function previewVoice(preset: VoicePreset) {
    stopVoicePreview();
    stopActiveRegionalAudio();
    window.dispatchEvent(new Event("genie:stop-call-audio"));
    if (activeVoicePreview === preset) return;

    const voice = VOICE_PRESETS.find((item) => item.key === preset);
    if (!voice) return;
    const utterance = new SpeechSynthesisUtterance(voice.sample);
    utterance.pitch = voice.pitch;
    utterance.rate = voice.rate;
    const browserVoices = window.speechSynthesis.getVoices();
    const preferredBrowserVoice = browserVoices.find((browserVoice) =>
      voice.gender.toLowerCase().includes("female")
        ? /female|woman|zira|samantha|victoria|karen/i.test(browserVoice.name)
        : /male|man|david|daniel|alex|james/i.test(browserVoice.name),
    );
    if (preferredBrowserVoice) utterance.voice = preferredBrowserVoice;
    utterance.onend = () => {
      if (voicePreviewUtteranceRef.current === utterance) {
        voicePreviewUtteranceRef.current = null;
        setActiveVoicePreview(null);
      }
    };
    utterance.onerror = (event) => {
      if (voicePreviewUtteranceRef.current === utterance) {
        voicePreviewUtteranceRef.current = null;
        setActiveVoicePreview(null);
        console.error("Voice preview playback failed:", event.error);
        setChatError("Voice preview could not be played in this browser.");
      }
    };
    voicePreviewUtteranceRef.current = utterance;
    setActiveVoicePreview(preset);
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => () => {
    window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    if (
      !mounted ||
      registrationBusy ||
      !userProfile.email.trim() ||
      isOwner !== true ||
      !googleIdToken ||
      archivePromptedRef.current
    ) return;
    archivePromptedRef.current = true;
    void loadArchiveManifest(true);
  }, [mounted, registrationBusy, userProfile.email, isOwner, googleIdToken]);

  useEffect(() => {
    if (!isTeamMode || !archivedRoomMessages[roomId]) return;
    setRoomMessages(archivedRoomMessages[roomId]);
  }, [roomId, isTeamMode, archivedRoomMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  function handleMessageScroll() {
    const viewport = messageScrollRef.current;
    if (!viewport) return;
    setIsScrolledUp(
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 250,
    );
  }

  function getMessageSelectionId(message: Message, index: number): string {
    return message.id || `message-${index}`;
  }

  function toggleMessageSelection(message: Message, index: number) {
    const messageId = getMessageSelectionId(message, index);
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function cancelMessageSelection() {
    setSelectedMessageIds(new Set());
    setIsSelectionMode(false);
  }

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
      if (roomHeartbeatRef.current !== null) {
        window.clearInterval(roomHeartbeatRef.current);
        roomHeartbeatRef.current = null;
      }
      roomSocketRef.current?.close();
      roomSocketRef.current = null;
      return;
    }

    if (!googleIdToken || !roomIdentity) {
      setChatError("Sign in with Google before joining a shared room.");
      return;
    }

    const socketUrl = new URL(
      `${API_BASE}/ws/rooms/${encodeURIComponent(roomId)}`,
      window.location.origin
    );
    socketUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(socketUrl);
    roomSocketRef.current = socket;
    readReceiptIdsRef.current.clear();
    presenceLastActivityRef.current = Date.now();
    const markPresenceActivity = () => {
      presenceLastActivityRef.current = Date.now();
    };
    const sendPresenceHeartbeat = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({
        type: "room.heartbeat",
        room_id: roomId,
        focused:
          document.visibilityState === "visible" &&
          document.hasFocus() &&
          Date.now() - presenceLastActivityRef.current <= 5 * 60 * 1000,
      }));
    };
    const refreshFocusedPresence = () => sendPresenceHeartbeat();
    window.addEventListener("pointerdown", markPresenceActivity, { passive: true });
    window.addEventListener("keydown", markPresenceActivity);
    window.addEventListener("touchstart", markPresenceActivity, { passive: true });

    socket.addEventListener("open", () => {
      const isFocused = document.visibilityState === "visible" && document.hasFocus();
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
          focused: isFocused,
        })
      );
      sendPresenceHeartbeat();
      if (roomHeartbeatRef.current !== null) window.clearInterval(roomHeartbeatRef.current);
      roomHeartbeatRef.current = window.setInterval(sendPresenceHeartbeat, 20000);
    });
    window.addEventListener("focus", refreshFocusedPresence);
    window.addEventListener("blur", refreshFocusedPresence);
    document.addEventListener("visibilitychange", refreshFocusedPresence);

    socket.addEventListener("message", (event) => {
      let update: RoomSocketEvent;
      try {
        update = JSON.parse(event.data) as RoomSocketEvent;
      } catch (error) {
        console.error("Ignoring malformed room WebSocket event:", error);
        return;
      }

      if (update.type === "FRIEND_REQUEST_RECEIVED" && update.requester?.user_id) {
        setRealtimeToast({
          type: "friend",
          userId: update.requester.user_id,
          displayName: update.requester.display_name || "A Genie user",
        });
        void loadFriendsQueue();
        return;
      }

      if ((update.type === "INCOMING_CALL" || update.type === "INCOMING_CALL_INVITE") && update.inviter?.user_id) {
        setRealtimeToast({
          type: "call",
          userId: update.inviter.user_id,
          displayName: update.inviter.display_name || "A Genie friend",
          callId: update.call_id,
          roomId: update.room_id,
        });
        return;
      }

      if (update.type === "voice_session.started" && update.call_id) {
        if (update.is_rejoin) {
          socket.send(JSON.stringify({
            type: "USER_JOINED_CALL",
            call_id: update.call_id,
          }));
        }
        setActiveRoomVoiceCallId(update.call_id);
        setActiveRoomCallOwnerId(update.started_by || "");
        if (update.is_rejoin || update.started_by === roomIdentity) {
          setJoinedRoomVoiceCallId(update.call_id);
        }
        setVoiceCallStartedAt(update.started_at || new Date().toISOString());
        setVoiceCallParticipants((update.participants || []).map((participant) => ({
          id: participant.id,
          name: participant.name,
          email: "",
          avatarUrl: participant.avatar_url || undefined,
          role: "member",
          status: "active",
        })));
        setRemoteVoiceTurns([]);
        return;
      }

      if (update.type === "voice_session.turn" && update.call_id && update.turn_id && update.speaker) {
        if (!update.encrypted_payloads || !roomCryptoIdentity || !update.sender_id) {
          setChatError("A room voice turn could not be decrypted.");
          return;
        }
        void decryptRoomMessage(
          update.encrypted_payloads,
          roomCryptoIdentity,
          roomIdentity,
          update.sender_id,
          update.sender_public_key || {},
        ).then((text) => {
          const turn: VoiceCallTurn = {
            id: update.turn_id!,
            callId: update.call_id,
            userId: update.speaker!.id,
            userName: update.speaker!.name,
            userAvatar: update.speaker!.avatar_url || null,
            role: update.speaker!.role,
            text,
            timestamp: update.timestamp || new Date().toISOString(),
          };
          if (turn.role === "user") markVoiceSpeaker(turn.userId);
          setRemoteVoiceTurns((previous) =>
            previous.some((item) => item.id === turn.id) ? previous : [...previous, turn],
          );
        }).catch((error: unknown) => {
          console.error("Could not decrypt a room voice turn:", error);
          setChatError("A room voice turn could not be decrypted.");
        });
        return;
      }

      if (update.type === "voice_session.ended") {
        setActiveRoomVoiceCallId("");
        setActiveRoomCallOwnerId("");
        setJoinedRoomVoiceCallId("");
        setVoiceCallStartedAt(null);
        return;
      }

      if (update.type === "room_state") {
        if (update.policy) {
          setSpaceMode(update.policy.space_mode || (roomId.startsWith("invite_") ? "workspace" : "personal"));
          setHistoryVisibleBeforeJoin(Boolean(update.policy.history_visible_before_join));
          setAllowMemberExport(Boolean(update.policy.allow_member_export));
        }
        try {
          localStorage.setItem(
            `genie_room_passcode_${roomId}`,
            enteredRoomPasscode.trim() || roomPasscode
          );
        } catch (error) {
          console.error("Could not persist the authorized room passcode:", error);
        }
        if (Array.isArray(update.messages)) {
          const joinedMember = update.members?.find(
            (member) => (member.id || member.user_id) === roomIdentity,
          );
          const mayReadPriorHistory =
            Boolean(joinedMember?.is_origin_admin || joinedMember?.can_view_history);
          const joinedAt = joinedMember?.joined_at || "";
          const restoredMessages = (archivedRoomMessages[roomId] || []).filter((message) => {
            if (mayReadPriorHistory) return true;
            if (!message.timestamp || !joinedAt) return false;
            const messageTime = Date.parse(message.timestamp);
            const joinTime = Date.parse(joinedAt);
            return Number.isFinite(messageTime) && Number.isFinite(joinTime) && messageTime >= joinTime;
          });
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
              role: member.role || "member",
              status: member.status || "active",
              is_host: member.is_host,
              joined_at: member.joined_at,
              can_export: member.can_export,
              can_view_history: member.can_view_history,
              is_origin_admin: member.is_origin_admin,
            };
          }));
        }
        return;
      }

      if (update.type === "presence" && update.users) {
        const nextMembers: RoomMember[] = update.users.map((member) => ({
          id: member.id || member.user_id,
          name: member.display_name,
          email: member.email || "",
          avatarUrl: member.avatar_url,
          publicKey: member.public_key,
          role: member.role || "member",
          status: member.status || "active",
          is_host: member.is_host,
          joined_at: member.joined_at,
          can_export: member.can_export,
          can_view_history: member.can_view_history,
          is_origin_admin: member.is_origin_admin,
        }));
        setMembers(nextMembers);
        void publishPendingShareTranscript(nextMembers);
        return;
      }

      if (update.type === "message" && update.message) {
        void decodeRoomWireMessage(update.message)
          .then((message) => {
            const timestampedMessage = {
              ...message,
              timestamp: message.timestamp || new Date().toISOString(),
            };
            setRoomMessages((previous) => {
              const exists = previous.some((item) => item.id === timestampedMessage.id);
              if (update.action === "edit" || update.action === "delete") {
                return previous.map((item) => item.id === timestampedMessage.id ? timestampedMessage : item);
              }
              return exists ? previous : [...previous, timestampedMessage];
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
      window.removeEventListener("focus", refreshFocusedPresence);
      window.removeEventListener("blur", refreshFocusedPresence);
      document.removeEventListener("visibilitychange", refreshFocusedPresence);
      window.removeEventListener("pointerdown", markPresenceActivity);
      window.removeEventListener("keydown", markPresenceActivity);
      window.removeEventListener("touchstart", markPresenceActivity);
      if (roomHeartbeatRef.current !== null) {
        window.clearInterval(roomHeartbeatRef.current);
        roomHeartbeatRef.current = null;
      }
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
    if (!mounted || !isAuthenticated || (!isVipEligible && !vipClaimGranted)) {
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
        const response = await fetch(getBackendApiUrl("/api/vip/session"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${googleIdToken}`,
          },
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
        if (!response.ok) {
          if (active && action !== "release") {
            setIsVipSessionActive(false);
            setVipSessionLimitReached(false);
            setActiveVipSessionCount(0);
          }
          console.warn(
            result.detail || `VIP session request failed (${response.status}).`
          );
          return;
        }
        if (active && action !== "release") {
          setIsVipSessionActive(result.active === true);
          setVipSessionLimitReached(result.active === false);
          setActiveVipSessionCount(result.active_count || 0);
        }
      } catch (error) {
        if (active && action !== "release") {
          setIsVipSessionActive(false);
          setVipSessionLimitReached(false);
          setActiveVipSessionCount(0);
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
  }, [mounted, isAuthenticated, isVipEligible, vipClaimGranted, userProfile.email, googleIdToken, API_BASE]);

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
                avatarUrl: userProfileRef.current.avatarUrl || "genie-preset:neutral",
                googleAvatarUrl: data.picture || "",
                mobileNumber: "",
                recoveryEmail: "",
                allowRoomInvites: "mutual_friends" as const,
                isCreator: false,
                authProvider: "google" as const,
                providerId: data.sub || "",
                role: "professional" as const,
                profession: "Healthcare Revenue Cycle & Client Operations",
                ageGroup: "pro",
                gender: userProfileRef.current.gender || "",
                customApiKey: "",
                totpPasscode: "",
                socialHandle: "",
                socialAvatarUrl: "",
                socialProfileId: "",
              };

              const reauthenticating = registrationReauthRequiredRef.current;
              const sameGoogleAccount =
                reauthenticating && userProfileRef.current.providerId === updatedProfile.providerId;
              const profileToPersist = sameGoogleAccount
                ? {
                    ...userProfileRef.current,
                    email: updatedProfile.email,
                    googleAvatarUrl: updatedProfile.googleAvatarUrl,
                    avatarUrl: updatedProfile.avatarUrl,
                    authProvider: updatedProfile.authProvider,
                    providerId: updatedProfile.providerId,
                  }
                : updatedProfile;
              setUserProfile((prev) => ({ ...prev, ...profileToPersist }));
              setGoogleIdToken(response.credential);
              setIsAuthenticated(false);
              setRegistrationRequired(reauthenticating);
              setRegistrationError(null);
              setRegistrationReauthRequired(false);
              registrationReauthRequiredRef.current = false;
              if (!sameGoogleAccount) {
                setRegistrationTermsAccepted(false);
                setRegistrationPrivacyAccepted(false);
              }

              if (typeof window !== "undefined") {
                localStorage.setItem("genie_user_profile", JSON.stringify(profileToPersist));
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
          void fetch(getBackendApiUrl("/api/social/discovery"), {
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
   if (!googleIdToken) {
     setDiscoverableFriends([]);
     setSovereignRooms([]);
     setPendingFriendRequests([]);
     return;
   }
   setIsFriendsLoading(true);
   setFriendsQueueError(null);
   try {
     if (isCorporateDomain) {
       setDiscoverableFriends([]);
       setPendingFriendRequests([]);
       const roomsResponse = await fetch(getBackendApiUrl("/api/rooms"), {
         headers: { Authorization: `Bearer ${googleIdToken}` },
       });
       const roomResult = (await roomsResponse.json()) as { rooms?: SovereignRoomSummary[] } | SovereignRoomSummary[];
       if (!roomsResponse.ok) {
         throw new Error(`Tenant workspace directory could not be loaded (HTTP ${roomsResponse.status}).`);
       }
       setSovereignRooms(Array.isArray(roomResult) ? roomResult : roomResult.rooms || []);
       return;
     }
     const headers = { Authorization: `Bearer ${googleIdToken}` };
     const [friendsResponse, roomsResponse, requestsResponse] = await Promise.all([
       fetch(getBackendApiUrl("/api/social/friends"), { headers }),
       fetch(getBackendApiUrl("/api/rooms"), { headers }),
       fetch(getBackendApiUrl("/api/social/friend-requests"), { headers }),
     ]);
const [friendResult, roomResult, requestsResult] = await Promise.all([
      friendsResponse.ok ? friendsResponse.json().catch(() => ({ friends: [] })) : Promise.resolve({ friends: [] }),
      roomsResponse.ok ? roomsResponse.json().catch(() => ({ rooms: [] })) : Promise.resolve({ rooms: [] }),
      requestsResponse.ok ? requestsResponse.json().catch(() => ({ requests: [] })) : Promise.resolve({ requests: [] }),
    ]);
    setDiscoverableFriends(friendResult?.friends || []);
     setSovereignRooms(roomsResponse.ok ? roomResult.rooms || [] : []);
     setPendingFriendRequests(requestsResponse.ok ? requestsResult.requests || [] : []);
     const failedPolls = [
       !friendsResponse.ok && `Friends Queue (HTTP ${friendsResponse.status})`,
       !roomsResponse.ok && `Saved rooms (HTTP ${roomsResponse.status})`,
       !requestsResponse.ok && `Friend requests (HTTP ${requestsResponse.status})`,
     ].filter(Boolean);
     if (failedPolls.length) {
       setFriendsQueueError(`Some social data could not be loaded: ${failedPolls.join(", ")}.`);
     }
   } catch (error) {
     console.error("Friends Queue refresh failed:", error);
     setDiscoverableFriends([]);
     setSovereignRooms([]);
     setPendingFriendRequests([]);
     setFriendsQueueError(error instanceof Error ? error.message : "Could not refresh social presence.");
   } finally {
     setIsFriendsLoading(false);
   }
  }, [googleIdToken, isCorporateDomain]);

  async function respondToFriendRequest(request: PendingFriendRequest, accepted: boolean) {
    if (!googleIdToken) return;
    try {
      const response = await fetch(getBackendApiUrl("/api/social/friend-requests/respond"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          requester_id: request.user_id,
          response: accepted ? "accepted" : "declined",
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `Friend request could not be updated (HTTP ${response.status}).`);
      setPendingFriendRequests((previous) => previous.filter((item) => item.user_id !== request.user_id));
      await loadFriendsQueue();
    } catch (error) {
      console.error("Friend request response failed:", error);
      setFriendsQueueError(error instanceof Error ? error.message : "Friend request could not be updated.");
    }
  }

  async function respondToRealtimeFriendRequest(accepted: boolean) {
    if (!googleIdToken || !realtimeToast || realtimeToast.type !== "friend") return;
    try {
      const response = await fetch(getBackendApiUrl("/api/friends/respond"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          requester_id: realtimeToast.userId,
          status: accepted ? "ACCEPTED" : "REJECTED",
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Friend request could not be updated.");
      setRealtimeToast(null);
      await loadFriendsQueue();
    } catch (error) {
      console.error("Realtime friend request response failed:", error);
      setFriendsQueueError(error instanceof Error ? error.message : "Friend request could not be updated.");
    }
  }

  useEffect(() => {
    if (!isAuthenticated || !googleIdToken) return;
    void loadFriendsQueue();
    const intervalId = window.setInterval(() => void loadFriendsQueue(), 15000);
    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, googleIdToken, loadFriendsQueue]);

  const loadSocialInvites = useCallback(async () => {
    if (!googleIdToken || !isAuthenticated) {
      setSocialInvites([]);
      return;
    }
    try {
      const response = await fetch(getBackendApiUrl("/api/social/invites"), {
        headers: { Authorization: `Bearer ${googleIdToken}` },
      });
      const result = (await response.json()) as { invites?: SocialInvite[]; detail?: string };
      if (!response.ok) {
        setSocialInvites([]);
        setFriendsQueueError(
          result.detail || `Invitations could not be loaded (HTTP ${response.status}).`
        );
        return;
      }
      setSocialInvites(result.invites || []);
    } catch (error) {
      console.error("Social invitations refresh failed:", error);
      setSocialInvites([]);
      setFriendsQueueError(error instanceof Error ? error.message : "Invitations could not be loaded.");
    }
  }, [googleIdToken, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !googleIdToken) return;
    void loadSocialInvites();
    const intervalId = window.setInterval(() => void loadSocialInvites(), 15000);
    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, googleIdToken, loadSocialInvites]);

  async function sendRoomInvite(friend: DiscoverableFriend) {
    if (!googleIdToken || !isTeamMode || !roomId) {
      setFriendsQueueError("Start or join a room before inviting a friend.");
      return;
    }
    const inviteUrl = `${window.location.origin}/room/${roomId}`;
    try {
      if (roomId.startsWith("share_") || roomId.startsWith("invite_")) {
        await configureRoomInvitePermissions(
          roomId,
          roomId.startsWith("share_") ? "personal" : "workspace",
        );
      }
      const response = await fetch(getBackendApiUrl("/api/social/invites"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          recipient_id: friend.user_id,
          room_id: roomId,
          room_title: roomTitle,
          invite_url: inviteUrl,
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `Invitation could not be sent (HTTP ${response.status}).`);
      setFriendsQueueError(null);
    } catch (error) {
      console.error("In-app room invitation failed:", error);
      setFriendsQueueError(error instanceof Error ? error.message : "Invitation could not be sent.");
    }
  }

  async function respondToSocialInvite(invite: SocialInvite, accepted: boolean) {
    if (!googleIdToken) return;
    try {
      const response = await fetch(getBackendApiUrl(`/api/social/invites/${encodeURIComponent(invite.invite_id)}/respond`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ google_id_token: googleIdToken, status: accepted ? "accepted" : "declined" }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `Invitation could not be updated (HTTP ${response.status}).`);
      setSocialInvites((previous) => previous.filter((item) => item.invite_id !== invite.invite_id));
      if (accepted) router.push(`/room/${encodeURIComponent(invite.room_id)}`);
    } catch (error) {
      console.error("Social invitation response failed:", error);
      setFriendsQueueError(error instanceof Error ? error.message : "Invitation could not be updated.");
    }
  }

  async function searchForFriend(event: React.FormEvent) {
    event.preventDefault();
    if (!googleIdToken || !friendSearchEmail.trim()) return;
    setFriendSearchBusy(true);
    setFriendSearchResult(null);
    setFriendSearchNotFound(false);
    try {
      const response = await fetch(
        getBackendApiUrl(`/api/social/search?query=${encodeURIComponent(friendSearchEmail.trim())}`),
        { headers: { Authorization: `Bearer ${googleIdToken}` } }
      );
      const result = (await response.json()) as {
        found?: boolean;
        users?: DiscoverableFriend[];
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail || `Friend search failed (HTTP ${response.status}).`);
      if (result.users?.length) {
        setFriendSearchResult(result.users[0]);
      } else {
        setFriendSearchNotFound(true);
      }
    } catch (error) {
      console.error("Friend search failed:", error);
      setFriendsQueueError(error instanceof Error ? error.message : "Friend search failed.");
    } finally {
      setFriendSearchBusy(false);
    }
  }

  async function searchOmniDirectory(event: React.FormEvent) {
    event.preventDefault();
    const requestToken = googleIdToken || getLocalDevelopmentToken();
    if (omniSearchQuery.trim().length < 2) return;
    if (!requestToken) {
      setOmniSearchResults([]);
      setOmniSearchError("Sign in again to search the directory.");
      return;
    }
    setOmniSearchBusy(true);
    setOmniSearchError(null);
    setOmniSearchNotFound(false);
    setOmniSearchResults([]);
    try {
      const response = await fetch(
        getBackendApiUrl(`/api/social/search?query=${encodeURIComponent(omniSearchQuery.trim())}`),
        { headers: { Authorization: `Bearer ${requestToken}` } }
      );
      const result = (await response.json()) as { users?: DiscoverableFriend[]; detail?: string };
      if (!response.ok) {
        throw new Error(result.detail || `Directory search failed (HTTP ${response.status}).`);
      }
      const users = Array.isArray(result.users) ? result.users : [];
      setOmniSearchResults(users);
      setOmniSearchNotFound(users.length === 0);
    } catch (error) {
      console.error("Omni-search failed:", error);
      setOmniSearchResults([]);
      setOmniSearchNotFound(false);
      setOmniSearchError(
        error instanceof Error
          ? error.message
          : "Directory search could not be completed. Please try again."
      );
    } finally {
      setOmniSearchBusy(false);
    }
  }

  async function sendOnboardingInviteEmail(email: string) {
    if (!googleIdToken) return;
    setInviteEmailBusy(true);
    setInviteEmailStatus(null);
    try {
      const response = await fetch(getBackendApiUrl("/api/invite/email"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ google_id_token: googleIdToken, email }),
      });
      const result = (await response.json()) as { success?: boolean; simulated?: boolean; detail?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.detail || `Invitation could not be dispatched (HTTP ${response.status}).`);
      }
      setInviteEmailStatus(`Invitation email dispatched to ${email}!`);
    } catch (error) {
      console.error("Registration invitation failed:", error);
      setOmniSearchError(error instanceof Error ? error.message : "Invitation could not be sent.");
    } finally {
      setInviteEmailBusy(false);
    }
  }

  async function updateSocialRelationship(friend: DiscoverableFriend, action: "follow" | "friend-request") {
    if (!googleIdToken) return;
    const endpoint = action === "follow" ? "/api/social/follow" : "/api/social/friend-requests";
    try {
      const response = await fetch(getBackendApiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ google_id_token: googleIdToken, target_user_id: friend.user_id }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `Relationship could not be updated (HTTP ${response.status}).`);
      setOmniSearchError(null);
      if (omniSearchQuery.trim()) {
        const searchResponse = await fetch(
          getBackendApiUrl(`/api/social/search?query=${encodeURIComponent(omniSearchQuery.trim())}`),
          { headers: { Authorization: `Bearer ${googleIdToken}` } }
        );
        const searchResult = (await searchResponse.json()) as { users?: DiscoverableFriend[] };
        if (!searchResponse.ok) throw new Error("Updated relationship status could not be loaded.");
        setOmniSearchResults(searchResult.users || []);
      }
      if (friendSearchEmail.trim()) {
        const searchResponse = await fetch(
          getBackendApiUrl(`/api/social/search?query=${encodeURIComponent(friendSearchEmail.trim())}`),
          { headers: { Authorization: `Bearer ${googleIdToken}` } }
        );
        const searchResult = (await searchResponse.json()) as { users?: DiscoverableFriend[] };
        if (!searchResponse.ok) throw new Error("Updated relationship status could not be loaded.");
        setFriendSearchResult(searchResult.users?.[0] || null);
      }
      await loadFriendsQueue();
    } catch (error) {
      console.error("Social relationship update failed:", error);
      setOmniSearchError(error instanceof Error ? error.message : "Relationship could not be updated.");
    }
  }

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
    setTopicError(null);
    const createLocalTopic = (): TopicChannel | null => {
      const existingIds = new Set(topics.map((topic) => topic.id));
      const id = Array.from({ length: 10 }, (_, index) => `topic_${index + 1}`).find((item) => !existingIds.has(item));
      return id ? { id, title, icon, messages: [] } : null;
    };
    try {
      let newTopic: TopicChannel;
      const token = googleIdToken || getLocalDevelopmentToken();
      if (isAuthenticated && token && userProfile.providerId) {
        const response = await fetch(getBackendApiUrl("/api/personal/topics/create"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + (token || "dev-token-local-bypass"),
          },
          body: JSON.stringify({
            google_id_token: token || "dev-token-local-bypass",
            user_id: userProfile.providerId,
            title,
            icon,
          }),
        });
        const result = response.status === 401
          ? {}
          : (await response.json()) as { topic?: TopicChannel; detail?: string };
        const authenticationFailed =
          response.status === 401 ||
          result.detail?.includes("Google sign-in could not be verified");
        if (authenticationFailed) {
          console.warn("Topic channel authentication could not be verified; creating a local topic session.", result.detail);
          const localTopic = createLocalTopic();
          if (!localTopic) return;
          newTopic = localTopic;
        } else if (!response.ok || !result.topic) {
          setTopicError(result.detail || `Topic could not be created (HTTP ${response.status}).`);
          return;
        } else {
          newTopic = result.topic;
        }
      } else {
        const localTopic = createLocalTopic();
        if (!localTopic) return;
        newTopic = localTopic;
      }
      setTopics((previous) => [...previous, newTopic]);
      setActiveTopicId(newTopic.id);
      setIsTopicConversation(true);
      setIsTeamMode(false);
      setPrompt("");
    } catch (error) {
      console.error("Topic channel creation failed:", error);
      setTopicError(
        error instanceof Error
          ? error.message
          : "Topic channel could not be created. Please try again."
      );
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
        const response = await fetch(getBackendApiUrl(`/api/personal/topics/${encodeURIComponent(topic.id)}`), {
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
    if (isObserverActive) {
      console.warn("Topic history deletion rejected: Observer mode is active.");
      return;
    }
    if (!window.confirm(`Clear all messages in "${topic.title}"? Other topic channels will not be changed.`)) return;
    try {
      if (isAuthenticated && googleIdToken && userProfile.providerId) {
        const response = await fetch(
          getBackendApiUrl(`/api/personal/topics/${encodeURIComponent(topic.id)}/clear`),
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
      await configureRoomInvitePermissions(
        sharedRoomId,
        "personal",
        `${session.title} · Shared Personal Room`,
      );
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
      createdAt: new Date().toISOString(),
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
        getBackendApiUrl(`/api/friends/blocked-list?user_id=${encodeURIComponent(userProfile.providerId)}`),
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
      const response = await fetch(getBackendApiUrl("/api/friends/block"), {
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
      const response = await fetch(getBackendApiUrl("/api/friends/unblock"), {
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
     const response = await fetch(getBackendApiUrl("/api/social/direct-room"), {
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
     const response = await fetch(getBackendApiUrl("/api/social/discovery"), {
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
       const response = await fetch(getBackendApiUrl("/api/social/discovery"), {
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
   if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
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
    if (
      !mounted ||
      registrationBusy ||
      !userProfile.email.trim() ||
      isOwner !== true ||
      !googleIdToken ||
      !userProfile.providerId
    ) return;
    setArchiveError(null);
    setIsArchiveLoading(true);
    try {
      const response = await fetch(
        getBackendApiUrl(`/api/archive/manifest?user_id=${encodeURIComponent(userProfile.providerId)}`),
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
    console.warn("Archive manifest inaccessible:", manifest?.detail);
    return;
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
      const response = await fetch(getBackendApiUrl("/api/archive/save"), {
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
      const response = await fetch(getBackendApiUrl("/api/archive/restore"), {
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
      localStorage.removeItem("genie_session_token");
      localStorage.removeItem("genie_local_registration_fallback");
      localStorage.removeItem(`genie_vip_claimed_${userProfile.email.toLowerCase()}`);
      sessionStorage.removeItem("genie_google_id_token");
      if ((window as any).google?.accounts?.id) {
        (window as any).google.accounts.id.disableAutoSelect();
        (window as any).__gsi_auth_active = false;
      }
    }
    setIsAuthenticated(false);
    setVipClaimGranted(false);
    setIsRoomUnlocked(false);
    setRegistrationRequired(false);
    setRegistrationReauthRequired(false);
    registrationReauthRequiredRef.current = false;
    setRegistrationError(null);
    setRegistrationTermsAccepted(false);
    setRegistrationPrivacyAccepted(false);
    setAuthenticatorEnabled(false);
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
      mobileNumber: "",
      mobileVerified: false,
      recoveryEmail: "",
      allowRoomInvites: "mutual_friends",
      isCreator: false,
      avatarUrl: "",
      googleAvatarUrl: "",
      role: "professional",
      preferredVoice: "Aoede",
      profession: "Healthcare Revenue Cycle & Client Operations",
      institution: "",
      studyFocus: "",
      studyLevel: "",
      ageGroup: "pro",
      gender: "",
      customApiKey: "",
      totpPasscode: "",
      totpEnabled: false,
      authProvider: "",
      providerId: "",
      socialHandle: "",
      socialAvatarUrl: "",
      socialProfileId: "",
      isDiscoverable: false,
    });
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
    roomSocketRef.current?.close(1000, "Left the room.");
    roomSocketRef.current = null;
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

  const loadTrash = useCallback(async () => {
    if (!googleIdToken || !isAuthenticated) return;
    try {
      const response = await fetch(getBackendApiUrl("/api/trash/conversations"), {
        headers: { Authorization: `Bearer ${googleIdToken}` },
      });
      const result = (await response.json()) as {
        conversations?: { conversation: ChatSession; deleted_at: string }[];
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail || `Trash could not be loaded (HTTP ${response.status}).`);
      setTrashSessions((result.conversations || []).map(({ conversation, deleted_at }) => ({
        ...conversation,
        isDeleted: true,
        deletedAt: deleted_at,
        deletedBy: conversation.deletedBy || userProfile.name,
      })));
    } catch (error) {
      console.error("Trash load failed:", error);
      setChatError(error instanceof Error ? error.message : "Recently deleted conversations could not be loaded.");
    }
  }, [API_BASE, googleIdToken, isAuthenticated, userProfile.name]);

  useEffect(() => {
    if (trashOpen && isAuthenticated) void loadTrash();
  }, [trashOpen, isAuthenticated, loadTrash]);

  async function softDeleteSession(session: ChatSession) {
    if (isObserverActive) {
      console.warn("Session deletion rejected: Observer mode is active.");
      return;
    }
    const deletedAt = new Date().toISOString();
    const deleted = { ...session, isDeleted: true, deletedAt, deletedBy: userProfile.name };
    if (googleIdToken && isAuthenticated) {
      try {
        const response = await fetch(getBackendApiUrl("/api/trash/conversations"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ google_id_token: googleIdToken, conversation: deleted, deleted_at: deletedAt }),
        });
        const result = (await response.json()) as { detail?: string };
        if (!response.ok) {
    console.warn("Could not delete conversation from server:", result.detail);
    return;
}
      } catch (error) {
        console.error("Cloud conversation deletion failed:", error);
        setChatError(error instanceof Error ? error.message : "Conversation could not be moved to trash.");
        return;
      }
    }
    const activeSessions = sessions.filter((item) => !item.isDeleted && item.id !== session.id);
    setSessions((previous) => previous.map((item) => item.id === session.id ? deleted : item));
    setTrashSessions((previous) => [deleted, ...previous.filter((item) => item.id !== session.id)]);
    if (currentSessionId === session.id && activeSessions.length) {
      const replacement = activeSessions[0];
      setCurrentSessionId(replacement.id);
      setIsTopicConversation(Boolean(replacement.topicId));
      setPersonalMessages(ensureMessageTimestamps(replacement.messages));
    } else if (currentSessionId === session.id) {
      const replacement: ChatSession = { id: Date.now().toString(), title: "New Session", isPinned: false, messages: [], createdAt: new Date().toISOString() };
      setSessions((previous) => [replacement, ...previous]);
      setCurrentSessionId(replacement.id);
      setIsTopicConversation(false);
      setPersonalMessages([]);
    }
  }

  async function restoreSession(session: ChatSession) {
    let restored: ChatSession = { ...session, isDeleted: false };
    delete restored.deletedAt;
    delete restored.deletedBy;
    if (googleIdToken && isAuthenticated) {
      try {
        const response = await fetch(
          getBackendApiUrl(`/api/trash/conversations/${encodeURIComponent(session.id)}/restore`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ google_id_token: googleIdToken }),
          }
        );
        const result = (await response.json()) as { conversation?: ChatSession; detail?: string };
        if (!response.ok || !result.conversation) {
          throw new Error(result.detail || `Conversation could not be restored (HTTP ${response.status}).`);
        }
        restored = result.conversation;
      } catch (error) {
        console.error("Cloud conversation restore failed:", error);
        setChatError(error instanceof Error ? error.message : "Conversation could not be restored.");
        return;
      }
    }
    setSessions((previous) => previous.some((item) => item.id === restored.id)
      ? previous.map((item) => item.id === restored.id ? restored : item)
      : [restored, ...previous]);
    setTrashSessions((previous) => previous.filter((item) => item.id !== session.id));
    setCurrentSessionId(restored.id);
    setIsTopicConversation(Boolean(restored.topicId));
    setPersonalMessages(ensureMessageTimestamps(restored.messages));
    setIsTeamMode(false);
  }

  async function permanentlyDeleteSession(session: ChatSession) {
    if (isObserverActive) {
      console.warn("Permanent session deletion rejected: Observer mode is active.");
      return;
    }
    try {
      const requestToken = googleIdToken || getLocalDevelopmentToken();
      if (requestToken && isAuthenticated && requestToken !== "dev-token-local-bypass") {
        const response = await fetch(
          getBackendApiUrl(`/api/trash/conversations/${encodeURIComponent(session.id)}`),
          { method: "DELETE", headers: { Authorization: `Bearer ${requestToken}` } }
        );
        const result = (await response.json()) as { detail?: string };
        if (!response.ok) {
          throw new Error(
            result.detail || `Conversation could not be permanently deleted (HTTP ${response.status}).`
          );
        }
      }
      setTrashSessions((previous) => previous.filter((item) => item.id !== session.id));
      setSessions((previous) => previous.filter((item) => item.id !== session.id));
    } catch (error) {
      console.error("Permanent conversation deletion failed:", error);
      setChatError(
        error instanceof Error
          ? error.message
          : "Conversation could not be permanently deleted."
      );
    }
  }

  async function configureRoomInvitePermissions(
    targetRoomId: string,
    mode: "personal" | "workspace",
    title = roomTitle,
  ) {
    if (!googleIdToken || !roomCryptoIdentity || !targetRoomId.startsWith(mode === "personal" ? "share_" : "invite_")) {
      return;
    }
    const response = await fetch(getBackendApiUrl("/api/rooms/configure"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        google_id_token: googleIdToken,
        room_id: targetRoomId,
        title: title || (mode === "personal" ? "Personal Room" : "Workspace"),
        passcode: roomPasscode,
        space_mode: mode,
        history_visible_before_join: historyVisibleBeforeJoin,
        allow_member_export: mode === "workspace" && allowMemberExport,
        public_key: roomCryptoIdentity.publicKey,
      }),
    });
    const result = (await response.json()) as { detail?: string };
    if (!response.ok) {
      throw new Error(result.detail || `Room permissions could not be saved (HTTP ${response.status}).`);
    }
  }

  async function copyHeaderInvite(mode: "personal" | "workspace") {
    if (isCorporateDomain && mode !== "workspace") {
      setSecurityToast("Corporate SSO accounts cannot create Personal rooms.");
      return;
    }
    if (!googleIdToken || !isAuthenticated || !roomCryptoIdentity) {
      setChatError("Sign in and wait for secure room setup before sharing a room.");
      return;
    }
    const roomPrefix = mode === "personal" ? "share_" : "invite_";
    const createNewRoom = !(
      isTeamMode &&
      roomId.startsWith(roomPrefix) &&
      canManageRoomPolicy
    );
    const inviteRoomId = createNewRoom
      ? `${roomPrefix}${window.crypto.randomUUID().replaceAll("-", "")}`
      : roomId;
    const inviteUrl = `${window.location.origin}/room/${inviteRoomId}`;
    try {
      const inviteRoomTitle = createNewRoom
        ? mode === "personal"
          ? `${userProfile.name}'s Private Personal Room`
          : "Workspace Session"
        : roomTitle;
      await configureRoomInvitePermissions(inviteRoomId, mode, inviteRoomTitle);
      await navigator.clipboard.writeText(inviteUrl);
      if (!createNewRoom) {
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2500);
        setChatError(null);
        return;
      }
      shareTranscriptRef.current = messages.filter((message) => !message.is_deleted).map((message) => ({ ...message }));
      shareTranscriptOwnerRef.current = roomIdentity;
      shareTranscriptSentRef.current = false;
      setRoomId(inviteRoomId);
      setRoomTitle(inviteRoomTitle);
      setRoomMessages([]);
      setMembers([]);
      setRoomPasscode("842-109");
      setEnteredRoomPasscode("842-109");
      setRoomPasscodeRoomId(inviteRoomId);
      setIsRoomUnlocked(true);
      setIsTeamMode(true);
      setSpaceMode(mode);
      if (mode === "personal") {
        setRoomCapacityMode("custom");
        setCustomRoomCapacity(5);
      }
      else {
        setRoomCapacityMode("custom");
        setCustomRoomCapacity(5);
      }
      setIsObserverActive(false);
      setChatError(null);
    } catch (error) {
      console.error("Room invite link could not be copied:", error);
      setChatError(error instanceof Error ? error.message : "The invite link could not be copied.");
    }
  }

  async function changeRoomMember(memberId: string, action: "remove" | "transfer-host") {
    if (!isCurrentRoomHost || !googleIdToken) {
      setChatError("Only the authenticated room host can change room membership.");
      return;
    }
    const path = action === "remove"
      ? `/api/rooms/${encodeURIComponent(roomId)}/members/remove`
      : `/api/rooms/${encodeURIComponent(roomId)}/transfer-host`;
    try {
      const response = await fetch(getBackendApiUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          ...(action === "remove" ? { member_id: memberId } : { new_host_id: memberId }),
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(result.detail || `Room ${action} failed (HTTP ${response.status}).`);
      }
      if (action === "remove") {
        setMembers((previous) => previous.filter((member) => member.id !== memberId));
      } else {
        setMembers((previous) => previous.map((member) => ({
          ...member,
          is_host: member.id === memberId,
          role: member.id === memberId
            ? member.is_origin_admin ? "origin_admin" : "delegated_admin"
            : member.is_origin_admin ? "origin_admin" : "member",
        })));
      }
      setChatError(null);
    } catch (error) {
      console.error(`Room member ${action} failed:`, error);
      setChatError(error instanceof Error ? error.message : `Room member ${action} failed.`);
    }
  }

  async function authorizeCurrentRoomExport(includeVoiceLogs = false): Promise<boolean> {
    if (!isTeamMode) return true;
    if (!googleIdToken) {
      setChatError("Sign in is required to authorize a room export.");
      return false;
    }
    try {
      const response = await fetch(
        getBackendApiUrl(`/api/rooms/${encodeURIComponent(roomId)}/authorize-export`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            google_id_token: googleIdToken,
            include_voice_logs: includeVoiceLogs,
          }),
        },
      );
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) {
        setChatError(result.detail || `Room export is not authorized (HTTP ${response.status}).`);
        return false;
      }
      return true;
    } catch (error) {
      console.error("Room export authorization failed:", error);
      setChatError(error instanceof Error ? error.message : "Room export authorization failed.");
      return false;
    }
  }

  async function exportRoomTranscript(format: "md" | "json") {
    const hasVoiceLogs = messages.some((message) =>
      message.isVoiceRecord || message.isVoiceSessionSummary || message.isCallRecord,
    );
    const canExportVoiceLogs = spaceMode === "personal"
      ? isCurrentRoomHost
      : isCurrentRoomOriginAdmin;
    if (!(await authorizeCurrentRoomExport(hasVoiceLogs && canExportVoiceLogs))) return;
    const transcript = messages.filter((message) =>
      !message.is_deleted &&
      !(
        hasVoiceLogs &&
        spaceMode === "workspace" &&
        !isCurrentRoomOriginAdmin &&
        (message.isVoiceRecord || message.isVoiceSessionSummary || message.isCallRecord)
      ),
    );
    const content = format === "json"
      ? JSON.stringify({ room_id: roomId, room_title: roomTitle, exported_at: new Date().toISOString(), messages: transcript }, null, 2)
      : `# ${roomTitle}\n\n${transcript.map((message) => {
          const timestamp = new Date(message.timestamp || Date.now()).toLocaleString();
          const author = message.senderName || (message.role === "assistant" ? "Genie" : "User");
          return `## ${author} · ${timestamp}\n\n${message.content}`;
        }).join("\n\n---\n\n")}`;
    const blob = new Blob([content], {
      type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${roomTitle.replace(/[^\w-]+/g, "_") || "genie-room"}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportCurrentSessionTranscript(format: "markdown" | "json"): Promise<boolean> {
    if (!(await authorizeCurrentRoomExport())) return false;
    if (!currentSession) return false;
    const transcript = messages.filter((message) => !message.is_deleted);
    const content = format === "json"
      ? JSON.stringify({
          session_id: currentSession.id,
          title: currentSession.title,
          created_at: currentSession.createdAt || transcript[0]?.timestamp || null,
          exported_at: new Date().toISOString(),
          messages: transcript,
        }, null, 2)
      : `# ${currentSession.title}\n\n${transcript.map((message) => {
          const timestamp = message.timestamp
            ? new Date(message.timestamp).toLocaleString()
            : "";
          const author = message.senderName || (message.role === "assistant" ? "Genie" : "You");
          return `## ${author}${timestamp ? ` · ${timestamp}` : ""}\n\n${message.content}`;
        }).join("\n\n---\n\n")}`;
    const blob = new Blob([content], {
      type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${currentSession.title.replace(/[^\w-]+/g, "_") || "genie-session"}.${format === "markdown" ? "md" : "json"}`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }

  async function exportSessionDocument(
    format: "pdf" | "docx",
    selectedOnly: boolean,
    selectedIds: Set<string> = selectedMessageIds,
    sourceMessages: Message[] = messages,
    titleOverride?: string,
  ) {
    if (!(await authorizeCurrentRoomExport())) return;
    if (!currentSession && !titleOverride) return;
    const title = titleOverride || currentSession?.title || "Genie Session";
    const exportTimestamp = new Date();
    const transcript = sourceMessages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => !message.is_deleted)
      .filter(({ message, index }) =>
        !selectedOnly || selectedIds.has(getMessageSelectionId(message, index))
      );
    if (selectedOnly && transcript.length === 0) return;

    const escapeHtml = (value: string) =>
      value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] || character);
    const createdAt = currentSession?.createdAt || transcript[0]?.message.timestamp || "";
    const messageMarkup = transcript.map(({ message }) => {
      const role = message.role === "assistant" ? "Genie Pro" : "User";
      const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : "";
      return `<article><h2>${escapeHtml(role)}${timestamp ? ` <span>· ${escapeHtml(timestamp)}</span>` : ""}</h2><p>${escapeHtml(message.content).replace(/\r?\n/g, "<br>")}</p></article>`;
    }).join("\n");
    const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      body{font:11pt/1.55 Arial,sans-serif;color:#172033;margin:36px}
      header{border-bottom:2px solid #4f46e5;padding-bottom:14px;margin-bottom:22px}
      h1{font-size:22pt;margin:0 0 8px}header p{margin:3px 0;color:#64748b;font-size:9pt}
      article{page-break-inside:avoid;margin:0 0 18px;padding:0 0 14px;border-bottom:1px solid #e2e8f0}
      h2{font-size:11pt;margin:0 0 6px;color:#3730a3}h2 span{font-weight:normal;color:#64748b;font-size:9pt}
      article p{margin:0;white-space:normal}
      @media print{body{margin:18mm}article{page-break-inside:avoid}}
    </style></head><body><header><h1>${escapeHtml(title)}</h1><p>Created: ${escapeHtml(createdAt ? new Date(createdAt).toLocaleString() : "Unknown")}</p><p>Exported: ${escapeHtml(exportTimestamp.toLocaleString())}</p></header>${messageMarkup}</body></html>`;
    const baseName = title.replace(/[^\w-]+/g, "_") || "genie-session";

    if (format === "pdf") {
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        setChatError("The PDF print window was blocked. Allow pop-ups and try again.");
        return;
      }
      printWindow.document.open();
      printWindow.document.write(documentHtml);
      printWindow.document.close();
      window.setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 250);
      return;
    }

    const blob = createDocxBlob(
      title,
      createdAt,
      exportTimestamp,
      transcript.map(({ message }) => ({ message })),
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}.docx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function beginMessageSelection(format: "pdf" | "docx") {
    setSelectedExportFormat(format);
    setSelectedMessageIds(new Set());
    setIsSelectionMode(true);
  }

  async function completeMessageSelectionExport() {
    if (selectedMessageIds.size === 0) return;
    await exportSessionDocument(selectedExportFormat, true, selectedMessageIds);
    cancelMessageSelection();
  }

  async function exportActiveChat(format: "markdown" | "json") {
    if (isTeamMode) await exportRoomTranscript(format === "markdown" ? "md" : "json");
    else await exportCurrentSessionTranscript(format);
  }

  function downloadChatVaultBackup() {
    if (!canExportActiveChat) {
      setChatError(exportDisabledReason);
      return;
    }
    const backup = {
      version: 2,
      exported_at: new Date().toISOString(),
      sessions,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Genie_Chat_Vault_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function wipeRoomForAll() {
    if (!isCurrentRoomHost) {
      setChatError("Only the room host can wipe this chat.");
      return;
    }
    if (sendRoomEvent({ type: "room.wipe" })) setRoomAdminOpen(false);
  }

  async function endActiveRoom() {
    if (!googleIdToken || !roomId) return;
    try {
      const response = await fetch(getBackendApiUrl(`/api/rooms/${encodeURIComponent(roomId)}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${googleIdToken}` },
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `Session could not be ended (HTTP ${response.status}).`);
      roomSocketRef.current?.close(1000, "Host ended the session.");
      roomSocketRef.current = null;
      setMembers([]);
      setRoomMessages([]);
      handleExitRoomToPersonal();
    } catch (error) {
      console.error("Room end failed:", error);
      setChatError(error instanceof Error ? error.message : "Session could not be ended.");
    }
  }

  const executePasscodeRegeneration = async () => {
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    const formatted = `${newCode.slice(0, 3)}-${newCode.slice(3)}`;
    if (!googleIdToken) {
      setChatError("Google sign-in is required to change the sovereign room passcode.");
      return;
    }
    try {
      const response = await fetch(getBackendApiUrl("/api/rooms/passcode"), {
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

  function persistActivePersonalTranscript() {
    if (isTeamMode || typeof window === "undefined") return;
    const transcript = ensureMessageTimestamps(personalMessages);
    try {
      if (isTopicConversation && activeTopic) {
        const nextTopics = topics.map((topic) =>
          topic.id === activeTopic.id
            ? { ...topic, messages: transcript, message_count: transcript.length }
            : topic
        );
        setTopics(nextTopics);
        if (topicsStorageOwner) {
          localStorage.setItem(`genie_topics_v1_${topicsStorageOwner}`, JSON.stringify(nextTopics.slice(0, 10)));
        }
      } else if (currentSession) {
        const nextSessions = sessions.map((session) =>
          session.id === currentSession.id ? { ...session, messages: transcript } : session
        );
        setSessions(nextSessions);
        localStorage.setItem("genie_chat_sessions_v2", JSON.stringify(nextSessions));
      }
    } catch (error) {
      console.error("Active conversation could not be saved before switching modes:", error);
      setChatError("The active conversation could not be saved in this browser.");
    }
  }

  const handleSpaceModeChange = (mode: "personal" | "workspace") => {
    if (isCorporateDomain && mode !== "workspace") {
      setSecurityToast("Corporate SSO accounts are restricted to their organization workspace.");
      return;
    }
    if (isTeamMode) {
      setArchivedRoomMessages((previous) => ({
        ...previous,
        [roomId]: ensureMessageTimestamps(roomMessages),
      }));
    } else {
      persistActivePersonalTranscript();
    }
    setSpaceMode(mode);
  };

  const handleToggleTeamMode = () => {
    const isTenantWorkspaceRoom = sovereignRooms.some((room) => room.room_id === roomId);
    if (isCorporateDomain) {
      if (!isTeamMode || !isTenantWorkspaceRoom) {
        setSecurityToast("Corporate SSO accounts must remain in a tenant-scoped Workspace room.");
      }
      return;
    }
    if (isTeamMode) {
      setArchivedRoomMessages((previous) => ({
        ...previous,
        [roomId]: ensureMessageTimestamps(roomMessages),
      }));
    } else {
      persistActivePersonalTranscript();
    }
    const nextState = !isTeamMode;
    setIsTeamMode(nextState);
    if (!nextState) setIsObserverActive(false);
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
      user_email: "rshaji93@gmail.com",
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
      if (roomId.startsWith("invite_") || roomId.startsWith("share_")) {
        await configureRoomInvitePermissions(
          roomId,
          roomId.startsWith("share_") ? "personal" : "workspace",
        );
      }
      const response = await fetch(getBackendApiUrl("/api/room/send-invites"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") || localStorage.getItem("auth_token") || ""}`,
        },
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

  const copyRoomInvite = async () => {
    const shareUrl = `${window.location.origin}/?room=${roomId}`;
    try {
      if (roomId.startsWith("share_") || roomId.startsWith("invite_")) {
        await configureRoomInvitePermissions(roomId, roomId.startsWith("share_") ? "personal" : "workspace");
      }
      await navigator.clipboard.writeText(shareUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2500);
    } catch (error) {
      console.error("Room invite link could not be copied:", error);
      setChatError(error instanceof Error ? error.message : "Room invite link could not be copied.");
    }
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

  async function testByokKey() {
    const key = byokApiKey.trim();
    if (!key) {
      setByokError("Paste a Gemini API key before testing it.");
      return;
    }
    setByokTesting(true);
    setByokVerified(false);
    setByokError(null);
    setByokStatus("Testing Gemini API key...");
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        { cache: "no-store" },
      );
      if (response.status !== 200) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(result.error?.message || `Gemini rejected the API key (HTTP ${response.status}).`);
      }
      setByokVerified(true);
      setByokStatus("🟢 Active");
    } catch (error) {
      console.error("Gemini API key verification failed:", error);
      setByokError(error instanceof Error ? error.message : "Gemini API key verification failed.");
      setByokStatus("Key not verified");
    } finally {
      setByokTesting(false);
    }
  }

  function saveByokKey() {
    if (!byokVerified || !byokApiKey.trim()) return;
    try {
      localStorage.setItem("genie_user_byok_key", byokApiKey.trim());
      setByokApiKey(byokApiKey.trim());
      setByokStatus("🟢 Active");
      setByokError(null);
    } catch (error) {
      console.error("Gemini API key could not be saved on this device:", error);
      setByokError("Gemini API key could not be saved in this browser.");
    }
  }

  function removeByokKey() {
    try {
      localStorage.removeItem("genie_user_byok_key");
      setByokApiKey("");
      setByokVerified(false);
      setByokStatus(null);
      setByokError(null);
    } catch (error) {
      console.error("Gemini API key could not be removed from this device:", error);
      setByokError("Gemini API key could not be removed from this browser.");
    }
  }

  async function handlePlayAudio(content: string, messageId: string) {
    const requestId = ++audioRequestIdRef.current;
    const targetLocale = getSpeechLocale(content, selectedLang.code);
    setBufferingAudioId(messageId);
    setPlayingAudioId(null);
    try {
      const audio = await playRegionalAudio(
        content,
        targetLocale.split("-")[0],
        (playing) => {
          if (requestId === audioRequestIdRef.current) {
            setPlayingAudioId(playing ? messageId : null);
          }
        },
      );
      if (requestId !== audioRequestIdRef.current) {
        stopActiveRegionalAudio();
        return;
      }
      if (!audio) return;
      setPlayingAudioId(messageId);
      const clearPlayingState = () => {
        if (requestId === audioRequestIdRef.current) setPlayingAudioId(null);
      };
      audio.addEventListener("ended", clearPlayingState, { once: true });
      audio.addEventListener("error", clearPlayingState, { once: true });
    } catch (error) {
      console.error("Server-side speech synthesis failed:", error);
      setChatError("Speech synthesis is temporarily unavailable. Please try again.");
    } finally {
      if (requestId === audioRequestIdRef.current) setBufferingAudioId(null);
    }
  }

  const handleReloadMessage = (message: Message, index: number) => {
    if (message.role !== "assistant") return;
    const promptMessage = [...messages.slice(0, index)].reverse().find((item) => item.role === "user");
    if (promptMessage) {
      void handleSendMessage(undefined, false, promptMessage.content);
    }
  };

  async function submitVoiceCallTurn(transcript: string): Promise<VoiceCallTurnResult | null> {
    const isAdmin = isMasterAdmin;
    const userSpeechText = transcript.trim();
    const activeDialect = selectedLang.label;
    if (!canAccessVoiceCall()) {
      const errorMessage = !isObserverActive
        ? "Voice calls are available only while Observer Mode is ON."
        : "Live Voice Calls are exclusive to BYOK users. Please add your Gemini API key in Settings > BYOK to start voice calls.";
      console.warn("Voice call turn rejected: access requirements were not met.");
      setChatError(errorMessage);
      return null;
    }

    let apiKey = "";
    let requestToken = googleIdToken;
    try {
      apiKey = localStorage.getItem("genie_user_byok_key")?.trim() || "";
      const storedSessionToken = localStorage.getItem("genie_session_token") || "";
      requestToken = storedSessionToken === "dev-token-local-bypass"
        ? storedSessionToken
        : googleIdToken || storedSessionToken;
    } catch (error) {
      console.warn("Saved voice-call credentials could not be read:", error);
    }
    const history = (isTeamMode ? roomMessages : messages)
      .filter((message) => !message.is_deleted)
      .slice(-8)
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
    const requestContents = [
      ...history,
      { role: "user", parts: [{ text: userSpeechText }] },
    ];
    const systemText = "Respond naturally and concisely to the live spoken turn.";

    setIsStreaming(true);
    try {
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (requestToken) authHeaders.Authorization = `Bearer ${requestToken}`;

      let audioResponse: Response;
      try {
        audioResponse = await fetch(getBackendApiUrl("/api/voice/direct-turn"), {
          method: "POST",
          credentials: "include",
          headers: authHeaders,
          body: JSON.stringify({
            user_email: "rshaji93@gmail.com",
            google_id_token: requestToken,
            user_byok_key: apiKey || null,
            transcript: userSpeechText,
            dialect: activeDialect,
            system_text: systemText,
            contents: requestContents,
            voice_name: voicePreset,
            workspace_room_id: isCorporateDomain ? roomId : undefined,
          }),
        });
      } catch (error) {
        console.warn("Voice service request failed:", error);
        return null;
      }
      if (!audioResponse.ok) {
        const errorText = await audioResponse.text();
        let detail = errorText;
        try {
          const errorPayload = JSON.parse(errorText) as { detail?: string; error?: string };
          detail = errorPayload.detail || errorPayload.error || errorText;
        } catch {
          // Keep the backend response text for non-JSON errors.
        }
        if (
          audioResponse.status === 401 ||
          (audioResponse.status === 403 && detail === "BYOK_REQUIRED")
        ) {
          if (!isAdmin) {
            setIsVoiceCallOpen(false);
            setSettingsTab("developer");
            setVoiceCallGateNotice("Please provide your Gemini API key in Settings to use Live Voice.");
            setSettingsOpen(true);
            return null;
          }
          console.warn("Admin voice request was rejected; verify the active sign-in session.");
          return {
            text: "Your sign-in session needs to be refreshed before Genie can respond. Please sign in again.",
          };
        }
        console.warn(`Voice service returned HTTP ${audioResponse.status}:`, detail.slice(0, 300));
        return null;
      }
      const audioData = (await audioResponse.json()) as {
        text?: string;
        audio?: string;
        audio_mime_type?: string;
        candidates?: {
          content?: {
            parts?: { text?: string; inlineData?: { data?: string; mimeType?: string } }[];
          };
        }[];
      };
      const responseParts = audioData.candidates?.[0]?.content?.parts || [];
      const assistantText =
        audioData.text?.trim() ||
        responseParts.map((part) => part.text || "").join("").trim();
      if (!assistantText || !audioData.audio) {
        console.warn("Voice service returned an incomplete text/audio response.");
        return null;
      }

      return {
        text: assistantText,
        audioData: audioData.audio,
        audioMimeType: audioData.audio_mime_type,
      };
    } catch (error) {
      console.warn("Voice turn failed:", error);
      return null;
    } finally {
      setIsStreaming(false);
    }
  }

  const handleEditMessage = async (message: Message, index: number) => {
    if (isTeamMode) {
      await handleEditRoomMessage(message);
    } else if (editDraft.trim()) {
      const messageKey = message.id || String(index);
      updateCurrentPersonalMessages((current) =>
        current.map((item, itemIndex) =>
          (item.id || String(itemIndex)) === messageKey
            ? { ...item, content: editDraft.trim(), text: editDraft.trim(), is_edited: true }
            : item
        )
      );
      setEditingMessageId(null);
      setEditDraft("");
    }
  };

  const handleDeleteMessage = (message: Message, index: number) => {
    if (isObserverActive) {
      console.warn("Message deletion rejected: Observer mode is active.");
      return;
    }
    if (message.isVoiceRecord) {
      console.warn("Voice-call transcript records cannot be deleted.");
      return;
    }
    if (isTeamMode) {
      handleDeleteRoomMessage(message);
      return;
    }
    const messageKey = message.id || String(index);
    updateCurrentPersonalMessages((current) =>
      current.filter((item, itemIndex) => (item.id || String(itemIndex)) !== messageKey)
    );
  };

  const handleTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reportType !== "ui_request" || !ticketDescription.trim()) return;

    try {
      const response = await fetch("/api/py/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: userProfile.email,
          user_name: userProfile.name,
          developer_destination: SUPPORT_DISPATCH_EMAIL,
          track: "ui_request",
          description: ticketDescription,
          context: "Submitted via Genie Workspace Preferences",
        }),
      });
      if (!response.ok) {
        throw new Error(`Developer pipeline returned HTTP ${response.status}.`);
      }
      setTicketStatus(`Dispatched successfully to ${SUPPORT_DISPATCH_EMAIL}.`);
      setTicketDescription("");
      setTimeout(() => setTicketStatus(null), 3500);
    } catch (error) {
      console.error("Feature request dispatch failed:", error);
      setTicketStatus("Feature request could not be sent. Please try again.");
    }
  };

  const handleReportAIMistake = async (reportedMessage?: Message) => {
    setReportType("ai_issue");
    const latestAssistantMessage = reportedMessage || [...messages]
      .reverse()
      .find((message) => message.role === "assistant" && message.content.trim());
    if (!latestAssistantMessage) {
      setTicketStatus("There is no Genie answer in this chat to review yet.");
      return;
    }
    if (isStreaming) {
      setTicketStatus("Wait for Genie to finish responding before requesting a review.");
      return;
    }

    const reviewPrompt = [
      "@Genie please review and correct your latest answer in this active conversation. Return the correction as a clearly labeled in-chat intervention.",
      `Latest answer to review:\n${latestAssistantMessage.content}`,
      ticketDescription.trim() ? `User's concern:\n${ticketDescription.trim()}` : "",
      "Explain what was inaccurate or incomplete, then provide a corrected answer.",
    ]
      .filter(Boolean)
      .join("\n\n");
    setTicketStatus(null);
    setTicketDescription("");
    setSettingsOpen(false);
    await handleSendMessage(undefined, false, reviewPrompt, true, true);
  };

  async function handleAuthenticatorLogin(event: React.FormEvent) {
    event.preventDefault();
    setAuthenticatorLoginBusy(true);
    setAuthenticatorLoginError(null);
    try {
      const response = await fetch(getAuthApiUrl(API_BASE, "auth/totp/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authenticatorLoginEmail.trim(),
          code: authenticatorLoginCode.trim(),
        }),
      });
      const result = (await response.json()) as {
        session_token?: string;
        profile?: {
          user_id: string;
          display_name: string;
          email: string;
          mobile_number: string;
          mobile_verified?: boolean;
          recovery_email: string;
          avatar_url: string;
          gender: string;
          allow_room_invites: "mutual_friends" | "everyone";
          is_creator: boolean;
        };
        detail?: string;
      };
      if (!response.ok || !result.session_token || !result.profile) {
        throw new Error(result.detail || `Authenticator sign-in failed (HTTP ${response.status}).`);
      }

      const profile = {
        ...userProfile,
        providerId: result.profile.user_id,
        authProvider: "google" as const,
        name: result.profile.display_name,
        email: result.profile.email,
        mobileNumber: result.profile.mobile_number,
        mobileVerified: result.profile.mobile_verified === true,
        recoveryEmail: result.profile.recovery_email,
        avatarUrl: result.profile.avatar_url || "genie-preset:neutral",
        gender: result.profile.gender || "",
        allowRoomInvites: result.profile.allow_room_invites,
        isCreator: result.profile.is_creator,
        totpPasscode: "",
      };
      localStorage.setItem("genie_session_token", result.session_token);
      localStorage.setItem("genie_user_profile", JSON.stringify({ ...profile, customApiKey: "" }));
      localStorage.setItem("genie_is_authenticated", "true");
      sessionStorage.setItem("genie_google_id_token", result.session_token);
      setGoogleIdToken(result.session_token);
      setUserProfile(profile);
      setAuthenticatorLoginCode("");
      setIsAuthenticated(true);
    } catch (error) {
      console.error("Passwordless Authenticator sign-in failed:", error);
      setAuthenticatorLoginError(error instanceof Error ? error.message : "Authenticator sign-in failed.");
    } finally {
      setAuthenticatorLoginBusy(false);
    }
  }

  function handleStartGoogleRegistration() {
    setAuthMode("register");
    setRegistrationError(null);
    const google = (window as Window & {
      google?: {
        accounts?: {
          id?: {
            prompt: (callback?: (notification: {
              isNotDisplayed: () => boolean;
              isSkippedMoment: () => boolean;
              getNotDisplayedReason: () => string;
            }) => void) => void;
          };
        };
      };
    }).google;
    if (!google?.accounts?.id?.prompt) {
      setRegistrationError("Google sign-in is still loading. Use the Google button below when it appears.");
      return;
    }
    try {
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          const reason = notification.getNotDisplayedReason();
          setRegistrationError(`Google sign-in was unavailable (${reason || "please try again"}).`);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof DOMException && error.name === "AbortError" || /\b403\b|AbortError/i.test(message)) {
        setRegistrationError("Google sign-in was blocked by the browser. Allow Google sign-in and try again.");
      } else {
        setRegistrationError(message || "Google sign-in could not be started.");
      }
    }
  }

  async function handleDevBypassLogin() {
    setAuthenticatorLoginBusy(true);
    setAuthenticatorLoginError(null);
    try {
      let devUser = {
        id: "dev-admin",
        email: "rshaji93@gmail.com",
        name: "Shaji (Dev)",
        avatar_type: "preset_a",
      };
      try {
        const response = await fetch(getAuthApiUrl(API_BASE, "auth/dev-session"), {
          method: "POST",
        });
        if (response.ok) {
          const result = (await response.json()) as {
            token?: string;
            user?: Partial<typeof devUser>;
          };
          if (result.token && result.user) devUser = { ...devUser, ...result.user };
        }
      } catch (error) {
        console.warn("Development auth endpoint unavailable; using the local mock session.", error);
      }
      const sessionToken = "dev-token-local-bypass";
      const profile = {
        ...userProfile,
        providerId: devUser.id,
        authProvider: "google" as const,
        name: devUser.name,
        email: devUser.email,
        avatarUrl: devUser.avatar_type === "preset_a" ? "genie-preset:guardian" : "genie-preset:neutral",
        totpPasscode: "",
      };
      localStorage.setItem("genie_session_token", sessionToken);
      localStorage.setItem("genie_user_profile", JSON.stringify(devUser));
      localStorage.setItem("genie_is_authenticated", "true");
      sessionStorage.setItem("genie_google_id_token", sessionToken);
      setGoogleIdToken(sessionToken);
      setUserProfile(profile);
      setRegistrationRequired(false);
      setRegistrationBusy(false);
      setRegistrationReauthRequired(false);
      setAuthMode("login");
      setIsAuthenticated(true);
    } catch (error) {
      console.error("Development sign-in failed:", error);
      setAuthenticatorLoginError(error instanceof Error ? error.message : "Development sign-in failed.");
    } finally {
      setAuthenticatorLoginBusy(false);
    }
  }

  async function handleStartAuthenticatorSetup() {
    const token = googleIdToken || localStorage.getItem("genie_session_token") || "";
    if (!token || token === "dev-token-local-bypass") {
      setAuthenticatorSetupError("Sign in with a verified account before enabling Authenticator.");
      return;
    }
    setAuthenticatorSetupBusy(true);
    setAuthenticatorSetupError(null);
    try {
      const setup = await fetchAuthenticatorSetup(userProfile.email, token, API_BASE);
      setAuthenticatorSetup(setup);
      setAuthenticatorSetupCode("");
      setAuthenticatorSetupOpen(true);
    } catch (error) {
      console.error("Authenticator setup could not be started:", error);
      setAuthenticatorSetupError(error instanceof Error ? error.message : "Authenticator setup could not be started.");
    } finally {
      setAuthenticatorSetupBusy(false);
    }
  }

  async function handleVerifyAuthenticatorSetup() {
    const token = googleIdToken || localStorage.getItem("genie_session_token") || "";
    if (!token || !authenticatorSetup || authenticatorSetupCode.length !== 6) return;
    setAuthenticatorSetupBusy(true);
    setAuthenticatorSetupError(null);
    try {
      const response = await fetch(getAuthApiUrl(API_BASE, "auth/totp/verify"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: userProfile.email,
          code: authenticatorSetupCode,
          setup_secret: authenticatorSetup.secret,
        }),
      });
      const result = (await response.json()) as { verified?: boolean; detail?: string };
      if (!response.ok || !result.verified) {
        throw new Error(result.detail || "Authenticator code could not be verified.");
      }
      setUserProfile((previous) => ({ ...previous, totpEnabled: true }));
      setAuthenticatorEnabled(true);
      setAuthenticatorSetupOpen(false);
      setAuthenticatorSetup(null);
      setAuthenticatorSetupCode("");
      setAuthenticatorResetMessage("Google Authenticator is now active for your account.");
    } catch (error) {
      console.error("Authenticator verification failed:", error);
      setAuthenticatorSetupError(error instanceof Error ? error.message : "Authenticator code could not be verified.");
    } finally {
      setAuthenticatorSetupBusy(false);
    }
  }

  async function requestAuthenticatorReset(emailOverride?: string) {
    setAuthenticatorResetBusy(true);
    setAuthenticatorResetMessage(null);
    try {
      const response = await fetch(getAuthApiUrl(API_BASE, "auth/totp/reset/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: (emailOverride || authenticatorLoginEmail).trim() }),
      });
      const result = (await response.json()) as { message?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail || `Reset email request failed (HTTP ${response.status}).`);
      setAuthenticatorResetPending(true);
      setAuthenticatorResetMessage(result.message || "Check your email for the verification code.");
    } catch (error) {
      setAuthenticatorResetMessage(error instanceof Error ? error.message : "Authenticator reset could not be requested.");
    } finally {
      setAuthenticatorResetBusy(false);
    }
  }

  async function confirmAuthenticatorReset() {
    setAuthenticatorResetBusy(true);
    setAuthenticatorResetMessage(null);
    try {
      const response = await fetch(getAuthApiUrl(API_BASE, "auth/totp/reset/confirm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authenticatorLoginEmail.trim(), code: authenticatorResetCode.trim() }),
      });
      const result = (await response.json()) as { message?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail || `Authenticator reset failed (HTTP ${response.status}).`);
      setAuthenticatorResetMessage(result.message || "Authenticator reset. You can enroll again from Workspace Preferences.");
      setAuthenticatorResetPending(false);
      setUserProfile((previous) => ({ ...previous, totpEnabled: false }));
      setAuthenticatorEnabled(false);
      setAuthenticatorResetCode("");
      setAuthenticatorSetup(null);
      setAuthenticatorSetupOpen(false);
    } catch (error) {
      setAuthenticatorResetMessage(error instanceof Error ? error.message : "Authenticator reset failed.");
    } finally {
      setAuthenticatorResetBusy(false);
    }
  }

  async function handleRegistrationAvatarFile(file?: File) {
    if (isMasterAdmin) return;
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setRegistrationError("Choose an avatar image no larger than 2 MB.");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    const mimeType = file.type || (
      extension === "png" ? "image/png" :
      extension === "jpg" || extension === "jpeg" ? "image/jpeg" :
      extension === "svg" ? "image/svg+xml" : ""
    );
    if (!["image/png", "image/jpeg", "image/svg+xml"].includes(mimeType)) {
      setRegistrationError("Choose a PNG, JPG, or SVG image.");
      return;
    }
    try {
      const avatarUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("The selected avatar image could not be read."));
        reader.onload = () => {
          if (typeof reader.result !== "string") {
            reject(new Error("The selected avatar image could not be read."));
            return;
          }
          resolve(reader.result);
        };
        reader.readAsDataURL(file);
      });
      setUserProfile((previous) => ({ ...previous, avatarUrl }));
      setRegistrationError(null);
    } catch (error) {
      setRegistrationError(error instanceof Error ? error.message : "The selected avatar image could not be read.");
    }
  }

  async function submitMandatoryRegistration(event: React.FormEvent) {
    event.preventDefault();
    if (!googleIdToken || !registrationTermsAccepted || !registrationPrivacyAccepted) {
      setRegistrationError("Sign in with Google and accept both required policies to complete registration.");
      return;
    }
    setRegistrationBusy(true);
    setRegistrationError(null);
    const persistRegistrationFallback = () => {
      const fallbackToken = googleIdToken;
      const localProfile = {
        ...userProfile,
        avatarUrl: isMasterAdmin ? "/admin-avatar.png" : userProfile.avatarUrl,
        providerId: userProfile.providerId || (fallbackToken === "dev-token-local-bypass" ? "dev-admin" : ""),
        authProvider: (userProfile.authProvider || "google") as "google",
        name: userProfile.name.trim(),
        email: userProfile.email.trim().toLowerCase(),
        customApiKey: "",
        totpPasscode: "",
      };
      localStorage.setItem("genie_user_profile", JSON.stringify(localProfile));
      localStorage.setItem("genie_session_token", fallbackToken);
      localStorage.setItem("genie_is_authenticated", "true");
      localStorage.setItem("genie_terms_agreed", "true");
      localStorage.setItem("genie_local_registration_fallback", "true");
      sessionStorage.setItem("genie_google_id_token", fallbackToken);
      setGoogleIdToken(fallbackToken);
      setUserProfile(localProfile);
      setRegistrationRequired(false);
      setRegistrationReauthRequired(false);
      registrationReauthRequiredRef.current = false;
      setIsAuthenticated(true);
      setAuthenticatorEnabled(false);
      setRegistrationTermsAccepted(false);
      setRegistrationPrivacyAccepted(false);
    };
    try {
      const response = await fetch(getAuthApiUrl(API_BASE, "registration/complete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          email: userProfile.email.trim(),
          display_name: userProfile.name.trim(),
          avatar_url: isMasterAdmin ? "/admin-avatar.png" : userProfile.avatarUrl || "genie-preset:neutral",
          avatar_type: userProfile.avatarUrl === "/avatars/Profile-1.png"
            ? "option_a"
            : userProfile.avatarUrl === "/avatars/Profile-2.png"
            ? "option_b"
            : userProfile.avatarUrl === "/avatars/Profile-3.png"
            ? "option_c"
            : undefined,
          mobile_number: userProfile.mobileNumber.trim(),
          phone: userProfile.mobileNumber.trim(),
          recovery_email: userProfile.recoveryEmail.trim(),
          terms_accepted: registrationTermsAccepted,
          privacy_accepted: registrationPrivacyAccepted,
        }),
      });
      if (!response.ok) {
        console.warn(`Registration API returned HTTP ${response.status}; using the locally saved profile.`);
        persistRegistrationFallback();
        return;
      }
      const result = (await response.json()) as {
        session_token?: string;
        profile?: {
          display_name: string;
          email: string;
          google_avatar_url?: string;
          mobile_number: string;
          mobile_verified?: boolean;
          recovery_email: string;
          allow_room_invites: "mutual_friends" | "everyone";
          avatar_url?: string;
        };
        detail?: string;
      };
      if (response.status === 401) {
        requireGoogleReauthentication(
          "Your Google sign-in expired or could not be verified. Re-authenticate with Google to submit your registration."
        );
        return;
      }
      if (!response.ok || !result.profile || !result.session_token) {
        throw new Error(result.detail || `Registration could not be saved (HTTP ${response.status}).`);
      }
      const completedProfile = {
        ...userProfile,
        name: result.profile.display_name,
        email: result.profile.email,
        googleAvatarUrl: result.profile.google_avatar_url || userProfile.googleAvatarUrl,
        mobileNumber: result.profile.mobile_number,
        mobileVerified: result.profile.mobile_verified === true,
        recoveryEmail: result.profile.recovery_email,
        allowRoomInvites: result.profile.allow_room_invites,
        avatarUrl: result.profile.avatar_url || userProfile.avatarUrl,
      };
      localStorage.setItem("genie_user_profile", JSON.stringify({
        ...completedProfile,
        customApiKey: "",
        totpPasscode: "",
      }));
      localStorage.setItem("genie_is_authenticated", "true");
      localStorage.setItem("genie_terms_agreed", "true");
      sessionStorage.setItem("genie_google_id_token", result.session_token);
      localStorage.setItem("genie_session_token", result.session_token);
      setGoogleIdToken(result.session_token);
      setUserProfile(completedProfile);
      setRegistrationRequired(false);
      setRegistrationReauthRequired(false);
      registrationReauthRequiredRef.current = false;
      setIsAuthenticated(true);
      setAuthenticatorEnabled(false);
      localStorage.removeItem("genie_local_registration_fallback");
      setRegistrationTermsAccepted(false);
      setRegistrationPrivacyAccepted(false);
    } catch (error) {
      console.warn("Registration API could not be reached; using the locally saved profile.", error);
      persistRegistrationFallback();
    } finally {
      setRegistrationBusy(false);
    }
  }

  function openProfileEditor() {
    setProfileEditor({
      name: userProfile.name,
      mobileNumber: userProfile.mobileNumber,
      recoveryEmail: userProfile.recoveryEmail,
      avatarUrl: userProfile.avatarUrl || "genie-preset:neutral",
      gender: userProfile.gender || "",
    });
    setProfileSaveError(null);
    setProfileTotpSetup(null);
    setProfileTotpCode("");
    setProfileTotpError(null);
    setProfileTotpMessage(null);
    setProfileTotpToast(null);
    setEditProfileOpen(true);
  }

  async function startProfileTotpSetup() {
    const token = googleIdToken || localStorage.getItem("genie_session_token") || "";
    if (!token) {
      setProfileTotpError("Sign in with your verified account before setting up Authenticator.");
      return;
    }
    setProfileTotpBusy(true);
    setProfileTotpError(null);
    setProfileTotpMessage(null);
    try {
      const setup = await fetchAuthenticatorSetup(userProfile.email, token, API_BASE);
      setProfileTotpSetup(setup);
      setProfileTotpCode("");
    } catch (error) {
      console.error("Profile Authenticator setup could not be started:", error);
      setProfileTotpError(error instanceof Error ? error.message : "Authenticator setup could not be started.");
    } finally {
      setProfileTotpBusy(false);
    }
  }

  async function verifyProfileTotpSetup() {
    const token = googleIdToken || localStorage.getItem("genie_session_token") || "";
    if (!token || !profileTotpSetup || profileTotpCode.length !== 6) return;
    setProfileTotpBusy(true);
    setProfileTotpError(null);
    setProfileTotpMessage(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token !== "dev-token-local-bypass") {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(getAuthApiUrl(API_BASE, "auth/totp/verify"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: userProfile.email,
          code: profileTotpCode,
          setup_secret: profileTotpSetup.secret,
        }),
      });
      const result = (await response.json()) as { verified?: boolean; detail?: string };
      if (!response.ok || !result.verified) {
        throw new Error(result.detail || `Authenticator code could not be verified (HTTP ${response.status}).`);
      }
      const updatedProfile = { ...userProfile, totpEnabled: true };
      setUserProfile(updatedProfile);
      setAuthenticatorEnabled(true);
      setProfileTotpSetup(null);
      setProfileTotpCode("");
      setProfileTotpMessage("Google Authenticator is now enabled for your account.");
      try {
        localStorage.setItem("genie_user_profile", JSON.stringify({
          ...updatedProfile,
          customApiKey: "",
          totpPasscode: "",
        }));
      } catch (error) {
        console.warn("Authenticator status could not be cached locally:", error);
      }
    } catch (error) {
      console.error("Profile Authenticator verification failed:", error);
      setProfileTotpError(error instanceof Error ? error.message : "Authenticator code could not be verified.");
    } finally {
      setProfileTotpBusy(false);
    }
  }

  async function requestProfileTotpReset() {
    const token = googleIdToken || localStorage.getItem("genie_session_token") || "";
    if (!token || token === "dev-token-local-bypass") {
      setProfileTotpError("A verified account session is required to request an Authenticator reset.");
      return;
    }
    setProfileTotpBusy(true);
    setProfileTotpError(null);
    setProfileTotpMessage(null);
    try {
      const response = await fetch(getAuthApiUrl(API_BASE, "auth/totp/request-reset"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: userProfile.email }),
      });
      const result = (await response.json()) as { success?: boolean; detail?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.detail || `Authenticator reset email could not be requested (HTTP ${response.status}).`);
      }
      const message = "A secure reset link has been dispatched to your verified email.";
      setProfileTotpMessage(null);
      setProfileTotpToast(message);
      if (profileTotpToastTimerRef.current) clearTimeout(profileTotpToastTimerRef.current);
      profileTotpToastTimerRef.current = setTimeout(() => setProfileTotpToast(null), 5000);
    } catch (error) {
      console.error("Profile Authenticator reset email request failed:", error);
      setProfileTotpError(error instanceof Error ? error.message : "Authenticator reset could not be requested.");
    } finally {
      setProfileTotpBusy(false);
    }
  }

  async function handleProfileAvatarFile(file?: File) {
    if (isMasterAdmin) return;
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setProfileSaveError("Choose an image no larger than 2 MB.");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    const mimeType = file.type || (
      extension === "png" ? "image/png" :
      extension === "jpg" || extension === "jpeg" ? "image/jpeg" :
      extension === "svg" ? "image/svg+xml" : ""
    );
    if (!["image/png", "image/jpeg", "image/svg+xml"].includes(mimeType)) {
      setProfileSaveError("Choose a PNG, JPG, or SVG image.");
      return;
    }
    setProfileSaveError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("The selected avatar image could not be read."));
        reader.onload = () => {
          if (typeof reader.result !== "string") {
            reject(new Error("The selected avatar image could not be read."));
            return;
          }
          resolve(reader.result);
        };
        reader.readAsDataURL(file);
      });
      setProfileEditor((previous) => ({ ...previous, avatarUrl: dataUrl }));
    } catch (error) {
      setProfileSaveError(error instanceof Error ? error.message : "The selected avatar image could not be read.");
    }
  }

  async function saveProfileChanges(event: React.FormEvent) {
    event.preventDefault();
    if (!googleIdToken) {
      setProfileSaveError("Sign in with Google again before saving profile changes.");
      return;
    }
    setProfileSaveBusy(true);
    setProfileSaveError(null);
    try {
      const response = await fetch(getBackendApiUrl("/api/registration/profile"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_id_token: googleIdToken,
          display_name: profileEditor.name.trim(),
          mobile_number: profileEditor.mobileNumber.trim(),
          recovery_email: profileEditor.recoveryEmail.trim(),
          avatar_url: isMasterAdmin ? "/admin-avatar.png" : profileEditor.avatarUrl,
          gender: profileEditor.gender,
        }),
      });
      const result = (await response.json()) as {
        profile?: {
          display_name: string;
          email: string;
          mobile_number: string;
          mobile_verified?: boolean;
          recovery_email: string;
          avatar_url: string;
          gender: string;
        };
        detail?: string;
      };
      if (response.status === 401) {
        throw new Error("Your Google sign-in expired. Sign out and authenticate with Google again before saving.");
      }
      if (!response.ok || !result.profile) {
        throw new Error(result.detail || `Profile could not be saved (HTTP ${response.status}).`);
      }
      const updatedProfile = {
        ...userProfile,
        name: result.profile.display_name,
        email: result.profile.email,
        mobileNumber: result.profile.mobile_number,
        mobileVerified: result.profile.mobile_verified === true,
        recoveryEmail: result.profile.recovery_email,
        avatarUrl: isMasterAdmin ? "/admin-avatar.png" : result.profile.avatar_url,
        gender: result.profile.gender,
      };
      setUserProfile(updatedProfile);
      setMembers((previous) => previous.map((member) =>
        member.id === roomIdentity
          ? { ...member, name: updatedProfile.name, email: updatedProfile.email, avatarUrl: updatedProfile.avatarUrl }
          : member
      ));
      try {
        localStorage.setItem("genie_user_profile", JSON.stringify({
          ...updatedProfile,
          customApiKey: "",
          totpPasscode: "",
        }));
      } catch (error) {
        console.warn("Updated profile is saved on the server but could not be cached locally:", error);
      }
      setEditProfileOpen(false);
    } catch (error) {
      console.error("Profile update failed:", error);
      setProfileSaveError(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      setProfileSaveBusy(false);
    }
  }

  async function updateInvitePrivacy(policy: "mutual_friends" | "everyone") {
    if (!googleIdToken) return;
    const previousPolicy = userProfile.allowRoomInvites;
    setUserProfile((previous) => ({ ...previous, allowRoomInvites: policy }));
    try {
      const response = await fetch(getBackendApiUrl("/api/registration/invite-privacy"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ google_id_token: googleIdToken, policy }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail || `Invite privacy could not be updated (HTTP ${response.status}).`);
      const updatedProfile = { ...userProfile, allowRoomInvites: policy };
      localStorage.setItem("genie_user_profile", JSON.stringify({
        ...updatedProfile,
        customApiKey: "",
        totpPasscode: "",
      }));
    } catch (error) {
      setUserProfile((previous) => ({ ...previous, allowRoomInvites: previousPolicy }));
      console.error("Invite privacy update failed:", error);
      setChatError(error instanceof Error ? error.message : "Invite privacy could not be updated.");
    }
  }

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

      {forwardMessage && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="forward-message-title" className="w-full max-w-sm space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 id="forward-message-title" className="text-sm font-bold text-slate-900">Forward message</h2>
                <p className="mt-1 line-clamp-2 text-[10px] text-slate-500">{forwardMessage.content}</p>
              </div>
              <button type="button" onClick={() => setForwardMessage(null)} aria-label="Cancel forwarding" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Choose a chat</p>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {topics.map((topic) => (
                <button key={topic.id} type="button" onClick={() => forwardMessageToTopic(topic.id)} className="flex w-full items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <span aria-hidden="true">{topic.icon}</span>{topic.title}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Primary Authentication Gate */}
      {!isAuthenticated && !registrationRequired && !registrationBusy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 flex flex-col items-center text-center space-y-4">
            <div className={`w-14 h-14 ${selectedTheme.bgLightClass} ${selectedTheme.textClass} rounded-full flex items-center justify-center shadow-inner`}>
              <Lock className="w-6 h-6" />
            </div>

            <div>
              <h2 className="text-xl font-extrabold text-slate-800">Personal AI Genie</h2>
              <p className="text-xs text-slate-500 mt-1">
                Secure sign-in with your Google account
              </p>
            </div>

            <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-left space-y-2">
              <div className="flex items-center gap-1.5 text-slate-800 text-xs font-bold">
                <ShieldCheck className="w-4 h-4 text-purple-600" />
                <span>Secure, passwordless access</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {authMode === "login"
                  ? "Continue with Google to sign in. If you enabled Authenticator, you can also use its current 6-digit code below."
                  : "Verify your Gmail with Google, then complete your profile. Authenticator is optional and can be enabled later in Workspace Preferences."}
              </p>
            </div>
            {authMode === "login" ? (
            <form onSubmit={(event) => void handleAuthenticatorLogin(event)} className="w-full space-y-3">
              <label className="block space-y-1 text-left">
                <span className="text-xs font-semibold text-slate-700">Verified Gmail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={authenticatorLoginEmail}
                  onChange={(event) => setAuthenticatorLoginEmail(event.target.value)}
                  placeholder="you@gmail.com"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
                />
              </label>
              <label className="block space-y-1 text-left">
                <span className="text-xs font-semibold text-slate-700">6-digit Authenticator code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  value={authenticatorLoginCode}
                  onChange={(event) => setAuthenticatorLoginCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-center font-mono text-lg tracking-[0.35em] outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
                />
              </label>
              {authenticatorLoginError && <p role="alert" className="text-left text-xs text-rose-700">{authenticatorLoginError}</p>}
              {authenticatorResetMessage && <p role="status" className="text-left text-xs text-slate-600">{authenticatorResetMessage}</p>}
              {authenticatorResetPending && (
                <div className="flex gap-2">
                  <input
                    aria-label="Email verification code"
                    inputMode="numeric"
                    maxLength={6}
                    value={authenticatorResetCode}
                    onChange={(event) => setAuthenticatorResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="Email code"
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button type="button" onClick={() => void confirmAuthenticatorReset()} disabled={authenticatorResetBusy || authenticatorResetCode.length !== 6} className="rounded-xl border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50">
                    Reset
                  </button>
                </div>
              )}
              <button type="submit" disabled={authenticatorLoginBusy || authenticatorLoginCode.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-800 px-4 py-3 text-sm font-bold text-white shadow-md hover:bg-cyan-900 disabled:opacity-50">
                {authenticatorLoginBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Sign in securely
              </button>
              <button type="button" onClick={() => void requestAuthenticatorReset()} disabled={authenticatorResetBusy || !authenticatorLoginEmail.includes("@")} className="w-full text-xs font-semibold text-cyan-800 hover:underline disabled:opacity-50">
                {authenticatorResetBusy ? "Sending verification email…" : "Reset Authenticator by email"}
              </button>
            </form>
            ) : (
              <div className="w-full space-y-3 rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4 text-left">
                <p className="text-sm font-semibold text-slate-800">Create your Genie account</p>
                <p className="text-xs leading-relaxed text-slate-600">
                  Continue with Google to verify your Gmail address, then complete your profile. You can enable Authenticator later in Workspace Preferences.
                </p>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">Gmail address</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={authenticatorLoginEmail}
                    onChange={(event) => setAuthenticatorLoginEmail(event.target.value)}
                    placeholder="you@gmail.com"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleStartGoogleRegistration}
                  className="flex w-full items-center justify-center rounded-xl bg-cyan-800 px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-cyan-900 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2"
                >
                  Continue with Google / Link Gmail
                </button>
                {registrationError && <p role="alert" className="text-xs text-rose-700">{registrationError}</p>}
              </div>
            )}
            <div className="w-full border-t border-slate-200 pt-3">
              {authMode === "login" ? (
                <button
                  type="button"
                  onClick={() => setAuthMode("register")}
                  className="mb-2 text-xs text-cyan-800 hover:underline"
                >
                  New here? Link your verified Google account to register.
                </button>
              ) : (
                <div className="w-full">
                  <button
                    type="button"
                    onClick={() => setAuthMode("login")}
                    className="mb-2 text-xs font-semibold text-cyan-800 hover:underline"
                  >
                    Back to sign in
                  </button>
                  {showDevAuthBypass && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleDevBypassLogin()}
                        disabled={authenticatorLoginBusy}
                        className="block w-full text-[11px] font-medium text-amber-700 hover:underline disabled:opacity-50"
                      >
                        {authenticatorLoginBusy ? "Opening local development session…" : "[Dev: Enter Workspace as rshaji93@gmail.com]"}
                      </button>
                      {authenticatorLoginError && <p role="alert" className="mt-1 text-[11px] text-rose-700">{authenticatorLoginError}</p>}
                    </>
                  )}
                </div>
              )}
              <div className="flex min-h-[40px] w-full justify-center"><div id="googleSignInBtn" /></div>
            </div>
            {registrationReauthRequired && <p className="text-xs text-amber-700">{authenticatorResetMessage || "Use Google sign-in to start Authenticator enrollment."}</p>}
          </div>
        </div>
      )}
      {registrationBusy && googleIdToken && !registrationRequired && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
          <div role="status" className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-700" />
            Verifying your Genie registration…
          </div>
        </div>
      )}
      {registrationRequired && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-md">
          <form
            onSubmit={(event) => void submitMandatoryRegistration(event)}
            className="my-auto w-full max-w-lg space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-800">
                <UserCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">Complete your registration</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Required account details are stored securely before dashboard access is enabled.
                </p>
              </div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Display Name / Profile Name</span>
              <input
                required
                minLength={2}
                maxLength={120}
                value={userProfile.name}
                onChange={(event) => setUserProfile((previous) => ({ ...previous, name: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Verified Gmail Address</span>
              <input
                readOnly
                value={userProfile.email}
                className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500"
              />
            </label>
            <fieldset disabled={isMasterAdmin} className="space-y-2 disabled:opacity-70">
              <legend className="text-xs font-semibold text-slate-700">
                {isMasterAdmin ? "Admin Avatar (read-only)" : "Avatar Selector"}
              </legend>
              {isMasterAdmin && (
                <Image
                  src="/admin-avatar.png"
                  width={64}
                  height={64}
                  alt="Admin Avatar"
                  className="rounded-full border border-purple-500/30 object-cover shadow-lg"
                />
              )}
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["/avatars/Profile-1.png", "Option A: Profile 1", "Profile 1"],
                  ["/avatars/Profile-2.png", "Option B: Profile 2", "Profile 2"],
                  ["/avatars/Profile-3.png", "Option C: Profile 3", "Profile 3"],
                ] as const).map(([avatar, label, description]) => (
                  <button
                    key={avatar}
                    type="button"
                    onClick={() => setUserProfile((previous) => ({ ...previous, avatarUrl: avatar }))}
                    aria-pressed={userProfile.avatarUrl === avatar}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-colors ${
                      userProfile.avatarUrl === avatar
                        ? "border-cyan-600 bg-cyan-50 ring-2 ring-cyan-100"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <GenieAvatar src={avatar} alt={description} className="h-10 w-10 rounded-full" />
                    <span className="text-[10px] font-bold text-slate-800">{label}</span>
                    <span className="text-[9px] leading-tight text-slate-500">{description}</span>
                  </button>
                ))}
              </div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                <ImagePlus className="h-4 w-4" />
                Upload PNG, JPG, or SVG (max 2 MB)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
                  className="sr-only"
                  onChange={(event) => {
                    void handleRegistrationAvatarFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {!isMasterAdmin && userProfile.avatarUrl.startsWith("data:image/") && (
                <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500">
                  <GenieAvatar src={userProfile.avatarUrl} alt="Custom avatar preview" className="h-9 w-9 rounded-full object-cover" />
                  <span>Custom avatar preview</span>
                </div>
              )}
            </fieldset>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Mobile / Contact Number <span className="text-rose-600">*</span></span>
              <input
                required
                type="tel"
                minLength={7}
                maxLength={32}
                autoComplete="tel"
                value={userProfile.mobileNumber}
                onChange={(event) => setUserProfile((previous) => ({ ...previous, mobileNumber: event.target.value }))}
                placeholder="+1 555 123 4567"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Alternate Recovery Email <span className="font-normal text-slate-400">(optional)</span></span>
              <input
                type="email"
                maxLength={254}
                autoComplete="email"
                value={userProfile.recoveryEmail}
                onChange={(event) => setUserProfile((previous) => ({ ...previous, recoveryEmail: event.target.value }))}
                placeholder="recovery@example.com"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
              <input
                type="checkbox"
                required
                checked={registrationTermsAccepted}
                onChange={(event) => setRegistrationTermsAccepted(event.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-cyan-700 focus:ring-cyan-500"
              />
              <span>
                I accept the{" "}
                <button
                  type="button"
                  onClick={() => setLegalModalOpen(true)}
                  className="font-bold text-cyan-800 underline"
                >
                  Terms of Service, User Disclaimer & Privacy Policy
                </button>
                . My Terms of Service consent will be recorded with my registration.
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
              <input
                type="checkbox"
                required
                checked={registrationPrivacyAccepted}
                onChange={(event) => setRegistrationPrivacyAccepted(event.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-cyan-700 focus:ring-cyan-500"
              />
              <span>I have read and accept the Privacy Policy.</span>
            </label>
            {registrationError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{registrationError}</p>}
            {registrationReauthRequired && (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs leading-relaxed text-amber-900">
                  Your Google ID token may have expired. Sign in again to refresh it; your registration details will be kept for the same Google account.
                </p>
                <div id="googleRegistrationReauthBtn" className="flex justify-center" />
              </div>
            )}
            <button
              type="submit"
              disabled={registrationBusy || registrationReauthRequired || !registrationTermsAccepted || !registrationPrivacyAccepted}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-800 px-4 py-3 text-sm font-bold text-white shadow-md hover:bg-cyan-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {registrationBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Complete Registration &amp; Continue
            </button>
          </form>
        </div>
      )}
      {authenticatorSetupOpen && authenticatorSetup && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="authenticator-setup-title"
            className="my-auto w-full max-w-lg space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="authenticator-setup-title" className="text-lg font-extrabold text-slate-900">
                  Enable Google Authenticator (2FA)
                </h2>
                <p className="mt-1 text-xs text-slate-500">Scan the QR code, then verify a current six-digit code.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAuthenticatorSetupOpen(false);
                  setAuthenticatorSetupError(null);
                }}
                aria-label="Close Authenticator setup"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4 sm:flex-row">
              <img
                src={authenticatorSetup.qr_code}
                alt="Google Authenticator setup QR code"
                className="h-40 w-40 rounded-xl border border-slate-200 bg-white p-2"
              />
              <div className="min-w-0 text-center text-xs leading-relaxed text-slate-600 sm:text-left">
                <p>In your authenticator app, add an account by scanning this QR code.</p>
                <p className="mt-3 break-all font-mono text-[10px]">Manual setup key: {authenticatorSetup.secret}</p>
              </div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">6-digit verification code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                value={authenticatorSetupCode}
                onChange={(event) => setAuthenticatorSetupCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                aria-label="Authenticator verification code"
                className="w-full rounded-xl border border-slate-300 px-3 py-3 text-center font-mono tracking-[0.5em] text-slate-900"
              />
            </label>
            {authenticatorSetupError && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{authenticatorSetupError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAuthenticatorSetupOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleVerifyAuthenticatorSetup()}
                disabled={authenticatorSetupBusy || authenticatorSetupCode.length !== 6}
                className="rounded-xl bg-cyan-800 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {authenticatorSetupBusy ? "Verifying…" : "Verify & Enable"}
              </button>
            </div>
          </section>
        </div>
      )}
      {editProfileOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
          <form
            onSubmit={(event) => void saveProfileChanges(event)}
            className="my-auto max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">Edit Profile</h2>
                <p className="mt-1 text-xs text-slate-500">Update your account details and Genie avatar.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditProfileOpen(false)}
                aria-label="Close Edit Profile"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Display Name</span>
              <input
                required
                minLength={2}
                maxLength={120}
                value={profileEditor.name}
                onChange={(event) => setProfileEditor((previous) => ({ ...previous, name: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Verified Gmail Address</span>
              <input
                readOnly
                value={userProfile.email}
                className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">Mobile / Contact Number</span>
                  {userProfile.mobileVerified && profileEditor.mobileNumber.trim() === userProfile.mobileNumber.trim() && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      ✓ Verified
                    </span>
                  )}
                </span>
                <input
                  required
                  type="tel"
                  minLength={7}
                  maxLength={32}
                  autoComplete="tel"
                  value={profileEditor.mobileNumber}
                  onChange={(event) => setProfileEditor((previous) => ({ ...previous, mobileNumber: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">Alternate Recovery Email</span>
                <input
                  type="email"
                  maxLength={254}
                  autoComplete="email"
                  value={profileEditor.recoveryEmail}
                  onChange={(event) => setProfileEditor((previous) => ({ ...previous, recoveryEmail: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
                />
              </label>
            </div>
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-800">Google Authenticator (2FA)</h3>
                {authenticatorEnabled || userProfile.totpEnabled ? (
                  <span role="status" className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800">
                    Google Authenticator: Enabled ✓
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startProfileTotpSetup()}
                    disabled={profileTotpBusy}
                    className="rounded-lg bg-cyan-800 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-900 disabled:opacity-50"
                  >
                    {profileTotpBusy ? "Preparing…" : "[ Set Up Google Authenticator ]"}
                  </button>
                )}
              </div>
              {authenticatorEnabled || userProfile.totpEnabled ? (
                <button
                  type="button"
                  onClick={() => void requestProfileTotpReset()}
                  disabled={profileTotpBusy}
                  className="text-left text-[11px] font-medium text-cyan-800 underline decoration-cyan-300 underline-offset-2 hover:text-cyan-950 disabled:opacity-50"
                >
                  {profileTotpBusy
                    ? "Requesting secure setup link…"
                    : "Need to reset or re-link Authenticator? Request setup link via email"}
                </button>
              ) : profileTotpSetup ? (
                <div className="space-y-3 rounded-xl border border-cyan-100 bg-white p-3">
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    Scan this QR code with Google Authenticator, then enter its current 6-digit code.
                  </p>
                  <Image
                    src={profileTotpSetup.qr_code}
                    alt="Google Authenticator setup QR code"
                    width={160}
                    height={160}
                    unoptimized
                    className="mx-auto h-40 w-40 rounded-lg border border-slate-200 bg-white object-contain p-2"
                  />
                  <p className="break-all text-center font-mono text-[10px] text-slate-600">
                    Manual key: {profileTotpSetup.secret}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={profileTotpCode}
                      onChange={(event) => setProfileTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6-digit code"
                      aria-label="Google Authenticator verification code"
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void verifyProfileTotpSetup()}
                      disabled={profileTotpBusy || profileTotpCode.length !== 6}
                      className="rounded-lg bg-cyan-800 px-3 py-2 text-xs font-bold text-white hover:bg-cyan-900 disabled:opacity-50"
                    >
                      {profileTotpBusy ? "Verifying…" : "Verify & Enable"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-600">
                  Add an authenticator code as a second layer of account security.
                </p>
              )}
              {profileTotpError && <p role="alert" className="text-xs text-rose-700">{profileTotpError}</p>}
              {profileTotpMessage && <p role="status" className="text-xs text-emerald-700">{profileTotpMessage}</p>}
              {profileTotpToast && (
                <div
                  role="status"
                  aria-live="polite"
                  className="fixed bottom-5 right-5 z-[120] max-w-sm rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900 shadow-xl"
                >
                  {profileTotpToast}
                </div>
              )}
            </section>
            <section className="space-y-3 rounded-2xl border border-slate-200 p-3.5">
              <div className="flex items-center gap-3">
                {isMasterAdmin ? (
                  <Image
                    src="/admin-avatar.png"
                    width={64}
                    height={64}
                    alt="Admin Avatar"
                    className="rounded-full border border-purple-500/30 object-cover shadow-lg"
                  />
                ) : (
                  <GenieAvatar src={profileEditor.avatarUrl} alt="Selected Genie avatar" className="h-14 w-14 rounded-full border border-slate-200" />
                )}
                <div>
                  <h3 className="text-xs font-bold text-slate-800">{isMasterAdmin ? "Admin Avatar (read-only)" : "Avatar Selector"}</h3>
                  <p className="text-[10px] text-slate-500">
                    {isMasterAdmin ? "The primary administrator avatar cannot be changed." : "Select a Genie design or upload your own image."}
                  </p>
                </div>
              </div>
              {!isMasterAdmin && <fieldset className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["/avatars/Profile-1.png", "Option A: Profile 1", "Profile 1"],
                  ["/avatars/Profile-2.png", "Option B: Profile 2", "Profile 2"],
                  ["/avatars/Profile-3.png", "Option C: Profile 3", "Profile 3"],
                ] as const).map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={profileEditor.avatarUrl === value}
                    onClick={() => {
                      setProfileSaveError(null);
                      setProfileEditor((previous) => ({ ...previous, avatarUrl: value }));
                    }}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-colors ${
                      profileEditor.avatarUrl === value
                        ? "border-cyan-600 bg-cyan-50 ring-2 ring-cyan-100"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <GenieAvatar src={value} alt={description} className="h-10 w-10 rounded-full" />
                    <span className="text-[10px] font-bold text-slate-800">{label}</span>
                    <span className="text-[9px] leading-tight text-slate-500">{description}</span>
                  </button>
                ))}
              </div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                <ImagePlus className="h-4 w-4" />
                Upload PNG, JPG, or SVG (max 2 MB)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
                  className="sr-only"
                  onChange={(event) => {
                    void handleProfileAvatarFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {profileEditor.avatarUrl.startsWith("data:image/") && (
                <p className="text-center text-[10px] text-slate-500">Your upload is previewed in a circular crop.</p>
              )}
              </fieldset>}
            </section>
            {profileSaveError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{profileSaveError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditProfileOpen(false)}
                disabled={profileSaveBusy}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={profileSaveBusy}
                className="flex items-center gap-2 rounded-xl bg-cyan-800 px-4 py-2.5 text-xs font-bold text-white hover:bg-cyan-900 disabled:opacity-50"
              >
                {profileSaveBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Changes
              </button>
            </div>
          </form>
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
        {chatVaultOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setChatVaultOpen(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="chat-vault-title"
              className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 id="chat-vault-title" className="text-base font-bold text-slate-900">Chat Vault &amp; Restore Backups</h2>
                  <p className="mt-1 text-xs text-slate-500">Restore Genie archives or import a JSON or Markdown chat backup.</p>
                </div>
                <button type="button" onClick={() => setChatVaultOpen(false)} aria-label="Close Chat Vault" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {chatVaultError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{chatVaultError}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `Genie_Backup_${new Date().toISOString().slice(0, 10)}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Download className="h-4 w-4" /> Download JSON Backup
                </button>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-3 text-xs font-semibold text-cyan-800 hover:bg-cyan-100">
                  <FileUp className="h-4 w-4" /> Import JSON / Markdown
                  <input
                    type="file"
                    accept=".json,.md,.markdown,.txt"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (!file) return;
                      setChatVaultError(null);
                      const reader = new FileReader();
                      reader.onerror = () => setChatVaultError("The selected backup could not be read.");
                      reader.onload = () => {
                        try {
                          const content = String(reader.result || "");
                          let restoredSessions: ChatSession[];
                          if (/\.json$/i.test(file.name)) {
                            const parsed = JSON.parse(content) as unknown;
                            const records =
                              Array.isArray(parsed)
                                ? parsed
                                : parsed && typeof parsed === "object" && "sessions" in parsed && Array.isArray(parsed.sessions)
                                  ? parsed.sessions
                                  : null;
                            if (!records?.length) throw new Error("The JSON backup does not contain any chat sessions.");
                            restoredSessions = records.map((record) => {
                              if (!record || typeof record !== "object") throw new Error("The JSON backup contains an invalid session.");
                              const candidate = record as Partial<ChatSession>;
                              if (!Array.isArray(candidate.messages)) throw new Error("The JSON backup contains a session without messages.");
                              const messages = candidate.messages.filter(
                                (message): message is Message =>
                                  Boolean(message) &&
                                  (message.role === "user" || message.role === "assistant") &&
                                  typeof message.content === "string"
                              );
                              if (!messages.length) throw new Error("The JSON backup contains a session without valid messages.");
                              return {
                                id: typeof candidate.id === "string" ? candidate.id : window.crypto.randomUUID(),
                                title: typeof candidate.title === "string" ? candidate.title : "Imported Chat",
                                isPinned: Boolean(candidate.isPinned),
                                topicId: candidate.topicId,
                                messages: ensureMessageTimestamps(messages),
                              };
                            });
                          } else {
                            restoredSessions = parseMarkdownChatBackup(content).map((session) => ({
                              ...session,
                              messages: ensureMessageTimestamps(session.messages),
                            }));
                          }
                          setSessions(restoredSessions);
                          setCurrentSessionId(restoredSessions[0].id);
                          setIsTopicConversation(Boolean(restoredSessions[0].topicId));
                          setIsTeamMode(false);
                          setPersonalMessages(restoredSessions[0].messages);
                          localStorage.setItem("genie_chat_sessions_v2", JSON.stringify(restoredSessions));
                          setChatVaultOpen(false);
                        } catch (error) {
                          setChatVaultError(
                            error instanceof Error ? error.message : "The selected backup could not be imported."
                          );
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => {
                  setChatVaultOpen(false);
                  openArchiveRestore();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-3 text-xs font-semibold text-violet-800 hover:bg-violet-100"
              >
                <Cloud className="h-4 w-4" /> Restore Internal Genie Archives
              </button>
            </section>
          </div>
        )}
        {(visibleChatError || archiveError || archiveStatus || vipSessionLimitReached) && (
          <div
            role={visibleChatError || archiveError ? "alert" : "status"}
            className={`fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,48rem)] -translate-x-1/2 items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs shadow-xl ${
              visibleChatError || archiveError
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            <span className="min-w-0 break-words">
              {visibleChatError ||
                archiveError ||
                archiveStatus ||
                "All 20 concurrent VIP sessions are in use. This account is in the standard tier until a VIP session becomes available."}
            </span>
            {(visibleChatError || archiveError || archiveStatus) && (
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
        {!isCorporateDomain && socialInvites.length > 0 && (
          <div className="fixed right-4 top-16 z-[65] w-[min(92vw,22rem)] space-y-2">
            {socialInvites.map((invite) => (
              <section key={invite.invite_id} className="rounded-2xl border border-cyan-200 bg-white p-4 shadow-xl">
                <p className="text-xs font-semibold text-slate-800">{invite.sender_name} invited you to join their session</p>
                <p className="mt-1 truncate text-[10px] text-slate-500">{invite.room_title}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => void respondToSocialInvite(invite, true)} className="flex-1 rounded-lg bg-cyan-700 px-3 py-2 text-[11px] font-semibold text-white hover:bg-cyan-800">
                    Accept &amp; Join
                  </button>
                  <button type="button" onClick={() => void respondToSocialInvite(invite, false)} className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                    Decline
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
        {/* Mobile Backdrop Overlay */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          />
        )}

        {/* SECTION 3: SIDEBAR */}
        <aside
          className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-50 w-4/5 max-w-xs ${sidebarCollapsed ? "md:w-16" : "md:w-72"} md:static md:z-auto md:max-w-none md:translate-x-0 ${currentTheme.sidebarClass} backdrop-blur-xl border-r ${currentTheme.chromeBorderClass} transition-[width,transform] duration-300 ease-in-out flex flex-col overflow-hidden shadow-2xl md:shadow-none`}
        >
          <div className={`flex min-h-16 items-center gap-2 border-b p-3 ${currentTheme.chromeBorderClass}`}>
            <button
              type="button"
              onClick={toggleSidebar}
              className="shrink-0 rounded-lg p-2 text-slate-600 transition-colors hover:bg-white/70 hover:text-slate-900"
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className={`${sidebarCollapsed ? "md:hidden" : ""} min-w-0 flex-1`}>
              <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 bg-clip-text text-transparent truncate">
                Personal AI Genie
              </span>
            </div>
          </div>

          {sidebarCollapsed && (
            <nav aria-label="Sidebar shortcuts" className="hidden flex-1 flex-col items-center gap-2 py-3 md:flex">
              <button type="button" onClick={handleCreateNewChat} title="New chat" aria-label="New chat" className="rounded-xl p-2.5 text-slate-600 hover:bg-white/80">
                <Plus className="h-5 w-5" />
              </button>
              {!isCorporateDomain && (
                <button type="button" onClick={() => setFriendsQueueOpen(true)} title="Invite a friend" aria-label="Invite a friend" className="relative rounded-xl p-2.5 text-slate-600 hover:bg-white/80">
                  <UserPlus className="h-5 w-5" />
                  {pendingFriendRequests.length > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[9px] font-bold leading-4 text-white">
                      {pendingFriendRequests.length > 99 ? "99+" : pendingFriendRequests.length}
                    </span>
                  )}
                </button>
              )}
              <button type="button" onClick={() => setTrashOpen((open) => !open)} title="Trash" aria-label="Trash" className="rounded-xl p-2.5 text-slate-600 hover:bg-white/80">
                <Trash2 className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => setSettingsOpen(true)} title="Account & settings" aria-label="Account & settings" className="rounded-xl p-2.5 text-slate-600 hover:bg-white/80">
                <SettingsIcon className="h-5 w-5" />
              </button>
            </nav>
          )}

          {isCorporateDomain ? (
            <section className={`${sidebarCollapsed ? "md:hidden" : ""} border-b border-slate-200/80 p-3`}>
              <h2 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Organization Workspace</h2>
              <p className="text-[10px] leading-relaxed text-slate-600">
                Membership and profile identity are verified by your organization&apos;s Google Workspace tenant. Personal friend graphs and peer invites are disabled.
              </p>
              <button
                type="button"
                onClick={() => void loadFriendsQueue()}
                disabled={!isAuthenticated}
                className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-[10px] font-semibold text-slate-600 hover:bg-white/70 disabled:opacity-50"
              >
                Refresh tenant workspaces
              </button>
            </section>
          ) : (
          <section className={`${sidebarCollapsed ? "md:hidden" : ""} border-b border-slate-200/80 p-3`}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Directory &amp; Friends</h2>
              <button
                type="button"
                onClick={() => {
                  setFriendSearchOpen(true);
                  setFriendSearchEmail("");
                  setFriendSearchResult(null);
                  setFriendSearchNotFound(false);
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-slate-700"
              >
                <UserPlus className="h-3 w-3" /> Invite Friend
              </button>
            </div>
            <div className="max-h-24 space-y-1 overflow-y-auto">
              {discoverableFriends.slice(0, 4).map((friend) => (
                <div key={friend.user_id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[10px]">
                  <span className="rounded bg-slate-100 px-1 py-0.5 font-bold text-slate-500">G</span>
                  <span className={`h-2 w-2 rounded-full ${friend.is_online ? "bg-emerald-500" : "bg-slate-300"}`} />
                  <span className="min-w-0 flex-1 truncate text-slate-700">{friend.handle || friend.display_name}</span>
                  <span className="text-slate-400">{friend.is_online ? "Online" : "Offline"}</span>
                </div>
              ))}
              {userProfile.socialProfileId && (
                <div className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[10px]">
                  <span className="rounded bg-blue-50 px-1 py-0.5 font-bold text-blue-700">Meta</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="min-w-0 flex-1 truncate text-slate-700">{userProfile.socialHandle || "Linked Meta profile"}</span>
                  <span className="text-slate-400">Synced</span>
                </div>
              )}
              {!discoverableFriends.length && !userProfile.socialProfileId && (
                <p className="px-1.5 py-1 text-[10px] text-slate-400">Connect Google or Meta contacts to see their status.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFriendsQueueOpen(true)}
              disabled={!isAuthenticated}
              className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 hover:bg-white/70 disabled:opacity-50"
            >
              Manage friends and shared rooms
            </button>
          </section>
          )}

          <div className="hidden">
            <section className="rounded-xl border border-slate-200 bg-white/85 p-2.5">
              <h2 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Directory &amp; Friends</h2>
              <form onSubmit={(event) => void searchOmniDirectory(event)} className="flex gap-1.5">
                <input
                  value={omniSearchQuery}
                  onChange={(event) => {
                    setOmniSearchQuery(event.target.value);
                    setOmniSearchResults([]);
                    setOmniSearchNotFound(false);
                    setOmniSearchError(null);
                  }}
                  disabled={!isAuthenticated}
                  minLength={2}
                  placeholder="Search name or enter Gmail..."
                  aria-label="Search users by name or Gmail address"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] text-slate-800 outline-none focus:border-cyan-600 disabled:bg-slate-50"
                />
                <button
                  type="submit"
                  disabled={!isAuthenticated || omniSearchBusy || omniSearchQuery.trim().length < 2}
                  title="Search registered Genie users"
                  aria-label="Search users"
                  className="flex shrink-0 items-center justify-center rounded-lg bg-slate-900 px-2.5 text-white disabled:opacity-40"
                >
                  {omniSearchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </button>
              </form>
              {omniSearchError && <p role="status" className="mt-2 text-[10px] text-rose-600">{omniSearchError}</p>}
              {omniSearchNotFound && omniSearchQuery.includes("@") && (
                <button
                  type="button"
                  disabled={inviteEmailBusy}
                  onClick={() => void sendOnboardingInviteEmail(omniSearchQuery.trim())}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-2 py-2 text-[10px] font-bold text-cyan-800 disabled:opacity-50"
                >
                  {inviteEmailBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                  Send Invite Email
                </button>
              )}
              {inviteEmailStatus && <p role="status" className="mt-2 text-[10px] text-emerald-700">{inviteEmailStatus}</p>}
              {omniSearchResults.length > 0 && (
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {omniSearchResults.map((user) => (
                    <div key={user.user_id} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <GenieAvatar src={user.avatar_url} alt={user.display_name} className="h-7 w-7 shrink-0 rounded-full" />
                        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800">{user.display_name}</span>
                        {user.relationship === "friend" && <span className="text-[9px] font-bold text-emerald-700">Friend</span>}
                      </div>
                      {user.relationship !== "friend" && (
                        <div className="mt-1.5 flex gap-1.5">
                          <button
                            type="button"
                            disabled={user.relationship === "following" || user.relationship === "request_sent"}
                            onClick={() => void updateSocialRelationship(user, "follow")}
                            className="flex-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[9px] font-semibold text-slate-700 disabled:opacity-50"
                          >
                            {user.relationship === "following" ? "Following" : "Follow"}
                          </button>
                          <button
                            type="button"
                            disabled={user.relationship === "request_sent" || user.relationship === "request_received"}
                            onClick={() => void updateSocialRelationship(user, "friend-request")}
                            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-cyan-800 px-1.5 py-1 text-[9px] font-semibold text-white disabled:opacity-50"
                          >
                            {user.relationship !== "request_sent" && user.relationship !== "request_received" && <UserPlus className="h-3 w-3" />}
                            {user.relationship === "request_sent" ? "Requested" : user.relationship === "request_received" ? "Respond below" : "+ Add Friend"}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="rounded-xl border border-slate-200 bg-white/85 p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Friends Queue</h2>
                <span className="text-[9px] text-slate-500">{discoverableFriends.filter((friend) => friend.is_online).length} online</span>
              </div>
              {pendingFriendRequests.length > 0 && (
                <div className="mb-2 space-y-1.5 border-b border-slate-100 pb-2">
                  {pendingFriendRequests.map((request) => (
                    <div key={request.user_id} className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[10px] text-slate-700">{request.display_name} wants to connect</span>
                      <button type="button" onClick={() => void respondToFriendRequest(request, true)} className="text-[9px] font-bold text-emerald-700">Accept</button>
                      <button type="button" onClick={() => void respondToFriendRequest(request, false)} className="text-[9px] font-semibold text-slate-400">Decline</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {discoverableFriends.length ? discoverableFriends.map((friend) => {
                  const busyElsewhere = friend.is_online && (!isTeamMode || friend.active_room_id !== roomId);
                  const availableHere = friend.is_online && !busyElsewhere;
                  return (
                  <div key={friend.user_id} className="flex items-center gap-2 rounded-lg px-1 py-1">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${availableHere ? "bg-emerald-500" : busyElsewhere ? "bg-rose-500" : "bg-slate-300"}`} aria-label={availableHere ? "Available in this room" : busyElsewhere ? "Busy in another room" : "Offline"} />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-slate-700">{friend.handle || friend.display_name}</span>
                    {busyElsewhere ? (
                      <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[8px] font-semibold text-rose-700">In Another Room / Busy in Session</span>
                    ) : (
                      <span className={`shrink-0 text-[9px] ${availableHere ? "text-emerald-700" : "text-slate-400"}`}>{availableHere ? "Available" : "Offline"}</span>
                    )}
                    {availableHere && (
                      <button
                        type="button"
                        disabled={!isTeamMode}
                        onClick={() => void sendRoomInvite(friend)}
                        title={!isTeamMode ? "Start a share room before inviting" : `Invite ${friend.display_name}`}
                        className="shrink-0 rounded-md border border-cyan-200 px-1.5 py-1 text-[9px] font-bold text-cyan-800 disabled:opacity-40"
                      >
                        + Invite
                      </button>
                    )}
                  </div>
                  );
                }) : <p className="px-1 py-2 text-[10px] text-slate-400">{isAuthenticated ? "Accepted mutual friends appear here." : "Sign in to view your friends."}</p>}
              </div>
              <button type="button" onClick={() => setFriendsQueueOpen(true)} disabled={!isAuthenticated} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[9px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                Manage friends &amp; rooms
              </button>
            </section>
          </div>

          <div className={`${sidebarCollapsed ? "md:hidden" : ""} flex-1 overflow-y-auto px-3 space-y-1`}>
            {!isCorporateDomain && !isTeamMode && (
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
                          stopCurrentChatGeneration();
                          setActiveTopicId(topic.id);
                          setIsTopicConversation(true);
                          setIsTeamMode(false);
                          setPrompt("");
                          if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
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
                      {!isObserverActive && (
                        <button
                          type="button"
                          onClick={() => void clearTopicChannel(topic)}
                          title={`Clear ${topic.title} history`}
                          aria-label={`Clear ${topic.title} history`}
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
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
                {topicError && <p role="status" className="mt-2 text-[10px] text-rose-600">{topicError}</p>}
              </section>
            )}
            {!isCorporateDomain && (
              <div className="flex items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <span>Personal Chats</span>
                <button
                  type="button"
                  onClick={() => {
                    setFriendSearchOpen(true);
                    setFriendSearchEmail("");
                    setFriendSearchResult(null);
                    setFriendSearchNotFound(false);
                  }}
                  title="Invite a friend"
                  aria-label="Invite a friend"
                  className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-cyan-700"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <section className="mb-2">
              <button
                type="button"
                onClick={() => setSharedChatsOpen((open) => !open)}
                aria-expanded={sharedChatsOpen}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:bg-white/60"
              >
                <span className="flex items-center gap-2"><Users className="h-3.5 w-3.5" /> Shared Chats</span>
                {sharedChatsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {sharedChatsOpen && (
                <div className="space-y-0.5">
                  {sovereignRooms.map((room) => {
                    const activeParticipants = room.members.filter((member) => member.status === "active").length;
                    return (
                      <button
                        key={room.room_id}
                        type="button"
                        onClick={() => openSovereignRoom(room)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-600 hover:bg-white/70"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                        <span className="min-w-0 flex-1 truncate">{room.title}</span>
                        <span className="shrink-0 text-[9px] text-slate-400" title={`${activeParticipants} active participants`}>
                          {activeParticipants} active
                        </span>
                      </button>
                    );
                  })}
                  {sessions.filter((session) => !isCorporateDomain && session.isSharedArchive && !session.isDeleted).map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => handleSelectSession(session)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-600 hover:bg-white/70"
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-cyan-600" />
                      <span className="min-w-0 flex-1 truncate">{session.title}</span>
                      <span className="shrink-0 text-[9px] text-slate-400">Shared</span>
                    </button>
                  ))}
                  {!sovereignRooms.length && (isCorporateDomain || !sessions.some((session) => session.isSharedArchive && !session.isDeleted)) && (
                    <p className="px-3 py-1.5 text-[10px] text-slate-400">No shared chats yet.</p>
                  )}
                </div>
              )}
            </section>

            {!isCorporateDomain && sessions.filter((session) => !session.isDeleted && !session.isSharedArchive).map((session) => (
              <div
                key={session.id}
                onClick={() => handleSelectSession(session)}
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
                  {session.isArchived && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold uppercase text-amber-800">Archived</span>}
                </div>

                <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShareSessionId(session.id);
                      setShareInviteSessionId(`${session.id}_${window.crypto.randomUUID()}`);
                      setShareModalOpen(true);
                    }}
                    title="Invite to this chat"
                    aria-label={`Invite friend to ${session.title}`}
                    className="rounded p-1 text-slate-400 hover:bg-cyan-50 hover:text-cyan-700"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                  {!isObserverActive && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void softDeleteSession(session);
                      }}
                      title="Move to trash"
                      aria-label={`Move ${session.title} to trash`}
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
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
                      {!isObserverActive && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void softDeleteSession(session);
                            setActiveMenuId(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-500" /> Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!isCorporateDomain && <button
              type="button"
              onClick={() => setTrashOpen((open) => !open)}
              className="mt-2 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[11px] font-semibold text-slate-500 hover:bg-white/70"
            >
              <span className="flex items-center gap-2"><Trash2 className="h-3.5 w-3.5" /> Trash / Recently Deleted</span>
              <span>{trashSessions.length}</span>
            </button>}
            {!isCorporateDomain && trashOpen && (
              <div className="mb-2 space-y-1 rounded-xl border border-slate-200 bg-white/70 p-2">
                {trashSessions.length ? trashSessions.map((deletedSession) => {
                  const deletedAt = deletedSession.deletedAt ? new Date(deletedSession.deletedAt).getTime() : Date.now();
                  const remainingDays = Math.max(0, 30 - Math.floor((Date.now() - deletedAt) / 86400000));
                  return (
                    <div key={deletedSession.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-[10px] text-slate-600" title={deletedSession.title}>
                            {deletedSession.title} · moved by {deletedSession.deletedBy || "You"} · {remainingDays}d
                      </span>
                          <div className="flex shrink-0 items-center gap-2">
                            <button type="button" onClick={() => void restoreSession(deletedSession)} title="Restore" className="text-[10px] font-semibold text-cyan-700 hover:underline">
                              Restore
                            </button>
                            {!isObserverActive && (
                              <button type="button" onClick={() => void permanentlyDeleteSession(deletedSession)} title="Delete permanently" aria-label={`Delete ${deletedSession.title} permanently`} className="text-rose-600 hover:text-rose-800">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                    </div>
                  );
                }) : <p className="px-2 py-1 text-[10px] text-slate-400">Trash is empty.</p>}
              </div>
            )}
          </div>

          <div className={`${sidebarCollapsed ? "md:hidden" : ""} mt-auto space-y-2 border-t p-3 ${currentTheme.chromeBorderClass} ${currentTheme.chromeClass}`}>
            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => setLegalModalOpen(true)}
                className="text-[10px] text-slate-500 hover:text-purple-700 underline font-medium"
              >
                Disclaimer &amp; Terms
              </button>
            </div>
            {!isCorporateDomain && (
              <button
                type="button"
                onClick={() => setChatVaultOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-white"
              >
                <Cloud className="h-4 w-4" />
                Chat Vault &amp; Restore Backups
              </button>
            )}

            <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white/70 p-2">
              {isCorporateDomain ? (
                <GenieBrandAvatar
                  mode="workspace"
                  corporatePhotoUrl={corporateAvatarUrl}
                  corporateName={userProfile.name}
                  tenantId={corporateTenantId}
                  className="h-9 w-9 shrink-0 rounded-full"
                  label={userProfile.name}
                />
              ) : (
                <GenieAvatar
                  src={profileAvatar}
                  alt={userProfile.name}
                  className={`h-9 w-9 shrink-0 rounded-full border ${selectedTheme.borderClass}`}
                />
              )}
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-bold leading-tight text-slate-800">{userProfile.name}</span>
                <span className="block truncate text-[9px] text-slate-500">{userProfile.email || "Guest"}</span>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="shrink-0 rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                title="Settings"
                aria-label="Settings"
              >
                <SettingsIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="fixed left-3 top-3 z-30 rounded-xl border border-slate-200 bg-white/95 p-2 text-slate-700 shadow-md transition-all hover:bg-white md:hidden"
          title="Open navigation"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* SECTION 4: MAIN HEADER & WORKSPACE */}
        <main className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-b ${currentTheme.canvasGradientClass}`}>
          <HeaderBar
            spaceMode={spaceMode}
            onSpaceModeChange={handleSpaceModeChange}
            isTeamMode={isTeamMode}
            onToggleTeamMode={handleToggleTeamMode}
            isCorporateDomain={isCorporateDomain}
            workspaceName={isCorporateDomain ? "Corp Active" : spaceMode === "workspace" ? "Workspace" : "Personal"}
            profileGender={userProfile.gender}
            userEmail={userProfile.email}
            isPrimaryVip={isMasterAdmin}
            isAdmin={isSuperAdminVerified}
            corporateAvatarUrl={corporateAvatarUrl}
            corporateDisplayName={userProfile.name}
            corporateTenantId={corporateTenantId}
            activeMemberCount={activeRoomMemberCount}
            members={members.map((member) => ({
              id: member.id,
              name: member.name,
              role: member.role,
              isOriginAdmin: member.is_origin_admin,
              avatarUrl: member.avatarUrl,
              status: member.status,
            }))}
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
            onStartVoiceCall={startVoiceCall}
            onStartRoomCall={() => startVoiceCall(true)}
            isCallActive={isVoiceCallOpen}
            callStartedAt={voiceCallStartedAt}
            onEndActiveCall={endActiveCallFromHeader}
            onClaimVip={claimVipSecretPass}
            canAccessVoiceCall={hasVoiceCallAccess}
            onOpenSettings={() => setSettingsOpen(true)}
            isAuthenticated={isAuthenticated}
            isRoomHost={isCurrentRoomHost}
            canInviteMembers={!isCorporateDomain && (!isTeamMode || canManageRoomPolicy)}
            onPurgeContext={purgeLocalChatContext}
            onCopyInvite={(mode) => void copyHeaderInvite(mode)}
            onLeaveRoom={handleExitRoomToPersonal}
            onEndRoom={() => void endActiveRoom()}
            isSuperAdmin={isSuperAdminVerified}
            adminTelemetry={isSuperAdminVerified ? adminTelemetry : null}
            adminTelemetryError={adminTelemetryError}
          />
          {realtimeToast && (
            <div
              role="status"
              aria-live="polite"
              className="fixed right-4 top-4 z-[130] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-cyan-900/30 bg-slate-950 p-4 text-white shadow-2xl"
            >
              <p className="text-sm font-semibold">
                {realtimeToast.type === "friend"
                  ? `${realtimeToast.displayName} sent you a friend request`
                  : `${realtimeToast.displayName} invited you to a voice call`}
              </p>
              <div className="mt-3 flex justify-end gap-2">
                {realtimeToast.type === "friend" ? (
                  <>
                    <button type="button" onClick={() => void respondToRealtimeFriendRequest(true)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold hover:bg-emerald-500">Accept</button>
                    <button type="button" onClick={() => void respondToRealtimeFriendRequest(false)} className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-bold hover:bg-rose-600">Decline</button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (realtimeToast.roomId === roomId && realtimeToast.callId) {
                          if (canAccessVoiceCall()) {
                            if (!sendRoomEvent({ type: "USER_JOINED_CALL", call_id: realtimeToast.callId })) return;
                            setActiveRoomVoiceCallId(realtimeToast.callId);
                            setJoinedRoomVoiceCallId(realtimeToast.callId);
                            setVoiceCallStartedAt(new Date().toISOString());
                            setVoiceCallId(realtimeToast.callId);
                            setIsVoiceCallOpen(true);
                          } else {
                            startVoiceCall();
                          }
                        } else {
                          setFriendsQueueError("Open the invited room before accepting its call.");
                        }
                        setRealtimeToast(null);
                      }}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold hover:bg-emerald-500"
                    >
                      Join Call 🟢
                    </button>
                    <button type="button" onClick={() => setRealtimeToast(null)} className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-bold hover:bg-slate-600">Dismiss ✕</button>
                  </>
                )}
                {realtimeToast.type === "friend" && (
                  <button type="button" onClick={() => setRealtimeToast(null)} aria-label="Dismiss notification" className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10">Later ✕</button>
                )}
              </div>
            </div>
          )}
          {securityToast && (
            <div
              role="status"
              aria-live="polite"
              className="absolute right-4 top-16 z-50 max-w-sm rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950 shadow-xl"
            >
              {securityToast}
              <button
                type="button"
                onClick={() => setSecurityToast(null)}
                className="ml-3 font-bold underline underline-offset-2"
                aria-label="Dismiss security notice"
              >
                Dismiss
              </button>
            </div>
          )}
          {isVoiceCallOpen && canAccessVoiceCall() && (
            <VoiceCallModal
              key={voiceCallId}
              callId={voiceCallId}
              isTeamMode={isTeamMode}
              contextMode={spaceMode}
              participants={isTeamMode
                ? (voiceCallParticipants.length ? voiceCallParticipants : members.filter((member) => member.status === "active"))
                  .map((member) => ({ id: member.id, name: member.name, avatarUrl: member.avatarUrl }))
                : []}
              currentUser={{
                id: roomIdentity || googleIdToken || "guest",
                name: userProfile.name || "Guest User",
                avatarUrl: effectiveUserAvatar,
              }}
              remoteTurns={remoteVoiceTurns}
              languageCode={selectedLang.code}
              languageLabel={selectedLang.label}
              onCopyInvite={() => void copyHeaderInvite(spaceMode)}
              onPingFriend={() => setFriendsQueueOpen(true)}
              onLanguageChange={changeVoiceCallLanguage}
              onSubmitTurn={submitVoiceCallTurn}
              onBroadcastTurn={broadcastVoiceTurn}
              onEndCall={(transcript) => void handleVoiceCallEnd(transcript)}
            />
          )}

          {/* SECTION 5: CHAT THREAD & CANVAS */}
          <div className="flex-1 min-h-0 flex relative overflow-hidden">
            {isTeamMode && roomMemberCount > 1 && (
              <aside
                aria-label="Room participant presence"
                className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/85 p-2 shadow-lg backdrop-blur-md md:flex"
              >
                {members.map((member) => (
                  <div key={member.id} className="relative" title={`${member.name}: ${
                    member.status === "active" ? "active in this room" :
                    member.status === "different_room" ? "active in another room" : "offline or idle"
                  }`}>
                    <GenieAvatar
                      src={member.avatarUrl || "/default-avatar.png"}
                      alt={member.name}
                      className={`h-9 w-9 rounded-full border border-slate-200 ${activeVoiceSpeakerId === member.id ? "animate-pulse ring-2 ring-cyan-400 ring-offset-2" : ""}`}
                    />
                    <span
                      className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                        member.status === "active" ? "bg-emerald-500" :
                        member.status === "different_room" ? "bg-rose-500" : "bg-amber-400"
                      }`}
                    />
                  </div>
                ))}
              </aside>
            )}
            <div
              id="chat-transcript"
              ref={messageScrollRef}
              onScroll={handleMessageScroll}
              className={`flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-4 sm:py-6 transition-all md:pr-16 ${activeCanvas ? "w-1/2 pr-2" : "w-full"}`}
            >
              {mounted && !isTeamMode && !isTopicConversation && currentSession && (
                <SessionMetadataBar
                  session={{
                    id: currentSession.id,
                    title: currentSession.title,
                    createdAt: currentSession.createdAt || currentSession.messages[0]?.timestamp || new Date().toISOString(),
                    isArchived: currentSession.isArchived,
                    messages,
                  }}
                  onRename={(newTitle) => {
                    setSessions((previous) => previous.map((session) =>
                      session.id === currentSession.id ? { ...session, title: newTitle } : session
                    ));
                  }}
                  onShare={() => {
                    setShareSessionId(currentSession.id);
                    setShareInviteSessionId(`${currentSession.id}_${window.crypto.randomUUID()}`);
                    setShareModalOpen(true);
                  }}
                  onExport={exportCurrentSessionTranscript}
                  onExportDocument={(format, selectedOnly) => {
                    if (selectedOnly) return;
                    exportSessionDocument(format, false);
                  }}
                  onSelectMessages={beginMessageSelection}
                  isObserverOn={isObserverActive}
                  participantCount={1}
                  onArchive={archiveCurrentSession}
                  onAutoArchive={() => void exportAndArchiveCurrentSession()}
                  onWipeClientCache={wipeClientCacheAndTokens}
                  onFullEphemeralReset={fullEphemeralReset}
                  onForkCurrentMessage={() => duplicateCurrentTranscript(true)}
                  onCloneTranscript={() => duplicateCurrentTranscript(false)}
                />
              )}
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
                  <GenieBrandAvatar
                    gender={userProfile.gender}
                    label={`${userProfile.name}'s Genie`}
                    className="mb-4 h-16 w-16 rounded-full shadow-lg"
                  />
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
                  {messages.map((msg, index) => {
                    const readStatus = isTeamMode
                      ? getRoomMessageReadStatus(msg, members)
                      : null;
                    return (
                    <div
                      key={msg.id || index}
                      className={`group flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                      onClick={(event) => {
                        if (!isSelectionMode) return;
                        const target = event.target as HTMLElement;
                        if (target.closest("[data-message-bubble]")) {
                          toggleMessageSelection(msg, index);
                        }
                      }}
                      onTouchStart={(event) => startLongPress(event, msg, index)}
                      onTouchEnd={cancelLongPress}
                      onTouchCancel={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      onContextMenu={(event) => {
                        if (!isSelectionMode && (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768)) {
                          event.preventDefault();
                          const bounds = event.currentTarget.getBoundingClientRect();
                          openLongPressMenu(msg, index, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
                          cancelLongPress();
                        }
                      }}
                    >
                      {msg.role === "assistant" ? (
                        <span className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold text-slate-600">
                          <BrandAvatar
                            variant={msg.avatarSrc === "/avatars/Genie PRO.png" ? "faceless-weaver" : getAssistantPersona(msg).variant}
                            className="h-5 w-5"
                            label={msg.isCallRecord || msg.isVoiceSessionSummary ? "Genie Master" : "Genie response"}
                          />
                          {msg.isCallRecord || msg.isVoiceSessionSummary ? "Genie Master" : getAssistantPersona(msg).badge}
                        </span>
                      ) : isTeamMode && msg.senderName ? (
                        <span className="mb-1 max-w-[85%] truncate px-1 text-[10px] font-semibold text-slate-500">
                          {msg.senderName}
                        </span>
                      ) : null}

                      {msg.role === "user" ? (
                        <div className={`flex max-w-full items-start gap-2 ${isTeamMode ? "flex-row-reverse" : "flex-col items-end"}`}>
                          {isTeamMode && (
                            <GenieAvatar
                              src={members.find((member) => member.id === msg.sender_id)?.avatarUrl || (msg.sender_id === roomIdentity ? profileAvatar : "")}
                              alt={`${msg.senderName || userProfile.name}'s avatar`}
                              className="mt-1 h-8 w-8 shrink-0 rounded-full border border-slate-200"
                            />
                          )}
                          <div
                            data-message-bubble
                            className={`group relative max-w-[85%] rounded-2xl px-4 py-3 text-sm text-white rounded-br-none shadow-sm space-y-1 ${
                              selectedMessageIds.has(getMessageSelectionId(msg, index))
                                ? "ring-2 ring-indigo-500/50 "
                                : ""
                            }${
                              msg.triggeredByRainbow
                                ? "bg-gradient-to-r from-violet-600 via-pink-600 to-indigo-600 border border-amber-300"
                                : `bg-gradient-to-r ${selectedTheme.gradientClass}`
                            }`}
                          >
                            {isSelectionMode && (
                              <input
                                type="checkbox"
                                checked={selectedMessageIds.has(getMessageSelectionId(msg, index))}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleMessageSelection(msg, index)}
                                aria-label={`Select message ${index + 1}`}
                                className="absolute -left-8 top-3 h-4 w-4 accent-indigo-600"
                              />
                            )}
                            {msg.isForwarded && <span className="block text-[10px] font-semibold opacity-75">Forwarded from {msg.forwardedFrom || "another chat"}</span>}
                            {msg.replyTo && (
                              <div className="bg-white/20 border-l-2 border-white/50 p-2 rounded text-xs text-white/90 mb-1">
                                <span className="font-bold block text-[10px]">
                                  Replying to {msg.replyTo.author}
                                </span>
                                <span className="truncate block opacity-90">{msg.replyTo.content}</span>
                              </div>
                            )}
                            {editingMessageId === (msg.id || String(index)) ? (
                              <div id="room-member-roster" className="space-y-2">
                                <textarea
                                  value={editDraft}
                                  onChange={(event) => setEditDraft(event.target.value)}
                                  className="w-full min-w-48 rounded-lg border border-white/40 bg-white/15 p-2 text-sm text-white outline-none"
                                  aria-label="Edit message"
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => setEditingMessageId(null)}
                                    className="rounded px-2 py-1 text-xs text-white/80 hover:bg-white/15"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => void handleEditMessage(msg, index)}
                                    className="rounded bg-white/20 px-2 py-1 text-xs font-semibold text-white hover:bg-white/30"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : msg.callTranscript ? (
                              <section className="space-y-3">
                                <header className="border-b border-slate-200 pb-2">
                                  <h3 className="font-bold text-slate-900">
                                    📞 Genie Master Voice Session Summary
                                  </h3>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {Math.floor(msg.callTranscript.durationSeconds / 60)}m {msg.callTranscript.durationSeconds % 60}s
                                    {" · "}{msg.callTranscript.dialect}
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    Participants: {msg.callTranscript.participants.map((participant) => participant.name).join(", ") || "You"}
                                  </p>
                                  <div className="mt-2 flex items-center gap-2">
                                    <span className="text-[10px] font-semibold text-slate-500">Export:</span>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        exportSessionDocument(
                                          "pdf",
                                          false,
                                          new Set(),
                                          [msg],
                                          `${roomTitle} - Genie Master Call`,
                                        );
                                      }}
                                      className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                                    >
                                      PDF
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        exportSessionDocument(
                                          "docx",
                                          false,
                                          new Set(),
                                          [msg],
                                          `${roomTitle} - Genie Master Call`,
                                        );
                                      }}
                                      className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                                    >
                                      Word
                                    </button>
                                  </div>
                                </header>
                                <ol className="space-y-2">
                                  {msg.callTranscript.turns.map((turn) => (
                                    <li key={turn.id} className="flex items-start gap-2">
                                      {turn.role === "assistant" ? (
                                        <BrandAvatar variant="cosmic-shadow" className="mt-0.5 h-6 w-6 shrink-0" label="Genie Master" />
                                      ) : (
                                        <GenieAvatar
                                          src={turn.userAvatar || undefined}
                                          alt={turn.userName}
                                          className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
                                        />
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-baseline gap-x-2">
                                          <span className="text-xs font-semibold text-slate-700">
                                            {turn.role === "assistant" ? "Genie Master" : turn.userName}
                                          </span>
                                          <time className="text-[10px] text-slate-400">
                                            {new Date(turn.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                          </time>
                                        </div>
                                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{turn.text}</p>
                                      </div>
                                    </li>
                                  ))}
                                </ol>
                              </section>
                            ) : (
                              <p className={`whitespace-pre-wrap ${msg.is_deleted ? "italic opacity-75" : ""}`}>
                                {msg.content}
                                {msg.is_edited && !msg.is_deleted && (
                                  <span className="ml-2 text-[10px] opacity-70">(edited)</span>
                                )}
                              </p>
                            )}
                            <div className="mt-1 flex justify-end">
                              {isTeamMode && msg.sender_id === roomIdentity && readStatus && (
                                readStatus.isReadByAll ? (
                                  <span
                                    className="inline-flex items-center gap-1 rounded border border-emerald-200/50 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-400"
                                    title="Read by all room members"
                                  >
                                    <CheckCheck className="h-3 w-3" />
                                    Read by all
                                  </span>
                                ) : (
                                  <span className="self-end text-[10px] text-slate-400">
                                    Seen by {readStatus.seenCount}/{readStatus.activeCount}
                                  </span>
                                )
                              )}
                              <span className="ml-2 select-none self-end text-[10px] text-gray-400">
                                {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          </div>
                          {renderMessageActionBar(msg, index)}
                        </div>
                      ) : (
                        <div className="flex w-full max-w-[85%] items-start gap-2">
                          <div className="min-w-0 flex-1 space-y-1.5">
                          <div data-message-bubble className="relative w-full">
                          {isSelectionMode && (
                            <input
                              type="checkbox"
                              checked={selectedMessageIds.has(getMessageSelectionId(msg, index))}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleMessageSelection(msg, index)}
                              aria-label={`Select message ${index + 1}`}
                              className="absolute left-0 top-3 z-10 h-4 w-4 accent-indigo-600"
                            />
                          )}
                          <MessageBubble
                            className={`group relative max-w-full rounded-2xl rounded-bl-none px-4 py-3 text-sm leading-relaxed border shadow-sm ${
                              selectedMessageIds.has(getMessageSelectionId(msg, index))
                                ? "ring-2 ring-indigo-500/50 "
                                : ""
                            }${
                              msg.isIntervention || msg.senderName?.includes("Intervention")
                                ? `${selectedTheme.bgLightClass} ${selectedTheme.textClass} ${selectedTheme.borderClass}`
                                : "bg-white text-slate-800 border-slate-200"
                            }`}
                          >
                            {msg.isForwarded && <p className="mb-1 text-[10px] font-semibold text-slate-500">Forwarded from {msg.forwardedFrom || "another chat"}</p>}
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
                            <div className="mt-1 flex justify-end">
                              <span className="ml-2 select-none self-end text-[10px] text-gray-400">
                                {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          </MessageBubble>
                          </div>
                          {renderMessageActionBar(msg, index)}

                          {/* Host Intervention Trigger */}
                          {isKeyOwner && isTeamMode && (
                            <button
                              onClick={() => handleHostIntervention(index)}
                              className="mt-1 flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors"
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
                    );
                  })}

                  {longPressMenu && (
                    <div className="fixed inset-0 z-[80] bg-black/20 md:hidden" onClick={() => setLongPressMenu(null)}>
                      <div
                        role="menu"
                        aria-label="Message actions"
                        style={{ left: longPressMenu.x, top: longPressMenu.y }}
                        className="absolute flex min-w-48 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {longPressMenu.message.role === "user" && (!isTeamMode || longPressMenu.message.sender_id === roomIdentity) && (
                          <>
                            <button role="menuitem" type="button" onClick={() => { handleCopyMessage(longPressMenu.message.content, longPressMenu.index); setLongPressMenu(null); }} className="px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">Copy</button>
                            <button role="menuitem" type="button" onClick={() => { setEditingMessageId(longPressMenu.message.id || String(longPressMenu.index)); setEditDraft(longPressMenu.message.content); setLongPressMenu(null); }} className="px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">Edit</button>
                            {!isObserverActive && !longPressMenu.message.isVoiceRecord && (
                              <button role="menuitem" type="button" onClick={() => { void handleDeleteMessage(longPressMenu.message, longPressMenu.index); setLongPressMenu(null); }} className="px-3 py-2 text-left text-xs font-medium text-rose-700 hover:bg-rose-50">Delete</button>
                            )}
                          </>
                        )}
                        {longPressMenu.message.role === "assistant" && !longPressMenu.message.is_deleted && (
                          <>
                            <button role="menuitem" type="button" onClick={() => { handleCopyMessage(longPressMenu.message.content, longPressMenu.index); setLongPressMenu(null); }} className="px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">Copy</button>
                            {!(isTeamMode && roomMemberCount > 1) && (
                              <button role="menuitem" type="button" disabled={isStreaming} onClick={() => { handleReloadMessage(longPressMenu.message, longPressMenu.index); setLongPressMenu(null); }} className="px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Regenerate</button>
                            )}
                            <button role="menuitem" type="button" onClick={() => { void handlePlayAudio(longPressMenu.message.content, longPressMenu.message.id || String(longPressMenu.index)); setLongPressMenu(null); }} className="px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">Text-to-Speech</button>
                            <button role="menuitem" type="button" onClick={() => { void handleReportAIMistake(longPressMenu.message); setLongPressMenu(null); }} className="px-3 py-2 text-left text-xs font-medium text-rose-700 hover:bg-rose-50">Report AI Mistake</button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {isStreaming && (
                    streamingPreview ? (
                      <div className="flex w-full items-start gap-2">
                        <BrandAvatar variant="cosmic-shadow" className="mt-1 h-8 w-8" label="Genie" />
                        <MessageBubble
                          className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-none border border-cyan-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 shadow-sm"
                        >
                          {streamingPreview}
                        </MessageBubble>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 rounded-2xl border border-cyan-200/70 bg-white/90 p-3 shadow-[0_0_24px_rgba(14,165,233,0.12)]">
                        <BrandAvatar variant="cosmic-shadow" className="h-9 w-9 animate-pulse" label="Genie" />
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

          <button
            type="button"
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
            aria-label="Scroll to latest message"
            title="Scroll to bottom"
            className={`absolute bottom-36 right-5 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg backdrop-blur transition-all duration-200 hover:bg-indigo-50 hover:text-indigo-700 ${
              isScrolledUp
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-2 opacity-0"
            }`}
          >
            <ArrowDown className="h-5 w-5" />
          </button>
          {isSelectionMode && (
            <div className="absolute inset-x-0 bottom-0 z-40 border-t border-indigo-200 bg-white/95 px-3 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur-md">
              <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-slate-700">
                    {selectedMessageIds.size} messages selected
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedMessageIds(new Set(
                      messages
                        .map((message, index) => ({ message, index }))
                        .filter(({ message }) => !message.is_deleted)
                        .map(({ message, index }) => getMessageSelectionId(message, index)),
                    ))}
                    className="text-xs font-semibold text-indigo-700 hover:underline"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMessageIds(new Set())}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 hover:underline"
                  >
                    Deselect All
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelMessageSelection}
                    className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={completeMessageSelectionExport}
                    disabled={selectedMessageIds.size === 0}
                    className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Download {selectedExportFormat === "pdf" ? "PDF" : "Word (.doc)"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {pendingCallTranscript && (
            <div className="absolute inset-x-4 bottom-4 z-40 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur-md">
              <p className="text-sm text-slate-700">
              Call ended. Would you like to save this call log to your session?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPendingCallTranscript(null)}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Dismiss
                </button>
                {(!isTeamMode || (spaceMode === "personal" ? isCurrentRoomHost : isCurrentRoomOriginAdmin)) && (
                  <button
                    type="button"
                    onClick={savePendingCallTranscript}
                    className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    Save Call Log
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Floating Show Input Dock Pill */}
          {isDockHidden && !isSelectionMode && (
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
            <div className={`flex-shrink-0 w-full px-2 sm:px-4 py-2 sm:py-3 bg-white/95 backdrop-blur-md border-t ${selectedTheme.borderClass} shadow-lg transition-transform duration-300 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${isSelectionMode ? "hidden" : ""}`}>
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
                  <button
                    type="button"
                    onClick={() => {
                      setMessageSearchMode((mode) => mode === "ai" ? null : "ai");
                      setMessageSearchQuery("");
                    }}
                    aria-pressed={messageSearchMode === "ai"}
                    title="Search AI Mode transcripts"
                    className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-bold sm:text-[10px] ${messageSearchMode === "ai" ? "border-violet-300 bg-violet-50 text-violet-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    <span className="relative inline-flex">
                      <Search className="h-3.5 w-3.5" />
                      <Sparkles className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 animate-spin text-fuchsia-600" />
                    </span>
                    AI Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMessageSearchMode((mode) => mode === "chat" ? null : "chat");
                      setMessageSearchQuery("");
                    }}
                    aria-pressed={messageSearchMode === "chat"}
                    title="Search local chat history"
                    className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-bold sm:text-[10px] ${messageSearchMode === "chat" ? "border-cyan-300 bg-cyan-50 text-cyan-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    <Search className="h-3.5 w-3.5" />
                    Chat Mode
                  </button>
                </div>

                <span className={`hidden xs:inline text-[10px] ${selectedTheme.textClass} font-semibold truncate`}>
                  Type @Genie to query
                </span>
              </div>

              {messageSearchMode && (
                <div className="mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  <div className="flex items-center gap-2 border-b border-slate-100 p-2">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      autoFocus
                      value={messageSearchQuery}
                      onChange={(event) => setMessageSearchQuery(event.target.value)}
                      placeholder={messageSearchMode === "ai" ? "Search Genie and Genie Pro responses…" : "Search local user chat history…"}
                      aria-label={messageSearchMode === "ai" ? "Search AI mode transcripts" : "Search user chat history"}
                      className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 outline-none"
                    />
                    <button type="button" onClick={() => { setMessageSearchMode(null); setMessageSearchQuery(""); }} aria-label="Close message search" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                  </div>
                  {messageSearchQuery.trim() && (
                    <div className="max-h-64 overflow-y-auto p-2">
                      {messageSearchMode === "chat" ? (
                        <>
                        <SearchMessageGroup
                          title="Matches in User Chats"
                          items={chatSearchMatches}
                          onSelect={(message) => {
                            openSearchResult(message);
                            setMessageSearchMode(null);
                          }}
                        />
                        <SearchMessageGroup
                          title="Matches in AI Mode"
                          items={aiSearchMatches}
                          onSelect={(message) => {
                            openSearchResult(message);
                            setMessageSearchMode(null);
                          }}
                        />
                        </>
                      ) : (
                        <>
                        <SearchMessageGroup
                          title="Matches in AI Mode"
                          items={aiSearchMatches}
                          onSelect={(message) => {
                            openSearchResult(message);
                            setMessageSearchMode(null);
                          }}
                        />
                        <SearchMessageGroup
                          title="Matches in User Chats"
                          items={chatSearchMatches}
                          onSelect={(message) => {
                            openSearchResult(message);
                            setMessageSearchMode(null);
                          }}
                        />
                        </>
                      )}
                      {chatSearchMatches.length + aiSearchMatches.length === 0 && (
                        <p className="px-2 py-3 text-xs text-slate-500">No matching messages in this history.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

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
                    ref={promptInputRef}
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
                  <span
                    title="Credential tokens are scrubbed before sending"
                    aria-label="Client-side credential scrubbing active"
                  >
                    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  </span>

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
                      disabled={isStreaming}
                      language={selectedLang.code}
                      onRecordingChange={setIsListening}
                      onError={(message) => setChatError(`Microphone: ${message}`)}
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
                  <p className="truncate">AI responses are generated dynamically. Sensitive credential tokens are scrubbed client-side. By continuing, you agree to our Terms.</p>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
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
                <span>Download</span>
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
                <h3 className="font-bold text-slate-800 text-sm">Contextual Room Admin</h3>
                <p className="text-[11px] text-slate-400">
                  Sovereign: {isCurrentRoomHost ? "You" : members.find((member) => member.is_host || member.role === "sovereign")?.name || "Host"}
                </p>
              </div>
              <button onClick={() => setRoomAdminOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-700" />
              </button>
            </div>

            <section className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={!isAuthenticated || !canManageRoomPolicy || (spaceMode === "personal" && activeRoomMemberCount >= 5)}
                onClick={() => {
                  setRoomAdminOpen(false);
                  void copyHeaderInvite(spaceMode);
                }}
                title={spaceMode === "personal" && activeRoomMemberCount >= 5 ? "Personal Room Full (Max 5)" : undefined}
                className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 text-left text-xs font-semibold text-cyan-900 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy 1-on-1 Named Invite Link
              </button>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => document.getElementById("room-member-roster")?.scrollIntoView({ behavior: "smooth" })}
                  className="text-left text-xs font-semibold text-slate-800"
                >
                  Room Members &amp; Permissions
                </button>
                <p className="mt-0.5 text-[10px] text-slate-500">Host membership controls are shown beside each member.</p>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <span className="min-w-0 flex-1 text-xs font-semibold text-slate-800">Export Transcript</span>
                <button type="button" disabled={!canExportActiveChat} title={!canExportActiveChat ? exportDisabledReason : "Export Markdown"} onClick={() => void exportRoomTranscript("md")} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">Markdown</button>
                <button type="button" disabled={!canExportActiveChat} title={!canExportActiveChat ? exportDisabledReason : "Export JSON"} onClick={() => void exportRoomTranscript("json")} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">JSON</button>
              </div>
              {isCurrentRoomHost && (
                <button
                  type="button"
                  onClick={wipeRoomForAll}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-left text-xs font-semibold text-rose-800 hover:bg-rose-100"
                >
                  Wipe Chat for All
                </button>
              )}
            </section>

            {canManageRoomPolicy && (
              <DynamicTeamModal
                mode={roomCapacityMode}
                spaceMode={spaceMode}
                customCapacity={customRoomCapacity}
                activeMembers={activeRoomMemberCount}
                historyVisibleBeforeJoin={historyVisibleBeforeJoin}
                allowMemberExport={allowMemberExport}
                canInviteMore={activeRoomMemberCount < 5}
                panelClass={currentTheme.bgLightClass}
                borderClass={currentTheme.borderClass}
                textClass={currentTheme.textClass}
                mutedTextClass="text-slate-500"
                surfaceClass="bg-white"
                onModeChange={setRoomCapacityMode}
                onCustomCapacityChange={setCustomRoomCapacity}
                onHistoryVisibilityChange={setHistoryVisibleBeforeJoin}
                onMemberExportChange={setAllowMemberExport}
                onAddMember={() => void copyHeaderInvite(spaceMode)}
              />
            )}

            <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Room Security Passcode</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-mono font-bold bg-white px-2 py-1 rounded-lg border ${selectedTheme.textClass}`}>
                    {roomPasscode}
                  </span>
                  {isCurrentRoomHost && (
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
                      {(member.is_host || member.role === "sovereign") && (
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

                    {isCurrentRoomHost && member.id !== roomIdentity && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void changeRoomMember(member.id, "transfer-host")}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Transfer Host
                        </button>
                        <button
                          type="button"
                          onClick={() => void changeRoomMember(member.id, "remove")}
                          className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          Remove
                        </button>
                      </div>
                    )}
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
            {visibleChatError && (
              <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{visibleChatError}</p>
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

      {!isCorporateDomain && friendsQueueOpen && (
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
                Mutual accepted friends only appear here; only they can see your presence and invite you by room popup.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setFriendSearchOpen(true); setFriendSearchEmail(""); setFriendSearchResult(null); setFriendSearchNotFound(false); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                  <Search className="h-3.5 w-3.5" /> Search email
                </button>
                <button type="button" onClick={() => setFriendsQueueOpen(false)} aria-label="Close Friends Queue" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {isFriendsLoading && <p role="status" className="mb-3 text-xs text-slate-500">Refreshing friends and rooms...</p>}
            {friendsQueueError && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{friendsQueueError}</p>}
            <div className="mb-5 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Mutual friends</h3>
              {discoverableFriends.length ? discoverableFriends.map((friend) => {
                const busyElsewhere = friend.is_online && (!isTeamMode || friend.active_room_id !== roomId);
                const availableHere = friend.is_online && !busyElsewhere;
                return (
                <div key={friend.user_id} className="relative flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <GenieAvatar src={friend.avatar_url} alt={friend.handle} className="h-9 w-9 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800">{friend.handle || friend.display_name}</p>
                    <p className={`text-[11px] ${busyElsewhere ? "text-rose-700" : availableHere ? "text-emerald-600" : "text-slate-400"}`}>
                      <span aria-hidden="true">{busyElsewhere ? "🔴" : availableHere ? "🟢" : "⚪"}</span> {busyElsewhere ? "In Another Room / Busy in Session" : availableHere ? "Available" : "Offline"}
                    </p>
                  </div>
                  {availableHere && (
                    <button
                      type="button"
                      onClick={() => void sendRoomInvite(friend)}
                      disabled={!isTeamMode}
                      title={!isTeamMode ? "Start a room before inviting friends" : `Invite ${friend.handle || friend.display_name}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cyan-200 px-2 py-2 text-[11px] font-semibold text-cyan-800 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Invite
                    </button>
                  )}
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
                );
              }) : (
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

      {!isCorporateDomain && friendSearchOpen && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFriendSearchOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="friend-search-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="friend-search-title" className="text-base font-bold text-slate-900">Invite Friend &amp; Directory</h2>
              <button type="button" onClick={() => setFriendSearchOpen(false)} aria-label="Close friend search" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={(event) => void searchOmniDirectory(event)} className="flex gap-2">
              <input
                value={omniSearchQuery}
                onChange={(event) => {
                  setOmniSearchQuery(event.target.value);
                  setOmniSearchResults([]);
                  setOmniSearchNotFound(false);
                  setOmniSearchError(null);
                }}
                disabled={!isAuthenticated}
                minLength={2}
                placeholder="Search Genie by name or email"
                aria-label="Search Genie directory"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500 disabled:bg-slate-50"
              />
              <button type="submit" disabled={!isAuthenticated || omniSearchBusy || omniSearchQuery.trim().length < 2} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {omniSearchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </button>
            </form>
            {omniSearchError && <p role="status" className="mt-2 text-xs text-rose-600">{omniSearchError}</p>}
            {omniSearchNotFound && omniSearchQuery.includes("@") && (
              <button
                type="button"
                disabled={inviteEmailBusy}
                onClick={() => void sendOnboardingInviteEmail(omniSearchQuery.trim())}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800 disabled:opacity-50"
              >
                {inviteEmailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send Invite Email
              </button>
            )}
            {omniSearchResults.length > 0 && (
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {omniSearchResults.map((friend) => (
                  <div key={friend.user_id} className="flex items-center gap-2 rounded-lg border border-slate-100 p-2">
                    <GenieAvatar src={friend.avatar_url} alt={friend.display_name} className="h-8 w-8 rounded-full" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{friend.display_name}</span>
                    {friend.relationship === "friend" ? (
                      <span className="text-[10px] font-semibold text-emerald-700">Friend</span>
                    ) : (
                      <>
                        <button type="button" disabled={friend.relationship === "following" || friend.relationship === "request_sent"} onClick={() => void updateSocialRelationship(friend, "follow")} className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 disabled:opacity-50">
                          {friend.relationship === "following" ? "Following" : "Follow"}
                        </button>
                        <button type="button" disabled={friend.relationship === "request_sent" || friend.relationship === "request_received"} onClick={() => void updateSocialRelationship(friend, "friend-request")} className="rounded-md bg-cyan-800 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50">
                          {friend.relationship === "request_sent" ? "Requested" : "Add"}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Invite by email</p>
            <form onSubmit={(event) => void searchForFriend(event)} className="flex gap-2">
              <input
                type="email"
                required
                value={friendSearchEmail}
                onChange={(event) => { setFriendSearchEmail(event.target.value); setFriendSearchNotFound(false); setFriendSearchResult(null); }}
                placeholder="Google email address"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
              />
              <button type="submit" disabled={friendSearchBusy} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {friendSearchBusy ? "Searching…" : "Search"}
              </button>
            </form>
            {friendSearchResult && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <GenieAvatar src={friendSearchResult.avatar_url} alt={friendSearchResult.handle} className="h-9 w-9 rounded-full" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-800">{friendSearchResult.handle || friendSearchResult.display_name}</p>
                  <p className="text-[10px] text-slate-500">
                    {friendSearchResult.relationship === "friend" ? "Mutual friend" : `Registered · ${friendSearchResult.relationship || "not connected"}`}
                  </p>
                </div>
                {friendSearchResult.relationship !== "friend" && (
                  <button
                    type="button"
                    disabled={friendSearchResult.relationship === "request_sent" || friendSearchResult.relationship === "request_received"}
                    onClick={() => void updateSocialRelationship(friendSearchResult, "friend-request")}
                    className="rounded-lg bg-cyan-700 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40"
                  >
                    {friendSearchResult.relationship === "request_sent" ? "Requested" : friendSearchResult.relationship === "request_received" ? "Respond in queue" : "Add Friend"}
                  </button>
                )}
              </div>
            )}
            {friendSearchNotFound && (
              <div className="mt-4 rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-600">This email is not registered with Genie.</p>
                <button
                  type="button"
                  disabled={inviteEmailBusy}
                  onClick={() => void sendOnboardingInviteEmail(friendSearchEmail.trim())}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-cyan-700 px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  <Mail className="h-3.5 w-3.5" /> Send Invite Email
                </button>
              </div>
            )}
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
                    Assistant:                     <span className={`font-mono ${selectedTheme.textClass} font-bold`}>{activeModelName}</span>
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
                  { id: "audio", label: "Voice & Audio", icon: Volume2 },
                  { id: "tools", label: "Tools", icon: Sparkles },
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
                <div className={`flex flex-wrap items-center justify-between gap-3 p-3 ${selectedTheme.bgLightClass} border ${selectedTheme.borderClass} rounded-2xl`}>
                  <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-3">
                    <GenieAvatar
                      src={profileAvatar}
                      alt={userProfile.name}
                      className={`w-11 h-11 rounded-full border-2 ${selectedTheme.borderClass} shadow-sm flex-shrink-0`}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-bold text-sm text-slate-800 block truncate">{userProfile.name}</span>
                      <span className="text-xs text-slate-500 block truncate">{userProfile.email || "No email bound"}</span>
                      <span
                        className={`mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] font-semibold uppercase tracking-wider ${
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

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={openProfileEditor}
                      className="flex items-center gap-1.5 rounded-xl border border-cyan-200 px-3 py-1.5 text-xs font-bold text-cyan-800 transition-all hover:bg-cyan-50"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      <span>Edit Profile</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleSignOut();
                        setSettingsOpen(false);
                      }}
                      className="flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 shadow-xs transition-all hover:bg-rose-50"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
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
                      onChange={(e) => setUserProfile((previous) => ({ ...previous, profession: e.target.value }))}
                      placeholder="e.g. Healthcare Revenue Cycle & Client Operations"
                      className="w-full text-xs border border-slate-300 rounded-xl px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                )}

                {userProfile.role === "student" && (
                  <div className={`space-y-2 rounded-2xl border ${selectedTheme.borderClass} ${selectedTheme.bgLightClass} p-3`}>
                    <label className={`block text-xs font-bold ${selectedTheme.textClass}`}>
                      Academic details
                    </label>
                    <input
                      type="text"
                      value={userProfile.institution}
                      onChange={(event) =>
                        setUserProfile((previous) => ({ ...previous, institution: event.target.value }))
                      }
                      placeholder="School, college, or university"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        type="text"
                        value={userProfile.studyLevel}
                        onChange={(event) =>
                          setUserProfile((previous) => ({ ...previous, studyLevel: event.target.value }))
                        }
                        placeholder="Grade, year, or degree"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                      <input
                        type="text"
                        value={userProfile.studyFocus}
                        onChange={(event) =>
                          setUserProfile((previous) => ({ ...previous, studyFocus: event.target.value }))
                        }
                        placeholder="Subjects or area of study"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                    </div>
                  </div>
                )}

                <section className={`space-y-2 rounded-2xl border ${selectedTheme.borderClass} p-3`}>
                  <label htmlFor="room-invite-privacy" className="block text-xs font-bold text-slate-800">
                    Invite privacy
                  </label>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Choose who can send you in-app room invitations. Mutual friends are the default, including for creator accounts.
                  </p>
                  <select
                    id="room-invite-privacy"
                    value={userProfile.allowRoomInvites}
                    onChange={(event) => void updateInvitePrivacy(event.target.value as "mutual_friends" | "everyone")}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                  >
                    <option value="mutual_friends">Mutual Friends Only</option>
                    <option value="everyone">Everyone</option>
                  </select>
                </section>

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

            {settingsTab === "audio" && (
              <section className="space-y-4 p-5 sm:p-7">
                <div>
                  <h4 className="text-sm font-bold text-slate-800">Voice &amp; Audio</h4>
                  <p className="mt-1 text-xs text-slate-500">Choose a calm voice for spoken Genie responses.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {VOICE_PRESETS.map(({ key, gender, description, sample }) => (
                    <article
                      key={key}
                      className={`rounded-2xl border p-4 transition-colors ${
                        activeVoicePreview === key
                          ? `${selectedTheme.borderClass} ${selectedTheme.bgLightClass} animate-pulse`
                          : voicePreset === key
                            ? `${selectedTheme.borderClass} ${selectedTheme.bgLightClass}`
                            : "border-slate-200"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => selectVoicePreset(key)}
                        aria-pressed={voicePreset === key}
                        className="w-full text-left"
                      >
                        <span className="block text-sm font-bold">{gender}: {key}</span>
                        <span className="mt-1 block text-xs text-slate-500">{description}</span>
                        <span className="mt-2 block text-xs italic text-slate-600">&ldquo;{sample}&rdquo;</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => previewVoice(key)}
                        aria-pressed={activeVoicePreview === key}
                        className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                          activeVoicePreview === key
                            ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        {activeVoicePreview === key ? "⏹ Stop" : "▶ Test Voice"}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {settingsTab === "tools" && (
              <section className="space-y-4 p-5 sm:p-7">
                <div className={`rounded-2xl border ${selectedTheme.borderClass} ${selectedTheme.bgLightClass} p-3`}>
                  <h4 className="text-sm font-bold text-slate-800">Genie Tools</h4>
                  <p className={`mt-1 text-xs ${selectedTheme.textClass}`}>
                    {isMasterAdmin
                      ? "⚡ Unlimited Admin Engine"
                      : isQuotaEnforced
                        ? `${remainingDailyChats} / ${DAILY_FREE_LIMIT} chats left today`
                        : isVipUser
                          ? `★ VIP Unlimited · ${activeVipSessionCount}/20`
                          : "★ BYOK Unlimited"}
                  </p>
                </div>
                <StudentBanner onSelectPrompt={(text) => {
                  setPrompt(text);
                  setSettingsOpen(false);
                }} compact />
                <UnifiedStudyEngine
                  onInjectPrompt={(text) => {
                    setPrompt(text);
                    setSettingsOpen(false);
                  }}
                  userEmail={userProfile.email}
                  compact
                />
              </section>
            )}

            {settingsTab === "developer" && (
              <div className="space-y-4 p-5 sm:p-7">
                {voiceCallGateNotice && (
                  <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                    {voiceCallGateNotice}
                  </p>
                )}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Key className="w-4 h-4 text-amber-500" />
                      <span className="text-xs font-bold text-slate-800">Bring Your Own Key (BYOK)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className={`flex items-center gap-1 text-[11px] font-semibold ${selectedTheme.textClass} hover:underline`}
                      >
                        <span>Get Gemini Key</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setByokHelpOpen((open) => !open)}
                        aria-label="BYOK mode and privacy guidance"
                        aria-expanded={byokHelpOpen}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-purple-300 text-purple-700 hover:bg-purple-50"
                      >
                        <CircleHelp className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {byokHelpOpen && (
                    <aside className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-[10px] leading-relaxed text-slate-700">
                      <h4 className="font-bold text-slate-900">Personal Mode</h4>
                      <p>Your key is stored in this browser and is not included in profile sync or Genie application logs. It is sent over HTTPS to Genie for request processing and forwarded to Google, which bills usage and applies its quotas. Room owners set past-history access; invited members cannot export multi-user Personal Mode rooms. Only the Room Owner can save call logs.</p>
                      <h4 className="mt-2 font-bold text-slate-900">Workspace Mode</h4>
                      <p>Server Genie uses platform quota; BYOK uses your organization&apos;s Google Cloud billing. The Origin Admin sets history/export permissions before invites. Workspace calls are saved automatically; only the Origin Admin may export or share logs.</p>
                      <p className="mt-2 border-t border-indigo-200 pt-2">Local storage is browser/device scoped and is not a guarantee of encryption. Google usage is your billing responsibility. Revoke the key in Google AI Studio as well as removing this local copy.</p>
                    </aside>
                  )}

                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={byokApiKey}
                      onChange={(event) => {
                        setByokApiKey(event.target.value);
                        setByokVerified(false);
                        setByokStatus(null);
                        setByokError(null);
                      }}
                      placeholder={byokApiKey ? "••••••••" : "Paste Gemini API key"}
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
                  <div className="flex flex-wrap items-center gap-2">
                    {byokStatus && (
                      <span
                        role="status"
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                          byokVerified
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        {byokStatus}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void testByokKey()}
                      disabled={byokTesting || !byokApiKey.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {byokTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {byokTesting ? "Testing..." : "🧪 Test Key"}
                    </button>
                    <button
                      type="button"
                      onClick={saveByokKey}
                      disabled={!byokVerified || byokTesting}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      💾 Save Key
                    </button>
                    {byokApiKey && (
                      <button
                        type="button"
                        onClick={removeByokKey}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        🗑️ Remove Custom Key
                      </button>
                    )}
                  </div>
                  {byokError && <p role="alert" className="text-[11px] text-rose-700">{byokError}</p>}
                  <p className="text-[10px] text-slate-500">
                    The key is verified directly with Google and stored only in this browser&apos;s local storage.
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
                      onClick={() => void handleReportAIMistake()}
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

                  {reportType === "ui_request" ? (
                    <form onSubmit={handleTicketSubmit} className="space-y-2">
                      <textarea
                        rows={2}
                        value={ticketDescription}
                        onChange={(e) => setTicketDescription(e.target.value)}
                        placeholder="Describe the feature you'd like to request..."
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
                        <span>Submit Feature Request</span>
                      </button>
                    </form>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      Genie will review its latest answer in this chat and provide a correction. No developer ticket is created.
                    </p>
                  )}
                  {ticketStatus && reportType === "ai_issue" && (
                    <div className="text-[11px] font-semibold text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200">
                      {ticketStatus}
                    </div>
                  )}
                </div>
              </div>
            )}

            {settingsTab === "totp" && (
              <div className="space-y-4 p-5 sm:p-7">
                <div className={`space-y-3 rounded-2xl border ${selectedTheme.borderClass} ${selectedTheme.bgLightClass} p-4`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <QrCode className={`h-5 w-5 ${selectedTheme.textClass}`} />
                      <span className={`text-xs font-bold ${selectedTheme.textClass}`}>Google Authenticator (2FA)</span>
                    </div>
                    {authenticatorEnabled && (
                      <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        Active ✓
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    {authenticatorEnabled
                      ? `Google Authenticator is active for ${userProfile.email}. Resetting requires an email verification code.`
                      : "Authenticator is optional during registration. Enable it here to add a second layer of account security."}
                  </p>
                  {authenticatorEnabled ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthenticatorLoginEmail(userProfile.email);
                        void requestAuthenticatorReset(userProfile.email);
                      }}
                      disabled={authenticatorResetBusy}
                      className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
                    >
                      {authenticatorResetBusy ? "Sending…" : "Reset / Re-sync Authenticator"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleStartAuthenticatorSetup()}
                      disabled={authenticatorSetupBusy}
                      className={`rounded-xl ${selectedTheme.primaryClass} px-3 py-2 text-xs font-semibold text-white disabled:opacity-50`}
                    >
                      {authenticatorSetupBusy ? "Preparing…" : "Enable Authenticator"}
                    </button>
                  )}
                  {authenticatorSetupError && <p role="alert" className="text-xs text-rose-700">{authenticatorSetupError}</p>}
                  {authenticatorResetMessage && <p role="status" className="text-xs text-slate-600">{authenticatorResetMessage}</p>}
                  {authenticatorResetPending && (
                    <div className="flex gap-2">
                      <input
                        inputMode="numeric"
                        maxLength={6}
                        value={authenticatorResetCode}
                        onChange={(event) => setAuthenticatorResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="Email verification code"
                        aria-label="Authenticator reset email code"
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button type="button" onClick={() => void confirmAuthenticatorReset()} disabled={authenticatorResetBusy || authenticatorResetCode.length !== 6} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Confirm</button>
                    </div>
                  )}
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
                    <span>Download</span>
                  </button>
                </div>

                <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Chats &amp; Archives</h4>
                    <p className="mt-1 text-[11px] text-slate-500">Download the current conversation or its complete machine-readable backup.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!canExportActiveChat}
                      title="Best for human reading. Downloads clean text with speaker names, timestamps, and formatted code blocks."
                      onClick={() => void exportActiveChat("markdown")}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Download Formatted Document
                    </button>
                    <button
                      type="button"
                      disabled={!canExportActiveChat}
                      title="Technical data backup. Contains the complete machine-readable session structure used to restore chats into your Chat Vault."
                      onClick={downloadChatVaultBackup}
                      className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Download Backup Archive
                    </button>
                  </div>
                  {!canExportActiveChat && <p className="text-[10px] text-amber-700">{exportDisabledReason}</p>}
                </section>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 space-y-2">
                  <p className="font-semibold text-slate-800">Active Multi-Model Failover Highlights:</p>
                  <ul className="list-disc pl-4 space-y-1 text-[11px]">
                    <li>Active cascade across authorized Google Gemini endpoints.</li>
                    <li>RFC 6238 TOTP two-tier authentication and 10 free daily quota enforcement.</li>
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
        byokVerified ? byokApiKey : undefined,
        googleIdToken
      );
      const extracted = extractCodeBlock(cascadeResult.text);
      const sanitized = sanitizeGenieOutput(cascadeResult.text);

      const interventionMsg: Message = {
        role: "assistant",
        content: `[★ Verified Synthesis • Host Intervention Audit]\n\n${sanitized}`,
        timestamp: new Date().toISOString(),
        senderName: "Personal AI Genie",
        source: cascadeResult.model.toLowerCase().includes("openrouter")
          ? "openrouter-fallback"
          : "gemini-3.6-flash",
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
    try {
      localStorage.setItem(
        `genie_observer_mode_${observerPreferenceOwner}`,
        String(nextActive)
      );
    } catch (error) {
      console.error("Observer mode preference could not be saved:", error);
      setChatError("Observer mode preference could not be saved in this browser.");
      return;
    }
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
      try {
        localStorage.setItem(
          `genie_observer_mode_${observerPreferenceOwner}`,
          "false"
        );
      } catch (error) {
        console.error("Observer mode preference could not be updated:", error);
        setChatError("Observer review requires Google sign-in; its preference could not be saved in this browser.");
        return;
      }
      setChatError("Observer review is available after Google sign-in.");
      return;
    }

    try {
      const response = await fetch(getBackendApiUrl("/api/team/summarize-review"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          google_id_token: googleIdToken,
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
        source: result.source || "gemini-3.6-flash",
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
    if (isObserverActive) {
      console.warn("Message deletion rejected: Observer mode is active.");
      return;
    }
    if (message.isVoiceRecord) {
      console.warn("Voice-call transcript records cannot be deleted.");
      return;
    }
    if (!message.id || message.sender_id !== roomIdentity || message.role !== "user") return;
    sendRoomEvent({ type: "message.delete", message_id: message.id });
  }

  function startLongPress(event: React.TouchEvent<HTMLDivElement>, message: Message, index: number) {
    if (isSelectionMode) return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    const touch = event.touches[0];
    const { clientX, clientY } = touch;
    longPressTimerRef.current = setTimeout(() => {
      openLongPressMenu(message, index, clientX, clientY);
      longPressTimerRef.current = null;
    }, 550);
  }

  function openLongPressMenu(message: Message, index: number, clientX: number, clientY: number) {
    setLongPressMenu({
      message,
      index,
      x: Math.max(8, Math.min(clientX, window.innerWidth - 220)),
      y: Math.max(8, Math.min(clientY, window.innerHeight - 260)),
    });
  }

  function cancelLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function openSearchResult(message: Message) {
    const topic = topics.find((item) =>
      item.messages.some((candidate) => candidate.id === message.id && candidate.content === message.content)
    );
    if (topic) {
      stopCurrentChatGeneration();
      setActiveTopicId(topic.id);
      setIsTopicConversation(true);
      setIsTeamMode(false);
      setPersonalMessages(ensureMessageTimestamps(topic.messages));
      return;
    }
    const session = sessions.find((item) =>
      item.messages.some((candidate) => candidate.id === message.id && candidate.content === message.content)
    );
    if (session) {
      handleSelectSession(session);
    }
  }

  function forwardMessageToTopic(topicId: string) {
    if (!forwardMessage) return;
    const destinationTopic = topics.find((topic) => topic.id === topicId);
    if (!destinationTopic) return;
    const forwarded: Message = {
      ...forwardMessage,
      id: `forward_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      senderName: userProfile.name,
      senderEmail: userProfile.email,
      isForwarded: true,
      forwardedFrom: forwardMessage.senderName || (forwardMessage.role === "assistant" ? "Genie" : "You"),
    };
    setTopics((previous) => previous.map((topic) =>
      topic.id === topicId ? { ...topic, messages: [...topic.messages, forwarded] } : topic
    ));
    setActiveTopicId(topicId);
    setIsTopicConversation(true);
    setIsTeamMode(false);
    setPersonalMessages([...destinationTopic.messages, forwarded]);
    setForwardMessage(null);
  }

  function renderMessageActionBar(message: Message, index: number) {
    const messageKey = message.id || String(index);
    const canManageMessage =
      message.role === "user" &&
      !message.is_deleted &&
      !message.isVoiceRecord &&
      !isObserverActive &&
      (!isTeamMode || (Boolean(message.id) && message.sender_id === roomIdentity));
    const isAssistantResponse = message.role === "assistant" && !message.is_deleted;

    return (
      <div className={`mt-1 hidden flex-col gap-1 px-1 md:flex ${message.role === "user" ? "self-end items-end" : "self-start items-start"}`}>
        <div className="flex items-center gap-1.5 text-slate-400">
          <button
            type="button"
            onClick={() => handleCopyMessage(message.content, index)}
            className="rounded p-1 transition-colors hover:text-slate-700"
            title="Copy message"
            aria-label="Copy message"
          >
            {copiedIndex === index ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          {canManageMessage && (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditingMessageId(messageKey);
                  setEditDraft(message.content);
                }}
                className="rounded p-1 transition-colors hover:text-sky-700"
                title="Edit prompt"
                aria-label="Edit prompt"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleDeleteMessage(message, index)}
                className="rounded p-1 transition-colors hover:text-rose-600"
                title="Delete message"
                aria-label="Delete message"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {isAssistantResponse && !(isTeamMode && roomMemberCount > 1) && (
            <button
              type="button"
              onClick={() => handleReloadMessage(message, index)}
              disabled={isStreaming}
              className="rounded p-1 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              title="Regenerate response"
              aria-label="Regenerate response"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {isAssistantResponse && (
            <button
              type="button"
              onClick={() => void handlePlayAudio(message.content, message.id || String(index))}
              disabled={bufferingAudioId === (message.id || String(index))}
              className="rounded p-1 transition-colors hover:text-slate-700 disabled:cursor-wait"
              title={`Read response aloud with ${voicePreset}`}
              aria-label="Read response aloud"
            >
              {bufferingAudioId === (message.id || String(index)) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
              ) : (
                <Volume2
                  className={`h-3.5 w-3.5 ${
                    playingAudioId === (message.id || String(index))
                      ? "animate-pulse text-indigo-600"
                      : ""
                  }`}
                />
              )}
            </button>
          )}
          {isAssistantResponse && (
            <button
              type="button"
              onClick={() => void handleReportAIMistake(message)}
              className="rounded p-1 text-slate-400 transition-colors hover:text-rose-700"
              title="Report AI mistake"
              aria-label="Report AI mistake"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  async function handleSendMessage(
    e?: React.FormEvent,
    forceRainbowTrigger = false,
    customText?: string,
    forceObserverMode = false,
    interventionResponse = false,
    onResponseGenerated?: (content: string) => void,
    forceGenieResponse = false,
    forceBackendVoice = false,
    forceVoiceRecord = false
  ) {
    if (e) e.preventDefault();
    if (!isTeamMode && currentSession?.isArchived) {
      setSecurityToast("Archived sessions are read-only. Clone the transcript to continue chatting.");
      return;
    }
    const isTenantWorkspaceRoom = sovereignRooms.some((room) => room.room_id === roomId);
    if (isCorporateDomain && (!isTeamMode || !isTenantWorkspaceRoom)) {
      setSecurityToast("Corporate Workspace chat must be started in a tenant-scoped room. Create or join a Workspace room first.");
      return;
    }
    let storedByokKey = "";
    try {
      storedByokKey = localStorage.getItem("genie_user_byok_key") || "";
    } catch (error) {
      console.warn("Saved Gemini key could not be read for this chat turn:", error);
    }
    const byokKey = storedByokKey.trim() || (byokVerified ? byokApiKey.trim() : "");
    const observerModeForRequest = forceObserverMode || isObserverActive;
    const textToSend = scrubSensitiveClientTokens(customText !== undefined ? customText : prompt);
    if (!textToSend.trim() && !forceRainbowTrigger) return;
    if (isStreaming) return;
    const topicIdForRequest = activeTopic?.id || "topic_1";
    const sessionArchiveForRequest = !isTeamMode && Boolean(currentSession?.isSharedArchive);
    const routedPersonalTopic =
      !forceBackendVoice &&
      !isTeamMode &&
    isTopicConversation &&
    !sessionArchiveForRequest &&
    isAuthenticated &&
    Boolean(googleIdToken && userProfile.providerId);

    const actualText = textToSend.trim() || (forceRainbowTrigger ? "Genie, please analyze the conversation and assist." : "");
    const shouldWakeGenie =
      !isTeamMode ||
      forceRainbowTrigger ||
      forceGenieResponse ||
      checkWakeWordTrigger(actualText);
    if (shouldWakeGenie && observerModeForRequest && isQuotaEnforced && dailyUsageCount >= DAILY_FREE_LIMIT) {
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
        is_voice_record: forceVoiceRecord,
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
      timestamp: new Date().toISOString(),
      text: actualText,
      sender_id: isTeamMode ? roomIdentity : undefined,
      sender_name: isTeamMode ? userProfile.name : undefined,
      senderName: isTeamMode ? userProfile.name : undefined,
      senderEmail: isTeamMode ? userProfile.email : undefined,
      replyTo: sentReplyTarget || undefined,
      triggeredByRainbow: forceRainbowTrigger,
      isVoiceRecord: forceVoiceRecord,
    };

    const updatedMessages = [...messages, userMsg];

    if (!isTeamMode) {
      if (currentSession && (sessionArchiveForRequest || !isTopicConversation)) {
        setSessions((previous) => previous.map((session) =>
          session.id === currentSession.id ? { ...session, messages: updatedMessages } : session
        ));
      } else if (isTopicConversation) {
        setTopics((previous) => previous.map((topic) =>
          topic.id === topicIdForRequest
            ? { ...topic, messages: updatedMessages, message_count: updatedMessages.length }
            : topic
        ));
      }
      setPersonalMessages(updatedMessages);
    }

    if (shouldWakeGenie && observerModeForRequest && isQuotaEnforced) {
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
    let finalModel = "gemini-3.6-flash";
    let finalSource: Message["source"] = "gemini-3.6-flash";
    let finalAgentOutput: Message["agentOutput"];
    let finalProvider: string | undefined;
    let finalProviderModel: string | undefined;
    let finalAutoFallback = false;
    const storedSessionToken = localStorage.getItem("genie_session_token") || "";
    const requestToken = storedSessionToken === "dev-token-local-bypass"
      ? storedSessionToken
      : googleIdToken || storedSessionToken;
    const isLocalDevSession = requestToken === "dev-token-local-bypass";
    const useChatStream = observerModeForRequest && !routedPersonalTopic && !isLocalDevSession;
    setStreamingPreview("");
    setStreamingAutoFallback(false);

    const controller = new AbortController();
    activeChatAbortControllerRef.current = controller;

    try {
      if (byokKey && routedPersonalTopic) {
        const directResult = await callActiveGeminiCascade(
          actualText,
          isTeamMode
            ? [...roomMessages, userMsg].filter((message) => !message.is_deleted).slice(-20)
            : updatedMessages,
          selectedLang.label,
          byokKey,
          undefined,
          controller.signal,
        );
        finalReply = directResult.text;
        finalModel = directResult.model;
        finalSource = "cloud_ai";
        finalProvider = "Google Gemini";
        finalProviderModel = directResult.model;
        setActiveModelName(directResult.model);
      } else {
      let historyForRequest = isTeamMode
        ? [...roomMessages, userMsg].filter((message) => !message.is_deleted).slice(-20)
        : updatedMessages;
      if (isTeamMode && observerModeForRequest && updatedMessages.length > 0) {
        const reviewResponse = await fetch(getBackendApiUrl("/api/team/summarize-review"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            room_id: roomId,
            google_id_token: googleIdToken,
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
            timestamp: new Date().toISOString(),
          },
          ...updatedMessages.slice(-4),
        ];
      }

      const chatPayload = routedPersonalTopic
        ? {
            google_id_token: isLocalDevSession ? requestToken : googleIdToken,
            user_id: userProfile.providerId,
            topic_id: topicIdForRequest,
            message: actualText,
            message_id: userMsg.id,
            observer_mode: observerModeForRequest,
            byok_key: byokKey || undefined,
          }
        : {
            user_email: userProfile.email,
            google_id_token: googleIdToken,
            prompt: actualText,
            space_mode: spaceMode,
            workspace_room_id: isCorporateDomain ? roomId : undefined,
            conversation_history: historyForRequest,
            provider: "gemini",
            models_cascade: ["gemini-3.6-flash"],
            profession_context:
              userProfile.role === "professional" ? userProfile.profession : undefined,
            gender_context: userProfile.gender,
            language_code: selectedLang.code,
            is_team_chat: false,
            observer_mode: observerModeForRequest,
            message: actualText,
            quoted_message: sentReplyTarget
              ? { author: sentReplyTarget.author, content: sentReplyTarget.content }
              : undefined,
            byok_key: byokKey || undefined,
          };
      const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (byokKey) authHeaders["x-byok-key"] = byokKey;
      if (requestToken) authHeaders.Authorization = `Bearer ${requestToken}`;
      const chatEndpoint = getBackendApiUrl(
        routedPersonalTopic
          ? "/api/personal/chat"
          : isLocalDevSession
          ? "/chat"
          : useChatStream
          ? "/api/chat/stream"
          : "/api/chat"
      );
      const res = await fetch(
        chatEndpoint,
        {
          method: "POST",
          signal: controller.signal,
          headers: authHeaders,
          body: JSON.stringify(chatPayload),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.error("AI turn response error:", errText);
        let responseMessage = errText;
        try {
          const errorPayload = JSON.parse(errText) as { detail?: string; error?: string };
          responseMessage = errorPayload.detail || errorPayload.error || errText;
        } catch {
          responseMessage = errText;
        }
        throw new Error(`AI turn failed (HTTP ${res.status}): ${responseMessage.slice(0, 300)}`);
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
            source?: Message["source"];
            text?: string;
            failed?: string;
            message?: string;
          };
          if (eventName === "meta" && eventData.provider && eventData.model) {
            finalProvider = eventData.provider;
            finalProviderModel = eventData.model;
            finalModel = eventData.model;
            if (eventData.source) finalSource = eventData.source;
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
        if (finalSource === "gemini-3.6-flash") finalSource = "cloud_ai";
      } else {
        const data = await res.json();
        const responseText = typeof data.reply === "string" ? data.reply : data.response;
        if (typeof responseText !== "string" || !responseText.trim()) {
          throw new Error("Chat backend returned an empty response.");
        }
        finalReply = responseText;
        finalModel = "Genie";
        setActiveModelName("Genie");
        finalAgentOutput = data.agent_output;
        finalProvider = data.provider_source === "openrouter-fallback"
          ? "OpenRouter"
          : data.provider_source === "gemini"
            ? "Google Gemini"
            : undefined;
        finalProviderModel = finalModel;
        finalSource =
          data.model_used === "local-python-mock"
            ? "local_mock"
            : data.source === "local_agent" ||
          data.source === "platform_engine" ||
          data.source === "cloud_ai" ||
          data.source === "backend-manifest" ||
          data.source === "openrouter-fallback"
            ? data.source
            : observerModeForRequest
            ? "cloud_ai"
            : "local_agent";
      }
      }
    } catch (primaryError) {
      if (
        controller.signal.aborted ||
        (primaryError instanceof Error && primaryError.name === "AbortError")
      ) {
        setChatError(null);
      } else if (routedPersonalTopic || !observerModeForRequest) {
        const diagnostic = primaryError instanceof Error ? primaryError.message : "Topic chat request failed.";
        console.error("Personal topic chat request failed:", primaryError);
        setChatError(`${observerModeForRequest ? "Personal topic chat" : "Platform engine"} failed: ${diagnostic}`);
      } else try {
        console.warn("Primary chat backend request failed; attempting server fallback.", primaryError);
        const raceResult = await callActiveGeminiCascade(
          actualText,
          isTeamMode
            ? [...roomMessages, userMsg].filter((message) => !message.is_deleted).slice(-20)
            : updatedMessages,
          selectedLang.label,
          byokVerified ? byokApiKey : undefined,
          googleIdToken,
          controller.signal
        );
        finalReply = raceResult.text;
        finalModel = raceResult.model;
        finalSource = "cloud_ai";
        finalProvider = "Google Gemini";
        finalProviderModel = raceResult.model;
        setActiveModelName("Genie");
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
      const isCurrentRequest = activeChatAbortControllerRef.current === controller;
      if (isCurrentRequest) {
        activeChatAbortControllerRef.current = null;
      }
      if (finalReply.trim() && !controller.signal.aborted && isCurrentRequest) {
        const extracted = extractCodeBlock(finalReply);
        const sanitized = sanitizeGenieOutput(finalReply);

        const responseMessage = {
          role: "assistant" as const,
          content: sanitized,
          timestamp: new Date().toISOString(),
          avatarSrc: "/avatars/Genie PRO.png",
          senderName: interventionResponse
            ? "Personal AI Genie • In-chat Intervention"
            : "Personal AI Genie",
          sender_name: interventionResponse
            ? "Personal AI Genie • In-chat Intervention"
            : "Personal AI Genie",
          modelUsed: finalModel,
          source: finalSource,
          provider: finalProvider,
          providerModel: finalProviderModel,
          autoFallback: finalAutoFallback,
          agentName: finalAgentOutput?.agent_name,
          agentOutput: finalAgentOutput,
          extractedCode: extracted || undefined,
          isIntervention: interventionResponse,
          isVoiceRecord: forceVoiceRecord,
        };
        if (isTeamMode) {
          await sendEncryptedRoomEvent({
            type: "message.send",
            content: sanitized,
            sender_type: "assistant",
            sender_name: responseMessage.sender_name,
            source: responseMessage.source,
            agent_name: responseMessage.agentName,
            is_voice_record: forceVoiceRecord,
          });
        } else {
          if (currentSession && (sessionArchiveForRequest || !isTopicConversation)) {
            setSessions((previous) => previous.map((session) =>
              session.id === currentSession.id
                ? { ...session, messages: [...session.messages, responseMessage] }
                : session
            ));
          } else if (isTopicConversation) {
            setTopics((previous) => previous.map((topic) => {
              if (topic.id !== topicIdForRequest) return topic;
              const nextMessages = [...topic.messages, responseMessage];
              return { ...topic, messages: nextMessages, message_count: nextMessages.length };
            }));
          }
          if (isTopicConversation && activeTopicId === topicIdForRequest) {
            setPersonalMessages((previous) => [...previous, responseMessage]);
          }
        }

        if (extracted) setActiveCanvas(extracted);
        onResponseGenerated?.(sanitized);
      }
      if (isCurrentRequest) {
        setStreamingPreview("");
        setStreamingAutoFallback(false);
        setIsStreaming(false);
      }
    }
  }
}

function WorkspaceContainer() {
  return <MainChatApp />;
}

export { WorkspaceContainer };
export default WorkspaceContainer;
