/**
 * WHAT A FIXTURE SAYS ABOUT ITSELF — the manifest `turn freeze` writes beside the frozen home.
 *
 * Split out of `../../../cli/commands/turn/freeze.ts` along the seam between PRODUCING a fixture and
 * DESCRIBING one: the ask's identity, the file inventory and the review-round count are derived from what
 * that function has already redacted, and nothing here reads the live record set. The rest — the slug, the
 * incident note, `regresses`, `through`, the replay instant and the freeze clock — is metadata the caller
 * supplies. That separation is the manifest's own correctness property — a count or an identity taken from
 * anywhere but the frozen bytes is a manifest describing a different fixture, which is the one failure a
 * replay cannot detect, because it reads the manifest before it trusts anything else.
 */
import { isRecord } from "../../../lib/parsers.js";
import { parseSupersededVerdictName } from "../checkpoint.js";
import {
  FIXTURE_HOME_DIR,
  FIXTURE_SCHEMA_VERSION,
  type FixtureManifest,
  kindOf,
  type SelectedEvents,
} from "./fixture.js";
import { type FixtureIdMap, redactFixtureText, redactJsonDocument } from "./redact.js";

/** What a manifest field says when the record set states nothing for it. */
const ABSENT_FIELD = "(absent)";

/** One frozen file, as the freeze holds it before anything is written. */
export interface FrozenFile {
  readonly relativePath: string;
  readonly contents: string;
}

/** What was excluded from every fixture, and why — stated in the manifest rather than left to be noticed. */
const STANDING_EXCLUSIONS: readonly string[] = [
  "reviews/*/packet.md — free prose composed for a human reviewer; no replay assertion reads it",
  "profile.json — the owner's own persona and chrome; a replay needs neither, and an asker-tag duty is " +
    "decided from the ask's own userId",
  "thread-files/* — attachments, deliberately unredacted where they live and never committable",
  "live/slack/detectives/*/*/*.md — detective briefs and reports, prose quoting what each detective read; " +
    "the wave's wave.json is carried instead",
];

/**
 * How many review rounds the FIXTURE carries — counted off the frozen file list, never off the live home.
 *
 * It used to read the live review directory, and that was wrong in exactly the case `--not-after` exists for.
 * Measured on ask `C0SYN000008/1789046247.801199`, frozen at the instant its worker died: the live record set
 * holds four rounds, two of which are the RECOVERY that ran after the incident, and the fixture correctly
 * withholds them — while the manifest announced `reviewRounds: 4` over a fixture carrying two. A manifest is
 * the one thing a replay reads before trusting anything, so a count it takes from somewhere the fixture does
 * not is worse than no count.
 *
 * A round is one verdict file: `verdict.json` for the round still standing, plus one `verdict-superseded-*`
 * for every round a later one displaced. `record.json`'s own `round` field is deliberately NOT consulted —
 * it states how many rounds the ASK spent, which is the number this function was getting wrong.
 *
 * @param files the fixture's frozen files, fixture-relative
 * @returns the round count
 */
function reviewRoundsOf({ files }: { files: readonly FrozenFile[] }): number {
  return files.filter((file) => {
    const name = file.relativePath.slice(file.relativePath.lastIndexOf("/") + 1);
    return (
      file.relativePath.includes("/reviews/") &&
      (name === "verdict.json" || parseSupersededVerdictName({ name }) !== undefined)
    );
  }).length;
}

/**
 * The ask's identity as the manifest publishes it — synthetic throughout, read back out of the already
 * redacted lines rather than assembled from the real ones.
 *
 * @param denylist the private org-word list
 * @param home the live state home
 * @param ids the working id map, extended in place
 * @param lastKept the last lifecycle line the freeze kept
 * @param selected the ask's own lifecycle lines
 * @returns the manifest's `ask` block
 */
function fixtureAskIdentity({
  denylist,
  home,
  ids,
  lastKept,
  selected,
}: {
  denylist: readonly string[];
  home: string;
  ids: FixtureIdMap;
  lastKept: string;
  selected: SelectedEvents;
}): FixtureManifest["ask"] {
  return {
    // From the `captured` event rather than the last one: only the capture carries who addressed the bot,
    // and a fixture frozen `--through dispatched` still needs the asker for an asker-tag assertion.
    askedBy: redactedField({
      denylist,
      field: "userId",
      home,
      ids,
      line: capturedLine({ lastKept, selected }),
    }),
    channel: redactedField({ denylist, field: "channel", home, ids, line: lastKept }),
    messageTs: redactedField({ denylist, field: "messageTs", home, ids, line: lastKept }),
    threadTs: redactedField({ denylist, field: "threadTs", home, ids, line: lastKept }),
  };
}

