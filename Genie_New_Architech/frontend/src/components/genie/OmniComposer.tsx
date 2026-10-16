"use client";

import { ArrowUp, ImagePlus, LockKeyhole, Plus, ScanLine, UsersRound, X } from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import EmojiPicker from "@/modules/composer/EmojiPicker";
import ModelThinkingSelector from "@/modules/composer/ModelThinkingSelector";
import StagedAudioPill from "@/modules/composer/StagedAudioPill";
import SmartScannerModal from "@/modules/scanner_pdf/SmartScannerModal";
import TrustShield from "@/modules/brand/TrustShield";
import VoiceMic from "./VoiceMic";

export interface Attachment {
  mime_type: string;
  data: string;
  name: string;
}

export type SubmitTarget = "agent" | "peers";

interface OmniComposerProps {
  isMultiUserRoom: boolean;
  memberCount: number;
  participants: string[];
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
  onModelChange: (model: string) => void;
  onPdfScanned?: (pdfBase64: string) => void;
  onOpenPrivacy?: () => void;
  quoteText?: string;
  onClearQuote?: () => void;
  onActivity?: (activity: "typing" | "recording" | "prompting" | "idle") => void;
  defaultDialect?: string;
  stagedVoiceNote?: { id: string; dataUrl: string; durationSeconds: number };
  transcribeRequest?: number;
}

function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/") || file.size > 8_000_000) {
      reject(new Error("Choose an image smaller than 8 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve({ mime_type: file.type, data: result.split(",", 2)[1] || "", name: file.name });
    };
    reader.readAsDataURL(file);
  });
}

