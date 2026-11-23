/**
 * What the `plans` verbs print — pure, so the whole human surface is asserted without a filesystem.
 *
 * ## The alias is a column here, and only here
 *
 * `src/plans/render.ts` deliberately renders no alias: a sentence the OWNER reads names the provider and the
 * account, never `plan-six`. This is the operator table, where the alias is the argument the next command
 * takes, so it is printed — and every line that would reach them instead goes through that module's renderers,
 * which is why the paused notices and diagnostics below are not re-worded here.
 *
 * Pure: rows in, lines out. No clock, no filesystem, no process exit.
 */
import type { CodexSubscriptionDates } from "../../../codex/subscriptionDates.js";
import type { CodexSubscriptionDatesError } from "../../../codex/subscriptionDatesErrors.js";
import type { Result } from "../../../lib/result.js";
import { type LaneShapeRead, laneShapeLine } from "../../../plans/laneShape.js";
import { type PlanPaidThrough, renderPlanLapse } from "../../../plans/lapse.js";
import { codexLoginInstruction } from "../../../plans/login.js";
import {
  pausedPlanNotice,
  registeredAccountCell,
  renderPlanAccount,
  renderPlanDiagnostic,
} from "../../../plans/render.js";
import type { PlanDiagnostic, PlanProvider, PlanRegisterSnapshot, RegisteredPlan } from "../../../plans/types.js";

import type { PlansRequest } from "./core.js";
import { thresholdListLines } from "./thresholdLines.js";

/**
 * The snapshot `list` prints, narrowed to one provider when `--provider` asked for it.
 *
 * The FILTER is applied to the printed view alone and never to the exit code's subject being wrong: a
 * `--provider codex` list of an install with no Codex row is legitimately empty, which is what `3` says.
 *
 * @param request what the command line asked for
 * @param snapshot the register as it was read
 * @returns the snapshot to print
 */
export function listedSnapshot({
  request,
  snapshot,
}: {
  request: PlansRequest;
  snapshot: PlanRegisterSnapshot;
}): PlanRegisterSnapshot {
  if (request.verb !== "list" || request.provider === undefined) {
    return snapshot;
  }
  const only = request.provider;
  return { ...snapshot, plans: snapshot.plans.filter((plan) => plan.provider === only) };
}

/** What a row's state column says when it is neither pinned nor paused: nothing, padded out by the caller. */
const NO_STATE = "";

/**
 * The state words one row carries, in a fixed order so two rows' columns line up.
 *
 * @param plan the registered row
 * @returns `pinned`, `PAUSED`, both, or the empty string
 */
function stateWords({ plan }: { plan: RegisteredPlan }): string {
  // A Codex pin decides nothing (`plans/types.ts` § pinned), so it is not shown as if it did.
  const pinned = plan.pinned === true && plan.provider === "claude";
  const words = [...(pinned ? ["pinned"] : []), ...(plan.paused === undefined ? [] : ["PAUSED"])];
  if (words.length === 0) {
    return NO_STATE;
  }
  return words.join("+");
}

/**
 * The usage-limit cell one row carries: what its allowance is measured in and the share the owner allows.
 *
 * A monthly-spend row never carries a percentage used: this table reads the register alone. A Claude one names where
 * its spend comes from — the hour-fresh reading `slopweaver claude spend` records, which routing judges it on — and a
 * Codex one says NOT MEASURED, because nothing reads a ChatGPT plan's flexible credits.
 *
 * @param plan the registered row
 * @returns such as `weekly-window limit 30%`, `monthly-spend limit 50% via claude spend`, or
 *   `monthly-spend limit 50% NOT MEASURED`
 */
function usageLimitCell({ plan }: { plan: RegisteredPlan }): string {
  const limit = `${plan.allowance.kind} limit ${String(plan.usageLimitPercent)}%`;
  if (plan.allowance.kind !== "monthly-spend") {
    return limit;
  }
  if (plan.provider === "claude") {
    return `${limit} via claude spend`;
  }
  return `${limit} NOT MEASURED`;
}

/** What the provider states about one Codex row's paid period, keyed by the row's alias. */
export interface PlanPaidThroughReading {
  readonly alias: string;
  readonly paidThrough: PlanPaidThrough;
}

