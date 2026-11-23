/**
 * THE BOARD HYGIENE READER — the standing grooming leg over the orchestration board itself.
 *
 * Board grooming is a standing practice: a one-off pass that retires episodic
 * docs and fixes malformed entries is not enough — the board rots because nothing grooms it on a cadence.
 * This is that cadence's reader: it reports five friction classes — episodic
 * docs stuck in a live state, docs with no probe, malformed `doneWhen:` entries, `blockedBy` slugs naming
 * nothing, and `ready` docs sitting untouched — the way `./brief.ts` reports friction elsewhere: read,
 * measure, print. It writes nothing to the board.
 *
 * ## Why this is its own module, never a `mineSubstrates` collector
 *
 * `./brief.ts`'s own header is explicit: "Tier 2: the board, asked only whether a finding is already
 * covered. Never a source of findings... stops a later change from quietly making the board a source."
 * Folding board hygiene into `FrictionFinding`/`REFLECT_SOURCES` would be exactly that change. So this
 * reader has its own report shape and its own CLI verb (`reflect board`), mirroring `reflect telemetry`'s
 * standalone read-and-print shape rather than `collect*.ts`'s finding-pipeline shape.
 *
 * ## Why report-only is not a placeholder
 *
 * `reflect brief`'s own shell states the owner's autonomy ceiling for this loop: T0 — REPORT, no board
 * doc, no pull request, no message, nothing outside the machine, until the owner has seen what it even finds.
 * Retiring a doc is a WRITE to a board other sessions are reading concurrently — the exact blast radius
 * `hex-first-class-integration`'s own `blockedBy` accident showed. So
 * this reader never calls `handover abandon`; it prints slugs a human (or a future, explicitly-approved
 * pass) can act on. Escalating to auto-retire is a decision for the owner to make once they have seen a
 * week of this leg's reports, not one this module makes for them.
 *
 * ## What "RUN NOW" here approximates, and what it does not
 *
 * The real `RUN NOW` placement (`../handover/boardEvidence.ts`) needs every doc's probes EVALUATED — running
 * `command:` probes and reading repository files — which is exactly what makes `handover list` take over
 * two minutes on this board. This reader stays cheap: {@link staleReadyDocs} only ever names a `ready` doc
 * with NO run ever attempted, NO `blockedBy` outstanding and NO parse problems, aged by file mtime. That
 * is a strict subset of `RUN NOW` — sound whenever a doc declares no `doneWhen:` (nothing could have
 * "landed"), but a doc that DOES declare probes and would read `LOOKS SHIPPED` on a real `handover list`
 * is invisible here rather than reported as `RUN NOW`. {@link readBoardHygiene} says so in its own residue
 * line rather than pretending the two are the same.
 *
 * Pure over injected seams: no filesystem, no clock, no subprocess. `../handover/store.ts`'s `scanBoard`
 * is not called here for the same reason no other `reflect` collector calls it — every read here goes
 * through {@link SubstrateReader} so a test runs against an in-memory fixture, never the operator's real
 * board.
 */
import { join } from "node:path";

import { runDisposition } from "../handover/boardTypes.js";
import { derivedRowState } from "../handover/derivedRowState.js";
import { type HandoverDoc, isTerminalDocStatus, parseHandoverDoc } from "../handover/doc.js";
import { parseLedger } from "../handover/ledger.js";
import type { SubstrateReader } from "./substrate.js";

/**
 * Members a slug-prefix group needs before it counts as "episodic docs stuck in a live state" rather than
 * an ordinary handful of related work. Set below the 34+11 the owner's ruling measured for two families of
 * per-session standing-loop and supervisor-handoff docs, and above the 2-3 a legitimately recurring family
 * of docs tends to carry.
 *
 * @internal
 */
export const EPISODIC_GROUP_THRESHOLD = 6;

/**
 * Days a `ready`, never-started, unblocked doc may sit before it is reported as stale backlog.
 *
 * @internal
 */
export const STALE_READY_DAYS = 7;

/**
 * Slugs shown per category before a report says "and N more" — rule 7, never a wall.
 *
 * @internal
 */
export const HYGIENE_LIST_CAP = 8;

/**
 * The trailing "episodic session record" shape this pass can recognise: a dated cut (`-29aug-p`,
 * `-22aug-weekend`) or a bare numbered cut (`-12`). Deliberately narrow — over-matching would merge
 * unrelated one-off docs into a false group, and {@link EPISODIC_GROUP_THRESHOLD} already makes a false
 * NEGATIVE (an episodic family this misses) the safe failure mode.
 *
 * @internal
 */
