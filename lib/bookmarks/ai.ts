export type AiStrategyId = "domain-groups" | "semantic-clusters" | "alphabetical";

export type AiBookmarkDigest = {
  id: string;
  name?: string;
  url?: string;
  trail?: string;
  domain?: string | null;
  parentFolderName?: string | null;
};

export type AiPlanBookmark = {
  id: string;
  newName?: string;
};

export type AiPlanGroup = {
  name: string;
  bookmarks: AiPlanBookmark[];
};

export type AiPlanResult = {
  folderTitle?: string;
  summary?: string;
  groups: AiPlanGroup[];
};

export interface AiOrganizeRequestPayload {
  strategy: AiStrategyId;
  bookmarks: AiBookmarkDigest[];
  locale?: string;
  themes?: string[];
}

export interface AiOrganizeResponsePayload {
  plan: AiPlanResult;
  rawContent?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export type AiOrganizeJobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface AiOrganizeJobSnapshot {
  id: string;
  status: AiOrganizeJobStatus;
  strategy: AiStrategyId;
  strategyLabel: string;
  locale: string;
  totalBookmarks: number;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: AiOrganizeResponsePayload;
  error?: string;
  themes?: string[];
}

export interface AiOrganizeJobResponse {
  job: AiOrganizeJobSnapshot;
}

const STRATEGY_DISPLAY_NAMES: Record<AiStrategyId, string> = {
  "domain-groups": "域名分组",
  "semantic-clusters": "语义主题",
  alphabetical: "字母索引",
};

export function getStrategyDisplayName(strategy: AiStrategyId): string {
  return STRATEGY_DISPLAY_NAMES[strategy] ?? "智能整理";
}
