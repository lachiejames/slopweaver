/**
 * Pure argument handling and rendering for `slopweaver atlas slack`. Separated from the shell so the flag
 * surface and every line of output are unit-testable without a home directory, and so `helpTruth` can prove
 * `--help` names exactly what the parser accepts.
 */

import type { AtlasChannel, SlackAtlas, UnreadableWindow } from "../../../atlas/slack.js";
import { membershipUnknown, neverLookedAt, unreadable } from "../../../atlas/slack.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** Every flag this verb accepts; the help-truth ratchet checks the names derived from it below. */
const ATLAS_SLACK_FLAGS: FlagSpec = {
  boolean: ["json", "unreadable", "never-read"],
  string: ["home"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const ATLAS_SLACK_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: ATLAS_SLACK_FLAGS }),
  ...stringFlagsOf({ spec: ATLAS_SLACK_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The resolved invocation. */
export interface AtlasSlackOptions {
  readonly json: boolean;
  readonly neverRead: boolean;
  readonly unreadable: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `atlas slack`
 * @returns the resolved options, or `err` with every usage problem found
 */
export function parseAtlasSlackArgs({ rest }: { rest: readonly string[] }): Result<AtlasSlackOptions> {
  const parsed = parseFlags({ args: rest, spec: ATLAS_SLACK_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const home = typeof values["home"] === "string" ? values["home"] : undefined;
  return ok({
    home,
    json: values["json"] === true,
    neverRead: values["never-read"] === true,
    unreadable: values["unreadable"] === true,
  });
}

/**
 * One channel as a single line: id, whether it can be read, how far it has been read, and its name.
 *
 * The name comes LAST because it is the only variable-width field, so the columns before it stay aligned
 * across a list of hundreds of rows.
 *
 * @param channel the atlas channel
 * @returns the line
 */
function channelLine({ channel }: { channel: AtlasChannel }): string {
  let state: string;
  if (channel.isMember) {
    state = "JOINED    ";
  } else if (channel.readable) {
    state = "readable  ";
  } else {
    state = "unreadable";
  }
  const seen = channel.coverage.kind === "read-to" ? `read-to ${channel.coverage.ts}` : "never read".padEnd(24);
  return `  ${channel.id.padEnd(12)} ${state.padEnd(12)} ${seen.padEnd(24)} ${channelName({ channel })}`;
}

/** A channel's name, or `(unnamed)` for a conversation the capture recorded no name for. */
function channelName({ channel }: { channel: AtlasChannel }): string {
  const name = channel.name;
  if (name === undefined) {
    return "(unnamed)";
  }
  return name;
}

/**
 * The huddle census block, or nothing when the corpus holds no huddles.
 *
 * THREE numbers rather than two, and the third is the point: "names a transcript" is a pointer count and
 * "words in bronze" is a readability claim, and they are no longer the same number. A huddle's notes carry a
 * transcript FILE ID whose bytes Slack still serves only to a browser session; the WORDS arrive inline on
 * `files.info` and the refresh stores them, so a huddle can name a transcript this corpus does not hold —
 * bronze written before the lane existed, or a call that failed. Printing only the pointer count would be
 * the kind of true-number-misleading-reader this file already guards against elsewhere.
 *
 * @param census the huddle counts
 * @returns the lines to append, empty when nothing has been ingested
 */
function huddleLines({ census }: { census: SlackAtlas["huddles"] }): readonly string[] {
  if (census.total === 0) {
    return [];
  }
  const window =
    census.earliestIso !== undefined && census.latestIso !== undefined
      ? `  window                   : ${census.earliestIso} → ${census.latestIso}`
      : undefined;
  return [
    `  huddles ingested         : ${String(census.total)}`,
    `    …naming a transcript   : ${String(census.withTranscript)}  <- \`slopweaver slack read-file <id>\` reads one`,
    `    …words in the corpus   : ${String(census.withWords)}  <- searchable by \`slopweaver store read\`/\`store cite\``,
    `    …with none generated   : ${String(census.withoutTranscript)}`,
    ...(window !== undefined ? [window] : []),
  ];
}

/**
 * The block naming every bronze window the scan could not read, or nothing when it read them all.
 *
 * This exists because its absence used to be the defect. `atlas slack` printed a census over the two window
 * files it could read and silently dropped a multi-gigabyte compacted one that held nearly all of the corpus, so
 * hundreds of conversations were judged against a few megabytes of bronze and nothing in the output said so. An honesty verb may
 * not report a census computed over a subset it did not name, and every figure above this block — the
 * huddle counts and the coverage counts alike — is computed over exactly that subset when it fires.
 *
 * It NAMES the shortfall rather than refusing the whole report, because what the scan did read is still
 * true of what it read, and a home with one truncated window would otherwise lose the `--never-read` list
 * it came for. What it may not do is print those numbers unlabelled.
 *
 * @param shortfall the windows the bronze scan could not read
 * @returns the lines to append, empty when every window was read
 */
function shortfallLines({ shortfall }: { shortfall: readonly UnreadableWindow[] }): readonly string[] {
  if (shortfall.length === 0) {
    return [];
  }
  return [
    "",
    `SHORTFALL: ${String(shortfall.length)} bronze window(s) could NOT be read, so every count above is`,
    "computed over the rest of the corpus and understates it. Treat the huddle census and the never-read",
    "list as lower bounds, not as the workspace:",
    ...shortfall.map((window) => `  ${window.file} — ${window.message}`),
  ];
}

/**
 * The human/model rendering.
 *
 * The headline states all four counts every time, including on a workspace where they agree, for the reason
 * `read-thread` prints its completeness line unconditionally: a figure that appears only when something is
 * wrong teaches a reader that its absence means "checked and fine", when it can equally mean nobody checked.
 *
 * @param atlas the built atlas
 * @param options what the caller asked to see
 * @param shortfall the bronze windows the scan could not read, which qualify every count below
 * @returns the text to print
 */
export function renderAtlasSlack({
  atlas,
  options,
  shortfall,
}: {
  atlas: SlackAtlas;
  options: Pick<AtlasSlackOptions, "neverRead" | "unreadable">;
  shortfall: readonly UnreadableWindow[];
}): string {
  const c = atlas.counts;
  // On the FIRST line, not only in the block below it: a reader who takes the headline and stops has to be
  // told there that the number is partial, which is the whole difference between this and the silent
  // version. The detail follows the census so the counts it qualifies are already on screen.
  const partial = shortfall.length > 0 ? "  <- PARTIAL, see SHORTFALL below" : "";
  const lines = [
    `slack atlas: ${String(c.total)} conversation(s) known${partial}`,
    // "expected readable" rather than "readable": this is derived from privacy and membership, not from
    // having opened each one. Public history reads without joining (verified live), but a channel can still
    // refuse for a reason the map cannot see — an externally-shared workspace, a revoked scope. Naming it a
    // prediction is the difference between a map and a promise.
    `  expected readable        : ${String(c.readable)} of ${String(c.total)}`,
    `  known NOT readable       : ${String(c.unreadable)}  (private, not joined)`,
    `  ever read                : ${String(c.everRead)}`,
    `  never looked at, LIVE    : ${String(c.readableNeverRead)}  <- the actionable list (--never-read)`,
    // Both sub-counts stated, because the actionable list is a FILTERED view and an omission nobody
    // mentions is the defect this codebase refuses. Measured on a real workspace: hundreds of never-read rows
    // collapse to about half that live and only a handful joined, and the handful were the answer.
    `    …of those, JOINED      : ${String(c.neverReadJoined)}  <- start here`,
    `  never looked at, archived: ${String(c.neverReadArchived)}  (excluded: nothing new can arrive)`,
    ...huddleLines({ census: atlas.huddles }),
    ...shortfallLines({ shortfall }),
  ];
  // Said BEFORE any list, because every readability figure above is meaningless in this state and a reader
  // who takes "0 readable" at face value has been misled by a true number.
  if (membershipUnknown({ atlas })) {
    lines.push(
      "",
      "STALE MAP: not one stored channel carries membership, so none of the readability figures above mean",
      "anything. The projection used to fetch `is_member` and discard it. Re-run `slopweaver refresh --source",
      "slack` to populate it; until then treat `readable` as UNKNOWN rather than as zero.",
    );
  }
  if (options.unreadable) {
    const rows = unreadable({ atlas });
    lines.push("", `unreadable (${String(rows.length)}):`, ...rows.map((channel) => channelLine({ channel })));
  }
  if (options.neverRead) {
    const rows = neverLookedAt({ atlas });
    lines.push(
      "",
      `readable, live, never looked at (${String(rows.length)}) — joined first:`,
      ...rows.map((channel) => channelLine({ channel })),
      `  (${String(atlas.counts.neverReadArchived)} archived never-read channel(s) excluded)`,
    );
  }
  return lines.join("\n");
}
