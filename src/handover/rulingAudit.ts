/**
 * Account for every ruling the register holds, and — given a manifest — say of each reviewed answer whether
 * its row now reads it as decided.
 *
 * The gold proof for the ruling backfill is the audit reading every backfilled row as decided. This is that
 * reader. It changes no projection and no gate; it applies the ones
 * that already exist — `./ruling.ts`'s `latestRuling` for what a row reads, and its `rulingSourceProblem` for
 * whether a reconstruction still names exactly one answer that says what it says.
 *
 * ## A manifest entry is decided only on exact evidence
 *
 * Exactly one document claims the slug; its journal read whole with no undecodable line; the source answer
 * passes the writer's own source rule against the manifest's words; exactly one ruling names that source in
 * `backfilledFrom`; and that ruling's words and anchor equal the manifest's. A live ruling or an authored pair
 * with identical words does NOT satisfy an entry — it does not name the source, and text equality alone is
 * how a ruling on one row would be counted for another. A decided entry need not be the ruling the row reads
 * today: a later decision supersedes it, and the check records that as `historical` placement rather than
 * refusing the history.
 *
 * ## Complete means complete
 *
 * `complete` is false exactly when a problem was found, and a problem is anything that stops a count being a
 * count: a directory that would not list, a line that did not decode, two documents claiming a slug. A
 * missing backfill over fully-read input is NOT incomplete — it is `confirmed-unrepresented`, and it fails the
 * exit code just as loudly.
 *
 * Candidate discovery (guessing which unclassified answers are rulings) is deliberately absent, and the
 * report says so in {@link CANDIDATE_NOTICE} rather than printing a zero that looks like a search.
 *
 * Pure: acquired input in, report out.
 */

import { absentAsEmpty, absentAsNull } from "#lib/absent.js";
import type { HandoverDoc } from "./doc.js";
import type { RulingEvent, RunEvent } from "./ledger.js";
import { latestRuling, latestRulingEvent, type RulingEvidence, rulingSourceProblem } from "./ruling.js";
import { type RulingAuditProblem, RulingAuditProblems } from "./rulingAuditErrors.js";
import {
  CANDIDATE_NOTICE,
  type RulingAuditAnswer,
  type RulingAuditDocOccurrence,
  type RulingAuditInput,
  type RulingAuditInputRow,
  type RulingAuditReport,
  type RulingAuditRow,
  type RulingManifestCheck,
} from "./rulingAuditTypes.js";
import type { RulingManifestEntry } from "./rulingManifest.js";

/**
 * Build the report.
 *
 * @param input everything the store acquired, failures included
 * @returns the report, with every problem found listed and counted
 */
export function auditRulings({ input }: { input: RulingAuditInput }): RulingAuditReport {
  const audited = input.rows.map((row) => auditRow({ row }));
  const bySlug = new Map(input.rows.map((row, index) => [row.slug, { problems: audited[index]!.problems, row }]));
  // A doc or a directory the scan could not read belongs to no row, and that is exactly why it bears on
  // EVERY entry: the unread file could be a second document claiming any slug, so while one exists the row
  // set is not known and no entry may be called decided. Found by a review pass, whose counterexample was a
  // 2 MiB-over-cap archived duplicate that `scanBoard` reported unreadable and left one occurrence standing.
  const scopeProblems = input.problems.filter(
    (problem) => problem.code === "DOC_UNREADABLE" || problem.code === "DIRECTORY_UNREADABLE",
  );
  const checked = absentAsEmpty({ value: input.manifest?.entries }).map((entry, entryIndex) => {
    const found = bySlug.get(entry.slug);
    return checkRulingManifestEntry({
      entry,
      entryIndex,
      row: found?.row,
      rowProblems: [...scopeProblems, ...absentAsEmpty({ value: found?.problems })],
    });
  });
  const rows = audited.map(({ audit }) => audit);
  const manifest = checked.map(({ check }) => check);
  const problems = [
    ...input.problems,
    ...audited.flatMap((entry) => entry.problems),
    ...checked.flatMap((entry) => entry.problems),
  ];
  return {
    candidateNotice: CANDIDATE_NOTICE,
    complete: problems.length === 0,
    counts: {
      candidates: 0,
      confirmedUnrepresented: manifest.filter((check) => check.status === "confirmed-unrepresented").length,
      decided: manifest.filter((check) => check.status === "decided").length,
      effective: rows.filter((row) => row.effective !== null).length,
      historical: rows.reduce((sum, row) => sum + row.history.length, 0),
      incompleteInputs: problems.length,
      manifestEntries: manifest.length,
      manifestIncomplete: manifest.filter((check) => check.status === "incomplete").length,
      rows: rows.length,
      unclassifiedAnswers: rows.reduce(
        (sum, row) => sum + row.answers.filter((answer) => answer.state === "unclassified-answer").length,
        0,
      ),
    },
    manifest,
    problems,
    rows,
    schemaVersion: 1,
    scope: {
      handoverDir: input.handoverDir,
      includesArchive: true,
      includesJournalOnly: true,
      manifestPath: input.manifestPath,
      runsDir: input.runsDir,
    },
  };
}

