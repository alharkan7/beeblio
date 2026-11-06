import { defineHook } from "eve/hooks";
import { and, eq, isNull, lte, or } from "drizzle-orm";

import { db } from "../../db";
import { agentSessions } from "../../db/schema";

type RunStatus = "idle" | "running" | "needs_input" | "finished" | "failed";

async function record(sessionId: string, status: RunStatus, at: string) {
  const occurredAt = new Date(at);
  if (Number.isNaN(occurredAt.getTime())) return;
  try {
    await db.update(agentSessions)
      .set({ runStatus: status, runStatusAt: occurredAt })
      .where(and(
        eq(agentSessions.eveSessionId, sessionId),
        isNull(agentSessions.deletedAt),
        or(isNull(agentSessions.runStatusAt), lte(agentSessions.runStatusAt, occurredAt)),
      ));
  } catch (error) {
    // A status cue must never fail an otherwise healthy Eve turn.
    console.error("Chat activity update failed:", error);
  }
}

export default defineHook({
  events: {
    "turn.started": (event, ctx) => record(ctx.session.id, "running", event.meta.at),
    "input.requested": (event, ctx) => record(ctx.session.id, "needs_input", event.meta.at),
    "input.resolved": (event, ctx) => record(ctx.session.id, "running", event.meta.at),
    "turn.completed": (event, ctx) => record(ctx.session.id, "finished", event.meta.at),
    "turn.failed": (event, ctx) => record(ctx.session.id, "failed", event.meta.at),
    "turn.cancelled": (event, ctx) => record(ctx.session.id, "idle", event.meta.at),
    "session.failed": (event, ctx) => record(ctx.session.id, "failed", event.meta.at),
  },
});
