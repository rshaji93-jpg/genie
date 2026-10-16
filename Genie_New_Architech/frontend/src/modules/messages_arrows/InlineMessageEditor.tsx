"use client";

import { useState } from "react";

export default function InlineMessageEditor({ initialText, onSave, onCancel }: {
  initialText: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialText);
  return (
    <form className="inline-message-editor" onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSave(value.trim()); }}>
      <textarea aria-label="Edit message" maxLength={20_000} onChange={(event) => setValue(event.target.value)} value={value} />
      <button disabled={!value.trim()} type="submit">Save edit</button><button onClick={onCancel} type="button">Cancel</button>
    </form>
  );
}
