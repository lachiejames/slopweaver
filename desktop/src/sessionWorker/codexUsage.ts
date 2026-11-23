/**
 * A Codex session's model and spend, read off what the ACP adapter sends. Pure.
 *
 * Spend arrives ONCE per prompt, in the prompt response's `_meta.quota`: the pinned adapter's own extension
 * (`@agentclientprotocol/codex-acp` 2.5.0 `buildQuotaMeta`), which the ACP SDK types only as an open `_meta` record. So
 * this is the one module that reads it, strictly: an absent quota or a `null` count is a turn that reported nothing,
 * and a quota in any shape but the pinned one is UNREADABLE, said rather than read as zero. The count is the prompt's
 * own, so the app adds it once.
 *
 * The model the session runs on is the adapter's `model` config option at `session/new` or `session/resume`. Its
 * mid-turn `usage_update` is context occupancy (the last request's tokens against the window), never spend.
 */
import type { AppTurnUsage, CodexTokens } from "../usageWire";

/**
 * The fields of an ACP config option this module reads. Structural rather than the SDK's own type, so the module stays
 * typecheckable from the root project, which does not install the desktop's vendor packages; the SDK's
 * `SessionConfigOption` is assignable to it, so the worker passes the SDK's value straight in.
 */
interface ConfigOptionFields {
  readonly id: string;
  readonly type: string;
  readonly currentValue?: unknown;
}

/** The fields of an ACP session update this module reads; the SDK's `SessionUpdate` is assignable to it. */
interface SessionUpdateFields {
  readonly sessionUpdate: string;
  readonly used?: unknown;
  readonly size?: unknown;
}

const COUNT_KEYS = [
  "totalTokens",
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasExactly({ value, keys }: { value: Readonly<Record<string, unknown>>; keys: readonly string[] }): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function tokensOf({ value }: { value: unknown }): CodexTokens | undefined {
  if (!isRecord(value) || !hasExactly({ keys: COUNT_KEYS, value })) {
    return undefined;
  }
  const { totalTokens, inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens, reasoningOutputTokens } =
    value;
  if (
    !isCount(totalTokens) ||
    !isCount(inputTokens) ||
    !isCount(cachedInputTokens) ||
    !isCount(cacheWriteInputTokens) ||
    !isCount(outputTokens) ||
    !isCount(reasoningOutputTokens)
  ) {
    return undefined;
  }
  return {
    cacheWriteInputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    uncachedInputTokens: inputTokens,
    vendor: "codex",
  };
}

function modelsOf({ value }: { value: unknown }): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const models: string[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasExactly({ keys: ["model", "token_count"], value: entry }) ||
      typeof entry["model"] !== "string" ||
      entry["model"].length === 0 ||
      tokensOf({ value: entry["token_count"] }) === undefined
    ) {
      return undefined;
    }
    models.push(entry["model"]);
  }
  return models;
}

/**
 * What one prompt response says the turn spent.
 *
 * @param meta the response's `_meta`, as the ACP SDK passes it on
 * @returns the turn's tokens and charged models; `not-reported` when the adapter had no count; `unreadable`, naming
 *   what was wrong, for a quota in a shape the pinned adapter does not send
 */
export function codexTurnUsageOf({
  meta,
}: {
  meta: Readonly<Record<string, unknown>> | null | undefined;
}): AppTurnUsage {
  const quota = meta?.["quota"];
  if (quota === undefined) {
    return { kind: "not-reported" };
  }
  const unreadable = ({ what }: { what: string }): AppTurnUsage => ({
    kind: "unreadable",
    reason: `_meta.quota ${what}`,
  });
  if (!isRecord(quota) || !hasExactly({ keys: ["token_count", "model_usage"], value: quota })) {
    return unreadable({ what: "is not the adapter's { token_count, model_usage }" });
  }
  const chargedModels = modelsOf({ value: quota["model_usage"] });
  if (chargedModels === undefined) {
    return unreadable({ what: "carries a model_usage entry that is not { model, token_count }" });
  }
  if (quota["token_count"] === null) {
    return { kind: "not-reported" };
  }
  const tokens = tokensOf({ value: quota["token_count"] });
  if (tokens === undefined) {
    return unreadable({ what: "carries a token_count without the adapter's six whole counts" });
  }
  return { chargedModels, kind: "reported", scope: "comprehensive", tokens };
}

/**
 * The model a session opened or resumed on, from the adapter's config options.
 *
 * @param configOptions the options `session/new` or `session/resume` answered
 * @returns the `model` select option's current value, or `undefined` when the adapter named none
 */
export function resolvedModelOf({
  configOptions,
}: {
  configOptions: readonly ConfigOptionFields[] | null | undefined;
}): string | undefined {
  const option = configOptions?.find((each) => each.id === "model" && each.type === "select");
  if (option === undefined) {
    return undefined;
  }
  const { currentValue } = option;
  return typeof currentValue === "string" && currentValue.length > 0 ? currentValue : undefined;
}

/**
 * The context occupancy a session update carries, when it is the session's own.
 *
 * @param notificationSessionId the ACP session the notification names; a native subagent's is not the session's own
 * @param vendorSessionId the session the worker holds
 * @param update the update itself
 * @returns the tokens in context and the window's size, or `undefined` for any other update or another session's
 */
export function contextOccupancyOf({
  notificationSessionId,
  vendorSessionId,
  update,
}: {
  notificationSessionId: string;
  vendorSessionId: string;
  update: SessionUpdateFields;
}): { readonly usedTokens: number; readonly sizeTokens: number } | undefined {
  if (notificationSessionId !== vendorSessionId || update.sessionUpdate !== "usage_update") {
    return undefined;
  }
  const { used, size } = update;
  if (!isCount(used) || !isCount(size)) {
    return undefined;
  }
  return { sizeTokens: size, usedTokens: used };
}
