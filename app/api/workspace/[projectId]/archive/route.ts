import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getUser } from "@/lib/auth/session";
import { archiveWorkspacePaths } from "@/lib/workspace-archive";
import { AgentWorkspaceError, createWorkspaceReadTicket } from "@/lib/workspace-files";

type ArchiveItem = { path: string; isDir: boolean };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  let items: ArchiveItem[];
  let requestedName: string | undefined;
  let rootFolder: string | undefined;
  let skipMissing = false;
  try {
    const body = await request.json() as { items?: unknown; filename?: unknown; rootFolder?: unknown; skipMissing?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return new NextResponse("Select at least one item", { status: 400 });
    }
    if (body.items.length > 500) return new NextResponse("Select no more than 500 items", { status: 400 });
    items = body.items.filter(
      (item): item is ArchiveItem => Boolean(
        item && typeof item === "object" &&
        typeof (item as ArchiveItem).path === "string" &&
        typeof (item as ArchiveItem).isDir === "boolean",
      ),
    );
    if (items.length !== body.items.length) {
      return new NextResponse("Invalid archive selection", { status: 400 });
    }
    const safeName = (value: string) => path.posix.basename(value.trim()).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 120);
    if (typeof body.filename === "string") { const name = safeName(body.filename); requestedName = name ? (name.toLowerCase().endsWith(".zip") ? name : `${name}.zip`) : undefined; }
    if (typeof body.rootFolder === "string") rootFolder = safeName(body.rootFolder) || undefined;
    skipMissing = body.skipMissing === true;
  } catch {
    return new NextResponse("Invalid request body", { status: 400 });
  }

  try {
    const safePaths = items.map((item) => item.path.split("/").map((segment) => path.basename(segment)).join("/"));
    const outputPath = `.bee-downloads/${randomUUID()}.zip`;
    const archived = await archiveWorkspacePaths(user.id, projectId, safePaths, outputPath, { skipMissing, rootFolder });
    if (!archived.length) return new NextResponse("None of the selected items were found", { status: 404 });
    const ticket = await createWorkspaceReadTicket(user.id, projectId, outputPath, {
      disposition: "attachment",
      filename: requestedName ?? (items.length === 1 ? `${path.posix.basename(safePaths[0])}.zip` : "selected-files.zip"),
      ttlMs: 15 * 60_000,
    });
    return NextResponse.json({ ...ticket, archived }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AgentWorkspaceError) {
      return new NextResponse(error.message, { status: error.status });
    }
    console.error("[workspace-archive] failed", error);
    return new NextResponse("Unable to create archive", { status: 502 });
  }
}