/**
 * The exit code a report earns: 1 when anything was incomplete or any reviewed answer is unrepresented.
 *
 * @param report the finished report
 * @returns 0 when every input was read and every manifest entry is decided, otherwise 1
 */
export function rulingAuditExitCode({ report }: { report: RulingAuditReport }): 0 | 1 {
  return report.complete && report.counts.confirmedUnrepresented === 0 ? 0 : 1;
}

/** Every ruling event on a journal, in journal order. */
function rulingEvents({ events }: { events: readonly RunEvent[] }): readonly RulingEvent[] {
  return events.filter((event): event is RulingEvent => event.kind === "ruling");
}

/**
 * When the audit says the owner decided a register ruling. A line from before `decidedIso` was written has none; it
 * was recorded live by `handover rule`, which records in the instant the owner rules, so that line's `atIso` is it.
 */
function auditedDecisionIso({ event }: { event: RulingEvent }): string {
  const { decidedIso } = event;
  if (decidedIso === undefined) {
    return event.atIso;
  }
  return decidedIso;
}

/** A register ruling as evidence. */
function registerEvidence({ event }: { event: RulingEvent }): RulingEvidence {
  return { decidedIso: auditedDecisionIso({ event }), event, from: "register" };
}

/** One row's accounting, and the problems that belong to the row rather than to any manifest entry. */
function auditRow({ row }: { row: RulingAuditInputRow }): {
  readonly audit: RulingAuditRow;
  readonly problems: readonly RulingAuditProblem[];
} {
  const read = row.journal.kind === "read";
  const events = row.journal.kind === "read" ? row.journal.events : [];
  const soleDoc = row.docs.length === 1 ? row.docs[0]!.doc : undefined;
  const effective = read ? effectiveRuling({ doc: soleDoc, events }) : undefined;
  return {
    audit: {
      answers: answersOf({ events }),
      docs: row.docs.map(({ location, path }) => ({ location, path })),
      effective: absentAsNull({ value: effective }),
      history: historyOf({ docs: row.docs, effective, events }),
      journalPath: row.journalPath,
      slug: row.slug,
    },
    problems: rowProblems({ row }),
  };
}

/**
 * What the row reads as decided. With exactly one document that is `latestRuling` itself; with none or
 * several, no authored pair can be chosen, so only the register speaks.
 */
function effectiveRuling({
  doc,
  events,
}: {
  doc: HandoverDoc | undefined;
  events: readonly RunEvent[];
}): RulingEvidence | undefined {
  if (doc !== undefined) {
    return latestRuling({ doc, events });
  }
  const event = latestRulingEvent({ events });
  return event === undefined ? undefined : registerEvidence({ event });
}

/**
 * Every ruling other than the effective one: each earlier register ruling, and every document's authored
 * pair that is not itself the effective one.
 *
 * **An authored pair is kept whenever it is not the row's current ruling, which is the whole of two review
 * findings.** A journal that could not be read, and two documents claiming one slug, each make the CURRENT
 * ruling unknowable — and both left the front-matter rulings, read perfectly well off disk, out of the
 * report entirely. Readable evidence is not lost to a failure elsewhere; it goes to history, because what
 * could not be read is exactly what might have superseded it.
 */
function historyOf({
  docs,
  effective,
  events,
}: {
  docs: readonly RulingAuditDocOccurrence[];
  effective: RulingEvidence | undefined;
  events: readonly RunEvent[];
}): readonly RulingEvidence[] {
  const current = effective?.from === "register" ? effective.event : undefined;
  const earlier = rulingEvents({ events })
    .filter((event) => event !== current)
    .map((event) => registerEvidence({ event }));
  // An authored effective ruling can only come from a sole document, so it is the only authored pair there
  // is and history holds none. Every other case keeps all of them.
  const authored =
    effective?.from === "authored"
      ? []
      : docs.flatMap(({ doc }) =>
          doc.ruling !== undefined && doc.rulingAnchor !== undefined
            ? [{ anchor: doc.rulingAnchor, from: "authored" as const, words: doc.ruling }]
            : [],
        );
  return [...earlier, ...authored];
}

