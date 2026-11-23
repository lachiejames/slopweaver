/**
 * The field readers `./pullView.ts` narrows GitHub's pull request document with: logins, connections, comments,
 * reviews, threads, requested reviewers and the head commit's checks. Split out of it.
 */

import { type Bag, bags, bool, isBag, num, str, sub } from "./bag";
import type { Login, PullCheck, PullComment, PullRequested, PullReview, PullThread, PullView } from "./pullViewTypes";

/**
 * A login out of an `author { login }` object, where `null` is a deleted account.
 *
 * @returns the login, or `{ ok: false }` when it will not read
 */
export function loginOf({ bag, key }: { bag: Bag; key: string }): { ok: true; login: Login } | { ok: false } {
  const value = bag[key];
  if (value === null) {
    return { login: undefined, ok: true };
  }
  if (!isBag(value)) {
    return { ok: false };
  }
  const login = str({ bag: value, key: "login" });
  if (login === undefined) {
    return { ok: false };
  }
  return { login, ok: true };
}

/**
 * The nodes of a GraphQL connection, or `undefined` when it is not one.
 *
 * @returns the nodes, or `undefined` when the field is not a connection
 */
export function nodesOf({ bag, key }: { bag: Bag; key: string }): readonly Bag[] | undefined {
  const connection = sub({ bag, key });
  if (connection === undefined) {
    return undefined;
  }
  return bags({ bag: connection, key: "nodes" });
}

/**
 * A nullable string field: present-and-null is `undefined`, a wrong type refuses.
 *
 * @returns the string or `undefined`, or `{ ok: false }` for a wrong type
 */
