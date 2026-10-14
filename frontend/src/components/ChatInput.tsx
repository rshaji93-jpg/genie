"use client";
import React, { useState, useRef } from "react";
import { Plus, Mic, MicOff, ChevronDown, Send, Globe, ShieldCheck, X } from "lucide-react";
import { StudentQuotesTicker, StudyRoomPresetGrid } from "./StudentSection";

const INDIAN_LANGUAGES = [
  { code: "en-IN", label: "EN (India)" },
  { code: "ta-IN", label: "தமிழ்" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "te-IN", label: "తెలుగు" },
  { code: "ml-IN", label: "മലയാളം" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
  { code: "bn-IN", label: "বাংলা" },
];

interface SpeechRecognitionResultEvent extends Event {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

export default function ChatInput({
  onSendMessage,
  onImageAttach,
  isStreaming,
}: {
  onSendMessage: (msg: string, model: string, imageData?: string) => void;
  onImageAttach?: (imageData: string | null) => void;
  isStreaming: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [model, setModel] = useState("Flash");
  const [selectedLang, setSelectedLang] = useState(INDIAN_LANGUAGES[0]);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scrubSensitiveTokens = (text: string) =>
    text.replace(
      /AIza[0-9A-Za-z_-]{20,}|sk-or-(?:v1-)?[0-9A-Za-z_-]{16,}|\bsk-[0-9A-Za-z_-]{20,}|\bgh[pousr]_[0-9A-Za-z]{20,}\b|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gi,
      "[PROTECTED_CREDENTIAL]",
    );

  const attachImage = (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Choose an image file to attach.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("Images must be 5 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setAttachedImage(reader.result);
      onImageAttach?.(reader.result);
    };
    reader.onerror = () => alert("The selected image could not be read.");
    reader.readAsDataURL(file);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const image = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (!image) return;
    event.preventDefault();
    attachImage(image);
  };

  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechRecognition =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Voice dictation is supported on Chrome, Edge, and Safari on localhost or HTTPS.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = selectedLang.code;

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setIsListening(false);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!prompt.trim() && !attachedImage) || isStreaming) return;
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
    onSendMessage(scrubSensitiveTokens(prompt), model, attachedImage || undefined);
    setPrompt("");
    setAttachedImage(null);
    onImageAttach?.(null);
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4">
      {/* Student Study Quotes Ticker & Room Presets */}
      <div className="mb-2">
        <StudentQuotesTicker
          onSelectQuote={(q) => setPrompt(`Let's reflect on this quote: "${q.quote}"`)}
        />
        <StudyRoomPresetGrid
          onSelectPreset={(p) => setPrompt(p.suggestedPrompt)}
        />
      </div>

      {attachedImage && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 p-2">
          <img src={attachedImage} alt="Image attachment preview" className="h-12 w-12 rounded-lg object-cover" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">Image attached</span>
          <button
            type="button"
            onClick={() => {
              setAttachedImage(null);
              onImageAttach?.(null);
            }}
            aria-label="Remove attached image"
            className="rounded-full p-1 text-slate-500 hover:bg-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="w-full flex items-center bg-white border border-slate-200/90 shadow-md rounded-2xl px-3 py-2 hover:shadow-lg focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100 transition-all"
      >
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) attachImage(file);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="p-2 text-slate-400 hover:text-slate-700 transition-colors"
          title="Attach an image"
        >
          <Plus className="w-5 h-5" />
        </button>

        <textarea
          rows={1}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onPaste={handlePaste}
          placeholder={
            isListening
              ? `Listening in ${selectedLang.label}... Speak now`
              : "Ask Genie anything..."
          }
          className={`flex-1 resize-none bg-transparent px-3 py-2 text-slate-900 placeholder-slate-400 text-sm sm:text-base focus:outline-none ${
            isListening ? "placeholder-rose-500 font-medium" : ""
          }`}
        />
        <span
          title="Credential token scrubbing is active"
          aria-label="Client-side credential token scrubbing is active"
        >
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        </span>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Regional Indian Language Picker for Voice */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              className="flex items-center gap-1 text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2 py-1 rounded-full transition-colors"
              title="Select Voice Language"
            >
              <Globe className="w-3 h-3 text-purple-600" />
              <span>{selectedLang.label}</span>
              <ChevronDown className="w-3 h-3 text-purple-500" />
            </button>

            {langMenuOpen && (
              <div className="absolute right-0 bottom-full mb-2 bg-white border border-slate-200 rounded-xl shadow-xl py-1 w-36 z-50">
                <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Voice Language
                </div>
                {INDIAN_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      setSelectedLang(lang);
                      setLangMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-purple-50 transition-colors flex items-center justify-between ${
                      selectedLang.code === lang.code
                        ? "text-purple-700 font-semibold bg-purple-50/50"
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

          {/* Model Switcher */}
          <button
            type="button"
            onClick={() => setModel(model === "Flash" ? "Pro" : "Flash")}
            className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 px-2.5 py-1.5 rounded-full transition-colors"
          >
            <span>{model}</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {/* Regional Voice Dictation Mic */}
          <button
            type="button"
            onClick={toggleListening}
            className={`p-2 rounded-full transition-all ${
              isListening
                ? "bg-rose-100 text-rose-600 ring-2 ring-rose-400 animate-pulse"
                : "text-slate-500 hover:text-slate-800"
            }`}
            title={isListening ? "Stop listening" : `Start dictation in ${selectedLang.label}`}
          >
            {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Submit */}
          <button
            type="submit"
            disabled={(!prompt.trim() && !attachedImage) || isStreaming}
            className="p-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-full hover:from-purple-700 hover:to-indigo-700 disabled:opacity-40 transition-all shadow-sm ml-1"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
                  <p className="mt-1.5 text-center text-[10px] leading-relaxed text-slate-500">
                    AI responses are generated dynamically. Sensitive credential tokens are scrubbed client-side. By continuing, you agree to our Terms.
                  </p>
                </div>
              );
            }
