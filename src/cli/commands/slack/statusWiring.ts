/**
 * `slack status`'s seams and its door request, split out of `./statusRun.ts` so the shell stays one reviewable
 * file: the production wiring every effect goes through, and the request and gates the door judges a write by.
 */
import { logger } from "#lib/logger.js";
import { ok, type Result } from "#lib/result.js";
import { admitDoor } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { doorRefusalLines } from "../../../admit/doorRefusal.js";
import { type PainPointLane, recordExactVoicePainPoints } from "../../../admit/painPoint.js";
import type { DoorGate, DoorRequest } from "../../../admit/types.js";
import { NO_AUTHORED_PROSE, voiceProfileGate } from "../../../admit/voiceProfileGate.js";
import { slackUserToken } from "../../../config.js";
import { makeSlackProfileTransport } from "../../../corpus/slack/writeApi.js";
import type { SlackProfileTransport } from "../../../corpus/slack/writeApiProfile.js";
import { invalidDatadogHostRefusalLines } from "../../../outbound/invalidDatadogHost.js";
import type { ExactVoiceRule, ExactVoiceRuleFinding } from "../../../outbound/voice/exactRules.js";
import { type ProfileReadError, readExactVoiceRules } from "../../../profileStore.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import type { StatusProfilePlan } from "./statusCore.js";
import { slackVoiceGateInput } from "./voiceGateRead.js";

/** The injected seams. Each touches something real, so each is replaceable in a test without a mock. */
export interface StatusDeps {
  readonly userToken: (args: { home: string }) => string | undefined;
  /** The door ledger every status or presence write's decision is recorded through before it is performed. */
  readonly doorLedger: DoorLedgerPort;
  readonly profile: (args: { home: string; token: string }) => SlackProfileTransport;
  readonly now: () => number;
  readonly emit: (line: string) => void;
  /** The operator's exact voice rules, for the status text. */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  /** Record exact-rule matches as future-turn guidance; this observation never decides the write. */
  readonly recordVoicePainPoints: (args: {
    home: string;
    findings: readonly ExactVoiceRuleFinding[];
    lane: PainPointLane;
  }) => void;
  /** The environment the voice hatch is read from. */
  readonly env: () => Readonly<Record<string, string | undefined>>;
}

/**
 * The production wiring.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function liveStatusDeps(): StatusDeps {
  return {
    doorLedger: doorLedgerPort(),
    emit: (line) => {
      logger.out({ line });
    },
    env: () => process.env,
    now: () => Date.now(),
    profile: ({ home, token }) => makeSlackProfileTransport({ home, token }),
    recordVoicePainPoints: ({ findings, home, lane }) => {
      recordExactVoicePainPoints({ findings, home, lane, tsIso: new Date().toISOString() });
    },
    userToken: ({ home }) => slackUserToken({ home }),
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
  };
}

/**
 * The door request for a status or presence write. It records the shape of the change and never the text.
 *
 * @param operation which write this is
 * @param plan the status write, absent for a presence write
 * @param presence the presence being set, absent for a status write
 * @param home the state home whose ledger records the decision
 * @returns the request the door judges
 */
export function statusDoorRequest({
  operation,
  plan,
  presence,
  home,
}: {
  operation: "set" | "clear" | "presence";
  plan: StatusProfilePlan | undefined;
  presence: "away" | "auto" | undefined;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "status" },
    artifact: {
      actor: "me",
      operation,
      ...(plan === undefined
        ? {}
        : {
            emoji: plan.statusEmoji,
            expirationSeconds: plan.expirationSeconds,
            textChars: Array.from(plan.statusText).length,
          }),
      ...(presence === undefined ? {} : { presence }),
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}

/**
 * The voice gate over a status's text, which is their words shown to the whole workspace. A clear authors nothing.
 *
 * @param plan the status write whose text is judged
 * @param home the state home the voice rules and pain points live in
 * @param record whether to record rule matches as pain points; a dry run writes nothing
 * @returns the gates the door runs before the write, or why the profile holding the voice rules cannot be
 *   trusted; a clear reads no profile at all
 */
export function statusGates({
  deps,
  home,
  plan,
  record,
}: {
  deps: StatusDeps;
  home: string;
  plan: StatusProfilePlan;
  record: boolean;
}): Result<readonly DoorGate[], ProfileReadError> {
  if (plan.statusText === "") {
    return ok([voiceProfileGate(NO_AUTHORED_PROSE)]);
  }
  return slackVoiceGateInput({
    actor: "me",
    env: deps.env(),
    home,
    nowIso: new Date(deps.now()).toISOString(),
    prose: [{ path: "status_text", text: plan.statusText }],
    record,
    recordVoicePainPoints: deps.recordVoicePainPoints,
    voiceRules: deps.voiceRules,
  }).map((voice) => [voiceProfileGate(voice)]);
}

/**
 * A dry run's pre-flight: the same door decision the real run would reach, decided purely and recorded
 * nowhere, so a dry run never says "slopweaver would" about a write the door is going to refuse.
 *
 * @param gates the gates the real run would pass, built without recording
 * @param request the door request the real run would make
 * @returns the refusal exit when the door would not admit it, or undefined when it would
 */
export function dryRunDoorRefusal({
  deps,
  gates,
  request,
}: {
  deps: StatusDeps;
  gates: readonly DoorGate[];
  request: DoorRequest;
}): number | undefined {
  const decision = admitDoor({ env: deps.env(), gates, nowIso: new Date(deps.now()).toISOString(), request });
  if (decision.status === "pass") {
    return undefined;
  }
  logger.error({ msg: "DRY RUN — the real run would be refused:" });
  for (const line of doorRefusalLines({ command: "slopweaver slack status", decision })) {
    logger.error({ msg: line });
  }
  return EXIT_ERROR;
}

/**
 * The dead-Datadog-host refusal, judged on the same profile the write sends and before the door, so a dry run
 * refuses where the real run would and a real run says plainly that nothing was sent, rather than reading the
 * transport's throw as a write that may have landed.
 *
 * @param plan the status write whose profile is judged
 * @param dryRun whether this is a dry run, which says so above the refusal
 * @returns the refusal exit when the profile carries a dead host, or undefined when it may be sent
 */
export function deadHostRefusal({ dryRun, plan }: { dryRun: boolean; plan: StatusProfilePlan }): number | undefined {
  const lines = invalidDatadogHostRefusalLines({
    command: "slopweaver slack status",
    payload: {
      profile: {
        status_emoji: plan.statusEmoji,
        status_expiration: plan.expirationSeconds,
        status_text: plan.statusText,
      },
    },
  });
  if (lines === undefined) {
    return undefined;
  }
  const lead = dryRun ? "DRY RUN — the real run would be refused:" : "Nothing was sent; your status was not changed.";
  logger.error({ msg: lead });
  for (const line of lines) {
    logger.error({ msg: line });
  }
  return EXIT_ERROR;
}
