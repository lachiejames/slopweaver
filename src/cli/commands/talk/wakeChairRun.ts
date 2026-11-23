/**
 * `slopweaver talk wake-chair` — type the one quiet batch into the pinned chair once they have been quiet two minutes,
 * naming every stretch it has not read and every relay held for it. The console's transcript route runs it after every
 * batch carrying a finished stretch of their (`site/lib/talkCallAppend.ts`), where it mostly answers `holding`: they have
 * only just spoken, and the chair's courier (`./courierRun.ts`) types the batch once the two minutes pass. The decision
 * and the line are `src/talk/chairWake.ts`'s.
 *
 * A wake that could not be typed is not an error: the stretch is still in the call file, `tick-record` still refuses a
 * pass that has not read it, and the outcome is kept in `talk/chair-wake.json` and printed. Exit 1 is kept for a run
 * that could not tell whether anything was unread.
 */
import { realReachWaits } from "../../../cmux/reach.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { type ChairWakeOutcome, type ChairWakeReport, wakeChair } from "../../../talk/chairWakeShell.js";
import type { Delivery, DeliveryVia } from "../../../talk/deliveryOutcome.js";
import { processStartOf } from "../../../talk/relayLease.js";
import { deliverLineToSupervisor } from "../../../talk/supervisorDelivery.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { talkHomeOf } from "./args.js";
import { consoleWriteRefusal, resolveConsoleOrigin } from "./consoleOrigin.js";
import { TALK_WAKE_CHAIR_USAGE } from "./usage.js";
import { parseWakeChairArgs, type WakeChairArgs } from "./wakeChairArgs.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "wake-chair", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * What types a wake into the pinned chair over a live cmux connection — never a throw. `direct` is this verb, run by
 * the console; `courier` is the chair's own courier, which wakes it when cmux refused the console
 * (`./courierRun.ts`).
 *
 * @param via which process types it
 * @returns the typist
 */
export function chairDeliverer({ via }: { via: DeliveryVia }): (options: { line: string }) => Promise<Delivery> {
  return async ({ line }) => {
    const nowIso = (): string => new Date().toISOString();
    try {
      return await withCmuxSessionHost({
        body: ({ host }) => deliverLineToSupervisor({ client: host, line, nowIso, via, waits: realReachWaits() }),
      });
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : String(cause);
      return {
        atIso: nowIso(),
        detail: `cmux could not be reached: ${why}`,
        kind: "failed",
        refusal: "cmux-unreachable",
        via,
      };
    }
  };
}

/**
 * The one line a run's outcome is said in.
 *
 * @param outcome what the run did
 * @returns the line
 */
export function wakeChairLine({ outcome }: { outcome: ChairWakeOutcome }): string {
  switch (outcome.kind) {
    case "nothing-unread":
      return "talk wake-chair: nothing of theirs is unread and no relay is held — nothing typed";
    case "holding":
      return `talk wake-chair: their last word was at ${outcome.lastWordIso} — holding the quiet batch until ${outcome.untilIso}, nothing typed`;
    case "coalesced":
      return `talk wake-chair: the wake of ${outcome.pending.atIso} (${outcome.pending.delivery}) is still pending — nothing typed`;
    case "would-wake":
      return `talk wake-chair: would type: ${outcome.line}`;
    case "woke": {
      const unrecorded = outcome.unrecorded === undefined ? "" : ` (not recorded: ${outcome.unrecorded})`;
      const relays = outcome.carried.length === 0 ? "" : `, carrying ${String(outcome.carried.length)} held relay(s)`;
      const unsettled =
        outcome.unsettled.length === 0 ? "" : `; not recorded on a relay: ${outcome.unsettled.join("; ")}`;
      return `talk wake-chair: ${outcome.delivery.kind} — ${outcome.delivery.detail}${relays}${unrecorded}${unsettled}`;
    }
    default: {
      const never: never = outcome;
      return never;
    }
  }
}

/**
 * What a `--json` run also says on stderr: every failure its document carries — a request dropped from the queue, a
 * wake not recorded, a relay not settled — so a caller that keeps only stderr, as the console's background wake does,
 * never loses one. The plain run prints these on stdout already.
 *
 * @param report what the run did
 * @returns one line per failure, in the order the plain run prints them
 */
export function jsonFailures({ report }: { report: ChairWakeReport }): readonly string[] {
  const dropped = report.dropped.map((outcome) => `courier request ${outcome.turnId} dropped — ${outcome.detail}`);
  if (report.outcome.kind !== "woke") {
    return dropped;
  }
  const { unrecorded, unsettled } = report.outcome;
  return [
    ...dropped,
    ...(unrecorded === undefined ? [] : [`the wake was not recorded: ${unrecorded}`]),
    ...unsettled.map((why) => `a relay stays held for the next batch — ${why}`),
  ];
}

/**
 * The refusal for a console that is not their asking to type a wake into their chair, or `undefined` when it may go ahead:
 * no console asked, a dry run types nothing, the console is theirs, or the hatch is open. A foreign console's batch
 * never wakes the pinned chair, whatever unread stretch the home holds.
 *
 * @param args the parsed invocation
 * @param home the home whose calls the wake reads
 * @returns the four-line refusal, or `undefined`
 */
function wakeRefusal({ args, home }: { args: WakeChairArgs; home: string }): string | undefined {
  if (args.consoleOrigin === undefined) {
    return undefined;
  }
  return consoleWriteRefusal({
    handoverDir: resolveHandoverDir({ dir: undefined, home }),
    home,
    origin: resolveConsoleOrigin({ args: args.consoleOrigin }),
    typesIntoChair: !args.dryRun,
    verb: "talk wake-chair",
  });
}

/**
 * Run the `talk wake-chair` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkWakeChair(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_WAKE_CHAIR_USAGE });
    return EXIT_OK;
  }
  const parsed = parseWakeChairArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_WAKE_CHAIR_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const refusal = wakeRefusal({ args, home });
  if (refusal !== undefined) {
    logger.error({ msg: refusal });
    return EXIT_USAGE;
  }
  const { now } = args;
  const nowIso = (): string => (now === undefined ? new Date() : new Date(Date.parse(now))).toISOString();
  const woke = await wakeChair({
    deliver: chairDeliverer({ via: "direct" }),
    dryRun: args.dryRun,
    home,
    lock: { pid: process.pid, startOf: (pid) => processStartOf({ pid }) },
    nowIso,
  });
  if (woke.isErr()) {
    logger.error({ msg: `talk wake-chair: ${woke.error.message}` });
    return EXIT_ERROR;
  }
  // Said on stderr in both modes: a `--json` caller that reads only the document still sees it.
  if (woke.value.unreadable !== undefined) {
    logger.error({ msg: `talk wake-chair: the last wake was read as none — ${woke.value.unreadable}` });
  }
  if (args.json) {
    for (const why of jsonFailures({ report: woke.value })) {
      logger.error({ msg: `talk wake-chair: ${why}` });
    }
    logger.out({ line: safeJsonStringify({ label: "talk wake-chair", value: woke.value }) });
    return EXIT_OK;
  }
  for (const dropped of woke.value.dropped) {
    logger.out({ line: `talk wake-chair: courier request ${dropped.turnId} dropped — ${dropped.detail}` });
  }
  logger.out({ line: wakeChairLine({ outcome: woke.value.outcome }) });
  return EXIT_OK;
}

export const talkWakeChairCommand = defineCommand({ run: runTalkWakeChair });
