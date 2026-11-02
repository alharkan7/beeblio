"use client";

import { useState, type ReactNode } from "react";
import { resolveWorkspaceAssetPath, resolveMarkdownImageSource, resolveShareImageSource } from "./markdown-image-path";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { CitationReference } from "@/lib/citations";
import type { LatexFileIssue } from "./latex-document";
import { latexCitationNumbers, latexCitationStyle, renderLatexCitations, type LatexCitationContext } from "./latex-citations";

type Block = { kind: "quote" | "callout"; value: string } | { kind: "bibliography"; items: { key: string; value: string }[] } | { kind: "heading"; level: number; value: string } | { kind: "paragraph" | "abstract" | "code"; value: string } | { kind: "math"; value: string; number?: number } | { kind: "list"; ordered: boolean; items: string[] } | { kind: "description"; items: { term: string; value: string }[] } | { kind: "table" | "figure"; value: string; number: number; caption: string; image?: string; rows?: string[][]; diagram?: string[] };
type Diagnostic = { message: string; line: number };

export function LatexReadingPreview({ source, references = [], fileIssues = [], projectId, filePath, shareId }: { source: string; references?: CitationReference[]; fileIssues?: LatexFileIssue[]; projectId?: string; filePath?: string; shareId?: string }) {
  const clean = stripComments(source);
  const body = environment(clean, "document") ?? clean;
  const metadata = body.slice(0, Math.max(0, body.indexOf("\\maketitle") >= 0 ? body.indexOf("\\maketitle") : body.length));
  const title = commandArguments(metadata, "title")[0];
  const authors = commandArguments(metadata, "author");
  const protectedBody = protectLiteralEnvironments(body);
  const macros = latexMathMacros(clean);
  const customEnvironments = declaredEnvironments(clean);
  const content = removeEnvironments(removeCommandCalls(protectedBody.source, ["title", "author", "authornote", "authornotemark", "email", "orcid", "affiliation", "institution", "department", "streetaddress", "city", "state", "country", "postcode", "keywords", "ccsdesc", "received"]), ["CCSXML"])
    .replace(/\\(?:maketitle|correspondingauthor)\b/g, "");
  const blocks = parseBlocks(content, protectedBody.literals, customEnvironments);
  const inlineReferences = inlineBibliographyReferences(body);
  const allReferences = [...references, ...inlineReferences.filter((reference) => !references.some((item) => item.id === reference.id))];
  const diagnostics = collectDiagnostics(clean, allReferences, macros, customEnvironments);
  const labels = collectLabels(clean);
  const citations: LatexCitationContext = {
    numbers: latexCitationNumbers(protectLiteralEnvironments(body).source),
    references: new Map(allReferences.map((reference) => [reference.id, reference])),
    style: latexCitationStyle(clean),
    macros,
  };
  const citedKeys = [...citations.numbers.keys()];
  for (const match of body.matchAll(/\\nocite\s*\{([^{}]+)\}/g)) {
    for (const key of match[1].split(",").map((value) => value.trim())) if (key !== "*" && !citedKeys.includes(key)) citedKeys.push(key);
  }
  const bibliography = /\\(?:bibliography|printbibliography)\b/.test(body)
    ? /\\nocite\s*\{\s*\*\s*\}/.test(body) ? references : citedKeys.map((key) => citations.references.get(key)).filter((reference): reference is CitationReference => !!reference)
    : [];
  return <article className="mx-auto min-h-full max-w-3xl bg-white px-12 py-12 font-serif text-[15px] leading-7 text-neutral-950 shadow-sm">
    {diagnostics.length || fileIssues.length ? <aside className="mb-6 rounded border border-amber-300 bg-amber-50 p-3 font-sans text-xs text-amber-950" role="status"><strong>Preview issues ({diagnostics.length + fileIssues.length})</strong><ul className="mt-1 list-disc pl-5">{fileIssues.map((issue, index) => <li key={`file-${index}`}>{issue.path}, line {issue.line}: {issue.message}</li>)}{diagnostics.map((issue, index) => <li key={index}>Line {issue.line}: {issue.message}</li>)}</ul></aside> : null}
    {title ? <header className="mb-10 border-b pb-7 text-center"><h1 className="text-3xl font-semibold leading-tight">{renderInline(title, citations, labels)}</h1>{authors.length ? <div className="mt-4 space-y-1 text-sm text-neutral-600">{authors.map((author, index) => <p key={index}>{renderInline(author, citations, labels)}</p>)}</div> : null}</header> : null}
    {blocks.map((block, index) => <LatexBlock key={index} block={block} citations={citations} labels={labels} projectId={projectId} filePath={filePath} shareId={shareId} />)}
    {bibliography.length ? <section className="mt-10 border-t pt-5"><h2 className="mb-4 text-2xl font-semibold">References</h2><ol className="space-y-3">{bibliography.map((reference) => <li key={reference.id} className="pl-7 -indent-7">{citations.style === "ieee" || citations.style === "vancouver" ? `[${citations.numbers.get(reference.id) ?? bibliography.indexOf(reference) + 1}] ` : null}{reference.authors}. {reference.year ? `(${reference.year}). ` : ""}<em>{reference.title}</em>{reference.container ? `. ${reference.container}` : ""}{reference.volume ? `, ${reference.volume}` : ""}{reference.pages ? `, ${reference.pages}` : ""}.</li>)}</ol></section> : null}
  </article>;
}

