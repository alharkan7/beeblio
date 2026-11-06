"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronUp, Plus, Search } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getProjectSessions, markSessionViewed } from "../actions";
import { SessionList } from "./session-list";
import { isUnviewed, type SessionSummary } from "./session-summary";

export function ChatHistory({
  projectId,
  initialSessions,
  open,
  query,
  newConversationHref,
  onOpenChange,
  onQueryChange,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
}: {
  readonly projectId: string;
  readonly initialSessions: SessionSummary[];
  readonly open: boolean;
  readonly query: string;
  readonly newConversationHref: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onSelectConversation: (sessionId: string) => void;
  readonly onDeleteConversation: (sessionId: string) => void;
  readonly onNewConversation: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const historyRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>(initialSessions);
  const [loading, setLoading] = useState(initialSessions.length === 0);
  const [error, setError] = useState(false);
  const unreadCount = sessions.filter(isUnviewed).length;
  const finishedCount = sessions.filter((session) => session.runStatus === "finished" && isUnviewed(session)).length;
  const runningCount = sessions.filter((session) => session.runStatus === "running").length;

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const updated = await getProjectSessions(projectId);
        const visibleSession = document.visibilityState === "visible"
          ? updated.find((session) => window.location.pathname === `/${projectId}/${session.id}` && isUnviewed(session))
          : undefined;
        if (visibleSession) {
          await markSessionViewed(projectId, visibleSession.id);
          visibleSession.lastViewedAt = new Date();
        }
        if (active) {
          setSessions(updated);
          setError(false);
        }
      } catch (cause) {
        console.error("Failed to refresh sessions:", cause);
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 12_000);
    const onChange = () => void refresh();
    window.addEventListener("beeblio:session-created", onChange);
    window.addEventListener("beeblio:session-viewed", onChange);
    document.addEventListener("visibilitychange", onChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("beeblio:session-created", onChange);
      window.removeEventListener("beeblio:session-viewed", onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, [projectId, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: globalThis.PointerEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open, onOpenChange]);

  return (
    <Collapsible
      ref={historyRef}
      open={open}
      onOpenChange={onOpenChange}
      className="shrink-0 bg-sidebar"
    >
      <div className="flex h-10 w-full items-center gap-2 border-b pl-0 pr-3 transition-colors hover:bg-accent/55">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex h-full flex-1 items-center pl-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 text-left">Chat History</span>
            {unreadCount > 0 ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground" aria-live="polite">{finishedCount === unreadCount ? `${unreadCount} Finished` : `${unreadCount} updates`}</span> : null}
            {runningCount > 0 ? <span className="text-[10px] text-muted-foreground">{runningCount} Running</span> : null}
          </button>
        </CollapsibleTrigger>
        <Button asChild size="icon-sm" className="shrink-0 rounded-full">
          <Link
            href={newConversationHref}
            aria-label="New conversation"
            onClick={onNewConversation}
          >
            <Plus />
          </Link>
        </Button>
      </div>
      <CollapsibleContent>
        <div className="mb-1.5 flex h-[min(42dvh,22rem)] min-h-0 flex-col rounded-b-xl bg-card shadow-sm">
          <div className="shrink-0 p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search conversations…"
                aria-label="Search conversations"
                className="h-8 rounded-lg pl-8 text-xs md:text-xs"
              />
            </div>
          </div>
          <ScrollArea className="min-h-0 w-full min-w-0 max-w-full flex-1 overflow-hidden px-2.5 pb-0">
            <SessionList
              projectId={projectId}
              sessions={sessions}
              loading={loading}
              error={error}
              query={query}
              onSelectConversation={(sessionId) => {
                setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, lastViewedAt: new Date() } : session));
                onSelectConversation(sessionId);
              }}
              onDeleteConversation={onDeleteConversation}
              onSessionsChange={setSessions}
            />
          </ScrollArea>
          <button
            type="button"
            className="flex h-5 w-full items-center justify-center rounded-b-xl bg-transparent text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            onClick={() => onOpenChange(false)}
            aria-label="Close chat history"
          >
            <ChevronUp className="size-3.5" />
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
