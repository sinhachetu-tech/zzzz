"use client";

import { useEffect, useState } from "react";
import { IX, ICheck } from "@/components/icons";

interface PwaInstallBannerProps {
  portal: "staff" | "client" | "agent";
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallBanner({ portal }: PwaInstallBannerProps) {
  const [show, setShow] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [deviceType, setDeviceType] = useState<"mobile" | "desktop">("desktop");
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. If already running as PWA (standalone), never show
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    // 2. Detect device type
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const isSmall = window.innerWidth < 768;
    const currentDevice = isSmall && isTouch ? "mobile" : "desktop";
    setDeviceType(currentDevice);

    // 3. Detect iOS Safari
    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);
    setIsIOS(ios);

    // 4. Check suppression per device type
    const storageKey = `hfmc.pwaPrompt.${currentDevice}`;
    const stored = localStorage.getItem(storageKey);

    if (stored === "installed") return;
    if (stored?.startsWith("dismissed:")) {
      const ts = parseInt(stored.split(":")[1], 10);
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - ts < sevenDays) return;
    }

    // 5. Listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // If iOS Safari, we can display the helper banner after a short delay
    if (ios && !stored) {
      const timer = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(timer);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        localStorage.setItem(`hfmc.pwaPrompt.${deviceType}`, "installed");
        fetch("/api/pwa/installed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceType }),
        }).catch(() => {});
        setShow(false);
      }
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(`hfmc.pwaPrompt.${deviceType}`, `dismissed:${Date.now()}`);
    setShow(false);
  };

  if (!show) return null;

  const content = {
    client: {
      title: "Get instant updates on your mortgage",
      desc: "Install the HFMC app on your device for real-time chat, instant document requests, and case milestones — no app store needed.",
    },
    staff: {
      title: "Never miss a client message",
      desc: "Install the HFMC workspace on this device for background chat alerts, urgent task reminders, and real-time case updates.",
    },
    agent: {
      title: "Stay on top of your referrals",
      desc: "Install the HFMC Partner app on this device to get instant alerts when your referred cases move forward or need your attention.",
    },
  }[portal];

  return (
    <div
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-[420px] p-4 rounded-2xl shadow-2xl z-50 border anim-fade-up"
      style={{
        background: "var(--bg2)",
        borderColor: "var(--line)",
        boxShadow: "0 14px 45px rgba(0,0,0,0.25)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-disp font-bold text-base shrink-0" style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", color: "#fff" }}>
          HF
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-disp font-semibold text-[14px] m-0 text-[var(--ink)]">
            {content.title}
          </h4>
          <p className="text-[12px] text-[var(--ink-dim)] m-0 mt-1 leading-relaxed">
            {content.desc}
          </p>

          {isIOS && (
            <p className="text-[11px] text-[var(--amber)] m-0 mt-2 font-medium">
              Tap the Share button ⎋ then select &ldquo;Add to Home Screen&rdquo; ⊞
            </p>
          )}

          <div className="flex items-center gap-2 mt-3">
            {deferredPrompt && (
              <button
                type="button"
                onClick={handleInstall}
                className="btn btn-primary btn-sm !px-3 !py-1 text-[12px] font-semibold"
              >
                <ICheck size={13} /> Install now
              </button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              className="btn btn-ghost btn-sm !px-2.5 !py-1 text-[12px] text-[var(--ink-faint)] hover:text-[var(--ink)]"
            >
              Maybe later
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="btn btn-ghost !p-1 text-[var(--ink-faint)] hover:text-[var(--ink)]"
          title="Dismiss"
        >
          <IX size={15} />
        </button>
      </div>
    </div>
  );
}
