"use client";

import { useEffect } from "react";
import { useHfmcStore, type Route } from "@/lib/client-store";
import Login from "@/components/views/login";
import Shell from "@/components/views/shell";
import Dashboard from "@/components/views/dashboard";
import CaseDetail from "@/components/views/case-detail";
import Tasks from "@/components/views/tasks";
import Bulletin from "@/components/views/bulletin";
import Calculator from "@/components/views/calculator";
import Reports from "@/components/views/reports";
import Admin from "@/components/views/admin";

export default function Page() {
  const { me, loaded, hydrate, route } = useHfmcStore();

  useEffect(() => { hydrate(); }, [hydrate]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="app-bg" />
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--amber)] border-t-transparent animate-spin" />
          <p className="font-disp text-[13px] text-[var(--ink-faint)] m-0">Loading the pipeline…</p>
        </div>
      </div>
    );
  }

  if (!me) return <Login />;

  return (
    <Shell>
      {renderRoute(route)}
    </Shell>
  );
}

function renderRoute(route: Route) {
  switch (route.name) {
    case "dashboard": return <Dashboard />;
    case "case": return <CaseDetail id={route.id} />;
    case "tasks": return <Tasks />;
    case "bulletin": return <Bulletin />;
    case "calculator": return <Calculator />;
    case "reports": return <Reports />;
    case "admin": return <Admin />;
    default: return <Dashboard />;
  }
}
