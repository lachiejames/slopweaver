/**
 * `slopweaver write vanta group-people [...]` — the write leg. Moves people into and out of ONE Vanta
 * group through the admit door.
 *
 * ## Why this verb exists
 *
 * A hand card once told the owner to open Vanta, find pages and click buttons to move
 * people out of the default entry group — the fleet does that, and the owner only provisions API keys and signs in.
 * Group membership is the lever that decides which policies a
 * person must accept, so a card asking for their hands here was a capability gap, not a policy.
 *
 * ## The one thing this verb cannot do, said here rather than discovered
 *
 * It cannot change WHICH documents a group assigns. The reviewed Manage API contract has no operation that
 * does — see `atlas/vanta/groupApiSchemas.ts` for exactly which operations were examined and how to
 * re-check them. That is an absence in this API and says nothing about where else such a change could be
 * made.
 *
 * ## Why `--dry-run` returns BEFORE the door
 *
 * A dry run performs no external write, so routing it would record a decision in the ledger for something
 * that never happened, and the ledger would over-count real mutations. It returns after resolving the exact
 * requests, and says so. This mirrors `deactivateRun.ts`, whose header states the same reasoning.
 *
 * ## The two legs are NOT a transaction, and the report says so
 *
 * `checkVantaGroupMembershipPlan` refuses a person named on both sides, so the legs always address disjoint
 * people and neither can undo the other. Additions go first. A leg whose outcome cannot be read stops the
 * run, and the later leg is recorded `not-attempted` rather than merged into a failure count — "it did not
 * happen" and "we do not know" are different things to tell an auditor, and after a timeout the second is
 * the true one. Nothing here rolls back, compensates or re-sends: recovery starts with a fresh read.
 *
 * ## What a passing ledger row does and does not prove
 *
 * `throughDoor` records the ADMISSION before it calls `perform` (`src/admit/effects.ts`). So a `pass` row
 * in the ledger proves the door allowed the write, never that Vanta made the change. The per-person
 * reconciliation below is the only thing that does.
 *
 * ## The exit-code contract
 *
 * | situation                                            | code |
 * | ---------------------------------------------------- | ---- |
 * | a bad flag, or a plan that could not be assembled    | `2`  |
 * | credentials genuinely not configured                 | `3`  |
 * | the door refused                                     | `1`  |
 * | any person refused, unconfirmed, or a leg unsent     | `1`  |
 * | a dry run, or a plan every person of which landed    | `0`  |
 */
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { vantaCredentialErrorsLines } from "../../../atlas/vanta/credentialErrors.js";
import {
  vantaGroupMembershipApprovalGate,
  vantaGroupMembershipDigest,
} from "../../../atlas/vanta/groupMembershipApproval.js";
import {
  checkVantaGroupMembershipPlan,
  createVantaGroupWriteClient,
  reconcileVantaGroupLeg,
  type VantaGroupDirection,
  type VantaGroupMembershipPlan,
  type VantaGroupWriteClient,
} from "../../../atlas/vanta/groupWriteClient.js";
import { resolveVantaWriteRequest } from "../../../atlas/vanta/writePreview.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { bindVanta } from "./binding.js";
import {
  exitCodeForVantaGroupPeople,
  parseVantaGroupPeopleOptions,
  renderVantaGroupPeopleDryRun,
  renderVantaGroupPeopleOutcome,
  VANTA_GROUP_PEOPLE_USAGE,
  type VantaGroupLegOutcome,
  type VantaGroupPeopleOptions,
  type VantaGroupPeopleReport,
  type VantaGroupResolvedLeg,
} from "./groupPeopleCore.js";

/** Where a `write vanta` verb sits: past the runtime, the script, the `write` noun and the `vanta` platform. */
const WRITE_VANTA_VERB_INDEX = 4;

/**
 * Resolve every leg this plan would send, in send order. An empty direction contributes no leg at all —
 * Vanta's own request body requires at least one update, so a leg for nobody is a request that would be
 * refused rather than a no-op.
 *
 * @param plan the checked plan
 * @returns the resolved legs, in the order they would be sent
 * @internal
 */
export function resolveVantaGroupLegs({ plan }: { plan: VantaGroupMembershipPlan }): readonly VantaGroupResolvedLeg[] {
  const legs: VantaGroupResolvedLeg[] = [];
  if (plan.add.length > 0) {
    legs.push({
      direction: "add",
      request: resolveVantaWriteRequest({
        input: { groupId: plan.groupId, updates: plan.add },
        kind: "add-people-to-group",
      }),
      updates: plan.add,
    });
  }
  if (plan.remove.length > 0) {
    legs.push({
      direction: "remove",
      request: resolveVantaWriteRequest({
        input: { groupId: plan.groupId, updates: plan.remove },
        kind: "remove-people-from-group",
      }),
      updates: plan.remove,
    });
  }
  return legs;
}

