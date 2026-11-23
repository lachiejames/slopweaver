/**
 * What each hosted session has spent in this run of the app, as pure functions the registry folds its events
 * through. No clock and no process: `sessionControl.ts` stamps the one read instant.
 *
 * Spend lands at each turn's END, because that is when both vendors report it: Claude's result, Codex's prompt
 * response. A worker sends that turn's own tokens, already differenced against any running total
 * (`sessionWorker/claudeUsage.ts`, `sessionWorker/codexUsage.ts`), so every turn here is ADDED, once, whichever vendor
 * ran it. A turn that ends with no readable report is counted as missing, so a total with a missing turn behind it
 * reads as a floor and never as complete. Codex's mid-turn context occupancy is kept beside spend and never added to
 * it. Nothing here persists: a restarted app starts every session's window again.
 */
import type { AppLaunchSpec, AppSessionSnapshot } from "./sessionControlProtocol";
import type { AppSessionTokens, AppSessionUsage, AppTurnUsage, AppUsageRate, AppUsageReport } from "./usageWire";

/** One session's usage as the registry holds it. */
export interface SessionUsageState {
  readonly planPath: string;
  readonly askedModel?: string;
  readonly resolvedModel?: string;
  readonly chargedModels: readonly string[];
  readonly total?: AppSessionTokens;
  readonly lastTurn?: { readonly atIso: string; readonly usage: AppTurnUsage };
  readonly reportedTurns: number;
  readonly partialTurns: number;
  readonly missingTurns: number;
  /** Whether a prompt was sent whose turn has not reported yet. */
  readonly turnOpen: boolean;
  /**
   * Whether the last turn was closed unreported and counted missing — a stop, a failure or the session going — so a
   * report the worker had already sent, arriving after, is THAT turn's and replaces its missing count, never adds a
   * second turn.
   */
  readonly closedUnreported: boolean;
  readonly readySinceIso?: string;
  readonly context?: { readonly usedTokens: number; readonly sizeTokens: number; readonly atIso: string };
}

const MS_PER_HOUR = 3_600_000;

/**
 * The store of the plan a launch spends, as the plans register names it. A Codex seat runs IN that store, its
 * `$CODEX_HOME`. A Claude seat on the store's own login does too. A Claude seat on a setup token runs against an
 * unbound store of its own, and the token file it reads sits in the plan's store (`src/claude/seatToken.ts`
 * `setupTokenPath`), so the plan is that file's directory.
 *
 * @param spec the launch
 * @returns the plan store's path, exactly as the launch spelled it
 */
export function planPathOf({ spec }: { spec: AppLaunchSpec }): string {
  if (spec.vendor === "codex") {
    return spec.codexHome;
  }
  const { credential } = spec;
  if (credential.kind === "store") {
    return credential.secureStorageDir;
  }
  return credential.tokenFilePath.slice(0, credential.tokenFilePath.lastIndexOf("/"));
}

/**
 * A session's usage before it has run anything.
 *
 * @param spec the launch it was prepared from, naming the plan's store and the model asked for
 * @returns no turns, no total, nothing charged
 */
export function usageOfSpec({ spec }: { spec: AppLaunchSpec }): SessionUsageState {
  return {
    chargedModels: [],
    closedUnreported: false,
    missingTurns: 0,
    partialTurns: 0,
    planPath: planPathOf({ spec }),
    reportedTurns: 0,
    turnOpen: false,
    ...(spec.model === undefined ? {} : { askedModel: spec.model }),
  };
}

/**
 * Two readings of the same vendor's tokens, summed category by category.
 *
 * @param left the running total
 * @param right the turn being added
 * @returns the sum, or `undefined` when the two are different vendors' and so have no sum
 */
export function addTokens({
  left,
  right,
}: {
  left: AppSessionTokens;
  right: AppSessionTokens;
}): AppSessionTokens | undefined {
  if (left.vendor === "claude" && right.vendor === "claude") {
    return {
      cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
      cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
      inputTokens: left.inputTokens + right.inputTokens,
      outputTokens: left.outputTokens + right.outputTokens,
      totalTokens: left.totalTokens + right.totalTokens,
      vendor: "claude",
    };
  }
  if (left.vendor === "codex" && right.vendor === "codex") {
    return {
      cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
      cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
      outputTokens: left.outputTokens + right.outputTokens,
      reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
      totalTokens: left.totalTokens + right.totalTokens,
      uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
      vendor: "codex",
    };
  }
  return undefined;
}

