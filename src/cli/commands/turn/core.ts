/**
 * What `turn brief` and `turn answer` share: the surface vocabulary, the provenance the footer carries, and
 * the flag specs both the parser and the `--help`-truth ratchet read.
 *
 * Its own module because the two verbs are two processes and the values below have to be IDENTICAL across
 * them — the footer a brief promises is the footer the answer prints, and a second copy of the string
 * template is a second place for it to drift.
 */
import { readFileSync } from "node:fs";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import type { MentionSurface } from "../../../live/listen/mention.js";
import { defaultBriefPath } from "../../../live/turn/briefStore.js";
import {
  dispatchedWorkerLabel,
  type SupervisorSession,
  supervisorModelLabel,
  type VisibleSessionHost,
} from "../../../supervisor/session.js";
import { nonEmptyFlagValue } from "../../optionParsers.js";
import { type TurnCommandError, TurnCommandErrors } from "./errors.js";

// The run modules read their usage line through this module, which they import anyway; the manifest reads the
// leaf itself, so the command module never sits on the barrel's load path.
export { TURN_BRIEF_USAGE, TURN_RESUME_USAGE, TURN_USAGE, TURN_WATCH_USAGE } from "./usage.js";

/*
 * What produced the answer, for the provenance footer.
 *
 * This used to read `claude -p (Claude Code session)` and that is now false in the way that matters most:
 * no `claude -p` runs anywhere on this path. The answer is composed by the supervisor session itself —
 * the visible Claude Code turn the owner started — and the footer's entire job is to be checkable, so it
 * names what actually happened. Naming the transport rather than a model id remains right for the original
 * reason: the model behind the session is whatever that session is running, and a literal would be a guess
 * printed as a fact.
 */
/** Host-neutral fallback retained for import compatibility; live wiring uses {@link turnModelLabel}. */
export const TURN_MODEL_LABEL = "the supervisor session (visible, in-turn)";

/**
 * The truthful footer label for the host currently composing the answer.
 *
 * @param session the visible supervisor that owns this turn
 * @returns a host-specific provenance label
 */
export function turnModelLabel({ session }: { session: SupervisorSession }): string {
  return supervisorModelLabel({ session });
}

/**
 * The provenance label one outbound answer must carry — decided by WHO composed it, in the one order that is
 * true.
 *
 * An explicit `--model` wins, because a caller naming what produced the answer knows something this code does
 * not. Otherwise a DISPATCHED answer is labelled by its worker's own record, and only a direct answer — one
 * this very session composed — is labelled by the host variable in this process. That last case used to be
 * the only case, which is how a card posted by a dispatched worker came to read "the supervisor session":
 * `turn answer --dispatch` runs INSIDE the worker, so the environment says "a visible Claude Code session"
 * and the fixed wording said which one, wrongly.
 *
 * @param modelOverride the caller's own `--model`, when passed
 * @param supervisor the visible host this process is running under
 * @param worker the dispatched worker that composed the answer, or `undefined` for a direct answer
 * @returns the label the answer's `grounding.provenance.model` must match
 */
export function answerProvenanceLabel({
  modelOverride,
  supervisor,
  worker,
}: {
  modelOverride: string | undefined;
  supervisor: SupervisorSession;
  worker: { readonly host: VisibleSessionHost; readonly workspaceRef: string } | undefined;
}): string {
  if (modelOverride !== undefined) {
    return modelOverride;
  }
  return worker === undefined
    ? turnModelLabel({ session: supervisor })
    : dispatchedWorkerLabel({ host: worker.host, workspaceRef: worker.workspaceRef });
}

/** The accepted `--surface` values, in the order the usage lines list them. */
export const MENTION_SURFACES: readonly MentionSurface[] = ["channel", "dm"];

/**
 * The visible Claude Code session's own URL, built from the session id this process was launched with.
 *
 * @param env the process environment
 * @returns the session URL, or `undefined` when no session id is set
 */
export function turnSessionUrl({ env }: { env: Readonly<Record<string, string | undefined>> }): string | undefined {
  const id = env["CLAUDE_CODE_SESSION_ID"];
  return id === undefined || id.length === 0 ? undefined : `https://claude.ai/code/session_${id}`;
}

/**
 * The longest single WAIT the worker contract prescribes: `turn review --poll --wait
 * --timeout-seconds 1200` (`./resume.ts` step 3, `skills/loop/reference/worker-contract.md` step 2).
 *
 * Named here rather than typed into the printed line because a second reader now derives from it —
 * `./watch.ts`'s `ORPHAN_SILENCE_MS`, the bound past which an ORPHANED ticker treats its worker's silent
 * transcript as a death. A harness records a tool call when it is ISSUED, so a worker blocked in this one
 * call has a last transcript entry exactly this old while being perfectly alive; anything shorter would
 * reap a live turn. Ratcheted rather than restated:
 * `src/__tests__/unit/cli/commands/turn/watch.test.ts` asserts the relationship between the two.
 */
