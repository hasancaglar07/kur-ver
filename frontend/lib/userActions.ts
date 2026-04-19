export type UserActionType =
  | "upload_success"
  | "sms_sent"
  | "sms_retry"
  | "bulk_approved"
  | "bulk_rejected"
  | "bulk_sms_retry";

export type UserActionItem = {
  id: string;
  type: UserActionType;
  label: string;
  href: string;
  created_at: string;
};

const ACTIONS_KEY = "kurbanops_recent_actions_v1";
const MAX_ACTIONS = 25;

function readActions(): UserActionItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ACTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserActionItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeActions(items: UserActionItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIONS_KEY, JSON.stringify(items.slice(0, MAX_ACTIONS)));
}

export function pushUserAction(input: Omit<UserActionItem, "id" | "created_at">) {
  const next: UserActionItem = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    ...input,
  };
  const current = readActions();
  writeActions([next, ...current]);
}

export function listRecentUserActions(limit = 5): UserActionItem[] {
  return readActions().slice(0, limit);
}

export function clearRecentUserActions() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACTIONS_KEY);
}

