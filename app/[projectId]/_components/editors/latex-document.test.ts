import assert from "node:assert/strict";
import test from "node:test";
import { latexProjectPath, resolveLatexDocument } from "./latex-document.ts";

test("expands nested includes, finds their bibliography, and keeps image paths relative to the root", async () => {
  const files = new Map([
    ["reports/sections/method.tex", "\\section{Method}\\input{details}\\bibliography{method_refs}"],
    ["reports/sections/details.tex", "Details. \\includegraphics{../figures/plot.png}"],
  ]);
  const result = await resolveLatexDocument("reports/paper.tex", "\\begin{document}\\input{sections/method}\\end{document}", async (path) => files.get(path) ?? null);
  assert.match(result.source, /\\section\{Method\}\s+Details/);
  assert.match(result.source, /\\includegraphics\{figures\/plot\.png\}/);
  assert.deepEqual(result.bibliographyPaths, ["reports/sections/method_refs.bib"]);
  assert.deepEqual(result.issues, []);
});

test("reports missing and cyclic includes without reading outside the workspace", async () => {
  const files = new Map([["reports/a.tex", "\\input{a}\\input{missing}"]]);
  const result = await resolveLatexDocument("reports/paper.tex", "\\input{a}\\input{../../escape}", async (path) => files.get(path) ?? null);
  assert.ok(result.issues.some((issue) => issue.message.includes("Cyclic include")));
  assert.ok(result.issues.some((issue) => issue.message.includes("Included file unavailable")));
  assert.ok(result.issues.some((issue) => issue.message.includes("Invalid included file path")));
  assert.equal(latexProjectPath("reports/paper.tex", "../../secret", ".bib"), null);
});

test("collects referenced figures as dependencies, ignoring comments and paths outside the workspace", async () => {
  const files = new Map([
    ["reports/sections/figures.tex", "\\includegraphics*[width=0.9\\textwidth]{chart.pdf}"],
  ]);
  const root = [
    "\\includegraphics{figures/plot.png}",
    "% \\includegraphics{commented-out.png}",
    "\\includegraphics{../../outside.png}",
    "\\input{sections/figures}",
  ].join("\n");
  const result = await resolveLatexDocument("reports/paper.tex", root, async (path) => files.get(path) ?? null);
  assert.deepEqual(result.dependencies, [
    "reports/figures/plot.png",
    "reports/sections/figures.tex",
    "reports/sections/chart.pdf",
  ]);
  assert.deepEqual(result.issues, []);
});
