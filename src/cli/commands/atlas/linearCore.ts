/**
 * The pure half of `atlas linear`: each verb's own usage line, the flags every verb shares, how a run's
 * outcome is rendered, and the empty browser reading a run falls back to. No I/O, so every line a reader sees
 * is settled by a unit test rather than by a live run.
 *
 * Which verbs Linear answers, and the block `atlas linear --help` prints, are no longer here: they are rows
 * on `atlas/linear/registration.ts`, which the registry dispatches and the manifest renders.
 */
import type { LinearApiSurfaceReading } from "../../../atlas/linear/apiSurface.js";
import type { LinearAtlasGap } from "../../../atlas/linear/model.js";
import type { LinearBrowserReading } from "../../../atlas/linear/projectionKit.js";
import type { LinearAtlasSnapshot } from "../../../atlas/linear/store.js";
import { isRecord } from "../../../lib/parsers.js";
import type { Result } from "../../../lib/result.js";
import { type FlagTailSpec, type ParsedFlagTail, parseFlagTail, verbTail } from "../../optionParsers.js";

/** Where a Linear atlas verb sits: past the runtime, the script, the `atlas` noun and the `linear` platform. */
export const LINEAR_VERB_INDEX = 4;

/** Every flag a Linear verb knows. */
const LINEAR_VERB_FLAGS: FlagTailSpec = { boolean: ["json", "skip-browser"], value: ["home", "limit", "confirm"] };

/**
 * Parse the flags every Linear verb shares.
 *
 * @returns the parsed flag tail, and the raw tail it was read from
 */
export function parsed({ argv, verb }: { argv: readonly string[]; verb: string }): {
  parsedFlags: Result<ParsedFlagTail>;
  rest: readonly string[];
} {
  const rest = verbTail({ argv, at: LINEAR_VERB_INDEX, verbs: [verb] });
  return { parsedFlags: parseFlagTail({ rest, spec: LINEAR_VERB_FLAGS }), rest };
}

/**
 * The flag tail each of Linear's own verbs accepts, as its `--help` prints it and the catalogue advertises it.
 *
 * Every flag reachable under a verb is named here, because the manifest row is the deepest match a canon
 * check resolves to — a flag advertised only by the verb beneath it reads as unadvertised.
 */
export const LINEAR_VERB_USAGE: Readonly<Record<"report" | "reset" | "sync" | "walk", string>> = {
  report: "usage: slopweaver atlas linear report [--json] [--home <dir>]",
  reset: "usage: slopweaver atlas linear reset --confirm archive [--json] [--home <dir>]",
  sync: "usage: slopweaver atlas linear sync [--skip-browser] [--limit <n>] [--json] [--home <dir>]",
  walk: "usage: slopweaver atlas linear walk [--limit <n>] [--json] [--home <dir>]",
};
/**
 * One line of a sync summary, rendered for a human.
 * @internal
 */
export interface SyncLineInput {
  readonly entityCounts: Readonly<Record<string, number>>;
  readonly openGapCounts: Readonly<Record<string, number>>;
  readonly surfacesRead: readonly string[];
}

/**
 * Render a sync summary as one human line per kind, plus the surfaces that actually contributed.
 *
 * @param input the counts a run produced
 * @returns the lines, in kind order
 */
export function renderSyncSummary({ input }: { input: SyncLineInput }): readonly string[] {
  const kinds = Object.keys(input.entityCounts).toSorted();
  return [
    `linear atlas synced — surfaces read: ${input.surfacesRead.length === 0 ? "none" : input.surfacesRead.join(", ")}`,
    ...kinds.map(
      (kind) =>
        // `kind` is one of `entityCounts`' own keys, so its count is there to read.
        `  ${kind.padEnd(10)} ${String(input.entityCounts[kind]!).padStart(5)} entities, ${String(
          openGapsOf({ input, kind }),
        )} open gap(s)`,
    ),
  ];
}

/** How many gaps one kind left open — a kind the run recorded no gap count for left none open. */
function openGapsOf({ input, kind }: { input: SyncLineInput; kind: string }): number {
  const open = input.openGapCounts[kind];
  if (open === undefined) {
    return 0;
  }
  return open;
}

/**
 * The workspace's own settings root, and the teams a walk fans out over, from what the API already read.
 *
 * @param api the API surface this run read
 * @returns the organisation's `urlKey` (`null` when the API returned none) and every team key — none when the
 *   API read no team group at all
 */
export function workspaceShape({ api }: { api: LinearApiSurfaceReading }): {
  urlKey: string | null;
  teamKeys: readonly string[];
} {
  const organisation = api.settings.find((outcome) => outcome.group === "organization");
  const value = organisation?.records[0]?.detail.value;
  const urlKey = isRecord(value) && typeof value["urlKey"] === "string" ? value["urlKey"] : null;
  return { teamKeys: teamKeysOf({ api }), urlKey };
}

/** Every team key the API read — a run whose API read held no team group has no team to walk. */
function teamKeysOf({ api }: { api: LinearApiSurfaceReading }): readonly string[] {
  const teams = api.settings.find((outcome) => outcome.group === "team");
  if (teams === undefined) {
    return [];
  }
  return teams.records.flatMap((record) => {
    const team = record.detail.value;
    return isRecord(team) && typeof team["key"] === "string" ? [team["key"]] : [];
  });
}

/**
 * Every open api-browser disagreement the published generation records.
 *
 * @param snapshot the published generation, read for its operation kind's gaps
 * @returns the open disagreements, in the order recorded — none when no operation kind was ever published
 */
export function apiBrowserDisagreements({ snapshot }: { snapshot: LinearAtlasSnapshot }): readonly LinearAtlasGap[] {
  const operation = snapshot.files.operation;
  if (operation === null) {
    return [];
  }
  return operation.gaps.filter((gap) => gap.status === "open" && gap.condition === "api-browser-disagreement");
}

/**
 * A browser reading that saw nothing, carrying the one sentence that says why — what a run reports when the
 * owner's Chrome could not be reached or the walk could not start, so the API half still publishes.
 *
 * @returns an empty reading whose `unavailableBecause` is {@link because}
 */
export function noBrowserReading({ because }: { because: string }): LinearBrowserReading {
  return {
    limited: false,
    observations: { graphqlResponses: 0, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
    pages: [],
    unavailableBecause: because,
  };
}
