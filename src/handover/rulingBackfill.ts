/**
 * Write the rulings a reviewed manifest names, as `ruling` events reconstructed from the answers that recorded
 * them — the third piece of the ruling backfill: the event kind, the audit that reads it, and this, the backfill
 * of the 39 standing rulings.
 *
 * ## It decides nothing the audit has not already decided
 *
 * `./rulingAudit.ts` already says, per manifest entry, whether the row reads it as decided, whether the source
 * answer checks out and nothing represents it, or whether the input is not known well enough to say. This
 * module maps those three onto `already-recorded`, `append` and `refused`, and asks `./ruling.ts`'s own append
 * guard one further question the audit does not: whether the event it is about to write would be refused as a
 * duplicate of a ruling already on that row. Nothing here re-derives source matching, placement or provenance.
 *
 * ## One entry's trouble is not another's
 *
 * A row with two documents, an unreadable journal or a line that did not decode refuses ITS entries and no
 * others — the 39 sit on 31 rows, and one bad row must not cost the other thirty. The exception is an
 * unreadable DOC or DIRECTORY, which the audit propagates to every entry because the file it could not read
 * might be a second document claiming any slug.
 *
 * ## Re-read before every append
 *
 * The state is acquired again before each write and the entry re-planned against it, so a document that
 * changed, a journal that broke, or a ruling another run appended in between is seen rather than written over.
 * That narrows the window; it does not close it. This is sequential-rerun idempotence, not a lock — run one
 * writer at a time.
 *
 * Pure but for the injected {@link RulingBackfillDeps}: no filesystem and no clock are reached from here.
 */

import { absentAsEmpty } from "#lib/absent.js";
import type { RulingEvent } from "./ledger.js";
import { rulingAppendProblem } from "./ruling.js";
import { auditRulings } from "./rulingAudit.js";
import type { RulingAuditInput, RulingAuditReport, RulingManifestCheck } from "./rulingAuditTypes.js";
import { type RulingBackfillFailure, RulingBackfillFailures } from "./rulingBackfillErrors.js";
import type {
  RulingBackfillDeps,
  RulingBackfillEntry,
  RulingBackfillPlan,
  RulingBackfillReport,
} from "./rulingBackfillTypes.js";
import type { RulingManifestEntry } from "./rulingManifest.js";

/**
 * The reconstruction a manifest entry describes.
 *
 * Both source fields are the answer's own instant, which is what the decoder and the write schema require of a
 * backfilled ruling: it is DECIDED when the owner answered, and recorded now.
 *
 * @param entry the reviewed answer
 * @param recordedAtIso the instant this line is being written
 * @returns the event to append
 */
export function backfilledRulingEvent({
  entry,
  recordedAtIso,
}: {
  entry: RulingManifestEntry;
  recordedAtIso: string;
}): RulingEvent {
  return {
    anchor: entry.anchor,
    atIso: recordedAtIso,
    backfilledFrom: entry.sourceAtIso,
    decidedIso: entry.sourceAtIso,
    kind: "ruling",
    ruling: entry.words,
  };
}

/**
 * What this state says should happen to each reviewed answer.
 *
 * @param input the board, the archive, the journals and the manifest, as acquired
 * @returns the audit it read and one verdict per manifest entry, in manifest order
 */
export function planRulingBackfill({ input }: { input: RulingAuditInput }): RulingBackfillPlan {
  const audit = auditRulings({ input });
  const eventsBySlug = new Map(input.rows.map((row) => [row.slug, row.journal]));
  return {
    audit,
    entries: audit.manifest.map((check) =>
      planEntry({ check, entries: absentAsEmpty({ value: input.manifest?.entries }), eventsBySlug }),
    ),
  };
}

/** One entry's verdict, from the audit's own check plus the append guard's answer about this exact event. */
function planEntry({
  check,
  entries,
  eventsBySlug,
}: {
  check: RulingManifestCheck;
  entries: readonly RulingManifestEntry[];
  eventsBySlug: ReadonlyMap<string, RulingAuditInput["rows"][number]["journal"]>;
}): RulingBackfillEntry {
  const entry = entries[check.entryIndex]!;
  const identity = { entry, entryIndex: check.entryIndex };
  if (check.status === "incomplete") {
    return { ...identity, codes: check.codes, failure: null, status: "refused" };
  }
  if (check.status === "decided") {
    return { ...identity, placement: check.placement, recordedAtIso: check.recordedAtIso, status: "already-recorded" };
  }
  const failure = appendRefusal({ entry, journal: eventsBySlug.get(entry.slug) });
  if (failure !== undefined) {
    return { ...identity, codes: [], failure, status: "refused" };
  }
  return { ...identity, status: "append" };
}

