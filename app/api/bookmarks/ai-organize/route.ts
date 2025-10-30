import { NextResponse } from "next/server";
import { jsonrepair } from "jsonrepair";
import type {
  AiOrganizeJobResponse,
  AiOrganizeRequestPayload,
  AiOrganizeResponsePayload,
  AiPlanBookmark,
  AiPlanGroup,
  AiPlanResult,
  AiStrategyId,
} from "@/lib/bookmarks/ai";
import { getStrategyDisplayName } from "@/lib/bookmarks/ai";
import {
  clearAiOrganizeJobController,
  createAiOrganizeJob,
  getAiOrganizeJob,
  setAiOrganizeJobController,
  updateAiOrganizeJob,
} from "@/lib/bookmarks/ai-jobs";

const API_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL_NAME = "glm-4.5-air";
const MAX_GROUPS = 12;
const MAX_AI_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 4_000;
const DEFAULT_FIELD_LIMIT = 120;
const RETRY_SYSTEM_SUFFIX = `- 特别提醒：上一轮输出的 JSON 未能成功解析，本次必须严格遵守上述格式，仅返回合法 JSON。\n- 如非必要，请省略与原名称相同的 newName 字段，以控制输出长度。\n`;

const BASE_SYSTEM_PROMPT = `你是一名资深信息架构专家，负责根据用户提供的书签列表生成便于浏览的分类方案。\n\n请牢记以下规则：\n- 只能返回 JSON 文本，不允许输出额外的说明、前缀或代码块标记。\n- JSON 必须严格符合以下 TypeScript 类型定义：\n  type OrganizedFolderPlan = {\n    folderTitle?: string;\n    summary?: string;\n    groups: Array<{\n      name: string;\n      bookmarks: Array<{\n        id: string;\n        newName?: string;\n      }>;\n    }>;\n  };\n- groups 数量不要超过 12 个，每个 group 至少包含 1 个书签。\n- 不要虚构书签 ID，也不要遗漏输入中已经列出的书签。\n- 可选的 newName 字段用于提供更清晰或规范的名称，若无需修改可以省略。\n- 输出请尽量紧凑，避免冗余空格和换行，以减少字符长度。\n- 若某些书签不属于主要分组，可放入名为“其他收藏”的分组中。\n`;

const STRATEGY_INSTRUCTIONS: Record<AiStrategyId, string> = {
  "domain-groups": `策略：域名智能分组。\n- 优先按照书签所属站点或域名进行聚合，同一域名的书签应归在同一 group。\n- group 名称建议包含域名及一句简洁的中文说明，例如“github.com · 开源社区”。\n- 对于数量较少或无法识别域名的书签，可以统一放入“其他收藏”。\n`,
  "semantic-clusters": `策略：语义主题整理。\n- 根据常见使用场景或主题（如“社交 & 社区”“效率 & 办公”“开发 & 技术”“资讯 & 阅读”“影音 & 娱乐”等）进行分组。\n- group 名称使用清晰的中文主题名称，必要时可自定义新的主题。\n- 无法归类的条目放入“其他收藏”，确保每条书签都被收录。\n`,
  alphabetical: `策略：字母顺序索引。\n- 按照书签名称或建议名称（newName）的首字母进行分组，使用大写字母 A-Z。\n- 中文名称请转换为常见拼音首字母后再归类，例如“知乎”应归入“Z 开头”。\n- group 名称可采用“X 开头”形式，如“A 开头”“B 开头”。\n- 无法确定首字母的条目归入“其他收藏”。\n`,
};

type SanitizedBookmark = {
  id: string;
  name: string;
  url?: string;
  domain?: string;
  trail?: string;
  parentFolderName?: string;
};

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type DigestFormattingOptions = {
  includeUrl: boolean;
  includeTrail: boolean;
  includeParentFolder: boolean;
  maxFieldLength: number;
};

class AiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "AiRequestError";
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI 接口未配置，请联系管理员补充 API Key" }, { status: 500 });
  }

  let payload: AiOrganizeRequestPayload;
  try {
    payload = (await request.json()) as AiOrganizeRequestPayload;
  } catch (error) {
    return NextResponse.json({ error: "请求体解析失败，请确认使用 JSON 格式" }, { status: 400 });
  }

  const strategy = payload?.strategy;
  if (!isValidStrategy(strategy)) {
    return NextResponse.json({ error: "未知的整理策略" }, { status: 400 });
  }

  const bookmarksInput = Array.isArray(payload?.bookmarks) ? payload.bookmarks : [];
  const sanitizedBookmarks = bookmarksInput
    .map((bookmark) => sanitizeBookmark(bookmark))
    .filter((bookmark): bookmark is SanitizedBookmark => Boolean(bookmark));

  if (sanitizedBookmarks.length === 0) {
    return NextResponse.json({ error: "请提供至少一个需要整理的书签" }, { status: 400 });
  }

  const strategyLabel = getStrategyDisplayName(strategy);
  const locale = typeof payload?.locale === "string" && payload.locale.trim() ? payload.locale.trim() : "zh-CN";

  const job = createAiOrganizeJob({
    strategy,
    strategyLabel,
    locale,
    totalBookmarks: sanitizedBookmarks.length,
  });

  launchAiOrganizeJob(job.id, {
    apiKey,
    strategy,
    strategyLabel,
    locale,
    bookmarks: sanitizedBookmarks,
  });

  const response: AiOrganizeJobResponse & { message: string } = {
    job,
    message: "AI 整理任务已在后台启动，请稍后刷新任务状态或手动停止。",
  };

  return NextResponse.json(response, { status: 202 });
}

type LaunchContext = {
  apiKey: string;
  strategy: AiStrategyId;
  strategyLabel: string;
  locale: string;
  bookmarks: SanitizedBookmark[];
};

function launchAiOrganizeJob(jobId: string, context: LaunchContext): void {
  void (async () => {
    const initial = getAiOrganizeJob(jobId);
    if (!initial) {
      return;
    }

    if (initial.cancelRequested || initial.status !== "pending") {
      if (initial.cancelRequested && initial.status !== "cancelled") {
        updateAiOrganizeJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
      }
      return;
    }

    const startedAt = new Date().toISOString();
    const running = updateAiOrganizeJob(jobId, {
      status: "running",
      startedAt,
      error: undefined,
    });

    if (!running || running.status !== "running") {
      return;
    }

    const controller = new AbortController();
    setAiOrganizeJobController(jobId, controller);

    try {
      const result = await generateAiPlan({
        apiKey: context.apiKey,
        strategy: context.strategy,
        strategyLabel: context.strategyLabel,
        locale: context.locale,
        bookmarks: context.bookmarks,
        abortSignal: controller.signal,
      });

      const latest = getAiOrganizeJob(jobId);
      const finishedAt = new Date().toISOString();
      if (latest?.cancelRequested) {
        updateAiOrganizeJob(jobId, {
          status: "cancelled",
          finishedAt,
          cancelRequested: true,
          result: undefined,
        });
        return;
      }

      updateAiOrganizeJob(jobId, {
        status: "succeeded",
        finishedAt,
        result,
        error: undefined,
        cancelRequested: false,
      });
    } catch (error) {
      const finishedAt = new Date().toISOString();
      if (isAbortError(error) || getAiOrganizeJob(jobId)?.cancelRequested) {
        updateAiOrganizeJob(jobId, {
          status: "cancelled",
          finishedAt,
          result: undefined,
          cancelRequested: true,
        });
      } else if (error instanceof AiRequestError) {
        updateAiOrganizeJob(jobId, {
          status: "failed",
          finishedAt,
          error: error.message,
          cancelRequested: false,
        });
      } else {
        const message = error instanceof Error ? error.message : "AI 整理任务执行失败";
        updateAiOrganizeJob(jobId, {
          status: "failed",
          finishedAt,
          error: message,
          cancelRequested: false,
        });
      }
    } finally {
      clearAiOrganizeJobController(jobId, controller);
    }
  })().catch((error) => {
    clearAiOrganizeJobController(jobId);
    const message = error instanceof Error ? error.message : "AI 整理任务执行失败";
    updateAiOrganizeJob(jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: message,
      cancelRequested: false,
    });
  });
}

