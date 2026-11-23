/**
 * Pure planning for `slopweaver linear move-issues`: the arguments, the refusals, the one form each move sends,
 * and every line the verb prints.
 *
 * A move is the narrowest team change Linear allows, and anything wider is refused rather than decided here.
 * The issue keeps its title, description, assignee, parent, estimate and priority. Its workflow state maps by
 * exact NAME into the destination team, and only to a state of the same TYPE: a same-named state of another type
 * would change what the issue means, and a child turning `completed` can close an unnamed parent through Linear's
 * parent auto-close. It leaves its cycle and every label, because both are owned by the
 * team it leaves. Refused outright: an issue in a project (a move can silently drop it from the project, or
 * widen the project's team set, and neither is this verb's to decide), one carrying any label (team labels
 * cannot cross; the verb does not classify), one assigned to a colleague, an archived one, and a parent still
 * holding children in its own team (Linear has moved those along with it). A child whose
 * parent stays behind is NOT refused: Linear lets a sub-issue sit in another team.
 *
 * Its stated residue: every refusal is judged against ONE snapshot, and the write is not conditional on it.
 * Linear's `issueUpdate` offers no compare-and-swap, so anything another actor changes between the read and an
 * issue's write — its state, its children, its project, its labels — is written over with the plan's form, and
 * whatever Linear does on that write follows from the issue as it then stands. Two cases a reader should expect:
 * a child that comes to sit in the parent's team after the read (created there, or moved in) moves along with
 * the parent unnamed; and a child whose state changed after the read can land in a state that closes its
 * parent through parent auto-close. This stays open rather than closed, and `linear issue update --fields-only`
 * cannot read back that the fields took. Re-run the verb afterwards; a moved issue then reads as not returned
 * under its old identifier.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import type { LinearIssueRow } from "../../../live/linear/issues.js";
import type { LinearStatesDocument, LinearTeamIdentity } from "../../../live/linear/states.js";
import type { LinearIssueArtifact, LinearIssueForm } from "../../../outbound/linear/types.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";

const MOVE_ISSUES_FLAGS: FlagSpec = {
  boolean: ["apply", "json"],
  string: ["home", "identifier", "to"],
};

/** Every accepted flag, WITH the `--`, derived from the exact spec passed to the parser. */
export const LINEAR_MOVE_ISSUES_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: MOVE_ISSUES_FLAGS }),
  ...booleanFlagsOf({ spec: MOVE_ISSUES_FLAGS }),
].map((name) => `--${name}`);

/** An issue identifier as Linear prints one, its number 1 to 9 digits with no leading zero so it never overflows. */
const IDENTIFIER = /^[A-Z][A-Z0-9]*-[1-9]\d{0,8}$/u;

/** A team key as it prefixes an identifier. */
const TEAM_KEY = /^[A-Z][A-Z0-9]*$/u;

/**
 * The body a move's form carries. Required for the form to parse, and never sent: `--fields-only` omits the
 * title and the description from the provider input, so the issue keeps its own.
 */
const UNSENT_ARTIFACT: LinearIssueArtifact = {
  aiPrompt: [{ kind: "para", text: "**Goal.** Not sent: --fields-only." }],
  kind: "structured",
  problem: [{ kind: "para", text: "Not sent: --fields-only." }],
  solution: [{ kind: "para", text: "Not sent: --fields-only." }],
};