function LatexBlock({ block, citations, labels, projectId, filePath, shareId }: { block: Block; citations: LatexCitationContext; labels: Map<string, string>; projectId?: string; filePath?: string; shareId?: string }) {
  if (block.kind === "heading") {
    const className = block.level === 1 ? "mb-3 mt-8 text-2xl font-semibold" : block.level === 2 ? "mb-2 mt-6 text-xl font-semibold" : "mb-2 mt-5 text-lg font-semibold";
    const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
    return <Tag className={className}>{renderInline(block.value, citations, labels)}</Tag>;
  }
  if (block.kind === "quote") return <blockquote className="mb-5 border-l-2 border-neutral-400 py-1 pl-5 italic">{renderInline(block.value, citations, labels)}</blockquote>;
  if (block.kind === "callout") return <aside className="mb-5 rounded border-l-4 border-blue-500 bg-blue-50 px-4 py-3 text-blue-950">{renderInline(block.value, citations, labels)}</aside>;
  if (block.kind === "bibliography") return <section className="mt-10 border-t pt-5"><h2 className="mb-4 text-2xl font-semibold">References</h2><ol className="space-y-3">{block.items.map((item) => <li key={item.key} className="pl-7 -indent-7">{renderInline(item.value, citations, labels)}</li>)}</ol></section>;
  if (block.kind === "abstract") return <section className="mb-7 border-y px-5 py-4"><h2 className="mb-2 text-center text-sm font-semibold uppercase tracking-wider">Abstract</h2><p className="text-justify">{renderInline(block.value, citations, labels)}</p></section>;
  if (block.kind === "list") { const Tag = block.ordered ? "ol" : "ul"; return <Tag className={`mb-5 ml-7 ${block.ordered ? "list-decimal" : "list-disc"}`}>{block.items.map((item, index) => <li key={index} className="pl-1">{renderInline(item, citations, labels)}</li>)}</Tag>; }
  if (block.kind === "description") return <dl className="mb-5 ml-5 space-y-2">{block.items.map((item, index) => <div key={index}><dt className="inline font-semibold">{renderInline(item.term, citations, labels)} </dt><dd className="inline">{renderInline(item.value, citations, labels)}</dd></div>)}</dl>;
  if (block.kind === "math") return <div className="my-5 flex items-center gap-3"><div className="min-w-0 flex-1 overflow-x-auto text-center" dangerouslySetInnerHTML={{ __html: renderMath(block.value, true, citations.macros) }} />{block.number ? <span className="shrink-0">({block.number})</span> : null}</div>;
  if (block.kind === "table") return <figure className="my-6 overflow-x-auto"><figcaption className="mb-2 text-sm"><strong>Table {block.number}.</strong> {renderInline(block.caption, citations, labels)}</figcaption>{block.rows?.length ? <table className="w-full border-collapse text-sm"><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex} className={rowIndex === 0 ? "border-y border-neutral-800 font-semibold" : "border-b border-neutral-200"}>{row.map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-1 text-left">{renderInline(cell, citations, labels)}</td>)}</tr>)}</tbody></table> : <PreviewNotice>Table content uses unsupported LaTeX commands.</PreviewNotice>}</figure>;
  if (block.kind === "figure") return <figure className="my-6">{block.diagram ? <div className="rounded border bg-neutral-50 p-5 font-sans text-sm"><p className="mb-3 text-center text-xs text-neutral-500">TikZ content preview · compile for the exact diagram</p><div className="flex flex-wrap items-center justify-center gap-2">{block.diagram.map((label, index) => <span className="contents" key={index}>{index > 0 ? <span aria-hidden="true">→</span> : null}<span className="rounded border border-neutral-500 bg-white px-4 py-2">{label}</span></span>)}</div></div> : <PreviewFigure image={block.image} projectId={projectId} filePath={filePath} shareId={shareId} />}<figcaption className="mt-2 text-sm"><strong>Figure {block.number}.</strong> {renderInline(block.caption, citations, labels)}</figcaption></figure>;
  if (block.kind === "code") return <pre className="mb-5 min-h-10 overflow-x-auto whitespace-pre-wrap rounded border border-neutral-300 bg-neutral-50 p-4 font-mono text-xs leading-5 text-neutral-900"><code>{block.value.replace(/^\n|\n$/g, "")}</code></pre>;
  return <p className="mb-4 text-justify">{renderInline(block.value, citations, labels)}</p>;
}

function parseBlocks(source: string, literals: string[] = [], customEnvironments = new Set<string>()): Block[] {
  const value = restoreLiteralEnvironments(source
    .replace(/\\(?:documentclass|usepackage|newcommand|renewcommand|providecommand|DeclareMathOperator)(?:\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/\\(?:label|bibliography|bibliographystyle|pagestyle|thispagestyle)\s*\{[^{}]*\}/g, "")
    .replace(/\\(?:affiliation|authornote|authornotemark|email|orcid|institution|department|streetaddress|city|state|country|postcode|keywords|ccsdesc)(?:\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/\\(?:correspondingauthor|balance|flushbottom|raggedbottom)\b/g, ""), literals);
  const blocks: Block[] = [];
  const customNames = [...customEnvironments].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const token = new RegExp(String.raw`\\(section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{|\\begin\{(abstract|quote|description|thebibliography|itemize|enumerate|equation\*?|align\*?|displaymath|math|verbatim\*?|lstlisting|minted|table\*?|figure\*?|longtable${customNames ? `|${customNames}` : ""})\}(?:\[[^\]]*\])?`, "g");
  let cursor = 0, equation = 0, table = 0, figure = 0, match: RegExpExecArray | null;
  while ((match = token.exec(value))) {
    addParagraphs(blocks, value.slice(cursor, match.index));
    if (match[1]) {
      const argument = readGroup(value, token.lastIndex - 1);
      blocks.push({ kind: "heading", level: match[1] === "section" ? 1 : match[1] === "subsection" ? 2 : 3, value: argument.value });
      cursor = argument.end;
    } else {
      const name = match[2], endMarker = `\\end{${name}}`, end = value.indexOf(endMarker, token.lastIndex);
      const content = value.slice(token.lastIndex, end < 0 ? value.length : end);
      if (name === "quote") blocks.push({ kind: "quote", value: content.trim() });
      else if (customEnvironments.has(name)) blocks.push({ kind: "callout", value: content.trim() });
      else if (name === "description") blocks.push({ kind: "description", items: [...content.matchAll(/\\item(?:\[([^\]]*)\])?\s*([\s\S]*?)(?=\\item|$)/g)].map((item) => ({ term: item[1] ?? "", value: item[2].trim() })) });
      else if (name === "thebibliography") blocks.push({ kind: "bibliography", items: parseInlineBibliography(content) });
      else if (name === "abstract") blocks.push({ kind: "abstract", value: content.trim() });
      else if (name === "itemize" || name === "enumerate") blocks.push({ kind: "list", ordered: name === "enumerate", items: content.split(/\\item(?:\[[^\]]*\])?\s*/).slice(1).map((item) => item.trim()).filter(Boolean) });
      else if (/^(?:verbatim\*?|lstlisting|minted)$/.test(name)) blocks.push({ kind: "code", value: content });
      else if (name.startsWith("table") || name === "longtable") blocks.push({ kind: "table", value: content, number: ++table, caption: commandArguments(content, "caption")[0] ?? "", rows: parseTableRows(content, name) });
      else if (name.startsWith("figure")) blocks.push({ kind: "figure", value: content, number: ++figure, caption: commandArguments(content, "caption")[0] ?? "", image: /\\includegraphics(?:\[[^\]]*\])?\s*\{([^{}]+)\}/.exec(content)?.[1], diagram: /\\begin\{tikzpicture\}/.test(content) ? [...content.matchAll(/\\node(?:\[[^\]]*\]|\s*\([^)]*\)|\s*)*\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)].map((node) => node[1]) : undefined });
      else blocks.push({ kind: "math", value: mathEnvironmentValue(name, content), number: /^(equation|align)$/.test(name) ? ++equation : undefined });
      cursor = end < 0 ? value.length : end + endMarker.length;
    }
    token.lastIndex = cursor;
  }
  addParagraphs(blocks, value.slice(cursor));
  return blocks;
}

