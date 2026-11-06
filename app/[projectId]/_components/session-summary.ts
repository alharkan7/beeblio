export type SessionSummary = {
  id: string;
  title: string | null;
  runStatus: string;
  runStatusAt: Date | null;
  lastViewedAt: Date | null;
};

export function isUnviewed(session: SessionSummary) {
  return (session.runStatus === "finished" || session.runStatus === "failed" || session.runStatus === "needs_input") &&
    !!session.runStatusAt &&
    (!session.lastViewedAt || new Date(session.runStatusAt).getTime() > new Date(session.lastViewedAt).getTime());
}
