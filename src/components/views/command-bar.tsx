"use client";

/* Mission Control — the ⌘/Ctrl+K command bar.
   One palette for the whole company: every route, every live case, quick
   actions. Fuzzy-matched by cmdk; keyboard-first; mounted only when open so
   it costs nothing at rest. Nav goes through the store (no-URL routing). */

import { useEffect, useMemo, useState } from "react";
import { useHfmcStore, type Route } from "@/lib/client-store";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { IBank, IBriefcase, ICalc, IChart, IFlag, IGrid, IInbox, IPlus, IShield, ITasks } from "@/components/icons";

const ROUTES: { label: string; route: Route; icon: (p: { size?: number }) => React.ReactNode; hint?: string }[] = [
  { label: "Dashboard", route: { name: "dashboard" }, icon: IGrid, hint: "the floor at a glance" },
  { label: "Morning Bulletin", route: { name: "bulletin" }, icon: IFlag, hint: "today's directives" },
  { label: "Leads", route: { name: "leads" }, icon: IInbox, hint: "qualify the funnel" },
  { label: "Cases", route: { name: "cases" }, icon: IBriefcase, hint: "the pipeline" },
  { label: "Task Queue", route: { name: "tasks" }, icon: ITasks, hint: "everything pending" },
  { label: "Calculator", route: { name: "calculator" }, icon: ICalc, hint: "eligibility engine" },
  { label: "Reports", route: { name: "reports" }, icon: IChart, hint: "the books" },
];

export function CommandBar({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { cases, users, me, flags, nav, openNewCase } = useHfmcStore();
  const isAdmin = !!(flags?.admin || flags?.super);

  const active = useMemo(
    () => cases.filter((c) => c.caseStatus === "Active").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40),
    [cases]
  );
  const canInstruct = !!(flags?.issueTasks || flags?.super);

  const run = (r: Route) => { onOpenChange(false); nav(r); };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Mission Control" description="Jump to a case, page or action">
      <CommandInput placeholder="Type a case, customer, or destination…" />
      <CommandList>
        <CommandEmpty>No match — try a case number or customer name.</CommandEmpty>

        <CommandGroup heading="Cases & leads">
          {active.map((c) => {
            const owner = users.find((u) => u.id === c.ownerId)?.name.split(" ")[0] ?? "";
            return (
              <CommandItem key={c.id} value={`${c.caseNumber} ${c.customer} ${c.stage} ${owner}`} onSelect={() => run({ name: "case", id: c.id })}>
                <IBriefcase size={15} />
                <span className="mono text-[12px] mr-2" style={{ color: "var(--amber)" }}>{c.caseNumber}</span>
                <span className="truncate">{c.customer}</span>
                <span className="ml-auto text-[11px] text-[var(--ink-faint)]">{c.stage}{owner ? ` · ${owner}` : ""}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Go to">
          {ROUTES.map((r) => (
            <CommandItem key={r.label} value={r.label} onSelect={() => run(r.route)}>
              <r.icon size={15} />
              <span>{r.label}</span>
              {r.hint && <span className="ml-auto text-[11px] text-[var(--ink-faint)]">{r.hint}</span>}
            </CommandItem>
          ))}
          {isAdmin && (
            <CommandItem value="Admin" onSelect={() => run({ name: "admin" })}>
              <IShield size={15} />
              <span>Admin</span>
              <span className="ml-auto text-[11px] text-[var(--ink-faint)]">users · masters · rules</span>
            </CommandItem>
          )}
        </CommandGroup>

        {canInstruct && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem value="add lead new case" onSelect={() => { onOpenChange(false); openNewCase(); }}>
                <IPlus size={15} />
                <span>Add lead</span>
                <span className="ml-auto text-[11px] text-[var(--ink-faint)]">open a new inquiry</span>
              </CommandItem>
              <CommandItem value="new directive bulletin" onSelect={() => run({ name: "bulletin" })}>
                <IFlag size={15} />
                <span>Issue a directive</span>
                <span className="ml-auto text-[11px] text-[var(--ink-faint)]">morning bulletin</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Who's on the floor">
          {users.filter((u) => u.active).slice(0, 12).map((u) => (
            <CommandItem key={u.id} value={`staff ${u.name} ${u.role}`} onSelect={() => run({ name: "tasks" })}>
              <IBank size={15} className="opacity-0" aria-hidden="true" />
              <span>{u.name}</span>
              <span className="ml-auto text-[11px] text-[var(--ink-faint)]">{u.role} · {u.team}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
