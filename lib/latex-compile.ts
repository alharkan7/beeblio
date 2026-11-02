import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { dataDir } from "./app-paths";
import { projectFolder, readWorkspaceFile, statWorkspaceFile, WorkspaceFileError } from "./workspace-files";

const run = promisify(execFile);

export function compiledLatexPath(sourcePath: string): string {
  const relative = sourcePath.replace(/^\/?workspace\//, "").replace(/^\//, "");
  if (!relative.toLowerCase().endsWith(".tex") || relative.length > 900 ||
    relative.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new WorkspaceFileError("Choose a valid .tex file inside the project workspace", 400, "invalid_workspace_path");
  }
  return `4-Reports/Compiled/${relative.slice(0, -4)}.pdf`;
}

function texEnvironment(): NodeJS.ProcessEnv {
  const localBin = path.join(dataDir(), "texlive", "2026basic", "bin", "universal-darwin");
  return { ...process.env, PATH: `${localBin}${path.delimiter}${process.env.PATH ?? ""}` };
}

async function executable(name: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try { await run(name, ["--version"], { timeout: 5000, env }); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ENOENT"; }
}

export async function compiledLatexExists(options: { userId: string; projectSlug: string; sourcePath: string }): Promise<boolean> {
  const output = compiledLatexPath(options.sourcePath);
  try { const file = await statWorkspaceFile(options.userId, options.projectSlug, output); return file.size > 0; }
  catch (error) { if (error instanceof WorkspaceFileError && error.status === 404) return false; throw error; }
}

export async function compileLatex(options: { userId: string; projectSlug: string; sourcePath: string }) {
  const outputPath = compiledLatexPath(options.sourcePath);
  const sourcePath = options.sourcePath.replace(/^\/?workspace\//, "").replace(/^\//, "");
  const source = await readWorkspaceFile(options.userId, options.projectSlug, sourcePath);
  if (!source.content.length || source.content.length > 4 * 1024 * 1024) throw new WorkspaceFileError("LaTeX source must be between 1 byte and 4 MiB", 400, "invalid_latex_source");
  const root = await projectFolder(options.userId, options.projectSlug);
  const sourceFile = path.join(root, sourcePath);
  const realSource = await fs.realpath(sourceFile);
  if (!realSource.startsWith(`${root}${path.sep}`)) throw new WorkspaceFileError("Source escapes project folder", 400, "invalid_workspace_path");
  const cwd = path.dirname(realSource);
  const filename = path.basename(realSource);
  const env = texEnvironment();
  const jobName = `beeblio-${randomUUID()}`;
  const outputFile = path.join(cwd, `${jobName}.pdf`);
  try {
    if (await executable("latexmk", env)) {
      const args = ["-pdf", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", `-jobname=${jobName}`, filename];
      await run("latexmk", args, { cwd, env, timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
      if (await fs.stat(path.join(cwd, `${jobName}.glo`)).then(() => true, () => false) && await executable("makeglossaries", env)) {
        await run("makeglossaries", [jobName], { cwd, env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
        await run("latexmk", args, { cwd, env, timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
      }
    } else if (await executable("pdflatex", env)) {
      const args = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", `-jobname=${jobName}`, filename];
      await run("pdflatex", args, { cwd, env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      if (await executable("bibtex", env)) await run("bibtex", [jobName], { cwd, env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 }).catch(() => undefined);
      if (await fs.stat(path.join(cwd, `${jobName}.glo`)).then(() => true, () => false) && await executable("makeglossaries", env)) {
        await run("makeglossaries", [jobName], { cwd, env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
      }
      await run("pdflatex", args, { cwd, env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      await run("pdflatex", args, { cwd, env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    } else throw new WorkspaceFileError("Install a local TeX distribution with latexmk or pdflatex to compile LaTeX.", 501, "latex_compiler_unavailable");
    const stat = await fs.stat(outputFile);
    if (!stat.size) throw new Error("LaTeX compiler did not produce a PDF");
    const destination = path.join(root, outputPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const parent = await fs.realpath(path.dirname(destination));
    if (!parent.startsWith(`${root}${path.sep}`)) throw new WorkspaceFileError("Output escapes project folder", 400, "invalid_workspace_path");
    const staged = `${destination}.${randomUUID()}.tmp`;
    try { await fs.copyFile(outputFile, staged); await fs.rename(staged, destination); }
    finally { await fs.rm(staged, { force: true }); }
    return { path: outputPath, name: path.basename(outputPath) };
  } catch (error) {
    if (error instanceof WorkspaceFileError) throw error;
    const details = error as { stderr?: string; stdout?: string; message?: string };
    throw new Error((details.stderr || details.stdout || details.message || "LaTeX compilation failed").slice(-6000));
  } finally {
    const generated = await fs.readdir(cwd).catch(() => []);
    await Promise.all(generated.filter((name) => name.startsWith(`${jobName}.`)).map((name) => fs.rm(path.join(cwd, name), { force: true }).catch(() => undefined)));
  }
}
