// GET /api/documents/:id/file — stream the stored file.
// Staff: any document. Clients: only their own case's client-visible documents.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { currentClient } from "@/lib/client-auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await db.caseDocument.findUnique({ where: { id: parseInt(id, 10) } });
  if (!doc || !doc.fileData) return NextResponse.json({ error: "not found" }, { status: 404 });

  const staff = await currentUser();
  if (!staff) {
    const client = await currentClient();
    if (!client || client.caseId !== doc.caseId || !doc.visibleToClient) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = new Uint8Array(doc.fileData);
  return new NextResponse(body, {
    headers: {
      "Content-Type": doc.fileType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${(doc.fileName ?? "document").replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
