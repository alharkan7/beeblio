"use client";

import { useEffect, useRef, useState } from "react";
import { Code2, Columns2, Eye, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OPEN_WORKSPACE_FILE_EVENT } from "@/lib/chat-context";
import { announceWorkspaceChange } from "@/lib/workspace-change";

import { PROJECT_BIBLIOGRAPHY_PATH } from "@/lib/project-bibliography";
import { bibliographyReferences, type CitationReference } from "@/lib/citations";
import { WORKSPACE_CHANGED_EVENT, type WorkspaceChangedDetail } from "@/lib/workspace-change";
import { usePublicView } from "@/app/share/[shareId]/_components/public-view-context";
import { getFileContent } from "../../file-actions";
import { EditorShell } from "./editor-shell";
import { EditorError, EditorLoading } from "./editor-states";
import { readCachedBibliography, writeCachedBibliography } from "./bibliography-cache";
import { LatexReadingPreview } from "./latex-reading-preview";
import { resolveLatexDocument, type LatexFileIssue } from "./latex-document";
import { LatexDownloadMenu } from "./latex-download-menu";
import { LatexSourceEditor } from "./latex-source-editor";
import type { WorkspaceEditorProps } from "./types";
import { useTextFile } from "./use-text-file";

export function LatexEditor({ projectId, file, sourceUrl, onSaved }: WorkspaceEditorProps) {
  const text = useTextFile(projectId, file.path, onSaved);
  const [mode, setMode] = useState<"source" | "preview" | "split">("split");
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState(false);
  const [compiledPath, setCompiledPath] = useState<string>();
  const publicView = usePublicView();
  useEffect(() => {
    if (publicView.shareId) return;
    let active = true;
    void fetch(`/api/latex/compile/${encodeURIComponent(projectId)}?sourcePath=${encodeURIComponent(file.path)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((result: { compiled?: boolean; path?: string } | null) => { if (active) { setCompiled(!!result?.compiled); setCompiledPath(result?.path); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, [projectId, file.path, publicView.shareId]);
  const bibliographyKey = publicView.shareId ? `share:${publicView.shareId}` : `project:${projectId}`;
  const [version, setVersion] = useState(0);
  const [resolved, setResolved] = useState<{ input: string; source: string; references: CitationReference[]; issues: LatexFileIssue[] }>();
  const dependencies = useRef(new Set<string>());
  const requestId = useRef(0);

  useEffect(() => {
    const request = ++requestId.current;
    const read = async (path: string): Promise<string | null> => {
      if (publicView.shareId) {
        const encoded = path.split("/").map(encodeURIComponent).join("/");
        const response = await fetch(`/api/share/${encodeURIComponent(publicView.shareId)}/${encoded}`, { cache: "no-store" });
        return response.ok ? response.text() : null;
      }
      return getFileContent(projectId, path);
    };
    const timer = window.setTimeout(() => {
      void (async () => {
        const document = await resolveLatexDocument(file.path, text.draft, read);
        const issues = [...document.issues];
        let references: CitationReference[] = [];
        if (document.bibliographyPaths.length) {
          const sources = await Promise.all(document.bibliographyPaths.map(async (path) => {
            const source = await read(path).catch(() => null);
            if (source === null) issues.push({ path, line: 1, message: `Bibliography unavailable: ${path}` });
            return source;
          }));
          references = sources.flatMap((source) => source === null ? [] : bibliographyReferences(source));
        } else {
          const source = await read(PROJECT_BIBLIOGRAPHY_PATH).catch(() => null);
          references = source === null
            ? readCachedBibliography(bibliographyKey)?.references ?? []
            : writeCachedBibliography(bibliographyKey, source).references;
        }
        if (request !== requestId.current) return;
        dependencies.current = new Set([
          ...document.dependencies,
          ...document.bibliographyPaths,
          ...(document.bibliographyPaths.length ? [] : [PROJECT_BIBLIOGRAPHY_PATH]),
        ]);
        setResolved({ input: text.draft, source: document.source, references, issues });
      })();
    }, 180);
    return () => { window.clearTimeout(timer); requestId.current++; };
  }, [projectId, file.path, text.draft, publicView.shareId, bibliographyKey, version]);

  useEffect(() => {
    if (publicView.shareId) return;
    const refresh = (event: Event) => {
      const paths = event.type === "beeblio:reload-workspace-file"
        ? [(event as CustomEvent<{ path?: string }>).detail?.path]
        : (event as CustomEvent<WorkspaceChangedDetail>).detail?.files?.map((item) => item.path);
      if (!paths?.length || paths.some((path) => path && dependencies.current.has(path))) setVersion((current) => current + 1);
    };
    window.addEventListener("beeblio:reload-workspace-file", refresh);
    window.addEventListener(WORKSPACE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("beeblio:reload-workspace-file", refresh);
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, refresh);
    };
  }, [publicView.shareId]);

  const document = resolved?.input === text.draft ? resolved : undefined;
  const compile = async () => {
    if (compiling || publicView.shareId) return;
    setCompiling(true);
    try {
      if (text.dirty && !(await text.save())) return;
      const response = await fetch(`/api/latex/compile/${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: file.path }),
      });
      const result = await response.json() as { path?: string; name?: string; error?: string };
      if (!response.ok || !result.path || !result.name) throw new Error(result.error || "LaTeX compilation failed");
      setCompiled(true);
      setCompiledPath(result.path);
      announceWorkspaceChange();
      toast.success(`Compiled ${result.name}`);
      window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_FILE_EVENT, { detail: { path: result.path, name: result.name } }));
      window.dispatchEvent(new CustomEvent("beeblio:reload-workspace-file", { detail: { path: result.path } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "LaTeX compilation failed");
    } finally {
      setCompiling(false);
    }
  };
  const lines = text.draft.split(/\r?\n/).length;
  const source = <div className="flex h-full min-h-0 flex-col"><div className="flex h-8 shrink-0 items-center justify-between border-b bg-muted/50 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><span>LaTeX source</span><span>{lines} lines</span></div><LatexSourceEditor value={text.draft} onChange={text.setDraft} /></div>;
  const preview = <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-b bg-muted/50 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Live preview</span>
      {/* <span className="hidden normal-case tracking-normal sm:inline">Compile for the final PDF</span> */}
    </div>
    <div className="min-h-0 flex-1 overflow-auto bg-neutral-200 p-5 dark:bg-neutral-900">
      <LatexReadingPreview source={document?.source ?? text.draft} references={document?.references ?? []} fileIssues={document?.issues ?? []} projectId={projectId} filePath={file.path} shareId={publicView.shareId ?? undefined} />
    </div>
  </div>;
  return <EditorShell path={file.path} sourceUrl={sourceUrl} dirty={text.dirty} status={!text.loading && !text.error ? <span className="text-xs text-muted-foreground">{lines.toLocaleString()} Lines</span> : undefined} leadingActions={<Button type="button" size="sm" variant="outline" disabled={compiling || text.saving || text.loading || !!text.error} onClick={() => void compile()}>{compiling ? <Loader2 className="animate-spin" /> : <Play />}{compiling ? "Compiling…" : compiled ? "Recompile" : "Compile"}</Button>} downloadAction={publicView.shareId ? undefined : <LatexDownloadMenu projectId={projectId} filePath={file.path} sourceUrl={sourceUrl} compiledPath={compiledPath} dependenciesRef={dependencies} dependenciesReady={document !== undefined} dirty={text.dirty} onSave={() => text.save()} />} viewModes={[{
    value: mode,
    onChange: (value) => setMode(value as "source" | "preview" | "split"),
    options: [
      { value: "preview", label: "Preview", icon: Eye },
      { value: "source", label: "Edit source", icon: Code2 },
      { value: "split", label: "Split source and preview", icon: Columns2 },
    ],
  }]} discard={{ onDiscard: text.discard, disabled: text.saving }} save={{ onClick: () => text.save(), saving: text.saving }} review={text.review}>
    {text.loading ? <EditorLoading name={file.name} size={file.size} /> : text.error ? <EditorError message={text.error} /> : mode === "source" ? source : mode === "preview" ? preview : <div className="grid h-full min-h-0 grid-cols-2 divide-x">{source}{preview}</div>}
  </EditorShell>;
}
