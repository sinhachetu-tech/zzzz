"use client";

/* Copy-a-template button — WhatsApp / email / call script.
   Templates live in the DB (Admin → Templates); the JSON seed is only the
   bootstrap fallback so the button works before the first seed top-up. */
import { useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { renderComm } from "@/lib/workflow/comms/render";
import seedTemplates from "@/data/seed/commTemplates.json";

interface TemplateLike {
  channel: string; name: string; subject: string | null; body: string;
}

export function CommButton({ c, templateId }: { c: LoanCase; templateId: string }) {
  const { userById, toast, commTemplates } = useHfmcStore();
  const [copied, setCopied] = useState(false);

  // DB first (admin-editable wording), seed JSON as bootstrap fallback.
  let t: TemplateLike | undefined = commTemplates.find((x) => x.key === templateId && x.active);
  if (!t) {
    const s = (seedTemplates as (TemplateLike & { id: string })[]).find((x) => x.id === templateId);
    if (s) t = { channel: s.channel, name: s.name, subject: s.subject, body: s.body };
  }
  if (!t) return null;

  const owner = userById(c.ownerId)?.name ?? null;
  const text = (t.subject ? t.subject + "\n\n" : "") + renderComm(t.body, c, owner);
  const label = t.channel === "email" ? "Copy email" : t.channel === "call" ? "Call script" : "Copy WA";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    toast("success", `${t.name} copied — paste into ${t.channel === "email" ? "email" : "WhatsApp"}.`);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      className="chip transition-all hover:opacity-80"
      title={t.name}
      style={{ background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-dim)" }}
      onClick={copy}
    >
      {copied ? "Copied ✓" : `${label} · ${t.name}`}
    </button>
  );
}
