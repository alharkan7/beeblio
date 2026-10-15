"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Check,
  Quote,
  FileText,
  Sparkles,
  AlertTriangle,
  AlertCircle,
  X,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileSearch,
  GripHorizontal,
  RotateCcw,
} from "lucide-react";
import type { CitationFindMatch } from "@/lib/citation-finder";
import { OPEN_WORKSPACE_FILE_EVENT } from "@/lib/chat-context";
import { cn } from "@/lib/utils";

export type CitationApprovalState = {
  isOpen: boolean;
  text: string;
  range: { from: number; to: number };
  draftFilePath: string;
  status: "searching" | "found" | "not_found" | "error";
  match?: CitationFindMatch;
  matches?: CitationFindMatch[];
  error?: string;
};

export function CitationReviewDock({
  state,
  onClose,
  onApprove,
  onReject,
}: {
  state: CitationApprovalState | null;
  onClose: () => void;
  onApprove: (match: CitationFindMatch, range: { from: number; to: number }, draftFilePath: string) => void;
  onReject: () => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const dragStartRef = useRef<{
    startPointerX: number;
    startPointerY: number;
    startElemX: number;
    startElemY: number;
  } | null>(null);

  // Restore saved position on mount (client-only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("beeblio_citation_dock_position");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
          setPosition(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist position whenever it changes
  useEffect(() => {
    try {
      if (position) {
        localStorage.setItem("beeblio_citation_dock_position", JSON.stringify(position));
      } else {
        localStorage.removeItem("beeblio_citation_dock_position");
      }
    } catch {
      // ignore
    }
  }, [position]);

  // Keep dock inside screen viewport on resize or expand/collapse
  useEffect(() => {
    if (!position) return;

    const clampToViewport = () => {
      const node = cardRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const minX = 8;
      const maxX = Math.max(minX, window.innerWidth - rect.width - 8);
      const minY = 8;
      const maxY = Math.max(minY, window.innerHeight - rect.height - 8);

      setPosition((prev) => {
        if (!prev) return null;
        const nextX = Math.round(Math.min(Math.max(prev.x, minX), maxX));
        const nextY = Math.round(Math.min(Math.max(prev.y, minY), maxY));
        if (nextX === prev.x && nextY === prev.y) return prev;
        return { x: nextX, y: nextY };
      });
    };

    const rafId = requestAnimationFrame(clampToViewport);
    window.addEventListener("resize", clampToViewport);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", clampToViewport);
    };
  }, [minimized]);

  // Global safety listener for pointer up
  useEffect(() => {
    if (!isDragging) return;
    const handleGlobalPointerUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [isDragging]);

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea, [role='button']")) {
      return;
    }
    const node = cardRef.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    dragStartRef.current = {
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startElemX: rect.left,
      startElemY: rect.top,
    };
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragStartRef.current || !cardRef.current) return;
    const deltaX = e.clientX - dragStartRef.current.startPointerX;
    const deltaY = e.clientY - dragStartRef.current.startPointerY;

    const rect = cardRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const rawX = dragStartRef.current.startElemX + deltaX;
    const rawY = dragStartRef.current.startElemY + deltaY;

    const minX = 8;
    const maxX = Math.max(minX, window.innerWidth - width - 8);
    const minY = 8;
    const maxY = Math.max(minY, window.innerHeight - height - 8);

    const clampedX = Math.min(Math.max(rawX, minX), maxX);
    const clampedY = Math.min(Math.max(rawY, minY), maxY);

    setPosition({ x: Math.round(clampedX), y: Math.round(clampedY) });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (dragStartRef.current) {
      dragStartRef.current = null;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [state?.text]);

  if (!state || !state.isOpen) return null;

  const { status, text, error, range, draftFilePath } = state;
  const matches: CitationFindMatch[] =
    state.matches && state.matches.length > 0
      ? state.matches
      : state.match
        ? [state.match]
        : [];
  const activeMatch = matches[selectedIndex] ?? matches[0] ?? state.match;

  const handleOpenSourceForMatch = (m: CitationFindMatch) => {
    if (!m.sourceFilePath) return;
    window.dispatchEvent(
      new CustomEvent(OPEN_WORKSPACE_FILE_EVENT, {
        detail: {
          path: m.sourceFilePath,
          name: m.sourceFileName || m.sourceFilePath.split("/").pop() || "source",
        },
      }),
    );
  };

  const handleBackToDraft = () => {
    if (!draftFilePath) return;
    window.dispatchEvent(
      new CustomEvent(OPEN_WORKSPACE_FILE_EVENT, {
        detail: {
          path: draftFilePath,
          name: draftFilePath.split("/").pop() || "draft",
        },
      }),
    );
  };

  // Minimized Pill view (Draggable)
  if (minimized) {
    return (
      <aside
        ref={cardRef}
        aria-label="Citation review dock"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, a, [role='button']")) {
            setPosition(null);
          }
        }}
        style={
          position
            ? {
                left: `${position.x}px`,
                top: `${position.y}px`,
                right: "auto",
                bottom: "auto",
              }
            : undefined
        }
        className={cn(
          "fixed z-50 flex items-center gap-2 rounded-full border border-primary/30 bg-background/95 px-3 py-1.5 shadow-xl backdrop-blur-md cursor-grab active:cursor-grabbing select-none touch-none",
          !position && "bottom-4 right-4",
          isDragging ? "transition-none ring-2 ring-primary/40 shadow-2xl scale-[1.02]" : "transition-all duration-200",
        )}
        title="Drag anywhere to reposition · Double-click to reset"
      >
        <GripHorizontal className="size-3.5 text-muted-foreground/60 shrink-0 pointer-events-none" />
        <Sparkles className="size-3.5 text-primary animate-pulse shrink-0 pointer-events-none" />
        <span className="text-xs font-semibold text-foreground pointer-events-none select-none">
          {status === "searching" && "Searching citations…"}
          {status === "found" && activeMatch && (
            <>
              {matches.length > 1 ? `${matches.length} matches · ` : ""}
              Top: @{activeMatch.citationKey} ({activeMatch.score}%)
            </>
          )}
          {status === "not_found" && "No citations found"}
          {status === "error" && "Citation search error"}
        </span>
        {status === "found" && activeMatch?.sourceFilePath ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => handleOpenSourceForMatch(activeMatch)}
            className="h-6 gap-1 px-1.5 text-[11px] text-primary hover:text-primary pointer-events-auto"
            title="Check source file"
          >
            Check source <ExternalLink className="size-3" />
          </Button>
        ) : null}
        {position && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => setPosition(null)}
            className="size-6 text-muted-foreground hover:text-foreground pointer-events-auto"
            title="Reset position to bottom-right"
          >
            <RotateCcw className="size-3" />
          </Button>
        )}
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setMinimized(false)}
          className="size-6 text-muted-foreground hover:text-foreground pointer-events-auto"
          title="Expand citation review"
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          className="size-6 text-muted-foreground hover:text-foreground pointer-events-auto"
          title="Dismiss"
        >
          <X className="size-3.5" />
        </Button>
      </aside>
    );
  }

  // Expanded Non-Modal Floating Card (Draggable by Header)
  return (
    <aside
      ref={cardRef}
      aria-label="Citation review dock"
      style={
        position
          ? {
              left: `${position.x}px`,
              top: `${position.y}px`,
              right: "auto",
              bottom: "auto",
            }
          : undefined
      }
      className={cn(
        "fixed z-50 flex w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border/80 bg-background/95 shadow-2xl backdrop-blur-md",
        !position && "bottom-4 right-4",
        isDragging ? "transition-none ring-2 ring-primary/40 shadow-2xl" : "transition-all duration-200",
      )}
    >
      {/* Header (Draggable Handle) */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, a, [role='button']")) {
            setPosition(null);
          }
        }}
        className="flex items-center justify-between border-b bg-muted/40 px-3.5 py-2.5 cursor-grab active:cursor-grabbing select-none touch-none"
        title="Drag anywhere to reposition · Double-click to reset"
      >
        <div className="flex items-center gap-2 min-w-0 pointer-events-none">
          <GripHorizontal className="size-3.5 text-muted-foreground/60 shrink-0" />
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Sparkles className="size-3.5" />
          </div>
          <span className="truncate text-xs font-semibold text-foreground">
            {status === "searching" && "Searching Bibliography Knowledge Base"}
            {status === "found" && (
              matches.length > 1
                ? `Choose Citation (${matches.length} Scored Matches)`
                : "Citation Review & Verification"
            )}
            {status === "not_found" && "Citation Search"}
            {status === "error" && "Citation Search Error"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 pointer-events-auto">
          {position && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => setPosition(null)}
              className="size-6 text-muted-foreground hover:text-foreground"
              title="Reset position to bottom-right"
            >
              <RotateCcw className="size-3" />
            </Button>
          )}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => setMinimized(true)}
            className="size-6 text-muted-foreground hover:text-foreground"
            title="Minimize to floating pill"
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            className="size-6 text-muted-foreground hover:text-foreground"
            title="Close"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Content Area */}
      <div className="max-h-[min(68vh,520px)] overflow-y-auto p-3.5 space-y-3">
        {status === "searching" && (
          <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
            <Spinner className="size-6 text-primary" />
            <div className="space-y-1">
              <p className="text-xs font-medium">Scanning references &amp; knowledge files…</p>
              <p className="text-[11px] text-muted-foreground">
                You can keep browsing while we rank and score matches.
              </p>
            </div>
            <div className="w-full rounded-md border bg-muted/30 p-2 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Selected passage:
              </p>
              <p className="line-clamp-2 text-xs italic text-foreground/80">"{text}"</p>
            </div>
          </div>
        )}

        {status === "found" && matches.length > 0 && (
          <div className="space-y-3">
            {/* Written passage in document */}
            <div className="rounded-md border bg-muted/30 p-2.5">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <FileText className="size-3" />
                <span>Your written text in document:</span>
              </div>
              <div className="text-xs italic leading-relaxed text-foreground/90">
                "{text}"
              </div>
            </div>

            {/* Candidate Matches Header */}
            <div className="flex items-center justify-between text-xs font-semibold text-foreground pt-0.5">
              <span>Candidate Matches ({matches.length})</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                Select one to inspect &amp; cite
              </span>
            </div>

            {/* List of Scored Candidates */}
            <div className="space-y-2">
              {matches.map((m, idx) => {
                const isSelected = idx === selectedIndex;
                const scoreColor =
                  m.score >= 80
                    ? "bg-emerald-600 dark:bg-emerald-500"
                    : m.score >= 60
                      ? "bg-blue-600 dark:bg-blue-500"
                      : "bg-amber-600 dark:bg-amber-500";

                return (
                  <div
                    key={`${m.citationKey}:${m.sourceLocation}:${idx}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedIndex(idx)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSelectedIndex(idx);
                    }}
                    className={cn(
                      "rounded-lg border p-3 transition-all cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30 shadow-xs"
                        : "border-border/80 bg-card/60 hover:bg-muted/40 hover:border-primary/40",
                    )}
                  >
                    {/* Top Row: Score Badge, Citation Key, Location & Check Source Button */}
                    <div className="flex items-center justify-between gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className={cn(
                          "inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold font-mono text-white",
                          scoreColor,
                        )}>
                          {m.score}% Match
                        </span>
                        <Badge variant="outline" className="border-primary/40 px-1.5 py-0 text-[10px] font-mono text-primary font-semibold">
                          @{m.citationKey}
                        </Badge>
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {m.sourceLocation}
                        </Badge>
                      </div>

                      {m.sourceFilePath ? (
                        <Button
                          type="button"
                          size="xs"
                          variant={isSelected ? "default" : "outline"}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenSourceForMatch(m);
                          }}
                          className={cn(
                            "h-6 shrink-0 gap-1 px-2 text-[11px] shadow-2xs",
                            isSelected
                              ? "bg-primary text-primary-foreground hover:bg-primary/90"
                              : "text-foreground hover:text-primary",
                          )}
                          title="Open source file in workspace to inspect"
                        >
                          <FileSearch className="size-3" />
                          Check Source
                        </Button>
                      ) : null}
                    </div>

                    {/* Reference Title & Authors */}
                    <div className="mt-1.5 min-w-0">
                      <p className="font-semibold text-xs text-foreground truncate">
                        {m.reference.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {m.reference.authors} {m.reference.year ? `(${m.reference.year})` : ""}
                      </p>
                    </div>

                    {/* Details if Selected vs Snippet if Unselected */}
                    {isSelected ? (
                      <div className="mt-2.5 pt-2 border-t border-primary/15 space-y-2">
                        <div className="rounded-md border border-primary/20 bg-background/85 p-2 text-xs">
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-primary mb-1">
                            <Quote className="size-3" />
                            <span>Original text in source ({m.sourceLocation}):</span>
                          </div>
                          <p className="italic leading-relaxed text-foreground/95">
                            "{m.originalText}"
                          </p>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-normal">
                          <span className="font-medium text-foreground">Why it matches:</span> {m.explanation}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] italic text-muted-foreground line-clamp-1">
                        "{m.originalText}"
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {status === "not_found" && (
          <div className="space-y-2.5 py-2">
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold">No supporting citations found</p>
                <p className="mt-0.5 text-amber-900/80 dark:text-amber-300/80">
                  {error || "None of the references or files in your bibliography knowledge base match this passage."}
                </p>
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                Checked passage:
              </p>
              <p className="italic text-foreground/80 line-clamp-2">"{text}"</p>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Search failed</p>
              <p className="mt-0.5">{error || "Could not complete citation search."}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between border-t bg-muted/20 px-3.5 py-2.5">
        {status === "found" && activeMatch ? (
          <>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={handleBackToDraft}
                className="h-7 text-[11px]"
                title="Focus the draft document tab"
              >
                Back to draft
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onReject}
                className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Reject
              </Button>
            </div>
            <Button
              type="button"
              size="xs"
              className="h-7 gap-1 px-3 text-[11px]"
              onClick={() => onApprove(activeMatch, range, draftFilePath)}
            >
              <Check className="size-3" />
              Approve &amp; Cite (@{activeMatch.citationKey})
            </Button>
          </>
        ) : (
          <div className="ml-auto">
            <Button type="button" variant="outline" size="xs" onClick={onClose} className="h-7 text-[11px]">
              Close
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
