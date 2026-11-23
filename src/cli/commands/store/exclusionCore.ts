/**
 * The PURE core of `slopweaver store exclusions` — its flags, its parsers, and every rendered line.
 *
 * Separate from {@link ./exclusion} for the reason every other verb's core is: nothing interesting here
 * needs Postgres. That a preview and an apply print differently, that a detector proposal renders as the
 * denylist line an operator would paste, and that a purge report says what it could NOT act on — all of it
 * is a function of numbers, and a test that needed a database would not run in the unit lane at all.
 */

import type { SyncExclusionProposal } from "../../../corpus/syncExclusionDetector.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { PurgeReport } from "../../../store/syncExclusionStore.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type StoreCommandError, StoreCommandErrors } from "./errors.js";

/** `store exclusions` takes which verb to run, where the store is, whether an apply is meant, and the mode. */
const EXCLUSION_FLAGS: FlagSpec = { boolean: ["json", "apply", "delete-human-threads"], string: ["home"] };

/** What an invocation asked for. */
export interface ExclusionArgs {
  /** `detect` proposes pairs; `purge` counts or removes what the denylist already covers. */
  readonly verb: "detect" | "purge";
  readonly apply: boolean;
  /** True when `--delete-human-threads` waived rule D, taking the replied-under rows as well. */
  readonly deleteHumanThreads: boolean;
  readonly json: boolean;
  readonly home?: string;
}

/**
 * Read the invocation, refusing anything the verb does not mean.
 *
 * `--apply` on `detect` is refused rather than ignored, because detection CANNOT apply anything — the whole
 * safety property is that a proposal becomes policy only when a person writes it down. A flag that parsed
 * and then silently did nothing would be the one an operator later swears they passed.
 *
 * @param rest the argv tail after the noun and verb
 * @returns what was asked for, or every reason it was refused
 */
export function parseExclusionArgs({ rest }: { rest: readonly string[] }): Result<ExclusionArgs, StoreCommandError> {
  const verbWord = rest[0];
  if (verbWord !== "detect" && verbWord !== "purge") {
    return err(StoreCommandErrors.exclusionVerbUnknown({ got: verbWord }));
  }
  const parsed = parseFlags({ args: rest.slice(1), spec: EXCLUSION_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const apply = values["apply"] === true;
  const deleteHumanThreads = values["delete-human-threads"] === true;
  if (verbWord === "detect" && apply) {
    return err(StoreCommandErrors.exclusionApplyRefused());
  }
  if (verbWord === "detect" && deleteHumanThreads) {
    return err(StoreCommandErrors.exclusionDeleteHumanThreadsRefused());
  }
  const home = values["home"];
  return ok({
    apply,
    deleteHumanThreads,
    json: values["json"] === true,
    verb: verbWord,
    ...(typeof home === "string" ? { home } : {}),
  });
}

/**
 * Render the detector's proposals as the lines an operator acts on.
 *
 * The denylist line is printed rather than described, because the act this report is asking for is a paste
 * into a file — and a report that made someone reconstruct the syntax from a table is a report that gets
 * the syntax wrong once.
 *
 * @param proposals what the detector found, already ordered
 * @param path where the denylist those lines belong in lives
 * @returns the report lines, stderr-bound
 */
export function detectLines({
  proposals,
  path,
}: {
  proposals: readonly SyncExclusionProposal[];
  path: string;
}): readonly string[] {
  if (proposals.length === 0) {
    return ["no (app, channel) pair is dominant enough to propose — nothing in this store reads as pure alert traffic"];
  }
  const rows = proposals.reduce((total, one) => total + one.appRows, 0);
  return [
    `${String(proposals.length)} pair(s) read as pure alert traffic, holding ${String(rows)} row(s):`,
    ...proposals.map(
      (one) =>
        `  ${one.denylistLine}` +
        `  —  ${String(one.appRows)} of ${String(one.channelRows)} row(s), ${String(one.share)}% of the channel`,
    ),
    "",
    `nothing has changed. To act on a pair, add its line above to ${path}, then run:`,
    "  slopweaver store exclusions purge          # counts what it would delete",
    "  slopweaver store exclusions purge --apply  # deletes it",
  ];
}

/**
 * Render what a purge would do, or did.
 *
 * The before and after counts are both printed on an apply even though one is derivable from the other,
 * because the owner asked for the count before and after by name and a reader checking a destructive act
 * should not have to do arithmetic to see it.
 *
 * The rule-D line is rendered from {@link PurgeReport.keptHumanThreads} rather than from the count alone,
 * because the same number means opposite things in the two modes — held back, or taken anyway — and a
 * report that printed one figure under one sentence would be wrong in whichever mode it was not written for.
 *
 * @param report what the purge selected and, when applied, removed
 * @returns the report lines, stderr-bound
 */
export function purgeLines({ report }: { report: PurgeReport }): readonly string[] {
  const head = report.applied
    ? [`store had ${String(report.before)} row(s); deleted ${String(report.deleted)}; now ${String(report.after)}`]
    : [
        `store holds ${String(report.before)} row(s). The denylist selects ${String(report.candidates)} of them.`,
        "Nothing has been deleted — this is a preview. Add --apply to delete.",
      ];
  return [
    ...head,
    ruleDLine({ report }),
    ...(report.unresolvedIds.length === 0
      ? []
      : [
          `${String(report.unresolvedIds.length)} denylist id(s) name no column this store records, so a purge ` +
            "cannot act on them: a user id reaches the store only through a person row that identity " +
            "reconciliation may have merged with other handles, and deleting by that would delete rows a " +
            "different identity wrote. They still apply at ingest, where the raw payload is present.",
        ]),
    "bronze is untouched, so re-ingesting it with the denylist line removed restores these rows.",
  ];
}

/**
 * What the purge did about a denied row a human replied under.
 *
 * "a FURTHER" in the keeping case is load-bearing, not decoration. The count above it is what the delete
 * takes, and in this mode the rule-D rows are outside it — a line reading "kept 92 of them" would invite
 * the reader to subtract a number that has already been subtracted.
 *
 * @param report the purge report the mode was recorded on
 * @returns the one line describing rule D's effect on this run
 */
function ruleDLine({ report }: { report: PurgeReport }): string {
  const rows = `${String(report.retainedByRuleD)} denied row(s)`;
  if (report.keptHumanThreads) {
    return (
      `rule D held back a further ${rows} a human replied under, so those threads keep their parent. Pass ` +
      "--delete-human-threads to take them too."
    );
  }
  return (
    `--delete-human-threads: ${rows} a human replied under go as well, and every existing such record is deleted retroactively. ` +
    "Their replies will have no parent in the store."
  );
}

/**
 * The flags `store exclusions` advertises, for the help-truth ratchet.
 *
 * Spelled here rather than derived from the spec because the spec is module-private and the ratchet needs
 * the advertised list; the parser's own refusal of an unknown flag is what keeps the two honest.
 */
export const STORE_EXCLUSION_FLAG_NAMES: readonly string[] = ["--apply", "--delete-human-threads", "--home", "--json"];
