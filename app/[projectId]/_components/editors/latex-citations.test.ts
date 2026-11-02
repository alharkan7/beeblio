import assert from "node:assert/strict";
import test from "node:test";

import { bibliographyReferences } from "../../../../lib/citations.ts";
import { latexCitationNumbers, latexCitationStyle, renderLatexCitations } from "./latex-citations.ts";

const source = `\\usepackage[authoryear]{natbib}
\\begin{document}
Text \\citep{smith2024} and \\citet{doe2022}.
\\bibliographystyle{plainnat}
\\bibliography{1-References/references}
\\end{document}`;

const references = bibliographyReferences(`@article{smith2024,
  author = {Smith, Jane},
  title = {One},
  year = {2024}
}
@article{doe2022,
  author = {Doe, John},
  title = {Two},
  year = {2022}
}`);

test("natbib author-year citations use the canonical bibliography's author and year", () => {
  assert.equal(latexCitationStyle(source), "apa");
  const context = {
    numbers: latexCitationNumbers(source),
    references: new Map(references.map((reference) => [reference.id, reference])),
    style: "apa" as const,
  };
  assert.equal(renderLatexCitations("\\citep{smith2024}", context), "(Smith, 2024)");
  assert.equal(renderLatexCitations("\\citet{doe2022}", context), "Doe (2022)");
  assert.equal(renderLatexCitations("\\citep{missing}", context), "[?missing]");
});

test("numeric natbib options retain numbered citations", () => {
  assert.equal(latexCitationStyle(source.replace("authoryear", "numbers")), "ieee");
  assert.equal(renderLatexCitations("\\citep{smith2024}", {
    numbers: latexCitationNumbers(source),
    references: new Map(),
    style: "ieee",
  }), "[1]");
});

test("LaTeX style declarations select all six Markdown citation styles", () => {
  const cases = [
    ["apa", "(Smith, 2024)"],
    ["chicago", "(Smith 2024)"],
    ["harvard", "(Smith, 2024)"],
    ["mla", "(Smith)"],
    ["IEEEtran", "[1]"],
    ["vancouver", "(1)"],
  ] as const;
  for (const [declared, expected] of cases) {
    const tex = `\\bibliographystyle{${declared}} \\citep{smith2024}`;
    const style = latexCitationStyle(tex);
    assert.equal(renderLatexCitations("\\citep{smith2024}", {
      numbers: latexCitationNumbers(tex),
      references: new Map(references.map((reference) => [reference.id, reference])),
      style,
    }), expected, declared);
  }
});

test("biblatex style and text citation commands use the same formatting", () => {
  const tex = "\\usepackage[style=chicago-authordate]{biblatex} \\textcite{smith2024}";
  assert.equal(latexCitationStyle(tex), "chicago");
  assert.equal(renderLatexCitations("\\textcite{smith2024}", {
    numbers: latexCitationNumbers(tex),
    references: new Map(references.map((reference) => [reference.id, reference])),
    style: latexCitationStyle(tex),
  }), "Smith (2024)");
});