function parseInlineBibliography(source: string) {
  const matches = [...source.matchAll(/\\bibitem(?:\[([^\]]*)\])?\s*\{([^{}]+)\}/g)];
  return matches.map((match, index) => ({ key: match[2], value: source.slice(match.index + match[0].length, matches[index + 1]?.index ?? source.length).replace(/\\newblock\b/g, " ").trim() }));
}

function inlineBibliographyReferences(source: string): CitationReference[] {
  const content = /\\begin\{thebibliography\}(?:\{[^{}]*\})?([\s\S]*?)\\end\{thebibliography\}/.exec(source)?.[1];
  if (!content) return [];
  return [...content.matchAll(/\\bibitem(?:\[([^\]]*)\])?\s*\{([^{}]+)\}/g)].map((match) => {
    const label = match[1] ?? "";
    const authorYear = /^(.*?)\((\d{4}[a-z]?)\)$/.exec(label);
    return { id: match[2], type: "misc", title: "", authors: authorYear?.[1] ?? label, year: authorYear?.[2] ?? "", container: "", publisher: "", volume: "", issue: "", pages: "", doi: "", url: "", abstract: "", isOpenAccess: false };
  });
}

function addParagraphs(blocks: Block[], source: string) {
  source.replace(/\\begin\{(?:figure\*?|table\*?|center)\}[\s\S]*?\\end\{(?:figure\*?|table\*?|center)\}/g, "").split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean).forEach((value) => blocks.push({ kind: "paragraph", value }));
}

