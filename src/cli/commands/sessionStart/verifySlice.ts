/**
 * The code-owner step of `session-start`'s live re-read: a Slack review ask naming one open pull request gains the owner's
 * share of it (`../../../review/codeOwnerSlice.ts`), read through the door by `./codeOwnerSliceRead.ts`.
 *
 * Split from `./verifyRows.ts` along the seam it adds: that module decides whether a row is still live, this one
 * what one live review ask is worth to the owner.
 */
import { githubToken } from "../../../config.js";
import { viewerLogin } from "../../../live/github/coderabbitYield.js";
import { githubReadGraphql, githubReadRest } from "../../../live/github/read.js";
import type { RankInput } from "../../../sessionStart/rank.js";
import type { RefResolution } from "../../../sessionStart/staleRefs.js";
import { type CodeOwnerSliceRead, readCodeOwnerSlice } from "./codeOwnerSliceRead.js";

/** Whose the token is, or why GitHub would not say. */
export type ViewerLoginRead =
  { readonly kind: "read"; readonly login: string } | { readonly kind: "notChecked"; readonly reason: string };

/** The owner's code-owner slice of one pull request, spending at most `maxReads` reads and saying how many it did. */
export type CodeOwnerSliceSeam = (args: {
  repo: string;
  number: number;
  viewerLogin: string;
  maxReads: number;
}) => Promise<CodeOwnerSliceRead>;

/**
 * The owner's login, read through the door, or why it was not.
 *
 * @param home the state home whose stored `github-token` authenticates the read, so `session-start --home B`
 *   asks as B's account
 * @returns the login, or the reason GitHub would not say
 */
export async function readViewerLive({ home }: { home: string }): Promise<ViewerLoginRead> {
  const token = githubToken({ home });
  if (token === undefined) {
    return { kind: "notChecked", reason: "no GitHub token is stored" };
  }
  const login = await viewerLogin({ graphql: githubReadGraphql({ token }) });
  return login.isOk() ? viewerLoginRead({ login: login.value }) : { kind: "notChecked", reason: login.error.message };
}

/**
 * A login GitHub answered, accepted only in a user login's shape: an `org/team` string would match a team's rule as
 * though the team were the owner.
 *
 * @param login what GitHub said the token's owner is called
 * @returns the login, or why it is not one
 */
export function viewerLoginRead({ login }: { login: string }): ViewerLoginRead {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)
    ? { kind: "read", login }
    : {
        kind: "notChecked",
        reason: `GitHub named the token's owner ${JSON.stringify(login)}, which is not a user login`,
      };
}

/**
 * The owner's code-owner slice of one pull request, read through the door.
 *
 * @param maxReads the live reads it may spend
 * @param home the state home whose stored `github-token` authenticates the reads
 * @returns the slice, or why there is none, with the reads spent
 */
export async function readSliceLive({
  repo,
  number,
  viewerLogin: login,
  maxReads,
  home,
}: {
  repo: string;
  number: number;
  viewerLogin: string;
  maxReads: number;
  home: string;
}): Promise<CodeOwnerSliceRead> {
  const token = githubToken({ home });
  if (token === undefined) {
    return { kind: "notChecked", reads: 0, reason: "no GitHub token is stored" };
  }
  return readCodeOwnerSlice({ maxReads, number, repo, rest: githubReadRest({ token }), viewerLogin: login });
}

/**
 * Why a Slack ask carries no slice when the state check found no reference to read among its links — a six-digit
 * number `bareRefs` does not read, or a row with no canonical repository — so its silence is never taken for a slice
 * that found none of the files.
 *
 * @param input the row the state check read no reference from
 * @returns the line, or undefined when the row is no Slack ask or names no pull request
 */
export function unreadLinksNote({ input }: { input: RankInput }): string | undefined {
  const linked = input.item.linkedPullRequests;
  if (input.item.source !== "slack" || linked === undefined || linked.length === 0) {
    return undefined;
  }
  return `${input.item.nativeId}: no code-owner slice, because the live check reads no reference to ${linked.join(", ")}`;
}

/**
 * A Slack review ask with the owner's code-owner slice of the one pull request it names, or the row as it was and a line
 * saying why there is no slice.
 *
 * Exactly one OPEN pull request, or no slice: a slice belongs to one pull request, and picking one of several would
 * be this module deciding which the ask was about. "Exactly one" counts every link the message carries
 * (`linkedPullRequests`), not only the references resolved: those are narrowed to the first repository and read at
 * five digits at most, so `org/a#1` beside `org/b#2` or `org/a#100000` would otherwise pass as one. A missing slice
 * never marks the row unverified: its state was checked, only the slice was not.
 *
 * A row whose links yield no reference at all never reaches this function; {@link unreadLinksNote} gives it its line.
 * What the count does NOT close, inherited from a reader main already had: it is only as complete as
 * `../../../review/prLink.ts`'s `findPrLinks`, which matches a lowercase `github.com` host, so a hand-typed
 * `GITHUB.com` link is not counted. Making the host match case-blind would close it.
 *
 * @param input the kept row
 * @param repo the canonical `owner/name` its references were read in
 * @param resolutions what the state reads found for each reference
 * @param budget the reads this pass has left after those
 * @param readSlice the live slice read
 * @param viewerOnce the owner's login, read at most once a pass, with what this call of it cost
 * @returns the row, its note when there is no slice, and the reads spent
 */
export async function withCodeOwnerSlice({
  input,
  repo,
  resolutions,
  budget,
  readSlice,
  viewerOnce,
}: {
  input: RankInput;
  repo: string;
  resolutions: readonly RefResolution[];
  budget: number;
  readSlice: CodeOwnerSliceSeam;
  viewerOnce: () => Promise<{ read: ViewerLoginRead; cost: number }>;
}): Promise<{ readonly kept: RankInput; readonly note?: string; readonly reads: number }> {
  const id = input.item.nativeId;
  const [only] = resolutions;
  const linked = input.item.linkedPullRequests;
  if (linked !== undefined && linked.length > 1) {
    const note = `${id}: no code-owner slice, because this ask names ${String(linked.length)} pull requests (${linked.join(", ")}) and a slice belongs to one`;
    return { kept: input, note, reads: 0 };
  }
  if (resolutions.length > 1) {
    const note = `${id}: no code-owner slice, because this ask names ${String(resolutions.length)} pull requests and a slice belongs to one`;
    return { kept: input, note, reads: 0 };
  }
  if (only?.verdict !== "resolved") {
    return { kept: input, reads: 0 };
  }
  const where = `${repo}#${String(only.number)}`;
  if (budget <= 0) {
    return {
      kept: input,
      note: `${id}: no code-owner slice for ${where}, because the live check's bound of reads ran out`,
      reads: 0,
    };
  }
  const viewer = await viewerOnce();
  if (viewer.read.kind === "notChecked") {
    const note = `${id}: no code-owner slice, because GitHub could not say whose the token is: ${viewer.read.reason}`;
    return { kept: input, note, reads: viewer.cost };
  }
  const read = await readSlice({
    maxReads: budget - viewer.cost,
    number: only.number,
    repo,
    viewerLogin: viewer.read.login,
  });
  const reads = viewer.cost + read.reads;
  if (read.kind === "notChecked") {
    return { kept: input, note: `${id}: no code-owner slice for ${where}: ${read.reason}`, reads };
  }
  return { kept: { ...input, item: { ...input.item, codeOwnerSlice: read.slice } }, reads };
}
