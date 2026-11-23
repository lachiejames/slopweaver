/**
 * WHERE the chair's successor boots, once the cadence (`./chairCadence.ts`) has said a hand-off is due: the
 * host whose plans can take it, read off the plan register, and the one spawn command that seats it.
 *
 * The owner's rule: one plan of
 * either provider runs all of Slopweaver, and on a one-plan install the chair hands off to a successor
 * on that same plan. Without this module the hand-off would print `cmux spawn <slug> --model fable` whatever the register held,
 * and `cmux spawn` defaults an omitted `--driver` to claude (`../cli/commands/cmux/core.ts`), so a Codex-only
 * install handed off onto Claude's ambient credential.
 *
 * ## The policy, in order
 *
 * 1. A register that cannot be read seats nothing — every spawn already fails closed on it.
 * 2. A DERIVED register (nothing adopted) with no Claude row boots Claude, as an unadopted install always has: it
 *    holds no Codex row either, since a Codex plan enters only by `plans add --provider codex` and never from a
 *    login found on the machine, so the chair stays on the Claude Code host the user runs. CONFIRMED by
 *    {@link ambientClaudeVerdict} against the spawn's own Claude-side read: only an UNCONFIGURED side boots ambient.
 * 3. The Fable route PICKS a Claude plan that is still seatable in this register → Claude. A one-plan install whose
 *    route still picks the chair's own plan hands off back onto it. An UNMEASURED route proves nothing: the spawn
 *    probes the very gauge the tick could not read, and refuses when none reads.
 *    Nor does a pick of a plan the register has since paused, which the spawn never probes: the alias must be one of the seatable rows.
 * 4. A REGISTERED install with an unpaused Codex plan, where no Claude plan is unpaused or the Fable route picks
 *    none → Codex, CONFIRMED by {@link codexSeatVerdict} against the live seat decision `cmux spawn --driver codex`
 *    itself makes (`decideCodexSeat`): a row at its usage limit, signed out or capped is only visible live, and a
 *    static read would print a spawn the same fleet refuses. A
 *    measured Fable wall is routed around onto the other provider, never waited out.
 * 5. Otherwise nothing can take it, and the reason is named.
 *
 * A plan "takes" the successor only when it is unpaused AND not `monthly-spend`: both providers' routing exclude a
 * monthly-spend row from every autonomous spawn — `../claude/select.ts` and `../codex/rank.ts`, sharing
 * `MONTHLY_SPEND_NOT_MEASURED` — so counting one would print a spawn the same register refuses and disarm the
 * sweep behind it.
 *
 * Both commands name `--driver` explicitly, so the omitted-driver default can never pick the host. A Codex
 * seat ignores a Claude tier (`../cmux/seatRoute.ts`), so its `--model` is the fleet's own Codex pin.
 *
 * Pure: the register read, the cadence's route and the live Codex seat decision in, the target out.
 */
import { CODEX_MODEL } from "../codex/profiles.js";
import type { Result } from "../lib/result.js";
import { shellCommandLine } from "../lib/shellCommandLine.js";
import type { PlanRegisterError } from "../plans/errors.js";
import { plansForProvider, unpausedPlansFor } from "../plans/register.js";
import type { PlanProvider, PlanRegisterSnapshot, RegisteredPlan } from "../plans/types.js";
import type { ChairCadenceRoute } from "./chairCadence.js";

/**
 * The host the successor boots on, or why no host can take it. A seatable target's `home` is the state home the
 * tick NAMED, when it named one: the register it was judged on, so the spawn reads that same register rather than
 * the ambient one.
 */
export type ChairSuccessorTarget =
  | { readonly kind: "claude"; readonly home?: string }
  | { readonly kind: "codex"; readonly home?: string }
  | { readonly kind: "none"; readonly why: string };

/** A target a spawn can be printed for. */
export type SeatableSuccessor = Exclude<ChairSuccessorTarget, { readonly kind: "none" }>;

/**
 * Which host the chair's successor boots on.
 *
 * @param register the plan register as this tick read it, or why it could not be
 * @param route which Claude plan the next Fable spawn routes to, as the cadence measured it
 * @returns Claude, Codex, or none with the reason
 */
export function chairSuccessorTarget({
  register,
  route,
}: {
  register: Result<PlanRegisterSnapshot, PlanRegisterError>;
  route: ChairCadenceRoute;
}): ChairSuccessorTarget {
  if (register.isErr()) {
    return {
      kind: "none",
      why: `the plan register could not be read, so no successor can be seated: ${register.error.message}`,
    };
  }
  if (ambientClaudeSuccessor({ register })) {
    return { kind: "claude" };
  }
  const snapshot = register.value;
  const claudeRows = plansForProvider({ plans: snapshot.plans, provider: "claude" });
  const claude = seatablePlans({ plans: snapshot.plans, provider: "claude" });
  const claudeTakes = route.kind === "picks" && claude.some((plan) => plan.alias === route.alias);
  if (claudeTakes) {
    return { kind: "claude" };
  }
  const codex = seatablePlans({ plans: snapshot.plans, provider: "codex" });
  if (snapshot.source === "registered" && codex.length > 0) {
    return { kind: "codex" };
  }
  return {
    kind: "none",
    why: noTargetWhy({ claudeRows: claudeRows.length, claudeSeatable: claude.length, route, snapshot }),
  };
}

/**
 * Whether the register's pick is policy step 2: an unadopted install with no Claude row, whose successor boots on
 * the ambient Claude credential — a pick only the live Claude-side read can confirm ({@link ambientClaudeVerdict}).
 *
 * @param register the plan register as this tick read it
 * @returns true only for a derived register carrying no Claude row
 */
