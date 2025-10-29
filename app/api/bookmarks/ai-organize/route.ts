import { NextResponse } from "next/server";
import type {
  AiOrganizeRequestPayload,
  AiPlanBookmark,
  AiPlanGroup,
  AiPlanResult,
  AiStrategyId,
} from "@/lib/bookmarks/ai";
import { getStrategyDisplayName } from "@/lib/bookmarks/ai";

const API_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL_NAME = "glm-4.5-air";
const MAX_GROUPS = 12;

const BASE_SYSTEM_PROMPT = `你是一名资深信息架构专家，负责根据用户提供的书签列表生成便于浏览的分类方案。\n\n请牢记以下规则：\n- 只能返回 JSON 文本，不允许输出额外的说明、前缀或代码块标记。\n- JSON 必须严格符合以下 TypeScript 类型定义：\n  type OrganizedFolderPlan = {\n    folderTitle?: string;\n    summary?: string;\n    groups: Array<{\n      name: string;\n      bookmarks: Array<{\n        id: string;\n        newName?: string;\n      }>;\n    }>;\n  };\n- groups 数量不要超过 12 个，每个 group 至少包含 1 个书签。\n- 不要虚构书签 ID，也不要遗漏输入中已经列出的书签。\n- 可选的 newName 字段用于提供更清晰或规范的名称，若无需修改可以省略。\n- 若某些书签不属于主要分组，可放入名为“其他收藏”的分组中。\n`;

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
  const digest = sanitizedBookmarks.map(formatBookmarkDigest).join("\n");
  const locale = typeof payload?.locale === "string" && payload.locale.trim() ? payload.locale.trim() : "zh-CN";

  const userPrompt = [
    `请依据“${strategyLabel}”策略整理以下 ${sanitizedBookmarks.length} 条书签。`,
    "务必将每个书签放入某个分组，可使用新名称提升可读性。",
    `输出语言保持 ${locale}，仅返回 JSON。`,
    "书签列表：",
    digest,
  ].join("\n\n");

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        temperature: 0.4,
        stream: false,
        messages: [
          { role: "system", content: `${BASE_SYSTEM_PROMPT}${STRATEGY_INSTRUCTIONS[strategy] ?? ""}` },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const payloadJson = await safeReadJson(response);
    if (!response.ok) {
      const reason = payloadJson && typeof payloadJson === "object" && "error" in payloadJson ? (payloadJson as { error?: string }).error : undefined;
      return NextResponse.json(
        { error: reason ?? `AI 接口请求失败（${response.status}）` },
        { status: response.status >= 400 ? response.status : 500 },
      );
    }

    const rawContent = extractCompletionContent(payloadJson);
    const plan = normalizePlan(rawContent);

    const usage = getUsageSummary(payloadJson);

    return NextResponse.json({ plan, rawContent, usage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "调用 AI 接口失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
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

function formatBookmarkDigest(bookmark: SanitizedBookmark, index: number): string {
  const parts = [`${index + 1}. [${bookmark.id}] 名称: ${bookmark.name}`];
  if (bookmark.domain) {
    parts.push(`域名: ${bookmark.domain}`);
  }
  if (bookmark.url) {
    parts.push(`链接: ${bookmark.url}`);
  }
  if (bookmark.parentFolderName) {
    parts.push(`上级目录: ${bookmark.parentFolderName}`);
  }
  if (bookmark.trail) {
    parts.push(`路径: ${bookmark.trail}`);
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
  } catch (error) {
    throw new Error("AI 返回内容不是合法的 JSON");
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("AI 返回结构不正确");
  }

  const plan = raw as Partial<AiPlanResult>;
  const groupsInput = Array.isArray(plan.groups) ? plan.groups : [];
  const groups: AiPlanGroup[] = [];

  for (const group of groupsInput) {
    if (!group || typeof group !== "object") continue;
    const name = typeof (group as { name?: unknown }).name === "string" ? (group as { name?: string }).name.trim() : "";
    if (!name) continue;

    const bookmarksInput = Array.isArray((group as { bookmarks?: unknown }).bookmarks)
      ? ((group as { bookmarks?: AiPlanBookmark[] }).bookmarks ?? [])
      : [];

    const bookmarks: AiPlanBookmark[] = [];
    const seen = new Set<string>();

    for (const bookmark of bookmarksInput) {
      if (!bookmark || typeof bookmark !== "object") continue;
      const id = typeof (bookmark as { id?: unknown }).id === "string" ? (bookmark as { id?: string }).id.trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const newName = typeof (bookmark as { newName?: unknown }).newName === "string" ? (bookmark as { newName?: string }).newName.trim() : undefined;
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
  try {
    JSON.parse(text);
    return text;
  } catch (error) {
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
