import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { projects } from "@/db/schema";
import { getUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.slug, projectId), eq(projects.userId, user.id), isNull(projects.deletedAt)),
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const body: unknown = await req.json();
    const selected = typeof body === "object" && body !== null && "folderPath" in body
      ? (body as { folderPath: unknown }).folderPath : undefined;
    if (typeof selected !== "string" || !path.isAbsolute(selected)) {
      return NextResponse.json({ error: "Select an existing folder" }, { status: 400 });
    }
    const folderPath = await fs.realpath(selected);
    if (!(await fs.stat(folderPath)).isDirectory()) {
      return NextResponse.json({ error: "The selected path is not a folder" }, { status: 400 });
    }
    if (folderPath === project.folderPath) return NextResponse.json({ success: true });

    const linked = await db.query.projects.findFirst({
      where: and(eq(projects.userId, user.id), eq(projects.folderPath, folderPath), isNull(projects.deletedAt)),
    });
    if (linked && linked.id !== project.id) {
      return NextResponse.json({ error: "This folder is already linked to another project" }, { status: 409 });
    }

    await db.update(projects).set({ folderPath, updatedAt: new Date() }).where(
      and(eq(projects.id, project.id), eq(projects.userId, user.id), isNull(projects.deletedAt)),
    );
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "The folder could not be opened. Check its path and permissions." }, { status: 400 });
  }
}