function parseTableRows(source: string, environment = "table"): string[][] | undefined {
  let tabular: string | undefined;
  if (environment === "longtable") {
    const opening = source.search(/\{/);
    tabular = (opening < 0 ? source : source.slice(readGroup(source, opening).end)).split(/\\endlastfoot\b/).at(-1);
  } else {
    const begin = /\\begin\{(tabularx?)\}(?:\[[^\]]*\])?\s*/.exec(source);
    if (begin) {
      let cursor = begin.index + begin[0].length;
      const groups = begin[1] === "tabularx" ? 2 : 1;
      for (let index = 0; index < groups; index++) {
        while (/\s/.test(source[cursor] ?? "")) cursor++;
        if (source[cursor] !== "{") break;
        cursor = readGroup(source, cursor).end;
      }
      const end = source.indexOf(`\\end{${begin[1]}}`, cursor);
      if (end >= 0) tabular = source.slice(cursor, end);
    }
  }
  if (!tabular) return undefined;
  return tabular.replace(/\\multicolumn\s*\{\d+\}\s*\{[^{}]*\}\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:toprule|midrule|bottomrule|hline|centering|endfirsthead|endhead|endfoot|endlastfoot)\b/g, "")
    .split(/\\\\(?:\[[^\]]*\])?/).map((row) => row.trim()).filter(Boolean)
    .map((row) => row.split(/(?<!\\)&/).map((cell) => cell.trim()));
}

function PreviewNotice({ children }: { children: ReactNode }) {
  return <div className="rounded border border-amber-300 bg-amber-50 p-3 font-sans text-xs text-amber-950">{children}</div>;
}

