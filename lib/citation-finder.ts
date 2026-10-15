import path from "node:path";
import { parseBibtexEntries } from "./bibtex";
import { referenceFromEntry, type CitationReference } from "./citations";
import { PROJECT_BIBLIOGRAPHY_PATH, REFERENCES_DIRECTORY } from "./project-bibliography";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  WorkspaceFileError,
} from "./workspace-files";
import { searchProjectKnowledge } from "./knowledge";
import { getAiTaskConfig } from "./local-ai-settings";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

export type CitationFindMatch = {
  citationKey: string;
  reference: CitationReference;
  originalText: string;
  sourceLocation: string;
  sourceFilePath?: string;
  sourceFileName?: string;
  explanation: string;
  confidence: "high" | "medium" | "low";
  score: number;
};

export type FindCitationResult =
  | {
      found: true;
      matches: CitationFindMatch[];
      match: CitationFindMatch;
    }
  | {
      found: false;
      message: string;
    };

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
  "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down",
  "during", "each", "few", "for", "from", "further", "had", "hadn't", "has",
  "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
  "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
  "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
  "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
  "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't",
  "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
  "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were",
  "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
  "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
  "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours",
  "yourself", "yourselves", "also", "across", "including", "may",
]);

function extractKeywords(text: string): string[] {
  const matches = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  return [...new Set(matches.filter((w) => !STOPWORDS.has(w)))];
}

