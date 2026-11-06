"use client";

import { SessionItem } from "./session-item";
import type { SessionSummary } from "./session-summary";

export function SessionList({
  projectId,
  sessions,
  loading,
  error,
  query,
  onSelectConversation,
  onDeleteConversation,
  onSessionsChange,
}: {
  projectId: string;
  sessions: SessionSummary[];
  loading: boolean;
  error: boolean;
  query: string;
  onSelectConversation: (sessionId: string) => void;
  onDeleteConversation: (sessionId: string) => void;
  onSessionsChange: (update: (current: SessionSummary[]) => SessionSummary[]) => void;
}) {
  if (loading && sessions.length === 0) {
    return <div role="status" aria-label="Loading conversations" className="space-y-2 py-1">
      {[0, 1, 2, 3].map((item) => <div key={item} className="h-8 animate-pulse rounded-md bg-muted/70" />)}
    </div>;
  }
  if (error && sessions.length === 0) {
    return <div className="rounded-lg border border-dashed px-3 py-5 text-center text-xs leading-5 text-muted-foreground">Couldn&apos;t load conversations. Retrying automatically.</div>;
  }
  if (sessions.length === 0) {
    return <div className="rounded-lg border border-dashed px-3 py-5 text-center text-xs leading-5 text-muted-foreground">Your analysis threads will appear here.</div>;
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSessions = normalizedQuery
    ? sessions.filter((session) => (session.title || "New Session").toLocaleLowerCase().includes(normalizedQuery))
    : sessions;
  if (filteredSessions.length === 0) {
    return <div className="rounded-lg border border-dashed px-3 py-5 text-center text-xs leading-5 text-muted-foreground">No conversations match &quot;{query.trim()}&quot;.</div>;
  }

  return <div className="w-0 min-w-full max-w-full overflow-hidden pr-3">
    {filteredSessions.map((session) => <SessionItem
      key={session.id}
      session={session}
      projectId={projectId}
      onSelect={() => onSelectConversation(session.id)}
      onDeleted={() => {
        onSessionsChange((current) => current.filter((item) => item.id !== session.id));
        onDeleteConversation(session.id);
      }}
      onRenamed={(newTitle) => onSessionsChange((current) => current.map((item) => item.id === session.id ? { ...item, title: newTitle } : item))}
    />)}
  </div>;
}
