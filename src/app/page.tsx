"use client";

import { useEffect } from "react";
import { useHfmcStore, type Route } from "@/lib/client-store";
import Login from "@/components/views/login";
import Shell from "@/components/views/shell";
import Dashboard from "@/components/views/dashboard";
import Cases from "@/components/views/cases";
import CaseDetail from "@/components/views/case-detail";
import Tasks from "@/components/views/tasks";
import Bulletin from "@/components/views/bulletin";
import Calculator from "@/components/views/calculator";
import Reports from "@/components/views/reports";
import { Products } from "@/components/views/products";
import Admin from "@/components/views/admin";
import Leads from "@/components/views/leads";
import Clients from "@/components/views/clients";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { PwaInstallBanner } from "@/components/pwa/PwaInstallBanner";

export default function Page() {
  const { me, loaded, hydrate, route, cases } = useHfmcStore();

  useEffect(() => { hydrate(); }, [hydrate]);

  if (!loaded) {
    // layout-shaped placeholder rather than a lone spinner: the app shell is
    // always rail + header + content, so reserving that shape stops the page
    // jumping when the real workspace paints in
    return (
      <div className="min-h-screen flex" style={{ background: "var(--bg)" }}>
        <div className="app-bg" />
        {/* rail */}
        <div className="hidden md:flex flex-col gap-3 p-4 w-[228px] shrink-0 border-r" style={{ borderColor: "var(--line-soft)" }}>
          <div className="skeleton h-6 w-32" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="skeleton h-8 w-full" />
          ))}
        </div>
        {/* header + body */}
        <div className="flex-1 flex flex-col">
          <div className="h-14 border-b flex items-center gap-3 px-5" style={{ borderColor: "var(--line-soft)" }}>
            <div className="skeleton h-7 w-40" />
            <div className="skeleton h-7 w-24" />
          </div>
          <div className="flex-1 p-5 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-20 w-full" />
              ))}
            </div>
            <div className="skeleton h-56 w-full" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="skeleton h-40 w-full" />
              <div className="skeleton h-40 w-full" />
            </div>
          </div>
        </div>
        <span className="sr-only" role="status">Loading the pipeline…</span>
      </div>
    );
  }

  if (!me) return <Login />;

  const currentCase = route.name === "case" ? cases.find((c) => c.id === route.id) : null;

  return (
    <Shell>
      {renderRoute(route)}
      <ChatBubble
        userRole="STAFF"
        pinnedCaseId={currentCase ? currentCase.id : null}
        pinnedCaseNumber={currentCase ? currentCase.caseNumber : undefined}
        pinnedCustomer={currentCase ? currentCase.customer : undefined}
      />
      <PwaInstallBanner portal="staff" />
    </Shell>
  );
}

function renderRoute(route: Route) {
  switch (route.name) {
    case "dashboard": return <Dashboard />;
    case "cases": return <Cases />;
    case "leads": return <Leads />;
    case "clients": return <Clients />;
    case "case": return <CaseDetail id={route.id} />;
    case "tasks": return <Tasks />;
    case "bulletin": return <Bulletin />;
    case "calculator": return <Calculator />;
    case "reports": return <Reports />;
    case "products": return <Products />;
    case "admin": return <Admin />;
    default: return <Dashboard />;
  }
}
