/**
 * The app session harness's usage wire: what each hosted session has spent in this run of the app, as the
 * control plane answers a `usage.read` and as a worker reports a turn's end. The session wire carrying it is
 * `sessionControlProtocol.ts` (the CLI's `appProtocol.ts`); the words both share are `wireBasics.ts`.
 *
 * Written ONCE and copied byte for byte, exactly as the session wire is: `desktop/src/usageWire.ts` is the canonical
 * copy and `src/sessionHarness/usageWire.ts` the mirror the CLI imports.
 * `desktop/__tests__/unit/sessionControlProtocolMirror.test.ts` fails the moment the two differ. So this file imports
 * only its mirrored sibling, under the one specifier both trees resolve.
 */
import {
  APP_SESSION_STATES,
  type AppHarnessVendor,
  type AppSessionState,
  hasOnlyKeys,
  hasOptionalStrings,
  hasStrings,
  isObject,
} from "./wireBasics.js";

/**
 * A Claude session's tokens, in the Agent SDK's own categories. They are disjoint, and output already holds thinking.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export interface ClaudeTokens {
  readonly vendor: "claude";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheWriteInputTokens: number;
  /** The four categories summed. */
  readonly totalTokens: number;
}

/**
 * A Codex session's tokens, in the ACP adapter's own categories.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export interface CodexTokens {
  readonly vendor: "codex";
  /** Input with the cached reads and cache writes taken out, as the adapter reports it. */
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  /** The adapter's own total, never rebuilt from the categories. */
  readonly totalTokens: number;
}

/**
 * One vendor's tokens. Never summed across vendors: the categories and the plans behind them differ.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppSessionTokens = ClaudeTokens | CodexTokens;

/**
 * What one turn's end said it spent. `main-loop-only` is a Claude turn counted without its subagent and compaction
 * calls: the first turn after a resume or a reset, whose cumulative report carries the transcript's history.
 * `unreadable` is a report that arrived in a shape this app does not know, said rather than read as nothing.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppTurnUsage =
  | {
      readonly kind: "reported";
      readonly scope: "comprehensive" | "main-loop-only";
      readonly tokens: AppSessionTokens;
      /** The models the vendor said it charged this turn to. */
      readonly chargedModels: readonly string[];
    }
  | { readonly kind: "not-reported" }
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * A session's tokens per hour since it came up, or why there is no rate yet.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppUsageRate =
  | { readonly kind: "not-ready" }
  | { readonly kind: "not-elapsed" }
  | { readonly kind: "not-reported" }
  | { readonly kind: "reported"; readonly totalTokensPerHour: number };

/**
 * One session's usage in this run of the app. Spend lands at each turn's end, when both vendors report it.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export interface AppSessionUsage {
  readonly sessionId: string;
  readonly ledgerKey: string;
  readonly title: string;
  readonly vendor: AppHarnessVendor;
  readonly state: AppSessionState;
  /** The plan's store the session spends: Codex's home, or the Claude login's secure storage directory. */
  readonly planPath: string;
  /** The model the launch asked for, when it pinned one. */
  readonly askedModel?: string;
  /** The model the vendor said the session runs on, when it said. */
  readonly resolvedModel?: string;
  /** Every model a turn was charged to, in the order first seen. */
  readonly chargedModels: readonly string[];
  /** Whether the resolved model or a charged one is not the one asked for. */
  readonly modelMismatch: boolean;
  /** Every reported turn's tokens summed; absent until a turn reports any. */
  readonly total?: AppSessionTokens;
  readonly lastTurn?: { readonly atIso: string; readonly usage: AppTurnUsage };
  /** Turns whose tokens were counted, of which `partialTurns` were counted main-loop only. */
  readonly reportedTurns: number;
  readonly partialTurns: number;
  /** Turns that ended with no readable report, so the total is a floor when this is above zero. */
  readonly missingTurns: number;
  /** Whether a turn is under way whose spend has not reported yet, so the total is a floor until it ends. */
  readonly turnOpen: boolean;
  readonly rate: AppUsageRate;
  /** When the session first came up: the rate's window opens here. */
  readonly readySinceIso?: string;
  /** Codex's latest context occupancy: how full the window is, which is not spend. */
  readonly context?: { readonly usedTokens: number; readonly sizeTokens: number; readonly atIso: string };
}

