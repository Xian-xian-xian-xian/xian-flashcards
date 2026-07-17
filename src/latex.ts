export const blockMathArrayStretch = 1.5;

export function latexRenderSource(value: string, displayMode = false) {
  const sanitized = value
    .replace(/\\notag\b/g, "")
    .replace(/\\begin\{equation\*?\}/g, "")
    .replace(/\\end\{equation\*?\}/g, "")
    .trim();

  return displayMode
    ? `\\def\\arraystretch{${blockMathArrayStretch}}${sanitized}`
    : sanitized;
}
