/**
 * Pure parser, door request and `list` line formatting for `slopweaver github thread`.
 *
 * One flag spec across every sub-verb rather than one each, because they address the same object with the
 * same coordinates and differ only in which of `--thread`/`--body` each requires. `stack`'s three genuinely
 * different parsers are the other shape; this is not that case.
 *
 * The parsed result is a UNION rather than one shape with everything optional: `list` has no thread and the
 * answer sub-verbs always have one, so the door request and the shell never have to coalesce a missing id
 * into something printable.
 */

import type { DoorRequest } from "../../../admit/types.js";
import { err, ok } from "../../../lib/result.js";
import type { ReviewThreadDetail } from "../../../outbound/github/threads.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";

const SUB_VERBS = ["list", "reply", "resolve", "reopen"] as const;

/**
 * Which thread sub-verb an invocation named.
 *
 * @internal
 */
export type GithubThreadSubVerb = (typeof SUB_VERBS)[number];

const GITHUB_THREAD_FLAGS: FlagSpec = {
  boolean: ["resolve", "open", "full", "dry-run", "json"],
  string: ["repo", "number", "thread", "body", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_THREAD_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_THREAD_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_THREAD_FLAGS }),
].map((name) => `--${name}`);

/** The pull request every sub-verb addresses, and the modes every sub-verb honours. */
interface GithubThreadAddress {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** `list` — a read of the whole pull request, addressing no thread. */
export interface GithubThreadListArgs extends GithubThreadAddress {
  readonly subVerb: "list";
  /** Only unresolved threads — the ones a reviewer is still holding. */
  readonly openOnly: boolean;
  /** Print each thread's whole opening comment, not only its first characters. */
  readonly full: boolean;
}

/** `reply`, `resolve` or `reopen` — one exact thread, and what to do to it. */
export interface GithubThreadAnswerArgs extends GithubThreadAddress {
  readonly subVerb: "reply" | "resolve" | "reopen";
  readonly threadId: string;
  /** The reply text, `-` while it is still the literal stdin request; `undefined` for `resolve` and `reopen`. */
  readonly body: string | undefined;
  readonly resolve: boolean;
}

/**
 * The resolved thread operation.
 *
 * @internal
 */
export type GithubThreadArgs = GithubThreadListArgs | GithubThreadAnswerArgs;

/** A narrowing guard for the fixed set of recognised sub-verbs. */
function isSubVerb(value: string | undefined): value is GithubThreadSubVerb {
  return value !== undefined && (SUB_VERBS as readonly string[]).includes(value);
}

/** The raw flag values every sub-verb's own rules are checked against. */
interface ThreadPayload {
  readonly threadId: string | undefined;
  readonly body: string | undefined;
  readonly resolve: boolean;
  readonly open: boolean;
  readonly full: boolean;
}

/** `list` addresses the pull request, so an answer flag on it is a mistake rather than a no-op. */
function listProblems({ payload }: { payload: ThreadPayload }): readonly string[] {
  return [
    payload.threadId === undefined ? "" : "--thread is not a `list` flag",
    payload.body === undefined ? "" : "--body is not a `list` flag",
    payload.resolve ? "--resolve is not a `list` flag" : "",
  ].filter((problem) => problem.length > 0);
}

/**
 * `reply` needs something to say; `resolve` refuses both a body and a redundant `--resolve`; `reopen` refuses
 * both, since it only ever undoes a resolve.
 */
function answerProblems({
  subVerb,
  payload,
}: {
  subVerb: "reply" | "resolve" | "reopen";
  payload: ThreadPayload;
}): readonly string[] {
  const thread = payload.threadId === undefined || payload.threadId.length === 0 ? "--thread <id> is required" : "";
  const listOnly = [
    payload.open ? `--open is not a \`${subVerb}\` flag` : "",
    payload.full ? `--full is not a \`${subVerb}\` flag` : "",
  ];
  return [thread, ...bodyProblems({ payload, subVerb }), ...listOnly].filter((problem) => problem.length > 0);
}

/** What `--body` and `--resolve` may not be for one answering sub-verb, as `answerProblems` lists them. */
function bodyProblems({
  subVerb,
  payload,
}: {
  subVerb: "reply" | "resolve" | "reopen";
  payload: ThreadPayload;
}): readonly string[] {
  if (subVerb === "reply") {
    return [payload.body === undefined || payload.body.length === 0 ? "--body <text|-> is required for `reply`" : ""];
  }
  if (subVerb === "reopen") {
    return [
      payload.body === undefined ? "" : "--body is not a `reopen` flag",
      payload.resolve ? "--resolve is not a `reopen` flag" : "",
    ];
  }
  return [
    payload.body === undefined ? "" : "--body is not a `resolve` flag; use `reply --resolve`",
    payload.resolve ? "--resolve is not a `resolve` flag; the sub-verb already says so" : "",
  ];
}

/** The pull request and modes every sub-verb shares, or every problem with how they were given. */
function parseAddress({
  values,
}: {
  values: Readonly<Record<string, string | boolean | undefined>>;
}): GithubVerbResult<GithubThreadAddress> {
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  const numberValue = values["number"];
  const number = typeof numberValue === "string" ? Number(numberValue) : Number.NaN;
  const errors = [
    repo === undefined ? "--repo owner/name is required" : "",
    Number.isInteger(number) && number > 0 ? "" : "--number must be a positive whole number",
  ].filter((problem) => problem.length > 0);
  if (errors.length > 0 || repo === undefined) {
    return err(GithubVerbErrors.argumentsRefused({ reasons: errors }));
  }
  const home = values["home"];
  return ok({
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    number,
    owner: repo.owner,
    repo: repo.repo,
  });
}

/** The `--thread`/`--body`/`--resolve` trio as given, before any sub-verb's rules are applied to it. */
function readPayload({ values }: { values: Readonly<Record<string, string | boolean | undefined>> }): ThreadPayload {
  const threadValue = values["thread"];
  const bodyValue = values["body"];
  return {
    body: typeof bodyValue === "string" ? bodyValue : undefined,
    full: values["full"] === true,
    open: values["open"] === true,
    resolve: values["resolve"] === true,
    threadId: typeof threadValue === "string" ? threadValue : undefined,
  };
}

/**
 * Parse the thread operation before resolving a credential.
 *
 * @param argv the verb's own argument tail, after `github thread`
 * @returns the resolved sub-verb, address and payload, or every usage problem
 */
export function parseGithubThreadArgs({ argv }: { argv: readonly string[] }): GithubVerbResult<GithubThreadArgs> {
  const subVerb = argv[0];
  if (!isSubVerb(subVerb)) {
    return err(GithubVerbErrors.usage({ command: "thread", shape: `<${SUB_VERBS.join("|")}>` }));
  }
  const parsed = parseFlags({ allowPositionals: false, args: argv.slice(1), spec: GITHUB_THREAD_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const payload = readPayload({ values: parsed.value.values });
  const address = parseAddress({ values: parsed.value.values });
  const rules = subVerb === "list" ? listProblems({ payload }) : answerProblems({ payload, subVerb });
  if (address.isErr() || rules.length > 0) {
    const addressLines = address.isErr() ? githubVerbErrorLines({ error: address.error }) : [];
    return err(GithubVerbErrors.argumentsRefused({ reasons: [...addressLines, ...rules] }));
  }
  if (subVerb === "list") {
    return ok({ ...address.value, full: payload.full, openOnly: payload.open, subVerb });
  }
  if (payload.threadId === undefined) {
    // Unreachable: `answerProblems` already required it above. Narrowed here rather than coalesced, so a
    // future edit that drops that rule fails loud instead of addressing an empty thread id.
    return err(GithubVerbErrors.threadRequired());
  }
  return ok({
    ...address.value,
    body: payload.body,
    resolve: subVerb === "resolve" || payload.resolve,
    subVerb,
    threadId: payload.threadId,
  });
}

/** How much of a thread's opening comment `list` shows before the reader should go and read it. */
const BODY_EXCERPT_CHARS = 120;

/** Where a thread hangs, when GitHub reports a file for it — an outdated thread reports neither. */
function threadLocation({ thread }: { thread: ReviewThreadDetail }): string | undefined {
  if (thread.path === undefined) {
    return undefined;
  }
  return thread.line === undefined ? thread.path : `${thread.path}:${String(thread.line)}`;
}

/** Who opened a thread, or `unknown` when GitHub names no author for it. */
function threadAuthor({ thread }: { thread: ReviewThreadDetail }): string {
  if (thread.author === undefined) {
    return "unknown";
  }
  return thread.author;
}

/**
 * One thread as a single scannable line: state, id, where, who opened it, and the start of what they said.
 *
 * @param thread the thread `list` is showing
 * @returns the line, with empty parts left out
 */
export function threadLine({ thread }: { thread: ReviewThreadDetail }): string {
  const parts: readonly (string | undefined)[] = [
    thread.isResolved ? "resolved" : "OPEN",
    thread.id,
    threadLocation({ thread }),
    `@${threadAuthor({ thread })}`,
    thread.body.replaceAll(/\s+/g, " ").trim().slice(0, BODY_EXCERPT_CHARS),
  ];
  return parts.filter((part) => part !== undefined && part.length > 0).join("  ");
}

/**
 * The external-write door request for one exact review thread.
 *
 * @param args the parsed sub-verb, address and thread
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function threadDoorRequest({ args, home }: { args: GithubThreadAnswerArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: `thread ${args.subVerb}` },
    artifact: { id: `${args.owner}/${args.repo}#${String(args.number)} ${args.threadId}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