function withCharged({ known, more }: { known: readonly string[]; more: readonly string[] }): readonly string[] {
  const added = more.filter((model, index) => !known.includes(model) && more.indexOf(model) === index);
  return added.length === 0 ? known : [...known, ...added];
}

/**
 * A prompt was sent to the session: a turn is open until it reports.
 *
 * @param usage the session's usage before
 * @returns the same usage with a turn open
 */
export function usageOnPrompt({ usage }: { usage: SessionUsageState }): SessionUsageState {
  return { ...usage, closedUnreported: false, turnOpen: true };
}

/**
 * The session came up. The rate's window opens at the FIRST ready and never moves.
 *
 * @param usage the session's usage before
 * @param atIso when the ready report arrived
 * @returns the usage with its window open
 */
export function usageOnReady({ usage, atIso }: { usage: SessionUsageState; atIso: string }): SessionUsageState {
  return usage.readySinceIso === undefined ? { ...usage, readySinceIso: atIso } : usage;
}

/**
 * One turn's report arrived.
 *
 * @param usage the session's usage before
 * @param vendor the vendor running the session, which a report of another vendor's tokens contradicts
 * @param turn what the turn said it spent
 * @param atIso when the report arrived
 * @returns the usage with that turn counted once, or counted missing when it carried nothing readable. A report for a
 *   turn already closed unreported takes that turn's missing count over rather than counting a turn of its own.
 */
export function usageOnTurn({
  usage,
  vendor,
  turn,
  atIso,
}: {
  usage: SessionUsageState;
  vendor: AppSessionSnapshot["vendor"];
  turn: AppTurnUsage;
  atIso: string;
}): SessionUsageState {
  const closed = { ...usage, closedUnreported: false, turnOpen: false };
  // The turn this report is for was already counted missing when it closed: it stays missing or becomes reported.
  const missingBefore = usage.closedUnreported ? usage.missingTurns - 1 : usage.missingTurns;
  if (turn.kind !== "reported") {
    return { ...closed, lastTurn: { atIso, usage: turn }, missingTurns: missingBefore + 1 };
  }
  if (turn.tokens.vendor !== vendor) {
    const reason = `a ${vendor} session reported ${turn.tokens.vendor} tokens`;
    return {
      ...closed,
      lastTurn: { atIso, usage: { kind: "unreadable", reason } },
      missingTurns: missingBefore + 1,
    };
  }
  let total: AppSessionTokens = turn.tokens;
  if (usage.total !== undefined) {
    // Same vendor on both sides, checked just above, so the sum exists.
    total = addTokens({ left: usage.total, right: turn.tokens })!;
  }
  return {
    ...closed,
    chargedModels: withCharged({ known: usage.chargedModels, more: turn.chargedModels }),
    lastTurn: { atIso, usage: turn },
    missingTurns: missingBefore,
    partialTurns: usage.partialTurns + (turn.scope === "main-loop-only" ? 1 : 0),
    reportedTurns: usage.reportedTurns + 1,
    total,
  };
}

/**
 * A turn ended, failed or was cut off by the session going. A turn still open had no report, so it is missing.
 *
 * @param usage the session's usage before
 * @param atIso when it ended
 * @returns the usage with any unreported turn counted missing
 */
export function usageOnTurnClosed({ usage, atIso }: { usage: SessionUsageState; atIso: string }): SessionUsageState {
  if (!usage.turnOpen) {
    return usage;
  }
  return {
    ...usage,
    closedUnreported: true,
    lastTurn: { atIso, usage: { kind: "not-reported" } },
    missingTurns: usage.missingTurns + 1,
    turnOpen: false,
  };
}

/**
 * Whether a model the vendor named is the one asked for. A Claude tier alias (`opus`, `sonnet`) names every dated id
 * of that tier, which is what the SDK resolves it to; anything else must match exactly.
 *
 * @param asked the model the launch named
 * @param ran the model the vendor named
 * @returns true when `ran` is `asked`, or a model id of the tier `asked` names
 */
