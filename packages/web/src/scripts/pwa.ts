// PWA wiring: register the app-shell service worker, and reveal a subtle opt-in
// "Instalovat" footer link only when the browser actually offers installation.
// No popup / banner — the browser's native install affordance is the primary path;
// this link just makes it discoverable where the OS hides it (e.g. desktop Chrome).

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function initPwa(): void {
  // Register the service worker (offline shell + faster repeat loads). Best-effort.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  const btn = document.getElementById("install-app");
  if (!btn) return;

  // Already running as an installed app → never show the link.
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return;

  let deferred: BeforeInstallPromptEvent | null = null;

  // Chromium fires this when the app meets install criteria. Suppress the default
  // mini-infobar and surface our own link instead (still no popup).
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    btn.hidden = false;
  });

  btn.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* dismissed */
    }
    deferred = null;
    btn.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    btn.hidden = true;
  });
}
