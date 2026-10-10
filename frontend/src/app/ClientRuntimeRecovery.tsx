"use client";

import { useEffect } from "react";

const RELOAD_GUARD_KEY = "genie_chunk_reload_at";

export default function ClientRuntimeRecovery() {
  useEffect(() => {
    let mounted = true;
    const isDevelopment = process.env.NODE_ENV !== "production";

    if (isDevelopment) {
      void (async () => {
        if ("serviceWorker" in navigator) {
          try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((registration) => registration.unregister()));
          } catch (error) {
            console.error("Could not unregister development service workers:", error);
          }
        }

        if ("caches" in window) {
          try {
            const cacheNames = await window.caches.keys();
            await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
          } catch (error) {
            console.error("Could not clear development browser caches:", error);
          }
        }
      })();
    } else if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.error("Could not register the production service worker:", error);
      });
    }

    const reloadForStaleAsset = (reason: string) => {
      const isChunkFailure =
        /loading chunk failed|chunkloaderror|unexpected token\s*['"`]?\s*</i.test(reason);
      if (!isChunkFailure) return;

      const now = Date.now();
      try {
        const previousReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
        if (now - previousReload < 15_000) return;
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
      } catch (error) {
        console.error("Could not store chunk-recovery reload guard:", error);
      }

      window.location.reload();
    };

    const handleWindowError = (event: ErrorEvent) => {
      const message = event.message || event.error?.message || "";
      reloadForStaleAsset(message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error ? event.reason.message : String(event.reason ?? "");
      reloadForStaleAsset(reason);
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    const clearReloadGuard = window.setTimeout(() => {
      if (!mounted) return;
      try {
        const previousReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
        if (Date.now() - previousReload >= 15_000) {
          sessionStorage.removeItem(RELOAD_GUARD_KEY);
        }
      } catch (error) {
        console.error("Could not clear chunk-recovery reload guard:", error);
      }
    }, 15_000);

    return () => {
      mounted = false;
      window.clearTimeout(clearReloadGuard);
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
