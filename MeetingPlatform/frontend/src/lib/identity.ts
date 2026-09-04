// =========================================================
// Guest identity — no accounts, no passwords. A random id is
// generated once per browser and paired with whatever name the
// person types; that pair is their identity for the app.
// =========================================================

const USER_ID_KEY = "accmeet:user_id";
const USER_NAME_KEY = "accmeet:user_name";

export function getUserId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

export function getUserName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(USER_NAME_KEY) ?? "";
}

export function setUserName(name: string): string {
  const trimmed = name.trim().slice(0, 50);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(USER_NAME_KEY, trimmed);
  }
  return trimmed;
}
