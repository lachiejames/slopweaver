/**
 * `slopweaver talk courier` — the pinned chair's typist for the quiet batch (`../../../talk/chairWake.ts`): every few
 * seconds it asks whether the owner has been quiet two minutes with anything unread or held, and types the ONE line naming all
 * of it — the stretches they spoke and the relays the voice registered and holds for it (`../../../talk/relayCourier.ts`).
 * The chair starts `--follow` as a background task at boot (`skills/supervisor/SKILL.md`), and a sweep pass runs
 * `--once` as the backstop. It is no model and no daemon: it lives inside the chair's own visible session and stops
 * with it.
 *
 * It is also the typist a console started outside cmux has (`../../../talk/relayCourierStore.ts` is why): cmux refuses
 * that console's own `talk wake-chair`, and the courier, inside the chair, is never refused that way.
 *
 * It runs only in the pinned chair: `CMUX_WORKSPACE_ID`, which cmux exports into every surface it opens, must be the
 * one pinned supervisor's workspace. `system.identify` is not that check — it answers for the FOCUSED tab, not the
 * caller (`../../../cmux/client.ts`). The hook refuses the verb from every other session as well
 * (`../../../admit/cmuxSendSupervisorGuard.ts`).
 */
import { drainStdio } from "../../../lib/drainStdio.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { planRegisterPort } from "../../../plans/port.js";
import { listLiveCmuxWorkspaces } from "../../../sessionHarness/cmuxHost.js";
import { bootRefusalWakeReportLine, wakeChairForBootRefusal } from "../../../talk/bootRefusalWakeShell.js";
import { type ChairWakeReport, wakeChair } from "../../../talk/chairWakeShell.js";
import { recoversAtStart, reexecStampOf } from "../../../talk/courierFreshness.js";
import { type CourierOutcome, type CourierRecovery, recoverCourier } from "../../../talk/relayCourier.js";
import { processStartOf } from "../../../talk/relayLease.js";
import { supervisorTargetOf } from "../../../talk/supervisorDelivery.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { admitCourier, type CourierAdmission } from "./courierAdmission.js";
import { parseCourierArgs } from "./courierArgs.js";
import { courierFollower, processCourierFollowerDeps } from "./courierReexec.js";
import { TALK_COURIER_USAGE } from "./usage.js";
import { chairDeliverer } from "./wakeChairRun.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "courier", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * How often the follower asks whether a quiet batch is due. Each pass proves every call file's bytes before the
 * cursor are what was read and reads what lies past it, plus the held relays — a finished call's proof is kept
 * in-process while its stat does not move (`../../../talk/unreadPrefixCache.ts`), so a pass re-hashes only the call
 * still growing — so not every few hundred milliseconds; against the two-minute quiet it is the batch's whole added
 * latency.
 *
 * @internal
 */
export const COURIER_WAKE_EVERY_MS = 5_000;

/**
 * One line for one request: carried on a batch line, or dropped as no held relay.
 *
 * @internal
 * @param outcome what became of one request
 * @returns the line
 */
export function courierOutcomeLine({ outcome }: { outcome: CourierOutcome }): string {
  return `talk courier: ${outcome.turnId} ${outcome.kind} — ${outcome.detail}`;
}

/**
 * What the courier prints for one batch pass: every request dropped, then — only when a batch was typed — its
 * delivery, then every relay it carried and every one it could not record. A pass that typed nothing prints only what
 * it dropped, so a follower's routine `holding` or `coalesced` pass is silent — bar a last-wake record it could not
 * read, said first on every pass until a wake writes over it.
 *
 * @internal
 * @param report what the pass did
 * @returns the lines, none when nothing was typed or dropped and the record read
 */
export function courierWakeLines({ report }: { report: ChairWakeReport }): readonly string[] {
  const unreadable =
    report.unreadable === undefined ? [] : [`talk courier: the last wake was read as none — ${report.unreadable}`];
  const dropped = [...unreadable, ...report.dropped.map((outcome) => courierOutcomeLine({ outcome }))];
  const { outcome } = report;
  if (outcome.kind !== "woke") {
    return dropped;
  }
  const unrecorded = outcome.unrecorded === undefined ? "" : ` (not recorded: ${outcome.unrecorded})`;
  return [
    ...dropped,
    `talk courier: quiet batch ${outcome.delivery.kind} — ${outcome.delivery.detail}${unrecorded}`,
    ...outcome.carried.map((carried) => courierOutcomeLine({ outcome: carried })),
    ...outcome.unsettled.map((why) => `talk courier: a relay stays held for the next batch — ${why}`),
  ];
}

/**
 * One line for one recovery.
 *
 * @internal
 * @param recovery what recovery did with one request a stopped courier left
 * @returns the line
 */
export function courierRecoveryLine({ recovery }: { recovery: CourierRecovery }): string {
  if (recovery.kind === "requeued") {
    return `talk courier: ${recovery.turnId} requeued — a stopped courier took it and never claimed its delivery`;
  }
  return `talk courier: ${recovery.turnId} left untyped — a stopped courier had claimed its delivery, which may be a line already pasted; the row is on the board`;
}

/** One batch pass as the chair's courier. */
async function batchPass({ home }: { home: string }): Promise<Result<ChairWakeReport, string>> {
  const woke = await wakeChair({
    deliver: chairDeliverer({ via: "courier" }),
    dryRun: false,
    home,
    lock: { pid: process.pid, startOf: (pid) => processStartOf({ pid }) },
    nowIso: () => new Date().toISOString(),
  });
  return woke.mapErr((error) => `could not tell whether a quiet batch is due: ${error.message}`);
}

