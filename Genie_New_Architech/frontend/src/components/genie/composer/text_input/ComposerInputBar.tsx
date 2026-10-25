"use client";

import type { ClipboardEvent, KeyboardEvent, Ref } from "react";

interface ComposerInputBarProps {
  value: string;
  inputRef: Ref<HTMLTextAreaElement>;
  placeholder: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}

export default function ComposerInputBar(props: ComposerInputBarProps) {
  return (
    <textarea
      ref={props.inputRef}
      value={props.value}
      onFocus={props.onFocus}
      onChange={(event) => props.onChange(event.target.value)}
      onBlur={props.onBlur}
      onPaste={props.onPaste}
      onKeyDown={props.onKeyDown}
      className="flex-1 min-w-0"
      placeholder={props.placeholder}
      rows={1}
      maxLength={20_000}
      aria-label="Message Genie"
    />
  );
}
