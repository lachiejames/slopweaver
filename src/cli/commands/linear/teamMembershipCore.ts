/**
 * The PURE core of `linear team-membership join|leave`: argument parsing, the preview, the outcome report,
 * the door request and the autonomy row.
 *
 * The one Linear write whose target is the owner themselves rather than a ticket, so it is PREVIEW BY DEFAULT:
 * nothing is sent without `--apply`, and the preview is a live read of where the token's user stands. Which
 * teams they are on is their word (`skills/linear/reference/team-membership.md`); `--unasked` exists so an act the
 * fleet takes is journalled exactly as an unasked `linear issue` write is, with the opposite verb as its
 * rollback.
 */
import { createHash } from "node:crypto";

import type { DoorRequest } from "../../../admit/types.js";
import { buildAutonomyAction } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { LinearMembershipState } from "../../../live/linear/teamMembership.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";
import { type UnaskedNote, unaskedNoteOf } from "./issueStepUpArgs.js";

/** Join a team, or leave one. */
export type MembershipAction = "join" | "leave";

/** A parsed `linear team-membership` invocation. */
export interface TeamMembershipArgs {
  readonly action: MembershipAction;
  readonly teamKey: string;
  /** Send the write. Without it the verb reads, previews, and sends nothing. */
  readonly apply: boolean;
  readonly home: string | undefined;
  readonly unasked: UnaskedNote | undefined;
}

/** The flags this verb accepts, as a {@link FlagSpec}. */
const TEAM_MEMBERSHIP_FLAGS: FlagSpec = {
  boolean: ["apply", "unasked"],
  string: ["by-session", "home", "said", "team", "why"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const LINEAR_TEAM_MEMBERSHIP_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: TEAM_MEMBERSHIP_FLAGS }),
  ...booleanFlagsOf({ spec: TEAM_MEMBERSHIP_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `linear team-membership <join|leave> --team <KEY> …`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseTeamMembershipArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<TeamMembershipArgs, LinearVerbError> {
  const action = argv[0];
  if (action !== "join" && action !== "leave") {
    return err(
      LinearVerbErrors.argumentsRefused({
        reasons: ["usage: slopweaver linear team-membership <join|leave> --team <team-key> [--apply] [...]"],
      }),
    );
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: TEAM_MEMBERSHIP_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const team = values["team"];
  if (typeof team !== "string" || team.length === 0) {
    return err(LinearVerbErrors.teamMissing());
  }
  const unasked = unaskedNoteOf({ values });
  if (unasked.errors.length > 0) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: unasked.errors }));
  }
  const home = values["home"];
  return ok({
    action,
    apply: values["apply"] === true,
    home: typeof home === "string" ? home : undefined,
    teamKey: team,
    unasked: unasked.note,
  });
}

/**
 * Whether the action would change anything: joining a team the viewer is on, or leaving one it is not on, is
 * a no-op and sends nothing.
 *
 * @param action join or leave
 * @param state where the viewer stands now
 * @returns true when the write would change the viewer's membership
 */
export function membershipWouldChange({
  action,
  state,
}: {
  action: MembershipAction;
  state: LinearMembershipState;
}): boolean {
  const member = state.membershipId !== undefined;
  return action === "join" ? !member : member;
}

/** The verb that undoes `action`. */
function opposite({ action }: { action: MembershipAction }): MembershipAction {
  return action === "join" ? "leave" : "join";
}

/**
 * The rollback an act of this verb names: the opposite verb, on the same team.
 *
 * @param action the act taken
 * @param teamKey the team it was taken on
 * @returns the exact command that undoes it
 */
export function membershipRollback({ action, teamKey }: { action: MembershipAction; teamKey: string }): string {
  return `rollback: slopweaver linear team-membership ${opposite({ action })} --team ${teamKey} --apply`;
}

/**
 * The preview: who, which team, where they stand, and what `--apply` would send.
 *
 * @param action join or leave
 * @param state where the viewer stands now
 * @param apply whether this run will send the write
 * @returns the operator-facing lines
 */
