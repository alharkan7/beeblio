"use client";

import { useState } from "react";
import { Download, FileArchive, FileCode2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type DownloadFormat = "zip" | "pdf" | "tex";

/**
 * LaTeX download menu. The zip is the primary artifact: the root .tex plus
 * every included file, bibliography, and figure it references, plus the
 * compiled PDF, in workspace-relative layout so it compiles as-is and
 * uploads to Overleaf or arXiv. Zip and .tex save unsaved edits first
 * (mirroring the compile button); the PDF is whatever the last compile
 * produced.
 */
export function LatexDownloadMenu({
  projectId,
  filePath,
  sourceUrl,
  compiledPath,
  dependenciesRef,
  dependenciesReady,
  dirty,
  onSave,
}: {
  projectId: string;
  filePath: string;
  sourceUrl: string;
  compiledPath?: string;
  /** Workspace paths the document depends on, read at click time. */
  dependenciesRef: { current: ReadonlySet<string> };
  /** True once dependencies have been resolved for the current draft; before that the set is still empty and a zip would silently ship without figures and bibliography. */
  dependenciesReady: boolean;
  dirty: boolean;
  onSave: () => Promise<boolean>;
}) {
  const [downloading, setDownloading] = useState<DownloadFormat | null>(null);
  const filename = filePath.split("/").at(-1) || filePath;
  const stem = filename.replace(/\.tex$/i, "") || filename;
  const zipName = `${stem}.zip`;

  const saveBrowserFile = (url: string, name: string) => {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const downloadWorkspaceFile = (path: string) => {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    saveBrowserFile(`/api/workspace/${encodeURIComponent(projectId)}/${encoded}?download=file`, path.split("/").at(-1) || path);
  };

  const downloadSourceZip = async () => {
    // Save first so the archive matches the editor, exactly like Compile.
    if (dirty && !(await onSave())) return;
    // The compiled PDF rides along when present; skipMissing covers the
    // deleted-on-the-server case and the toast below names it.
    const manifest = [filePath, ...dependenciesRef.current, ...(compiledPath ? [compiledPath] : [])];
    const response = await fetch(`/api/workspace/${encodeURIComponent(projectId)}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: manifest.map((path) => ({ path, isDir: false })),
        filename: zipName,
        // Nest entries under the document name so extracting paper.zip
        // produces a paper/ folder instead of the bare workspace folders.
        rootFolder: stem,
        skipMissing: true,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const body = await response.json() as { url?: string; archived?: string[] };
    if (!body.url) throw new Error("Archive download URL was not returned");
    saveBrowserFile(body.url, zipName);
    const missing = manifest.filter((path) => !(body.archived ?? []).includes(path));
    if (missing.length > 0) {
      toast.warning(
        missing.length === 1
          ? "1 referenced file is missing and was skipped"
          : `${missing.length} referenced files are missing and were skipped`,
        { description: missing.join(", ").slice(0, 300) },
      );
    }
  };

  const download = async (format: DownloadFormat) => {
    setDownloading(format);
    try {
      if (format === "zip") await downloadSourceZip();
      else if (format === "pdf") downloadWorkspaceFile(compiledPath!);
      else if (dirty && !(await onSave())) return;
      else saveBrowserFile(`${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}download=file`, filename);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to download the document");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-foreground" disabled={downloading !== null} aria-label="Choose a download format">
              {downloading ? <Loader2 className="animate-spin" /> : <Download />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Download</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44 min-w-44">
        <DropdownMenuItem
          disabled={!dependenciesReady}
          onSelect={() => void download("zip")}
          title={dependenciesReady
            ? "The complete source tree — .tex, referenced files, bibliography, figures, and the compiled PDF — compiles as-is and uploads to Overleaf or arXiv"
            : "Resolving the document's references…"}
        >
          <FileArchive />Source (.zip)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!compiledPath}
          onSelect={() => void download("pdf")}
          title={compiledPath ? "The PDF from the last compile" : "Compile the document first"}
        >
          <FileText />Compiled PDF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download("tex")} title="Just this file">
          <FileCode2 />LaTeX (.tex)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