function PreviewFigure({ image, projectId, filePath, shareId }: { image?: string; projectId?: string; filePath?: string; shareId?: string }) {
  const [failedSource, setFailedSource] = useState<string>();
  if (!image) return <PreviewNotice>No image was specified for this figure.</PreviewNotice>;
  const resolved = filePath ? resolveWorkspaceAssetPath(filePath, image) : null;
  if (!resolved || !/\.(?:png|jpe?g|gif|webp|svg)$/i.test(resolved.path)) return <PreviewNotice>Cannot preview image: {image}</PreviewNotice>;
  const url = shareId ? resolveShareImageSource(shareId, filePath!, image) : projectId ? resolveMarkdownImageSource(projectId, filePath!, image) : undefined;
  if (!url || failedSource === url) return <PreviewNotice>Image missing or unavailable: {image}</PreviewNotice>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={image} className="mx-auto max-h-96 max-w-full object-contain" onError={() => setFailedSource(url)} />;
}

function collectDiagnostics(source: string, references: CitationReference[], macros: Record<string, string>, customEnvironments: Set<string>): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const labels = collectLabels(source);
  const bibliography = new Set(references.map((reference) => reference.id));
  const add = (index: number, message: string) => issues.push({ line: source.slice(0, index).split("\n").length, message });
  for (const match of source.matchAll(/\\(?:eqref|ref)\*?\s*\{([^{}]+)\}/g)) if (!labels.has(match[1])) add(match.index, `Unresolved reference: ${match[1]}`);
  for (const match of source.matchAll(/\\(?:cite|citep|citet|parencite|textcite)\*?(?:\[[^\]]*\])?\{([^{}]+)\}/g)) {
    for (const key of match[1].split(",").map((value) => value.trim())) if (references.length && key && !bibliography.has(key)) add(match.index, `Citation unavailable in project bibliography: ${key}`);
  }
  for (const match of source.matchAll(/\\begin\{(equation\*?|align\*?|displaymath|math)\}([\s\S]*?)\\end\{\1\}/g)) {
    const value = match[2].replace(/\\label\s*\{[^{}]*\}/g, "").trim();
    try { katex.renderToString(mathEnvironmentValue(match[1], value), { displayMode: true, throwOnError: true, strict: false, macros }); }
    catch { add(match.index, `Math could not be rendered in ${match[1]}.`); }
  }
  for (const match of source.matchAll(/\\begin\{([^{}]+)\}/g)) {
    if (!customEnvironments.has(match[1]) && !/^(?:document|abstract|itemize|enumerate|description|equation\*?|align\*?|displaymath|math|verbatim\*?|lstlisting|minted|table\*?|figure\*?|tabularx?|longtable|tikzpicture|center|quote|thebibliography)$/.test(match[1])) add(match.index, `Unsupported environment: ${match[1]}`);
  }
  for (const match of source.matchAll(/\\multirow\b/g)) add(match.index, `${match[0]} is not supported in the table preview.`);
  for (const match of source.matchAll(/\\begin\{table\*?\}([\s\S]*?)\\end\{table\*?\}/g)) if (!/\\begin\{tabularx?\}/.test(match[1])) add(match.index, "Table has no supported tabular content.");
  for (const match of source.matchAll(/\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/g)) if (!/\\includegraphics|\\begin\{tikzpicture\}/.test(match[1])) add(match.index, "Figure has no image to preview.");
  return issues;
}

