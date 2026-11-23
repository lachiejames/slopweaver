/**
 * "Is CODEX capped" as a fact about the FLEET, not about whichever account this machine happens to export.
 *
 * `./quotaNow.ts` answers the question for ONE destination and is right to: a cap is a fact about an
 * account. Three readers then asked it about the AMBIENT destination and printed the answer as if it were
 * the fleet's — `codex status --check`, the landing gates (`./landingGateRun.ts`) and both fallback verbs
 * (`cli/commands/codex/fallbackReviewRun.ts`). With one registered account those two questions had the same
 * answer, which is why the conflation survived; with a second registered account they do not, and the
 * consequence is the exact failure the register was built to end — a session told "Codex is capped", taking
 * rule 9's fallback path, while a registered second account sat open.
 *
 * So the rule this module exists to hold: **a cap that a live destination can route around is not a cap.**
 * Evidence is reported only when NOTHING eligible remains, and a destination that CAN take a pass comes back
 * instead, named, so a caller spends it rather than reporting a refusal it did not have to take.
 *
 * ## Paused is still not refused
 *
 * A fleet whose every row is paused can take no pass and is NOT capped, so this returns no evidence for it.
 * That is the same distinction `./rank.ts` and `cmux/seatRoute.ts` draw and it matters here most of all: the
 * fallback verbs mint a Claude review receipt off cap evidence, and a pause is the owner's own standing
 * decision rather than a provider refusal — spending a fallback on one would record "Codex was capped" about
 * a fleet nobody asked. Signed-out is the same: a store nothing is signed into is a login away, never a cap.
 *
 * So are `usage-limit` and `not-measured` (`./fleetTypes.ts`): a row at the owner's own usage limit, or on a
 * monthly allowance nothing here reads, is held out by the owner's register setting. A fleet held out only by those is
 * unavailable, says so, and carries no {@link CodexFleetCap.capEvidence} — even when such a row's own quota also
 * refuses, since the row was out before its quota was asked.
 *
 * ## The routing pause licenses a fallback, never a cap
 *
 * A `near-cap` row (`./routingCapacity.ts`'s `pauseAtPercent` bar) is NOT one of the owner's settings and NOT a provider refusal: the
 * routing guard the owner set at about one percent left. A fleet nothing can route to, none refusing and at least one
 * row near-cap, carries {@link CodexFleetCap.routingPause} and still no `capEvidence`. MEASURED with every
 * account at 99% weekly: `codex review` had nowhere to go and both fallback verbs refused for want of a
 * cap, so a seat had no review route at all. Rule 9 says work never stops at the limit, so the fallback verbs take the pause as their ground (`./fallbackCap.ts`)
 * while `codex status` and the landing gates' cap witness keep reading provider refusal alone.
 *
 * ## Advisories: capacity the fleet is leaving on the table
 *
 * Measured: two accounts held a free usage-limit reset while every plan read as capped, and a
 * store with no sign-in ranked first. Neither is a cap, so they come back as {@link CodexFleetCap.advisories},
 * printed by every verb that prints the cap, whether or not the fleet is capped. A sign-in is the owner's; a reset is
 * the fleet's to redeem through `slopweaver codex reset` (`./resetConsume.ts`), and its line names that verb
 * and the soonest expiry so a held reset is spent before it lapses.
 */

import { parseIsoMs } from "#lib/date.js";

import { codexLoginCommand } from "../plans/login.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { plansForProvider } from "../plans/register.js";
import type { ReadCodexAccountsLive } from "./accountLive.js";
import type { CodexDestination } from "./destinations.js";
import type { CodexFleetCapPort } from "./fleetCapPort.js";
import { readCodexFleetSnapshot } from "./fleetRead.js";
import type { CodexFleetSnapshot, CodexPlanObservation, CodexPlanRanking, CodexRouteExclusion } from "./fleetTypes.js";
import { type CodexProviderUnregisteredEvidence, codexProviderUnregistered } from "./providerUnregistered.js";
import { mostRecentEvidence } from "./quotaGate.js";
import type { CodexQuotaEvidence } from "./quotaTypes.js";
import { rankCodexPlans } from "./rank.js";
import { soonestResetExpiry } from "./resetCreditsParse.js";
import type { CodexSignInPort } from "./signInPort.js";

/** A fleet nothing can route to because its rows sit at the routing pause — routing evidence, never a cap. */
interface CodexRoutingPause {
  /** The freshest gauge instant among the near-cap rows, the reading a reader can re-check. */
  readonly observedAtIso: string;
  /** Every excluded row with its kind and reason, near-cap or not, so no row is relabelled as capacity. */
  readonly why: string;
}

