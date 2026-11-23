/**
 * The discuss-first nudge: when the owner's own words ask the fleet to raise a fix on a TEAM repository, the voice's
 * whole answer is one light question, said once a call per repository, before anything starts.
 *
 * It asks whether the fix was discussed with the team first, in the shape of the meeting-start nudge, and an ask the
 * owner makes outranks nearly everything else. So it is a question, never a block: the owner's next word on it
 * stands, and it is never said twice in one call for one repository. Doctrine: `docs/doctrine-rationale/rule-10-team-facing.md`.
 *
 * Team-facing only: a fix to Slopweaver itself, the fleet's own setup, is never nudged (the same ownership rule
 * `./workspacePlacement.ts` applies to a row). Pure: the call's ledger is the caller's (`components/voice/relayAttempt.ts`).
 */
import { threadKeyOf } from "./slackLink";
import type { WorkspaceEvidence, WorkspacePlacer } from "./workspacePlacement";
import { repositoryOf } from "./workspacePlacementAddress";

/** The question itself, in the owner's voice; `skills/supervisor/reference/routing.md` asks the same one in the chair. */
export const DISCUSS_FIRST_QUESTION =
  "Did you actually discuss this with the team first? If you did, I'm not aware of it.";

/** The longest Slack thread link a fix ask carries; a real permalink is under 120 characters. `talk relay` holds the same. */
export const FIX_THREAD_MAX = 200;

/** A fix the owner's words ask be raised on a team repository, as `relay_steer`'s `fix_repo` and `fix_thread` named it. */
export interface TeamFixAsk {
  /** Lower-case `owner/repo`, a repository of the organisation other than Slopweaver's own. */
  readonly repository: string;
  /** The Slack permalink of the conversation about the problem, when the voice had one. */
  readonly thread: string | undefined;
}

/** What the call already said for one repository: the relay that put the question to the owner. */
export interface PriorDiscussFirst {
  readonly turnId: string;
}

/**
 * What a relay does about the nudge: nothing, put the question (the first fix ask for that repository this call), or
 * carry the owner's ask past it (a later one — their answer, or the ask again — which stands).
 */
export type DiscussFirstDecision =
  | { readonly kind: "none" }
  | { readonly kind: "put"; readonly repository: string; readonly thread: string | undefined }
  | {
      readonly kind: "override";
      readonly repository: string;
      readonly thread: string | undefined;
      readonly priorTurnId: string;
    };

/** The decision as the relay carries it to `talk relay`: every arm but `none`. */
export type DiscussFirstWire =
  | { readonly status: "put"; readonly repository: string; readonly thread?: string }
  | {
      readonly status: "override";
      readonly repository: string;
      readonly thread?: string;
      readonly priorTurnId: string;
    };

/**
 * The fix ask out of a `relay_steer` call's arguments, or why the pair is refused. A repository of Slopweaver's own is
 * no team fix, so it carries none rather than refusing a steer that is otherwise sound.
 *
 * @param args the tool call's arguments
 * @param placer the organisation's address readers, which say whether the repository is the team's
 * @returns the ask (`undefined` when the relay names no team fix), or the refusal sentence
 */
export function teamFixAskOf({
  args,
  placer,
}: {
  args: Record<string, unknown>;
  placer: WorkspacePlacer;
}): { readonly ask: TeamFixAsk | undefined } | { readonly why: string } {
  const repo = args["fix_repo"];
  const thread = args["fix_thread"];
  if (repo === undefined) {
    if (thread !== undefined) {
      return { why: "fix_thread goes only with fix_repo. Drop it, or name the repository the fix is raised on" };
    }
    return { ask: undefined };
  }
  const evidence = typeof repo === "string" ? fixRepositoryOf({ placer, value: repo.trim() }) : undefined;
  if (evidence === undefined) {
    return {
      why:
        "fix_repo must be one of the organisation's repositories as owner/name. With none you can name, relay " +
        "again without fix_repo",
    };
  }
  if (thread !== undefined && !isFixThread(thread)) {
    return {
      why: "fix_thread must be a Slack message link read off the owner's screen or a tool, never composed. Otherwise drop it",
    };
  }
  if (evidence.workspace === "self") {
    return { ask: undefined };
  }
  return { ask: { repository: evidence.value, thread } };
}

/**
 * Whether a value is a thread link a fix ask carries: a Slack message permalink within {@link FIX_THREAD_MAX}, with no
 * whitespace anywhere in it. `talk relay` holds `--fix-thread` to the same shape.
 *
 * @returns whether it is one
 */
function isFixThread(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= FIX_THREAD_MAX &&
    !/\s/u.test(value) &&
    threadKeyOf({ link: value }) !== undefined
  );
}

/**
 * The organisation repository a value names, as the placer's `repositoryEvidence` reads it, unless its name still
 * ends in `.git` once the one clone suffix is dropped: no repository has such a name.
 *
 * @returns the evidence, or `undefined` when the value names no repository a fix could be raised on
 */
