// @vitest-environment jsdom
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const html = fs.readFileSync("deploy/tomatoes-login.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

afterEach(() => { document.body.innerHTML = ""; });

function mount(canRegister: boolean) {
  document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)![1];
  const fetchMock = vi.fn(async (url: string) => ({
    ok: url === "/api/auth/status",
    json: async () => url === "/api/auth/status" ? { canRegister } : { error: "请输入有效的邀请码" }
  }));
  const safeNext = new Function("window", "document", "fetch", `${script}\nreturn safeNext;`)(window, document, fetchMock) as (value: string) => string;
  return { fetchMock, safeNext };
}

describe("shared tomato login page", () => {
  it("shows the invitation form only when registration is enabled and sends the invitation to the server", async () => {
    const { fetchMock, safeNext } = mount(true);
    const toggle = document.querySelector<HTMLButtonElement>("#switchMode")!;
    await vi.waitFor(() => expect(toggle.hidden).toBe(false));
    toggle.click();
    const invite = document.querySelector<HTMLInputElement>("#inviteCode")!;
    expect(invite.required).toBe(true);
    expect(invite.disabled).toBe(false);
    expect(document.querySelector("h1")!.textContent).toBe("邀请码注册");
    document.querySelector<HTMLInputElement>("#username")!.value = "invited-user";
    document.querySelector<HTMLInputElement>("#password")!.value = "password123";
    invite.value = " WRONG ";
    const form = document.querySelector<HTMLFormElement>("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector("#errorText")!.textContent).toBe("请输入有效的邀请码"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/register");
    const options = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(options.body as string)).toEqual({ username: "invited-user", password: "password123", inviteCode: "WRONG" });
    toggle.click();
    expect(invite.required).toBe(false);
    expect(invite.disabled).toBe(true);
    expect(invite.value).toBe("");
    expect(safeNext("/#memory")).toBe("/#memory");
    for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "/\nevil.example"]) expect(safeNext(next)).toBe("/");
  });

  it("keeps registration hidden when disabled", async () => {
    mount(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector<HTMLButtonElement>("#switchMode")!.hidden).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#inviteCode")!.disabled).toBe(true);
  });
});
