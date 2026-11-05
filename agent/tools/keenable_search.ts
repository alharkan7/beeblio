import { defineTool } from "eve/tools";
import { z } from "zod";
import type { ToolContext } from "eve/tools";
import { fetchWithTimeout, truncateText } from "../lib/tool-runtime";
import { appSetting } from "../../lib/app-settings";

export default defineTool({
  description:
    "Search the web with the Keenable Search API, which works without an API key. Use only when the user requests Keenable or when web_search and brave_search are unavailable or unsuccessful.",
  inputSchema: z.object({
    query: z.string().min(1).describe("The search query."),
    count: z.number().int().min(1).max(20).default(10),
  }),
  async execute({ query, count }, ctx: ToolContext) {
    // Works without a key; an optional key raises the rate limit.
    const apiKey = appSetting("KEENABLE_API_KEY");

    try {
      const response = await fetchWithTimeout(
        apiKey ? "https://api.keenable.ai/v1/search" : "https://api.keenable.ai/v1/search/public",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Keenable-Title": "Beeblio",
            ...(apiKey ? { "X-API-Key": apiKey } : {}),
          },
          body: JSON.stringify({ query, max_results: count }),
          signal: ctx.abortSignal,
        },
      );
      if (!response.ok) {
        throw new Error(
          `Keenable Search API responded with status: ${response.status}`,
        );
      }
      const data = await response.json() as {
        results?: Array<{ title: string; url: string; snippet?: string }>;
      };
      return {
        query,
        results: (data.results ?? []).slice(0, count).map((item) => ({
          title: item.title,
          url: item.url,
          description: truncateText(String(item.snippet ?? "").replace(/\s+/g, " ").trim(), 1_000).content,
        })),
      };
    } catch (error: unknown) {
      throw new Error(`Keenable Search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});