const EPISODIC_SUFFIX = /-(\d{1,2}[a-z]{3}(-[a-z]+)?|\d{1,3})$/;

/**
 * The slug with its trailing episodic-cut suffix removed, or the slug unchanged when it carries none.
 *
 * @param slug the doc's own stable identifier
 * @returns the family prefix two cuts of the same standing session share
 */
export function episodicPrefixOf({ slug }: { slug: string }): string {
  return slug.replace(EPISODIC_SUFFIX, "");
}

/**
 * One family of episodic docs sharing a prefix, all in a live state, none with a run open right now.
 *
 * @internal
 */
export interface EpisodicGroup {
  readonly prefix: string;
  readonly count: number;
  /** The family's own slugs, capped at {@link HYGIENE_LIST_CAP}. */
  readonly sample: readonly string[];
}

/**
 * One doc whose `blockedBy` names a slug no doc on the board, or in `archive/`, claims.
 *
 * @internal
 */
export interface DeadBlockedBy {
  readonly slug: string;
  readonly missing: readonly string[];
}

/**
 * One doc whose front-matter failed to parse cleanly — a malformed `doneWhen:` entry among the causes.
 *
 * @internal
 */
export interface MalformedDoc {
  readonly slug: string;
  readonly problems: readonly string[];
}

/**
 * One `ready`, never-started, unblocked doc that has sat past {@link STALE_READY_DAYS}.
 *
 * @internal
 */
export interface StaleReadyDoc {
  readonly slug: string;
  readonly ageDays: number;
}

/**
 * One run over the board's own hygiene — the standing leg's whole output.
 *
 * @internal
 */
export interface BoardHygieneReport {
  readonly docsScanned: number;
  readonly episodicGroups: readonly EpisodicGroup[];
  /** Live-state slugs declaring neither `doneWhen:` nor `outputs:`, capped at {@link HYGIENE_LIST_CAP}. */
  readonly noProbeSlugs: readonly string[];
  readonly noProbeTotal: number;
  readonly malformed: readonly MalformedDoc[];
  readonly deadBlockedBy: readonly DeadBlockedBy[];
  readonly staleReadyDocs: readonly StaleReadyDoc[];
  /** What this pass could not establish, never dropped silently — an unreadable doc, an unreadable mtime. */
  readonly residue: readonly string[];
}

/** Whether a doc's current run cycle is open right now — the one state this pass must never touch. */
function hasOpenRun({ slug, runsDir, reader }: { slug: string; runsDir: string; reader: SubstrateReader }): boolean {
  const text = reader.readText(join(runsDir, `${slug}.jsonl`));
  if (text === undefined) {
    return false;
  }
  const parsed = parseLedger({ text });
  const disposition = runDisposition({ events: parsed.events, unreadableLines: parsed.unreadable });
  return disposition.kind === "active" || disposition.kind === "waiting-on-owner";
}

/**
 * A row's DERIVED status — this pass's answer to "is this row live", replacing the `status:` line it used to
 * filter on.
 *
 * This reader is named in `../handover/derivedRowState.ts`'s own header as one of the cheap readers whose
 * disagreement with `handover list` IS the defect: `liveDocs` below filtered on the authored line, so a row
 * settled or closed in its register stayed in every count this pass prints. Reading the journal here costs
 * one already-injected `readText` per doc, which this pass was doing for {@link everStarted} anyway.
 */
function derivedStatusOf({
  doc,
  runsDir,
  reader,
}: {
  doc: HandoverDoc;
  runsDir: string;
  reader: SubstrateReader;
}): HandoverDoc["status"] {
  const text = reader.readText(join(runsDir, `${doc.slug}.jsonl`));
  const events = text === undefined ? [] : parseLedger({ text }).events;
  return derivedRowState({ doc, events }).status;
}

/** Whether a slug ever opened a run cycle at all, open or closed. */
function everStarted({ slug, runsDir, reader }: { slug: string; runsDir: string; reader: SubstrateReader }): boolean {
  return reader.readText(join(runsDir, `${slug}.jsonl`)) !== undefined;
}

/** A doc's `blockedBy` slugs that resolve against neither a live board root nor an archived doc. */
function unresolvedBlockedBy({
  doc,
  knownSlugs,
  handoverDir,
  reader,
}: {
  doc: HandoverDoc;
  knownSlugs: ReadonlySet<string>;
  handoverDir: string;
  reader: SubstrateReader;
}): readonly string[] {
  return doc.blockedBy.filter((slug) => {
    if (knownSlugs.has(slug)) {
      return false;
    }
    return reader.readText(join(handoverDir, "archive", `${slug}.md`)) === undefined;
  });
}