export function membershipPreviewLines({
  action,
  state,
  apply,
}: {
  action: MembershipAction;
  state: LinearMembershipState;
  apply: boolean;
}): readonly string[] {
  const standing = state.membershipId === undefined ? "not a member" : `a member (membership ${state.membershipId})`;
  const lines = [
    `team:    ${state.team.key} — ${state.team.name} (${state.team.id})`,
    `viewer:  ${state.viewer.name} (${state.viewer.id}), the token's own user`,
    `now:     ${standing}`,
  ];
  if (!membershipWouldChange({ action, state })) {
    return [...lines, `nothing to ${action}: the viewer is already ${standing}. Nothing was sent.`];
  }
  const would = `${action} ${state.team.key}`;
  return apply ? [...lines, `sending: ${would}`] : [...lines, `would:   ${would}`, "preview only: --apply sends it"];
}

/** What became of a membership write, judged by reading the viewer's memberships back. */
export type MembershipOutcome =
  | { readonly kind: "written" }
  | { readonly kind: "unconfirmed"; readonly reason: string }
  | { readonly kind: "landed"; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * The operator-facing report for an outcome.
 *
 * @param action the act attempted
 * @param teamKey the team it was attempted on
 * @param outcome what the read-back established
 * @returns the lines to print, the first of which is the autonomy row's witness
 */
export function membershipOutcomeLines({
  action,
  teamKey,
  outcome,
}: {
  action: MembershipAction;
  teamKey: string;
  outcome: MembershipOutcome;
}): readonly string[] {
  const past = action === "join" ? "joined" : "left";
  switch (outcome.kind) {
    case "written":
      return [`${past} ${teamKey}, confirmed by reading the viewer's memberships back`];
    case "landed":
      return [
        `${past} ${teamKey} despite a transport error, confirmed by the read-back`,
        `the error was: ${outcome.reason}`,
      ];
    case "unconfirmed":
      return [
        `the ${action} of ${teamKey} was sent but the read-back does not confirm it: ${outcome.reason}`,
        `Do not re-run blind: run without --apply to read where the viewer stands now.`,
      ];
    case "indeterminate":
      return [
        `the ${action} of ${teamKey} errored AND the read-back failed, so it is unknown whether it landed`,
        `the error was: ${outcome.reason}`,
        `Run without --apply to read where the viewer stands now.`,
      ];
    case "failed":
      return [`the ${action} of ${teamKey} failed and the read-back shows nothing changed: ${outcome.reason}`];
  }
}

/**
 * The door request for a membership write. `createsWorkItem` is false: a membership creates nothing anyone
 * has to triage. It is still an external write — it changes what the team's members see.
 *
 * @param home the resolved state home
 * @param action join or leave
 * @param state the team and viewer the write names
 * @returns the request to admit
 */
export function membershipDoorRequestFor({
  home,
  action,
  state,
}: {
  home: string;
  action: MembershipAction;
  state: LinearMembershipState;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "linear", verb: `team-membership ${action}` },
    artifact: { teamId: state.team.id, teamKey: state.team.key, userId: state.viewer.id },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * The autonomy row for one `--unasked` membership write, validated by the ledger's own builder.
 *
 * The subject is the viewer's own Linear profile, because the membership changed is theirs. The witness names
 * the team, the act and the opposite verb as the rollback, so the row reads as the card it replaces.
 *
 * @param note the three accounts the session gave
 * @param action the act taken
 * @param state the team and viewer it was taken on
 * @param outcome what the read-back established
 * @param doneIso when the write was made
 * @returns the row, or the ledger's refusal of it
 */
export function membershipRow({
  note,
  action,
  state,
  outcome,
  doneIso,
}: {
  note: UnaskedNote;
  action: MembershipAction;
  state: LinearMembershipState;
  outcome: MembershipOutcome;
  doneIso: string;
}): Result<AutonomyActionRow, { readonly message: string }> {
  const confirmed = outcome.kind === "written" || outcome.kind === "landed";
  const digest = createHash("sha256")
    .update(`${state.viewer.id}\n${state.team.id}\n${action}\n${doneIso}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  const line = membershipOutcomeLines({ action, outcome, teamKey: state.team.key })[0]!;
  return buildAutonomyAction({
    actionId: `linear-team-${state.team.key.toLowerCase()}-${action}-${digest}`,
    bySession: note.bySession,
    doneIso,
    kind: confirmed ? `linear-team-${action}` : `linear-team-${action}-unconfirmed`,
    run: undefined,
    said: note.said,
    steer: undefined,
    subject: state.viewer.url,
    why: note.why,
    witness: `slopweaver linear team-membership ${action} -> ${line}; ${membershipRollback({ action, teamKey: state.team.key })}`,
  });
}