/** A parsed, credential-free `linear move-issues` invocation. */
export interface LinearMoveIssuesOptions {
  /** The key of the team the issues move into. */
  readonly destinationTeamKey: string;
  /** The named issues, in caller order, each once. */
  readonly identifiers: readonly string[];
  readonly apply: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** One reason a named issue will not move. Every reason that applies to a row is reported, in this order. */
export type IssueMoveRefusal =
  | { readonly code: "ISSUE_NOT_RETURNED" }
  | { readonly code: "ALREADY_DESTINATION"; readonly teamKey: string }
  | { readonly code: "ARCHIVED"; readonly archivedAt: string }
  | { readonly code: "HAS_PROJECT"; readonly projectId: string }
  | { readonly code: "HAS_LABELS"; readonly labelIds: readonly string[] }
  | { readonly code: "FOREIGN_ASSIGNEE"; readonly assigneeId: string }
  | { readonly code: "SAME_TEAM_CHILDREN"; readonly identifiers: readonly string[] }
  | { readonly code: "SOURCE_STATE_NOT_READ"; readonly stateId: string }
  | { readonly code: "DESTINATION_STATE_MISSING"; readonly stateName: string }
  | { readonly code: "DESTINATION_STATE_AMBIGUOUS"; readonly stateName: string; readonly stateIds: readonly string[] }
  | {
      readonly code: "DESTINATION_STATE_TYPE_DIFFERS";
      readonly stateName: string;
      readonly sourceType: string;
      readonly destinationType: string;
    };

/** A named issue that will move, and the exact form its write sends. */
export interface PlannedIssueMove {
  readonly kind: "move";
  readonly identifier: string;
  readonly issueId: string;
  readonly title: string;
  readonly sourceStateName: string;
  readonly destinationStateId: string;
  /** The cycle it leaves, null when it is in none. */
  readonly cycleId: string | null;
  readonly form: LinearIssueForm;
}

/** A named issue that will not move, with every reason. */
interface RefusedIssueMove {
  readonly kind: "refused";
  readonly identifier: string;
  /** Undefined when Linear returned no such issue. */
  readonly title: string | undefined;
  readonly reasons: readonly IssueMoveRefusal[];
}

/** One row of a plan, in the caller's order. */
export type IssueMoveRow = PlannedIssueMove | RefusedIssueMove;

/** The whole plan. */
export interface IssueMovePlan {
  readonly destination: LinearTeamIdentity;
  readonly rows: readonly IssueMoveRow[];
  readonly moveCount: number;
  readonly refusalCount: number;
}

/** What happened to one planned row under `--apply`. */
export type IssueMoveApplication =
  | { readonly status: "landed"; readonly output: readonly string[] }
  | {
      readonly status: "failed";
      readonly exitCode: number;
      readonly output: readonly string[];
      readonly diagnostics: readonly string[];
    }
  | { readonly status: "not attempted" };

/** A string flag's value, or undefined when it was not given. Pure. */
function stringValue({ values, key }: { values: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = values[key];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/** `--identifier`'s comma list, trimmed, validated, and refused on a repeat. Pure. */
function parseIdentifiers({ value }: { value: string | undefined }): Result<readonly string[]> {
  if (value === undefined || value.trim() === "") {
    return err(["name the issues with --identifier <KEY-1,KEY-2,...>"]);
  }
  const entries = value.split(",").map((entry) => entry.trim());
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!IDENTIFIER.test(entry)) {
      problems.push(`"${entry}" is not an issue identifier like SUP-42`);
    } else if (seen.has(entry)) {
      problems.push(`${entry} is named twice; name each issue once`);
    }
    seen.add(entry);
  }
  return problems.length > 0 ? err(problems) : ok(entries);
}

/**
 * Parse one `linear move-issues` invocation before any credential or network is touched.
 *
 * @param rest the argv tail after `linear move-issues`
 * @returns the resolved options, or every usage problem found
 */
export function parseLinearMoveIssuesArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<LinearMoveIssuesOptions, LinearVerbError> {
  const parsed = parseFlags({ args: rest, spec: MOVE_ISSUES_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const to = stringValue({ key: "to", values });
  if (to === undefined || !TEAM_KEY.test(to)) {
    problems.push(
      `--to takes the destination team's key, such as SOPS, got ${to === undefined ? "nothing" : `"${to}"`}`,
    );
  }
  const identifiers = parseIdentifiers({ value: stringValue({ key: "identifier", values }) });
  if (identifiers.isErr()) {
    problems.push(...identifiers.error);
  }
  if (problems.length > 0 || identifiers.isErr() || to === undefined) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: problems }));
  }
  return ok({
    apply: values["apply"] === true,
    destinationTeamKey: to,
    home: stringValue({ key: "home", values }),
    identifiers: identifiers.value,
    json: values["json"] === true,
  });
}

/** The state-mapping half of a row: the destination state, or why there is none. Pure. */
function mapState({
  issue,
  destination,
  sources,
}: {
  issue: LinearIssueRow;
  destination: LinearStatesDocument;
  sources: readonly LinearStatesDocument[];
}): Result<{ readonly sourceStateName: string; readonly destinationStateId: string }, IssueMoveRefusal> {
  const source = sources
    .find((document) => document.team.id === issue.teamId)
    ?.states.find((state) => state.id === issue.stateId);
  if (source === undefined) {
    return err({ code: "SOURCE_STATE_NOT_READ", stateId: issue.stateId });
  }
  const matches = destination.states.filter((state) => state.name === source.name);
  const [only] = matches;
  if (only === undefined) {
    return err({ code: "DESTINATION_STATE_MISSING", stateName: source.name });
  }
  if (matches.length > 1) {
    return err({
      code: "DESTINATION_STATE_AMBIGUOUS",
      stateIds: matches.map((state) => state.id),
      stateName: source.name,
    });
  }
  if (only.type !== source.type) {
    return err({
      code: "DESTINATION_STATE_TYPE_DIFFERS",
      destinationType: only.type,
      sourceType: source.type,
      stateName: source.name,
    });
  }
  return ok({ destinationStateId: only.id, sourceStateName: source.name });
}

