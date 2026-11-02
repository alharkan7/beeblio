import { resolveWorkspaceAssetPath, workspacePathRelativeToDocument } from "./markdown-image-path.ts";

export type LatexFileIssue = { path: string; line: number; message: string };
export type LatexDocument = { source: string; bibliographyPaths: string[]; issues: LatexFileIssue[]; dependencies: string[] };

const MAX_DEPTH = 16;
const MAX_FILES = 80;
const MAX_CHARS = 2_000_000;

function maskIgnored(source: string): string {
  const blank = (value: string) => value.replace(/[^\n]/g, " ");
  return source
    .replace(/\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}/g, blank)
    .replace(/(^|[^\\])%[^\n]*/gm, (_match, prefix: string) => prefix + blank(_match.slice(prefix.length)));
}

export function latexProjectPath(fromPath: string, name: string, extension: ".tex" | ".bib"): string | null {
  const requested = name.trim();
  if (!requested || /[\0\r\n?#]/.test(requested)) return null;
  return resolveWorkspaceAssetPath(fromPath, /\.[^/\\]+$/.test(requested) ? requested : `${requested}${extension}`)?.path ?? null;
}

export async function resolveLatexDocument(
  rootPath: string,
  rootSource: string,
  readFile: (path: string) => Promise<string | null>,
): Promise<LatexDocument> {
  const issues: LatexFileIssue[] = [];
  const dependencies = new Set<string>();
  const bibliographyPaths: string[] = [];
  const cache = new Map<string, Promise<string | null>>();
  let length = 0;
  const read = (path: string) => {
    let pending = cache.get(path);
    if (!pending) { pending = readFile(path).catch(() => null); cache.set(path, pending); }
    return pending;
  };
  const issue = (path: string, source: string, index: number, message: string) =>
    issues.push({ path, line: source.slice(0, index).split("\n").length, message });

  async function expand(path: string, source: string, stack: string[]): Promise<string> {
    const masked = maskIgnored(source);
    const rewriteImages = (fragment: string) => path === rootPath ? fragment : fragment.replace(/\\includegraphics(\[[^\]]*\])?\s*\{([^{}]+)\}/g, (full, options: string | undefined, name: string) => {
      const resolved = resolveWorkspaceAssetPath(path, name);
      return resolved ? `\\includegraphics${options ?? ""}{${workspacePathRelativeToDocument(rootPath, resolved.path)}}` : full;
    });
    // Figures join the dependency set even though the preview resolves them
    // on its own (root-file paths are never rewritten): the editor archives
    // the set as the source tree, and a zip without its figures is broken.
    // The starred \includegraphics* variant is collected too.
    for (const match of masked.matchAll(/\\includegraphics\*?(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)) {
      const resolved = resolveWorkspaceAssetPath(path, match[1]);
      if (resolved) dependencies.add(resolved.path);
    }
    for (const match of masked.matchAll(/\\(?:bibliography\s*\{([^{}]+)\}|addbibresource(?:\[[^\]]*\])?\s*\{([^{}]+)\})/g)) {
      for (const name of (match[1] ?? match[2]).split(",")) {
        const resolved = latexProjectPath(path, name, ".bib");
        if (!resolved) issue(path, source, match.index, `Invalid bibliography path: ${name.trim()}`);
        else if (!bibliographyPaths.includes(resolved)) bibliographyPaths.push(resolved);
      }
    }
    const command = /\\(input|include)\s*\{([^{}]+)\}/g;
    let output = "", cursor = 0, match: RegExpExecArray | null;
    while ((match = command.exec(masked))) {
      output += rewriteImages(source.slice(cursor, match.index));
      const name = match[2].trim();
      const resolved = latexProjectPath(path, name, ".tex");
      if (!resolved) issue(path, source, match.index, `Invalid included file path: ${name}`);
      else if (stack.includes(resolved)) issue(path, source, match.index, `Cyclic include: ${resolved}`);
      else if (stack.length >= MAX_DEPTH || dependencies.size >= MAX_FILES || length >= MAX_CHARS) issue(path, source, match.index, "Include limit reached.");
      else {
        dependencies.add(resolved);
        const child = await read(resolved);
        if (child === null) issue(path, source, match.index, `Included file unavailable: ${resolved}`);
        else if (length + child.length > MAX_CHARS) issue(path, source, match.index, `Included file too large: ${resolved}`);
        else {
          length += child.length;
          output += `\n${await expand(resolved, child, [...stack, resolved])}\n`;
        }
      }
      cursor = match.index + match[0].length;
    }
    return output + rewriteImages(source.slice(cursor));
  }

  const source = await expand(rootPath, rootSource, [rootPath]);
  return { source, bibliographyPaths, issues, dependencies: [...dependencies] };
}
