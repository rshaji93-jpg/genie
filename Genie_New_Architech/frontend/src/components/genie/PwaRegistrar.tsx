"use client";

import { useEffect } from "react";

export default function PwaRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.warn("Genie offline shell could not be registered.", error);
      });
    }
  }, []);
  return null;
}
