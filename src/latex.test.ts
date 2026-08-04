import katex from "katex";
import { describe, expect, it } from "vitest";
import { blockMathArrayStretch, latexRenderSource, normalizeMarkdownMath } from "./latex";

function maximumEmHeight(html: string) {
  return Math.max(...Array.from(html.matchAll(/height:([0-9.]+)em/g), (match) => Number(match[1])));
}

describe("LaTeX rendering", () => {
  it("applies 1.5 array stretch to line breaks inside block formulas", () => {
    const formula = String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`;
    const defaultHtml = katex.renderToString(formula, { displayMode: true, throwOnError: true });
    const spacedHtml = katex.renderToString(latexRenderSource(formula, true), { displayMode: true, throwOnError: true });

    expect(blockMathArrayStretch).toBe(1.5);
    expect(latexRenderSource(formula, true)).toBe(`\\def\\arraystretch{1.5}${formula}`);
    expect(maximumEmHeight(spacedHtml)).toBeGreaterThan(maximumEmHeight(defaultHtml));
  });

  it("keeps inline formulas free of block-only spacing commands", () => {
    expect(latexRenderSource("  x = y  ")).toBe("x = y");
  });

  it("preserves nested environments already contained in a display delimiter", () => {
    const formula = String.raw`$$\begin{equation}\begin{split}a&=b\\c&=d\end{split}\notag\end{equation}$$`;

    expect(normalizeMarkdownMath(formula)).toBe(formula);
    expect(() => katex.renderToString(latexRenderSource(formula.slice(2, -2), true), { displayMode: true, throwOnError: true })).not.toThrow();
  });

  it("wraps a standalone math environment without consuming another environment's end tag", () => {
    const formula = String.raw`\begin{equation}\begin{split}a&=b\\c&=d\end{split}\end{equation}`;

    expect(normalizeMarkdownMath(formula)).toBe(String.raw`$$
\begin{split}a&=b\\c&=d\end{split}
$$`);
  });
});
