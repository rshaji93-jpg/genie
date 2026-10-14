import os
import re
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
MAIN_PY_PATH = ROOT_DIR / "backend" / "main.py"
WORKSPACE_PATH = ROOT_DIR / "frontend" / "src" / "components" / "genie" / "WorkspaceContainer.tsx"
HEADER_PATH = ROOT_DIR / "frontend" / "src" / "components" / "genie" / "HeaderBar.tsx"
VOICECALL_PATH = ROOT_DIR / "frontend" / "src" / "components" / "genie" / "VoiceCallModal.tsx"


def patch_main_py():
    if not MAIN_PY_PATH.exists():
        print(f"❌ Could not find {MAIN_PY_PATH}")
        return
    content = MAIN_PY_PATH.read_text(encoding="utf-8")

    if len(content.splitlines()) < 1500:
        print("⚠️ WARNING: Your backend/main.py has fewer than 1,500 lines! Please press Ctrl+Z in main.py to restore your full file first, then run this script again.")
        return

    # 1. Ensure DirectVoiceTurnRequest has caller_id, participant_ids, is_observer_active, language_code
    old_voice_req = """class DirectVoiceTurnRequest(BaseModel):
    system_text: str = Field(min_length=1, max_length=2000)
    contents: List[Dict[str, Any]] = Field(min_length=1, max_length=20)
    transcript: str = Field(min_length=1, max_length=5000)
    dialect: str = Field(min_length=2, max_length=64)
    voice_name: str = Field(pattern="^(Aoede|Charon|Kore|Fenrir|Puck)$")
    user_email: Optional[str] = None
    google_id_token: Optional[str] = None
    user_byok_key: Optional[str] = None
    workspace_room_id: Optional[str] = None"""

    new_voice_req = """class DirectVoiceTurnRequest(BaseModel):
    system_text: str = Field(min_length=1, max_length=2000)
    contents: List[Dict[str, Any]] = Field(min_length=1, max_length=20)
    transcript: str = Field(min_length=1, max_length=5000)
    dialect: str = Field(min_length=2, max_length=64)
    voice_name: str = Field(pattern="^(Aoede|Charon|Kore|Fenrir|Puck)$")
    language_code: Optional[str] = "en-IN"
    user_email: Optional[str] = None
    google_id_token: Optional[str] = None
    user_byok_key: Optional[str] = None
    workspace_room_id: Optional[str] = None
    is_observer_active: Optional[bool] = False
    caller_id: Optional[str] = None
    participant_ids: Optional[List[str]] = Field(default_factory=list)"""

    if "caller_id: Optional[str] = None" not in content and old_voice_req in content:
        content = content.replace(old_voice_req, new_voice_req, 1)

    # 2. Fix /api/social/search HTTP 422 error & search both user_registry and social_directory
    search_pattern = re.compile(
        r'@app\.get\("/api/social/search"\)\s*async def search_social_user\(.*?\n    return \{"found": bool\(results\), "users": results\}',
        re.DOTALL,
    )
    new_search_func = '''@app.get("/api/social/search")
async def search_social_user(
    request: Request,
    q: Optional[str] = Query(default=None),
    query: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    bearer = (
        authorization.removeprefix("Bearer ").strip()
        if authorization and authorization.startswith("Bearer ")
        else ""
    )
    identity = None
    if bearer:
        try:
            identity = await asyncio.to_thread(verified_identity_from_token, bearer, request)
        except HTTPException:
            identity = local_developer_identity(request, authorization)
    elif is_local_development_request(request):
        identity = local_developer_identity(request, "Bearer dev-token-local-bypass")

    if not identity:
        raise HTTPException(status_code=401, detail="Google sign-in is required.")

    normalized_query = str(q or query or "").strip()
    if len(normalized_query) < 2:
        return {"found": False, "users": []}

    like_pattern = f"%{normalized_query.lower()}%"
    caller_sub = str(identity.get("sub") or "")
    online_rooms = get_online_user_rooms()

    with closing(sqlite3.connect(ARCHIVE_DB_PATH)) as connection:
        rows = connection.execute(
            """
            SELECT registry.user_id, registry.display_name, registry.email,
                   COALESCE(NULLIF(directory.avatar_url, ''), registry.avatar_url, ''),
                   COALESCE(NULLIF(directory.handle, ''), registry.display_name)
            FROM user_registry AS registry
            LEFT JOIN social_directory AS directory ON directory.user_id = registry.user_id
            WHERE registry.user_id != ?
              AND (
                  lower(registry.display_name) LIKE ?
                  OR lower(registry.email) LIKE ?
                  OR lower(COALESCE(directory.handle, '')) LIKE ?
              )
              AND NOT EXISTS (
                  SELECT 1 FROM user_blocks
                  WHERE (blocker_id = ? AND blocked_id = registry.user_id)
                     OR (blocker_id = registry.user_id AND blocked_id = ?)
              )
            UNION
            SELECT directory.user_id, directory.display_name, directory.email,
                   directory.avatar_url, COALESCE(NULLIF(directory.handle, ''), directory.display_name)
            FROM social_directory AS directory
            WHERE directory.user_id != ?
              AND directory.user_id NOT IN (SELECT user_id FROM user_registry)
              AND (
                  lower(directory.display_name) LIKE ?
                  OR lower(directory.email) LIKE ?
                  OR lower(directory.handle) LIKE ?
              )
            ORDER BY 2 COLLATE NOCASE LIMIT 20
            """,
            (
                caller_sub, like_pattern, like_pattern, like_pattern, caller_sub, caller_sub,
                caller_sub, like_pattern, like_pattern, like_pattern,
            ),
        ).fetchall()

        results = []
        for user_id, display_name, email, avatar_url, handle in rows:
            pending_out = connection.execute(
                "SELECT status FROM friend_requests WHERE requester_id = ? AND recipient_id = ?",
                (caller_sub, user_id),
            ).fetchone()
            pending_in = connection.execute(
                "SELECT status FROM friend_requests WHERE requester_id = ? AND recipient_id = ?",
                (user_id, caller_sub),
            ).fetchone()
            is_mutual_friend = bool(
                (pending_out and pending_out[0] == "accepted")
                or (pending_in and pending_in[0] == "accepted")
            )
            if is_mutual_friend:
                relation = "friend"
            elif pending_out and pending_out[0] == "pending":
                relation = "request_sent"
            elif pending_in and pending_in[0] == "pending":
                relation = "request_received"
            elif connection.execute(
                "SELECT 1 FROM social_follows WHERE follower_id = ? AND followed_id = ?",
                (caller_sub, user_id),
            ).fetchone():
                relation = "following"
            elif connection.execute(
                "SELECT 1 FROM social_follows WHERE follower_id = ? AND followed_id = ?",
                (user_id, caller_sub),
            ).fetchone():
                relation = "follower"
            else:
                relation = "none"

            results.append(
                {
                    "user_id": user_id,
                    "display_name": display_name,
                    "email": email,
                    "handle": handle,
                    "avatar_url": avatar_url,
                    "is_online": user_id in online_rooms,
                    "active_room_id": online_rooms.get(user_id),
                    "relationship": relation,
                }
            )
    return {"found": bool(results), "users": results}'''

    if search_pattern.search(content):
        content = search_pattern.sub(new_search_func, content, count=1)

    # 3. Add sequential token cascade helper for Call Genie / Room AI Agent
    if "def consume_sequential_turn(" not in content:
        cascade_helper = '''
def consume_sequential_turn(participant_ids: List[str]) -> tuple[bool, Optional[str], int]:
    """
    Destroys tokens of the user who added/activated the AI agent first (caller_id),
    then sequentially cascades across all available room participants.
    """
    today = datetime.now(timezone.utc).date().isoformat()
    with daily_message_counts_lock, closing(sqlite3.connect(ARCHIVE_DB_PATH, timeout=10)) as conn:
        for raw_id in participant_ids:
            if not raw_id:
                continue
            canonical_id = canonical_user_id(str(raw_id))
            user_key = f"google:{canonical_id}"
            row = conn.execute(
                "SELECT created_at, is_vip, vip_expires_at, email FROM user_registry WHERE user_id = ? OR lower(email) = lower(?)",
                (canonical_id, canonical_id),
            ).fetchone()
            if row:
                created_at, is_vip, vip_expires_at, db_email = row
                if str(db_email or "").strip().lower() == ADMIN_EMAIL.lower():
                    return True, canonical_id, 999999
                if is_vip and vip_expires_at and vip_expires_at > datetime.now(timezone.utc).isoformat():
                    return True, canonical_id, 999999
                if created_at:
                    try:
                        age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(created_at)).days
                        if age_days > 180:
                            continue
                    except ValueError:
                        pass
            used = daily_message_counts.get((user_key, today), 0)
            if used < DAILY_MESSAGE_LIMIT:
                daily_message_counts[(user_key, today)] = used + 1
                return True, canonical_id, max(0, DAILY_MESSAGE_LIMIT - (used + 1))
    return False, None, 0
'''
        content = content.replace(
            "def _check_and_consume_daily_turn(",
            cascade_helper + "\ndef _check_and_consume_daily_turn(",
            1,
        )

    old_voice_quota = """        # Public free user: consume 1 turn from daily quota (10 turns/day)
        user_tracking_id = identity.get("email") or request.client.host
        allowed, remaining_turns = _check_and_consume_daily_turn(user_tracking_id, limit=10)
        if not allowed:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "BYOK_REQUIRED",
                    "error": "Daily free voice quota reached (10/10 turns). Please provide your own Gemini API key in Settings > BYOK to continue.",
                },
            )
        # Use system Gemini key pool for free tier calls
        api_key = (GEMINI_MASTER_KEY or "").strip()"""

    new_voice_quota = """        # Sequential token cascade: initiator's tokens are consumed first, then room peers
        candidates = [req.caller_id] + [p for p in (req.participant_ids or []) if p != req.caller_id]
        candidates = [c for c in candidates if c]
        if not candidates:
            candidates = [identity.get("sub") or identity.get("email") or request.client.host]
        allowed, charged_user, remaining_turns = consume_sequential_turn(candidates)
        if not allowed:
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "BYOK_REQUIRED",
                    "error": "ALL_PARTICIPANT_TOKENS_EXHAUSTED",
                    "message": "All participant daily tokens in this room are exhausted. Please provide a Gemini API key in Settings > BYOK to continue.",
                },
            )
        pool_key_info = gemini_pool.get_key(is_vip=False, is_admin=False)
        api_key = pool_key_info.get("key") or (GEMINI_MASTER_KEY or "").strip()"""

    if old_voice_quota in content:
        content = content.replace(old_voice_quota, new_voice_quota, 1)

    # 4. Update handle_chat Observation Mode routing:
    # Individual chat: Observer OFF -> Genie Pro primary; Observer ON -> Genie Master primary (if valid tokens, else Genie Pro)
    old_chat_obs = """    observer_mode = req.observer_mode if req.observer_mode is not None else req.engine == "cloud_ai"
    mock_reply = (
        evaluate_local_python_mock(prompt)
        if not has_image and not req.force_genie_master and not req.force_ai_intervention and not has_active_chat_api_key(req.custom_api_key)
        else None
    )
    if not observer_mode and not has_image and not req.force_genie_master and not req.force_ai_intervention:
        local_reply = evaluate_local_python_response(prompt)
        return {
            "reply": local_reply,
            "response": local_reply,
            "model_used": "local-python-mock",
            "source": "platform_engine",
            "intent": "local_mock",
            **account_limits,
        }
    if mock_reply and not has_image:
        return {
            "reply": mock_reply,
            "response": mock_reply,
            "model_used": "local-python-mock",
            "source": "platform_engine",
            "intent": "local_mock",
            **account_limits,
        }
    or_key = os.getenv("OPENROUTER_API_KEY", OPENROUTER_KEY).strip()
    user_gemini_key = (req.custom_api_key or "").strip()
    master_persona = is_master_admin or is_active_vip or has_image"""

    new_chat_obs = """    observer_mode = (
        req.observer_mode
        if req.observer_mode is not None
        else bool(req.is_observer_active)
    )
    or_key = os.getenv("OPENROUTER_API_KEY", OPENROUTER_KEY).strip()
    user_gemini_key = (req.custom_api_key or "").strip()
    has_valid_tokens = (
        is_master_admin
        or is_active_vip
        or bool(user_gemini_key)
        or int(account_limits.get("chats_remaining", 10)) > 0
    )
    # Individual Chat: Observer OFF -> Genie Pro is primary. Observer ON -> Genie Master (if valid tokens) else Genie Pro.
    master_persona = bool(
        has_image
        or req.force_genie_master
        or (observer_mode and has_valid_tokens)
    )"""

    if old_chat_obs in content:
        content = content.replace(old_chat_obs, new_chat_obs, 1)

    MAIN_PY_PATH.write_text(content, encoding="utf-8")
    print(f"✅ Successfully updated {MAIN_PY_PATH} ({len(content.splitlines())} lines preserved)")


