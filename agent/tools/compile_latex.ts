import { defineTool } from "eve/tools";
import { z } from "zod";
import { compileLatex } from "../../lib/latex-compile";
import { getWorkspaceIdentity } from "../workspace-paths";

export default defineTool({
  description: "Compile a saved LaTeX .tex workspace document to PDF. Includes project-relative inputs, figures, and bibliography. The deterministic PDF in /workspace/4-Reports/Compiled/ is replaced only when compilation succeeds. Return compiler errors to the user when it fails.",
  inputSchema: z.object({ sourcePath: z.string().min(1).max(1024) }).strict(),
  async execute({ sourcePath }, ctx) {
    const identity = getWorkspaceIdentity({
      principalId: ctx.session.auth.current?.principalId,
      projectSlug: ctx.session.auth.current?.attributes?.projectSlug,
      sessionId: ctx.session.id,
    });
    return compileLatex({ userId: identity.userId, projectSlug: identity.projectSlug, sourcePath });
  },
});
