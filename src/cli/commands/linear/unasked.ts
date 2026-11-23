/**
 * A Linear issue write taken WITHOUT ASKING — its rails and its autonomy-ledger row. Pure.
 *
 * Graduated autonomy for Linear: the stakes are a little lower there, since a wrong edit rolls back and the
 * issue has a whole activity history. So an obvious edit on Acme work is TAKEN, and the two
 * halves rule 10 always pairs come with it: the act is RECORDED, and what still needs them is refused here
 * rather than left to a session's memory.
 *
 * **What `--unasked` refuses is who the write reaches, never how obvious it looked** — the axis rule 10 draws
 * (`docs/doctrine-rationale/rule-10.md`):
 *
 *  - **a closure** — a `stateId` whose recorded type is `completed`, `canceled` or `duplicate`. Closing an arguable ticket
 *    is carded; closing on their direct word is not `--unasked` at all.
 *  - **an assignee change, set or cleared** — either one notifies a person, the old assignee or the new.
 *  - **a mention in a body that is sent** — `@{key}` is a notification by construction.
 *
 * Everything else the verb can write — the body of a weak ticket on us, its state, team, project, parent,
 * labels, priority, cycle — goes ahead and leaves a row whose rollback is the issue's own activity history.
 */
import { createHash } from "node:crypto";

import { buildAutonomyAction } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import type { Result } from "../../../lib/result.js";
import type { StateCatalog } from "../../../outbound/linear/stateCatalog.js";
import type { LinearIssueFields } from "../../../outbound/linear/types.js";
import type { UnaskedNote } from "./issueStepUpArgs.js";

/**
 * The workflow-state types that CLOSE an issue, as Linear names them. `duplicate` is one: read live off the DEVX
 * team's catalog (`slopweaver linear states --team DEVX` lists a `Duplicate` state of that type).
 */
const CLOSING_STATE_TYPES: ReadonlySet<string> = new Set(["completed", "canceled", "duplicate"]);

/** The rollback every row names, because it is the rail they named. */
export const LINEAR_ROLLBACK = "rollback: the issue's own Linear activity history";

/**
 * Every reason an `--unasked` write must not go out, before anything is sent.
 *
 * A `stateId` the catalog does not hold is not judged here: `stateIdRefusals` already refuses it on every
 * write, asked or not.
 *
 * @param fields the validated form fields
 * @param catalog the destination team's recorded `linear states` read, or undefined when there is none
 * @param mentionKeys the `@{key}` tokens of the body being SENT (empty under `--fields-only`)
 * @returns one line per refusal, empty when the write may go out unasked
 */
export function unaskedRefusals({
  fields,
  catalog,
  mentionKeys,
}: {
  fields: LinearIssueFields;
  catalog: StateCatalog | undefined;
  mentionKeys: readonly string[];
}): readonly string[] {
  const refusals: string[] = [];
  const state = catalog?.states.find((candidate) => candidate.id === fields.stateId);
  if (state !== undefined && CLOSING_STATE_TYPES.has(state.type)) {
    refusals.push(
      `--unasked refused: state "${state.name}" is ${state.type}, and a closure waits on their word. Card it with ` +
        "`slopweaver handover ask --action`, or drop --unasked when they asked for this close.",
    );
  }
  if (fields.assignee !== undefined) {
    refusals.push(
      "--unasked refused: an assignee change reaches a person, the old assignee or the new, so it waits on their word.",
    );
  }
  if (mentionKeys.length > 0) {
    refusals.push(
      `--unasked refused: the body mentions ${mentionKeys.join(", ")}, which notifies a person; it waits on their word.`,
    );
  }
  return refusals;
}

/**
 * The autonomy-ledger KIND of one unasked write — the act it actually was, so their steer can land on a kind.
 *
 * @param verb which of `create`/`update`
 * @param fieldsOnly whether no body was sent
 * @param rewriteFiled whether the body replaced was one slopweaver did not write
 * @returns the kind slug
 */
