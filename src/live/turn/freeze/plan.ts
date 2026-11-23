/**
 * WHICH files one ask's freeze reads, and where each lands inside the fixture — the pure half of
 * `../../../cli/commands/turn/freeze.ts`.
 *
 * Every source path is derived from `../../../stateHome.ts`, never joined by hand, so a fixture's layout is
 * the home's layout by construction: the replay materialises the fixture directly as `$SLOPWEAVER_HOME` and
 * every store reads it with no fixture-aware code anywhere in `src/live`.
 *
 * Pure: paths in, paths out. Nothing here touches the filesystem.
 */
import { relative } from "node:path";

import { WAVE_RECORD_FILE } from "../../../detective/waveHome.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * One file a freeze copies: where it is read from, and where it lands inside the fixture home.
 *
 * @internal
 */
export interface FreezeSource {
  /** The absolute path in the LIVE home. */
  readonly from: string;
  /** The path inside the fixture's `home/` directory, always POSIX-relative. */
  readonly to: string;
  /** Whether an absent file is ordinary (most of these) or a freeze that cannot proceed. */
  readonly required: boolean;
}

/**
 * How a record-set file is KEYED — `<channel>-<messageTs>`, the same two fields `dispatchStore`,
 * `briefStore` and `reviewStore` all key by. Narrower than `AskIdentity` on purpose: `threadTs` names where
 * a reply lands and has never been part of a filename, so requiring it here would make a freeze demand a
 * field it does not use.
 */
export interface AskFileKey {
  readonly channel: string;
  readonly messageTs: string;
}

/**
 * The record-set files one ask's freeze copies, in write order.
 *
 * `asks.jsonl` is deliberately absent: it is the one file that is never copied but rewritten, because a
 * shared append-only log holds every ask on the machine and a fixture may carry exactly one.
 *
 * @param askIdentity the ask being frozen
 * @param home the live state home to read from
 * @returns every candidate source, required ones first
 */
export function freezeSources({
  askIdentity,
  home,
}: {
  askIdentity: AskFileKey;
  home: string;
}): readonly FreezeSource[] {
  const paths = stateHomePaths({ home });
  const key = `${askIdentity.channel}-${askIdentity.messageTs}`;
  const reviewDir = `${paths.live.slack.reviews}/${key}`;
  return [
    {
      from: `${paths.briefs}/${key}.json`,
      required: true,
      to: relativeToHome({ home, path: `${paths.briefs}/${key}.json` }),
    },
    {
      from: `${paths.live.slack.dispatches}/${key}.json`,
      required: false,
      to: relativeToHome({ home, path: `${paths.live.slack.dispatches}/${key}.json` }),
    },
    {
      from: `${paths.live.slack.turnMarkers}/${key}.json`,
      required: false,
      to: relativeToHome({ home, path: `${paths.live.slack.turnMarkers}/${key}.json` }),
    },
    {
      from: `${reviewDir}/record.json`,
      required: false,
      to: relativeToHome({ home, path: `${reviewDir}/record.json` }),
    },
    {
      from: `${reviewDir}/verdict.json`,
      required: false,
      to: relativeToHome({ home, path: `${reviewDir}/verdict.json` }),
    },
  ];
}

/**
 * The record-set files whose NAMES are only knowable by listing a directory — every round of review a turn
 * spent, every draft it checkpointed, and every detective wave it planned.
 *
 * Split from {@link freezeSources} rather than folded into it because the two are different kinds of fact.
 * That list is fixed and derivable from the ask's key alone, so it stays pure over paths; this one depends on
 * what is actually on disk, so the caller does the listing and this function stays pure over the names.
 *
 * Both of these have to be listed rather than named, because naming
 * exactly the two review files a single round leaves (`record.json`, `verdict.json`) loses every later round. A
 * turn that spent four rounds — measured on ask `C0SYN000008/1789046247.801199` — would freeze as a turn that
 * spent one, and the three verdicts that actually diagnosed it would be dropped. See `../checkpoint.ts`.
 *
 * `packet.md` is still excluded, as the manifest's standing exclusions say: it is free prose composed for a
 * human reviewer and no replay assertion reads it. A detective wave contributes only its `wave.json` for the
 * same reason — its briefs and reports are prose quoting what the detectives read (`detective/waveHome.ts`).
 *
 * @param askIdentity the ask being frozen
 * @param checkpointEntries the entry names in the ask's checkpoint directory, or empty when it has none
 * @param detectiveWaves the wave directory names in the ask's detectives directory, or empty when it has none
 * @param home the live state home to read from
 * @param reviewEntries the entry names in the ask's review directory, or empty when it has none
 * @returns every candidate source, none required
 */
export function freezeDirectorySources({
  askIdentity,
  checkpointEntries,
  detectiveWaves,
  home,
  reviewEntries,
}: {
  askIdentity: AskFileKey;
  checkpointEntries: readonly string[];
  detectiveWaves: readonly string[];
  home: string;
  reviewEntries: readonly string[];
}): readonly FreezeSource[] {
  const paths = stateHomePaths({ home });
  const key = `${askIdentity.channel}-${askIdentity.messageTs}`;
  const reviewDir = `${paths.live.slack.reviews}/${key}`;
  const checkpointDir = `${paths.live.slack.checkpoints}/${key}`;
  const rounds = reviewEntries
    .filter((name) => name.startsWith("verdict-superseded-") || name.startsWith("answer-reviewed-"))
    .map((name) => `${reviewDir}/${name}`);
  const checkpoints = checkpointEntries.map((name) => `${checkpointDir}/${name}`);
  const waves = detectiveWaves.map((name) => `${paths.live.slack.detectives}/${key}/${name}/${WAVE_RECORD_FILE}`);
  return [...rounds, ...checkpoints, ...waves]
    .toSorted((left, right) => left.localeCompare(right))
    .map((path) => ({ from: path, required: false, to: relativeToHome({ home, path }) }));
}

/**
 * A home-relative, POSIX-separated path for a file inside the state home.
 *
 * @param home the live state home
 * @param path the absolute path inside it
 * @returns the fixture-relative path
 */
export function relativeToHome({ home, path }: { home: string; path: string }): string {
  return relative(home, path).split("\\").join("/");
}

/**
 * Whether an absolute path sits inside the state home — the test that decides whether a composed answer can
 * ride along in the fixture at all.
 *
 * A worker that wrote its answer to a bare relative filename, or to a path outside the home, leaves an
 * answer that is unrecoverable from anywhere but its own session (measured on ask
 * `reviews/…/record.json` carrying `answerPath: "answer.json"`). A freeze says so rather than
 * inventing one.
 *
 * @param home the live state home
 * @param path the candidate path
 * @returns whether the path is inside the home
 */
export function insideHome({ home, path }: { home: string; path: string }): boolean {
  const rel = relative(home, path);
  return rel.length > 0 && !rel.startsWith("..") && !rel.startsWith("/");
}
