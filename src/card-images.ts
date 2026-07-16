export function insertImageMarkdown(value: string, start: number, end: number, url: string) {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const imageMarkdown = `![图片](${url.trim()})`;
  const prefix = safeStart > 0 && !/\s$/.test(value.slice(0, safeStart)) ? "\n" : "";
  const suffix = safeEnd < value.length && !/^\s/.test(value.slice(safeEnd)) ? "\n" : "";
  return {
    value: `${value.slice(0, safeStart)}${prefix}${imageMarkdown}${suffix}${value.slice(safeEnd)}`,
    cursor: safeStart + prefix.length + imageMarkdown.length
  };
}
