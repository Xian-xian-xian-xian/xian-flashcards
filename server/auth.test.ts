import { describe, expect, it } from "vitest";
import { isSuperuserUsername, publicAuthUser } from "./auth.js";

describe("超级用户身份", () => {
  it("仅将精确用户名 Xian 识别为超级用户", () => {
    expect(isSuperuserUsername("Xian")).toBe(true);
    expect(isSuperuserUsername("xian")).toBe(false);
    expect(isSuperuserUsername("XIAN")).toBe(false);
    expect(isSuperuserUsername(" Xian ")).toBe(false);
    expect(isSuperuserUsername(undefined)).toBe(false);
  });

  it("在公开用户响应中返回服务端派生的权限", () => {
    expect(publicAuthUser({ id: 1, username: "Xian" })).toEqual({ id: 1, username: "Xian", isSuperuser: true });
    expect(publicAuthUser({ id: 2, username: "Other" })).toEqual({ id: 2, username: "Other", isSuperuser: false });
  });
});
