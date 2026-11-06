"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
import { agentSessions, projects } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";

export const getOwnedProject = cache(async (user: { id: string }, projectSlug: string) => {
  return db.query.projects.findFirst({
    where: and(
      eq(projects.slug, projectSlug),
      eq(projects.userId, user.id),
      isNull(projects.deletedAt),
    ),
  });
});

import { revalidatePath } from "next/cache";

export async function renameSession(sessionId: string, newTitle: string) {
  const user = await requireUser();
  const session = await db.query.agentSessions.findFirst({
    where: eq(agentSessions.id, sessionId),
  });
  
  if (!session) {
    throw new Error("Session not found");
  }
  
  const proj = await db.query.projects.findFirst({
    where: eq(projects.id, session.projectId),
  });

  if (!proj || proj.userId !== user.id) {
    throw new Error("Unauthorized");
  }

  await db
    .update(agentSessions)
    .set({ title: newTitle, updatedAt: new Date() })
    .where(eq(agentSessions.id, sessionId));
    
  revalidatePath(`/${proj.slug}`);
}

export async function deleteSession(sessionId: string) {
  const user = await requireUser();
  const session = await db.query.agentSessions.findFirst({
    where: and(eq(agentSessions.id, sessionId), isNull(agentSessions.deletedAt)),
  });

  if (!session) {
    throw new Error("Session not found");
  }

  const proj = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, session.projectId),
      eq(projects.userId, user.id),
      isNull(projects.deletedAt),
    ),
  });

  if (!proj) {
    throw new Error("Unauthorized");
  }

  await db
    .update(agentSessions)
    .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentSessions.id, sessionId));
}

/** List non-deleted sessions for a project owned by the current user. */
export async function getProjectSessions(projectSlug: string) {
  const user = await requireUser();
  const proj = await getOwnedProject(user, projectSlug);
  if (!proj) return [];

  return db
    // The history list only renders these fields. Selecting events here can
    // transfer the entire transcript for every conversation into the layout.
    .select({ id: agentSessions.id, title: agentSessions.title, runStatus: agentSessions.runStatus, runStatusAt: agentSessions.runStatusAt, lastViewedAt: agentSessions.lastViewedAt })
    .from(agentSessions)
    .where(and(eq(agentSessions.projectId, proj.id), isNull(agentSessions.deletedAt)))
    .orderBy(desc(agentSessions.createdAt));
}

/** Load one session (ACL'd by user via project ownership) for resume. */
export async function getSession(projectSlug: string, sessionId: string) {
  const user = await requireUser();
  const proj = await getOwnedProject(user, projectSlug);
  if (!proj) return null;

  const session = await db.query.agentSessions.findFirst({
    where: and(
      eq(agentSessions.id, sessionId),
      eq(agentSessions.projectId, proj.id),
      isNull(agentSessions.deletedAt),
    ),
  });
  return session ?? null;
}

/** Mark a non-deleted conversation in this project as viewed. */
export async function markSessionViewed(projectSlug: string, sessionId: string) {
  const user = await requireUser();
  const proj = await getOwnedProject(user, projectSlug);
  if (!proj) return;
  await db.update(agentSessions)
    .set({ lastViewedAt: sql`max(coalesce(${agentSessions.lastViewedAt}, 0), coalesce(${agentSessions.runStatusAt}, 0), cast(unixepoch('subsec') * 1000 as integer))` })
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.projectId, proj.id), isNull(agentSessions.deletedAt)));
}
