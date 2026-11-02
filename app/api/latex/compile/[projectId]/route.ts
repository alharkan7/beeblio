import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { compileLatex, compiledLatexExists, compiledLatexPath } from "@/lib/latex-compile";
import { WorkspaceFileError } from "@/lib/workspace-files";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, { params }: Context) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const sourcePath = new URL(request.url).searchParams.get("sourcePath") || "";
  try {
    const compiled = await compiledLatexExists({ userId: user.id, projectSlug: projectId, sourcePath });
    return NextResponse.json({ compiled, path: compiled ? compiledLatexPath(sourcePath) : undefined });
  } catch { return NextResponse.json({ error: "Invalid source path" }, { status: 400 }); }
}
export async function POST(request: Request, { params }: Context) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const parsed = z.object({ sourcePath: z.string().min(1).max(1024) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid source path" }, { status: 400 });
  try { return NextResponse.json(await compileLatex({ userId: user.id, projectSlug: projectId, sourcePath: parsed.data.sourcePath })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "LaTeX compilation failed" }, { status: error instanceof WorkspaceFileError ? error.status : 500 }); }
}