/** Each answer on the journal, and whether exactly one reconstruction names it. */
function answersOf({ events }: { events: readonly RunEvent[] }): readonly RulingAuditAnswer[] {
  const rulings = rulingEvents({ events });
  return events.flatMap((event) => {
    if (event.kind !== "answered") {
      return [];
    }
    const claims = rulings.filter((ruling) => ruling.backfilledFrom === event.atIso).length;
    return [
      { answer: event.answer, sourceAtIso: event.atIso, state: claims === 1 ? "represented" : "unclassified-answer" },
    ];
  });
}

/** The problems a row carries whatever the manifest says: duplicate documents and an incompletely read journal. */
function rowProblems({ row }: { row: RulingAuditInputRow }): readonly RulingAuditProblem[] {
  const problems: RulingAuditProblem[] = [];
  if (row.docs.length > 1) {
    problems.push(RulingAuditProblems.duplicateSlug({ paths: row.docs.map((doc) => doc.path), slug: row.slug }));
  }
  if (row.journal.kind === "failed") {
    problems.push(
      RulingAuditProblems.journalUnreadable({ cause: row.journal.cause, path: row.journalPath, slug: row.slug }),
    );
  } else if (row.journal.unreadableLines.length > 0) {
    problems.push(
      RulingAuditProblems.journalLineUnreadable({
        lines: row.journal.unreadableLines,
        path: row.journalPath,
        slug: row.slug,
      }),
    );
  }
  for (const { doc, path } of row.docs) {
    // The same substitution, on the other surface this audit reports — a document is read with the same
    // `readFileSync(path, "utf8")`, and its authored ruling is evidence exactly as an event is.
    if (carriesReplacement({ value: doc.ruling }) || carriesReplacement({ value: doc.rulingAnchor })) {
      problems.push(RulingAuditProblems.docBytesReplaced({ path, slug: row.slug }));
    }
    // The parser already found what is wrong with the front matter and says so on the doc. A review pass
    // found the audit ignoring it: a repeated `ruling:` key discards the second value, so its corrupted
    // bytes never reached the check above while the row still read as decided.
    if (doc.problems.length > 0) {
      problems.push(RulingAuditProblems.docMalformed({ defects: doc.problems, path, slug: row.slug }));
    }
  }
  const replaced = replacedEvents({ events: row.journal.kind === "read" ? row.journal.events : [] });
  if (replaced.length > 0) {
    problems.push(
      RulingAuditProblems.journalBytesReplaced({ atIsos: replaced, path: row.journalPath, slug: row.slug }),
    );
  }
  return problems;
}

/** The one character a UTF-8 decoder substitutes for a byte sequence it could not decode. */
const REPLACEMENT_CHARACTER = "�";

/**
 * The instants of every event carrying a replaced byte.
 *
 * `readRunJournal` decodes with `readFileSync(path, "utf8")`, which SUBSTITUTES invalid bytes rather than
 * failing, so a line with one bad byte decodes cleanly into an event whose text is not the text that was
 * written — found by a review pass, whose journal held a ruling reading `ship <0xFF> it` and was certified
 * complete. The audit cannot re-read the bytes without becoming a second journal reader, so it reports the
 * substitution the decoder left behind. A genuine replacement character in the owner's words reports the same way,
 * which is the fail-closed direction: it says the text is not trustworthy, never that a ruling is absent.
 *
 * **What it cannot see, stated rather than left to be found.** A replaced byte inside a field the decoder
 * does not keep — a `note` nobody declared, on an otherwise valid line — is dropped before this check runs,
 * and seeing it would need the raw bytes. Raised by a review pass, and left as it is: every field this
 * register reads IS checked, so a substitution that could change what a ruling says is caught, while one in
 * a field no reader reads cannot change any claim the report makes.
 */
function replacedEvents({ events }: { events: readonly RunEvent[] }): readonly string[] {
  return events
    .filter((event) => Object.values(event).some((value) => carriesReplacement({ value })))
    .map((event) => event.atIso);
}

/**
 * Whether a decoded value holds a replaced byte, at any depth this register's events reach.
 *
 * A string OR a list of them: `finished.residue` is decoded through `stringList`, and a first version of this
 * check looked only at top-level strings, so a replaced byte inside that list certified clean. Found by a
 * review pass. Recursing is what makes the check total rather than a list of the fields somebody remembered.
 */
function carriesReplacement({ value }: { value: unknown }): boolean {
  if (typeof value === "string") {
    return value.includes(REPLACEMENT_CHARACTER);
  }
  return Array.isArray(value) && value.some((item: unknown) => carriesReplacement({ value: item }));
}