/**
 * Describe a fixture that has already been redacted — the manifest a replay reads before it trusts anything.
 *
 * Split from {@link buildFixture} because it is entirely a description: the identity, file list and review
 * count are derived from what that function already produced, the other fields are passed in, and nothing
 * in it reads a file.
 *
 * @param denylist the private org-word list
 * @param files the redacted files, fixture-relative
 * @param home the live state home
 * @param ids the working id map — its size is the only thing about it that is ever published
 * @param incident what went wrong, in the freezer's own words
 * @param lastKept the last lifecycle line the freeze kept
 * @param nowIso the clock `frozenAtIso` is read from, sampled once where that field is built; omitted reads
 *   the wall clock
 * @param replayNowIso the instant a replay must judge this fixture at
 * @param selected the ask's own lifecycle lines and the kinds withheld after them
 * @param skipped the sources left out, each with its reason
 * @param slug the fixture's own name
 * @param through the last lifecycle kind kept
 * @returns the manifest
 */
export function fixtureManifestFor({
  denylist,
  files,
  home,
  ids,
  incident,
  lastKept,
  nowIso = () => new Date().toISOString(),
  regresses,
  replayNowIso,
  selected,
  skipped,
  slug,
  through,
}: {
  denylist: readonly string[];
  files: readonly FrozenFile[];
  home: string;
  ids: FixtureIdMap;
  incident: string;
  lastKept: string;
  nowIso?: () => string;
  regresses: readonly string[];
  replayNowIso: string;
  selected: SelectedEvents;
  skipped: readonly string[];
  slug: string;
  through: string | undefined;
}): FixtureManifest {
  return {
    ask: fixtureAskIdentity({ denylist, home, ids, lastKept, selected }),
    // The skipped lines name the very files they left out, so they carry the raw ask key and go through the
    // same scrub as everything else.
    excluded: [
      ...STANDING_EXCLUSIONS,
      ...skipped.map((line) => redactFixtureText({ denylist, home, ids, text: line })),
    ],
    files: files.map((file) => `${FIXTURE_HOME_DIR}/${file.relativePath}`),
    frozenAtIso: nowIso(),
    // The freezer's own prose goes through the same redaction as the records, and for the same reason: an
    // incident note naturally quotes the very ids the fixture exists to describe, and typing one by hand is
    // the easiest way to put a real channel id into a committed file. Redacted rather than refused, so the
    // note keeps referring to the same participants the frozen records do.
    incident: redactFixtureText({ denylist, home, ids, text: incident }),
    regresses,
    replayNowIso,
    reviewRounds: reviewRoundsOf({ files }),
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    slug,
    syntheticIdCount: ids.size,
    withheldEventKinds: selected.withheldKinds,
    ...(through === undefined ? {} : { through }),
  };
}

/** One field of one already-redacted log line — the manifest quotes the SYNTHETIC identity, never the real one. */
function redactedField({
  line,
  field,
  ids,
  home,
  denylist,
}: {
  line: string;
  field: string;
  ids: FixtureIdMap;
  home: string;
  denylist: readonly string[];
}): string {
  const redacted = redactJsonDocument({ denylist, home, ids, raw: line });
  if (redacted === undefined) {
    return ABSENT_FIELD;
  }
  const value = readStringFieldOfLine({ field, line: redacted });
  if (value === undefined) {
    return ABSENT_FIELD;
  }
  return value;
}

/**
 * The line the ask's identity is read from — its `captured` event, which is the only one carrying who
 * addressed the bot, falling back to the last kept line when a fixture was cut before any capture.
 *
 * Written as an `if` rather than a coalesce because the two lines answer different questions, and a reader
 * of the manifest's `askedBy` should be able to see that a substitution can happen at all.
 *
 * @param lastKept the last lifecycle line the freeze kept
 * @param selected the ask's own lifecycle lines
 * @returns the line to read the identity fields out of
 */
function capturedLine({ lastKept, selected }: { lastKept: string; selected: SelectedEvents }): string {
  const captured = selected.kept.find((line) => kindOf({ line }) === "captured");
  if (captured === undefined) {
    return lastKept;
  }
  return captured;
}

/**
 * One string field of a JSON line.
 *
 * @param line the raw JSONL line
 * @param field the field name
 * @returns the field's string value, or `undefined` when the line will not parse or declares none
 */
export function readStringFieldOfLine({ line, field }: { line: string; field: string }): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const value = parsed[field];
  return typeof value === "string" ? value : undefined;
}
