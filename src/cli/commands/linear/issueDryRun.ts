/**
 * The `linear issue` dry-run preview — pure, and split from `./core.ts` along its rendering boundary.
 *
 * Every line names what the write would do with its field, and an optional field the form leaves unset is a
 * statement too: "(team default)" and "(none)" say what Linear does with an omitted state or project, which
 * is a different claim from a blank. Each optional field is therefore read through its own record's type, so
 * the preview can only ever call a field unset when the form's type says it may be.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { renderIssueBody } from "../../../outbound/linear/render.js";
import type { LinearIssueFields, LinearIssueForm } from "../../../outbound/linear/types.js";

/**
 * The dry-run preview: the exact bytes that would be sent, plus the resolved destination fields.
 *
 * The body shown is the SAME string the writer sends — rendered once, by the same function — because a
 * preview produced by a second code path is a preview of something else.
 *
 * A `--fields-only` update sends neither the description nor the title, so the preview says so for both
 * rather than displaying values the write will not carry. A preview that shows a field it is about to drop
 * is the same lie as one produced by a second code path.
 *
 * @param form the validated form
 * @param id the deterministic intent id
 * @param assigneeId what the form's `assignee` key resolved to, undefined when it names nobody or does
 *   not resolve against the rosters as they currently stand, or null when the form clears the assignee
 * @param fieldsOnly whether this invocation carries `--fields-only`
 * @param moveTeam whether this invocation carries `--move-team`, which is the only way an update sends the team
 * @returns the operator-facing lines
 */
export function dryRunLines({
  form,
  id,
  assigneeId,
  fieldsOnly = false,
  moveTeam = false,
  mentions = [],
}: {
  form: LinearIssueForm;
  id: string;
  assigneeId: string | null | undefined;
  fieldsOnly?: boolean;
  moveTeam?: boolean;
  mentions?: readonly string[];
}): readonly string[] {
  const { fields } = form;
  const body = renderIssueBody({ artifact: form.artifact });
  return [
    `kind:      ${form.artifact.kind}`,
    `issue id:  ${id}  (derived from the intent, so a retry reuses it)`,
    `team:      ${fields.teamId}${moveTeam ? "  (MOVED here — --move-team)" : ""}`,
    `parent:    ${parentLine({ parentId: fields.parentId })}`,
    `title:     ${fieldsOnly ? "(not sent — --fields-only touches no prose)" : fields.title}`,
    `priority:  ${fields.priority === undefined ? "(unset — triage decides)" : String(fields.priority)}`,
    `estimate:  ${estimateLine({ estimate: fields.estimate })}`,
    `state:     ${destinationLine({ fields, key: "stateId" })}`,
    `project:   ${projectLine({ fields })}`,
    `labels:    ${fields.labelIds === undefined || fields.labelIds.length === 0 ? "(none)" : fields.labelIds.join(", ")}`,
    `cycle:     ${cycleLine({ cycleId: fields.cycleId })}`,
    `assignee:  ${assigneeLine({ assignee: fields.assignee, assigneeId })}`,
    `notifies:  ${mentions.length === 0 ? "(nobody — the body mentions no-one)" : mentions.join(", ")}`,
    `body bytes: ${String(Buffer.byteLength(body, "utf8"))}`,
    fieldsOnly ? "--- description (NOT sent — --fields-only) ---" : "--- description ---",
    body,
    "--- end ---",
  ];
}

/**
 * What Linear does with each optional destination field the form leaves unset, in the words the preview
 * prints: an omitted state lands the issue in the team's default state, and an omitted project files it in
 * none.
 */
const UNSET_DESTINATION = { projectId: "(none)", stateId: "(team default)" } as const;

/** The dry run's state or project line: the id the write sends, or what leaving the field unset means. */
function destinationLine({ fields, key }: { fields: LinearIssueFields; key: keyof typeof UNSET_DESTINATION }): string {
  const id = unsetFieldAsNull({ key, record: fields });
  if (id === null) {
    return UNSET_DESTINATION[key];
  }
  return id;
}

/**
 * The dry run's assignee line: the key the form named, and what it resolves to against the rosters as they
 * currently sit on disk.
 *
 * An unresolved key is reported as "does not resolve YET", not as a refusal, because the preview reads the
 * roster WITHOUT the just-in-time refresh a live run performs first — so a colleague who joined since the
 * last derive genuinely may resolve on the real write. Presenting this as the final answer would send
 * someone off to edit the identity roster for a key that was about to work.
 */
function assigneeLine({
  assignee,
  assigneeId,
}: {
  assignee: string | null | undefined;
  assigneeId: string | null | undefined;
}): string {
  if (assignee === undefined) {
    return "(unassigned — triage decides)";
  }
  // Spelled out rather than shown as an empty value, because CLEARED and UNSET look identical in a preview
  // and are opposite instructions: one is a write the operator asked for, the other is a field left alone.
  if (assignee === null) {
    return "(CLEARED — this write removes whoever is assigned)";
  }
  return assigneeId === undefined || assigneeId === null
    ? `${assignee} → does not resolve YET (the live run refreshes the roster first)`
    : `${assignee} → ${assigneeId}`;
}

/**
 * The dry run's cycle line, with the same three states the field itself has.
 *
 * A removal is named in words for the reason the assignee line is: "(none)" would read identically for a
 * form that says nothing about the cycle and a form that is about to take the issue out of one.
 */
function cycleLine({ cycleId }: { cycleId: string | null | undefined }): string {
  if (cycleId === undefined) {
    return "(unchanged)";
  }
  if (cycleId === null) {
    return "(REMOVED — this write takes the issue out of its cycle)";
  }
  return cycleId;
}

/**
 * The dry run's project line. A `null` project is spelled out as a DETACH for the reason {@link cycleLine}
 * gives, and an omitted one keeps the "(none)" its state sibling's wording follows.
 */
function projectLine({ fields }: { fields: LinearIssueFields }): string {
  if (fields.projectId === null) {
    return "(DETACHED — this write takes the issue out of its project)";
  }
  return destinationLine({ fields, key: "projectId" });
}

/** The dry run's estimate line; a clear is named in words for the reason {@link cycleLine} gives. */
function estimateLine({ estimate }: { estimate: number | null | undefined }): string {
  if (estimate === undefined) {
    return "(unset — triage decides)";
  }
  if (estimate === null) {
    return "(CLEARED — this write removes the estimate)";
  }
  return String(estimate);
}

/** The dry run's parent line, named in words for the reason {@link cycleLine} gives. */
function parentLine({ parentId }: { parentId: string | null | undefined }): string {
  if (parentId === undefined) {
    return "(unchanged)";
  }
  if (parentId === null) {
    return "(DETACHED — this write takes the issue out from under its parent)";
  }
  return parentId;
}
