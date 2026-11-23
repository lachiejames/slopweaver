/**
 * `slack dm open` — the effectful SHELL. Every decision is delegated to `./dmCore.ts`.
 *
 * The shortest of the three workspace-shape shells, and deliberately: `conversations.open` is idempotent by
 * Slack's own guarantee, so there is no reservation to take, no duplicate gate to consult and no partial
 * state to report. What is left is resolve → refuse → door → open → say which conversation it is.
 *
 * The one thing it must never do is guess. A DM opened with the wrong person is a notification a stranger
 * receives under this install's identity, and unlike a message it cannot be deleted from their side — so a
 * `--with` key nothing resolves refuses the whole open, exactly as an unresolvable mention refuses a send.
 */
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorRequest } from "../../../admit/types.js";
import { NO_AUTHORED_PROSE, voiceProfileGate } from "../../../admit/voiceProfileGate.js";
import { slackBotToken, slackUserToken, slopweaverHome } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import type { OpenedConversation } from "../../../corpus/slack/writeApiConversations.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { buildDmOpenPlan, type DmOpenPlan, dmOpenDryRunLines, dmOpenReportLines, parseDmArgs } from "./dmCore.js";
import { freshSlackIdsNow } from "./wiring.js";
import { argumentUsageExit, doorOutcome, usageExit } from "./workspaceShapeRun.js";
import { resolveSlackWriteToken } from "./writeToken.js";

/** The injected seams. Each touches something real, so each is replaceable in a test without a mock. */
export interface DmDeps {
  readonly botToken: (args: { home: string }) => string | undefined;
  readonly userToken: (args: { home: string }) => string | undefined;
  /** The door ledger the open's decision is recorded through before anything is performed. */
  readonly doorLedger: DoorLedgerPort;
  /** Identity-map key → Slack user id, EXACT matches only. A key nothing answers is simply absent. */
  readonly resolvePeople: (args: {
    home: string;
    people: readonly string[];
  }) => Promise<Result<ReadonlyMap<string, string>, IdentityRosterError>>;
  readonly openConversation: (args: {
    home: string;
    token: string;
    userIds: readonly string[];
  }) => Promise<OpenedConversation>;
  readonly emit: (line: string) => void;
}

/**
 * The production wiring.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function liveDmDeps(): DmDeps {
  return {
    botToken: ({ home }) => slackBotToken({ home }),
    doorLedger: doorLedgerPort(),
    emit: (line) => {
      logger.out({ line });
    },
    openConversation: async ({ home, token, userIds }) =>
      makeSlackWriteTransport({ home, token }).openConversation({ userIds }),
    resolvePeople: freshSlackIdsNow,
    userToken: ({ home }) => slackUserToken({ home }),
  };
}

/**
 * The door request for opening a conversation. The ledger records WHO by count and by id, never any prose —
 * there is none to record, which is what makes this the least sensitive of the three workspace-shape writes.
 *
 * @param plan the fully-decided open
 * @param home the state home whose ledger records the decision
 * @returns the request the door judges
 */
export function dmOpenDoorRequest({ plan, home }: { plan: DmOpenPlan; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "dm" },
    artifact: {
      actor: plan.actor,
      operation: "open",
      participantCount: plan.userIds.length,
      surface: plan.surface,
      userIds: plan.userIds,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}

/** Open the conversation and report it. Only ever called from inside the door's `perform`. */
async function openConversation({
  deps,
  home,
  plan,
  token,
}: {
  deps: DmDeps;
  home: string;
  plan: DmOpenPlan;
  token: string;
}): Promise<number> {
  let opened: OpenedConversation;
  try {
    opened = await deps.openConversation({ home, token, userIds: plan.userIds });
  } catch (error) {
    const message = errorMessage({ error });
    logger.error({ msg: `could not open that conversation: ${message}. Nothing was opened.` });
    if (message.includes("missing_scope")) {
      logger.error({
        msg:
          `opening a ${plan.surface === "direct-message" ? "DM needs im:write" : "group DM needs mpim:write"} on this ` +
          "lane. Check it with `slopweaver slack probe --method auth.test --scopes`.",
      });
    }
    return EXIT_ERROR;
  }
  for (const line of dmOpenReportLines({ alreadyExisted: opened.alreadyExisted, channelId: opened.id, plan })) {
    deps.emit(line);
  }
  return EXIT_OK;
}

/** Where the verb's own arguments start in `process.argv`: `[node, script, noun, verb, ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run `slack dm` against SUPPLIED dependencies.
 *
 * Exported so a test can drive the whole verb with plain fakes and assert that a refusal opens nothing.
 *
 * @param argv the full process argv
 * @param deps the injected dependencies
 * @returns the process exit code
 */
export async function runDmWithDeps({ argv, deps }: { argv: readonly string[]; deps: DmDeps }): Promise<number> {
  const options = parseDmArgs({ defaultHome: slopweaverHome(), rest: argv.slice(VERB_ARG_OFFSET) });
  if (options.isErr()) {
    return argumentUsageExit({ error: options.error });
  }
  const resolved = await deps.resolvePeople({ home: options.value.home, people: options.value.with });
  if (resolved.isErr()) {
    // A store the roster cannot be read from is a failure of fact, not of the caller's argv.
    logger.error({ msg: `${resolved.error.message}. Nothing was opened.` });
    return EXIT_ERROR;
  }
  const plan = buildDmOpenPlan({ options: options.value, resolved: resolved.value });
  if (plan.isErr()) {
    return usageExit({ errors: plan.error });
  }
  if (options.value.dryRun) {
    for (const line of dmOpenDryRunLines({ plan: plan.value })) {
      deps.emit(line);
    }
    return EXIT_OK;
  }
  const token = resolveSlackWriteToken({
    actor: options.value.actor,
    botToken: deps.botToken({ home: options.value.home }),
    userToken: deps.userToken({ home: options.value.home }),
  });
  if (token.isErr()) {
    return usageExit({ errors: [token.error.message] });
  }
  const routed = await throughDoor({
    // Opening a conversation authors no words at all — it names people. Stated with NO_AUTHORED_PROSE
    // rather than an empty list, so the door records a lane that was judged rather than one that was missed.
    gates: [voiceProfileGate(NO_AUTHORED_PROSE)],
    home: options.value.home,
    ledger: deps.doorLedger,
    perform: () => openConversation({ deps, home: options.value.home, plan: plan.value, token: token.value }),
    request: dmOpenDoorRequest({ home: options.value.home, plan: plan.value }),
  });
  return doorOutcome({ command: "slopweaver slack dm", nothingHappened: "nothing was opened.", routed });
}

/** `slopweaver slack dm` — open the DM or group DM for a set of people, through the door. */
export const slackDmCommand = defineCommand({ run: (argv) => runDmWithDeps({ argv, deps: liveDmDeps() }) });