async function generateAiPlan({
  apiKey,
  strategy,
  strategyLabel,
  locale,
  bookmarks,
  abortSignal,
}: {
  apiKey: string;
  strategy: AiStrategyId;
  strategyLabel: string;
  locale: string;
  bookmarks: SanitizedBookmark[];
  abortSignal?: AbortSignal;
}): Promise<AiOrganizeResponsePayload> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_AI_ATTEMPTS; attempt += 1) {
    throwIfAborted(abortSignal);

    const digestOptions = getDigestOptions(bookmarks.length, attempt > 0);
    const digest = bookmarks.map((bookmark, index) => formatBookmarkDigest(bookmark, index, digestOptions)).join("\n");
    const userPrompt = buildUserPrompt({
      strategyLabel,
      locale,
      count: bookmarks.length,
      digest,
      digestOptions,
      attempt,
    });
    const messages = buildMessages(strategy, userPrompt, attempt);

    try {
      const { rawContent, usage } = await requestAiCompletion({ apiKey, messages, abortSignal });
      const plan = normalizePlan(rawContent);
      return { plan, rawContent, usage };
    } catch (error) {
      if (error instanceof AiRequestError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw error;
      }

      if (isRetryableAiError(error) && attempt < MAX_AI_ATTEMPTS - 1) {
        lastError = error instanceof Error ? error : null;
        continue;
      }

      const message = error instanceof Error ? error.message : "AI 返回结果解析失败";
      throw new AiRequestError(message, 502);
    }
  }

  const fallbackMessage = lastError?.message ?? "AI 未返回有效的整理方案";
  throw new AiRequestError(fallbackMessage, 502);
}

async function requestAiCompletion({
  apiKey,
  messages,
  abortSignal,
}: {
  apiKey: string;
  messages: ChatMessage[];
  abortSignal?: AbortSignal;
}): Promise<{ rawContent: string; usage?: AiOrganizeResponsePayload["usage"] }> {
  const timeoutController = createTimeoutController(REQUEST_TIMEOUT_MS);
  const mergedSignal = mergeAbortSignals([abortSignal, timeoutController?.signal]);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        temperature: 0.3,
        stream: false,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages,
      }),
      signal: mergedSignal?.signal,
    });

    const payloadJson = await safeReadJson(response);
    if (!response.ok) {
      const reason =
        payloadJson && typeof payloadJson === "object" && "error" in payloadJson
          ? (payloadJson as { error?: string }).error
          : undefined;
      const status = response.status >= 400 ? response.status : 500;
      throw new AiRequestError(reason ?? `AI 接口请求失败（${response.status}）`, status);
    }

    const rawContent = extractCompletionContent(payloadJson);
    const usage = getUsageSummary(payloadJson);

    return { rawContent, usage };
  } finally {
    timeoutController?.dispose();
    mergedSignal?.disconnect();
  }
}