def patch_workspace_container():
    if not WORKSPACE_PATH.exists():
        print(f"❌ Could not find {WORKSPACE_PATH}")
        return
    content = WORKSPACE_PATH.read_text(encoding="utf-8")

    if len(content.splitlines()) < 2000:
        print("⚠️ WARNING: Your WorkspaceContainer.tsx has fewer than 2,000 lines! Please press Ctrl+Z in WorkspaceContainer.tsx to restore your full file first, then run this script again.")
        return

    # 1. Unlock voice call access for both Start Call (Friends P2P) and Call Genie (AI Agent)
    old_can_access = """  const canAccessVoiceCall = useCallback(() => {
    if (!isObserverActive) return false;
    if (userProfile.email.trim().toLowerCase() === "rshaji93@gmail.com") return true;
    try {
      return Boolean(localStorage.getItem("genie_user_byok_key")?.trim());
    } catch (error) {
      console.warn("BYOK key could not be checked for voice call access:", error);
      return false;
    }
  }, [isObserverActive, userProfile.email]);"""

    new_can_access = """  const canAccessVoiceCall = useCallback(() => {
    return true;
  }, []);"""

    if old_can_access in content:
        content = content.replace(old_can_access, new_can_access, 1)

    # 2. Update startVoiceCall to distinguish Start Call (Friends P2P) vs Call Genie (AI Agent)
    old_start_call = """function startVoiceCall(inviteRoomParticipants = false) {
  // Allow all logged-in/guest users to use voice calls under free daily quota
    setVoiceCallGateNotice("");
    const voiceTransport =
      isTeamMode && activeRoomMemberCount > 1 && !isObserverActive ? "mesh" : "ai";
    setRoomRtcEvents([]);
    setActiveVoiceTransport(voiceTransport);
    const callId = isTeamMode && activeRoomVoiceCallId
      ? activeRoomVoiceCallId
      : window.crypto.randomUUID();
    setVoiceCallStartedAt(new Date().toISOString());
    if (isTeamMode && !activeRoomVoiceCallId) {
      if (!sendRoomEvent({
        type: "voice_session.start",
        call_id: callId,
        voice_name: voicePreset,
        language_code: selectedLang.code,
        transport: voiceTransport,
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
  }"""

    new_start_call = """function startVoiceCall(inviteRoomParticipants = false) {
    setVoiceCallGateNotice("");
    // inviteRoomParticipants === true means "Start Call" (Friends P2P)
    // inviteRoomParticipants === false means "Call Genie" (AI Agent)
    const isFriendsPeerCall = inviteRoomParticipants;

    if (isFriendsPeerCall && !isTeamMode) {
      setFriendsQueueOpen(true);
      setSecurityToast("Select an accepted friend from your directory to start a peer-to-peer call, or invite them to a shared room.");
      return;
    }

    if (!isFriendsPeerCall) {
      setIsObserverActiveState(true);
    }

    const voiceTransport: "ai" | "mesh" =
      isFriendsPeerCall && !isObserverActive ? "mesh" : "ai";

    setRoomRtcEvents([]);
    setActiveVoiceTransport(voiceTransport);
    const callId = isTeamMode && activeRoomVoiceCallId
      ? activeRoomVoiceCallId
      : window.crypto.randomUUID();
    setVoiceCallStartedAt(new Date().toISOString());
    if (isTeamMode && !activeRoomVoiceCallId) {
      if (!sendRoomEvent({
        type: "voice_session.start",
        call_id: callId,
        voice_name: voicePreset,
        language_code: selectedLang.code,
        transport: voiceTransport,
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
    } else if (isFriendsPeerCall && isTeamMode) {
      if (!sendRoomEvent({ type: "INCOMING_CALL", call_id: callId })) return;
    }
    setVoiceCallId(callId);
    setIsVoiceCallOpen(true);
  }"""

    if old_start_call in content:
        content = content.replace(old_start_call, new_start_call, 1)

    # 3. Pass isObserverActive, onToggleObserver, and brandLogoSrc to VoiceCallModal
    old_modal_tag = """          {isVoiceCallOpen && canAccessVoiceCall() && (
            <VoiceCallModal
              key={voiceCallId}
              callId={voiceCallId}
              isTeamMode={isTeamMode}
              contextMode={spaceMode}"""

    new_modal_tag = """          {isVoiceCallOpen && canAccessVoiceCall() && (
            <VoiceCallModal
              key={voiceCallId}
              callId={voiceCallId}
              isTeamMode={isTeamMode}
              contextMode={spaceMode}
              isObserverActive={isObserverActive}
              onToggleObserver={() => void handleObserverToggle()}
              brandLogoSrc="/avatars/Fixed-brand-Icon.png" """

    if old_modal_tag in content:
        content = content.replace(old_modal_tag, new_modal_tag, 1)

    # 4. Update shouldWakeGenie & force_genie_master in handleSendMessage for Individual vs Group Chat
    old_wake = """    const shouldWakeGenie =
      !isTeamMode ||
      forceRainbowTrigger ||
      forceGenieResponse ||
      Boolean(imageDataForRequest) ||
      checkWakeWordTrigger(actualText);"""

    new_wake = """    const shouldWakeGenie = isTeamMode
      ? Boolean(
          isObserverActive ||
          forceObserverMode ||
          forceRainbowTrigger ||
          forceGenieResponse ||
          imageDataForRequest ||
          checkWakeWordTrigger(actualText)
        )
      : true; // Individual chat: Observer OFF -> Genie Pro; Observer ON -> Genie Master"""

    if old_wake in content:
        content = content.replace(old_wake, new_wake, 1)

    content = content.replace(
        "force_genie_master: Boolean(imageDataForRequest),",
        "force_genie_master: Boolean(imageDataForRequest || observerModeForRequest || forceRainbowTrigger),",
    )

    WORKSPACE_PATH.write_text(content, encoding="utf-8")
    print(f"✅ Successfully updated {WORKSPACE_PATH} ({len(content.splitlines())} lines preserved)")


