/**
 * What the register refuses about its rows taken TOGETHER, once each row decodes on its own: a duplicate alias or
 * store within one provider, a monthly-spend store another plan names, more than one Claude pin or a paused one, and
 * a malformed `thresholds` or `removed` key beside the rows.
 *
 * Kept apart from `register.ts`, which decodes ONE row at a time, because these checks need the whole decoded list
 * and the document around it, and nothing here reads a single row's raw shape.
 */
import { posix } from "node:path";

import { removedProblems } from "./removed.js";
import { thresholdProblems } from "./thresholds.js";
import type { PlanProvider, RegisteredPlan } from "./types.js";

/**
 * Report every value appearing more than once within one provider's rows.
 *
 * @param label what a duplicate of these is called, for the message
 * @param picked each row's provider beside the field being compared
 * @returns one problem per duplicated value, scoped to its own provider
 */
function duplicatesWithinProvider({
  label,
  picked,
}: {
  label: string;
  picked: readonly { readonly provider: PlanProvider; readonly value: string }[];
}): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const entry of picked) {
    const key = `${entry.provider}\u0000${entry.value}`;
    if (seen.has(key)) {
      repeated.add(`two ${entry.provider} plans share the same ${label} \`${entry.value}\``);
    }
    seen.add(key);
  }
  return [...repeated];
}

/**
 * A store path in one lexical spelling: Unicode NFC, then `.` and `..` segments, repeated separators and a trailing
 * separator removed. Lexical only, on purpose: this is a pure decode, so aliasing only the filesystem can see (a
 * symlink, a case-folding volume) is out of its reach.
 *
 * @param storeDir the row's store path as written
 * @returns the path in that one spelling
 */
export function storeIdentity({ storeDir }: { storeDir: string }): string {
  const normalized = posix.normalize(storeDir.normalize("NFC"));
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * A monthly-spend plan whose store another plan names, of either provider and under any lexical spelling.
 *
 * `/tmp/shared` and `/tmp/shared/` name one directory, and a register that took them as two would let a weekly row
 * probe the store a monthly-spend row holds out of every probe.
 * A Codex row naming a Claude monthly-spend row's store would have its routing read probe that directory too,
 * so the provider is not part of the match. Only a monthly-spend row is judged this way:
 * weekly rows spelled apart, or shared across providers, were accepted before the allowance existed, and refusing
 * them now would turn a working register unreadable.
 *
 * A relative store resolves against whatever directory the reader runs in, so no lexical comparison can say which
 * directory `.` names. Once a register holds a monthly-spend row, every row's store must be
 * absolute; a register without one is judged exactly as before.
 *
 * @param plans the typed rows, in registered order
 * @returns one problem per relative store beside a monthly-spend row, and per monthly-spend store another plan names
 */
function monthlySpendStoreShared({ plans }: { plans: readonly RegisteredPlan[] }): readonly string[] {
  const monthlies = plans.filter((plan) => plan.allowance.kind === "monthly-spend");
  if (monthlies.length === 0) {
    return [];
  }
  const relative = plans
    .filter((plan) => !posix.isAbsolute(plan.storeDir))
    .map(
      (plan) =>
        `the ${plan.provider} plan \`${plan.alias}\` names a relative store \`${plan.storeDir}\` beside a ` +
        `monthly-spend plan; its directory depends on where the reader runs, so it cannot be shown apart from ` +
        `a store that is never probed`,
    );
  return [
    ...relative,
    ...monthlies.flatMap((monthly) => {
      const identity = storeIdentity({ storeDir: monthly.storeDir });
      const sharers = plans.filter(
        (other) => other !== monthly && storeIdentity({ storeDir: other.storeDir }) === identity,
      );
      return sharers.map(
        (other) =>
          `the monthly-spend ${monthly.provider} plan \`${monthly.alias}\` and the ${other.provider} plan ` +
          `\`${other.alias}\` name one store \`${identity}\`; a monthly-spend store is never probed, so no other ` +
          `plan may name it`,
      );
    }),
  ];
}

/**
 * Every problem with the rows taken together.
 *
 * @param plans the typed rows, in registered order
 * @returns every problem found across the rows
 */
function rowSetProblems({ plans }: { plans: readonly RegisteredPlan[] }): readonly string[] {
  const problems: string[] = [
    ...duplicatesWithinProvider({
      label: "alias",
      picked: plans.map((plan) => ({ provider: plan.provider, value: plan.alias })),
    }),
    ...duplicatesWithinProvider({
      label: "storeDir",
      picked: plans.map((plan) => ({ provider: plan.provider, value: plan.storeDir.normalize("NFC") })),
    }),
    ...monthlySpendStoreShared({ plans }),
  ];
  // Claude only: a Codex pin decides nothing (Codex has no pinned seat), so a legacy one on disk must never
  // refuse the register it sits in — pausing that row included.
  const pins = plans.filter((plan) => plan.provider === "claude" && plan.pinned === true);
  if (pins.length > 1) {
    problems.push(`${String(pins.length)} claude plans are marked pinned; at most one may be`);
  }
  const pausedPin = pins.find((plan) => plan.paused !== undefined);
  if (pausedPin !== undefined) {
    problems.push(
      `the pinned claude plan \`${pausedPin.alias}\` is paused; a pinned seat has nowhere to boot, ` +
        `so pin another plan or \`slopweaver plans unpin\` this one before pausing it`,
    );
  }
  return problems;
}

/**
 * Every problem with the register taken as a whole, once each row is individually usable.
 *
 * @param plans the typed rows, in registered order
 * @param document the decoded register document the rows came from
 * @returns every structural problem found, empty for a usable register
 */
export function structuralProblems({
  document,
  plans,
}: {
  document: Readonly<Record<string, unknown>>;
  plans: readonly RegisteredPlan[];
}): readonly string[] {
  return [...rowSetProblems({ plans }), ...thresholdProblems({ document }), ...removedProblems({ document })];
}
