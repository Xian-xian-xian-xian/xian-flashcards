export type AuthUser = { id: number; username: string };

export function isSuperuserUsername(username: unknown) {
  return username === "Xian";
}

export function publicAuthUser(user: AuthUser) {
  return {
    id: Number(user.id),
    username: user.username,
    isSuperuser: isSuperuserUsername(user.username)
  };
}