/**
 * Why the append seam would refuse this entry's event — `undefined` when it would take it.
 *
 * The audit says the source is unrepresented; this asks the WRITER's own guard, which also refuses a ruling
 * identical in words, anchor and decision instant to one already recorded. A live ruling recorded at the
 * answer's own instant is exactly that collision, and it is a refusal rather than a silent skip: the row does
 * carry that decision, but not as a reconstruction anything can trace back to the answer.
 */
function appendRefusal({
  entry,
  journal,
}: {
  entry: RulingManifestEntry;
  journal: RulingAuditInput["rows"][number]["journal"] | undefined;
}): RulingBackfillFailure | undefined {
  if (journal === undefined || journal.kind === "failed") {
    return undefined;
  }
  // The recording instant is not sampled during planning, and this guard does not read it: the identity it
  // compares is words, anchor and DECISION instant. The entry's own source instant stands in for it here.
  const problem = rulingAppendProblem({
    event: backfilledRulingEvent({ entry, recordedAtIso: entry.sourceAtIso }),
    events: journal.events,
  });
  return problem === undefined ? undefined : RulingBackfillFailures.integrityFailed({ cause: problem });
}

/**
 * The plan, as a report — the read-only mode, which writes nothing.
 *
 * @param input the acquired state
 * @returns the report
 */
export function reportRulingBackfillPlan({ input }: { input: RulingAuditInput }): RulingBackfillReport {
  const plan = planRulingBackfill({ input });
  return report({ audit: plan.audit, entries: plan.entries, input, mode: "plan" });
}

/**
 * Apply the manifest: walk it in order, re-read the state before each append, and write only what is still
 * missing.
 *
 * @param input the state as first acquired, carrying the manifest
 * @param deps the reader, the write seam and the clock
 * @returns the report, one entry per reviewed answer
 */
export function applyRulingBackfill({
  deps,
  input,
}: {
  deps: RulingBackfillDeps;
  input: RulingAuditInput;
}): RulingBackfillReport {
  const planned = planRulingBackfill({ input });
  const entries: RulingBackfillEntry[] = [];
  let audit = planned.audit;
  for (const entry of planned.entries) {
    if (entry.status !== "append") {
      entries.push(entry);
      continue;
    }
    // Re-read before each append: a document, a journal or another run may have moved since the plan.
    const current = deps.readCurrentInput();
    const replanned = planRulingBackfill({ input: current });
    audit = replanned.audit;
    const fresh = replanned.entries[entry.entryIndex];
    if (fresh?.status !== "append") {
      entries.push(fresh ?? entry);
      continue;
    }
    entries.push(appendOne({ current, deps, entry: entry.entry, entryIndex: entry.entryIndex }));
  }
  return report({ audit, entries, input, mode: "apply" });
}

/** Sample the instant, write the one event, and say what the seam answered. */
function appendOne({
  current,
  deps,
  entry,
  entryIndex,
}: {
  current: RulingAuditInput;
  deps: RulingBackfillDeps;
  entry: RulingManifestEntry;
  entryIndex: number;
}): RulingBackfillEntry {
  const recordedAtIso = deps.recordingInstant();
  const written = deps.append({
    event: backfilledRulingEvent({ entry, recordedAtIso }),
    runsDir: current.runsDir,
    slug: entry.slug,
  });
  if (written.isErr()) {
    return {
      entry,
      entryIndex,
      failure: RulingBackfillFailures.appendFailed({ cause: written.error }),
      status: "failed",
    };
  }
  return { entry, entryIndex, journalPath: written.value.path, recordedAtIso, status: "appended" };
}

/** Count the entries and say whether anything at all was unresolved. */
function report({
  audit,
  entries,
  input,
  mode,
}: {
  audit: RulingAuditReport;
  entries: readonly RulingBackfillEntry[];
  input: RulingAuditInput;
  mode: "plan" | "apply";
}): RulingBackfillReport {
  const counted = ({ status }: { status: RulingBackfillEntry["status"] }): number =>
    entries.filter((entry) => entry.status === status).length;
  const refused = counted({ status: "refused" });
  const failed = counted({ status: "failed" });
  return {
    complete: audit.problems.length === 0 && refused === 0 && failed === 0,
    counts: {
      alreadyRecorded: counted({ status: "already-recorded" }),
      append: counted({ status: "append" }),
      appended: counted({ status: "appended" }),
      failed,
      manifestEntries: entries.length,
      refused,
    },
    entries,
    mode,
    problems: audit.problems,
    schemaVersion: 1,
    scope: { handoverDir: input.handoverDir, manifestPath: input.manifestPath, runsDir: input.runsDir },
  };
}

/**
 * The exit code a report earns.
 *
 * @param report the finished report
 * @returns 0 when nothing was refused, nothing failed and the audit read everything, otherwise 1
 */
export function rulingBackfillExitCode({ report: finished }: { report: RulingBackfillReport }): 0 | 1 {
  return finished.complete ? 0 : 1;
}
