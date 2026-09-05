// =========================================================
// Guest identity — no accounts, no passwords. A random id is
// generated once per browser and paired with whatever name the
// person types; that pair is their identity for the app.
// =========================================================

const USER_ID_KEY = "accmeet:user_id";
const USER_NAME_KEY = "accmeet:user_name";
const IS_PATIENT_DEVICE_KEY = "accmeet:is_patient_device";

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

// A device-level setting, not a per-meeting one — "this iPad belongs to the
// patient" is true across every meeting that device ever joins or creates,
// so it's set once and remembered rather than re-chosen each time. The
// dashboard reads this to decide whether to attach ?patient=1 when
// navigating into a meeting, so nobody has to hand-edit a URL.
export function getIsPatientDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(IS_PATIENT_DEVICE_KEY) === "1";
}

export function setIsPatientDevice(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IS_PATIENT_DEVICE_KEY, value ? "1" : "0");
}
