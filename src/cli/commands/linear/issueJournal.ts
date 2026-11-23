/**
 * The autonomy-ledger half of an `--unasked` Linear issue write: after the outcome is known, write the row
 * that lets them steer the act retroactively (`docs/doctrine-rationale/rule-10.md` § The recording half).
 *
 * Effectful at one edge — the ledger append — and decided by `./unasked.ts`'s pure builders. An act the
 * fleet TRIED and could not confirm is a row too, under a `-unconfirmed` kind, whenever there is an issue to
 * name. A create with no issue to name yet either sent nothing that stands, and says so, or may have landed,
 * and prints the command that records it once it is found.
 */
import type { ReadIssue } from "../../../corpus/linear/write.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { type LinearIssueOutcome, outcomeLines } from "./core.js";
import type { UnaskedNote } from "./issueStepUpArgs.js";
import { inputFor, type WriteContext } from "./issueWrite.js";
import { unaskedKind, unaskedRow } from "./unasked.js";

/** The issue a row names, and whether the write is known to have landed on it. */
type Named = { readonly identifier: string; readonly url: string; readonly landed: boolean } | undefined;

/**
 * Which issue the row is about: the read-back's when the write landed, the pre-write read's when an update's
 * outcome is unknown, nothing when a create never landed or the write was a refused duplicate.
 *
 * @param outcome what became of the write
 * @param before the issue as the pre-write check read it, undefined for a create
 * @returns the issue to name, or undefined when there is none
 */
function namedIssue({ outcome, before }: { outcome: LinearIssueOutcome; before: ReadIssue | undefined }): Named {
  if (outcome.kind === "written" || outcome.kind === "landedAfterError") {
    return { identifier: outcome.identifier, landed: true, url: outcome.url };
  }
  if (outcome.kind === "duplicate" || before === undefined) {
    return undefined;
  }
  return { identifier: before.identifier, landed: false, url: before.url };
}

/** The exact command that records an act by hand, for when the verb could not. */
function handRecordLine({ kind, subject }: { kind: string; subject: string }): string {
  return (
    `record it by hand: slopweaver autonomy record --action-id <id> --kind ${kind} --subject ${subject} ` +
    "--by-session <session> --why <why> --said <said> --witness <what happened>"
  );
}

/**
 * A create with no issue to name. A refused duplicate and a create proven absent sent nothing that stands, so
 * there is nothing to record. An UNCONFIRMED or INDETERMINATE create may well have landed at the id it
 * reserved, with no URL to name it by yet — so it owes a row, and the command that records it once the issue
 * is found. Either way the outcome's own exit code already says the create is not confirmed.
 *
 * @param ctx the write context, whose `id` is where the create would have landed
 * @param kind the `-unconfirmed` kind the row would carry
 * @param outcome what became of the create
 */
function unnamedCreate({ ctx, kind, outcome }: { ctx: WriteContext; kind: string; outcome: LinearIssueOutcome }): void {
  if (outcome.kind === "duplicate" || outcome.kind === "failed") {
    ctx.deps.out(`autonomy: no row written — the ${outcome.kind} ${ctx.args.verb} sent nothing that stands`);
    return;
  }
  ctx.deps.err(`autonomy: the create may have landed at ${ctx.id} and has no row yet; find it with linear read`);
  ctx.deps.err(handRecordLine({ kind, subject: "<its URL>" }));
}

/**
 * Write the autonomy row for one `--unasked` write, or say why none was written.
 *
 * A row the ledger refuses AFTER the write landed leaves an unasked act unrecorded, so that path prints the
 * exact command that records it by hand and exits non-zero: the write stands, the row is owed.
 *
 * @param ctx the write context
 * @param note the three accounts the session gave
 * @param outcome what became of the write
 * @param before the issue as the pre-write check read it, undefined for a create
 * @returns an exit code that must override the write's own, or undefined when the write's own stands
 */
export async function journalUnasked({
  ctx,
  note,
  outcome,
  before,
}: {
  ctx: WriteContext;
  note: UnaskedNote;
  outcome: LinearIssueOutcome;
  before: ReadIssue | undefined;
}): Promise<number | undefined> {
  const base = unaskedKind({
    fieldsOnly: ctx.args.fieldsOnly,
    rewriteFiled: ctx.args.rewriteFiled !== undefined,
    verb: ctx.args.verb,
  });
  const named = namedIssue({ before, outcome });
  if (named === undefined) {
    unnamedCreate({ ctx, kind: `${base}-unconfirmed`, outcome });
    return undefined;
  }
  const kind = named.landed ? base : `${base}-unconfirmed`;
  const built = unaskedRow({
    doneIso: ctx.deps.nowIso(),
    id: ctx.id,
    identifier: named.identifier,
    input: inputFor({ ctx }),
    kind,
    note,
    outcome: outcomeLines({ outcome, verb: ctx.args.verb })[0]!,
    url: named.url,
  });
  if (built.isErr()) {
    ctx.deps.err(`autonomy: the write stands but its ledger row did NOT record: ${built.error.message}`);
    ctx.deps.err(handRecordLine({ kind, subject: named.url }));
    return EXIT_ERROR;
  }
  const row = built.value;
  const written = await ctx.deps.autonomy.appendRecord({ home: ctx.home, record: row });
  if (written.isErr()) {
    ctx.deps.err(`autonomy: the write stands but its ledger row did NOT record: ${written.error.message}`);
    ctx.deps.err(handRecordLine({ kind, subject: named.url }));
    return EXIT_ERROR;
  }
  ctx.deps.out(`autonomy: ${row.actionId} ${written.value.appended ? "recorded" : "already recorded"} (${row.kind})`);
  return undefined;
}