/** Every refusal that applies to one returned issue, the state one aside. Pure. */
function issueRefusals({
  issue,
  children,
  destination,
  viewerId,
}: {
  issue: LinearIssueRow;
  children: readonly LinearIssueRow[];
  destination: LinearTeamIdentity;
  viewerId: string;
}): readonly IssueMoveRefusal[] {
  const reasons: IssueMoveRefusal[] = [];
  if (issue.teamId === destination.id) {
    reasons.push({ code: "ALREADY_DESTINATION", teamKey: destination.key });
  }
  if (issue.archivedAt !== null) {
    reasons.push({ archivedAt: issue.archivedAt, code: "ARCHIVED" });
  }
  if (issue.projectId !== null) {
    reasons.push({ code: "HAS_PROJECT", projectId: issue.projectId });
  }
  if (issue.labelIds.length > 0) {
    reasons.push({ code: "HAS_LABELS", labelIds: issue.labelIds });
  }
  if (issue.assigneeId !== null && issue.assigneeId !== viewerId) {
    reasons.push({ assigneeId: issue.assigneeId, code: "FOREIGN_ASSIGNEE" });
  }
  const sameTeam = children.filter((child) => child.parentId === issue.id && child.teamId === issue.teamId);
  if (sameTeam.length > 0) {
    reasons.push({ code: "SAME_TEAM_CHILDREN", identifiers: sameTeam.map((child) => child.identifier) });
  }
  return reasons;
}

/** One requested identifier's row. Pure. */
function planRow({
  identifier,
  issue,
  children,
  viewerId,
  destination,
  sources,
}: {
  identifier: string;
  issue: LinearIssueRow | undefined;
  children: readonly LinearIssueRow[];
  viewerId: string;
  destination: LinearStatesDocument;
  sources: readonly LinearStatesDocument[];
}): IssueMoveRow {
  if (issue === undefined) {
    return { identifier, kind: "refused", reasons: [{ code: "ISSUE_NOT_RETURNED" }], title: undefined };
  }
  const state = mapState({ destination, issue, sources });
  const reasons = [
    ...issueRefusals({ children, destination: destination.team, issue, viewerId }),
    ...(state.isErr() ? [state.error] : []),
  ];
  if (reasons.length > 0 || state.isErr()) {
    return { identifier, kind: "refused", reasons, title: issue.title };
  }
  return {
    cycleId: issue.cycleId,
    destinationStateId: state.value.destinationStateId,
    form: {
      artifact: UNSENT_ARTIFACT,
      fields: {
        cycleId: null,
        labelIds: [],
        stateId: state.value.destinationStateId,
        teamId: destination.team.id,
        title: issue.title,
      },
    },
    identifier,
    issueId: issue.id,
    kind: "move",
    sourceStateName: state.value.sourceStateName,
    title: issue.title,
  };
}

/**
 * Plan every named move from what was read live. Pure.
 *
 * @param identifiers the named issues, in caller order; absence from `issues` becomes a refused row
 * @param issues what Linear returned for them
 * @param children every issue whose parent is one of `issues`
 * @param viewerId the token's own user, whose assigned issues may move
 * @param destination the destination team's states
 * @param sources the states of every team a returned issue sits in now
 * @returns one row per identifier, plus the counts
 */
export function planIssueMoves({
  identifiers,
  issues,
  children,
  viewerId,
  destination,
  sources,
}: {
  identifiers: readonly string[];
  issues: readonly LinearIssueRow[];
  children: readonly LinearIssueRow[];
  viewerId: string;
  destination: LinearStatesDocument;
  sources: readonly LinearStatesDocument[];
}): IssueMovePlan {
  const rows = identifiers.map((identifier) =>
    planRow({
      children,
      destination,
      identifier,
      issue: issues.find((issue) => issue.identifier === identifier),
      sources,
      viewerId,
    }),
  );
  const moveCount = rows.filter((row) => row.kind === "move").length;
  return { destination: destination.team, moveCount, refusalCount: rows.length - moveCount, rows };
}

/**
 * The exit a plan earns before anything is applied: nothing would move is the expected-empty status, and a
 * partial plan is an error, so a caller cannot read part of a set as the whole of it. Pure.
 *
 * @param plan the computed plan
 * @returns the exit code
 */
export function planExitCode({ plan }: { plan: IssueMovePlan }): number {
  if (plan.moveCount === 0) {
    return EXIT_EXPECTED_EMPTY;
  }
  if (plan.refusalCount > 0) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}