/** What the whole registered Codex fleet can do right now. */
export interface CodexFleetCap {
  /**
   * The destination a pass would spend, or undefined when nothing eligible remains. Present and
   * {@link capEvidence} absent are the same fact said twice, deliberately: a caller that only wants "may I
   * spend" reads one field and a caller that has to RENDER a refusal reads the other.
   */
  readonly destination: CodexDestination | undefined;
  /**
   * The exhaustion evidence a refusal stands on, and ONLY when every registered destination is unavailable
   * and at least one of them is refusing. Undefined whenever anything can still take a pass.
   */
  readonly capEvidence: CodexQuotaEvidence | undefined;
  /**
   * The fleet held out by the ROUTING PAUSE (the register's `pauseAtPercent`), and only when nothing can take a pass, nothing is refusing and
   * at least one row is `near-cap`. Not provider evidence, so never {@link capEvidence}: the landing gates' cap
   * witness and `codex status`'s `CAPPED:` line stay a provider refusal. The fallback verbs alone read it
   * (`./fallbackCap.ts`) — § The routing pause licenses a fallback, never a cap.
   */
  readonly routingPause: CodexRoutingPause | undefined;
  /**
   * The ADOPTED register carries no Codex row at all — `./providerUnregistered.ts`. Not capacity evidence of any
   * kind, so never {@link capEvidence} nor {@link routingPause}; the fallback verbs alone read it, as their own
   * ground. Undefined on an unreadable or derived register, and whenever any Codex row exists, paused or not.
   */
  readonly providerUnregistered: CodexProviderUnregisteredEvidence | undefined;
  /** One line naming what was read and what it concluded, for the verb that prints it. */
  readonly why: string;
  /** Capacity the fleet is leaving on the table — a login, a held reset, two homes on one account. Never a cap. */
  readonly advisories: readonly string[];
}

/**
 * Everything the live read found that is capacity and not a cap, in register order.
 *
 * A paused row is included on purpose: a pause is often "until this is signed in", and the login line is how
 * that pause ends. Two stores reporting one provider account id add no capacity, which the register's own
 * caveat says and this is the first place it can be SEEN.
 *
 * @param observations every registered Codex row's evidence, in register order
 * @returns one line per finding, empty when there is nothing for the owner to do
 */
export function codexFleetAdvisories({
  observations,
}: {
  observations: readonly CodexPlanObservation[];
}): readonly string[] {
  return [
    ...observations.flatMap((observation) => storeAdvisories({ observation })),
    ...sharedAccountAdvisories({ observations }),
  ];
}

/** What one store's own live answer leaves undone: a sign-in, or a free reset nobody has redeemed. */
function storeAdvisories({ observation }: { observation: CodexPlanObservation }): readonly string[] {
  const { destination, live } = observation;
  if (live.kind === "signed-out" || live.kind === "store-missing") {
    return [`${destination.alias}: not signed in — run ${codexLoginCommand({ codexHome: destination.codexHome })}`];
  }
  if (live.kind === "signed-in" && live.resetCreditsAvailable > 0) {
    const expiry = soonestResetExpiry({ credits: live.resetCreditsListed });
    const expiring = expiry === undefined ? "" : `, the soonest expiring ${expiry}`;
    return [
      `${destination.alias}: ${String(live.resetCreditsAvailable)} free usage-limit reset(s) held${expiring} — ` +
        `redeem one at a limit with slopweaver codex reset --plan ${destination.alias}`,
    ];
  }
  return [];
}

/** One line per provider account id that more than one store is signed into, naming those stores. */
function sharedAccountAdvisories({
  observations,
}: {
  observations: readonly CodexPlanObservation[];
}): readonly string[] {
  const aliasesByAccount = new Map<string, string[]>();
  for (const { destination, live } of observations) {
    if (live.kind !== "signed-in" || live.accountId === undefined) {
      continue;
    }
    const aliases = aliasesByAccount.get(live.accountId);
    if (aliases === undefined) {
      aliasesByAccount.set(live.accountId, [destination.alias]);
    } else {
      aliases.push(destination.alias);
    }
  }
  return [...aliasesByAccount.values()]
    .filter((aliases) => aliases.length > 1)
    .map((aliases) => `${aliases.join(", ")}: signed into the same account — two homes add no capacity`);
}

/** `alias: reason` for every destination currently refusing, in register order. */
function refusalClauses({ refusing }: { refusing: readonly CodexPlanObservation[] }): string {
  return refusing
    .map((observation) => {
      const { quota } = observation;
      const reason = quota.refuse ? quota.reason : "not refusing";
      return `${observation.destination.alias}: ${reason}`;
    })
    .join("; ");
}

/**
 * The exclusion kinds out before any quota is asked: the owner's own register settings, and a store nothing is signed into
 * (`./rank.ts` checks each ahead of the quota). A refusal on such a row is not the fleet's.
 */
