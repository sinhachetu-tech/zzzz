"use client";

import { useEffect, useState } from "react";
import { useClientStore } from "./client-store";
import { ClientLogin } from "./login";
import { ClientDashboard } from "./dashboard";

export default function ClientPortal() {
  const { me, loaded, hydrate } = useClientStore();

  useEffect(() => { hydrate(); }, [hydrate]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="w-8 h-8 rounded-full border-2 border-[var(--amber)] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!me) return <ClientLogin />;
  return <ClientDashboard />;
}
