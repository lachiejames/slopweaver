/**
 * The effectful half of {@link ./connectMembers} — the streaming harvest that walks Slack bronze already on
 * disk and lifts every message's `user_profile` out of it. No token, no scope, no network call: the people
 * `users.list` structurally cannot return are recoverable from records a past refresh already wrote.
 *
 * **Streamed, never read whole.** `readJsonlLines` (`../corpusStore`) delivers one line at a time, and the
 * pre-filter below rejects most of them on a substring before anything is parsed. Both halves are load-bearing
 * rather than tuning: this corpus's `bronze/slack/` is 7.3 GB over 1,920,988 lines, and the ad-hoc scan that
 * first found this defect held every record in memory, reached roughly 18 GB resident and put the machine on
 * a capacity hold. What this holds instead is one profile per author id.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { OwnerProtectionResolver } from "../bronzeProtection.js";
import { listBronzeFiles } from "../bronzeStorage.js";
import { parseRow } from "../corpusRowCore.js";
import { readJsonlLines } from "../corpusStore.js";
import type { MemberBronzeRow } from "../members/types.js";
import { projectConnectMember } from "./connectMembers.js";

/**
 * The substring a line must contain before it is worth parsing. Slack stamps `user_profile` onto exactly the
 * messages whose author `users.list` cannot explain, so this rejects the overwhelming majority of a window
 * file on a cheap `String.includes` — measured on the dogfood corpus, 12,239 lines of 1,920,988 survive it.
 */
const PROFILE_MARKER = '"user_profile"';

/** One author's freshest captured profile, with the record instant that decided "freshest". */
export interface ProfileSighting {
  readonly profile: unknown;
  readonly atIso: string;
}

/**
 * Fold one bronze line into the running id → freshest-profile map. Exported for the unit lane, which feeds
 * it lines directly rather than writing a 7 GB fixture. MUTATES `sightings`, the house idiom for these walks.
 *
 * **A strictly older instant loses; an EQUAL one is resolved by bronze READ POSITION, last wins.** That is
 * not tidiness, it is the corpus's own recency rule — {@link ../corpusPaths.sortBronzeEntries} exists so that
 * read order IS write order precisely to let `latestRecords` break a timestamp tie by recency, and the same
 * section records 60 of 60 meetings resolving to superseded versions the last time that signal was read
 * backwards. Two sightings tie because bronze holds the SAME message twice: a later refresh re-fetched it and
 * Slack stamped the author's then-current profile on the new copy, while `tsIso` — the MESSAGE's instant —
 * cannot tell two captures of one message apart. Nor can it be sharpened: `tsIso` is second-granularity by
 * construction ({@link ../../lib/slackTs.slackTsToIso} drops the fractional digits), and the full-precision
 * `ts` is not recoverable from bronze, where hygiene redaction has already rewritten it.
 *
 * Measured on the dogfood corpus (reproduce: `slopweaver refresh --source slack`, then
 * `slopweaver identity resolve U0SYN000021`): of the 17,763 lines carrying a profile, 10 `(author, tsIso)`
 * pairs hold two DIFFERENT payloads, and in every one of them both records carry the same `sourceId`. Three
 * disagree about the person's name — `Wren Ito` against `Wren`, `Dr Ada Byron` against
 * `Dr Ada`. **Today both rules emit the same 285 profiles**, because each of those ten authors also has a
 * strictly later message that wins outright either way; the reversed tie-break is latent rather than
 * observed, and it fires the moment a renamed author's re-fetched last message IS their newest. Stated that
 * way on purpose — the old rule was wrong about which copy is newer, not caught returning a wrong answer.
 * Found by the r3 review pass on this change, before it landed.
 *
 * A line with no instant at all loses to any line that has one, because `""` sorts below every ISO string.
 *
 * @param line one bronze JSONL line
 * @param sightings the running map, MUTATED in place
 */
export function foldProfileLine({ line, sightings }: { line: string; sightings: Map<string, ProfileSighting> }): void {
  if (line.length === 0 || !line.includes(PROFILE_MARKER)) {
    return;
  }
  const parsed = parseRow({ line });
  if (!("record" in parsed)) {
    return;
  }
  const record = parsed.record;
  const author = record.author;
  if (author === undefined || author.length === 0 || !isRecord(record.raw)) {
    return;
  }
  const profile = record.raw["user_profile"];
  if (!isRecord(profile)) {
    return;
  }
  const atIso = record.tsIso;
  const held = sightings.get(author);
  if (held !== undefined && held.atIso > atIso) {
    return;
  }
  sightings.set(author, { atIso, profile });
}

/**
 * Harvest a member row for every Slack author bronze carries a `user_profile` for, newest profile per author.
 * Effectful — reads every Slack bronze file on disk.
 *
 * It does NOT subtract the `users.list` roster; that is {@link ./connectMembers.mergeConnectMembers}'s job at
 * the call site, which holds both halves. Keeping the two apart is what lets this one be re-run against a
 * different roster without re-reading 7 GB.
 *
 * @param home the Slopweaver home
 * @param fetchedAtIso the hydration timestamp stamped on every row
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns one member row per author with a recoverable profile, in author-id order so a re-run is stable, or the
 *   owner's protect list's refusal of Slack bronze — never an empty harvest
 */
export function harvestConnectMembers({
  home,
  fetchedAtIso,
  protection,
}: {
  home: string;
  fetchedAtIso: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<readonly MemberBronzeRow[]> {
  const listed = listBronzeFiles({ home, protection, source: "slack" });
  if (listed.isErr()) {
    return err([listed.error.message]);
  }
  const sightings = new Map<string, ProfileSighting>();
  for (const file of listed.value) {
    readJsonlLines({
      onLine: ({ line }) => {
        foldProfileLine({ line, sightings });
      },
      path: file.path,
    });
  }
  const rows: MemberBronzeRow[] = [];
  for (const userId of [...sightings.keys()].toSorted()) {
    const sighting = sightings.get(userId);
    if (sighting === undefined) {
      continue;
    }
    const row = projectConnectMember({ fetchedAtIso, profile: sighting.profile, userId });
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return ok(rows);
}