function buildMessages(strategy: AiStrategyId, userPrompt: string, attempt: number): ChatMessage[] {
  const strategyInstruction = STRATEGY_INSTRUCTIONS[strategy] ?? "";
  const systemPrompt =
    attempt > 0
      ? `${BASE_SYSTEM_PROMPT}${strategyInstruction}${RETRY_SYSTEM_SUFFIX}`
      : `${BASE_SYSTEM_PROMPT}${strategyInstruction}`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function buildUserPrompt({
  strategyLabel,
  locale,
  count,
  digest,
  digestOptions,
  attempt,
}: {
  strategyLabel: string;
  locale: string;
  count: number;
  digest: string;
  digestOptions: DigestFormattingOptions;
  attempt: number;
}): string {
  const fieldsDescription = describeDigestOptions(digestOptions);
  const attemptWarning =
    attempt > 0
      ? "⚠️ 上一次的 JSON 无法解析，请严格按照上述类型重新输出合法 JSON，仅保留必要字段，newName 仅在确有需要时提供。"
      : null;

  const sections = [
    `请依据“${strategyLabel}”策略整理以下 ${count} 条书签。`,
    "务必将每个书签放入某个分组，可在必要时提供 newName 以提升可读性。",
    `输出语言保持 ${locale}，仅返回 JSON。`,
    attemptWarning,
    `书签列表（${fieldsDescription}）：`,
    digest,
  ].filter(Boolean);

  return sections.join("\n\n");
}

function getDigestOptions(count: number, isRetry: boolean): DigestFormattingOptions {
  if (isRetry) {
    if (count <= 120) {
      return { includeUrl: true, includeTrail: false, includeParentFolder: false, maxFieldLength: 100 };
    }
    return { includeUrl: false, includeTrail: false, includeParentFolder: false, maxFieldLength: 80 };
  }
  if (count <= 80) {
    return { includeUrl: true, includeTrail: true, includeParentFolder: true, maxFieldLength: DEFAULT_FIELD_LIMIT };
  }
  if (count <= 160) {
    return { includeUrl: true, includeTrail: false, includeParentFolder: true, maxFieldLength: 110 };
  }
  if (count <= 220) {
    return { includeUrl: true, includeTrail: false, includeParentFolder: false, maxFieldLength: 100 };
  }
  return { includeUrl: false, includeTrail: false, includeParentFolder: false, maxFieldLength: 80 };
}

function describeDigestOptions(options: DigestFormattingOptions): string {
  const fields = ["ID", "名称", "域名"];
  if (options.includeUrl) {
    fields.push("链接");
  }
  if (options.includeParentFolder) {
    fields.push("上级目录");
  }
  if (options.includeTrail) {
    fields.push("路径");
  }
  return `包含字段：${fields.join("、")}`;
}

function truncateDigestField(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 8) {
    return `${value.slice(0, maxLength - 1)}…`;
  }
  const head = Math.floor((maxLength - 1) / 2);
  const tail = maxLength - 1 - head;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function formatUrlForDigest(url: string, maxLength: number): string {
  const withoutProtocol = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const [pathWithoutQuery] = withoutProtocol.split("?");
  const normalized = pathWithoutQuery || withoutProtocol;
  return truncateDigestField(normalized, maxLength);
}

function isRetryableAiError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message ?? "";
  return (
    message.includes("JSON") ||
    message.includes("结构不正确") ||
    message.includes("分组结果") ||
    message.includes("返回内容为空") ||
    message.includes("返回数据格式不正确")
  );
}

function isValidStrategy(value: unknown): value is AiStrategyId {
  return value === "domain-groups" || value === "semantic-clusters" || value === "alphabetical";
}

type RawBookmark = AiOrganizeRequestPayload["bookmarks"][number];

function sanitizeBookmark(bookmark: RawBookmark | undefined): SanitizedBookmark | null {
  if (!bookmark || typeof bookmark !== "object") {
    return null;
  }
  const id = typeof bookmark.id === "string" ? bookmark.id.trim() : "";
  if (!id) {
    return null;
  }
  const name = typeof bookmark.name === "string" && bookmark.name.trim() ? bookmark.name.trim() : "未命名网页";
  const url = typeof bookmark.url === "string" && bookmark.url.trim() ? bookmark.url.trim() : undefined;
  const domain = typeof bookmark.domain === "string" && bookmark.domain.trim() ? bookmark.domain.trim() : undefined;
  const trail = typeof bookmark.trail === "string" && bookmark.trail.trim() ? bookmark.trail.trim() : undefined;
  const parentFolderName =
    typeof bookmark.parentFolderName === "string" && bookmark.parentFolderName.trim()
      ? bookmark.parentFolderName.trim()
      : undefined;

  return {
    id,
    name,
    url,
    domain,
    trail,
    parentFolderName,
  };
}

function formatBookmarkDigest(
  bookmark: SanitizedBookmark,
  index: number,
  options: DigestFormattingOptions,
): string {
  const parts = [
    `${index + 1}. id=${bookmark.id}`,
    `name=${truncateDigestField(bookmark.name, options.maxFieldLength)}`,
  ];
  if (bookmark.domain) {
    parts.push(`domain=${truncateDigestField(bookmark.domain, options.maxFieldLength)}`);
  }
  if (options.includeUrl && bookmark.url) {
    parts.push(`url=${formatUrlForDigest(bookmark.url, options.maxFieldLength)}`);
  }
  if (options.includeParentFolder && bookmark.parentFolderName) {
    parts.push(`folder=${truncateDigestField(bookmark.parentFolderName, options.maxFieldLength)}`);
  }
  if (options.includeTrail && bookmark.trail) {
    parts.push(`trail=${truncateDigestField(bookmark.trail, options.maxFieldLength)}`);
  }
  return parts.join("；");
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function extractCompletionContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("AI 返回数据格式不正确");
  }
  const choices = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("AI 返回内容为空");
  }
  return content;
}

