import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./App";

describe("MarkdownText", () => {
  it("renders the mixed Markdown structure used in card content", () => {
    const html = renderToStaticMarkup(
      <MarkdownText value={`### 句子结构

> There are **crowds of people** around her *asking for a photo with her*.

- **asking** 的逻辑主语是 **people**
- 相当于 [who are asking](https://example.com)

| 结构 | 作用 |
| --- | --- |
| 名词 + doing | 后置定语 |

- [x] 支持任务项

\`\`\`ts
const sentence = "Markdown";
\`\`\`

行内公式：$E = mc^2$

$$
\\frac{a}{b}
$$`} />
    );

    expect(html).toContain("markdown-heading level-3");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<strong>crowds of people</strong>");
    expect(html).toContain("<em>asking for a photo with her</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("code-block");
    expect(html).toContain("math-inline");
    expect(html).toContain("math-block");
  });

  it("keeps fill-in-the-blank markers compatible with Markdown", () => {
    const html = renderToStaticMarkup(
      <MarkdownText value="**I** eat [] every day." renderBlank={(key) => <i data-blank={key} />} />
    );

    expect(html).toContain("<strong>I</strong>");
    expect(html).toContain('data-blank="blank-0"');
  });
});
