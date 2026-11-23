/**
 * Every line `handover list` prints ABOVE and BELOW the board itself, as pure functions over the board's
 * own state.
 *
 * Split out of `./run.ts` under the file-size ratchet, and the split is what made these
 * testable: each was a `print*` that wrote through `logger` and returned nothing, so the only way to assert
 * on a truncation banner was to capture stdout. They return the exact arrays the caller writes, empty
 * strings included, and reach no clock, filesystem, environment or git.
 *
 * The `printBoard` caller is what decides stdout versus stderr, deliberately: a truncation caveat belongs
 * on STDOUT beside the board a reader pipes to a file, while the progress lines around it are diagnostics.
 * A module that returns lines cannot make that mistake for it.
 */
import { boardCompleteness } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc } from "../../../handover/doc.js";
import { matchesTagFilter, type TagFilter } from "../../../handover/tagFilter.js";
import { boardJsonText, type DetachedFindings, NO_BOARD_REFERENCES } from "./listJson.js";

/**
 * Say — on STDOUT, above the board — when the deadline cut the sweep short.
 *
 * On stdout deliberately, unlike every other progress line here. A truncated board is not a diagnostic about
 * how the board was produced; it is a caveat on the board's own content, and a reader piping stdout to a file
 * must not lose the sentence that says the rows below may be wrong.
 *
 * @param sweep what the probe sweep managed
 * @param budget the deadline in seconds, so the message names the flag that would lift it
 * @returns the banner lines, or nothing when the sweep was complete
 */
export function truncationBannerLines({
  sweep,
  budget,
}: {
  sweep: { readonly total: number; readonly unresolved: number };
  budget: number;
}): readonly string[] {
  if (sweep.unresolved === 0) {
    return [];
  }
  return [
    `⚠ TRUNCATED — the ${String(budget)}s probe deadline expired with ${String(sweep.unresolved)} of ` +
      `${String(sweep.total)} probe-carrying doc(s) unresolved.`,
    "  Those rows fall back to their AUTHORED status and may be wrong. Re-run with --deadline 0 for the whole board.",
    "",
  ];
}

/**
 * A loud warning, printed FIRST and ahead of everything else, when the board cannot account for its own scan.
 *
 * See {@link boardCompleteness}'s own doc comment for why this can never fire on the current composer, and
 * why the check stays here regardless.
 *
 * @param docs every doc the scan found
 * @param models what `composeBoardModels` returned for them
 * @returns the warning lines, or nothing when every scanned doc was placed
 */
export function completenessWarningLines({
  docs,
  models,
}: {
  docs: readonly HandoverDoc[];
  models: readonly BoardModel[];
}): readonly string[] {
  const completeness = boardCompleteness({ models, roots: docs });
  if (completeness.complete) {
    return [];
  }
  return [
    `⚠ INCOMPLETE — scanned ${String(docs.length)} doc(s) but the board placed only ` +
      `${String(docs.length - completeness.missing.length)}. Missing: ${completeness.missing.join(", ")}`,
    "",
  ];
}

/**
 * The footnote a typo'd `blockedBy` slug earns.
 *
 * Surfaced separately from the board above because a typo'd slug renders identically to a real dependency
 * there, and the difference is that one of them will never resolve on its own.
 *
 * @param models every doc's composed placement
 * @returns the footnote lines, or nothing when no slug is stuck
 */
export function stuckBlockerLines({ models }: { models: readonly BoardModel[] }): readonly string[] {
  const stuck = models.filter((model) => model.section === "NOT YET" && model.reason.startsWith("blockedBy names"));
  if (stuck.length === 0) {
    return [];
  }
  return ["", `${String(stuck.length)} doc(s) name a blockedBy slug that does not exist — a typo blocks forever.`];
}

/**
 * What an empty handover directory prints — two sentences for a reader, a rowless document for a caller.
 *
 * An empty board is a real answer rather than an error, so `--json` gets the SAME document with no rows.
 * A caller handed the two sentences instead would see no document at all and could not tell an empty
 * board from a verb that failed to print one.
 *
 * @param detached the journal sweep's findings — empty whenever the caller reaches this, carried so the
 *   rowless document says so rather than omitting the fields
 * @param json whether the caller asked for the document rather than the prose
 * @param filter the `--tag` filter asked for, reported back on the rowless document so a caller sees what it asked
 * @param scanStartedIso when the empty scan began, which the document carries as its bound
 * @returns the lines to write to stdout — exactly one, the document, under `--json`
 */
