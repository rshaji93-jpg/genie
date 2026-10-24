"use client";

import { ArrowUp, Headphones, ImagePlus, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import EmojiPicker from "@/modules/composer/EmojiPicker";
import StagedAudioPill from "@/modules/composer/StagedAudioPill";
import SmartScannerModal from "@/modules/scanner_pdf/SmartScannerModal";
import VoiceMic from "./VoiceMic";
import PlusAttachmentMenu from "./PlusAttachmentMenu";

export interface Attachment {
  mime_type: string;
  data: string;
  name: string;
}

export type SubmitTarget = "agent" | "peers";
export type ChatMode = "ai_room" | "friends_only" | "private_ai";

interface OmniComposerProps {
  isMultiUserRoom: boolean;
  memberCount: number;
  participants: string[];
  model: string;
  chatMode: ChatMode;
  useLibrary: boolean;
  onToggleUseLibrary: () => void;
  sending: boolean;
  availabilityError?: string;
  aiAvailability?: {
    genie_master_configured: boolean;
    genie_master_available: boolean;
    genie_master_retry_seconds: number;
  };
  onSubmit: (
    text: string,
    secret: boolean,
    attachment?: Attachment,
    model?: string,
    thinkingLevel?: string,
    target?: SubmitTarget,
  ) => void;
  onPdfScanned?: (pdfBase64: string) => void;
  onAttachmentFile: (file: File) => void;
  onOpenPrivacy?: () => void;
  quoteText?: string;
  onClearQuote?: () => void;
  onActivity?: (activity: "typing" | "recording" | "prompting" | "idle") => void;
  defaultDialect?: string;
  transcribeRequest?: number;
  recentContext?: string;
  wakeWordActive?: boolean;
  onWakeWordPrompt?: (text: string, dialect: string) => void;
  externalTranscription?: string;
  onCallTranscript?: (text: string) => void;
  queuedAttachmentPreview?: {
    name: string;
    mime_type: string;
    data: string;
  };
  onSendQueuedAttachment?: () => void;
  onRemoveQueuedAttachment?: () => void;
  onTranscribeAudio?: (dataUrl: string, dialect: string) => Promise<string>;
  onOpenCall?: () => void;
  sharedAudioStream?: MediaStream | null;
}

export default function OmniComposer(props: OmniComposerProps) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<Attachment>();
  const [dialect, setDialect] = useState(props.defaultDialect || "en-IN");
  const [scannerOpen, setScannerOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function closeGovernanceMenus() {
    window.dispatchEvent(new Event("genie:close-header-menu"));
    window.dispatchEvent(new Event("genie:close-sidebar-menu"));
  }
  const multi = props.isMultiUserRoom && props.memberCount > 1;
  useEffect(() => setDialect(props.defaultDialect || "en-IN"), [props.defaultDialect]);
  useEffect(() => {
    if (props.externalTranscription) setText(props.externalTranscription);
  }, [props.externalTranscription]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    input.style.overflowY = input.scrollHeight > 140 ? "auto" : "hidden";
  }, [text]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() && !attachment) return;
    const outgoing = props.quoteText
      ? `${props.quoteText}\n\n${text.trim()}`.trim()
      : text.trim();
    props.onSubmit(outgoing, false, attachment, props.model, thinkingLevel, props.chatMode === "friends_only" ? "peers" : "agent");
    props.onActivity?.("idle");
    setText("");
    setAttachment(undefined);
    props.onClearQuote?.();
  }

  function relayToPeers() {
    if ((!text.trim() && !attachment) || !multi) return;
    const outgoing = props.quoteText
      ? `${props.quoteText}\n\n${text.trim()}`.trim()
      : text.trim();
    props.onSubmit(outgoing, false, attachment, props.model, thinkingLevel, "peers");
    props.onActivity?.("idle");
    setText("");
    setAttachment(undefined);
    props.onClearQuote?.();
  }

  function addVoiceNote(dataUrl: string, durationSeconds: number) {
    const [header, data] = dataUrl.split(",", 2);
    const mimeType = header.match(/data:([^;]+)/)?.[1] || "audio/webm";
    setText(`[VOICE_NOTE] ${durationSeconds}s`);
    setAttachment({ mime_type: mimeType, data, name: `voice-note-${durationSeconds}s` });
  }

  function sendVoiceNote(dataUrl: string, durationSeconds: number) {
    const [header, data] = dataUrl.split(",", 2);
    const mimeType = header.match(/data:([^;]+)/)?.[1] || "audio/webm";
    props.onSubmit(
      `[VOICE_NOTE] ${durationSeconds}s`,
      false,
      { mime_type: mimeType, data, name: `voice-note-${durationSeconds}s` },
      props.model,
      thinkingLevel,
      multi ? "peers" : "agent",
    );
  }

  function mentionOptions() {
    const last = text.slice(text.lastIndexOf(" ") + 1);
    if (!last.startsWith("@")) return [];
    const query = last.slice(1).toLocaleLowerCase();
    return ["Genie", ...props.participants]
      .filter((name) => name.toLocaleLowerCase().includes(query))
      .slice(0, 6);
  }

  function insertMention(name: string) {
    const boundary = text.lastIndexOf(" ");
    setText(`${text.slice(0, boundary < 0 ? 0 : boundary + 1)}@${name} `);
  }

  const thinkingLevel = props.model === "genie-master" ? "deep" : props.model === "genie-lite" ? "light" : "pro";

  return (
    <div className="composer-shell">
      {props.queuedAttachmentPreview && (
        <div className="composer-attachment-previews" aria-label="Attachments ready to send">
          {props.queuedAttachmentPreview.mime_type.startsWith("image/") ? (
            <div className="composer-image-preview">
              <img
                alt={props.queuedAttachmentPreview.name}
                src={`data:${props.queuedAttachmentPreview.mime_type};base64,${props.queuedAttachmentPreview.data}`}
              />
              <button aria-label={`Remove ${props.queuedAttachmentPreview.name}`} onClick={props.onRemoveQueuedAttachment} type="button"><X size={13} /></button>
            </div>
          ) : (
            <div className="composer-file-preview">
              <ImagePlus size={15} /><span>{props.queuedAttachmentPreview.name}</span>
              <button aria-label={`Remove ${props.queuedAttachmentPreview.name}`} onClick={props.onRemoveQueuedAttachment} type="button"><X size={13} /></button>
            </div>
          )}
          <button className="composer-attachment-send" onClick={props.onSendQueuedAttachment} type="button">Send with Genie</button>
        </div>
      )}
      {attachment && (
        <div className="attachment-chip"><ImagePlus size={14} /><span>{attachment.name}</span><button type="button" onClick={() => setAttachment(undefined)} aria-label="Remove attachment"><X size={14} /></button></div>
      )}
      {props.quoteText && <div className="quote-context-pill"><span>{props.quoteText}</span><button onClick={props.onClearQuote} type="button" aria-label="Remove quoted context"><X size={13} /></button></div>}
      <form className={`omni-composer composer-mode-${props.chatMode}`} onSubmit={submit}>
        <PlusAttachmentMenu
          onFile={props.onAttachmentFile}
          onScan={() => setScannerOpen(true)}
          onRelayToPeers={multi ? relayToPeers : undefined}
        />
        <button
          aria-pressed={props.useLibrary}
          className={`use-library-toggle ${props.useLibrary ? "active" : ""}`}
          onClick={props.onToggleUseLibrary}
          title="Use your Library for this request only"
          type="button"
        >Use Library</button>
        <EmojiPicker onSelect={(emoji) => setText((value) => `${value}${value ? " " : ""}${emoji}`)} />
        <textarea
          ref={inputRef}
          value={text}
          onFocus={closeGovernanceMenus}
          onChange={(event) => {
            setText(event.target.value);
            props.onActivity?.(event.target.value ? "typing" : "idle");
          }}
          onBlur={() => props.onActivity?.("idle")}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text/plain");
            if (pasted) {
              event.preventDefault();
              setText((value) => value + pasted);
            }
          }}
          onKeyDown={(event) => {
            closeGovernanceMenus();
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
          }}
          className="flex-1 min-w-0"
          placeholder={props.chatMode === "friends_only"
            ? "⏸️ AI Standby — chat with your group or mention @Genie..."
            : props.chatMode === "private_ai"
              ? "🔒 Private to you & Genie..."
              : "Message Genie or your room..."}
          rows={1}
          maxLength={20_000}
          aria-label="Message Genie"
        />
        {mentionOptions().length > 0 && (
          <div className="mention-suggestions" role="listbox" aria-label="Mention suggestions">
            {mentionOptions().map((name) => <button type="button" key={name} onClick={() => insertMention(name)}>@{name}</button>)}
          </div>
        )}
        <VoiceMic isMultiUserRoom={multi} dialect={dialect} currentText={text} recentContext={props.recentContext} disabled={props.sending} transcribeRequest={props.transcribeRequest} wakeWordActive={Boolean(multi && props.wakeWordActive)} onWakeWordPrompt={props.onWakeWordPrompt} onActivity={(activity) => props.onActivity?.(activity)} onTranscription={(value) => setText(value)} onCallTranscript={props.onCallTranscript} onVoiceNoteRecorded={addVoiceNote} onVoiceNoteSend={sendVoiceNote} onTranscribeAudio={props.onTranscribeAudio} sharedAudioStream={props.sharedAudioStream} />
        {!text.trim() && multi && props.onOpenCall && (
          <button className="icon-button composer-call-button" onClick={props.onOpenCall} type="button" aria-label="Call room members" title="Call room members">
            <Headphones size={17} />
          </button>
        )}
        <button type="submit" className="send-button" disabled={props.sending || (!text.trim() && !attachment)} aria-label="Send to Genie" title="Send to Genie">
          <ArrowUp size={17} />
        </button>
      </form>
      {attachment?.mime_type.startsWith("audio/") && (
        <StagedAudioPill
          src={`data:${attachment.mime_type};base64,${attachment.data}`}
          onRemove={() => { setAttachment(undefined); setText(""); }}
        />
      )}
      {props.model === "genie-master" && <p className="ai-availability" role="status">
        {props.availabilityError ? `Availability unavailable: ${props.availabilityError}` : !props.aiAvailability ? "Checking Genie Master availability…" : !props.aiAvailability.genie_master_configured
          ? "Genie Master is not configured on this server."
          : props.aiAvailability.genie_master_available
            ? "Genie Master is available."
            : `Genie Master available in about ${props.aiAvailability.genie_master_retry_seconds}s.`}
      </p>}
      <SmartScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onPdf={(pdf) => props.onPdfScanned?.(pdf)}
      />
    </div>
  );
}
