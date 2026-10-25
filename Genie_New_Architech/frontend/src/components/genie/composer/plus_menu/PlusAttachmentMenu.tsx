"use client";

import { Camera, FileUp, Image, Plus, ScanLine } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

export const ENABLE_DESKTOP_CAMERA = false;

interface PlusAttachmentMenuProps {
  onFile: (file: File) => void;
  onScan: () => void;
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const hasTouch = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
    || (hasTouch && window.innerWidth < 768);
}

export default function PlusAttachmentMenu({ onFile, onScan }: PlusAttachmentMenuProps) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateDevice = () => setMobile(isMobileDevice());
    updateDevice();
    window.addEventListener("resize", updateDevice);
    return () => window.removeEventListener("resize", updateDevice);
  }, []);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("genie:close-composer-popovers", close);
    return () => window.removeEventListener("genie:close-composer-popovers", close);
  }, []);

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
          {mobile && <button onClick={() => cameraInput.current?.click()} role="menuitem" type="button"><Camera size={15} /> Camera</button>}
          <button onClick={() => photosInput.current?.click()} role="menuitem" type="button"><Image size={15} /> Photos</button>
          <button onClick={() => filesInput.current?.click()} role="menuitem" type="button"><FileUp size={15} /> Files / Upload Document</button>
          {mobile && <button onClick={() => { setOpen(false); onScan(); }} role="menuitem" type="button"><ScanLine size={15} /> Scan to PDF</button>}
          {!mobile && ENABLE_DESKTOP_CAMERA && <button onClick={() => cameraInput.current?.click()} role="menuitem" type="button"><Camera size={15} /> Camera</button>}
        </div>
      )}
    </div>
  );
}
