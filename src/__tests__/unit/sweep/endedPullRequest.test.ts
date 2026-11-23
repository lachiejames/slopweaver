/**
 * The pure half of the `PR_ENDED` verdict: which pull requests a live ask's question names, and the witness once
 * every one of them has ended.
 */
import { describe, expect, it } from "vitest";

import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { PrClosure } from "../../../live/github/prClosure.js";
import { endedPullRequestWitness, pullRequestKey, questionPullRequests } from "../../../sweep/endedPullRequest.js";
import { closed, merged, open } from "../cli/commands/sweep/sweepReadFixture.js";

import { ask } from "./askDocFixture.js";

/** A live, never-started ask whose question is `summary`. */
function liveAsk(over: Partial<HandoverDoc> = {}): HandoverDoc {
  return ask({ settlement: undefined, settlementWitness: undefined, ...over });
}

/** The one composed row for a doc, over an empty journal. */
function modelOf({ doc }: { doc: HandoverDoc }): BoardModel {
  return composeBoardModels({
    journals: new Map(),
    probeStates: new Map(),
    resolutionDocs: [doc],
    roots: [doc],
  })[0]!;
}

const ACME_2 = "https://github.com/acme/app/pull/2";
const ACME_3 = "https://github.com/acme/app/pull/3";
const CLOSE_2_FOR_3 = `Close ${ACME_2} as superseded by ${ACME_3}?`;

/** Closures keyed the way the reader keys them. */
function closures(...entries: readonly (readonly [string, PrClosure])[]): ReadonlyMap<string, PrClosure> {
  return new Map(entries);
}

describe("pullRequestKey", () => {
  it("lowercases the owner and repository, since GitHub matches both case-insensitively", () => {
    expect(pullRequestKey({ pr: { number: 7, owner: "Acme", repo: "App" } })).toBe("acme/app#7");
  });
});

describe("questionPullRequests", () => {
  it("reads every pull request the question links, in order", () => {
    const named = questionPullRequests({ model: modelOf({ doc: liveAsk({ summary: CLOSE_2_FOR_3 }) }) });

    expect(named.map((pr) => pullRequestKey({ pr }))).toEqual(["acme/app#2", "acme/app#3"]);
  });

  it.each([
    [`Land ${ACME_2} now?`],
    [`merge the PR ${ACME_2}?`],
    [`Should we close draft ${ACME_2}?`],
    [`Should the fleet abandon pull request ${ACME_2}?`],
  ])("reads a question that asks to end the pull request: %s", (summary) => {
    expect(questionPullRequests({ model: modelOf({ doc: liveAsk({ summary }) }) }).length).toBe(1);
  });

  it("reads the measured card's shape, a label in parentheses after each link included", () => {
    const summary = `Close draft #2 (${ACME_2}, encrypted local backup, unwired) as superseded by #3 (${ACME_3})?`;

    const named = questionPullRequests({ model: modelOf({ doc: liveAsk({ summary }) }) });

    expect(named.map((pr) => pullRequestKey({ pr }))).toEqual(["acme/app#2", "acme/app#3"]);
  });

  it.each([
    [`Should we revert the changes from ${ACME_2}?`],
    [`Should the reviewer read ${ACME_2} first?`],
    [`The cut in ${ACME_2} does not close it: should we raise the limit?`],
    [`Close the ticket that ${ACME_2} opened?`],
    [`Close ${ACME_2} and revert ${ACME_3}?`],
    [`Land ${ACME_2} and ${ACME_3} now, or hold unrelated work off main?`],
    [`Close ${ACME_2} (revert it first)?`],
  ])("reads nothing when the pull request's ending would not answer the question: %s", (summary) => {
    expect(questionPullRequests({ model: modelOf({ doc: liveAsk({ summary }) }) })).toEqual([]);
  });

  it("reads nothing when the row is not an ask", () => {
    const named = questionPullRequests({ model: modelOf({ doc: liveAsk({ kind: "doc", summary: CLOSE_2_FOR_3 }) }) });

    expect(named).toEqual([]);
  });

  it("reads nothing when the question names a bare number no link accounts for", () => {
    const named = questionPullRequests({
      model: modelOf({ doc: liveAsk({ summary: `Close ${ACME_2} as superseded by #3?` }) }),
    });

    expect(named).toEqual([]);
  });

  it("reads nothing when the question names no pull request", () => {
    const named = questionPullRequests({ model: modelOf({ doc: liveAsk({ summary: "Which plan should we buy?" }) }) });

    expect(named).toEqual([]);
  });
});

describe("endedPullRequestWitness", () => {
  const model = modelOf({ doc: liveAsk({ summary: CLOSE_2_FOR_3 }) });

  it("names each pull request's ending once all have ended", () => {
    const witness = endedPullRequestWitness({
      closures: closures(["acme/app#2", closed({ number: 2 })], ["acme/app#3", merged({ number: 3 })]),
      model,
    });

    expect(witness).toBe(
      `${ACME_2} closed unmerged at 2026-11-07T02:00:00Z; ${ACME_3} merged at abc3 (2026-11-03T01:00:00Z)`,
    );
  });

  it("gives no witness while one is still open", () => {
    const witness = endedPullRequestWitness({
      closures: closures(["acme/app#2", open({ number: 2 })], ["acme/app#3", merged({ number: 3 })]),
      model,
    });

    expect(witness).toBe(undefined);
  });

  it("gives no witness when one was not read", () => {
    const witness = endedPullRequestWitness({ closures: closures(["acme/app#3", merged({ number: 3 })]), model });

    expect(witness).toBe(undefined);
  });
});