/**
 * One Codex store's subscription-date read, as the lapse clause words it. A failure keeps only a short reason
 * naming the stage, never the path or a parser's text: the row already prints its store directory.
 *
 * @param read what `readCodexSubscriptionDates` answered for the row's store
 * @returns the stated dates, or `unread` with why
 */
export function codexPaidThrough({
  read,
}: {
  read: Result<CodexSubscriptionDates, CodexSubscriptionDatesError>;
}): PlanPaidThrough {
  if (read.isOk()) {
    return { kind: "stated", lastCheckedIso: read.value.lastCheckedIso, paidThroughIso: read.value.paidThroughIso };
  }
  const code = read.error.code;
  switch (code) {
    case "CODEX_SUBSCRIPTION_AUTH_UNREADABLE":
      return { kind: "unread", reason: "no sign-in file" };
    case "CODEX_SUBSCRIPTION_AUTH_INVALID":
      return { kind: "unread", reason: "sign-in file malformed" };
    case "CODEX_SUBSCRIPTION_ID_TOKEN_INVALID":
      return { kind: "unread", reason: "sign-in token undecodable" };
    case "CODEX_SUBSCRIPTION_CLAIMS_ABSENT":
      return { kind: "unread", reason: "sign-in states no subscription" };
    case "CODEX_SUBSCRIPTION_CLAIMS_INVALID":
      return { kind: "unread", reason: "subscription date malformed" };
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}

/**
 * One row of the operator table: its alias, its provider and account, its state, its usage limit, its store, and
 * when its paid subscription lapses — the provider-stated date where a Codex sign-in carries one, the recorded
 * lapse otherwise, and `lapse UNRECORDED` when nobody has said, so a missing date is visible rather than absent.
 *
 * Both column widths are MEASURED off the rows being printed rather than fixed. A fixed one is worse than no
 * alignment at all: the addresses here are real Claude account emails of very different lengths, so a
 * constant wide enough for the longest wastes a terminal line and one that is not silently un-aligns the
 * store column for exactly the rows a reader is comparing.
 *
 * @param aliasWidth the widest alias in the table
 * @param accountWidth the widest rendered account cell in the table
 * @param limitWidth the widest usage-limit cell in the table
 * @param paidThroughReadings what the provider states for each Codex row a reader asked about
 * @param plan the registered row
 * @returns the line
 */
function planRow({
  accountWidth,
  aliasWidth,
  limitWidth,
  paidThroughReadings,
  plan,
}: {
  accountWidth: number;
  aliasWidth: number;
  limitWidth: number;
  paidThroughReadings: readonly PlanPaidThroughReading[];
  plan: RegisteredPlan;
}): string {
  const account = renderPlanAccount({ account: registeredAccountCell({ plan }) });
  const state = stateWords({ plan });
  const limit = usageLimitCell({ plan });
  // Only a Codex row can carry a provider-stated date; a Claude alias is never looked up (`plans/lapse.ts`).
  const reading =
    plan.provider === "codex" ? paidThroughReadings.find((candidate) => candidate.alias === plan.alias) : undefined;
  const lapse = renderPlanLapse({ lapsesAtIso: plan.lapsesAtIso, paidThrough: reading?.paidThrough });
  return (
    `${plan.alias.padEnd(aliasWidth)}  ${account.padEnd(accountWidth)}  ${state.padEnd(6)}  ` +
    `${limit.padEnd(limitWidth)}  ${plan.storeDir} · ${lapse}`
  );
}

/**
 * Every diagnostic a read produced, tagged with its code.
 *
 * @param diagnostics what the read wants the reader told
 * @returns one line per diagnostic
 */
function diagnosticLines({ diagnostics }: { diagnostics: readonly PlanDiagnostic[] }): readonly string[] {
  return diagnostics.map((diagnostic) => renderPlanDiagnostic({ diagnostic }));
}

/**
 * The whole `plans list` view: the thresholds, the table, every paused row's own sentence, then the diagnostics.
 *
 * A paused row appears TWICE by design — once in the table, where a reader is scanning for a store directory,
 * and once as the sentence naming why and how to undo it. A pause nobody can see the reason for is the state
 * this register exists to make visible.
 *
 * @param paidThroughReadings what each shown Codex row's own sign-in states about its paid period
 * @param providers whose thresholds block to print — both, or the one `--provider` named
 * @param snapshot the register as it was read
 * @returns the lines, in print order
 */
export function planListLines({
  paidThroughReadings,
  providers,
  snapshot,
}: {
  paidThroughReadings: readonly PlanPaidThroughReading[];
  providers: readonly PlanProvider[];
  snapshot: PlanRegisterSnapshot;
}): readonly string[] {
  const thresholds = thresholdListLines({ providers, snapshot });
  if (snapshot.plans.length === 0) {
    return [
      ...thresholds,
      "plans list: this install has no registered destinations",
      ...diagnosticLines({ diagnostics: snapshot.diagnostics }),
    ];
  }
  const aliasWidth = Math.max(...snapshot.plans.map((plan) => plan.alias.length));
  const accountWidth = Math.max(
    ...snapshot.plans.map((plan) => renderPlanAccount({ account: registeredAccountCell({ plan }) }).length),
  );
  const limitWidth = Math.max(...snapshot.plans.map((plan) => usageLimitCell({ plan }).length));
  const notices = snapshot.plans
    .map((plan) => pausedPlanNotice({ plan }))
    .filter((notice): notice is string => notice !== undefined);
  return [
    ...thresholds,
    ...snapshot.plans.map((plan) => planRow({ accountWidth, aliasWidth, limitWidth, paidThroughReadings, plan })),
    ...notices,
    ...diagnosticLines({ diagnostics: snapshot.diagnostics }),
  ];
}

/**
 * The lane lines `plans list` prints under its table: whether each shown model host's lane fills or runs lean
 * (`../../../plans/laneShape.ts`), so the switch a lapse causes is visible before the supervisor acts on it.
 *
 * @param lanes the lanes judged from the WHOLE register, never the filtered view
 * @param hosts which model hosts the list shows, in print order
 * @returns one line per shown host, or the one line naming why the lanes could not be judged
 */
export function planLaneLines({
  lanes,
  hosts,
}: {
  lanes: LaneShapeRead;
  hosts: readonly PlanProvider[];
}): readonly string[] {
  if (lanes.kind === "unreadable") {
    return [`plans lanes: not judged — ${lanes.why}`];
  }
  return hosts.map((host) => laneShapeLine({ lane: lanes.shapes[host] }));
}

/**
 * The `plans validate` verdict: what the read found, and whether anything needs doing.
 *
 * @param snapshot the register as it was read
 * @returns the lines, in print order
 */
export function planValidateLines({ snapshot }: { snapshot: PlanRegisterSnapshot }): readonly string[] {
  const counted = `${String(snapshot.plans.length)} destination(s) registered, read from the ${snapshot.source} picture`;
  if (snapshot.diagnostics.length === 0) {
    return [counted, "plans validate: nothing to report"];
  }
  return [counted, ...diagnosticLines({ diagnostics: snapshot.diagnostics })];
}

/**
 * What a successful change prints: what it did, what the register now holds, and any next step it created.
 *
 * A newly registered CODEX destination gets the sign-in instruction in the same breath, because registering
 * one is exactly half the job: the row names a directory, and `codex login` against that directory is the
 * other half — a step only the owner's own terminal can take, so a verb that stayed silent about it would
 * leave a registered destination nothing can seat. Claude registration has no such step; its store is
 * provisioned by the Claude verbs.
 *
 * @param added the row this change registered, when it registered one
 * @param did the change in the past tense, such as `paused claude/plan-two`
 * @param snapshot the register as it was published
 * @returns the lines, in print order
 */
export function planChangeLines({
  added,
  did,
  snapshot,
}: {
  added?: RegisteredPlan;
  did: string;
  snapshot: PlanRegisterSnapshot;
}): readonly string[] {
  const signIn = added?.provider === "codex" ? [codexLoginInstruction({ codexHome: added.storeDir })] : [];
  return [
    `plans: ${did} — ${String(snapshot.plans.length)} destination(s) now registered`,
    ...signIn,
    ...diagnosticLines({ diagnostics: snapshot.diagnostics }),
  ];
}
