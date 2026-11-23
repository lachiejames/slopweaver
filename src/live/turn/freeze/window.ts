/**
 * WHICH MOMENT A RECORD-SET FILE BELONGS TO — the half of `turn freeze` that decides what falls inside one
 * freeze's window and what is the incident's aftermath.
 *
 * Split out of `../../../cli/commands/turn/freeze.ts` because it is one question asked of every file, and
 * the answer comes from a different place for each kind. It reads the filesystem, so it is not pure the way
 * `./plan.ts` and `./fixture.ts` are; what it is instead is ONE place where "when was this written" is
 * answered, rather than a judgement scattered across the collector.
 *
 * Nothing here consults an mtime. A fixture is a set of copies, and a copy's mtime is the moment it was
 * copied — so every instant below is a fact the record set itself states, in a field, in a filename, or in
 * the log row that names the file.
 */
import { readdirSync, readFileSync } from "node:fs";

import { isRecord } from "../../../lib/parsers.js";
import { CHECKPOINT_LOG_FILE, draftRowsWithin, parseSupersededVerdictName } from "../checkpoint.js";
import { reviewedAnswerFileName } from "../reviewStore.js";

/**
 * The checkpoint directory's contents, already cut to this freeze's window: the log rows that fall inside it
 * and the draft files those rows name.
 *
 * A draft is the one record-set file that can be dated by nothing but its own log row — the bytes are the
 * answer document, and an answer document has no write time in it. So the two are windowed here, together,
 * rather than each being handed to {@link declaredInstant} and both coming back undated and therefore kept.
 *
 * @param dir the ask's checkpoint directory
 * @param notAfterIso the instant this freeze's window closes at
 * @returns the entry names to freeze, and the log's own kept lines
 */
export function checkpointWindow({ dir, notAfterIso }: { dir: string; notAfterIso: string }): {
  readonly entries: readonly string[];
  readonly logLines: readonly string[];
} {
  const present = entriesOf({ dir });
  if (!present.includes(CHECKPOINT_LOG_FILE)) {
    return { entries: [], logLines: [] };
  }
  let logText = "";
  try {
    logText = readFileSync(`${dir}/${CHECKPOINT_LOG_FILE}`, "utf8");
  } catch {
    return { entries: [], logLines: [] };
  }
  const within = draftRowsWithin({ logText, notAfterIso });
  const files = present.filter((name) => within.keptFiles.includes(name));
  return { entries: [CHECKPOINT_LOG_FILE, ...files], logLines: within.keptLines };
}

/**
 * One directory's entry names, or empty when it is not there — the listing half of
 * `../../../live/turn/freeze/plan.js`'s `freezeDirectorySources`.
 *
 * @param dir the directory to list
 * @returns its entry names, in whatever order the filesystem gives them
 */
export function entriesOf({ dir }: { dir: string }): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Whether a record file declares a write time later than the freeze's window.
 *
 * Three sources of an instant, in the order they are consulted, and each is a fact on disk rather than an
 * mtime a copy would destroy:
 *
 * - the file's own declared field — `spawnedAt` on a reviewer record, `recordedAtIso` on a turn marker;
 * - for an ARCHIVED verdict, the spawn instant `supersededVerdictName` encoded into its own filename. A
 *   verdict document carries no timestamp at all (`admit/reviewVerdictFile.ts`'s schema is the digest, the
 *   claims and the two session labels), so without this a round's verdict is unwindowable and every round a
 *   turn ever spent lands in a fixture cut off before them;
 * - for the STANDING verdict, the reviewer record sitting beside it, which is the round it belongs to.
 *
 * A file that declares none of those is kept.
 *
 * @param path the candidate source file
 * @param notAfterIso the instant this freeze's window closes at
 * @returns whether this file belongs to a later moment than the freeze covers
 */
export function writtenAfter({ path, notAfterIso }: { path: string; notAfterIso: string }): boolean {
  const declared = declaredInstant({ path });
  return declared !== undefined && Date.parse(declared) > Date.parse(notAfterIso);
}

/**
 * The instant a record-set file belongs to — see {@link writtenAfter} for the three places it comes from.
 *
 * @param path the candidate source file
 * @returns the ISO instant, or `undefined` when nothing on disk states one
 */
function declaredInstant({ path }: { path: string }): string | undefined {
  for (const field of ["spawnedAt", "recordedAtIso"] as const) {
    const own = readStringField({ field, path });
    if (own !== undefined) {
      return own;
    }
  }
  const dir = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const archived = parseSupersededVerdictName({ name });
  if (archived !== undefined) {
    return archived.spawnedAt;
  }
  if (name === "verdict.json") {
    return readStringField({ field: "spawnedAt", path: `${dir}/record.json` });
  }
  if (name.startsWith("answer-reviewed-")) {
    return reviewedAnswerInstant({ dir, name });
  }
  return undefined;
}

/**
 * The instant a snapshotted answer belongs to: the spawn instant of the FIRST round whose verdict bound
 * itself to that answer's digest.
 *
 * `reviewStore.ts` names each snapshot `answer-reviewed-<digest>.json` and content-addresses it precisely so
 * a later round can look the exact bytes up — which means the file itself carries no instant, and the round
 * that owns it is the one whose verdict says `answerDigest`. The FIRST such round rather than any of them,
 * because a digest can be reviewed twice and the earlier round is when those bytes actually existed.
 *
 * An answer no verdict names — the round died before returning one — has no instant and is kept, which is
 * the same conservative answer {@link declaredInstant} gives every other undated file.
 *
 * @param dir the ask's review directory
 * @param name the snapshot's basename
 * @returns the ISO instant, or `undefined` when no verdict in the directory binds that digest
 */
function reviewedAnswerInstant({ dir, name }: { dir: string; name: string }): string | undefined {
  let entries: readonly string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  const instants = entries
    .filter((entry) => entry === "verdict.json" || entry.startsWith("verdict-superseded-"))
    .filter((entry) => namesThisSnapshot({ dir, entry, name }))
    .map((entry) => declaredInstant({ path: `${dir}/${entry}` }))
    .filter((instant): instant is string => instant !== undefined)
    .toSorted((left, right) => Date.parse(left) - Date.parse(right));
  return instants[0];
}

/**
 * Whether one verdict file bound itself to the digest a given snapshot's filename carries.
 *
 * The comparison is made in FILENAME space — the verdict's declared digest is run through the same namer
 * `reviewStore.ts` used to write the snapshot — so the two can never disagree about how a digest becomes a
 * name.
 *
 * @param dir the ask's review directory
 * @param entry the verdict file's basename
 * @param name the snapshot's basename
 * @returns whether that verdict is about that snapshot
 */
function namesThisSnapshot({ dir, entry, name }: { dir: string; entry: string; name: string }): boolean {
  const digest = readStringField({ field: "answerDigest", path: `${dir}/${entry}` });
  return digest !== undefined && reviewedAnswerFileName({ digest }) === name;
}

/**
 * One string field out of a JSON file, or `undefined` for anything that does not read as one.
 *
 * @param path the file to read
 * @param field the field name
 * @returns the field's string value
 */
export function readStringField({ path, field }: { path: string; field: string }): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const value = parsed[field];
  return typeof value === "string" ? value : undefined;
}