const OUT_BEFORE_QUOTA_KINDS: ReadonlySet<CodexRouteExclusion["kind"]> = new Set<CodexRouteExclusion["kind"]>([
  "paused",
  "usage-limit",
  "not-measured",
  "signed-out",
]);

/**
 * The closing clause naming the rows held out by a usage limit or an unmeasured allowance, empty when none is —
 * so no reader of a fleet answer takes the owner's own setting for a provider's refusal.
 */
function ownerLimitNote({ ranking }: { ranking: CodexPlanRanking }): string {
  const held = ranking.excluded.filter((entry) => entry.kind === "usage-limit" || entry.kind === "not-measured");
  if (held.length === 0) {
    return "";
  }
  const aliases = held.map((entry) => entry.destination.alias).join(", ");
  return `; ${aliases} held out by the owner's own usage limit or an unmeasured allowance, which is not provider cap evidence`;
}

/** Why a fleet with nothing eligible is nonetheless not capped — nothing registered, or every row excluded for some other reason. */
function notCappedWhy({ ranking }: { ranking: CodexPlanRanking }): string {
  if (ranking.excluded.length === 0) {
    return "no Codex destination is registered, so nothing here has read a cap — `slopweaver plans list` shows what the register carries";
  }
  const clauses = ranking.excluded.map((entry) => `${entry.destination.alias} (${entry.kind}: ${entry.reason})`);
  return (
    `no Codex destination can take a pass and none of the ${String(ranking.excluded.length)} excluded is ` +
    `refusing, so this is not a cap — ${clauses.join("; ")}${ownerLimitNote({ ranking })}`
  );
}

/**
 * The routing pause a fleet with nothing eligible and nothing refusing is held by, or undefined when no row is
 * `near-cap` — § The routing pause licenses a fallback, never a cap.
 *
 * The instant is the freshest believable gauge among the near-cap rows. A ranking that names a row near-cap
 * whose observation carries no parseable gauge instant contributes none, and if no near-cap row has one the
 * answer is undefined rather than an invented instant: `./rank.ts` emits `near-cap` only off a believed gauge,
 * so that is a hand-built ranking, and failing closed refuses the fallback exactly as before.
 */
function routingPauseOf({
  observations,
  ranking,
}: {
  observations: readonly CodexPlanObservation[];
  ranking: CodexPlanRanking;
}): CodexRoutingPause | undefined {
  const nearCap = new Set(
    ranking.excluded.filter((entry) => entry.kind === "near-cap").map((entry) => entry.destination.alias),
  );
  let freshest: { readonly iso: string; readonly ms: number } | undefined;
  for (const observation of observations) {
    if (!nearCap.has(observation.destination.alias) || observation.gauge === undefined) {
      continue;
    }
    const iso = observation.gauge.observedAtIso;
    const ms = parseIsoMs({ tsIso: iso });
    if (ms !== undefined && (freshest === undefined || ms > freshest.ms)) {
      freshest = { iso, ms };
    }
  }
  if (freshest === undefined) {
    return undefined;
  }
  const clauses = ranking.excluded.map((entry) => `${entry.destination.alias} (${entry.kind}: ${entry.reason})`);
  return {
    observedAtIso: freshest.iso,
    why:
      `no Codex destination can take a pass and none is refusing; ${String(nearCap.size)} of ` +
      `${String(ranking.excluded.length)} excluded sit at the routing pause, which is not a provider cap — ` +
      `${clauses.join("; ")}`,
  };
}

/**
 * Decide what the fleet can do, from one snapshot's own ranking and observations.
 *
 * Pure, and the whole judgement: the effectful half is {@link currentCodexFleetCap}, which does nothing but
 * read the snapshot and hand it here.
 *
 * @param observations every registered Codex row's evidence, in register order
 * @param ranking what {@link rankCodexPlans} concluded over those same observations
 * @returns the destination to spend, or the evidence a refusal stands on
 */
