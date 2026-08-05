// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownText } from "./App";

const containers: HTMLDivElement[] = [];

afterEach(() => {
  containers.splice(0).forEach((container) => container.remove());
});

function testContainer() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  return container;
}

describe("MarkdownText DOM stability", () => {
  it("preserves a text selection across an unrelated rerender", () => {
    const container = testContainer();
    const root = createRoot(container);
    flushSync(() => root.render(<MarkdownText value="selectable text" />));

    const textNode = container.querySelector(".markdown-paragraph")?.firstChild;
    expect(textNode).toBeInstanceOf(Text);
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.setEnd(textNode!, 10);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    flushSync(() => root.render(<MarkdownText value="selectable text" />));

    expect(container.querySelector(".markdown-paragraph")?.firstChild).toBe(textNode);
    expect(selection?.toString()).toBe("selectable");
    root.unmount();
  });

  it("preserves a blank input and its focus when the renderer callback changes", () => {
    const container = testContainer();
    const root = createRoot(container);
    const render = () => <MarkdownText value="Answer: []" renderBlank={(key) => <input key={key} aria-label="blank" />} />;
    flushSync(() => root.render(render()));

    const input = container.querySelector<HTMLInputElement>('input[aria-label="blank"]');
    input?.focus();
    expect(document.activeElement).toBe(input);

    flushSync(() => root.render(render()));

    expect(container.querySelector('input[aria-label="blank"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    root.unmount();
  });
});