export default function OmniComposer(props: OmniComposerProps) {
  const [text, setText] = useState("");
  const [secret, setSecret] = useState(false);
  const [model, setModel] = useState("genie-pro");
  const [thinkingLevel, setThinkingLevel] = useState("pro");
  const [attachment, setAttachment] = useState<Attachment>();
  const [error, setError] = useState("");
  const [dialect, setDialect] = useState(props.defaultDialect || "en-IN");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const multi = props.isMultiUserRoom && props.memberCount > 1;
  useEffect(() => setDialect(props.defaultDialect || "en-IN"), [props.defaultDialect]);
  useEffect(() => {
    if (props.stagedVoiceNote) {
      addVoiceNote(props.stagedVoiceNote.dataUrl, props.stagedVoiceNote.durationSeconds);
    }
  }, [props.stagedVoiceNote?.id]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setAttachment(await fileToAttachment(file));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Attachment could not be added.");
    } finally {
      event.target.value = "";
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() && !attachment) return;
    const outgoing = props.quoteText
      ? `${props.quoteText}\n\n${text.trim()}`.trim()
      : text.trim();
    props.onSubmit(outgoing, secret, attachment, model, thinkingLevel, "agent");
    props.onActivity?.("idle");
    setText("");
    setSecret(false);
    setAttachment(undefined);
    props.onClearQuote?.();
  }

  function addVoiceNote(dataUrl: string, durationSeconds: number) {
    const [header, data] = dataUrl.split(",", 2);
    const mimeType = header.match(/data:([^;]+)/)?.[1] || "audio/webm";
    setText(`[VOICE_NOTE] ${durationSeconds}s`);
    setAttachment({ mime_type: mimeType, data, name: `voice-note-${durationSeconds}s` });
  }

  function relayToPeers() {
    if ((!text.trim() && !attachment) || !multi) return;
    const outgoing = props.quoteText
      ? `${props.quoteText}\n\n${text.trim()}`.trim()
      : text.trim();
    props.onSubmit(outgoing, secret, attachment, model, thinkingLevel, "peers");
    props.onActivity?.("idle");
    setText("");
    setSecret(false);
    setAttachment(undefined);
    props.onClearQuote?.();
  }

  function mentionOptions() {
    const last = text.slice(text.lastIndexOf(" ") + 1);
    if (!last.startsWith("@")) return [];
    const query = last.slice(1).toLocaleLowerCase();
    return ["Genie Pro", "Genie Master", ...props.participants]
      .filter((name) => name.toLocaleLowerCase().includes(query))
      .slice(0, 6);
  }

  function insertMention(name: string) {
    const boundary = text.lastIndexOf(" ");
    setText(`${text.slice(0, boundary < 0 ? 0 : boundary + 1)}@${name} `);
  }

  return (
    <div className="composer-shell">
      {error && <p className="composer-error" role="alert">{error}</p>}
      {attachment && (
        <div className="attachment-chip"><ImagePlus size={14} /><span>{attachment.name}</span><button type="button" onClick={() => setAttachment(undefined)} aria-label="Remove attachment"><X size={14} /></button></div>
      )}
      {props.quoteText && <div className="quote-context-pill"><span>{props.quoteText}</span><button onClick={props.onClearQuote} type="button" aria-label="Remove quoted context"><X size={13} /></button></div>}
      <form className="omni-composer" onSubmit={submit}>
        <input ref={fileInput} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => void chooseFile(event)} />
        <button type="button" className="icon-button add-attachment" onClick={() => setAttachmentMenuOpen((open) => !open)} aria-label="Add attachment" aria-expanded={attachmentMenuOpen}><Plus size={21} /></button>
        {attachmentMenuOpen && <div className="attachment-popover" role="menu">
          <button type="button" role="menuitem" onClick={() => { setAttachmentMenuOpen(false); fileInput.current?.click(); }}><ImagePlus size={15} /> Image or camera</button>
          <button type="button" role="menuitem" onClick={() => { setAttachmentMenuOpen(false); setScannerOpen(true); }}><ScanLine size={15} /> Scan to PDF</button>
        </div>}
        <EmojiPicker onSelect={(emoji) => setText((value) => `${value}${value ? " " : ""}${emoji}`)} />
        <textarea
          value={text}
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
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
          }}
          placeholder={secret ? "Write privately — this never goes to AI…" : "Message Genie or your room…"}
          rows={1}
          maxLength={20_000}
          aria-label="Message Genie"
        />
        {mentionOptions().length > 0 && (
          <div className="mention-suggestions" role="listbox" aria-label="Mention suggestions">
            {mentionOptions().map((name) => <button type="button" key={name} onClick={() => insertMention(name)}>@{name}</button>)}
          </div>
        )}
        <VoiceMic isMultiUserRoom={multi} dialect={dialect} disabled={props.sending} transcribeRequest={props.transcribeRequest} onActivity={(activity) => props.onActivity?.(activity)} onTranscription={(value) => setText((textValue) => `${textValue}${textValue ? " " : ""}${value}`)} onVoiceNoteRecorded={addVoiceNote} />
        <ModelThinkingSelector
          model={model}
          thinking={thinkingLevel}
          showIndividual={multi}
          onModelChange={(value) => { setModel(value); props.onModelChange(value); }}
          onThinkingChange={setThinkingLevel}
        />
        {multi && <button type="button" className="peer-send-button" onClick={relayToPeers} disabled={props.sending || (!text.trim() && !attachment)} aria-label="Send to room members" title="Send encrypted to room members"><UsersRound size={16} /></button>}
        <button type="button" className={`secret-toggle ${secret ? "secret-on" : ""}`} aria-pressed={secret} aria-label={secret ? "Disable secret mode" : "Enable secret mode"} title={secret ? "Secret mode enabled" : "Secret mode"} onClick={() => setSecret((value) => !value)}>
          <LockKeyhole size={15} />
        </button>
        <button type="submit" className="send-button" disabled={props.sending || (!text.trim() && !attachment)} aria-label="Send to selected AI agent" title="Send to selected AI agent">
          <ArrowUp size={17} />
        </button>
      </form>
      {attachment?.mime_type.startsWith("audio/") && (
        <StagedAudioPill
          src={`data:${attachment.mime_type};base64,${attachment.data}`}
          onRemove={() => { setAttachment(undefined); setText(""); }}
        />
      )}
      {model === "genie-master" && <p className="ai-availability" role="status">
        {props.availabilityError ? `Availability unavailable: ${props.availabilityError}` : !props.aiAvailability ? "Checking Genie Master availability…" : !props.aiAvailability.genie_master_configured
          ? "Genie Master is not configured on this server."
          : props.aiAvailability.genie_master_available
            ? "Genie Master is available."
            : `Genie Master available in about ${props.aiAvailability.genie_master_retry_seconds}s.`}
      </p>}
      <div className="composer-hint">{secret ? "Secret mode is local-only or encrypted peer relay." : "Enter sends to AI · use the people button for encrypted peer relay."}</div>
      <p className="composer-privacy">End-to-end encrypted for AI analysis · AI can make mistakes.</p>
      <div className="composer-trust"><TrustShield onOpenPrivacy={props.onOpenPrivacy} /><span>Trust &amp; privacy</span></div>
      <SmartScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onPdf={(pdf) => props.onPdfScanned?.(pdf)}
      />
    </div>
  );
}
