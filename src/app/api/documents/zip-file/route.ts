// GET /api/documents/zip-file?key=... — serve a ZIP file from R2.
import { NextRequest } from "next/server";
import { currentUser, flagsFor } from "@/lib/auth";
import { requireDocManager } from "@/lib/domain";
import { r2Configured, r2Get } from "@/lib/r2";

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return Response.json({ error: "Your designation does not allow document access." }, { status: 403 });
  }

  if (!r2Configured()) {
    return Response.json({ error: "Cloud storage not configured." }, { status: 400 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key) return Response.json({ error: "Missing key parameter." }, { status: 400 });

  try {
    const got = await r2Get(key);
    const body = new Uint8Array(got.body.buffer) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${key.split("/").pop() || "documents.zip"}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "File not found or access denied." }, { status: 404 });
  }
}