export function optionalStr({
  bag,
  key,
}: {
  bag: Bag;
  key: string;
}): { ok: true; value: string | undefined } | { ok: false } {
  const value = bag[key];
  if (value === null || value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  return { ok: true, value };
}

/** One comment. */
function commentOf({ bag }: { bag: Bag }): PullComment | undefined {
  const id = str({ bag, key: "id" });
  const body = str({ bag, key: "body" });
  const url = str({ bag, key: "url" });
  const createdAt = str({ bag, key: "createdAt" });
  const author = loginOf({ bag, key: "author" });
  if (id === undefined || body === undefined || url === undefined || createdAt === undefined || !author.ok) {
    return undefined;
  }
  return { author: author.login, body, createdAt, id, url };
}

/**
 * Every comment of a connection, or `undefined` when one will not read.
 *
 * @returns every comment, or `undefined` when one will not read
 */
export function commentsOf({ bag, key }: { bag: Bag; key: string }): readonly PullComment[] | undefined {
  const nodes = nodesOf({ bag, key });
  if (nodes === undefined) {
    return undefined;
  }
  const out: PullComment[] = [];
  for (const node of nodes) {
    const comment = commentOf({ bag: node });
    if (comment === undefined) {
      return undefined;
    }
    out.push(comment);
  }
  return out;
}

/**
 * One review.
 *
 * @returns the review, or `undefined` when it will not read
 */
export function reviewOf({ bag }: { bag: Bag }): PullReview | undefined {
  const id = str({ bag, key: "id" });
  const body = str({ bag, key: "body" });
  const url = str({ bag, key: "url" });
  const state = str({ bag, key: "state" });
  const submittedAt = optionalStr({ bag, key: "submittedAt" });
  const author = loginOf({ bag, key: "author" });
  const teams = nodesOf({ bag, key: "onBehalfOf" });
  if (id === undefined || body === undefined || url === undefined || state === undefined || teams === undefined) {
    return undefined;
  }
  if (!submittedAt.ok || !author.ok) {
    return undefined;
  }
  const onBehalfOf: string[] = [];
  for (const team of teams) {
    const slug = str({ bag: team, key: "combinedSlug" });
    if (slug === undefined) {
      return undefined;
    }
    onBehalfOf.push(slug);
  }
  return { author: author.login, body, id, onBehalfOf, state, submittedAt: submittedAt.value, url };
}

/**
 * One review thread.
 *
 * @returns the thread, or `undefined` when it will not read
 */
export function threadOf({ bag }: { bag: Bag }): PullThread | undefined {
  const id = str({ bag, key: "id" });
  const path = str({ bag, key: "path" });
  const resolved = bool({ bag, key: "isResolved" });
  const outdated = bool({ bag, key: "isOutdated" });
  const comments = commentsOf({ bag, key: "comments" });
  const side = str({ bag, key: "diffSide" });
  if (id === undefined || path === undefined || resolved === undefined || outdated === undefined) {
    return undefined;
  }
  // GitHub always sends one of two sides; anything else would hang the thread under a guessed row.
  if (side !== "LEFT" && side !== "RIGHT") {
    return undefined;
  }
  if (comments === undefined) {
    return undefined;
  }
  const first = nodesOf({ bag, key: "comments" })?.[0];
  let diffHunk: string | undefined;
  if (first !== undefined) {
    diffHunk = str({ bag: first, key: "diffHunk" });
  }
  // An outdated thread's line is null: the code it sat on is no longer in the diff.
  return { comments, diffHunk, id, line: num({ bag, key: "line" }), outdated, path, resolved, side };
}

/**
 * One requested reviewer.
 *
 * @returns the requested reviewer, or `undefined` when it will not read
 */
export function requestedOf({ bag }: { bag: Bag }): PullRequested | undefined {
  const asCodeOwner = bool({ bag, key: "asCodeOwner" });
  const reviewer = sub({ bag, key: "requestedReviewer" });
  if (asCodeOwner === undefined || reviewer === undefined) {
    return undefined;
  }
  if (reviewer["__typename"] === "User") {
    const login = str({ bag: reviewer, key: "login" });
    if (login === undefined) {
      return undefined;
    }
    return { asCodeOwner, kind: "user", name: login };
  }
  if (reviewer["__typename"] === "Team") {
    const slug = str({ bag: reviewer, key: "combinedSlug" });
    if (slug === undefined) {
      return undefined;
    }
    return { asCodeOwner, kind: "team", name: slug };
  }
  return undefined;
}

/** One check context: a check run or a commit status. */
function checkOf({ bag }: { bag: Bag }): PullCheck | undefined {
  if (bag["__typename"] === "CheckRun") {
    const name = str({ bag, key: "name" });
    const status = str({ bag, key: "status" });
    const conclusion = optionalStr({ bag, key: "conclusion" });
    const url = optionalStr({ bag, key: "detailsUrl" });
    if (name === undefined || status === undefined || !conclusion.ok || !url.ok) {
      return undefined;
    }
    let result = status;
    if (conclusion.value !== undefined) {
      result = conclusion.value;
    }
    return { name, result, url: url.value };
  }
  if (bag["__typename"] === "StatusContext") {
    const name = str({ bag, key: "context" });
    const state = str({ bag, key: "state" });
    const url = optionalStr({ bag, key: "targetUrl" });
    if (name === undefined || state === undefined || !url.ok) {
      return undefined;
    }
    return { name, result: state, url: url.value };
  }
  return undefined;
}

/**
 * The head commit's rollup, or `undefined` for a head with none; `false` when it will not read.
 *
 * @returns the checks and head oid, or `false` when the rollup will not read
 */
export function checksOf({
  data,
}: {
  data: Bag;
}): { ok: true; value: PullView["checks"]; oid: string | undefined } | false {
  const commits = nodesOf({ bag: data, key: "commits" });
  // A read with no commits list at all is not a head with no checks: saying "no checks" there would be a guess.
  if (commits === undefined) {
    return false;
  }
  const commit = commits.at(0);
  if (commit === undefined) {
    return { oid: undefined, ok: true, value: undefined };
  }
  const inner = sub({ bag: commit, key: "commit" });
  if (inner === undefined) {
    return false;
  }
  const oid = str({ bag: inner, key: "oid" });
  if (inner["statusCheckRollup"] === null) {
    return { oid, ok: true, value: undefined };
  }
  const rollup = sub({ bag: inner, key: "statusCheckRollup" });
  const state = rollup === undefined ? undefined : str({ bag: rollup, key: "state" });
  const contexts = rollup === undefined ? undefined : sub({ bag: rollup, key: "contexts" });
  const nodes = contexts === undefined ? undefined : bags({ bag: contexts, key: "nodes" });
  const total = contexts === undefined ? undefined : num({ bag: contexts, key: "totalCount" });
  if (state === undefined || nodes === undefined || total === undefined) {
    return false;
  }
  const items: PullCheck[] = [];
  for (const node of nodes) {
    const check = checkOf({ bag: node });
    if (check === undefined) {
      return false;
    }
    items.push(check);
  }
  return { oid, ok: true, value: { items, state, total } };
}
