"use client";

import { Camera, FileUp, Image, Brain, Plus, ScanLine } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

interface PlusAttachmentMenuProps {
  onFile: (file: File) => void;
  onScan: () => void;
  onThinkHarder: () => void;
}

export default function PlusAttachmentMenu({
  onFile,
  onScan,
  onThinkHarder,
}: PlusAttachmentMenuProps) {
  const [open, setOpen] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) {
      setOpen(false);
      onFile(file);
    }
  }

  return (
    <div className="relative">
      <input ref={cameraInput} accept="image/*" capture="environment" className="hidden" onChange={handleFile} type="file" />
      <input ref={photosInput} accept="image/*" className="hidden" onChange={handleFile} type="file" />
      <input
        ref={filesInput}
        accept=".txt,.md,.csv,.pdf,.doc,.docx,text/plain,text/markdown,text/csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleFile}
        type="file"
      />
      <button
        aria-expanded={open}
        aria-label="Open attachment menu"
        className="icon-button add-attachment"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Plus size={21} />
      </button>
      {open && (
        <div className="attachment-popover" role="menu">
          <button onClick={() => cameraInput.current?.click()} role="menuitem" type="button"><Camera size={15} /> Camera</button>
          <button onClick={() => photosInput.current?.click()} role="menuitem" type="button"><Image size={15} /> Photos</button>
          <button onClick={() => filesInput.current?.click()} role="menuitem" type="button"><FileUp size={15} /> Files / Upload Document</button>
          <button onClick={() => { setOpen(false); onScan(); }} role="menuitem" type="button"><ScanLine size={15} /> Scan to PDF</button>
          <button onClick={() => { setOpen(false); onThinkHarder(); }} role="menuitem" type="button"><Brain size={15} /> Think harder</button>
        </div>
      )}
    </div>
  );
}
