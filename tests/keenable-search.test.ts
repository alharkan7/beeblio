import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import type { ToolContext } from "eve/tools";

import keenableSearch from "../agent/tools/keenable_search.ts";

type Captured = { url: string; init: RequestInit };
type SearchOutput = { query: string; results: Array<{ title: string; url: string; description: string }> };

describe("keenable_search tool", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { BEEBLIO_DATA_DIR: process.env.BEEBLIO_DATA_DIR, KEENABLE_API_KEY: process.env.KEENABLE_API_KEY };
  const ctx = { abortSignal: new AbortController().signal } as unknown as ToolContext;
  let dir: string;
  let calls: Captured[];

  // execute() is typed for sync, async, and streaming tools; this one returns a promise.
  const search = (input: { query: string; count: number }) =>
    Promise.resolve(keenableSearch.execute(input, ctx)) as Promise<SearchOutput>;

  const respondWith = (response: Response) => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response;
    }) as typeof fetch;
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "beeblio-keenable-"));
    process.env.BEEBLIO_DATA_DIR = dir;
    delete process.env.KEENABLE_API_KEY;
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("searches the public endpoint without a key and maps snippets", async () => {
    respondWith(Response.json({
      results: [
        { title: "A", url: "https://a.example", description: "", snippet: `first line\n\nsecond   line ${"x".repeat(2_000)}` },
        { title: "B", url: "https://b.example", description: "", snippet: "b" },
        { title: "C", url: "https://c.example", description: "", snippet: "c" },
      ],
    }));

    const output = await search({ query: "graphene thermal conductivity", count: 2 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.keenable.ai/v1/search/public");
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["X-Keenable-Title"], "Beeblio");
    assert.equal("X-API-Key" in headers, false);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { query: "graphene thermal conductivity", max_results: 2 });

    assert.equal(output.query, "graphene thermal conductivity");
    assert.equal(output.results.length, 2);
    assert.equal(output.results[0].url, "https://a.example");
    assert.ok(output.results[0].description.startsWith("first line second line x"));
    assert.equal(output.results[0].description.length, 1_000);
  });

  test("uses the keyed endpoint when a key is set", async () => {
    process.env.KEENABLE_API_KEY = "test-key";
    respondWith(Response.json({ results: [] }));

    const output = await search({ query: "q", count: 10 });

    assert.equal(calls[0].url, "https://api.keenable.ai/v1/search");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["X-API-Key"], "test-key");
    assert.equal(headers["X-Keenable-Title"], "Beeblio");
    assert.deepEqual(output.results, []);
  });

  test("reports a failed response", async () => {
    respondWith(new Response("rate limited", { status: 429 }));

    await assert.rejects(
      search({ query: "q", count: 10 }),
      /Keenable Search failed: Keenable Search API responded with status: 429/,
    );
  });
});
