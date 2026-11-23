/**
 * Pure parser, refusal logic and door request for `slopweaver github close`.
 *
 * The missing door named in `AGENTS.md`'s doctrine: no governed verb could close a pull request at all, so
 * an owner-ruled close dead-ended into a manual click — a raw `gh` mutation, or the web UI, both outside rule 3
 * (one door). This is that door, scoped as narrowly as `github ready` is.
 *
 * A silent close is the failure mode this repo bans everywhere else (see `github merge`'s acknowledgement
 * requirement, `github comment`'s attributable posting). So closing requires the pull request to already
 * carry a recent comment, or a `--why` that becomes one — never both silence and a close.
 */
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";

const GITHUB_CLOSE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["repo", "number", "why", "expect-head", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_CLOSE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_CLOSE_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_CLOSE_FLAGS }),
].map((name) => `--${name}`);

/** How recent a standing comment must be to satisfy the gate without a `--why`. */
const CLOSE_RECENT_COMMENT_WINDOW_MS = 60 * 60 * 1000;

/** The resolved close request. */
export interface GithubCloseArgs {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly why: string | undefined;
  /** The head the caller judged the close on; a pull request whose live head differs is refused. */
  readonly expectHead: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** What is wrong with an `--expect-head` value: nothing when it is absent or a full lowercase commit sha. */
function expectHeadProblems({ value }: { value: unknown }): readonly string[] {
  return typeof value === "string" && !/^[0-9a-f]{40}$/u.test(value)
    ? ["--expect-head must be a full 40-character lowercase commit sha"]
    : [];
}

/**
 * Parse the close request before resolving a credential.
 *
 * @param rest argv after `github close`
 * @returns the resolved address, reason and modes, or every usage problem
 */
export function parseGithubCloseArgs({ rest }: { rest: readonly string[] }): Result<GithubCloseArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_CLOSE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const repoValue = parsed.value.values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const numberValue = parsed.value.values["number"];
  const number = typeof numberValue === "string" ? Number(numberValue) : Number.NaN;
  if (!Number.isInteger(number) || number <= 0) {
    errors.push("--number must be a positive whole number");
  }
  const whyValue = parsed.value.values["why"];
  if (typeof whyValue === "string" && whyValue.trim().length === 0) {
    errors.push("--why must not be blank");
  }
  const expectHead = parsed.value.values["expect-head"];
  errors.push(...expectHeadProblems({ value: expectHead }));
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const home = parsed.value.values["home"];
  return ok({
    dryRun: parsed.value.values["dry-run"] === true,
    expectHead: typeof expectHead === "string" ? expectHead : undefined,
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    number,
    owner: repo.owner,
    repo: repo.repo,
    why: typeof whyValue === "string" ? whyValue : undefined,
  });
}

/** Why a close is refused before ever reaching the door — the live state it was refused on, named in prose. */
interface CloseRefusal {
  readonly reason: string;
}

/**
 * Whether the live pull request may be closed at all, before the comment gate is even consulted.
 *
 * A merged pull request and one already closed without merging both read back `state: "closed"` — `merged`
 * is the one field that tells them apart, and the refusal names which of the two it actually is rather than
 * printing the same "already closed" line for both.
 *
 * @param number the pull request's number, for the message
 * @param state the live pull request's state, as GitHub reports it
 * @param mergedAtIso when GitHub merged it, or undefined if it never was
 * @returns the refusal, or undefined when the pull request is open and closing may proceed
 */
export function closeStateRefusal({
  number,
  state,
  mergedAtIso,
}: {
  number: number;
  state: string;
  mergedAtIso: string | undefined;
}): CloseRefusal | undefined {
  if (mergedAtIso !== undefined) {
    return { reason: `#${String(number)} was merged at ${mergedAtIso} (state: ${state}) — nothing to close` };
  }
  if (state.toLowerCase() !== "open") {
    return { reason: `#${String(number)} is already closed (state: ${state})` };
  }
  return undefined;
}

/**
 * Whether the read answered about the pull request asked for. The comment and the close address the ASKED
 * number, so a read about any other one must not be what clears them.
 *
 * @param args the parsed repository and number the close addresses
 * @param url the address the read answered with
 * @param number the number the read answered with — checked as well as the url, since either alone can disagree
 * @returns the refusal, or undefined when the read is about that pull request
 */
export function closeIdentityRefusal({
  args,
  url,
  number,
}: {
  args: GithubCloseArgs;
  url: string;
  number: number;
}): CloseRefusal | undefined {
  const asked = `https://github.com/${args.owner}/${args.repo}/pull/${String(args.number)}`;
  if (url.toLowerCase() === asked.toLowerCase() && number === args.number) {
    return undefined;
  }
  return { reason: `the read of ${asked} answered about ${url} (#${String(number)}) — nothing closed` };
}

/**
 * Whether the live pull request is still at the head its caller judged the close on.
 *
 * A caller that decided on one read and closes on a later one (`github bump-drive`'s superseded close) passes
 * the head it judged, so a push landing between the two is refused by THIS read — the last one before the
 * comment and the close. GitHub's close mutation itself takes no expected head, so a push after this read is
 * the one window left.
 *
 * @param number the pull request's number, for the message
 * @param headSha the live head this read saw
 * @param expectHead the head the caller judged, or undefined when it named none
 * @returns the refusal, or undefined when no head was expected or the live one matches it
 */
export function closeHeadRefusal({
  number,
  headSha,
  expectHead,
}: {
  number: number;
  headSha: string;
  expectHead: string | undefined;
}): CloseRefusal | undefined {
  if (expectHead === undefined || headSha === expectHead) {
    return undefined;
  }
  return { reason: `#${String(number)} is at ${headSha}, not the expected head ${expectHead} — it moved` };
}

/**
 * The ISO-8601 instant the recent-comment window opened.
 *
 * @param nowIso the current instant, ISO-8601
 * @returns the cutoff a comment's own creation time must be at or after
 */
export function closeCommentWindowStartIso({ nowIso }: { nowIso: string }): string {
  return new Date(new Date(nowIso).getTime() - CLOSE_RECENT_COMMENT_WINDOW_MS).toISOString();
}

/**
 * Whether any of the given comments was created inside the recent-comment window.
 *
 * @param comments every comment `github close` read back, any author
 * @param cutoffIso the window's start, from {@link closeCommentWindowStartIso}
 * @returns true when at least one comment satisfies the gate
 */
export function hasCommentSince({
  comments,
  cutoffIso,
}: {
  comments: readonly { readonly createdAtIso: string }[];
  cutoffIso: string;
}): boolean {
  const cutoffMs = new Date(cutoffIso).getTime();
  return comments.some((comment) => new Date(comment.createdAtIso).getTime() >= cutoffMs);
}

/**
 * The external-write door request for one exact pull-request close.
 *
 * @param args the parsed repository and pull-request identity
 * @param home the Slopweaver state home whose door records the transition
 * @returns the exact external-write request admitted by the door
 */
export function closeDoorRequest({ args, home }: { args: GithubCloseArgs; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "close" },
    artifact: { id: `${args.owner}/${args.repo}#${String(args.number)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
