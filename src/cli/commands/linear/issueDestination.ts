/**
 * The destination gates of `slopweaver linear issue`, run together before the door: WHO the ticket is assigned
 * to, WHO its body notifies, WHICH workflow state it is filed into, and whether the TEAM it is filed into is
 * one this install retired.
 *
 * They live outside `./core.ts` because each needs state from disk — the identity rosters, the recorded state
 * catalog, the retired-teams list — while `core.ts` is the pure half. What they decide is still pure and lives
 * in `../../../outbound/linear/assigneeIndex.ts`, `mentionIndex.ts`, `stateCatalog.ts` and `retiredTeams.ts`;
 * this module only supplies them with what they need and concatenates the answers.
 */
import { assigneeRefusals, staleAssigneeRefusals } from "../../../outbound/linear/assigneeIndex.js";
import { linearMentionRefusals, staleLinearMentionRefusals } from "../../../outbound/linear/mentionIndex.js";
import { mentionKeysOfIssue, rewriteIssueMentions } from "../../../outbound/linear/mentionRewrite.js";
import { retiredTeamGate } from "../../../outbound/linear/retiredTeams.js";
import { assigneeMembershipRefusals, stateIdRefusals } from "../../../outbound/linear/stateCatalog.js";
import type { LinearIssueArtifact, LinearIssueFields } from "../../../outbound/linear/types.js";
import type { LinearWriteDeps } from "./writeDeps.js";

/**
 * The retired-team gate for one issue write. Only a write that CHOOSES the team meets it: a create, or an
 * update with `--move-team`; any other update never sends `teamId`, so it files nothing anywhere new. The live
 * write and the dry run both ask this, so a preview says what the write would be told.
 *
 * @param deps the injectable edges, for the environment the grant's session is read through
 * @param home the resolved state home, whose list and grant journal decide
 * @param teamId the form's team
 * @param verb create or update
 * @param moveTeam whether `--move-team` was given
 * @returns the refusal lines, empty when the write may proceed
 */
export function issueRetiredTeamRefusals({
  deps,
  home,
  teamId,
  verb,
  moveTeam,
}: {
  deps: Pick<LinearWriteDeps, "env">;
  home: string;
  teamId: string;
  verb: "create" | "update";
  moveTeam: boolean;
}): readonly string[] {
  if (verb === "update" && !moveTeam) {
    return [];
  }
  return retiredTeamGate({ command: `slopweaver linear issue ${verb}`, env: deps.env, home, teamIds: [teamId] });
}

/**
 * The mention gate alone: resolve the body's `@{key}` tokens, rewrite them, and refuse what will not resolve.
 * Skipped under `--fields-only`, which sends no body (see {@link destinationRefusals}).
 *
 * @param artifact the linkified issue body
 * @param deps the injectable edges
 * @param fieldsOnly whether the description is being withheld
 * @param home the resolved state home
 * @param verified the `--mention-id` ids the caller checked live
 * @returns the rewritten body and the mention refusal lines
 */
async function mentionGate({
  artifact,
  deps,
  fieldsOnly,
  home,
  verified,
}: {
  artifact: LinearIssueArtifact;
  deps: LinearWriteDeps;
  fieldsOnly: boolean;
  home: string;
  verified: ReadonlyMap<string, string>;
}): Promise<{ readonly mentioned: LinearIssueArtifact; readonly mentionRefusals: readonly string[] }> {
  const keys = fieldsOnly ? [] : mentionKeysOfIssue({ artifact });
  const resolved = await deps.resolveMentions({ home, keys, verified });
  if (resolved.isErr()) {
    return { mentionRefusals: [resolved.error.message], mentioned: artifact };
  }
  const mentions = resolved.value;
  return {
    mentionRefusals: [
      ...linearMentionRefusals({ keys, resolution: mentions }),
      ...staleLinearMentionRefusals({ keys, resolution: mentions }),
    ],
    mentioned: rewriteIssueMentions({ artifact, resolution: mentions }),
  };
}