function fixRepositoryOf({ placer, value }: { placer: WorkspacePlacer; value: string }): WorkspaceEvidence | undefined {
  const evidence = placer.repositoryEvidence({ value });
  if (evidence === undefined || evidence.value.endsWith(".git")) {
    return undefined;
  }
  return evidence;
}

/**
 * Whether a wire value is a repository in the shape a fix ask carries: lower-case `owner/name`, exactly, never a URL
 * or a clone suffix. Whose repository it is goes unjudged here: the route reads no organisation, and `talk relay`
 * refuses a repository that is not the team's against the one it reads (`teamFixRefusal`).
 *
 * @returns whether it is one
 */
function isWireRepository(value: unknown): value is string {
  return typeof value === "string" && repositoryOf({ value }) === value && !value.endsWith(".git");
}

/**
 * Whether this relay puts the question, or carries the owner's ask past one this call already put for that repository.
 *
 * @param ask the fix ask, or `undefined` when the relay names none
 * @param prior what this call already said for the ask's repository, or `undefined` when nothing
 * @returns the decision
 */
export function discussFirstDecision({
  ask,
  prior,
}: {
  ask: TeamFixAsk | undefined;
  prior: PriorDiscussFirst | undefined;
}): DiscussFirstDecision {
  if (ask === undefined) {
    return { kind: "none" };
  }
  if (prior === undefined) {
    return { kind: "put", repository: ask.repository, thread: ask.thread };
  }
  return { kind: "override", priorTurnId: prior.turnId, repository: ask.repository, thread: ask.thread };
}

/**
 * The decision as the relay's wire carries it.
 *
 * @returns the wire field, or `undefined` for `none`
 */
export function discussFirstWireOf({ decision }: { decision: DiscussFirstDecision }): DiscussFirstWire | undefined {
  if (decision.kind === "none") {
    return undefined;
  }
  const thread = decision.thread === undefined ? {} : { thread: decision.thread };
  if (decision.kind === "put") {
    return { repository: decision.repository, status: "put", ...thread };
  }
  return { priorTurnId: decision.priorTurnId, repository: decision.repository, status: "override", ...thread };
}

/** A relay's turn id: the v4 UUID the page mints, as `./talkRelayRequestWire.ts`'s `UUID_V4` holds `turnId` to. */
const TURN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Every key the wire field may carry; any other is refused rather than dropped. */
const WIRE_KEYS: ReadonlySet<string> = new Set(["priorTurnId", "repository", "status", "thread"]);

/**
 * The wire field out of a posted relay body, or why it is refused: a repository and thread in the shape
 * {@link teamFixAskOf} produces, and the prior turn on an override only. Whose repository it is, `talk relay` judges.
 *
 * @param value the body's `discussFirst`
 * @returns the field (`undefined` when absent), or the refusal sentence
 */
export function discussFirstWireFrom({
  value,
}: {
  value: unknown;
}): { readonly discussFirst: DiscussFirstWire | undefined } | { readonly why: string } {
  if (value === undefined) {
    return { discussFirst: undefined };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { why: "discussFirst must be an object" };
  }
  const bag: Record<string, unknown> = { ...value };
  if (Object.keys(bag).some((key) => !WIRE_KEYS.has(key))) {
    return { why: "discussFirst carries status, repository, thread and priorTurnId only" };
  }
  const { priorTurnId, repository, status, thread } = bag;
  if (!isWireRepository(repository)) {
    return { why: "discussFirst.repository must be a repository as lower-case owner/name" };
  }
  if (thread !== undefined && !isFixThread(thread)) {
    return { why: "discussFirst.thread must be a Slack message link" };
  }
  const threadField = thread === undefined ? {} : { thread };
  if (status === "put") {
    if (priorTurnId !== undefined) {
      return { why: "discussFirst.priorTurnId goes only with status override" };
    }
    return { discussFirst: { repository, status, ...threadField } };
  }
  if (status !== "override") {
    return { why: "discussFirst.status must be put or override" };
  }
  if (typeof priorTurnId !== "string" || !TURN_ID.test(priorTurnId)) {
    return { why: "discussFirst.priorTurnId must be the v4 UUID of the relay that put the question" };
  }
  return { discussFirst: { priorTurnId, repository, status, ...threadField } };
}

/**
 * What the voice says when it puts the question: the question, light, and where the conversation would start when it
 * had the thread. A link is never read aloud.
 *
 * @param thread whether the voice had the thread
 * @returns the sentence the voice says, exactly
 */
export function discussFirstSpeech({ thread }: { thread: boolean }): string {
  if (thread) {
    return `Quick check. ${DISCUSS_FIRST_QUESTION} That thread is the place to start it.`;
  }
  return `Quick check. ${DISCUSS_FIRST_QUESTION}`;
}
