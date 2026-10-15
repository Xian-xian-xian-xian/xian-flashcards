// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginView } from "./App";
import { api } from "./api";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function input(name: string, value: string) {
  const node = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("registration form", () => {
  it("defaults to login, requires an invitation to register, prevents duplicate submissions and shows server errors", async () => {
    let rejectRequest!: (error: Error) => void;
    const register = vi.spyOn(api, "register").mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    const onAuthed = vi.fn();
    await act(async () => root.render(<LoginView canRegister onAuthed={onAuthed} />));
    expect(container.querySelector("h1")?.textContent).toBe("登录");
    expect(container.querySelector('[name="inviteCode"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".text-button")!.click());
    expect(container.querySelector<HTMLInputElement>('[name="inviteCode"]')!.required).toBe(true);
    await input("username", " invited-user ");
    await input("password", "password123");
    await input("inviteCode", " WRONG ");
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({ username: "invited-user", password: "password123", inviteCode: "WRONG" });
    expect(container.querySelector<HTMLButtonElement>(".primary-button")!.disabled).toBe(true);
    await act(async () => rejectRequest(new Error("请输入有效的邀请码")));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("请输入有效的邀请码");
    expect(onAuthed).not.toHaveBeenCalled();
    register.mockResolvedValue({ user: { id: 2, username: "invited-user", isSuperuser: false } });
    await input("inviteCode", "VALID-CODE");
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onAuthed).toHaveBeenCalledWith({ id: 2, username: "invited-user", isSuperuser: false });
  });

  it("hides registration while it is closed and lets existing users log in without an invitation", async () => {
    const login = vi.spyOn(api, "login").mockRejectedValue(new Error("用户名或密码不正确"));
    await act(async () => root.render(<LoginView canRegister={false} onAuthed={vi.fn()} />));
    expect(container.querySelector(".text-button")).toBeNull();
    await input("username", "existing");
    await input("password", "password123");
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(login).toHaveBeenCalledWith({ username: "existing", password: "password123" });
  });
});