/** Print the resolved requests and change nothing. */
function reportDryRun({ base, plan }: { base: VantaGroupPeopleOptions; plan: VantaGroupMembershipPlan }): number {
  const legs = resolveVantaGroupLegs({ plan });
  const digest = vantaGroupMembershipDigest({ requests: legs.map((leg) => leg.request) });
  if (base.json) {
    logger.out({
      line: JSON.stringify(
        {
          approve: digest,
          groupId: plan.groupId,
          requests: legs.map((leg) => ({ direction: leg.direction, ...leg.request })),
          sent: false,
        },
        null,
        2,
      ),
    });
    return EXIT_OK;
  }
  for (const line of renderVantaGroupPeopleDryRun({ digest, groupId: plan.groupId, legs })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * The door request this write makes.
 *
 * The artifact carries the group and the person IDS in each direction and nothing else — the ledger is a
 * record that a write was admitted and about whom, not a copy of anybody's name or email.
 */
function groupPeopleDoorRequest({
  base,
  plan,
  digest,
}: {
  base: VantaGroupPeopleOptions;
  plan: VantaGroupMembershipPlan;
  digest: string;
}): Parameters<typeof throughDoor>[0]["request"] {
  return {
    action: { kind: "verb", noun: "write", verb: "vanta group-people" },
    artifact: {
      added: plan.add.map((update) => update.id),
      digest,
      group: plan.groupId,
      removed: plan.remove.map((update) => update.id),
    },
    meta: { createsWorkItem: false, effect: "external-write", home: base.home, requiresApproval: true },
  };
}

/** Send one leg and reconcile what came back against exactly the people it carried. */
async function sendLeg({
  client,
  leg,
  groupId,
}: {
  client: VantaGroupWriteClient;
  leg: VantaGroupResolvedLeg;
  groupId: string;
}): Promise<Result<VantaGroupLegOutcome>> {
  const requestedIds = leg.updates.map((update) => update.id);
  const call =
    leg.direction === "add"
      ? client.addPeopleToGroup({ groupId, updates: leg.updates })
      : client.removePeopleFromGroup({ groupId, updates: leg.updates });
  const answered = await call;
  if (answered.isErr()) {
    // NOT_DISPATCHED is not a softer UNREADABLE, it is the opposite claim: nothing left this machine, so
    // there is nothing at Vanta to go and read back. Reporting it as unconfirmed was the r1 defect.
    if (answered.error.code === "NOT_DISPATCHED") {
      return ok({
        because: `the ${leg.direction} leg was never sent: ${answered.error.message}`,
        direction: leg.direction,
        requestedIds,
        state: "not-attempted",
      });
    }
    return err(answered.error.problems);
  }
  const reconciled = reconcileVantaGroupLeg({
    direction: leg.direction,
    requestedIds,
    results: answered.value.results,
  });
  if (reconciled.isErr()) {
    return err(reconciled.error);
  }
  return ok({ state: "completed", summary: reconciled.value });
}

/** Why a leg that was planned never went out, named by the leg that stopped the run. */
function notAttemptedBecause({ blockedBy }: { blockedBy: VantaGroupDirection }): string {
  return `the ${blockedBy} leg did not complete, so this one was never sent — read the group back before approving again`;
}

/**
 * Run every leg of a checked plan in order, stopping at the first leg whose outcome cannot be read and
 * recording every later leg as unsent.
 *
 * Always returns a report: once the first request has gone out there is something true to say, and an
 * error value here would discard whatever the earlier leg already achieved.
 *
 * @param client the bound group write client
 * @param plan the checked plan
 * @returns what every leg did, in send order
 * @internal
 */
export async function performVantaGroupPlan({
  client,
  plan,
}: {
  client: VantaGroupWriteClient;
  plan: VantaGroupMembershipPlan;
}): Promise<VantaGroupPeopleReport> {
  const legs = resolveVantaGroupLegs({ plan });
  const outcomes: VantaGroupLegOutcome[] = [];
  let stoppedBy: VantaGroupDirection | null = null;
  for (const leg of legs) {
    const requestedIds = leg.updates.map((update) => update.id);
    if (stoppedBy !== null) {
      outcomes.push({
        because: notAttemptedBecause({ blockedBy: stoppedBy }),
        direction: leg.direction,
        requestedIds,
        state: "not-attempted",
      });
      continue;
    }
    const sent = await sendLeg({ client, groupId: plan.groupId, leg });
    if (sent.isErr()) {
      outcomes.push({ direction: leg.direction, problems: sent.error, requestedIds, state: "unconfirmed" });
      stoppedBy = leg.direction;
      continue;
    }
    outcomes.push(sent.value);
    // A leg that never went out stops the run too. Whatever prevented dispatch — a token this run could not
    // refresh is the measured case — is still in the way of the next leg, and trying it anyway would spend a
    // second failure to learn the same thing.
    if (sent.value.state === "not-attempted") {
      stoppedBy = leg.direction;
    }
  }
  return { groupId: plan.groupId, outcomes };
}

/**
 * The one seam this verb injects: how a bound write client is obtained.
 *
 * It exists so the door's refusal can be proved at the REAL command boundary — a test hands in a client
 * that records whether Vanta was reached, runs the verb with no `--approve`, and asserts it never was. The
 * alternative was a mock, which this repo's testing rule bans and which would have proved only that a
 * different function was not called.
 *
 * @internal
 */
export interface VantaGroupPeopleDeps {
  /** Bind credentials and build the write client, or report every reason it could not be built. */
  readonly createClient: (input: { base: VantaGroupPeopleOptions }) => Result<VantaGroupWriteClient>;
  /** The door ledger the plan's decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/** The production seam: resolve the credential pair the usual way and build the real HTTP client. */
const PRODUCTION_DEPS: VantaGroupPeopleDeps = {
  createClient: ({ base }) => {
    const bound = bindVanta({
      clientIdFile: base.clientIdFile,
      clientSecretFile: base.clientSecretFile,
      env: process.env,
      home: base.home,
    });
    return bound.isErr()
      ? err(vantaCredentialErrorsLines({ errors: bound.error }))
      : ok(createVantaGroupWriteClient(bound.value));
  },
  doorLedger: doorLedgerPort(),
};

/** Route the real plan through the door and report every arm of what came back. */
async function applyPlan({
  base,
  plan,
  deps,
}: {
  base: VantaGroupPeopleOptions;
  plan: VantaGroupMembershipPlan;
  deps: VantaGroupPeopleDeps;
}): Promise<number> {
  const bound = deps.createClient({ base });
  if (bound.isErr()) {
    bound.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const client = bound.value;
  const legs = resolveVantaGroupLegs({ plan });
  const digest = vantaGroupMembershipDigest({ requests: legs.map((leg) => leg.request) });
  const routed = await throughDoor({
    gates: [vantaGroupMembershipApprovalGate({ expected: digest, supplied: base.approve })],
    home: base.home,
    ledger: deps.doorLedger,
    perform: () => performVantaGroupPlan({ client, plan }),
    request: groupPeopleDoorRequest({ base, digest, plan }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({
      command: "slopweaver write vanta group-people",
      through: routed,
    })) {
      logger.error({ msg: line });
    }
    return EXIT_ERROR;
  }
  const report = routed.result;
  if (base.json) {
    logger.out({ line: JSON.stringify({ report, sent: true }, null, 2) });
  } else {
    for (const line of renderVantaGroupPeopleOutcome({ report })) {
      logger.out({ line });
    }
  }
  return exitCodeForVantaGroupPeople({ exitError: EXIT_ERROR, exitOk: EXIT_OK, report });
}

/**
 * Run the `write vanta group-people` verb against an injected provider seam.
 *
 * @param argv the full process argv (the verb tail starts after `write vanta group-people`)
 * @param deps how the write client is obtained
 * @returns the process exit code
 * @internal
 */
export async function runVantaGroupPeopleWith({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: VantaGroupPeopleDeps;
}): Promise<number> {
  const rest = verbTail({ argv, at: WRITE_VANTA_VERB_INDEX, verbs: ["group-people"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_GROUP_PEOPLE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVantaGroupPeopleOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: VANTA_GROUP_PEOPLE_USAGE });
    return EXIT_USAGE;
  }
  const { base, plan } = parsed.value;
  const checked = checkVantaGroupMembershipPlan({ plan });
  if (checked.isErr()) {
    checked.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_USAGE;
  }
  return base.dryRun ? reportDryRun({ base, plan: checked.value }) : applyPlan({ base, deps, plan: checked.value });
}

/**
 * Run the `write vanta group-people` verb against the real Vanta write client.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runVantaGroupPeople(argv: readonly string[]): Promise<number> {
  return runVantaGroupPeopleWith({ argv, deps: PRODUCTION_DEPS });
}
