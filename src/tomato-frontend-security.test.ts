// @vitest-environment jsdom
import fs from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => { document.body.innerHTML = ""; });

describe("tomato frontend security", () => {
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
