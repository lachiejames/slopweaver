/**
 * The effectful half of `./ceilings.ts`: take every plan's reading in one pass, for `machine capacity`.
 *
 * - **Claude** — each unpaused weekly-window plan is probed once with `probePlan`, the one-token gauge probe
 *   `claude gauge` already sends, and its reading paired with the plan's usage limit; a paused plan is reported as
 *   paused and never asked; a monthly-spend plan is never probed either, and carries its spend verdict off the local
 *   readings ledger `slopweaver claude spend` writes (`../claude/spendBudgets.ts`).
 * - **Codex** — `readCodexFleetSnapshot` reads every registered destination's live budget and rollout log, and
 *   `assessCodexFleet` ranks them exactly as `codex route` does.
 *
 * No new model transport: both are the gauge reads the fleet already takes. A failed read becomes an
 * unreadable ceiling and a line in `problems`, never a thrown error, so a plan outage cannot fail the machine
 * report or wedge `machine capacity --wait`.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cachedAccountCell, probedAccountCell, renderAccountCell } from "../claude/accountBinding.js";
import { readAssertions } from "../claude/assertionStore.js";
import {
  type ClaudeAccount,
  type ClaudeAccountGauge,
  claudePlanGauge,
  probedClaudeAccount,
} from "../claude/contracts.js";
import type { ClaudeIdentityAssertion } from "../claude/identityAssertions.js";
import { probePlan } from "../claude/probeStore.js";
import { readClaudeFleet } from "../claude/spawnAccounts.js";
import { readClaudePlanSpends } from "../claude/spendBudgets.js";
import type { ClaudeSpendVerdict } from "../claude/spendPolicy.js";
import { codexLiveAccountText } from "../codex/accountDisplay.js";
import { readCodexAccountsLive } from "../codex/accountLive.js";
import { assessCodexFleet, type CodexFleetAssessment, type CodexFleetRow } from "../codex/fleetAssessment.js";
import { codexFleetCapPort } from "../codex/fleetCapPort.js";
import { readCodexFleetSnapshot } from "../codex/fleetRead.js";
import type { CodexRouteExclusion } from "../codex/fleetTypes.js";
import type { CodexWindowReading } from "../codex/gauge.js";
import { CODEX_MODEL } from "../codex/profiles.js";
import { codexSignInPort } from "../codex/signInPort.js";
import { planRegisterPort } from "../plans/port.js";
import { type ClaudeThresholds, DEFAULT_THRESHOLDS } from "../plans/thresholds.js";
import { lastReading } from "../readings/store.js";
import type { ClaudePlanInput, PausedWeekAtPause, PlanCeilingInputs } from "./ceilings.js";
import type { CodexPlanInput } from "./codexCeiling.js";
import { pausedWeekOf } from "./pausedWeek.js";

/**
 * One Claude probe as this read needs it: the reading or why there is none, and the organisation the provider
 * named, which is compared against the enrollment and dropped before anything is built from it.
 */
export type ClaudeCeilingProbe =
  | { readonly kind: "read"; readonly gauge: ClaudeAccountGauge; readonly observedOrganizationId?: string }
  | { readonly kind: "unreadable"; readonly problem: string; readonly observedOrganizationId?: string };

/** The reads, injectable so a unit test answers them with fixed values instead of a keychain and a network. */
export interface PlanCeilingDeps {
  /**
   * Every configured Claude plan, paused ones included, with the register's Claude thresholds off the same read —
   * or why the list could not be read.
   */
  readonly claudeAccounts: (args: {
    home: string;
  }) => Promise<{ readonly accounts: readonly ClaudeAccount[]; readonly thresholds: ClaudeThresholds } | string>;
  /** Every standing Claude enrollment, which decides what a probed plan's account may be called. */
  readonly claudeAssertions: (args: { home: string }) => readonly ClaudeIdentityAssertion[];
  /** One plan's probe, as `claude gauge` takes it. */
  readonly probe: (args: { alias: string; nowIso: string; storeDir: string }) => Promise<ClaudeCeilingProbe>;
  /** One monthly-spend plan's spend verdict at an instant, off the local readings ledger — never the provider. */
  readonly claudeSpend: (args: { account: ClaudeAccount; home: string; nowIso: string }) => ClaudeSpendVerdict;
  /** The Codex fleet, ranked, or why the register could not be read. */
  readonly codexFleet: (args: { home: string; nowIso: string }) => Promise<CodexFleetAssessment | string>;
  /**
   * The `machine capacity` document the readings ledger held at an instant — a paused plan's pause — or why there
   * is none.
   */
  readonly capacityDocumentAt: (args: {
    home: string;
    asOfIso: string;
  }) => { readonly kind: "read"; readonly document: unknown } | { readonly kind: "none"; readonly why: string };
}

