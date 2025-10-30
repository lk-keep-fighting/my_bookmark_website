import type { AiOrganizeJobSnapshot, AiStrategyId } from "./ai";

const STORE_KEY = "__bookmarkAiOrganizeJobStore__";

type AiOrganizeJobRecord = {
  snapshot: AiOrganizeJobSnapshot;
  controller: AbortController | null;
};

type GlobalWithStore = typeof globalThis & {
  [STORE_KEY]?: Map<string, AiOrganizeJobRecord>;
};

function getStore(): Map<string, AiOrganizeJobRecord> {
  const globalObject = globalThis as GlobalWithStore;
  if (!globalObject[STORE_KEY]) {
    globalObject[STORE_KEY] = new Map();
  }
  return globalObject[STORE_KEY] as Map<string, AiOrganizeJobRecord>;
}

function cloneSnapshot(snapshot: AiOrganizeJobSnapshot): AiOrganizeJobSnapshot {
  if (typeof structuredClone === "function") {
    return structuredClone(snapshot);
  }
  return JSON.parse(JSON.stringify(snapshot)) as AiOrganizeJobSnapshot;
}

function createJobId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createAiOrganizeJob(params: {
  strategy: AiStrategyId;
  strategyLabel: string;
  locale: string;
  totalBookmarks: number;
  themes?: string[];
}): AiOrganizeJobSnapshot {
  const now = new Date().toISOString();
  const snapshot: AiOrganizeJobSnapshot = {
    id: createJobId(),
    status: "pending",
    strategy: params.strategy,
    strategyLabel: params.strategyLabel,
    locale: params.locale,
    totalBookmarks: params.totalBookmarks,
    cancelRequested: false,
    createdAt: now,
    updatedAt: now,
    themes: params.themes && params.themes.length > 0 ? [...new Set(params.themes.map((theme) => theme.trim()).filter(Boolean))] : undefined,
  };

  const store = getStore();
  store.set(snapshot.id, {
    snapshot,
    controller: null,
  });

  return cloneSnapshot(snapshot);
}

export function getAiOrganizeJob(jobId: string): AiOrganizeJobSnapshot | null {
  const record = getStore().get(jobId);
  if (!record) {
    return null;
  }
  return cloneSnapshot(record.snapshot);
}

export function updateAiOrganizeJob(
  jobId: string,
  updates: Partial<AiOrganizeJobSnapshot>,
): AiOrganizeJobSnapshot | null {
  const store = getStore();
  const record = store.get(jobId);
  if (!record) {
    return null;
  }
  const snapshot: AiOrganizeJobSnapshot = {
    ...record.snapshot,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  record.snapshot = snapshot;
  store.set(jobId, record);
  return cloneSnapshot(snapshot);
}

export function setAiOrganizeJobController(jobId: string, controller: AbortController | null): void {
  const store = getStore();
  const record = store.get(jobId);
  if (!record) {
    return;
  }
  record.controller = controller;
  store.set(jobId, record);
}

export function clearAiOrganizeJobController(jobId: string, controller?: AbortController | null): void {
  const store = getStore();
  const record = store.get(jobId);
  if (!record) {
    return;
  }
  if (!controller || record.controller === controller) {
    record.controller = null;
    store.set(jobId, record);
  }
}

export function markAiOrganizeJobCancelRequested(jobId: string): AiOrganizeJobSnapshot | null {
  const store = getStore();
  const record = store.get(jobId);
  if (!record) {
    return null;
  }

  const now = new Date().toISOString();
  const current = record.snapshot;

  if (current.status === "succeeded" || current.status === "failed" || current.status === "cancelled") {
    return cloneSnapshot(current);
  }

  const nextStatus = current.status === "pending" ? "cancelled" : current.status;
  const finishedAt = current.status === "pending" ? now : current.finishedAt;

  const nextSnapshot: AiOrganizeJobSnapshot = {
    ...current,
    cancelRequested: true,
    status: nextStatus,
    finishedAt,
    updatedAt: now,
  };

  record.snapshot = nextSnapshot;

  if (record.controller) {
    const abortError = new Error("AI 整理任务被用户停止");
    abortError.name = "AbortError";
    record.controller.abort(abortError);
    record.controller = null;
  }

  store.set(jobId, record);
  return cloneSnapshot(nextSnapshot);
}

export function removeAiOrganizeJob(jobId: string): void {
  const store = getStore();
  store.delete(jobId);
}