/** Every live-state (non-terminal-status) doc sharing a slug-prefix family with no run open anywhere in it. */
function episodicGroups({
  liveDocs,
  runsDir,
  reader,
  threshold,
}: {
  liveDocs: readonly HandoverDoc[];
  runsDir: string;
  reader: SubstrateReader;
  threshold: number;
}): readonly EpisodicGroup[] {
  const groups = new Map<string, HandoverDoc[]>();
  for (const doc of liveDocs) {
    const prefix = episodicPrefixOf({ slug: doc.slug });
    if (prefix === doc.slug) {
      continue;
    }
    // The first live doc in a slug-prefix family opens it; every later one joins it.
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix)!.push(doc);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length >= threshold)
    .filter(([, members]) => members.every((doc) => !hasOpenRun({ reader, runsDir, slug: doc.slug })))
    .map(([prefix, members]) => ({
      count: members.length,
      prefix,
      sample: members.slice(0, HYGIENE_LIST_CAP).map((doc) => doc.slug),
    }))
    .toSorted((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
}

/**
 * `ready`, never-started, unblocked, parse-clean docs older than `staleDays` by file modification time.
 *
 * A strict subset of the board's real `RUN NOW` section — see the module header for exactly what this
 * excludes and why that is the safe direction to be wrong in.
 */
function staleReadyDocs({
  liveDocs,
  runsDir,
  reader,
  mtimeIso,
  nowIso,
  staleDays,
  residue,
}: {
  liveDocs: readonly HandoverDoc[];
  runsDir: string;
  reader: SubstrateReader;
  mtimeIso: (args: { path: string }) => string | undefined;
  nowIso: string;
  staleDays: number;
  residue: string[];
}): readonly StaleReadyDoc[] {
  const found: StaleReadyDoc[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (const doc of liveDocs) {
    if (derivedStatusOf({ doc, reader, runsDir }) !== "ready" || doc.blockedBy.length > 0 || doc.problems.length > 0) {
      continue;
    }
    if (everStarted({ reader, runsDir, slug: doc.slug })) {
      continue;
    }
    const mtime = mtimeIso({ path: doc.path });
    if (mtime === undefined) {
      residue.push(`${doc.slug}: file modification time unreadable, so its age is unknown rather than fresh`);
      continue;
    }
    const ageDays = Math.floor((Date.parse(nowIso) - Date.parse(mtime)) / dayMs);
    if (ageDays >= staleDays) {
      found.push({ ageDays, slug: doc.slug });
    }
  }
  return found.toSorted((a, b) => b.ageDays - a.ageDays);
}

/** Every top-level `.md` doc under `handoverDir`, parsed — an unreadable one becomes residue, never dropped. */
function scanDocs({
  handoverDir,
  reader,
  residue,
}: {
  handoverDir: string;
  reader: SubstrateReader;
  residue: string[];
}): readonly HandoverDoc[] {
  const docs: HandoverDoc[] = [];
  for (const name of reader
    .listNames(handoverDir)
    .filter((entry) => entry.endsWith(".md"))
    .toSorted((a, b) => a.localeCompare(b))) {
    const path = join(handoverDir, name);
    const text = reader.readText(path);
    if (text === undefined) {
      residue.push(`${name} could not be read, so its hygiene is unknown rather than clean`);
      continue;
    }
    docs.push(parseHandoverDoc({ path, text }));
  }
  return docs;
}

/** Every doc whose `blockedBy` names at least one slug resolving against neither the board nor the archive. */
function deadBlockedByOf({
  docs,
  knownSlugs,
  handoverDir,
  reader,
}: {
  docs: readonly HandoverDoc[];
  knownSlugs: ReadonlySet<string>;
  handoverDir: string;
  reader: SubstrateReader;
}): readonly DeadBlockedBy[] {
  const found: DeadBlockedBy[] = [];
  for (const doc of docs) {
    if (doc.blockedBy.length === 0) {
      continue;
    }
    const missing = unresolvedBlockedBy({ doc, handoverDir, knownSlugs, reader });
    if (missing.length > 0) {
      found.push({ missing, slug: doc.slug });
    }
  }
  return found;
}

/**
 * Read every top-level orchestration doc and report the board's own hygiene.
 *
 * @param handoverDir the top-level handovers directory
 * @param runsDir the run-journal directory
 * @param nowIso the instant to age every doc against
 * @param reader the filesystem seam every other `reflect` collector shares
 * @param mtimeIso a doc's last-modified instant, or `undefined` when it could not be read — the one seam
 *   this reader alone needs, kept separate from {@link SubstrateReader} so no other collector's fixture
 *   has to grow an unused method
 * @param episodicThreshold members an episodic family needs before it is reported
 * @param staleDays how many days a `ready`, never-started doc may sit before it is reported
 * @returns the board's hygiene, as five bounded categories plus what could not be established
 */
export function readBoardHygiene({
  handoverDir,
  runsDir,
  nowIso,
  reader,
  mtimeIso,
  episodicThreshold = EPISODIC_GROUP_THRESHOLD,
  staleDays = STALE_READY_DAYS,
}: {
  handoverDir: string;
  runsDir: string;
  nowIso: string;
  reader: SubstrateReader;
  mtimeIso: (args: { path: string }) => string | undefined;
  episodicThreshold?: number;
  staleDays?: number;
}): BoardHygieneReport {
  const residue: string[] = [
    "`RUN NOW` here is approximated without probe evaluation (never-started + ready + unblocked + parse-clean, by file age) — a doc with `doneWhen:` probes that already pass reads `LOOKS SHIPPED` on a real `handover list`, not `RUN NOW`; run that for the full picture.",
  ];
  const docs = scanDocs({ handoverDir, reader, residue });

  const knownSlugs = new Set(docs.map((doc) => doc.slug));
  const liveDocs = docs.filter((doc) => !isTerminalDocStatus(derivedStatusOf({ doc, reader, runsDir })));

  const noProbe = liveDocs.filter((doc) => doc.doneWhen.length === 0 && doc.outputs.length === 0);

  const malformed: MalformedDoc[] = docs
    .filter((doc) => doc.problems.length > 0)
    .map((doc) => ({ problems: doc.problems, slug: doc.slug }));

  return {
    deadBlockedBy: deadBlockedByOf({ docs, handoverDir, knownSlugs, reader }),
    docsScanned: docs.length,
    episodicGroups: episodicGroups({ liveDocs, reader, runsDir, threshold: episodicThreshold }),
    malformed,
    noProbeSlugs: noProbe.slice(0, HYGIENE_LIST_CAP).map((doc) => doc.slug),
    noProbeTotal: noProbe.length,
    residue,
    staleReadyDocs: staleReadyDocs({ liveDocs, mtimeIso, nowIso, reader, residue, runsDir, staleDays }),
  };
}

/**
 * Render a hygiene report as terminal lines: outcome above the fold, capped lists below it — rule 7.
 *
 * @param report the report to render
 * @returns the lines to print, in order
 */
export function renderBoardHygieneLines({ report }: { report: BoardHygieneReport }): readonly string[] {
  const lines = [`reflect board: ${String(report.docsScanned)} doc(s) scanned`];
  const capped = ({ names, total }: { names: readonly string[]; total: number }): string =>
    total <= HYGIENE_LIST_CAP ? names.join(", ") : `${names.join(", ")} and ${String(total - names.length)} more`;

  lines.push(
    `  episodic families in a live state (>= ${String(EPISODIC_GROUP_THRESHOLD)} docs, none with a run open):`,
  );
  if (report.episodicGroups.length === 0) {
    lines.push("    none");
  }
  for (const group of report.episodicGroups) {
    lines.push(
      `    - ${group.prefix}-*: ${String(group.count)} doc(s), e.g. ${capped({ names: group.sample, total: group.count })}`,
    );
  }

  lines.push(`  no doneWhen/outputs declared: ${String(report.noProbeTotal)} doc(s)`);
  if (report.noProbeTotal > 0) {
    lines.push(`    e.g. ${capped({ names: report.noProbeSlugs, total: report.noProbeTotal })}`);
  }

  lines.push(`  malformed front-matter: ${String(report.malformed.length)} doc(s)`);
  for (const doc of report.malformed.slice(0, HYGIENE_LIST_CAP)) {
    lines.push(`    - ${doc.slug}: ${doc.problems[0]!}`);
  }

  lines.push(`  blockedBy names nothing: ${String(report.deadBlockedBy.length)} doc(s)`);
  for (const doc of report.deadBlockedBy.slice(0, HYGIENE_LIST_CAP)) {
    lines.push(`    - ${doc.slug}: ${doc.missing.join(", ")}`);
  }

  lines.push(
    `  ready, never-started, unblocked, untouched >= ${String(STALE_READY_DAYS)}d: ${String(report.staleReadyDocs.length)} doc(s)`,
  );
  for (const doc of report.staleReadyDocs.slice(0, HYGIENE_LIST_CAP)) {
    lines.push(`    - ${doc.slug}: ${String(doc.ageDays)}d`);
  }

  lines.push("  COULD NOT VERIFY:");
  for (const line of report.residue) {
    lines.push(`    - ${line}`);
  }
  return lines;
}