export function modelMatches({ asked, ran }: { asked: string; ran: string }): boolean {
  if (asked === ran) {
    return true;
  }
  const tierAlias = /^[a-z]+$/u.test(asked);
  return tierAlias && (ran === `claude-${asked}` || ran.startsWith(`claude-${asked}-`));
}

/**
 * Whether a session ran on a model it did not ask for.
 *
 * @param usage the session's usage
 * @returns true when the resolved model or any charged one is not the one asked for; false when none was asked
 */
export function modelMismatchOf({ usage }: { usage: SessionUsageState }): boolean {
  const { askedModel } = usage;
  if (askedModel === undefined) {
    return false;
  }
  const ran = usage.resolvedModel === undefined ? usage.chargedModels : [usage.resolvedModel, ...usage.chargedModels];
  return ran.some((model) => !modelMatches({ asked: askedModel, ran: model }));
}

/**
 * Tokens per hour since the session came up.
 *
 * @param usage the session's usage
 * @param atIso the read instant
 * @returns the rate, or which of its inputs is missing; never zero standing in for nothing, never a negative rate
 */
export function usageRateOf({ usage, atIso }: { usage: SessionUsageState; atIso: string }): AppUsageRate {
  if (usage.readySinceIso === undefined) {
    return { kind: "not-ready" };
  }
  const elapsedMs = Date.parse(atIso) - Date.parse(usage.readySinceIso);
  if (!(elapsedMs > 0)) {
    return { kind: "not-elapsed" };
  }
  if (usage.total === undefined) {
    return { kind: "not-reported" };
  }
  return { kind: "reported", totalTokensPerHour: (usage.total.totalTokens * MS_PER_HOUR) / elapsedMs };
}

/**
 * One session's usage as the socket reports it.
 *
 * @param snapshot the session's card
 * @param usage the session's usage
 * @param atIso the read instant
 * @returns the wire record
 */
export function sessionUsageOf({
  snapshot,
  usage,
  atIso,
}: {
  snapshot: AppSessionSnapshot;
  usage: SessionUsageState;
  atIso: string;
}): AppSessionUsage {
  const { askedModel, resolvedModel, total, lastTurn, readySinceIso, context } = usage;
  return {
    chargedModels: usage.chargedModels,
    ledgerKey: snapshot.ledgerKey,
    missingTurns: usage.missingTurns,
    modelMismatch: modelMismatchOf({ usage }),
    partialTurns: usage.partialTurns,
    planPath: usage.planPath,
    rate: usageRateOf({ atIso, usage }),
    reportedTurns: usage.reportedTurns,
    sessionId: snapshot.sessionId,
    state: snapshot.state,
    title: snapshot.title,
    turnOpen: usage.turnOpen,
    vendor: snapshot.vendor,
    ...(askedModel === undefined ? {} : { askedModel }),
    ...(resolvedModel === undefined ? {} : { resolvedModel }),
    ...(total === undefined ? {} : { total }),
    ...(lastTurn === undefined ? {} : { lastTurn }),
    ...(readySinceIso === undefined ? {} : { readySinceIso }),
    ...(context === undefined ? {} : { context }),
  };
}

/**
 * Every hosted session's usage, read at one instant: closed and failed sessions too, so a plan's total does not drop
 * when a session ends. Ordered by ledger key, then session id, so two reads of the same sessions print alike.
 *
 * @param entries each hosted session's card and usage
 * @param atIso the read instant
 * @returns the report
 */
export function usageReportOf({
  entries,
  atIso,
}: {
  entries: Iterable<{ readonly snapshot: AppSessionSnapshot; readonly usage: SessionUsageState }>;
  atIso: string;
}): AppUsageReport {
  const sessions = [...entries]
    .map(({ snapshot, usage }) => sessionUsageOf({ atIso, snapshot, usage }))
    .toSorted(
      (left, right) => left.ledgerKey.localeCompare(right.ledgerKey) || left.sessionId.localeCompare(right.sessionId),
    );
  return { atIso, sessions };
}