/**
 * One manifest entry's verdict, and any problem the entry itself found.
 *
 * A row whose own input is incomplete makes its entries `incomplete` naming the row's codes, without adding
 * a second copy of the row's problem to the report.
 *
 * @param entry the reviewed answer
 * @param entryIndex its position in the manifest
 * @param row everything acquired for its slug, `undefined` when nothing was
 * @param rowProblems the problems already standing that bear on this entry — its row's own, and every
 *   unreadable doc or directory, since one of those could be another document claiming this slug
 * @returns the check, and the problems it adds
 */
function checkRulingManifestEntry({
  entry,
  entryIndex,
  row,
  rowProblems: carried,
}: {
  entry: RulingManifestEntry;
  entryIndex: number;
  row: RulingAuditInputRow | undefined;
  rowProblems: readonly RulingAuditProblem[];
}): { readonly check: RulingManifestCheck; readonly problems: readonly RulingAuditProblem[] } {
  const identity = { entryIndex, slug: entry.slug, sourceAtIso: entry.sourceAtIso };
  const incomplete = ({
    problems,
  }: {
    problems: readonly RulingAuditProblem[];
  }): ReturnType<typeof checkRulingManifestEntry> => ({
    check: { ...identity, codes: problems.map((problem) => problem.code), status: "incomplete" },
    problems,
  });
  if (carried.length === 0 && (row === undefined || row.docs.length === 0)) {
    return incomplete({ problems: [RulingAuditProblems.rowMissing({ entryIndex, slug: entry.slug })] });
  }
  if (row === undefined) {
    return { check: { ...identity, codes: codesOf({ problems: carried }), status: "incomplete" }, problems: [] };
  }
  if (carried.length > 0 || row.docs.length === 0 || row.journal.kind === "failed") {
    return { check: { ...identity, codes: codesOf({ problems: carried }), status: "incomplete" }, problems: [] };
  }
  const problem = evidenceProblem({ entry, entryIndex, events: row.journal.events });
  if (problem !== undefined) {
    return incomplete({ problems: [problem] });
  }
  return representation({ entry, events: row.journal.events, identity });
}

/** The codes of a set of problems, deduplicated in first-seen order, for a check to name what stopped it. */
function codesOf({ problems }: { problems: readonly RulingAuditProblem[] }): readonly RulingAuditProblem["code"][] {
  return [...new Set(problems.map((problem) => problem.code))];
}

/** Why the entry's source or its one claiming ruling does not match the manifest — `undefined` when both do. */
function evidenceProblem({
  entry,
  entryIndex,
  events,
}: {
  entry: RulingManifestEntry;
  entryIndex: number;
  events: readonly RunEvent[];
}): RulingAuditProblem | undefined {
  const integrity = rulingSourceProblem({ event: expectedEvent({ entry }), events });
  if (integrity !== undefined) {
    return RulingAuditProblems.sourceInvalid({ entryIndex, integrity, slug: entry.slug });
  }
  const claims = rulingEvents({ events }).filter((event) => event.backfilledFrom === entry.sourceAtIso);
  const claim = claims[0];
  if (claims.length > 1) {
    return RulingAuditProblems.sourceRepresentationAmbiguous({ entryIndex, found: claims.length, slug: entry.slug });
  }
  if (claim !== undefined && claim.ruling !== entry.words) {
    return RulingAuditProblems.rulingWordsMismatch({ entryIndex, slug: entry.slug });
  }
  if (claim !== undefined && claim.anchor !== entry.anchor) {
    return RulingAuditProblems.rulingAnchorMismatch({
      actual: claim.anchor,
      entryIndex,
      expected: entry.anchor,
      slug: entry.slug,
    });
  }
  return undefined;
}

/** The reconstruction the manifest describes — what the source rule is asked about. */
function expectedEvent({ entry }: { entry: RulingManifestEntry }): RulingEvent {
  return {
    anchor: entry.anchor,
    atIso: entry.sourceAtIso,
    backfilledFrom: entry.sourceAtIso,
    decidedIso: entry.sourceAtIso,
    kind: "ruling",
    ruling: entry.words,
  };
}

/** Decided or unrepresented, once the evidence has checked out. */
function representation({
  entry,
  events,
  identity,
}: {
  entry: RulingManifestEntry;
  events: readonly RunEvent[];
  identity: { entryIndex: number; slug: string; sourceAtIso: string };
}): { readonly check: RulingManifestCheck; readonly problems: readonly RulingAuditProblem[] } {
  const claim = rulingEvents({ events }).find((event) => event.backfilledFrom === entry.sourceAtIso);
  if (claim === undefined) {
    return { check: { ...identity, status: "confirmed-unrepresented" }, problems: [] };
  }
  const placement = latestRulingEvent({ events }) === claim ? "effective" : "historical";
  return { check: { ...identity, placement, recordedAtIso: claim.atIso, status: "decided" }, problems: [] };
}
