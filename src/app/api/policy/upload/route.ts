// POST /api/policy/upload — bank policy ingestion entry point.
// Accepts EITHER a pasted text block (PDF body text or an Excel copy-paste) OR
// an uploaded .xlsx/.csv workbook file (multipart). Excel is parsed with the
// already-vendored `xlsx` package — no new dependencies.
// PDF files are staged (kept, shown, honest about text extraction): the current
// runtime has no PDF text layer, so a PDF upload returns status "staged" with
// instructions to paste the body text, instead of pretending to parse it.
// Deterministic map + missing-info list; NOTHING is written to products.
import { NextRequest, NextResponse } from "next/server";
import { currentUser, flagsFor } from "@/lib/auth";
import { ingestPolicyText, ingestWorkbook } from "@/lib/policy-ingest";

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ct = req.headers.get("content-type") ?? "";
  // ---------- multipart: file upload (.xlsx / .csv) ----------
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const bank = String(form.get("bank") ?? "").trim();
    const sheetsRaw = String(form.get("sheets") ?? "");
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large (8 MB max)" }, { status: 400 });
    const name = (file.name || "").toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());

    if (name.endsWith(".pdf")) {
      // No PDF text layer in this runtime — stage, don't fake it.
      return NextResponse.json({
        status: "staged",
        kind: "pdf",
        fileName: file.name,
        size: file.size,
        message: "PDF text extraction is not available in this build yet — open the PDF, copy the rate-card/policy text, and paste it in the box below. Nothing was parsed and nothing was saved.",
        next: "paste",
      });
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
      const XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
      const wb = XLSX.read(buf, { type: "buffer" });
      const wanted = sheetsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const decoded: Array<{ name: string; rows: string[][] }> = [];
      for (const sheetName of wb.SheetNames) {
        if (wanted.length && !wanted.includes(sheetName)) continue;
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", raw: false, blankrows: false }) as string[][];
        decoded.push({ name: sheetName, rows: rows.slice(0, 400) });
      }
      const products = ingestWorkbook(decoded, { bank: bank || "Unknown bank", sheets: wanted.length ? wanted : wb.SheetNames });
      return NextResponse.json({
        status: "parsed",
        kind: "workbook",
        fileName: file.name,
        sheets: wb.SheetNames,
        products,
        next: "review",
      });
    }
    return NextResponse.json({ error: "unsupported file — upload .xlsx, .csv, or paste text (PDF text paste supported)" }, { status: 400 });
  }

  // ---------- JSON: pasted text ----------
  const body = await req.json().catch(() => ({}));
  const raw = String((body as { text?: string }).text ?? "");
  if (!raw.trim()) return NextResponse.json({ error: "text or file required" }, { status: 400 });
  const ingested = ingestPolicyText(raw.slice(0, 20000));
  return NextResponse.json({
    status: "parsed",
    kind: "text",
    ...ingested,
    next: "review",
  });
}