/** Every session this run of the app hosted, closed and failed ones included, read at one instant. */
export interface AppUsageReport {
  readonly atIso: string;
  readonly sessions: readonly AppSessionUsage[];
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasCounts({ value, keys }: { value: Readonly<Record<string, unknown>>; keys: readonly string[] }): boolean {
  return keys.every((key) => isCount(value[key]));
}

const CLAUDE_TOKEN_KEYS: readonly string[] = [
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheWriteInputTokens",
  "totalTokens",
];
const CODEX_TOKEN_KEYS: readonly string[] = [
  "uncachedInputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
];

/**
 * Whether a value is one vendor's tokens, carrying exactly that vendor's categories as whole non-negative counts.
 *
 * @param value anything parsed off the wire or a worker's report
 * @returns true for a Claude or a Codex token record
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isAppSessionTokens(value: unknown): value is AppSessionTokens {
  if (!isObject(value)) {
    return false;
  }
  let keys: readonly string[] | undefined;
  if (value["vendor"] === "claude") {
    keys = CLAUDE_TOKEN_KEYS;
  } else if (value["vendor"] === "codex") {
    keys = CODEX_TOKEN_KEYS;
  }
  return keys !== undefined && hasCounts({ keys, value }) && hasOnlyKeys({ keys: ["vendor", ...keys], value });
}

/**
 * Whether a value is what one turn's end said it spent.
 *
 * @param value anything parsed off the wire or a worker's report
 * @returns true for a reported, a not-reported or an unreadable turn
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isAppTurnUsage(value: unknown): value is AppTurnUsage {
  if (!isObject(value)) {
    return false;
  }
  if (value["kind"] === "not-reported") {
    return true;
  }
  if (value["kind"] === "unreadable") {
    return hasStrings({ keys: ["reason"], value });
  }
  const charged = value["chargedModels"];
  return (
    value["kind"] === "reported" &&
    (value["scope"] === "comprehensive" || value["scope"] === "main-loop-only") &&
    isAppSessionTokens(value["tokens"]) &&
    Array.isArray(charged) &&
    charged.every((model) => typeof model === "string")
  );
}

function isUsageRate(value: unknown): value is AppUsageRate {
  if (!isObject(value)) {
    return false;
  }
  if (value["kind"] === "reported") {
    const rate = value["totalTokensPerHour"];
    return typeof rate === "number" && Number.isFinite(rate) && rate >= 0;
  }
  return value["kind"] === "not-ready" || value["kind"] === "not-elapsed" || value["kind"] === "not-reported";
}

function isSessionUsage(value: unknown): value is AppSessionUsage {
  if (!isObject(value)) {
    return false;
  }
  const { chargedModels, total, lastTurn, context } = value;
  return (
    hasStrings({ keys: ["sessionId", "ledgerKey", "title", "planPath"], value }) &&
    (value["vendor"] === "codex" || value["vendor"] === "claude") &&
    typeof value["state"] === "string" &&
    APP_SESSION_STATES.has(value["state"]) &&
    hasOptionalStrings({ keys: ["askedModel", "resolvedModel", "readySinceIso"], value }) &&
    Array.isArray(chargedModels) &&
    chargedModels.every((model) => typeof model === "string") &&
    typeof value["modelMismatch"] === "boolean" &&
    typeof value["turnOpen"] === "boolean" &&
    (total === undefined || isAppSessionTokens(total)) &&
    (lastTurn === undefined ||
      (isObject(lastTurn) && hasStrings({ keys: ["atIso"], value: lastTurn }) && isAppTurnUsage(lastTurn["usage"]))) &&
    hasCounts({ keys: ["reportedTurns", "partialTurns", "missingTurns"], value }) &&
    isUsageRate(value["rate"]) &&
    (context === undefined ||
      (isObject(context) &&
        hasCounts({ keys: ["usedTokens", "sizeTokens"], value: context }) &&
        hasStrings({ keys: ["atIso"], value: context })))
  );
}

/**
 * Whether a value is a whole usage report, every session in it well formed.
 *
 * @param value the `report` of a `usage` answer
 * @returns true when the instant is a string and every session's usage is the shape this wire declares
 */
export function isAppUsageReport(value: unknown): value is AppUsageReport {
  if (!isObject(value) || !hasStrings({ keys: ["atIso"], value })) {
    return false;
  }
  const sessions = value["sessions"];
  return Array.isArray(sessions) && sessions.every((session) => isSessionUsage(session));
}