function normalizePlan(content: string): AiPlanResult {
  const jsonText = extractJsonText(content);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText) as AiPlanResult;
  } catch {
    const repaired = tryRepairJson(jsonText);
    if (!repaired) {
      throw new Error("AI 返回内容不是合法的 JSON");
    }
    try {
      raw = JSON.parse(repaired) as AiPlanResult;
    } catch {
      throw new Error("AI 返回内容不是合法的 JSON");
    }
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("AI 返回结构不正确");
  }

  const plan = raw as Partial<AiPlanResult>;
  const groupsInput = Array.isArray(plan.groups) ? plan.groups : [];
  const groups: AiPlanGroup[] = [];

  for (const group of groupsInput) {
    if (!group || typeof group !== "object") continue;
    const rawName = (group as { name?: unknown }).name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) continue;

    const rawBookmarks = (group as { bookmarks?: unknown }).bookmarks;
    const bookmarksInput = Array.isArray(rawBookmarks) ? (rawBookmarks as AiPlanBookmark[]) : [];

    const bookmarks: AiPlanBookmark[] = [];
    const seen = new Set<string>();

    for (const bookmark of bookmarksInput) {
      if (!bookmark || typeof bookmark !== "object") continue;
      const rawId = (bookmark as { id?: unknown }).id;
      const id = typeof rawId === "string" ? rawId.trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const rawNewName = (bookmark as { newName?: unknown }).newName;
      const newName = typeof rawNewName === "string" ? rawNewName.trim() : undefined;
      bookmarks.push(newName ? { id, newName } : { id });
    }

    if (bookmarks.length > 0) {
      groups.push({ name, bookmarks });
      if (groups.length >= MAX_GROUPS) {
        break;
      }
    }
  }

  if (groups.length === 0) {
    throw new Error("AI 未返回有效的分组结果");
  }

  const folderTitle = typeof plan.folderTitle === "string" && plan.folderTitle.trim() ? plan.folderTitle.trim() : undefined;
  const summary = typeof plan.summary === "string" && plan.summary.trim() ? plan.summary.trim() : undefined;

  return {
    folderTitle,
    summary,
    groups,
  };
}

function extractJsonText(content: string): string {
  const trimmed = content.trim();
  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const candidate = fenceMatch[1]?.trim();
    const parsed = tryParseJson(candidate);
    if (parsed) {
      return parsed;
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    const parsed = tryParseJson(candidate);
    if (parsed) {
      return parsed;
    }
  }
  throw new Error("AI 返回内容无法解析为 JSON");
}

function tryParseJson(text: string | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (isJsonParsable(trimmed)) {
    return trimmed;
  }
  const repaired = tryRepairJson(trimmed);
  if (repaired && isJsonParsable(repaired)) {
    return repaired;
  }
  return null;
}

function isJsonParsable(candidate: string): boolean {
  try {
    JSON.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

function tryRepairJson(text: string): string | null {
  try {
    return jsonrepair(text);
  } catch {
    return null;
  }
}

function getUsageSummary(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const usage = (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
  if (!usage) {
    return undefined;
  }
  const { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens } = usage;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function createTimeoutController(ms: number): { signal: AbortSignal; dispose: () => void } | null {
  if (typeof AbortController === "undefined" || !Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const timeoutError = new Error("AI 请求超时");
    timeoutError.name = "TimeoutError";
    controller.abort(timeoutError);
  }, ms);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
    },
  };
}

function mergeAbortSignals(signals: Array<AbortSignal | undefined | null>):
  | { signal: AbortSignal; disconnect: () => void }
  | null {
  const valid = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (valid.length === 0) {
    return null;
  }
  if (valid.length === 1) {
    return { signal: valid[0], disconnect: () => undefined };
  }

  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  for (const signal of valid) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const listener = () => {
      controller.abort(signal.reason);
    };
    signal.addEventListener("abort", listener, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", listener));
  }

  const disconnect = () => {
    cleanups.forEach((cleanup) => cleanup());
  };

  if (controller.signal.aborted) {
    disconnect();
  }

  return { signal: controller.signal, disconnect };
}

function isAbortError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message ?? "";
  return error.name === "AbortError" || message.includes("The operation was aborted");
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal) {
    return;
  }
  if (signal.aborted) {
    const reason = signal.reason;
    if (reason instanceof Error) {
      throw reason;
    }
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    throw abortError;
  }
}
