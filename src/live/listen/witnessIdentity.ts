/**
 * Which peer bots this listener witnesses: `profile.json`'s `slackBot.witnessBotHandles`, each resolved to
 * ONE Slack user id through the member directory the corpus already keeps.
 *
 * A handle, never an id, because an id is a per-install fact and this repository is shared — the profile
 * names the bot the way a person would and the directory (`$SLOPWEAVER_HOME/corpus/members/slack.jsonl`)
 * says which user that is today. Every way a handle can fail to name exactly one current bot is a typed
 * refusal at listen start: witnessing the wrong bot's threads, or a person's, is worse than witnessing none.
 */
import { err, ok, type Result } from "#lib/result.js";
import { readMemberRows } from "../../corpus/members/store.js";
import type { MemberBronzeRow } from "../../corpus/members/types.js";
import { type WitnessIdentityError, WitnessIdentityErrors } from "./witnessErrors.js";

/** One configured handle, resolved. */
export interface ResolvedWitnessBot {
  readonly handle: string;
  /** The bot's Slack USER id — what a `<@…>` tag of it carries, and what its own messages carry as `user`. */
  readonly userId: string;
}

/**
 * The current row per member: the directory is append-only, so the LAST row for a `sourceId` is what that
 * member looks like now, and a deactivated one (`active: false`) no longer names anybody.
 */
function currentRows({ rows }: { rows: readonly MemberBronzeRow[] }): readonly MemberBronzeRow[] {
  const latest = new Map<string, MemberBronzeRow>();
  for (const row of rows) {
    latest.set(row.sourceId, row);
  }
  return [...latest.values()].filter((row) => row.profile.active !== false);
}

/**
 * Resolve each handle against the member rows to exactly one current bot. Pure.
 *
 * Matching is EXACT on the stored handle (a leading `@` in the profile is tolerated): a display name is
 * ambiguous by nature and is never consulted.
 *
 * @param handles the configured handles, in profile order
 * @param rows every stored Slack member row, in file order
 * @returns one resolved bot per handle, or the first handle's refusal
 */
export function resolveWitnessBots({
  handles,
  rows,
}: {
  handles: readonly string[];
  rows: readonly MemberBronzeRow[];
}): Result<readonly ResolvedWitnessBot[], WitnessIdentityError> {
  const current = currentRows({ rows });
  const resolved: ResolvedWitnessBot[] = [];
  for (const raw of handles) {
    const handle = raw.startsWith("@") ? raw.slice(1) : raw;
    const matches = current.filter((row) => row.identity.handle === handle);
    const [only] = matches;
    if (only === undefined) {
      return err(WitnessIdentityErrors.notFound({ handle }));
    }
    if (matches.length > 1) {
      return err(WitnessIdentityErrors.ambiguous({ handle, userIds: matches.map((row) => row.sourceId) }));
    }
    if (only.profile.bot !== true) {
      return err(WitnessIdentityErrors.notABot({ handle, userId: only.sourceId }));
    }
    resolved.push({ handle, userId: only.sourceId });
  }
  return ok(resolved);
}

/**
 * Read the Slack member directory and resolve the handles. An empty handle list reads nothing and is inert.
 *
 * A reader warning is a refusal rather than a note: a line the reader skipped may be the very row that
 * makes a handle ambiguous, so resolving past it would be a guess.
 *
 * @param home the Slopweaver home holding the member directory
 * @param handles the configured handles
 * @returns the resolved bots (empty when none are configured), or why a handle did not resolve
 */
export function loadResolvedWitnessBots({
  handles,
  home,
}: {
  handles: readonly string[];
  home: string;
}): Result<readonly ResolvedWitnessBot[], WitnessIdentityError> {
  if (handles.length === 0) {
    return ok([]);
  }
  const read = readMemberRows({ home, source: "slack" });
  if (read.warnings.length > 0) {
    return err(WitnessIdentityErrors.unreadable({ warnings: read.warnings }));
  }
  return resolveWitnessBots({ handles, rows: read.rows });
}