export function emptyBoardLines({
  detached,
  filter,
  handoverDir,
  json,
  scanStartedIso,
  unreadable,
}: {
  detached: DetachedFindings;
  filter: TagFilter;
  handoverDir: string;
  json: boolean;
  scanStartedIso: string;
  unreadable: readonly string[];
}): readonly string[] {
  if (json) {
    return [
      boardJsonText({
        detached,
        filter,
        handoverDir,
        models: [],
        references: NO_BOARD_REFERENCES,
        scanStartedIso,
        unreadable,
        unresolved: 0,
      }),
    ];
  }
  return [
    `No orchestration docs in ${handoverDir}.`,
    "Write one with /slopweaver:handover, or point --dir at where yours live.",
  ];
}

/**
 * The section under the board naming every run waiting on the owner whose doc no board row carries, and every journal
 * the sweep could not read — printed whatever `--all` or `--tag` say, because neither has a doc to judge.
 *
 * The remedy follows what is KNOWN about the doc: a doc proven gone earns `handover abandon`, whose orphan path
 * exists for exactly this; a doc that merely would not read earns "repair it", because abandoning on ignorance
 * would end a run whose doc is sitting right there.
 *
 * @param detached the journal sweep's findings
 * @returns the lines, or nothing when the sweep found nothing
 */
export function detachedAskLines({
  detached,
}: {
  detached: Pick<DetachedFindings, "detachedAsks" | "unreadJournals">;
}): readonly string[] {
  const lines: string[] = [];
  if (detached.detachedAsks.length > 0) {
    lines.push("", `WAITING ON OWNER, NO DOC ON THE BOARD (${String(detached.detachedAsks.length)})`);
  }
  for (const ask of detached.detachedAsks) {
    lines.push(`  ${ask.slug} — asked ${ask.askedIso}`, `    ${ask.question}`, `    journal: ${ask.journal}`);
    if (ask.doc.kind === "missing") {
      lines.push(
        "    its doc is in neither handovers/ nor handovers/archive/: restore it, or end the run with",
        `    slopweaver handover abandon ${ask.slug} --why "<why>"`,
      );
    } else {
      lines.push(`    its doc could not be read: ${ask.doc.why}`, "    repair it and re-run handover list");
    }
  }
  if (detached.unreadJournals.length > 0) {
    lines.push(
      "",
      `⚠ ${String(detached.unreadJournals.length)} journal(s) no board doc claims would not read, so a question ` +
        "one holds is on no surface:",
      ...detached.unreadJournals.map((unread) => `  ${unread.journal}: ${unread.why}`),
    );
  }
  return lines;
}

/**
 * The line above a `--tag`-filtered board: which terms, and how many of the rows the board would otherwise print
 * matched. Nothing when unfiltered.
 *
 * @param filter the parsed filter
 * @param population the rows the board prints unfiltered — live ones, closed ones too under `--all`
 * @returns the line, or none
 */
export function tagFilterSummaryLines({
  filter,
  population,
}: {
  filter: TagFilter;
  population: readonly BoardModel[];
}): readonly string[] {
  if (filter.terms.length === 0) {
    return [];
  }
  const matched = population.filter((model) => matchesTagFilter({ filter, tags: model.tags })).length;
  const terms = filter.terms.map((term) => term.text).join(",");
  return [`filtered by --tag ${terms}: ${String(matched)} of ${String(population.length)} row(s)`];
}

/**
 * The rows a `--tag` verdict may be wrong for, one line each: those whose journal could not be completely read,
 * matched or not, when some term names a key such a journal can leave wrong. A filter over doc fields alone
 * (`kind`, `priority`, `origin`, `repo`) warns nothing, because nothing it reads came from the journal. No cause
 * is claimed: an undecodable line and an unreadable file look the same here.
 *
 * @param filter the parsed filter
 * @param models every row the filter judged
 * @returns the warnings, for stderr
 */
export function incompleteTagWarningLines({
  filter,
  models,
}: {
  filter: TagFilter;
  models: readonly BoardModel[];
}): readonly string[] {
  if (!filter.readsJournal) {
    return [];
  }
  return models
    .filter((model) => model.tagsIncomplete)
    .map(
      (model) =>
        `handover list: ${model.doc.slug}: its journal could not be completely read, so its declared tags and ` +
        "its reply and run tags may be incomplete — the --tag verdict on it may be wrong",
    );
}
