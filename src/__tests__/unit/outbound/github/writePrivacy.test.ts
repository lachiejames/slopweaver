/**
 * The outbound privacy check at the GitHub write transport, through the real write Octokit and a real private-terms
 * file under a throwaway home. Each request carries its own counting `fetch` (Octokit's per-request `request.fetch`,
 * a seam rather than a mock), so a refused write is seen to send nothing and a clean one to send exactly once.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { makeGithubWriteCtx } from "../../../../corpus/github/writeCtx.js";
import { GithubPrivacyRefusedError, githubWritePrivacy } from "../../../../outbound/github/writePrivacy.js";
import { writePrivateTerms } from "../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, its private-terms file holding `rows`, or absent when `rows` is undefined. */
function homeWith({ rows }: { rows: readonly string[] | undefined }): string {
  const home = mkdtempSync(join(tmpdir(), "write-privacy-"));
  homes.push(home);
  if (rows !== undefined) {
    writePrivateTerms({ home, rows });
  }
  return home;
}

/** The write lane's client over one home. */
function clientFor({ home }: { home: string }): ReturnType<typeof makeGithubWriteCtx>["client"] {
  return makeGithubWriteCtx({ privacy: githubWritePrivacy({ home }), token: "ghp_not_a_real_token" }).client;
}

/** A `fetch` answering every request with one JSON body, and the count of requests it was handed. */
function countingFetch({ body }: { body: unknown }): {
  readonly calls: () => number;
  readonly request: { fetch: typeof fetch };
} {
  let calls = 0;
  const answer: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status: 200 });
  };
  return { calls: () => calls, request: { fetch: answer } };
}

const PERSON = ["person\ti\tquillfeather\tsynthetic"];

describe("the GitHub write transport's privacy guard", () => {
  it("refuses a comment carrying a private term before fetch, naming the field and class only", async () => {
    const seam = countingFetch({ body: { id: 1 } });
    const sent = clientFor({ home: homeWith({ rows: PERSON }) }).rest.issues.createComment({
      body: "thanks Quillfeather",
      issue_number: 1,
      owner: "acme",
      repo: "widgets",
      request: seam.request,
    });
    await expect(sent).rejects.toThrow(GithubPrivacyRefusedError);
    await expect(sent).rejects.toThrow(
      "github POST /repos/{owner}/{repo}/issues/{issue_number}/comments body line 1: a private person term",
    );
    await expect(sent).rejects.not.toThrow(/quillfeather/iu);
    expect(seam.calls()).toBe(0);
  });

  it("refuses a label carrying a private term, which no pull-request gate ever sees", async () => {
    const seam = countingFetch({ body: [] });
    const sent = clientFor({ home: homeWith({ rows: PERSON }) }).rest.issues.addLabels({
      issue_number: 1,
      labels: ["quillfeather"],
      owner: "acme",
      repo: "widgets",
      request: seam.request,
    });
    await expect(sent).rejects.toThrow("labels[0] line 1: a private person term");
    expect(seam.calls()).toBe(0);
  });

  it("refuses a GraphQL mutation whose variable carries a private term", async () => {
    const seam = countingFetch({ body: { data: {} } });
    const sent = clientFor({ home: homeWith({ rows: PERSON }) }).graphql(
      "mutation($id: ID!, $body: String!) { addComment(input: { subjectId: $id, body: $body }) { clientMutationId } }",
      { body: "for quillfeather", id: "I_kwFIXTURE", request: seam.request },
    );
    await expect(sent).rejects.toThrow("github POST /graphql variables.body line 1: a private person term");
    expect(seam.calls()).toBe(0);
  });

  it("sends a clean write exactly once", async () => {
    const seam = countingFetch({ body: { id: 1 } });
    const sent = await clientFor({ home: homeWith({ rows: PERSON }) }).rest.issues.createComment({
      body: "I think this works",
      issue_number: 1,
      owner: "acme",
      repo: "widgets",
      request: seam.request,
    });
    expect(sent.data).toEqual({ id: 1 });
    expect(seam.calls()).toBe(1);
  });

  it("refuses every write when the private-terms file is absent", async () => {
    const seam = countingFetch({ body: { id: 1 } });
    const sent = clientFor({ home: homeWith({ rows: undefined }) }).rest.issues.createComment({
      body: "clean",
      issue_number: 1,
      owner: "acme",
      repo: "widgets",
      request: seam.request,
    });
    await expect(sent).rejects.toThrow("does not exist, so no outbound write is checked for them");
    expect(seam.calls()).toBe(0);
  });

  it("refuses a client's later write once its private-terms file is gone, never reusing an earlier load", async () => {
    const home = homeWith({ rows: PERSON });
    const client = clientFor({ home });
    const first = countingFetch({ body: { id: 1 } });
    const comment = { body: "clean", issue_number: 1, owner: "acme", repo: "widgets" };
    await client.rest.issues.createComment({ ...comment, request: first.request });
    rmSync(join(home, "hygiene", "private-terms.tsv"));
    const second = countingFetch({ body: { id: 2 } });
    const sent = client.rest.issues.createComment({ ...comment, request: second.request });
    await expect(sent).rejects.toThrow("does not exist, so no outbound write is checked for them");
    expect([first.calls(), second.calls()]).toEqual([1, 0]);
  });

  it("sends a REST read and a GraphQL query with no private-terms file at all", async () => {
    const client = clientFor({ home: homeWith({ rows: undefined }) });
    const read = countingFetch({ body: { number: 1 } });
    const query = countingFetch({ body: { data: { viewer: { login: "acme-bot" } } } });
    await client.rest.issues.get({ issue_number: 1, owner: "acme", repo: "widgets", request: read.request });
    await client.graphql("query { viewer { login } }", { request: query.request });
    expect([read.calls(), query.calls()]).toEqual([1, 1]);
  });
});