export const WORKER_REVIEW_WAIT_SECONDS = 1200;

/** The `brief` verb's flag SPEC, exported so the repo-wide `--help`-truth ratchet can read it. */
export const TURN_BRIEF_FLAG_SPEC = {
  boolean: ["contracts", "force"] as readonly string[],
  string: [
    "channel",
    "message-ts",
    "thread-ts",
    "text",
    "user",
    "surface",
    "mode",
    "host",
    "out",
    "home",
    "turn-id",
    "working-ts",
    "rides",
  ],
} as const;

/** The `answer` verb's flag SPEC, exported for the same ratchet. */
export const TURN_FLAG_SPEC = {
  boolean: ["print-digest", "delta-cleared"] as readonly string[],
  string: [
    "brief",
    "answer",
    "decision",
    "verdict",
    "dispatch",
    "session-url",
    "model",
    "home",
    "accounted-for-ts",
    "read-through",
  ],
} as const;

/** The `dispatch` verb's flag SPEC, exported for the same ratchet. */
export const TURN_DISPATCH_FLAG_SPEC = {
  boolean: ["sweep"] as readonly string[],
  string: ["brief", "decision", "subagent-report", "poll", "now", "ask", "warn", "warn-dispatched", "home"],
} as const;

/** The `freeze` verb's flag SPEC, exported for the same ratchet. */
export const TURN_FREEZE_FLAG_SPEC = {
  boolean: [] as readonly string[],
  string: ["ask", "out", "incident", "through", "not-after", "slug", "home", "regresses"],
} as const;

/**
 * Every problem with `freeze`'s three required flags, in one pass: a flag not passed is required, and one passed
 * empty is malformed and named as such, so neither kind of problem hides behind the other.
 *
 * @param ask what `--ask` carried, or `undefined` when it was not passed
 * @param out what `--out` carried, or `undefined` when it was not passed
 * @param incident what `--incident` carried, or `undefined` when it was not passed
 * @returns one line per problem, and none when all three are usable
 * @internal
 */
export function requiredFreezeFlagProblems({
  ask,
  out,
  incident,
}: {
  ask: string | undefined;
  out: string | undefined;
  incident: string | undefined;
}): readonly string[] {
  return Object.entries({ ask, out, incident }).flatMap(([name, value]) => {
    if (value === undefined) {
      return [`--${name} is required`];
    }
    const checked = nonEmptyFlagValue({ name, value });
    return checked.isErr() ? checked.error : [];
  });
}

/**
 * The fixture's slug once `freeze`'s required values are known to be usable: an empty `--out` or `--incident`
 * is malformed and refused apart from a missing one, before the slug is taken from `--slug` or `--out`.
 *
 * @param out the fixture directory `--out` named
 * @param incident what `--incident` said went wrong
 * @param slug what `--slug` carried, or `undefined` when it was not passed
 * @returns the slug, or every line refusing the values
 * @internal
 */
export function freezeSlug({
  out,
  incident,
  slug,
}: {
  out: string;
  incident: string;
  slug: string | undefined;
}): Result<string> {
  const empty = [
    nonEmptyFlagValue({ name: "out", value: out }),
    nonEmptyFlagValue({ name: "incident", value: incident }),
  ].flatMap((checked) => (checked.isErr() ? checked.error : []));
  if (empty.length > 0) {
    return err(empty);
  }
  return fixtureSlug({ out, slug });
}

/**
 * The fixture's slug: `--slug` when the invocation named one, and only otherwise `--out`'s last segment — so
 * an `--out` with no segment of its own is refused only when nothing else names the fixture.
 *
 * @param out the fixture directory `--out` named
 * @param slug what `--slug` carried, or `undefined` when it was not passed
 * @returns the slug, or the usage error naming why there is none
 * @internal
 */
export function fixtureSlug({ out, slug }: { out: string; slug: string | undefined }): Result<string> {
  if (slug !== undefined) {
    return nonEmptyFlagValue({ name: "slug", value: slug });
  }
  return outDirectoryName({ out });
}

/**
 * The last segment of `--out`, which is the fixture's slug unless `--slug` names another. `--out` is the
 * fixture's own directory, so a value with no segment at all (`/`, or only slashes) names none, and it is
 * refused as a usage error rather than frozen under an invented name.
 *
 * @returns the directory's own name, or the usage error naming what `--out` must be
 * @internal
 */
export function outDirectoryName({ out }: { out: string }): Result<string> {
  const parts = out.split("/").filter((part) => part.length > 0);
  const last = parts.at(-1);
  if (last === undefined) {
    return err([`--out must name a directory, got "${out}"`]);
  }
  return ok(last);
}

/** The `resume` verb's flag SPEC, exported for the same ratchet. */
export const TURN_RESUME_FLAG_SPEC = {
  boolean: [] as readonly string[],
  string: ["dispatch", "answer", "failed", "edit-reason", "home"],
} as const;

