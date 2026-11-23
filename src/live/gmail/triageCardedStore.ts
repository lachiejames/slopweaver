/**
 * The effectful half of "is this group already carded": scan the pins under `live/gmail/triage-cards/`, read each
 * card row (and the row a `filed` one names) off the board, and hand `./triageCarded.ts` the decision.
 *
 * Every pin is decoded, because its key lives only inside it, but the board is read only for a pin whose key the
 * current inbox reading holds, and each slug at most once per scan. `readDerivedRowState` reads exactly one doc and
 * its journal, never the whole board (`../../handover/rowState.ts` carries the measurement).
 *
 * **It fails OPEN for carding and LOUD for the reader.** A pin directory that will not list, or a pin that will not
 * read, is a diagnostic and no skip: refusing would stop the firing carding anything, and a skip on unread state would
 * hide mail. Absent pins are no pins.
 */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { IngestError } from "#lib/ingestError.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";

import { readDerivedRowState } from "../../handover/rowState.js";
import { stateHomePaths } from "../../stateHome.js";
import { standingsByKey, type TriageCardStanding, type TriageRowRead, triageCardStanding } from "./triageCarded.js";
import { type GmailTriageCard, readTriageCard } from "./triageCards.js";

/** Every key the pins say is carded or unreadable, and what the scan could not read. */
export interface TriageCardedKeysRead {
  /** One standing per key the current reading holds and some pin names. */
  readonly standingsByKey: ReadonlyMap<string, TriageCardStanding>;
  /** Lines naming unread residue — a pin directory or pin that would not read, a card row missing or unreadable. */
  readonly diagnostics: readonly string[];
}

const PIN_SUFFIX = ".json";

/** The slug of every pin file, sorted so duplicate pins fold the same way every time; none when the directory was never made. */
function listPinSlugs({ directory }: { directory: string }): Result<readonly string[], IngestError> {
  const listed = safeFs({
    execute: () => readdirSync(directory, { withFileTypes: true }),
    operation: "readCardedKeys",
    path: directory,
  });
  if (listed.isErr()) {
    return listed.error.code === "ENOENT" ? ok([]) : err(listed.error);
  }
  return ok(
    listed.value
      // Every `.json` name, whatever the entry is: a directory or a dangling link there is a pin that will not
      // read, and the reader names it rather than this filter dropping it unseen.
      .filter((entry) => entry.name.endsWith(PIN_SUFFIX))
      .map((entry) => entry.name.slice(0, -PIN_SUFFIX.length))
      .toSorted(),
  );
}

/**
 * One pin, read only when its path is a regular file: a FIFO there would block the read forever and hang the
 * whole firing, so the type is checked first, of the entry itself and never through a link — `pinTriageCard` writes a
 * regular file, so a link there is not a pin — and anything else is named rather than read.
 */
function readPin({
  directory,
  home,
  slug,
}: {
  directory: string;
  home: string;
  slug: string;
}): Result<GmailTriageCard, string> {
  const path = join(directory, `${slug}${PIN_SUFFIX}`);
  const stat = safeFs({ execute: () => lstatSync(path), operation: "readCardedKeys", path });
  if (stat.isErr()) {
    return err(stat.error.message);
  }
  if (!stat.value.isFile()) {
    return err("it is not a regular file");
  }
  return readTriageCard({ home, slug }).mapErr((error) => error.message);
}

/** A board-row reader that reads each slug at most once — several cards may be filed into one ask. */
function memoisedRowReader({ home }: { home: string }): (args: { slug: string }) => TriageRowRead {
  const paths = stateHomePaths({ home });
  const rows = new Map<string, TriageRowRead>();
  return ({ slug }) => {
    const cached = rows.get(slug);
    if (cached !== undefined) {
      return cached;
    }
    const read = readDerivedRowState({ handoverDir: paths.handovers, runsDir: paths.runs, slug });
    rows.set(slug, read);
    return read;
  };
}

/** One pin's standing: its card row, and the row a `filed` one names, read once each and decided. */
function pinStanding({
  card,
  readRow,
}: {
  card: GmailTriageCard;
  readRow: (args: { slug: string }) => TriageRowRead;
}): TriageCardStanding {
  const row = readRow({ slug: card.slug });
  const filedInto = row.isOk() && row.value.settlement === "filed" ? row.value.settlementWitness : undefined;
  const witness = filedInto === undefined ? null : readRow({ slug: filedInto });
  return triageCardStanding({ card, row, witness });
}

/**
 * Read which of the current reading's keys a pinned card still stands open for.
 *
 * @param home the state home the pins and the board live under
 * @param keys the group keys of the current inbox reading — a pin for any other key costs no board read
 * @returns one standing per pinned key, and the residue the scan could not read
 */
export function readCardedKeys({
  home,
  keys,
}: {
  readonly home: string;
  readonly keys: ReadonlySet<string>;
}): TriageCardedKeysRead {
  const directory = stateHomePaths({ home }).live.gmail.triageCards;
  const slugs = listPinSlugs({ directory });
  if (slugs.isErr()) {
    const line = `the triage card pins did not list (${slugs.error.message}), so no group reads as carded`;
    return { diagnostics: [line], standingsByKey: new Map() };
  }
  const diagnostics: string[] = [];
  const standings: TriageCardStanding[] = [];
  const readRow = memoisedRowReader({ home });
  for (const slug of slugs.value) {
    const card = readPin({ directory, home, slug });
    if (card.isErr()) {
      diagnostics.push(`pin ${slug}${PIN_SUFFIX} did not read (${card.error}), so it cards nothing as already carded`);
    } else if (keys.has(card.value.key)) {
      standings.push(pinStanding({ card: card.value, readRow }));
    }
  }
  const byKey = standingsByKey({ standings });
  // Every unreadable pin is named, not only the one the fold kept: two damaged rows for one key are two repairs. A
  // MISSING row is named too — a pin outliving its card row is residue, and a doc path the reader cannot see (a
  // dangling link reads as absent) must not pass silently either.
  for (const standing of standings.filter((each) => each.reason === "unreadable" || each.reason === "missing")) {
    const kept = byKey.get(standing.key)!;
    const outcome = kept.carded ? `still carded by ${kept.slug}` : "carded again, never skipped on unread state";
    diagnostics.push(`${standing.key}: ${standing.line} — ${outcome}`);
  }
  return { diagnostics, standingsByKey: byKey };
}
