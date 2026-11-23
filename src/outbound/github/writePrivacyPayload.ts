/**
 * What the GitHub write transport's privacy guard judges in one request, and the verdict over it. Pure: the
 * effectful half — loading the policy from a home and throwing before `fetch` — is `./writePrivacy.ts`.
 *
 * ## What is judged
 *
 * Every STRING LEAF of the write payload `../../corpus/github/writeCtx.ts`'s `githubWritePayload` hands over: a
 * body, a title, a label in a list, a branch, tag or ref name carried as a path parameter, every GraphQL mutation
 * variable however deeply nested. Each leaf is judged on its own, under a locus naming the operation and the
 * field (`github POST /repos/{owner}/{repo}/issues/{issue_number}/comments body`), so a refusal says where and on
 * which line, and never what matched.
 *
 * ## What is not
 *
 * - The transport's own keys: `method`, the URL template, `baseUrl`, `headers` (which carry the credential, so
 *   judging them would refuse every write), `mediaType` and `request`.
 * - The GraphQL `query` document and `operationName`: committed operation syntax, not authored content. Its
 *   `variables` are judged.
 * - `owner` and `repo`: where the text GOES, not what it says. Together they are the destination's
 *   `ownRepository`, which the identifier half reads to forgive the repository's own address.
 *
 * Those keys are skipped at the TOP level only: nested inside `variables`, an `owner` or a `url` is content. Numbers,
 * booleans and nulls carry no text. A GraphQL mutation addressed by node ids alone names no repository, so it is
 * judged under the strict destination: a node id is never taken to prove where a write lands.
 */
import {
  checkPrivacy,
  type PrivacyDestination,
  type PrivacyFinding,
  type PrivacyPolicy,
  UNASSESSED_PERSONAL_MATERIAL,
} from "../privacyCheck.js";
import { payloadLeaves } from "../writePrivacyLeaves.js";

/** One string the guard judges, and the locus a refusal names it by. */
export interface GithubWriteLeaf {
  readonly locus: string;
  readonly text: string;
}

/** The top-level keys that are transport or destination, never content. */
const NOT_CONTENT: ReadonlySet<string> = new Set([
  "baseUrl",
  "headers",
  "mediaType",
  "method",
  "operationName",
  "owner",
  "query",
  "repo",
  "request",
  "url",
]);

/** A plain record, as Octokit's endpoint options and a GraphQL variables object are. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * How a request is named at the head of each locus: its method and URL template, never an expanded URL.
 *
 * @param payload the write payload
 * @returns `github <METHOD> <template>`
 */
function operationName({ payload }: { payload: Readonly<Record<string, unknown>> }): string {
  const method = typeof payload["method"] === "string" ? payload["method"] : "<no method>";
  const url = typeof payload["url"] === "string" ? payload["url"] : "<no url>";
  return `github ${method} ${url}`;
}

/**
 * Every string a write request would send that the guard judges, each under its locus.
 *
 * @param payload the write payload (`githubWritePayload`'s answer for a request that is not a read)
 * @returns the leaves in walk order; none for a payload that is not a record
 */
export function githubWriteLeaves({ payload }: { payload: unknown }): readonly GithubWriteLeaf[] {
  if (!isRecord(payload)) {
    return [];
  }
  const operation = operationName({ payload });
  return payloadLeaves({
    path: "",
    skipKey: ({ key, depth }) => depth === 0 && NOT_CONTENT.has(key),
    value: payload,
  }).map(({ path, text }) => ({ locus: `${operation} ${path}`, text }));
}

/**
 * The repository a write request targets, from its own `owner` and `repo` parameters — never guessed from a URL
 * or a node id.
 *
 * @param payload the write payload
 * @returns `owner/repo`, or undefined when the request does not name both
 */
export function githubWriteTarget({ payload }: { payload: unknown }): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const owner = payload["owner"];
  const repo = payload["repo"];
  if (typeof owner !== "string" || typeof repo !== "string" || owner === "" || repo === "") {
    return undefined;
  }
  return `${owner}/${repo}`;
}

/**
 * Judge every leaf of one write against the outbound privacy check, for one destination. Pure.
 *
 * @param payload the write payload
 * @param destination the facts about where it goes
 * @param policy the denylist, identifier rules and private terms the check reads
 * @returns every finding, leaf by leaf in walk order; empty when the write may be sent
 */
export function githubWriteFindings({
  payload,
  destination,
  policy,
}: {
  payload: unknown;
  destination: PrivacyDestination;
  policy: PrivacyPolicy;
}): readonly PrivacyFinding[] {
  return githubWriteLeaves({ payload }).flatMap(
    (leaf) =>
      checkPrivacy({ content: leaf, destination, personalMaterial: UNASSESSED_PERSONAL_MATERIAL, policy }).findings,
  );
}

/**
 * How the operation is named in a refusal, the same head every leaf's locus carries.
 *
 * @param payload the write payload
 * @returns `github <METHOD> <template>`
 */
export function githubWriteOperation({ payload }: { payload: unknown }): string {
  return isRecord(payload) ? operationName({ payload }) : "github <unrecognised request>";
}
