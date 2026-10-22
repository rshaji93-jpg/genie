"use client";

import { useRef, useState } from "react";
import { apiUrl } from "@/lib/api";

export default function SmartScannerModal({ open, onClose, onPdf }: {
  open: boolean;
  onClose: () => void;
  onPdf: (pdfBase64: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  if (!open) return null;
  async function scan(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/") || file.size > 12_000_000) {
      setError("Choose an image smaller than 12 MB.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The selected image could not be read."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "The image could not be read.");
      return "";
    });
    if (!dataUrl) return;
    try {
      const response = await fetch(apiUrl("/api/scan-to-pdf"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("genie_google_credential") || ""}` },
        body: JSON.stringify({ image_base64: dataUrl.split(",", 2)[1] }),
      });
      if (!response.ok) throw new Error(`Scan failed (${response.status}).`);
      const result = await response.json() as { pdf_base64: string };
      onPdf(result.pdf_base64);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Document scan failed.");
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section aria-label="Smart scan to PDF" aria-modal="true" className="scanner-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <h2>Smart scan to PDF</h2>
        <p>Images are deskewed by the Genie backend and converted without Gemini AI tokens.</p>
        <input accept="image/*" capture="environment" onChange={(event) => void scan(event.target.files?.[0])} ref={input} type="file" />
        {error && <p role="alert">{error}</p>}
        <button onClick={onClose}>Close</button>
      </section>
    </div>
  );
}