HEADER_BAR_CODE = '''"use client";

import React, { useEffect, useState } from "react";
import {
  Briefcase,
  Phone,
  PhoneOff,
  Settings,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
  Users,
  ChevronDown,
  Trash2,
  Copy,
  LogOut,
} from "lucide-react";
import GenieBrandAvatar from "./GenieBrandAvatar";

export interface HeaderBarMember {
  id: string;
  name: string;
  role?: string;
  isOriginAdmin?: boolean;
  avatarUrl?: string;
  status?: "active" | "inactive" | "different_room";
}

export interface HeaderBarProps {
  spaceMode: "personal" | "workspace";
  onSpaceModeChange: (mode: "personal" | "workspace") => void;
  isTeamMode: boolean;
  onToggleTeamMode: () => void;
  isCorporateDomain?: boolean;
  workspaceName?: string;
  profileGender?: string;
  userEmail?: string;
  isPrimaryVip?: boolean;
  isAdmin?: boolean;
  corporateAvatarUrl?: string;
  corporateDisplayName?: string;
  corporateTenantId?: string;
  activeMemberCount: number;
  members: HeaderBarMember[];
  capacityLabel: string;
  chromeClass: string;
  chromeSurfaceClass: string;
  chromeBorderClass: string;
  chromeTextClass: string;
  chromeMutedTextClass: string;
  accentBorderClass: string;
  accentTextClass: string;
  activeClass: string;
  onOpenRoom: () => void;
  onOpenSocialDrawer: () => void;
  socialNotificationCount?: number;
  onStartVoiceCall: () => void;
  onStartRoomCall: () => void;
  isCallActive: boolean;
  callStartedAt: string | null;
  onEndActiveCall: () => void;
  onRequestVip?: (message: string) => Promise<void> | void;
  canAccessVoiceCall?: boolean;
  onOpenSettings: () => void;
  isAuthenticated: boolean;
  isRoomHost?: boolean;
  canInviteMembers?: boolean;
  onPurgeContext?: () => void;
  onCopyInvite?: (mode: "personal" | "workspace") => void;
  onLeaveRoom?: () => void;
  onEndRoom?: () => void;
  canSeeAdminTelemetry?: boolean;
  onOpenAdminDrawer?: () => void;
  onVerifyAdminKnock?: (code: string) => Promise<void>;
}

export default function HeaderBar({
  spaceMode,
  onSpaceModeChange,
  isTeamMode,
  onToggleTeamMode,
  isCorporateDomain = false,
  workspaceName = "Personal",
  profileGender = "",
  userEmail = "",
  activeMemberCount,
  chromeClass,
  chromeBorderClass,
  accentTextClass,
  onOpenRoom,
  onOpenSocialDrawer,
  socialNotificationCount = 0,
  onStartVoiceCall,
  onStartRoomCall,
  isCallActive,
  callStartedAt,
  onEndActiveCall,
  onOpenSettings,
  isRoomHost = false,
  onPurgeContext,
  onCopyInvite,
  onLeaveRoom,
  onEndRoom,
  canSeeAdminTelemetry = false,
  onOpenAdminDrawer,
}: HeaderBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isCallActive || !callStartedAt) {
      setElapsedSeconds(0);
      return;
    }
    const startMs = Date.parse(callStartedAt) || Date.now();
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isCallActive, callStartedAt]);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <header
      className={`relative z-30 flex min-h-14 w-full flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-5 ${chromeClass} ${chromeBorderClass}`}
    >
      {/* Left Brand + Mode Switcher */}
      <div className="flex flex-wrap items-center gap-2 pl-9 md:pl-0">
        <div className="flex items-center gap-2 pr-1">
          <GenieBrandAvatar
            gender={profileGender}
            label="Personal AI Genie"
            className="h-8 w-8 rounded-full shadow-sm"
          />
          <span className="hidden sm:inline font-extrabold text-sm tracking-tight bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 bg-clip-text text-transparent">
            Personal AI Genie
          </span>
        </div>

        {/* Personal / Workspace Pill */}
        <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-0.5 shadow-2xs">
          <button
            type="button"
            disabled={isCorporateDomain}
            onClick={() => onSpaceModeChange("personal")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all ${
              spaceMode === "personal"
                ? "bg-sky-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 disabled:opacity-40"
            }`}
          >
            <User className="h-3.5 w-3.5" />
            <span>Personal</span>
          </button>
          <button
            type="button"
            onClick={() => onSpaceModeChange("workspace")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all ${
              spaceMode === "workspace"
                ? "bg-sky-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Briefcase className="h-3.5 w-3.5" />
            <span>Workspace</span>
          </button>
        </div>

        {/* Team Sync Toggle */}
        <button
          type="button"
          onClick={onToggleTeamMode}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-all ${
            isTeamMode
              ? "border-violet-300 bg-violet-600 text-white shadow-xs"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          <span>Team Sync</span>
        </button>
      </div>

      {/* Right Controls: Personal Badge, Room Roster, Friends, Start Call (Friends), Call Genie (AI Agent), Settings */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <span className="hidden lg:inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 bg-clip-text text-transparent">
          {workspaceName}
        </span>

        <button
          type="button"
          onClick={onOpenRoom}
          title="Room members & capacity"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <Users className="h-3.5 w-3.5 text-slate-500" />
          <span>{Math.max(1, activeMemberCount)}/5</span>
          <ChevronDown className="h-3 w-3 text-slate-400" />
        </button>

        {!isCorporateDomain && (
          <button
            type="button"
            onClick={onOpenSocialDrawer}
            className="relative inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <UserPlus className="h-3.5 w-3.5 text-slate-600" />
            <span>Friends</span>
            {socialNotificationCount > 0 && (
              <span className="ml-0.5 rounded-full bg-rose-600 px-1.5 py-0.2 text-[9px] font-extrabold text-white">
                {socialNotificationCount}
              </span>
            )}
          </button>
        )}

        {isCallActive ? (
          <button
            type="button"
            onClick={onEndActiveCall}
            className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-rose-700"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            <span>End Call ({formatTimer(elapsedSeconds)})</span>
          </button>
        ) : (
          <>
            {/* Start Call -> Dedicated to Friends P2P */}
            <button
              type="button"
              onClick={onStartRoomCall}
              title="Start a peer-to-peer call with your friends"
              className="inline-flex items-center gap-1.5 rounded-full bg-teal-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-teal-800"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Start Call</span>
            </button>

            {/* Call Genie -> Dedicated to AI Agent (Single or Group Token-Pooled Call) */}
            <button
              type="button"
              onClick={onStartVoiceCall}
              title="Call Genie AI Agent (uses initiator/room token pool)"
              className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3.5 py-1.5 text-xs font-bold text-sky-700 shadow-2xs transition hover:bg-sky-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-sky-600" />
              <span>Call Genie</span>
            </button>
          </>
        )}

        {canSeeAdminTelemetry && onOpenAdminDrawer && (
          <button
            type="button"
            onClick={onOpenAdminDrawer}
            title="Admin Telemetry"
            className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Telemetry</span>
          </button>
        )}

        {/* Settings + Room Quick Actions Menu */}
        <div className="relative flex items-center rounded-full border border-slate-200 bg-white p-0.5">
          <button
            type="button"
            onClick={onOpenSettings}
            title="Workspace Preferences"
            aria-label="Workspace Preferences"
            className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Session actions"
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {menuOpen && (
            <div
              onMouseLeave={() => setMenuOpen(false)}
              className="absolute right-0 top-full z-50 mt-2 w-52 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl"
            >
              {onCopyInvite && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onCopyInvite(spaceMode);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="h-3.5 w-3.5 text-sky-600" />
                  <span>Copy Room Invite Link</span>
                </button>
              )}
              {onPurgeContext && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onPurgeContext();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Trash2 className="h-3.5 w-3.5 text-amber-600" />
                  <span>Clear Local Chat Context</span>
                </button>
              )}
              {isTeamMode && onLeaveRoom && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onLeaveRoom();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Leave Room</span>
                </button>
              )}
              {isTeamMode && isRoomHost && onEndRoom && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onEndRoom();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-rose-700 hover:bg-rose-50"
                >
                  <PhoneOff className="h-3.5 w-3.5" />
                  <span>End Room for All</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
'''

