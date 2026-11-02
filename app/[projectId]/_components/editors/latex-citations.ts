import { formatCitation, formatCitationGroup, supportsNarrativeCitation, type CitationReference, type CitationStyle } from "../../../../lib/citations.ts";

export type LatexCitationContext = {
  numbers: Map<string, number>;
  references: Map<string, CitationReference>;
  style: CitationStyle;
  macros?: Record<string, string>;
};

const CITATION = /\\(citep|citet|cite|parencite|textcite)\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g;

const BIBLIOGRAPHY_STYLES: Record<string, CitationStyle> = {
  apa: "apa", apalike: "apa", apacite: "apa",
  chicago: "chicago", chicagoa: "chicago", chicagoauthordate: "chicago", "chicago-authordate": "chicago",
  harvard: "harvard", agsm: "harvard", dcu: "harvard",
  mla: "mla", mla13: "mla",
  ieee: "ieee", ieeetr: "ieee", ieeetran: "ieee",
  vancouver: "vancouver", vanc: "vancouver",
  plain: "ieee", unsrt: "ieee", abbrv: "ieee", unsrtnat: "ieee", abbrvnat: "ieee",
};

export function latexCitationStyle(source: string): CitationStyle {
  const natbib = /\\usepackage(?:\[([^\]]*)\])?\s*\{[^}]*\bnatbib\b[^}]*\}/.exec(source);
  const options = natbib?.[1]?.split(",").map((option) => option.trim()) ?? [];
  const biblatexOptions = /\\usepackage\s*\[([^\]]*)\]\s*\{biblatex\}/.exec(source)?.[1];
  const biblatexStyle = biblatexOptions?.match(/(?:^|,)\s*(?:citestyle|style)\s*=\s*([^,\s]+)/)?.[1];
  const bibliographyStyle = /\\bibliographystyle\s*\{([^}]*)\}/.exec(source)?.[1];
  const declared = (biblatexStyle ?? bibliographyStyle)?.trim().toLowerCase();
  const mapped = declared ? BIBLIOGRAPHY_STYLES[declared] : undefined;
  if (natbib && (options.includes("numbers") || options.includes("super"))) return "ieee";
  if (biblatexOptions?.includes("citestyle=numeric") || biblatexOptions?.includes("style=numeric")) return "ieee";
  if (mapped) return mapped;
  if (natbib || biblatexOptions) return "apa";
  return "ieee";
}

export function latexCitationNumbers(source: string): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const match of source.matchAll(CITATION)) {
    for (const rawKey of match[2].split(",")) {
      const key = rawKey.trim();
      if (key && !numbers.has(key)) numbers.set(key, numbers.size + 1);
    }
  }
  return numbers;
}

export function renderLatexCitations(source: string, context: LatexCitationContext): string {
  return source.replace(CITATION, (_match, command: string, rawKeys: string) => {
    const keys = rawKeys.split(",").map((key) => key.trim()).filter(Boolean);
    if (context.style === "ieee" || context.style === "vancouver") {
      const numbers = keys.map((key) => context.numbers.get(key) ?? key).join(", ");
      return context.style === "ieee" ? `[${numbers}]` : `(${numbers})`;
    }
    if (keys.some((key) => !context.references.has(key))) {
      return `[${keys.filter((key) => !context.references.has(key)).map((key) => `?${key}`).join(", ")}]`;
    }
    if ((command === "citet" || command === "textcite") && supportsNarrativeCitation(context.style)) {
      return keys.map((key) => formatCitation(context.references.get(key), context.style, context.numbers.get(key) ?? 1, "narrative")).join("; ");
    }
    return formatCitationGroup(keys, context.references, context.style, [...context.numbers.keys()]);
  });
}