/** The team's recorded state catalog, and the refusal lines for a state id it does not hold. */
function stateGate({ deps, fields, home }: { deps: LinearWriteDeps; fields: LinearIssueFields; home: string }): {
  readonly catalog: ReturnType<LinearWriteDeps["stateCatalog"]>;
  readonly stateRefusals: readonly string[];
} {
  const catalog = deps.stateCatalog({ home, teamId: fields.teamId });
  const stateRefusals = stateIdRefusals({
    catalog,
    stateId: fields.stateId,
    teamId: fields.teamId,
    teamKey: catalog?.teamKey,
  });
  return { catalog, stateRefusals };
}

/**
 * Every destination refusal, the resolved assignee, and the body with its mentions rewritten.
 *
 * The mention gate is SKIPPED under `--fields-only`, and that is the flag working as documented rather than
 * a hole: a fields-only write sends no description at all, so a body naming someone unresolvable never
 * reaches Linear and refusing it would block a state change over prose nobody is sending.
 *
 * A `null` assignee never reaches the roster at all. There is nobody to look up when the instruction is
 * "clear it", so resolving would refuse a perfectly valid write for naming a person it was never given —
 * and the membership gate has nothing to check either, because no one is being put on the ticket. The
 * MENTION gate still runs for it: clearing an assignee says nothing about who the body names.
 *
 * Only a write that CHOOSES the team meets the retired-team gate: an update without `--move-team` never sends
 * `teamId`, so it files nothing anywhere new.
 *
 * @param artifact the linkified issue body, whose `@{key}` tokens this resolves
 * @param deps the injectable edges
 * @param fieldsOnly whether the description is being withheld, which makes the mention gate moot
 * @param fields the validated form fields
 * @param home the resolved state home
 * @param verified the `--mention-id` ids the caller checked live
 * @param verb create or update, which with `moveTeam` decides whether the write chooses its team
 * @param moveTeam whether `--move-team` was given
 * @returns every refusal line (empty ⇒ the write may proceed), the resolved Linear user id — null when the
 *   form clears the assignee — and the body with its mentions rewritten into Linear's markup
 */
export async function destinationRefusals({
  artifact,
  deps,
  fieldsOnly,
  fields,
  home,
  verified,
  verb,
  moveTeam,
}: {
  artifact: LinearIssueArtifact;
  deps: LinearWriteDeps;
  fieldsOnly: boolean;
  fields: LinearIssueFields;
  home: string;
  verified: ReadonlyMap<string, string>;
  verb: "create" | "update";
  moveTeam: boolean;
}): Promise<{
  readonly refusals: readonly string[];
  readonly assigneeId: string | null | undefined;
  readonly artifact: LinearIssueArtifact;
}> {
  const retired = issueRetiredTeamRefusals({ deps, home, moveTeam, teamId: fields.teamId, verb });
  const { catalog, stateRefusals } = stateGate({ deps, fields, home });
  const { mentioned, mentionRefusals } = await mentionGate({ artifact, deps, fieldsOnly, home, verified });
  if (fields.assignee === null) {
    return { artifact: mentioned, assigneeId: null, refusals: [...retired, ...mentionRefusals, ...stateRefusals] };
  }
  const resolved = await deps.resolveAssignee({ home, person: fields.assignee });
  if (resolved.isErr()) {
    // A store that cannot say who the key names refuses the write; nobody is assigned on a guess.
    return {
      artifact: mentioned,
      assigneeId: undefined,
      refusals: [...new Set([...retired, resolved.error.message, ...mentionRefusals, ...stateRefusals])],
    };
  }
  const resolution = resolved.value;
  const assigneeId = resolution.target?.linearId;
  return {
    artifact: mentioned,
    assigneeId,
    // DEDUPED, and only for an EXACT repeat. The assignee gate and the mention gate read the same roster, so
    // a stale one makes both emit the identical sentence about the identical artefact — printing it twice
    // says nothing the first one did not and reads as two separate problems.
    refusals: [
      ...new Set([
        ...retired,
        ...assigneeRefusals({ person: fields.assignee, resolution }),
        ...staleAssigneeRefusals({ person: fields.assignee, resolution }),
        ...mentionRefusals,
        ...stateRefusals,
        ...assigneeMembershipRefusals({ assigneeId, catalog }),
      ]),
    ],
  };
}
