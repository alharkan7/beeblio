import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";

import { db } from "@/db";
import { agentSessions, projects } from "@/db/schema";
import { getUser } from "@/lib/auth/session";
import { generateConversationTitle } from "@/lib/conversation-title";

/** Create a session for a project owned by the current user (lazy, on first message). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectSlug, state, firstMessage } = await req.json();
  const proj = await db.query.projects.findFirst({
    where: and(eq(projects.slug, projectSlug), eq(projects.userId, user.id)),
  });
  if (!proj) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The app-level row must exist before the Eve turn starts so the conversation
  // remains reachable if the user navigates away while the first turn is still
  // running. Generate the nicer title after returning the row id; title
  // generation can involve a model call and must not delay durable registration.
  const initialTitle = "New Conversation";

  const [newSession] = await db
    .insert(agentSessions)
    .values({ projectId: proj.id, title: initialTitle, state, eveSessionId: state?.sessionId, runStatus: "running", runStatusAt: new Date() })
    .returning();

  after(async () => {
    try {
      const title = await generateConversationTitle(firstMessage);
      await db
        .update(agentSessions)
        .set({ title, updatedAt: new Date() })
        // Do not overwrite a title the user renamed while generation was running.
        .where(and(eq(agentSessions.id, newSession.id), eq(agentSessions.title, initialTitle)));
    } catch (error) {
      console.error("Conversation title update failed:", error);
    }
  });

  return NextResponse.json({ id: newSession.id });
}

/** Persist the eve session cursor. ACL'd: the session must belong to the user. */
export async function PUT(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId, state, events } = await req.json();

  const session = await db.query.agentSessions.findFirst({
    where: eq(agentSessions.id, sessionId),
  });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const owned = await db.query.projects.findFirst({
    where: and(eq(projects.id, session.projectId), eq(projects.userId, user.id)),
  });
  if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db
    .update(agentSessions)
    .set({
      state,
      ...(Array.isArray(events) ? { events } : {}),
      eveSessionId: state.sessionId ?? session.eveSessionId,
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, sessionId));

  return NextResponse.json({ ok: true });
}