export function ambientClaudeSuccessor({
  register,
}: {
  register: Result<PlanRegisterSnapshot, PlanRegisterError>;
}): boolean {
  if (register.isErr() || register.value.source !== "derived") {
    return false;
  }
  return plansForProvider({ plans: register.value.plans, provider: "claude" }).length === 0;
}

/**
 * An ambient Claude target as the spawn's own Claude-side read leaves it: still Claude when `cmux spawn --driver
 * claude` reads the side as unconfigured and boots on the ambient credential, else none naming why. A legacy
 * accounts file that is present but holds no account is configured-and-empty, and the spawn refuses it.
 *
 * @param claudeSide whether the spawn reads the Claude side as unconfigured, or why it could not be read
 * @returns Claude, or none naming why its ambient boot would be refused
 */
export function ambientClaudeVerdict({
  claudeSide,
}: {
  claudeSide: Result<"configured" | "unconfigured", string>;
}): ChairSuccessorTarget {
  if (claudeSide.isErr()) {
    return {
      kind: "none",
      why: `the Claude side could not be read, so no successor can be seated: ${claudeSide.error}`,
    };
  }
  if (claudeSide.value === "unconfigured") {
    return { kind: "claude" };
  }
  return {
    kind: "none",
    why:
      "nothing is adopted and no Claude plan is configured, yet a Claude accounts file is present, so " +
      "`cmux spawn --driver claude` would refuse rather than boot on the ambient credential — " +
      "`slopweaver plans adopt` registers a plan",
  };
}

/**
 * A Codex target as the live seat decision leaves it: still Codex when `cmux spawn --driver codex` would open the
 * seat, else none, carrying the refusal that spawn would print.
 *
 * @param seat the live Codex seat decision, or the line refusing it
 * @returns Codex, or none naming why its seat would not open
 */
export function codexSeatVerdict({ seat }: { seat: Result<unknown, string> }): ChairSuccessorTarget {
  if (seat.isOk()) {
    return { kind: "codex" };
  }
  return {
    kind: "none",
    why: `no Claude plan takes the successor, and \`cmux spawn --driver codex\` would not open its seat: ${seat.error}`,
  };
}

/**
 * One provider's plans that can take an autonomous spawn: unpaused, and not a monthly-spend row nothing measures.
 *
 * @param plans every registered row
 * @param provider which provider's rows to keep
 * @returns the rows routing could seat a successor on
 */
function seatablePlans({
  plans,
  provider,
}: {
  plans: readonly RegisteredPlan[];
  provider: PlanProvider;
}): readonly RegisteredPlan[] {
  return unpausedPlansFor({ plans, provider }).filter((plan) => plan.allowance.kind !== "monthly-spend");
}

/**
 * Why neither provider can take the successor.
 *
 * @param claudeRows how many Claude rows the register carries, paused or not
 * @param claudeSeatable how many of them can take an autonomous spawn
 * @param route the cadence's Fable route, which says whether the Claude half was unread or read as walled
 * @returns the sentence naming what is missing
 */
function noTargetWhy({
  claudeRows,
  claudeSeatable,
  route,
  snapshot,
}: {
  claudeRows: number;
  claudeSeatable: number;
  route: ChairCadenceRoute;
  snapshot: PlanRegisterSnapshot;
}): string {
  const codexRows = plansForProvider({ plans: snapshot.plans, provider: "codex" }).length;
  if (claudeSeatable > 0) {
    const codexPart =
      snapshot.source === "derived"
        ? "no Codex plan is registered (`slopweaver plans add --provider codex` registers one)"
        : `no registered Codex plan takes autonomous work (${String(codexRows)} registered; a paused or monthly-spend one takes none)`;
    let claudePart = "routing names no Claude plan that can take a Fable spawn";
    if (route.kind === "unmeasured") {
      claudePart =
        "this tick's Fable route is unmeasured, so no Claude plan is proven to take the spawn, which probes the gauge this tick could not read";
    }
    return `${claudePart}, and ${codexPart}`;
  }
  return (
    `no registered plan takes autonomous work (${String(claudeRows)} Claude, ${String(codexRows)} Codex, each ` +
    "paused or monthly-spend), so the fleet is stopped by its own register — `slopweaver plans resume` puts a paused one back"
  );
}

/**
 * The one command that seats the successor, as both the HAND OFF block and the hand-off prompt print it.
 *
 * @param slug the successor's handover slug, or a placeholder for it
 * @param target the host it boots on
 * @returns the `cmux spawn` command, with an explicit `--driver`, and `--home` when the tick named one
 */
export function successorSpawnLine({ slug, target }: { slug: string; target: SeatableSuccessor }): string {
  let line = `slopweaver cmux spawn ${slug} --driver claude --model fable`;
  if (target.kind === "codex") {
    line = `slopweaver cmux spawn ${slug} --driver codex --model ${CODEX_MODEL}`;
  }
  if (target.home === undefined) {
    return line;
  }
  return `${line} ${shellCommandLine({ command: ["--home", target.home] })}`;
}

/**
 * The target as the tick's spawn must print it: carrying the home the tick named, so the spawn routes against the
 * register the target was judged on.
 *
 * @param target the host the register picked
 * @param spawnHome the `--home` the tick was invoked with, absent for the ambient home
 * @returns the target, with that home on a seatable one
 */
export function targetOnHome({
  target,
  spawnHome,
}: {
  target: ChairSuccessorTarget;
  spawnHome: string | undefined;
}): ChairSuccessorTarget {
  if (target.kind === "none" || spawnHome === undefined) {
    return target;
  }
  return { home: spawnHome, kind: target.kind };
}
