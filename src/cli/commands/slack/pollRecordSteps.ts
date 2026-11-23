/**
 * `slack poll`'s two steps over the poll's LOCAL record: claiming it before Slack is asked anything, and finding
 * it again when the votes are read back. A leaf of `./pollRun.ts`, which owns the order they run in.
 */

import { logger } from "#lib/logger.js";
import {
  claimPollRecord,
  findPollByMessage,
  type PollRecord,
  readPollRecord,
} from "../../../outbound/slack/pollStore.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import type { PollPlan, PollResultsOptions } from "./pollCore.js";
import { pollRecordFor } from "./pollDoor.js";

/**
 * Claim the store, refusing the send on anything but a clean claim.
 *
 * `exists` is split: a record that already carries a `ts` is a poll that already went out, while one without
 * is a prior attempt whose outcome nobody ever learned — a different situation with a different remedy, so it
 * is never collapsed into one message.
 *
 * @returns `EXIT_OK` on a clean claim, otherwise the exit code the refusal it logged warrants
 */
export function claimOrRefuse({ home, plan, nowIso }: { home: string; plan: PollPlan; nowIso: string }): number {
  const claim = claimPollRecord({ home, record: pollRecordFor({ nowIso, plan }) });
  if (claim.kind === "claimed") {
    return EXIT_OK;
  }
  if (claim.kind === "failed") {
    logger.error({
      msg:
        `REFUSING to post: the poll record could not be written (${claim.reason}). A poll carries no Slack ` +
        "metadata, so without that record its results could never be read back. Nothing was sent.",
    });
    return EXIT_ERROR;
  }
  const existing = readPollRecord({ home, pollId: plan.pollId });
  if (existing.kind === "found" && existing.record.ts !== undefined) {
    logger.error({
      msg:
        `this exact poll was already posted to ${plan.channel} as ts ${existing.record.ts}. Read its votes with: ` +
        `slopweaver slack poll results --channel ${plan.channel} --ts ${existing.record.ts}`,
    });
    return EXIT_EXPECTED_EMPTY;
  }
  logger.error({
    msg:
      `a previous attempt at this exact poll claimed poll-id ${plan.pollId} but never confirmed a post, so ` +
      "whether it reached Slack is UNKNOWN. Check the channel: if nothing is there, delete " +
      `$SLOPWEAVER_HOME/ledgers/slack-polls/${plan.pollId}.json and re-run.`,
  });
  return EXIT_ERROR;
}

/**
 * Locate the poll's stored record, honouring the `--poll-id` repair locator.
 *
 * @returns the record when one is found, plus every record that could not be read on the way
 */
export function locateRecord({ options }: { options: PollResultsOptions }): {
  readonly record: PollRecord | undefined;
  readonly unreadable: readonly string[];
} {
  if (options.pollId === undefined) {
    return findPollByMessage({ channel: options.channel, home: options.home, ts: options.ts });
  }
  const read = readPollRecord({ home: options.home, pollId: options.pollId });
  if (read.kind === "found") {
    return { record: read.record, unreadable: [] };
  }
  return { record: undefined, unreadable: read.kind === "unreadable" ? [`${options.pollId}: ${read.reason}`] : [] };
}