/**
 * Whether this process is the pinned chair's courier, by one cmux lookup.
 *
 * @returns admitted, refused, or undecided — cmux unreachable, or naming no pinned chair right now
 */
async function chairAdmission(): Promise<CourierAdmission> {
  const self = process.env["CMUX_WORKSPACE_ID"];
  if (self === undefined || self === "") {
    return {
      kind: "refused",
      why: "talk courier runs only inside the pinned supervisor chair, and this process has no CMUX_WORKSPACE_ID",
    };
  }
  try {
    const listed = await listLiveCmuxWorkspaces();
    if (listed.isErr()) {
      return {
        kind: "undecided",
        why: `talk courier could not list cmux workspaces to find the pinned chair: ${listed.error.message}`,
      };
    }
    const target = supervisorTargetOf({ workspaces: listed.value });
    if (target.kind === "none") {
      return { kind: "undecided", why: `talk courier types into the pinned chair, and ${target.why}` };
    }
    if (target.workspace.workspaceId !== self) {
      return {
        kind: "refused",
        why: `talk courier runs only inside the pinned supervisor chair (${target.workspace.workspaceRef}), and this is not it`,
      };
    }
    return { kind: "admitted" };
  } catch (cause) {
    return {
      kind: "undecided",
      why: `talk courier could not reach cmux: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/**
 * Wake the chair, once per open register card, when every new seat is refusing to boot (`../../../transcripts/bootRefusalWake.ts`
 * carries the measurement and the owner's rule), and print what it did. Never fails the pass.
 */
async function bootRefusalPass({ home }: { home: string }): Promise<void> {
  const outcome = await wakeChairForBootRefusal({
    deliver: chairDeliverer({ via: "courier" }),
    home,
    readRegister: () => planRegisterPort().read({ home }),
  });
  const line = bootRefusalWakeReportLine({ outcome });
  if (line !== undefined) {
    logger.out({ line });
  }
}

/** Recover what a stopped courier left, then run one batch pass. */
async function drainOnce({
  home,
}: {
  home: string;
}): Promise<Result<{ recoveries: CourierRecovery[]; report: ChairWakeReport }, string>> {
  const recovered = recoverCourier({ home });
  if (recovered.isErr()) {
    return err(recovered.error.message);
  }
  await bootRefusalPass({ home });
  const passed = await batchPass({ home });
  if (passed.isErr()) {
    return err(passed.error);
  }
  return ok({ recoveries: recovered.value, report: passed.value });
}

/** Recover what a stopped courier left, once, at a boot — never in an image a re-exec started. */
function recoverAtBoot({ home }: { home: string }): void {
  if (!recoversAtStart({ reexecAtIso: reexecStampOf({ env: process.env, pid: process.pid }) })) {
    return;
  }
  const recovered = recoverCourier({ home });
  if (recovered.isErr()) {
    logger.error({ msg: `talk courier: ${recovered.error.message}` });
    return;
  }
  for (const recovery of recovered.value) {
    logger.out({ line: courierRecoveryLine({ recovery }) });
  }
}

/**
 * Follow until stopped: recover once at boot (never in an image a re-exec started), then a batch pass every few seconds. A failed pass is said and retried. After
 * each pass the follower checks whether its own code is superseded, and re-executes in place into the main checkout
 * when it is (`./courierReexec.ts`) — never mid-pass, so no line is half typed.
 */
async function follow({ home }: { home: string }): Promise<never> {
  const freshness = courierFollower({
    deps: processCourierFollowerDeps({
      drain: () => drainStdio(),
      error: ({ line }) => {
        logger.error({ msg: line });
      },
      home,
      importMetaUrl: import.meta.url,
      out: ({ line }) => {
        logger.out({ line });
      },
    }),
  });
  recoverAtBoot({ home });
  logger.out({
    line: "talk courier: following — the owner's quiet batches are typed here, two minutes after their last word",
  });
  for (;;) {
    await bootRefusalPass({ home });
    const passed = await batchPass({ home });
    if (passed.isErr()) {
      logger.error({ msg: `talk courier: ${passed.error}` });
    } else {
      for (const line of courierWakeLines({ report: passed.value })) {
        logger.out({ line });
      }
    }
    await freshness.check();
    await new Promise((resolve) => setTimeout(resolve, COURIER_WAKE_EVERY_MS));
  }
}

/**
 * Run the `talk courier` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkCourier(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_COURIER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCourierArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_COURIER_USAGE });
    return EXIT_USAGE;
  }
  const refusal = await admitCourier({
    admit: chairAdmission,
    error: ({ line }) => {
      logger.error({ msg: line });
    },
    reexecAtIso: reexecStampOf({ env: process.env, pid: process.pid }),
    sleep: ({ ms }) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  if (refusal !== undefined) {
    logger.error({ msg: refusal });
    return EXIT_ERROR;
  }
  const home = talkHomeOf({ home: undefined });
  if (parsed.value.mode === "follow") {
    return follow({ home });
  }
  const drained = await drainOnce({ home });
  if (drained.isErr()) {
    logger.error({ msg: `talk courier: ${drained.error}` });
    return EXIT_ERROR;
  }
  if (parsed.value.json) {
    logger.out({ line: safeJsonStringify({ label: "talk courier", value: drained.value }) });
    return EXIT_OK;
  }
  const lines = [
    ...drained.value.recoveries.map((recovery) => courierRecoveryLine({ recovery })),
    ...courierWakeLines({ report: drained.value.report }),
  ];
  for (const line of lines) {
    logger.out({ line });
  }
  if (lines.length === 0) {
    logger.out({ line: `talk courier: no quiet batch typed — ${drained.value.report.outcome.kind}` });
  }
  return EXIT_OK;
}

export const talkCourierCommand = defineCommand({ run: runTalkCourier });