function cleanExtractedText(raw: string): string {
  return raw
    .replace(/(\b\w+)-\s+(\w+\b)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function computeCandidateScore(text: string, query: string, queryKeywords: string[]): {
  score: number;
  matchedKeywords: string[];
  bestSentence: string;
} {
  const clean = cleanExtractedText(text);
  const words = clean.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const keywordSet = new Set(queryKeywords);
  const matched = words.filter((w) => keywordSet.has(w));
  const uniqueMatched = [...new Set(matched)];

  const keywordCoverage = queryKeywords.length > 0 ? uniqueMatched.length / queryKeywords.length : 0;

  // Check for 2+ word contiguous phrase overlap
  const cleanQueryLower = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const cleanTextLower = clean.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const queryPhrases = cleanQueryLower.split(/\s+/).filter((w) => w.length > 3);
  let hasPhraseOverlap = false;
  for (let i = 0; i < queryPhrases.length - 1; i++) {
    const bigram = `${queryPhrases[i]} ${queryPhrases[i + 1]}`;
    if (cleanTextLower.includes(bigram)) {
      hasPhraseOverlap = true;
      break;
    }
  }

  // Extract best matching sentence in the text
  const sentences = clean.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 15);
  let bestSentence = clean;
  let maxMatched = -1;
  for (const s of sentences) {
    const sWords = s.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const count = sWords.filter((w) => keywordSet.has(w)).length;
    if (count > maxMatched) {
      maxMatched = count;
      bestSentence = s.trim();
    }
  }

  const base = keywordCoverage * 60 + (hasPhraseOverlap ? 25 : 0) + Math.min(15, matched.length * 2);
  const normalizedScore = Math.max(35, Math.min(99, Math.round(base)));

  return {
    score: normalizedScore,
    matchedKeywords: uniqueMatched,
    bestSentence: bestSentence || clean,
  };
}

type CandidatePassage = {
  citationKey: string;
  reference: CitationReference;
  text: string;
  sourceLocation: string;
  sourceFilePath?: string;
  sourceFileName?: string;
  score: number;
};

async function scanPdfForCandidates(
  content: Uint8Array | Buffer,
  targetPdfPath: string,
  entryKey: string,
  ref: CitationReference,
  query: string,
  keywords: string[],
): Promise<CandidatePassage[]> {
  const results: CandidatePassage[] = [];
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(content),
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  try {
    const doc = await loadingTask.promise;
    const maxPages = Math.min(doc.numPages, 35);
    for (let p = 1; p <= maxPages; p++) {
      const page = await doc.getPage(p);
      const pageContent = await page.getTextContent();
      const pageText = cleanExtractedText(
        pageContent.items.map((item: any) => item.str ?? "").join(" "),
      );
      if (!pageText || pageText.length < 40) continue;

      // Split page into paragraph segments
      const paragraphs = pageText
        .split(/(?:\.\s{2,}|\b(?=[A-Z][a-z]{2,}\s+[a-z]+))/)
        .filter((p) => p.length > 50);
      for (const para of paragraphs) {
        const scored = computeCandidateScore(para, query, keywords);
        if (scored.matchedKeywords.length >= 2) {
          results.push({
            citationKey: entryKey,
            reference: ref,
            text: para.trim(),
            sourceLocation: `Page ${p}`,
            sourceFilePath: targetPdfPath,
            sourceFileName: path.posix.basename(targetPdfPath),
            score: scored.score,
          });
        }
      }
    }
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
  return results;
}

export async function findCitationForSelection(
  userId: string,
  projectSlug: string,
  selectedText: string,
): Promise<FindCitationResult> {
  const query = selectedText.trim();
  if (!query) {
    return {
      found: false,
      message: "No text was selected to find citations for.",
    };
  }

  // 1. Read project references.bib
  let bibSource = "";
  try {
    const { content } = await readWorkspaceFile(
      userId,
      projectSlug,
      PROJECT_BIBLIOGRAPHY_PATH,
    );
    bibSource = content.toString("utf8");
  } catch (error) {
    if (error instanceof WorkspaceFileError && error.status === 404) {
      return {
        found: false,
        message: "No bibliography found at 1-References/references.bib.",
      };
    }
    throw error;
  }

  const entries = parseBibtexEntries(bibSource);
  if (entries.length === 0) {
    return {
      found: false,
      message:
        "Your project bibliography has no entries. Add references to 1-References/references.bib first.",
    };
  }

  const referenceMap = new Map<string, CitationReference>();
  for (const entry of entries) {
    referenceMap.set(entry.key, referenceFromEntry(entry));
  }

  const keywords = extractKeywords(query);
  const keywordSet = new Set(keywords);

  const candidates: CandidatePassage[] = [];

  // 2. Check abstracts and fields from references.bib
  for (const entry of entries) {
    const ref = referenceMap.get(entry.key)!;
    const abstract = entry.fields.abstract?.trim();
    if (abstract) {
      const cleanAbstract = cleanExtractedText(abstract);
      const scored = computeCandidateScore(cleanAbstract, query, keywords);
      if (scored.matchedKeywords.length >= 2) {
        candidates.push({
          citationKey: entry.key,
          reference: ref,
          text: cleanAbstract,
          sourceLocation: "Abstract",
          sourceFilePath: PROJECT_BIBLIOGRAPHY_PATH,
          sourceFileName: "references.bib",
          score: scored.score,
        });
      }
    }
  }

  // 3. Check linked PDF files in 1-References/
  let refFiles: { name: string; path: string }[] = [];
  try {
    refFiles = await listWorkspaceFiles(
      userId,
      projectSlug,
      REFERENCES_DIRECTORY,
    );
  } catch {
    refFiles = [];
  }

  for (const entry of entries) {
    const ref = referenceMap.get(entry.key)!;
    // Find linked file
    let targetPdfPath: string | null = null;
    const rawFile = entry.fields.file || "";
    if (rawFile) {
      const firstPart = rawFile.split(":")[0]?.trim() || "";
      if (firstPart.toLowerCase().endsWith(".pdf")) {
        targetPdfPath = firstPart;
      }
    }

    if (!targetPdfPath) {
      // Find matching pdf in 1-References by key or stem
      const match = refFiles.find(
        (f) =>
          f.name.toLowerCase().endsWith(".pdf") &&
          (f.name
            .toLowerCase()
            .includes(entry.key.toLowerCase().slice(0, 20)) ||
            entry.key
              .toLowerCase()
              .includes(f.name.toLowerCase().replace(/\.pdf$/, ""))),
      );
      if (match) {
        targetPdfPath = match.path;
      }
    }

    if (targetPdfPath) {
      try {
        const { content } = await readWorkspaceFile(
          userId,
          projectSlug,
          targetPdfPath,
        );
        const pdfCandidates = await scanPdfForCandidates(
          content,
          targetPdfPath,
          entry.key,
          ref,
          query,
          keywords,
        );
        candidates.push(...pdfCandidates);
      } catch (err) {
        console.warn(
          `[citation-finder] Error scanning PDF for ${entry.key}:`,
          err,
        );
      }
    }
  }

  // 4. Also check Knowledge store search if available
  try {
    const knowledgeResult = await searchProjectKnowledge(
      userId,
      projectSlug,
      query,
      { topK: 5 },
    );
    if (knowledgeResult?.result?.citations) {
      for (const citation of knowledgeResult.result.citations) {
        if (
          citation.citationKey &&
          referenceMap.has(citation.citationKey) &&
          citation.excerpt
        ) {
          const ref = referenceMap.get(citation.citationKey)!;
          const scored = computeCandidateScore(citation.excerpt, query, keywords);
          candidates.push({
            citationKey: citation.citationKey,
            reference: ref,
            text: cleanExtractedText(citation.excerpt),
            sourceLocation: citation.pageNumber
              ? `Page ${citation.pageNumber}`
              : "Knowledge File",
            sourceFilePath: citation.filePath,
            sourceFileName: citation.fileName,
            score: scored.score,
          });
        }
      }
    }
  } catch {
    // Knowledge store not enabled or failed, continue with bibliography scan
  }

  // Deduplicate by citationKey + sourceLocation (keep highest score)
  const uniqueCandidateMap = new Map<string, CandidatePassage>();
  for (const c of candidates) {
    const key = `${c.citationKey}:::${c.sourceLocation}`;
    const existing = uniqueCandidateMap.get(key);
    if (!existing || c.score > existing.score) {
      uniqueCandidateMap.set(key, c);
    }
  }
  const deduplicated = [...uniqueCandidateMap.values()];
  deduplicated.sort((a, b) => b.score - a.score);

  if (deduplicated.length === 0) {
    return {
      found: false,
      message:
        "No matching citation found in the bibliography knowledge base for the selected text.",
    };
  }

  const topCandidates = deduplicated.slice(0, 5);

  // 5. AI verification & exact excerpt extraction
  try {
    const aiConfig = await getAiTaskConfig("chat");
    if (aiConfig.apiKey && aiConfig.modelId) {
      const openrouter = createOpenRouter({ apiKey: aiConfig.apiKey });
      const prompt = `You are an academic research assistant verifying citations for an author.
The author wrote the following statement in their research draft:
"${query}"

Below are candidate passages retrieved from their project's bibliography and knowledge base:
${topCandidates
  .map(
    (c, i) => `[Candidate ${i + 1}]
Citation Key: ${c.citationKey}
Source Title: ${c.reference.title} (${c.reference.year})
Location: ${c.sourceLocation}
Passage: "${c.text}"
`,
  )
  .join("\n")}

Task:
Evaluate each candidate passage. For every candidate that provides relevant supporting evidence or context for the author's statement:
1. Provide a "score" from 0 to 100 representing relevance and evidential support.
2. Extract the exact quotation/sentence ("originalText") from that passage that verifies the statement.
3. Write a concise 1-sentence "explanation" of why this source supports the author's text.

Respond ONLY with valid JSON in this format:
{
  "matches": [
    {
      "candidateIndex": 1,
      "citationKey": "exact-citation-key",
      "score": 95,
      "originalText": "exact quotation from the candidate source passage",
      "explanation": "concise explanation"
    }
  ]
}`;

      const aiResponse = await generateText({
        model: openrouter(aiConfig.modelId),
        prompt,
        temperature: 0.1,
        maxOutputTokens: 800,
      });

      const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.matches) && parsed.matches.length > 0) {
          const aiMatches: CitationFindMatch[] = [];
          for (const m of parsed.matches) {
            const candidate =
              topCandidates[m.candidateIndex - 1] ||
              topCandidates.find((c) => c.citationKey === m.citationKey);
            if (!candidate) continue;
            const ref = candidate.reference;
            const score =
              typeof m.score === "number"
                ? Math.max(30, Math.min(99, Math.round(m.score)))
                : candidate.score;
            aiMatches.push({
              citationKey: candidate.citationKey,
              reference: ref,
              originalText: cleanExtractedText(
                m.originalText || candidate.text,
              ),
              sourceLocation: candidate.sourceLocation,
              sourceFilePath: candidate.sourceFilePath,
              sourceFileName: candidate.sourceFileName,
              explanation:
                m.explanation ||
                `Confirms the statement from ${ref.title}.`,
              confidence:
                score >= 80 ? "high" : score >= 60 ? "medium" : "low",
              score,
            });
          }
          if (aiMatches.length > 0) {
            aiMatches.sort((a, b) => b.score - a.score);
            return {
              found: true,
              matches: aiMatches,
              match: aiMatches[0],
            };
          }
        }
      }
    }
  } catch (aiError) {
    console.warn(
      "[citation-finder] AI verification failed, falling back to scored candidate matches:",
      aiError,
    );
  }

  // 6. Fallback: compute scored matches from top candidates
  const matches: CitationFindMatch[] = topCandidates
    .filter((c) => c.score >= 20)
    .map((c) => {
      const scored = computeCandidateScore(c.text, query, keywords);
      return {
        citationKey: c.citationKey,
        reference: c.reference,
        originalText: cleanExtractedText(scored.bestSentence || c.text),
        sourceLocation: c.sourceLocation,
        sourceFilePath: c.sourceFilePath,
        sourceFileName: c.sourceFileName,
        explanation: `Found in "${c.reference.title}" (${c.sourceLocation}) with key matching evidence: ${scored.matchedKeywords.slice(0, 4).join(", ")}.`,
        confidence:
          scored.score >= 80
            ? "high"
            : scored.score >= 60
              ? "medium"
              : "low",
        score: scored.score,
      };
    });

  matches.sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    return {
      found: false,
      message:
        "No matching citation found in the bibliography knowledge base for the selected text.",
    };
  }

  return {
    found: true,
    matches,
    match: matches[0],
  };
}
