/**
 * `refresh --source slack --coverage` — the reach report, and the refusal that gives it teeth.
 *
 * The atlas principle applied to Slack: every reachable endpoint touched and recorded. A report that only
 * PRINTED numbers would be a claim; this one exits non-zero while any reachable conversation has never been
 * crawled, so "coverage is complete" is a state the tool can be held to rather than a sentence someone wrote.
 *
 * The gap is computed against the per-channel backfill store (`corpus/.slack-channels.watermark.json`), not
 * against bronze row counts, and the difference matters in both directions. A channel that was crawled and
 * genuinely holds nothing has full coverage and no rows, so counting rows would report a permanent false gap;
 * a channel that has never been crawled has no entry, so its absence is the real signal even if some ancient
 * refresh happened to leave a row behind. Presence of an entry means "this conversation has been read to the
 * end at least once", which is exactly the claim coverage is about.
 *
 * Read-only by construction: it walks `conversations.list`, reads one local file, and writes nothing.
 */
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { readSlackChannelWatermarks } from "../../../corpus/slack/channelWatermark.js";
import { channelsFromPage, type SlackChannelRef } from "../../../corpus/slack/fetch.js";
import { SLACK_CONVERSATION_LANES, slackLaneLabel } from "../../../corpus/slack/lanes.js";
import {
  type ChannelReach,
  classifyChannelReach,
  coverageGaps,
  type ReachTally,
  tallyChannelReach,
} from "../../../corpus/slack/reach.js";
import { collectCursorPages } from "../../../lib/paging.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { RefreshDeps } from "./deps.js";

/** How many gap rows the report names before summarising the rest — a wall of 300 names is not a report. */
const GAP_PREVIEW = 40;

/**
 * The human label for one conversation in the report — its name when Slack gave one, else its id (a DM has
 * no name, and inventing one from the other party would put a person's identity in a coverage table). Pure.
 *
 * @param row the classified reach row
 * @returns the label to print
 */
export function reachLabel({ row }: { row: ChannelReach }): string {
  return row.name !== undefined ? `#${row.name}` : row.id;
}

/**
 * The report body: a per-kind tally, then the never-crawled conversations. Pure, so the exact wording is
 * asserted in a unit test rather than eyeballed in a terminal.
 *
 * @param rows every classified reach row
 * @returns the lines to print, in order
 */
export function slackCoverageLines({ rows }: { rows: readonly ChannelReach[] }): readonly string[] {
  const tallies: readonly ReachTally[] = tallyChannelReach({ rows });
  const gaps = coverageGaps({ rows });
  const lines = [
    `slack reach: ${String(rows.length)} conversation(s) the read token can list, ` +
      `${String(rows.length - gaps.length)} backfilled, ${String(gaps.length)} never crawled`,
    ...tallies.map(
      (tally) => `  ${tally.kind.padEnd(9)} ${String(tally.backfilled)}/${String(tally.reachable)} backfilled`,
    ),
    `  archived  ${String(rows.filter((row) => row.archived && !row.backfilled).length)} of ` +
      `${String(rows.filter((row) => row.archived).length)} archived conversation(s) never crawled`,
  ];
  if (gaps.length === 0) {
    return [...lines, "slack coverage: complete — every reachable conversation has been backfilled"];
  }
  return [
    ...lines,
    "",
    "never crawled (reachable, no backfill entry):",
    ...gaps
      .slice(0, GAP_PREVIEW)
      .map(
        (row) =>
          `  ${reachLabel({ row })} · ${row.kind}${row.archived ? " · archived" : ""}` +
          `${row.member ? "" : " · not a member"}`,
      ),
    ...(gaps.length > GAP_PREVIEW ? [`  … and ${String(gaps.length - GAP_PREVIEW)} more`] : []),
    "",
    `slack coverage: INCOMPLETE — ${String(gaps.length)} reachable conversation(s) have never been crawled; ` +
      "run `slopweaver refresh --source slack` to backfill them",
  ];
}

/**
 * Run the Slack reach report against the live workspace.
 *
 * @param home the Slopweaver home holding the per-channel backfill store
 * @param deps the refresh seams (the token read and the logger)
 * @returns `EXIT_OK` when every reachable conversation is backfilled, `EXIT_ERROR` while any is not, and
 *   `EXIT_USAGE` when no Slack read token is configured at all
 */
export async function runSlackCoverage({ home, deps }: { home: string; deps: RefreshDeps }): Promise<number> {
  const read = deps.slackReadToken();
  if (read.token === undefined) {
    deps.logger.error({ msg: "refresh --coverage: no Slack token — set SLACK_USER_TOKEN (or a bot token)" });
    return EXIT_USAGE;
  }
  if (read.warning !== undefined) {
    deps.logger.warn({ msg: read.warning });
  }
  const api = makeSlackApi({ token: read.token });
  const discovered: SlackChannelRef[] = [];
  try {
    // ONE walk per conversation lane. Slack serves no group DM while `public_channel` is in the same `types`
    // list, so a single combined walk left `group-dm 0/0` in the tally below — a whole conversation class
    // missing from the denominator, which is the exact dishonesty this verb exists to refuse. See
    // `SLACK_LANE_TYPES` in `corpus/slack/fetch.ts` for the measurement.
    for (const lane of SLACK_CONVERSATION_LANES) {
      const walk = await collectCursorPages({
        fetchPage: ({ cursor, pageSize }) =>
          api
            .listChannels({ lane, pageSize, ...(cursor !== undefined ? { cursor } : {}) })
            .then((page) => ({ items: channelsFromPage({ channels: page.channels }), nextCursor: page.nextCursor })),
      });
      if (walk.end.kind !== "exhausted") {
        // A truncated discovery walk makes the DENOMINATOR wrong, so every percentage below it would be
        // flattering. Refusing is the only honest answer: a coverage report that silently measured a prefix is
        // precisely the failure this whole verb exists to make impossible.
        deps.logger.error({
          msg: `refresh --coverage: ${slackLaneLabel({ lane })} ended ${walk.end.kind} — reach unknown`,
        });
        return EXIT_ERROR;
      }
      discovered.push(...walk.items);
    }
  } catch (error: unknown) {
    deps.logger.error({
      msg: `refresh --coverage: channel discovery failed: ${error instanceof Error ? error.message : "unknown"}`,
    });
    return EXIT_ERROR;
  }
  const rows = classifyChannelReach({ cursors: readSlackChannelWatermarks({ home }), discovered });
  slackCoverageLines({ rows }).forEach((line) => {
    deps.logger.out({ line });
  });
  return coverageGaps({ rows }).length === 0 ? EXIT_OK : EXIT_ERROR;
}