/** The producer `supervisor tick-capture` files `machine capacity --json` under. */
const CAPACITY_PRODUCER = "machine capacity";

/**
 * One assessment's destinations as ceiling inputs: each row's windows, the ranker's exclusion, and the
 * destination it would route to.
 *
 * @param assessment what `assessCodexFleet` concluded
 * @returns the destinations in register order and the routed alias
 */
export function codexPlanInputsOf({
  assessment,
}: {
  // Only the fields read here, so a `CodexFleetAssessment` passes as-is and a test needs no whole fleet.
  assessment: {
    readonly ranking: {
      readonly ranked: readonly { readonly alias: string }[];
      readonly excluded: readonly (Pick<CodexRouteExclusion, "kind" | "reason"> & {
        readonly destination: { readonly alias: string };
      })[];
    };
    readonly rows: readonly (Pick<
      CodexFleetRow,
      "emailCached" | "liveEmail" | "liveState" | "resetCreditsAvailable" | "usageLimitPercent"
    > & {
      readonly alias: string;
      readonly gauge: {
        readonly windows: readonly Pick<CodexWindowReading, "label" | "resetAtIso" | "usedPercent">[];
      } | null;
    })[];
  };
}): { readonly codex: readonly CodexPlanInput[]; readonly codexRoutedAlias: string | null } {
  const exclusions = new Map(
    assessment.ranking.excluded.map((exclusion) => [
      exclusion.destination.alias,
      { kind: exclusion.kind, reason: exclusion.reason },
    ]),
  );
  const codex = assessment.rows.map((row): CodexPlanInput => {
    let exclusion: CodexPlanInput["exclusion"] = null;
    const excluded = exclusions.get(row.alias);
    if (excluded !== undefined) {
      exclusion = excluded;
    }
    return {
      account: codexLiveAccountText({ row }),
      alias: row.alias,
      exclusion,
      freeResets: row.resetCreditsAvailable,
      usageLimitPercent: row.usageLimitPercent,
      windows:
        row.gauge === null
          ? null
          : row.gauge.windows.map((window) => ({
              label: window.label,
              resetAtIso: unsetFieldAsNull({ key: "resetAtIso", record: window }),
              usedPercent: window.usedPercent,
            })),
    };
  });
  const routed = assessment.ranking.ranked[0];
  return { codex, codexRoutedAlias: routed === undefined ? null : routed.alias };
}

/**
 * The production reads: the plan register through the store port, `probePlan`, and the same fleet read `codex
 * route` takes. A composition root, so the one place here that names `planRegisterPort()`, `codexFleetCapPort()`
 * and `codexSignInPort()`.
 */
const productionPlanCeilingDeps: PlanCeilingDeps = {
  claudeAccounts: async ({ home }) => {
    // The routing gate's own source, so a ceiling is read for exactly the plans a spawn can be routed to.
    const fleet = await readClaudeFleet({ home, port: planRegisterPort() });
    if (fleet.isErr()) {
      return fleet.error.message;
    }
    const { accounts, thresholds } = fleet.value;
    if (accounts === undefined) {
      return { accounts: [], thresholds };
    }
    return { accounts, thresholds };
  },
  codexFleet: async ({ home, nowIso }) => {
    const snapshot = await readCodexFleetSnapshot({
      fleetCap: codexFleetCapPort(),
      home,
      nowIso,
      port: planRegisterPort(),
      readLive: readCodexAccountsLive,
      signInPort: codexSignInPort(),
    });
    if (snapshot.isErr()) {
      return snapshot.error.message;
    }
    return assessCodexFleet({ requestedModel: CODEX_MODEL, snapshot: snapshot.value });
  },
  claudeAssertions: ({ home }) => readAssertions({ home }),
  // `readClaudePlanSpends` answers one entry for every monthly-spend account it is handed, and this one is.
  claudeSpend: ({ account, home, nowIso }) => readClaudePlanSpends({ accounts: [account], home, nowIso })[0]!.verdict,
  capacityDocumentAt: ({ home, asOfIso }) => {
    const reading = lastReading({ asOfIso, home, producer: CAPACITY_PRODUCER });
    if (reading.isErr()) {
      return { kind: "none", why: reading.error.message };
    }
    return { document: reading.value.document, kind: "read" };
  },
  probe: async ({ alias, nowIso, storeDir }) => {
    const { outcome, organizationId } = await probePlan({ alias, nowIso, storeDir });
    const identity = organizationId === undefined ? {} : { observedOrganizationId: organizationId };
    if (outcome.gauge !== undefined) {
      return { gauge: outcome.gauge, kind: "read", ...identity };
    }
    let problem = "the probe returned no reading";
    if (outcome.problem !== undefined) {
      problem = outcome.problem;
    }
    return { kind: "unreadable", problem, ...identity };
  },
};