export function unaskedKind({
  verb,
  fieldsOnly,
  rewriteFiled,
}: {
  verb: "create" | "update";
  fieldsOnly: boolean;
  rewriteFiled: boolean;
}): string {
  if (verb === "create") {
    return "linear-issue-create";
  }
  if (fieldsOnly) {
    return "linear-fields-update";
  }
  return rewriteFiled ? "linear-body-rewrite" : "linear-issue-update";
}

/**
 * The action id one unasked write is recorded under: the issue's identifier, readable on their card, and a
 * digest of the issue id, the exact input sent and the instant it was sent.
 *
 * The instant is in it because every run of this verb SENDS: re-running an identical update is a second
 * mutation, so it is a second act and a second row. Without it the re-run would rebuild the first row's id
 * with a different `doneIso`, and the ledger refuses that as a conflict — reporting a landed write as
 * unrecorded. (`autonomy record`'s own retry idempotence is for re-RECORDING one act, which never happens here:
 * the row is written by the same invocation that made the write.)
 *
 * @param identifier the issue's identifier, e.g. `FFFF-7313`
 * @param id the issue's Linear id
 * @param input the provider input the write sent
 * @param doneIso when the write was made
 * @returns an id matching the ledger's slug pattern
 */
export function unaskedActionId({
  identifier,
  id,
  input,
  doneIso,
}: {
  identifier: string;
  id: string;
  input: Readonly<Record<string, unknown>>;
  doneIso: string;
}): string {
  const digest = createHash("sha256")
    .update(`${id}\n${doneIso}\n${JSON.stringify(input)}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `linear-${identifier.toLowerCase()}-${digest}`;
}

/**
 * The ledger row for one unasked write, validated by the ledger's own builder.
 *
 * @param note the three accounts the session gave
 * @param kind what {@link unaskedKind} called the act
 * @param identifier the issue's identifier
 * @param id the issue's Linear id
 * @param input the provider input the write sent
 * @param url the issue's URL, the row's checkable subject
 * @param outcome the verb's own first outcome line, the witness of what happened
 * @param doneIso when the write was made
 * @returns the row, or the ledger's refusal of it
 */
export function unaskedRow({
  note,
  kind,
  identifier,
  id,
  input,
  url,
  outcome,
  doneIso,
}: {
  note: UnaskedNote;
  kind: string;
  identifier: string;
  id: string;
  input: Readonly<Record<string, unknown>>;
  url: string;
  outcome: string;
  doneIso: string;
}): Result<AutonomyActionRow, { readonly message: string }> {
  // The row is what they read INSTEAD of a card, so it names the fields the write sent beside the issue and
  // the rollback: a steer on "you moved its team" needs to see that `teamId` was in it.
  const sent = Object.keys(input).toSorted().join(", ");
  return buildAutonomyAction({
    actionId: unaskedActionId({ doneIso, id, identifier, input }),
    bySession: note.bySession,
    doneIso,
    kind,
    run: undefined,
    said: note.said,
    steer: undefined,
    subject: url,
    why: note.why,
    witness: `slopweaver linear issue -> ${outcome}; fields sent: ${sent.length > 0 ? sent : "none"}; ${LINEAR_ROLLBACK}`,
  });
}

/**
 * Check the session's three accounts BEFORE the write, by building a row around a placeholder issue.
 *
 * A `said` the ledger refuses — one naming a slug, too long for their card — would otherwise surface only after
 * the write landed, leaving an unasked act with no row. That is the failure this exists to design out.
 *
 * @param note the three accounts the session gave
 * @param kind what {@link unaskedKind} called the act
 * @param doneIso any valid instant; the placeholder row is never written
 * @returns the refusal line, or undefined when the accounts will record
 */
export function unaskedNoteRefusal({
  note,
  kind,
  doneIso,
}: {
  note: UnaskedNote;
  kind: string;
  doneIso: string;
}): string | undefined {
  const built = unaskedRow({
    doneIso,
    id: "placeholder",
    identifier: "placeholder-0",
    input: {},
    kind,
    note,
    outcome: "pending",
    url: "https://linear.app/placeholder",
  });
  return built.isErr() ? `--unasked refused before writing: ${built.error.message}` : undefined;
}
