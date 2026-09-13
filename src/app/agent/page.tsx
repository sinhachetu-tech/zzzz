"use client";

import { useEffect, useState } from "react";
import { useAgentStore } from "./agent-store";
import { AgentLogin } from "./login";
import { AgentDashboard } from "./dashboard";

export default function AgentPortal() {
  const { me, loaded, hydrate } = useAgentStore();
  useEffect(() => { hydrate(); }, [hydrate]);
  if (!loaded) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-[var(--amber)] border-t-transparent animate-spin" /></div>;
  if (!me) return <AgentLogin />;
  return <AgentDashboard />;
}