/**
 * One configured Claude plan's ceiling input: paused and never asked, a monthly-spend plan judged on its spend
 * reading, or probed — its account decided exactly as `claude gauge` decides it.
 *
 * @param account the configured plan
 * @param assertions every standing enrollment
 * @param probe the plan's probe, for an unpaused weekly-window plan
 * @param spend the plan's spend verdict, for an unpaused monthly-spend plan
 * @returns the input
 */
async function claudePlanInputOf({
  account,
  assertions,
  probe,
  spend,
  weekAtPause,
}: {
  account: ClaudeAccount;
  assertions: readonly ClaudeIdentityAssertion[];
  probe: () => Promise<ClaudeCeilingProbe>;
  spend: () => ClaudeSpendVerdict;
  weekAtPause: (args: { sinceIso: string }) => PausedWeekAtPause;
}): Promise<ClaudePlanInput> {
  if (account.paused !== undefined) {
    // Never probed, so config is all there is — and the cached cell says so.
    const cell = cachedAccountCell(account.email === undefined ? {} : { cachedEmail: account.email });
    const { sinceIso } = account.paused;
    return {
      account: renderAccountCell({ cell }),
      alias: account.alias,
      kind: "paused",
      pause: { sinceIso, weekAtPause: weekAtPause({ sinceIso }) },
      reason: account.paused.reason,
    };
  }
  if (!probedClaudeAccount({ account })) {
    // A monthly-spend plan's windows are not its allowance, so a probe would spend a token to measure nothing a route
    // reads: its spend verdict is what the spawn gate judges it on, and so what its ceiling is.
    const cell = cachedAccountCell(account.email === undefined ? {} : { cachedEmail: account.email });
    return { account: renderAccountCell({ cell }), alias: account.alias, kind: "spend", verdict: spend() };
  }
  const probed = await probe();
  const cell = probedAccountCell({
    account,
    assertions,
    ...(probed.observedOrganizationId === undefined ? {} : { observedOrganizationId: probed.observedOrganizationId }),
  });
  const rendered = renderAccountCell({ cell });
  if (probed.kind === "read") {
    return { account: rendered, gauge: claudePlanGauge({ account, gauge: probed.gauge }), kind: "read" };
  }
  return { account: rendered, alias: account.alias, kind: "unreadable", problem: probed.problem };
}

/**
 * Take every plan's reading: the Claude probes concurrently with each other, then the Codex fleet. A plan-level
 * failure is carried on its own ceiling; `problems` names only a provider whose whole list could not be read.
 *
 * @param home the Slopweaver home the account list and plan register live under
 * @param nowIso the instant the readings are taken at
 * @param deps the reads — production by default
 * @returns both providers' plan inputs, in configured order, and every read that failed
 */
export async function readPlanCeilings({
  home,
  nowIso,
  deps = productionPlanCeilingDeps,
}: {
  home: string;
  nowIso: string;
  deps?: PlanCeilingDeps;
}): Promise<PlanCeilingInputs> {
  const problems: string[] = [];
  const claudeRead = await deps.claudeAccounts({ home });
  let claudePlans: readonly ClaudePlanInput[] = [];
  // An unread register leaves no Claude plan to rank, so the defaults judge nothing there; named rather than implied.
  let claudeThresholds = DEFAULT_THRESHOLDS.claude;
  if (typeof claudeRead === "string") {
    problems.push(`claude: ${claudeRead}`);
  } else {
    const { accounts } = claudeRead;
    claudeThresholds = claudeRead.thresholds;
    // AWAITED before the Codex read, never overlapped with it: its live batch is synchronous, and MEASURED on this
    // machine a probe left in flight across it and the machine read timed out on all five plans
    // as "the probe request … could not be completed". Repro: start the probes, then call `codexFleet`.
    const assertions = deps.claudeAssertions({ home });
    claudePlans = await Promise.all(
      accounts.map((account) =>
        claudePlanInputOf({
          account,
          assertions,
          probe: () => deps.probe({ alias: account.alias, nowIso, storeDir: account.storeDir }),
          spend: () => deps.claudeSpend({ account, home, nowIso }),
          weekAtPause: ({ sinceIso }) => {
            const before = deps.capacityDocumentAt({ asOfIso: sinceIso, home });
            if (before.kind === "none") {
              return { kind: "unavailable", why: `no capacity reading before the pause: ${before.why}` };
            }
            return pausedWeekOf({ alias: account.alias, document: before.document });
          },
        }),
      ),
    );
  }
  const fleet = await deps.codexFleet({ home, nowIso });
  let codexPlans: ReturnType<typeof codexPlanInputsOf> = { codex: [], codexRoutedAlias: null };
  if (typeof fleet === "string") {
    problems.push(`codex: ${fleet}`);
  } else {
    codexPlans = codexPlanInputsOf({ assessment: fleet });
  }
  return { claude: claudePlans, claudeThresholds, ...codexPlans, problems };
}