export function decideCodexFleetCap({
  observations,
  ranking,
}: {
  observations: readonly CodexPlanObservation[];
  ranking: CodexPlanRanking;
}): CodexFleetCap {
  const advisories = codexFleetAdvisories({ observations });
  const chosen = ranking.ranked[0];
  if (chosen !== undefined) {
    return {
      advisories,
      capEvidence: undefined,
      destination: chosen,
      providerUnregistered: undefined,
      routingPause: undefined,
      why: `${chosen.alias} can take a pass — ranked first of ${String(ranking.ranked.length)} on ${ranking.basis}`,
    };
  }
  // A PAUSED row's refusal is not the fleet's: it is out by the owner's decision before its quota is asked (`./rank.ts`
  // checks paused first) — § Paused is still not refused. A row at its usage limit or not measured is out by the
  // owner's setting the same way, and a signed-out row is a login away: its cached exhaustion record would otherwise mint a
  // cap (and license a fallback) over a fleet held out only by a sign-in.
  const outBeforeQuota = new Set(
    ranking.excluded.filter((entry) => OUT_BEFORE_QUOTA_KINDS.has(entry.kind)).map((entry) => entry.destination.alias),
  );
  const refusing = observations.filter(
    (observation) =>
      observation.plan.paused === undefined &&
      !outBeforeQuota.has(observation.destination.alias) &&
      observation.quota.refuse,
  );
  if (refusing.length === 0) {
    return {
      advisories,
      capEvidence: undefined,
      destination: undefined,
      providerUnregistered: undefined,
      routingPause: routingPauseOf({ observations, ranking }),
      why: notCappedWhy({ ranking }),
    };
  }
  // The FRESHEST refusal across the fleet, by the same comparison one destination's own sources are merged
  // with (`./quotaGate.ts`). Any of them would justify the refusal; the most recently observed is the one a
  // reader can still check, and picking by register order would report a week-old record over a live one.
  const evidence = mostRecentEvidence({
    candidates: refusing.map((observation) => (observation.quota.refuse ? observation.quota.evidence : undefined)),
  });
  return {
    advisories,
    capEvidence: evidence,
    destination: undefined,
    providerUnregistered: undefined,
    // A provider refusal is the stronger ground and the one the receipt cites; a pause beside it adds nothing.
    routingPause: undefined,
    why:
      `all ${String(observations.length)} registered Codex destination(s) are unavailable and ` +
      `${String(refusing.length)} refusing — ${refusalClauses({ refusing })}${ownerLimitNote({ ranking })}`,
  };
}

/**
 * The same judgement over a snapshot that has already been read.
 *
 * Separate from {@link decideCodexFleetCap} only so a caller holding a snapshot — `codex route`, `codex
 * status` — pays for one read rather than two, which is the whole reason `./fleetRead.ts` captures a single
 * instant. It is also the one place the REGISTER itself is in hand, so the provider-unregistered ground is
 * judged here: from the register's own Codex rows and its source, never from the observation count.
 *
 * @param snapshot one read of the register and every destination's evidence
 * @returns the destination to spend, or the evidence a refusal stands on
 */
export function codexFleetCapFrom({ snapshot }: { snapshot: CodexFleetSnapshot }): CodexFleetCap {
  const verdict = decideCodexFleetCap({
    observations: snapshot.observations,
    ranking: rankCodexPlans({
      nowIso: snapshot.readAtIso,
      observations: snapshot.observations,
      thresholds: snapshot.thresholds,
    }),
  });
  return {
    ...verdict,
    providerUnregistered: codexProviderUnregistered({
      codexRows: plansForProvider({ plans: snapshot.register.plans, provider: "codex" }).length,
      readAtIso: snapshot.readAtIso,
    }),
  };
}

/**
 * Read the whole fleet once and decide what it can do — the shape the three cap readers take.
 *
 * An unreadable register comes back as "not capped, and here is why the read failed", never as a refusal:
 * `./quotaGate.ts`'s standing rule is that no evidence reads as healthy, and inventing a cap out of a failed
 * read would send a session down rule 9's fallback path over a decoding bug.
 *
 * @param home the state home holding the register and the cached exhaustion records
 * @param nowIso the instant every window reset is judged against, ISO-8601 — injected so a test fixes it
 * @param port where the register is read — `planRegisterPort()` at a composition root, a seam in a test
 * @param readLive the live account reader — the real one at a composition root, a fake in a test
 * @param fleetCap where the read's conclusion is filed — `codexFleetCapPort()` at a composition root, a seam in a test
 * @param signInPort where the read files each store's sign-in observation — `codexSignInPort()` at a composition
 *   root, a seam in a test
 * @returns the destination to spend, or the evidence a refusal stands on
 */
export async function currentCodexFleetCap({
  fleetCap,
  home,
  nowIso,
  port,
  readLive,
  signInPort,
}: {
  fleetCap: CodexFleetCapPort;
  home: string;
  nowIso: string;
  port: PlanRegisterPort;
  readLive: ReadCodexAccountsLive;
  signInPort: CodexSignInPort;
}): Promise<CodexFleetCap> {
  const snapshot = await readCodexFleetSnapshot({
    fleetCap,
    home,
    nowIso,
    port,
    readLive,
    signInPort,
  });
  if (snapshot.isErr()) {
    return {
      advisories: [],
      capEvidence: undefined,
      destination: undefined,
      providerUnregistered: undefined,
      routingPause: undefined,
      why: `the plan register could not be read (${snapshot.error.message}), and an unreadable register is not evidence of a cap`,
    };
  }
  return codexFleetCapFrom({ snapshot: snapshot.value });
}