/** The `review` verb's flag SPEC, exported for the same ratchet. */
export const TURN_REVIEW_FLAG_SPEC = {
  boolean: ["poll", "close", "wait", "delta-cleared"] as readonly string[],
  string: ["dispatch", "brief", "decision", "answer", "model", "home", "timeout-seconds", "read-through"],
} as const;

/** The `ignore` verb's flag SPEC, exported for the same ratchet. */
export const TURN_IGNORE_FLAG_SPEC = {
  boolean: ["remove"] as readonly string[],
  string: ["channel", "message-ts", "reason", "home"],
} as const;

/** The `ignore-conversation` verb's flag SPEC, exported for the same ratchet. */
export const TURN_IGNORE_CONVERSATION_FLAG_SPEC = {
  boolean: ["remove", "list"] as readonly string[],
  string: ["channel", "reason", "home"],
} as const;

/** The `settle-reaction` verb's flag SPEC, exported for the same ratchet. */
export const TURN_SETTLE_REACTION_FLAG_SPEC = {
  boolean: [] as readonly string[],
  string: ["channel", "message-ts", "to", "home"],
} as const;

/** The `status` verb's flag SPEC, exported for the same ratchet. */
export const TURN_STATUS_FLAG_SPEC = {
  boolean: ["dry-run"] as readonly string[],
  string: ["brief", "status", "plan", "step", "tier", "model", "session-url", "home"],
} as const;

/** Every flag `turn status` accepts, as the `--`-prefixed tokens a caller types. */
export const TURN_STATUS_FLAG_NAMES: readonly string[] = [
  ...TURN_STATUS_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_STATUS_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** Every flag `turn answer` accepts, as the `--`-prefixed tokens a caller types. */
export const TURN_FLAG_NAMES: readonly string[] = [
  ...TURN_FLAG_SPEC.string.map((name) => `--${name}`),
  ...TURN_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * A string flag's value, or `undefined` when it was absent.
 *
 * @param values the parsed flag values
 * @param key the flag name, without the leading dashes
 * @returns the value when the flag was given a string, else `undefined`
 */
export function str({
  values,
  key,
}: {
  values: Readonly<Record<string, string | boolean>>;
  key: string;
}): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Where `turn brief` writes the brief: the `--out` path when one was given, else the ask's own default path
 * under the state home.
 *
 * @param values the parsed flag values
 * @param askIdentity the ask the brief is for, which names its default path
 * @param home the state home the default path sits under
 * @returns the path to write the brief to
 */
export function briefOutPath({
  values,
  askIdentity,
  home,
}: {
  values: Readonly<Record<string, string | boolean>>;
  askIdentity: AskIdentity;
  home: string;
}): string {
  const out = str({ key: "out", values });
  if (out === undefined) {
    return defaultBriefPath({ askIdentity, home });
  }
  return out;
}

/**
 * Read a file, turning an unreadable one into a stated reason rather than a stack trace. Shared by
 * `turn dispatch` and `turn resume`, which both load a decision or answer file the same way.
 *
 * @param path the file to read
 * @param what what the file is, for the reason string a failure reports
 * @returns the file's text, or the reason it could not be read
 */
export function readOrReport({ path, what }: { path: string; what: string }): Result<string, TurnCommandError> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (error) {
    return err(TurnCommandErrors.fileUnreadable({ cause: error, path, what }));
  }
}

/**
 * Print every reason and return the code. Shared by `turn dispatch` and `turn resume`.
 *
 * @param code the exit code to return
 * @param errors every reason to print, one line each
 * @returns `code`, unchanged
 */
export function refuse({ code, errors }: { code: number; errors: readonly string[] }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  return code;
}

/** The `block` verb's flag SPEC, exported so the repo-wide `--help`-truth ratchet can read it. */
export const TURN_BLOCK_FLAG_SPEC = {
  boolean: ["dry-run"] as readonly string[],
  string: ["brief", "need", "what", "sign-in-url", "model", "session-url", "home"],
} as const;

/**
 * The `reach` verb's flag SPEC, exported for the same ratchet. `--url` is a list; `--model` and `--session-url`
 * reach the block it enters when a page is signed out.
 */
export const TURN_REACH_FLAG_SPEC = {
  boolean: ["dry-run"] as readonly string[],
  repeatable: ["url"] as readonly string[],
  string: ["brief", "url", "model", "session-url", "home"],
} as const;

/** The `unblock` verb's flag SPEC, exported for the same ratchet. */
export const TURN_UNBLOCK_FLAG_SPEC = {
  boolean: ["dry-run"] as readonly string[],
  string: ["channel", "message-ts", "note", "brief", "model", "session-url", "home"],
} as const;

/** The `blocked` verb's flag SPEC, exported for the same ratchet. */
export const TURN_BLOCKED_FLAG_SPEC = {
  boolean: ["json"] as readonly string[],
  string: ["home"],
} as const;
