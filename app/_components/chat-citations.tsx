"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { getFileContent } from "@/app/[projectId]/file-actions";
import { readCachedBibliography, writeCachedBibliography } from "@/app/[projectId]/_components/editors/bibliography-cache";
import { citationKeys, type CitationReference } from "@/lib/citations";
import { openWorkspaceEntry } from "@/lib/chat-context";
import { PROJECT_BIBLIOGRAPHY_PATH } from "@/lib/project-bibliography";
import { WORKSPACE_CHANGED_EVENT, type WorkspaceChangedDetail } from "@/lib/workspace-change";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const CitationContext = createContext<{ references: Map<string, CitationReference>; loaded: boolean } | null>(null);
export const CHAT_CITATION_TITLE = "Chat citation: ";

export function ChatCitationProvider({ projectId, children }: { projectId?: string; children: ReactNode }) {
  const cacheKey = `project:${projectId}`;
  const [references, setReferences] = useState(() => readCachedBibliography(cacheKey)?.references ?? []);
  const [loaded, setLoaded] = useState(() => Boolean(readCachedBibliography(cacheKey)));

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const load = async () => {
      try {
        const source = await getFileContent(projectId, PROJECT_BIBLIOGRAPHY_PATH);
        if (!active) return;
        setReferences(source === null ? [] : writeCachedBibliography(cacheKey, source).references);
        setLoaded(true);
      } catch {
        if (active) setLoaded(true);
      }
    };
    const onChange = (event: Event) => {
      const files = (event as CustomEvent<WorkspaceChangedDetail>).detail?.files;
      const changed = files?.find((file) => file.path === PROJECT_BIBLIOGRAPHY_PATH);
      if (changed) {
        setReferences(writeCachedBibliography(cacheKey, changed.content).references);
        setLoaded(true);
      } else if (!files?.length) {
        void load();
      }
    };
    void load();
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onChange);
    return () => { active = false; window.removeEventListener(WORKSPACE_CHANGED_EVENT, onChange); };
  }, [cacheKey, projectId]);

  const value = useMemo(() => ({ references: new Map(references.map((reference) => [reference.id, reference])), loaded }), [references, loaded]);
  return <CitationContext.Provider value={value}>{children}</CitationContext.Provider>;
}

export function ChatCitation({ token }: { token: string }) {
  const bibliography = useContext(CitationContext);
  const keys = citationKeys(token.slice(1, -1));
  const references = keys.map((key) => bibliography?.references.get(key));
  const sourceLinks = references.flatMap((reference, index) => {
    const url = reference?.doi ? `https://doi.org/${reference.doi}` : reference?.url;
    return url ? [{ key: keys[index], url }] : [];
  });
  const missing = bibliography?.loaded && references.some((reference) => !reference);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`inline rounded px-0.5 font-medium underline decoration-dotted underline-offset-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${missing ? "text-destructive" : "text-primary"}`} aria-label={`Citation ${token}${missing ? ", reference not found" : ""}`}>
          {token}
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-80 w-80 overflow-y-auto p-3" align="start">
        <div className="space-y-3">
          {keys.map((key, index) => {
            const reference = references[index];
            return <div key={key} className="space-y-1 text-xs">
              {/* <div className="flex items-center gap-1.5 font-mono text-muted-foreground"><BookOpen className="size-3.5" />@{key}</div> */}
              {reference ? <>
                <div className="font-semibold text-foreground">{reference.title || "Untitled reference"}</div>
                <div className="text-muted-foreground">{[reference.authors, reference.year, reference.container].filter(Boolean).join(" · ")}</div>
              </> : <div className="text-muted-foreground">{bibliography?.loaded ? "Reference not found in project bibliography" : "Loading reference…"}</div>}
            </div>;
          })}
          <div className="flex items-start justify-between gap-3 pt-2 text-xs">
            <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
              {sourceLinks.map(({ key, url }) => <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-primary underline" aria-label={`Open Source for ${key}`}>Open Source <ExternalLink className="size-3" /></a>)}
            </div>
            <button type="button" className="shrink-0 whitespace-nowrap text-primary underline" onClick={() => openWorkspaceEntry({ path: PROJECT_BIBLIOGRAPHY_PATH })}>Open Bibliography</button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Split only markdown text nodes. Code, links, and other structured nodes keep
// their literal text, including citation-shaped examples in fenced code.
export function remarkChatCitations() {
  return (tree: { children?: unknown[] }) => {
    const walk = (node: { type?: string; children?: unknown[] }) => {
      if (!node.children || node.type === "link" || node.type === "linkReference") return;
      node.children = node.children.flatMap((child) => {
        const item = child as { type?: string; value?: string; children?: unknown[] };
        if (item.type !== "text" || !item.value) { walk(item); return [item]; }
        const result: unknown[] = [];
        const pattern = /\[@[A-Za-z0-9_:.-]+(?:\s*;\s*@[A-Za-z0-9_:.-]+)*\]/g;
        let start = 0;
        for (const match of item.value.matchAll(pattern)) {
          const index = match.index ?? 0;
          if (index > start) result.push({ type: "text", value: item.value.slice(start, index) });
          result.push({ type: "chatCitation", children: [{ type: "text", value: match[0] }], data: { hName: "span", hProperties: { title: `${CHAT_CITATION_TITLE}${match[0]}` } } });
          start = index + match[0].length;
        }
        if (!result.length) return [item];
        if (start < item.value.length) result.push({ type: "text", value: item.value.slice(start) });
        return result;
      });
    };
    walk(tree);
  };
}
