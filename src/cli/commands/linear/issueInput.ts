/**
 * The provider INPUTS a `linear issue` write sends — `IssueCreateInput` and `IssueUpdateInput` — built from
 * the validated form. Pure, so every field's three states (omitted, set, cleared) are unit-testable.
 *
 * Its own module rather than `./core.ts`'s, because that file sits on the file-size ratchet's debt list and
 * the parent and team-move fields (graduated autonomy for Linear) had nowhere to
 * go there without growing it.
 */
import type { LinearIssueFields } from "../../../outbound/linear/types.js";

/**
 * The three-state fields every write carries the same way: omitted when `undefined`, sent otherwise — `null`
 * included, because a `null` cycle or parent is an INSTRUCTION to clear it, not silence about it.
 *
 * @param fields the validated form fields
 * @param assigneeId the RESOLVED Linear user id, undefined when the form assigns nobody, or null when it
 *   explicitly clears the assignee
 * @returns the shared slice of either input
 */
function sharedFields({
  fields,
  assigneeId,
}: {
  fields: LinearIssueFields;
  assigneeId: string | null | undefined;
}): Readonly<Record<string, unknown>> {
  return {
    ...(fields.priority === undefined ? {} : { priority: fields.priority }),
    ...(fields.estimate === undefined ? {} : { estimate: fields.estimate }),
    ...(fields.stateId === undefined ? {} : { stateId: fields.stateId }),
    // A `null` project is sent, not omitted: it DETACHES the issue from its project.
    ...(fields.projectId === undefined ? {} : { projectId: fields.projectId }),
    ...(fields.labelIds === undefined ? {} : { labelIds: fields.labelIds }),
    // A `null` here is sent, not omitted: it is the only way to take an issue OUT of a cycle, which is one
    // third of what "move it to the backlog" means to a human. The `undefined` check rather than a falsy
    // one is what keeps the two apart.
    ...(fields.cycleId === undefined ? {} : { cycleId: fields.cycleId }),
    // The same three states for the parent: an id nests the issue, `null` detaches it.
    ...(fields.parentId === undefined ? {} : { parentId: fields.parentId }),
    // The RESOLVED Linear user id, never the form's `assignee` key. Passing the key through would send a
    // handle where the provider expects a UUID — accepted as a string, rejected as an argument, and the
    // whole point of the roster indirection lost.
    ...(assigneeId === undefined ? {} : { assigneeId }),
  };
}

/**
 * The `IssueCreateInput` fields, built from the validated form.
 *
 * Optional fields are OMITTED rather than sent as null: Linear treats an absent `priority` as "no priority",
 * which is what an unset field means, whereas sending an explicit value would assert a decision the operator
 * did not make. `null` is the deliberate exception, and only where the form asked for it.
 *
 * @param fields the validated form fields
 * @param description the rendered body
 * @param assigneeId the RESOLVED Linear user id, undefined when the form assigns nobody, or null when it
 *   explicitly clears the assignee
 * @returns the provider input, with unset optional fields OMITTED rather than sent as null
 */
export function createInputFor({
  fields,
  description,
  assigneeId,
}: {
  fields: LinearIssueFields;
  description: string;
  assigneeId: string | null | undefined;
}): Readonly<Record<string, unknown>> {
  return { description, teamId: fields.teamId, title: fields.title, ...sharedFields({ assigneeId, fields }) };
}

/**
 * The `IssueUpdateInput` fields.
 *
 * `--fields-only` omits `description` ENTIRELY, which is the whole point: Linear's update is patch-shaped,
 * so a field this does not send is a field it cannot overwrite. That is the only way to change a state or a
 * priority with a guarantee that no prose was touched.
 *
 * **The title is prose too, and it is omitted for exactly the same reason.** This form is complete-shaped,
 * so `fields.title` is whatever the caller happened to author; it is not read back from the issue. Sending
 * it unconditionally meant a caller who did not reproduce the live title byte-exact silently RENAMED the
 * ticket while believing they had only moved its state — the guarantee `--fields-only` advertises, broken by
 * the one field nobody thinks of as a description. Renaming stays available through a full update, which is
 * the path that carries the overwrite-safety check.
 *
 * **The team is sent only under `--move-team`.** Every form names a `teamId`, because state ids and members
 * are judged against that team's catalog — so an update that always sent it would MOVE any ticket whose form
 * named a different team, silently. A move is asked for by name or not at all.
 *
 * @param fields the validated form fields
 * @param fieldsOnly when true the description and the title are left out entirely, so no prose can be
 *   overwritten
 * @param moveTeam when true the form's `teamId` is sent, which moves the issue to that team
 * @param description the rendered body, sent only when `fieldsOnly` is false
 * @param assigneeId the RESOLVED Linear user id, or undefined when the form assigns nobody
 * @returns the provider input, carrying only the fields this update should be able to change
 */
export function updateInputFor({
  fields,
  fieldsOnly,
  moveTeam = false,
  description,
  assigneeId,
}: {
  fields: LinearIssueFields;
  fieldsOnly: boolean;
  moveTeam?: boolean;
  description: string;
  assigneeId: string | null | undefined;
}): Readonly<Record<string, unknown>> {
  return {
    ...(fieldsOnly ? {} : { description, title: fields.title }),
    ...(moveTeam ? { teamId: fields.teamId } : {}),
    ...sharedFields({ assigneeId, fields }),
  };
}
