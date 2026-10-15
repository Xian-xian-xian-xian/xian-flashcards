// @vitest-environment jsdom
import fs from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => { document.body.innerHTML = ""; });

describe("tomato frontend security", () => {
  it("updates the heading and tab title from the authenticated account safely", async () => {
    document.body.innerHTML = '<h1 id="siteTitle">番茄基地</h1><strong id="currentUserLabel"></strong>';
    let username: string | null = "Xian";
    const source = fs.readFileSync("deploy/tomatoes-script.js", "utf8");
    const context = vm.createContext({
      document, localStorage: { getItem: () => null }, window: { location: { protocol: "file:" } }, console,
      fetch: async () => ({ ok: true, json: async () => ({ user: username ? { username } : null }) }),
    });
    vm.runInContext(source.replace("  init();", "  globalThis.check = { hydrateAuthStatus };"), context);
    for (const name of ["Xian", "伙伴", '<img src=x onerror=alert(1)>', null]) {
      username = name;
      await context.check.hydrateAuthStatus();
      const title = name ? `${name}的番茄基地` : "番茄基地";
      expect(document.querySelector("h1")!.textContent).toBe(title);
      expect(document.title).toBe(`${title} | 专注学习看板`);
      expect(document.querySelector("img,[onerror]")).toBeNull();
    }
  });

  it("renders imported identifiers as data and neutralizes spreadsheet formulas", () => {
    for (const id of ["taskGoalSelect", "fullscreenTaskGoalSelect", "relatedTaskInput", "editRelatedTaskInput"]) {
      const node = document.createElement("select"); node.id = id; document.body.append(node);
    }
    const source = fs.readFileSync("deploy/tomatoes-script.js", "utf8");
    const context = vm.createContext({ document, localStorage: { getItem: () => null }, window: { location: { protocol: "file:" } }, console });
    vm.runInContext(source.replace("  init();", "  globalThis.check = { renderTaskOptions, csvCell, normalizeState, set state(value) { appState = normalizeState(value); } };"), context);
    const check = context.check;
    const attack = '\"><img src=x onerror=alert(1)>';
    check.state = { records: [], recentTasks: [{ id: attack, name: "<script>alert(1)</script>" }] };
    check.renderTaskOptions();
    expect(document.querySelector("img,script,[onerror]")).toBeNull();
    expect(document.querySelector<HTMLSelectElement>("select")!.options[1].value).toBe(attack);
    expect(check.csvCell("=1+1")).toBe('"\'=1+1"');
    expect(check.csvCell("ordinary text")).toBe('"ordinary text"');
    const normalized = check.normalizeState(JSON.parse('{"settings":{"__proto__":{"unsafe":true}},"records":[]}'));
    expect(normalized.settings.unsafe).toBeUndefined();
  });
});