function renderInline(source: string, citations: LatexCitationContext, labels: Map<string, string>): ReactNode[] {
  const normalized = source
    .replace(/\\(?:LaTeX|TeX)\b\s*\\?/g, "LaTeX")
    .replace(/\\BibTeX\b\s*\\?/g, "BibTeX")
    .replace(/``([\s\S]*?)''/g, "“$1”")
    .replace(/`([^'\n]+)'/g, "‘$1’")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~+/g, " ")
    .replace(/\\(?:cite|citep|citet|parencite|textcite)\*?(?:\[[^\]]*\])?\{[^{}]*\}/g, (citation) => renderLatexCitations(citation, citations))
    .replace(/\\(eqref|ref)\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, (_reference, command: string, key: string) => {
      const number = labels.get(key.trim());
      return number ? command === "eqref" ? `(${number})` : number : `[?${key}]`;
    })
    .replace(/\\\\(?:\[[^\]]*\])?/g, "\u0000")
    .replace(/\s*\n\s*/g, " ");
  const parts = normalized.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\verb\*?\|[^|]*\||\\verb\*?![^!]*!|\\verb\*?\+[^+]*\+|\\verb\*?#[^#]*#|\\url\s*\{[^{}]*\}|\\href\s*\{[^{}]*\}\s*\{[^{}]*\}|\\(?:textbf|textit|emph|texttt|underline)\{[^{}]*\})/g).filter(Boolean);
  return parts.map((part, index) => {
    const math = mathPart(part);
    if (math) return <span key={index} className={math.display ? "my-4 block overflow-x-auto text-center" : "inline"} dangerouslySetInnerHTML={{ __html: renderMath(math.value, math.display, citations.macros) }} />;
    const styled = part.match(/^\\(textbf|textit|emph|texttt|underline)\{([\s\S]*)\}$/);
    if (styled) { const children = renderInline(styled[2], citations, labels); if (styled[1] === "textbf") return <strong key={index}>{children}</strong>; if (styled[1] === "texttt") return <code key={index} className="rounded bg-neutral-100 px-1 font-mono text-[0.9em]">{children}</code>; if (styled[1] === "underline") return <u key={index}>{children}</u>; return <em key={index}>{children}</em>; }
    const url = part.match(/^\\url\s*\{([^{}]*)\}$/);
    if (url) return <a key={index} href={url[1]} target="_blank" rel="noreferrer" className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900">{url[1]}</a>;
    const href = part.match(/^\\href\s*\{([^{}]*)\}\s*\{([^{}]*)\}$/);
    if (href) return <a key={index} href={href[1]} target="_blank" rel="noreferrer" className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900">{renderInline(href[2], citations, labels)}</a>;
    const verb = part.match(/^\\verb\*?(.)([\s\S]*)\1$/);
    if (verb) return <code key={index} className="rounded bg-neutral-100 px-1 font-mono text-[0.9em] text-neutral-800">{verb[2]}</code>;
    const text = plainText(part);
    return <span key={index}>{text.split("\u0000").map((line, lineIndex) => <span key={lineIndex}>{line}{lineIndex < text.split("\u0000").length - 1 ? <br /> : null}</span>)}</span>;
  });
}

function plainText(value: string) { return value.replace(/\{\\o\}/g, "ø").replace(/\{\\O\}/g, "Ø").replace(/\\['`]\{?([A-Za-z])\}?/g, (_, letter: string) => `${letter}\u0301`).replace(/\\\"\{?([A-Za-z])\}?/g, (_, letter: string) => `${letter}\u0308`).replace(/\\(?:itshape|bfseries|normalfont|centering|small|large|Large)\b/g, "").replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?\s*/g, "").replace(/[{}]/g, "").replace(/\\([#$%&_{}])/g, "$1").replace(/[ \t]+/g, " "); }
function mathPart(value: string) { if (value.startsWith("$$") && value.endsWith("$$")) return { value: value.slice(2, -2), display: true }; if (value.startsWith("\\[") && value.endsWith("\\]")) return { value: value.slice(2, -2), display: true }; if (value.startsWith("$") && value.endsWith("$")) return { value: value.slice(1, -1), display: false }; if (value.startsWith("\\(") && value.endsWith("\\)")) return { value: value.slice(2, -2), display: false }; }
function declaredEnvironments(source: string): Set<string> {
  return new Set([...source.matchAll(/\\(?:newenvironment|renewenvironment)\s*\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]));
}
function latexMathMacros(source: string): Record<string, string> {
  const macros: Record<string, string> = {};
  for (const match of source.matchAll(/\\(?:newcommand|renewcommand|providecommand)\s*\{(\\[A-Za-z]+)\}(?:\s*\[\d+\])?\s*\{/g)) {
    macros[match[1]] = readGroup(source, match.index + match[0].length - 1).value;
  }
  for (const match of source.matchAll(/\\DeclareMathOperator\s*\{(\\[A-Za-z]+)\}\s*\{([^{}]+)\}/g)) {
    macros[match[1]] = `\\operatorname{${match[2]}}`;
  }
  return macros;
}
function mathEnvironmentValue(name: string, value: string) { return name.startsWith("align") ? `\\begin{aligned}${value.trim()}\\end{aligned}` : value.trim(); }
function renderMath(value: string, displayMode: boolean, macros?: Record<string, string>) { return katex.renderToString(value, { displayMode, throwOnError: false, strict: false, macros }); }
function collectLabels(source: string): Map<string, string> {
  const labels = new Map<string, string>();
  const counters = { section: 0, subsection: 0, subsubsection: 0, equation: 0, table: 0, figure: 0, listing: 0 };
  let current = "";
  let floating = "";
  const token = /\\(section|subsection|subsubsection)(\*?)\s*\{|\\(begin|end)\{(equation\*?|align\*?|table\*?|figure\*?|longtable|lstlisting)\}(?:\[([^\]]*)\])?|\\label\s*\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    if (match[1]) {
      const group = readGroup(source, token.lastIndex - 1);
      token.lastIndex = group.end;
      if (match[2]) continue;
      if (match[1] === "section") { counters.section++; counters.subsection = 0; counters.subsubsection = 0; }
      else if (match[1] === "subsection") { counters.subsection++; counters.subsubsection = 0; }
      else counters.subsubsection++;
      current = [counters.section, counters.subsection, counters.subsubsection]
        .slice(0, match[1] === "section" ? 1 : match[1] === "subsection" ? 2 : 3).join(".");
    } else if (match[3]) {
      const kind = match[4].replace(/\*$/, "");
      if (match[3] === "begin") {
        const numbered = !match[4].endsWith("*") || kind === "table" || kind === "figure";
        if (numbered) {
          if (kind === "align") counters.equation++;
          else if (kind === "longtable") counters.table++;
          else if (kind === "lstlisting") counters.listing++;
          else counters[kind as "equation" | "table" | "figure"]++;
        }
        floating = numbered ? String(counters[kind === "align" ? "equation" : kind === "longtable" ? "table" : kind === "lstlisting" ? "listing" : kind as "equation" | "table" | "figure"]) : "";
        if (kind === "lstlisting" && match[5]) {
          const label = /(?:^|,)\s*label\s*=\s*\{([^{}]+)\}/.exec(match[5])?.[1];
          if (label) labels.set(label, floating);
        }
      } else floating = "";
    } else if (match[6] && !labels.has(match[6])) labels.set(match[6], floating || current);
  }
  return labels;
}
function stripComments(source: string) { return source.replace(/(^|[^\\])%.*$/gm, "$1"); }
function environment(source: string, name: string) { const start = source.indexOf(`\\begin{${name}}`), end = source.lastIndexOf(`\\end{${name}}`); return start >= 0 && end > start ? source.slice(start + name.length + 8, end) : undefined; }
function commandArguments(source: string, command: string) { const results: string[] = [], expression = new RegExp(`\\\\${command}\\*?(?:\\[[^\\]]*\\])?\\s*\\{`, "g"); while (expression.exec(source)) { const group = readGroup(source, expression.lastIndex - 1); results.push(group.value); expression.lastIndex = group.end; } return results; }
function readGroup(source: string, open: number) { let depth = 0; for (let index = open; index < source.length; index++) { if (source[index] === "{" && source[index - 1] !== "\\") depth++; if (source[index] === "}" && source[index - 1] !== "\\" && --depth === 0) return { value: source.slice(open + 1, index), end: index + 1 }; } return { value: source.slice(open + 1), end: source.length }; }

function removeCommandCalls(source: string, commands: string[]) {
  const expression = new RegExp(`\\\\(?:${commands.join("|")})\\*?(?:\\[[^\\]]*\\])?\\s*\\{`, "g");
  let result = "", cursor = 0, match: RegExpExecArray | null;
  while ((match = expression.exec(source))) { const group = readGroup(source, expression.lastIndex - 1); result += source.slice(cursor, match.index); cursor = group.end; expression.lastIndex = group.end; }
  return result + source.slice(cursor);
}

function removeEnvironments(source: string, names: string[]) {
  return names.reduce((value, name) => value.replace(new RegExp(`\\\\begin\\{${name}\\}[\\s\\S]*?\\\\end\\{${name}\\}`, "g"), ""), source);
}

function protectLiteralEnvironments(source: string) {
  const literals: string[] = [];
  const protectedSource = source.replace(/\\begin\{(verbatim\*?|lstlisting|minted)\}(?:\[[^\]]*\])?[\s\S]*?\\end\{\1\}/g, (literal) => {
    const index = literals.push(literal) - 1;
    return `BEEBLIO_LITERAL_${index}_BLOCK`;
  });
  return { source: protectedSource, literals };
}

function restoreLiteralEnvironments(source: string, literals: string[]) {
  return source.replace(/BEEBLIO_LITERAL_(\d+)_BLOCK/g, (_, index: string) => literals[Number(index)] ?? "");
}
