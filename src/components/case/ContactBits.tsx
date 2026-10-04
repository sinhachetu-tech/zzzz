"use client";

/* ContactBits — the person's contact details, rendered the same way everywhere
   a lead/case/client is listed.

   WHY A SHARED COMPONENT: the contact data is scattered across three places by
   design — the phone lives on LoanCase.whatsapp, the email on Client.email, and
   both are ALSO mirrored inside profileJson.primary (the case's own snapshot as
   filed). Each screen used to read a different one of those, which is why the
   Leads tab showed a phone but no email while Case 360 showed an email but no
   phone. This resolves all three, in priority order, so every screen tells the
   same story.

   Resolution order (first non-empty wins):
     phone → profile.primary.phone → client.phone → case.whatsapp
     email → profile.primary.email → client.email
   The case's own profile is preferred over the Client master because the master
   is shared across every engagement this person has with us — a snapshot taken
   when this case was filed is the more accurate one for this case.

   Missing values render as an explicit amber "not captured" rather than an
   em-dash, so a data gap is visible instead of looking like a blank cell. */

import { parseCaseProfile } from "@/lib/case-profile";
import type { BankItem, ClientDto, LoanCase } from "@/lib/types";
import { Chip } from "@/components/hfmc/ui";

/**
 * A bank's logo, served from the existing `/api/banks/:id/logo` endpoint.
 *
 * The store's `BankItem` already carries `hasLogo` (serBank sets it from
 * `logoData`), so no extra fetch is needed — the image is a plain <img> against
 * the API route, exactly as the Products browser and the client-facing proposal
 * already do it.
 *
 * WHY THE FALLBACK MATTERS: plenty of banks have no logo uploaded yet, and an
 * empty box reads as a rendering bug. A lettered monogram tile in the bank's own
 * name keeps a row visually complete and stable, so adding a logo later swaps
 * the tile for the real mark without changing any layout.
 *
 * `size` is the tile edge in px. The image is object-fit:contain on a neutral
 * tile because bank logos are wildly inconsistent in aspect ratio and padding —
 * some are wide wordmarks, some round marks — and contain is the only fit that
 * does not crop or distort them.
 */
export function BankLogo({ bank, size = 28 }: { bank: Pick<BankItem, "id" | "name" | "hasLogo">; size?: number }) {
  const hasLogo = bank.hasLogo;
  const letter = (bank.name || "?").trim().charAt(0).toUpperCase() || "?";

  if (hasLogo) {
    return (
      <img
        src={`/api/banks/${bank.id}/logo`}
        alt={bank.name}
        title={bank.name}
        width={size}
        height={size}
        // object-contain, never a fixed aspect: wordmarks are far wider than tall.
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          background: "var(--bg2)",
          borderRadius: Math.max(4, Math.round(size * 0.18)),
          border: "1px solid var(--line-soft)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <span
      title={`${bank.name} (no logo uploaded)`}
      aria-label={bank.name}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--tint)",
        border: "1px solid var(--line-soft)",
        borderRadius: Math.max(4, Math.round(size * 0.18)),
        color: "var(--ink-faint)",
        fontWeight: 700,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        fontFamily: "var(--font-disp, inherit)",
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

export interface ResolvedContact {
  phone: string;
  email: string;
  eidNo: string;
  passportNo: string;
  name: string;
}

/** Digits-only phone, for tel: and wa.me links. Falls back to the raw string. */
export function telHref(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return `tel:+${d}`;
}

export function mailtoHref(email: string): string {
  return `mailto:${email}`;
}

/** Resolve contact details for a case from its profile, the client master and
 *  the case's own flat columns — see the priority note at the top of the file. */
export function resolveContact(c: LoanCase, client: ClientDto | null | undefined): ResolvedContact {
  const prof = parseCaseProfile(c.profileJson, {
    customer: c.customer,
    whatsapp: c.whatsapp,
    loanAmount: c.loanAmount,
    coApplicantName: c.coApplicantName,
  });
  const p = prof.primary;
  return {
    name: p.fullName || c.customer || "",
    phone: (p.phone || client?.phone || c.whatsapp || "").trim(),
    email: (p.email || client?.email || "").trim(),
    eidNo: (p.eidNo || client?.eidNo || "").trim(),
    passportNo: (p.passportNo || client?.passportNo || "").trim(),
  };
}

/** The identity chip row: EID / passport on file, or an amber KYC gap. */
export function KycChip({ contact }: { contact: ResolvedContact }) {
  if (contact.eidNo) return <Chip tone="mint">EID {contact.eidNo}</Chip>;
  if (contact.passportNo) return <Chip tone="mint">Passport {contact.passportNo}</Chip>;
  return <Chip tone="amber">KYC not captured</Chip>;
}

/** Phone + email as tappable links, with an amber gap marker when absent.
 *  `size` is the text size; the links stay legible on both desktop and mobile. */
export function ContactLine({ contact, size = 12.5 }: { contact: ResolvedContact; size?: number }) {
  const dim = { color: "var(--ink-faint)", fontSize: size };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ fontSize: size }}>
      {contact.phone ? (
        <a
          href={telHref(contact.phone)}
          className="mono underline decoration-dotted underline-offset-2 hover:no-underline"
          style={{ color: "var(--ink-dim)" }}
          title={`Call ${contact.phone}`}
        >
          {contact.phone}
        </a>
      ) : (
        <span style={dim}>no phone</span>
      )}
      {contact.email ? (
        <a
          href={mailtoHref(contact.email)}
          className="underline decoration-dotted underline-offset-2 hover:no-underline truncate"
          style={{ color: "var(--ink-dim)" }}
          title={`Email ${contact.email}`}
        >
          {contact.email}
        </a>
      ) : (
        <span style={dim}>no email</span>
      )}
    </div>
  );
}
