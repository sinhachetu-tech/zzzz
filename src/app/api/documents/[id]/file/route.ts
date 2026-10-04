// GET /api/documents/:id/file?v=original|compressed&download=1
// The previously-missing preview/download endpoint. Serves the actual file:
//  - R2-backed rows → 302 to a 15-minute presigned URL (inline preview or
//    forced download). Bytes never pass through this server.
//  - Legacy rows (fileData in Postgres) → streamed directly.
// Access: staff (any signed-in team user) OR the owning client
// (visibleToClient respected). ?download=1 forces attachment disposition.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { currentClient, clientOwnsCase } from "@/lib/client-auth";
import { r2Configured, r2PresignGet, r2Get } from "@/lib/r2";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docId = parseInt(id, 10);
  if (Number.isNaN(docId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const doc = await db.caseDocument.findUnique({ where: { id: docId } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!doc.fileName) return NextResponse.json({ error: "no file uploaded yet" }, { status: 404 });

  // who is asking?
  const staff = await currentUser();
  const client = staff ? null : await currentClient();
  if (!staff && !client) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Client-scope check, not case equality — the session may now span several
  // journeys of the same person (Phase 3).
  if (client && !(await clientOwnsCase(client, doc.caseId))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (client && !doc.visibleToClient) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const wantCompressed = url.searchParams.get("v") === "compressed" && !!doc.compressedKey;
  const forceDownload = url.searchParams.get("download") === "1";
  const key = wantCompressed ? doc.compressedKey! : doc.storageKey;

  // preferred path — R2 object
  if (key && r2Configured()) {
    const signed = await r2PresignGet(key, {
      inline: !forceDownload,
      fileName: doc.fileName,
      expirySeconds: 15 * 60,
    });
    return NextResponse.redirect(signed, 302);
  }

  // legacy fallback — bytes in Postgres
  if (doc.fileData) {
    const bytes = Buffer.from(doc.fileData);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.fileType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(doc.fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // legacy fallback — R2 not configured but a storageKey exists (shouldn't
  // normally happen; means env vars were removed after upload)
  if (doc.storageKey) {
    try {
      const { body } = await r2Get(doc.storageKey);
      return new NextResponse(new Uint8Array(body), {
        headers: {
          "Content-Type": doc.fileType || "application/octet-stream",
          "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(doc.fileName)}"`,
        },
      });
    } catch {
      return NextResponse.json({ error: "storage unavailable — check R2 configuration in Admin" }, { status: 503 });
    }
  }

  return NextResponse.json({ error: "no file content available" }, { status: 404 });
}