VOICE_CALL_MODAL_CODE = '''"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  VolumeX,
  UserPlus,
  Copy,
  Globe,
  Sparkles,
  Users,
} from "lucide-react";

export interface VoiceCallTurn {
  id: string;
  callId?: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface VoiceCallTranscript {
  callId: string;
  durationSeconds: number;
  dialect: string;
  participants: Array<{ id: string; name: string; avatarUrl?: string }>;
  turns: VoiceCallTurn[];
}

export interface VoiceCallModalProps {
  callId: string;
  isTeamMode: boolean;
  contextMode: "personal" | "workspace";
  isObserverActive?: boolean;
  onToggleObserver?: () => void;
  brandLogoSrc?: string;
  participants: Array<{ id: string; name: string; avatarUrl?: string }>;
  currentUser: { id: string; name: string; avatarUrl?: string };
  remoteTurns: VoiceCallTurn[];
  rtcTransport?: "ai" | "mesh";
  rtcEvents?: Array<Record<string, any>>;
  onRtcSignal?: (event: Record<string, unknown>) => boolean;
  languageCode: string;
  languageLabel: string;
  isRoomOriginHost?: boolean;
  selectedVoice: string;
  onVoiceChange: (voiceName: string) => void;
  shouldSubmitTurn?: (transcript: string) => boolean;
  onCopyInvite: () => void;
  onPingFriend: () => void;
  onLanguageChange: (languageCode: string) => void;
  onSubmitTurn: (transcript: string) => Promise<{
    text: string;
    audioData?: string;
    audioMimeType?: string;
  } | null>;
  onBroadcastTurn?: (turn: VoiceCallTurn, callId: string) => Promise<void>;
  onEndCall: (transcript: VoiceCallTranscript) => void;
}

const VOICE_OPTIONS = ["Aoede", "Charon", "Kore", "Fenrir", "Puck"];

export default function VoiceCallModal({
  callId,
  isTeamMode,
  isObserverActive = false,
  onToggleObserver,
  brandLogoSrc = "/avatars/Fixed-brand-Icon.png",
  participants,
  currentUser,
  remoteTurns,
  rtcTransport = "ai",
  languageCode,
  languageLabel,
  selectedVoice,
  onVoiceChange,
  onCopyInvite,
  onPingFriend,
  onSubmitTurn,
  onBroadcastTurn,
  onEndCall,
}: VoiceCallModalProps) {
  const [turns, setTurns] = useState<VoiceCallTurn[]>([]);
  const [spokenInput, setSpokenInput] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDurationSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!remoteTurns.length) return;
    setTurns((prev) => {
      const existing = new Set(prev.map((t) => t.id));
      const incoming = remoteTurns.filter((t) => !existing.has(t.id));
      return incoming.length ? [...prev, ...incoming] : prev;
    });
  }, [remoteTurns]);

  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function handleSendSpokenTurn(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const text = spokenInput.trim();
    if (!text || isBusy) return;
    setSpokenInput("");

    const userTurn: VoiceCallTurn = {
      id: window.crypto.randomUUID(),
      callId,
      userId: currentUser.id,
      userName: currentUser.name,
      userAvatar: currentUser.avatarUrl || null,
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, userTurn]);
    if (onBroadcastTurn) {
      await onBroadcastTurn(userTurn, callId).catch(() => undefined);
    }

    // If in Friends P2P mesh call and AI Observer is OFF, do not invoke Genie AI unless @Genie is spoken
    const wakesAi = isObserverActive || rtcTransport === "ai" || /\\bgenie\\b/i.test(text);
    if (!wakesAi) return;

    setIsBusy(true);
    try {
      const reply = await onSubmitTurn(text);
      if (reply?.text) {
        const aiTurn: VoiceCallTurn = {
          id: window.crypto.randomUUID(),
          callId,
          userId: "genie-master",
          userName: isObserverActive ? "Genie Master" : "Genie Pro",
          userAvatar: brandLogoSrc,
          role: "assistant",
          text: reply.text,
          timestamp: new Date().toISOString(),
        };
        setTurns((prev) => [...prev, aiTurn]);
        if (onBroadcastTurn) {
          await onBroadcastTurn(aiTurn, callId).catch(() => undefined);
        }
        if (!speakerMuted && reply.audioData) {
          const mime = reply.audioMimeType || "audio/mpeg";
          const audio = new Audio(`data:${mime};base64,${reply.audioData}`);
          audioRef.current = audio;
          void audio.play().catch(() => undefined);
        } else if (!speakerMuted && typeof window !== "undefined" && "speechSynthesis" in window) {
          const utter = new SpeechSynthesisUtterance(reply.text);
          utter.lang = languageCode;
          window.speechSynthesis.speak(utter);
        }
      }
    } finally {
      setIsBusy(false);
    }
  }

  function finishCall() {
    audioRef.current?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    onEndCall({
      callId,
      durationSeconds,
      dialect: languageLabel,
      participants: participants.length ? participants : [currentUser],
      turns,
    });
  }

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/85 p-3 sm:p-6 backdrop-blur-md">
      <div className="relative flex h-[min(88vh,46rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-white shadow-2xl">
        {/* Branded App Logo Watermark in Call Background */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-10">
          <img
            src={brandLogoSrc}
            alt="Personal AI Genie Trademark Logo"
            className="h-72 w-72 rounded-full object-contain"
          />
        </div>

        {/* Top Call Bar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/60 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <img
              src={brandLogoSrc}
              alt="Personal AI Genie"
              className="h-9 w-9 rounded-full border border-cyan-500/40 object-cover"
            />
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-white">
                {isObserverActive
                  ? "Call Genie · AI Agent Active (Token Pool)"
                  : isTeamMode
                  ? "Friends Peer-to-Peer Call"
                  : "Personal AI Genie Voice Session"}
              </h2>
              <p className="text-[11px] text-slate-400">
                {formatTime(durationSeconds)} · {languageLabel} · Voice: {selectedVoice}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Include / Toggle AI Agent inside Start Call or Group Call */}
            {onToggleObserver && (
              <button
                type="button"
                onClick={onToggleObserver}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
                  isObserverActive
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-sm"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
                title="Include or mute the AI Agent in this call"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{isObserverActive ? "AI Agent ON (Call Genie)" : "Include AI Agent"}</span>
              </button>
            )}

            <select
              value={selectedVoice}
              onChange={(e) => onVoiceChange(e.target.value)}
              aria-label="Select AI Voice Persona"
              className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 outline-none"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  Voice: {v}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onPingFriend}
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Add Friend</span>
            </button>

            <button
              type="button"
              onClick={onCopyInvite}
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Invite Link</span>
            </button>
          </div>
        </div>

        {/* Active Participants Strip */}
        <div className="relative z-10 flex flex-wrap items-center gap-2 border-b border-slate-800/80 bg-slate-900/70 px-5 py-2.5 text-xs">
          <span className="inline-flex items-center gap-1 font-bold text-slate-400">
            <Users className="h-3.5 w-3.5" /> In Call:
          </span>
          {(participants.length ? participants : [currentUser]).map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/90 px-2.5 py-1 text-[11px] font-semibold text-slate-200"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {p.name}
            </span>
          ))}
        </div>

        {/* Live Prompting / Transcript Stream inside Call Box */}
        <div className="relative z-10 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
              <p className="text-sm font-semibold text-slate-200">
                Live Voice &amp; Prompting Stream Ready
              </p>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                {isObserverActive
                  ? "Call Genie is active. Speak or type below—responses are spoken aloud and transcribed live."
                  : "Friends Call active. Speak with your friends or click 'Include AI Agent' above to bring Genie into the call."}
              </p>
            </div>
          ) : (
            turns.map((turn) => (
              <div
                key={turn.id}
                className={`flex flex-col ${
                  turn.role === "assistant" ? "items-start" : "items-end"
                }`}
              >
                <span className="mb-1 px-1 text-[10px] font-bold text-slate-400">
                  {turn.userName} ·{" "}
                  {new Date(turn.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <div
                  className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                    turn.role === "assistant"
                      ? "border border-cyan-500/30 bg-cyan-950/60 text-cyan-100"
                      : "bg-sky-600 text-white"
                  }`}
                >
                  {turn.text}
                </div>
              </div>
            ))
          )}
          <div ref={turnsEndRef} />
        </div>

        {/* Bottom Spoken Turn Input + Call Controls */}
        <div className="relative z-10 border-t border-slate-800 bg-slate-950/80 p-4">
          <form onSubmit={(e) => void handleSendSpokenTurn(e)} className="mb-3 flex gap-2">
            <input
              type="text"
              value={spokenInput}
              onChange={(e) => setSpokenInput(e.target.value)}
              disabled={isMuted || isBusy}
              placeholder={
                isMuted
                  ? "Microphone is muted..."
                  : isObserverActive
                  ? "Speak or type to Genie Master in this call..."
                  : "Speak to friends in call (or type @Genie)..."
              }
              className="flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={!spokenInput.trim() || isMuted || isBusy}
              className="rounded-full bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-40"
            >
              {isBusy ? "Thinking..." : "Send Turn"}
            </button>
          </form>

          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition ${
                isMuted
                  ? "bg-amber-600 text-white"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span>{isMuted ? "Unmute Mic" : "Mute Mic"}</span>
            </button>

            <button
              type="button"
              onClick={() => setSpeakerMuted((s) => !s)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition ${
                speakerMuted
                  ? "bg-amber-600 text-white"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              {speakerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              <span>{speakerMuted ? "Speaker Off" : "Speaker On"}</span>
            </button>

            <button
              type="button"
              onClick={finishCall}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-lg hover:bg-rose-700"
            >
              <PhoneOff className="h-4 w-4" />
              <span>End Call</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
'''


def write_full_modals():
    HEADER_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEADER_PATH.write_text(HEADER_BAR_CODE, encoding="utf-8")
    print(f"✅ Successfully wrote complete {HEADER_PATH}")

    VOICECALL_PATH.write_text(VOICE_CALL_MODAL_CODE, encoding="utf-8")
    print(f"✅ Successfully wrote complete {VOICECALL_PATH}")


if __name__ == "__main__":
    print("🚀 Applying Personal AI Genie Production Fixes...")
    patch_main_py()
    patch_workspace_container()
    write_full_modals()
    print("🎉 All 4 files updated! You can now delete apply_final_fixes.py.")