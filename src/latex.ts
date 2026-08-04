export const blockMathArrayStretch = 1.5;

/**
 * Converts alternate math delimiters to the form understood by remark-math.
 *
 * LaTeX environments already inside `$$...$$` stay intact: an `equation`
 * environment can contain a nested `split`, so a broad replacement would
 * otherwise stop at the inner end tag.
 */
export function normalizeMarkdownMath(value: string) {
  const normalizedDelimiters = value
    .replace(/\r\n/g, "\n")
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math) => `$${math}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math) => `$$\n${math}\n$$`);

  return normalizedDelimiters
    .split(/(\$\$[\s\S]*?\$\$)/g)
    .map((segment, index) => index % 2 === 1
      ? segment
      : segment.replace(/\\begin\{(?<environment>equation\*?|align\*?|gather\*?|multline\*?|split)\}([\s\S]*?)\\end\{\k<environment>\}/g, (_match, _environment, math) => `$$\n${math}\n$$`))
    .join("");
}

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
