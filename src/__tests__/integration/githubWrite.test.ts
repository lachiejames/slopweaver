/**
 * INTEGRATION test: the GitHub pull-request WRITE seam against the REAL GitHub API, recorded and replayed
 * through a Polly cassette (`../setup-polly.ts` + `../cassetteRedactConfig.ts`).
 *
 * **Recording this RAISES A REAL PULL REQUEST.** It records against THIS repository — the locked
 * no-throwaway rule — from a branch that exists only for the purpose, and the record-only `afterAll` closes
 * the pull request and deletes the branch. A pull request cannot be deleted, only closed, so one closed
 * entry per re-record stays in the repository's history for good. The correlation id in the title is what
 * makes those entries identifiable afterwards.
 *
 * ## What this proves, and precisely what it cannot
 *
 * The cassette matches on method + URL path with `body: false`, and the persisted REQUEST body is blanked.
 * Every response STRING whose key is not on the GitHub allowlist becomes `[REDACTED]`. So:
 *
 * **Proved here.** The endpoints exist and answer; the real API accepted a real create; the identity it
 * returned — the numeric `number` and the `node_id` — came back and is asserted; and the update genuinely
 * MUTATED the pull request, because `updated_at` strictly advances and is an allowlisted keep-key.
 *
 * **NOT proved here.** That the bytes on the wire are the bytes the renderer produced: request bodies are
 * neither matched nor persisted, so a replay cannot see them. That property is measured instead in
 * `githubWriteTransport.test.ts`, against a local server over the real global `fetch`. Nor can the ownership
 * or digest guards be exercised — `body` is not allowlisted, so a replayed read-back carries `[REDACTED]`
 * and the digest could never match. Those are unit-tested with an injected read in
 * `unit/outbound/github/prLedger.test.ts`.
 *
 * **No assertion below may depend on a string WE authored** (a title, a body) or on any string the redactor
 * blanks. Numbers and booleans survive verbatim; allowlisted structural strings (`state`, `updated_at`) are
 * GitHub's own and are the point of the allowlist.
 *
 * Run:
 *   yarn test:integration                                                    # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_GITHUB_TOKEN=… \
 *     SLOPWEAVER_RECORD_GITHUB_HEAD=pr7-integration-fixture \
 *     yarn test:integration                                                  # (re)record — OPENS A REAL PR
 *
 * The head branch must already exist on the remote, carry at least one commit the base does not, and have
 * no open pull request against the base.
 */

import { Octokit } from "@octokit/rest";
import { afterAll, describe, expect, it } from "vitest";
import { type GithubWriteApi, makeGithubWriteApi } from "../../corpus/github/write.js";
import { unwrap } from "../../lib/result.js";
import { EXAMPLE_PR_FORM } from "../../outbound/github/formExample.js";
import { renderPrBody } from "../../outbound/github/render.js";
import type { PrForm } from "../../outbound/github/types.js";
import { NO_TERMS_GITHUB_PRIVACY } from "../githubWritePrivacyFixture.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/**
 * The target, kept as a LITERAL on replay rather than a synthetic slug: Polly matches on the URL pathname,
 * and the pathname contains the owner and repo — so a synthetic value would simply not match the recording.
 * This repository is public, so its name in a cassette discloses nothing.
 */
const OWNER = "slopweaver";
const REPO = "slopweaver";
const BASE = "main";

/** A correlation id, so a run's artefacts are identifiable in the repository afterwards. */
const CORRELATION = "pr7-rerun-write-seam";

/** The numbers the committed cassette carries. Asserted exactly, because a replay is deterministic. */
const RECORDED_NUMBER = 155;
const RECORDED_NODE_ID = "id_5";

function token(): string {
  if (!RECORD) {
    return "dummy-replay-token-not-real";
  }
  const value = process.env["SLOPWEAVER_RECORD_GITHUB_TOKEN"];
  if (value === undefined || value.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_GITHUB_TOKEN to record the GitHub write cassette");
  }
  return value;
}

function head(): string {
  if (!RECORD) {
    return "pr7-integration-fixture";
  }
  const value = process.env["SLOPWEAVER_RECORD_GITHUB_HEAD"];
  if (value === undefined || value.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_GITHUB_HEAD to record the GitHub write cassette");
  }
  return value;
}

/**
 * The api, built INSIDE each test rather than once at module scope.
 *
 * That is load-bearing rather than tidy. The cassette harness patches `globalThis.fetch` in `beforeEach` —
 * AFTER module evaluation — so a client constructed at module scope holds the pristine fetch, sails straight
 * past Polly, hits the real API for real and records nothing. The test then passes while proving nothing,
 * which is the single most dangerous failure mode this lane has.
 *
 * @returns a write api bound to the recording or replay token
 */
function api(): GithubWriteApi {
  return makeGithubWriteApi({ privacy: NO_TERMS_GITHUB_PRIVACY, token: token() });
}

/**
 * The form the recorded pull request is rendered from: the canonical example's risk, proofs and checks under a
 * synthetic explainer and title, so it is visibly a test.
 */
function formFor({ label }: { label: string }): PrForm {
  return {
    ...EXAMPLE_PR_FORM,
    draft: true,
    explainer: [
      { kind: "text", text: "The GitHub write seam has no recorded proof that a real pull request can be " },
      { kind: "text", text: `raised (${CORRELATION}). This raises one through the real transport, ${label}.` },
    ],
    problemSeen: { kind: "not-seen", why: "a recorded run raises the pull request it proves" },
    target: { base: BASE, head: head(), owner: OWNER, repo: REPO },
    title: `[integration] ${CORRELATION} — ${label}`,
  };
}

/** What the create returned, so the later cases can assert against it. Set by the create case. */
let created: { number: number; nodeId: string; updatedAtIso: string } | undefined;

/**
 * The created pull request, or a NAMED failure.
 *
 * These cases share ONE recorded sequence, so a later one cannot run alone. A bare `created!` would fail
 * with an opaque `TypeError` under a `-t` filter; this says what is actually wrong.
 */
function createdPr(): { number: number; nodeId: string; updatedAtIso: string } {
  if (created === undefined) {
    throw new Error(
      "the create case must run first: these cases replay ONE recorded sequence (create → read back → " +
        "update), so running a later one on its own is not meaningful. Run the whole file.",
    );
  }
  return created;
}

afterAll(async () => {
  // Record-mode ONLY, and deliberately outside Polly (its hooks stop after each test) so cleanup is never
  // recorded and never replayed. Teardown uses a raw client: closing is not a product verb and must not
  // become one just because a test needed it.
  if (!RECORD || created === undefined) {
    return;
  }
  const raw = new Octokit({ auth: token() });
  await raw.rest.pulls.update({ owner: OWNER, pull_number: created.number, repo: REPO, state: "closed" });
  await raw.rest.git.deleteRef({ owner: OWNER, ref: `heads/${head()}`, repo: REPO }).catch(() => undefined);
});

describe("github pull-request write (integration — real GitHub via Polly cassette)", () => {
  it("probes the repository and reports a push capability, which is what the write gate branches on", async () => {
    // A boolean survives redaction verbatim, so this is a real assertion rather than a shape check.
    const result = await api().canPush({ owner: OWNER, repo: REPO });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(true);
  });

  it("RAISES a real draft pull request and its identity comes back", async () => {
    const form = formFor({ label: "create" });
    const result = await api().createPr({
      base: BASE,
      body: unwrap(renderPrBody({ form })),
      draft: true,
      head: head(),
      owner: OWNER,
      repo: REPO,
      title: form.title,
    });
    expect(result.isOk()).toBe(true);
    const pr = result._unsafeUnwrap();
    created = { nodeId: pr.nodeId, number: pr.number, updatedAtIso: pr.updatedAtIso };

    // The identity GitHub assigned. A number survives redaction verbatim; the node id is an `idKey`, so the
    // cassette carries a synthetic value — asserted anyway, because it is stable across a replay and its
    // presence is what proves an identity came back at all.
    expect(pr.number).toBe(RECORDED_NUMBER);
    expect(pr.nodeId).toBe(RECORDED_NODE_ID);
    // A structural fact on the allowlist. GitHub owns `state`; we never send it on a create, so a replayed
    // value is evidence rather than an echo.
    expect(pr.state).toBe("open");
    // `draft` is deliberately NOT asserted here, and that is the point of this comment. WE send it, the
    // recording echoes it, and matching ignores the request body — so a transport rewritten to send
    // `draft: false` would replay this same response and pass. An adversarial review pass produced exactly
    // that counterexample. The real property is asserted against the wire in `./githubWriteTransport.test.ts`.
  });

  it("reads the same pull request back, which is what confirms a create rather than the response alone", async () => {
    const expected = createdPr();
    const result = await api().getPr({ number: expected.number, owner: OWNER, repo: REPO });
    expect(result.isOk()).toBe(true);
    const pr = result._unsafeUnwrap();
    // The read-back agrees with the create on identity. This is the assertion that distinguishes "the API
    // answered" from "the pull request exists".
    expect(pr.number).toBe(expected.number);
    expect(pr.nodeId).toBe(expected.nodeId);
    expect(pr.state).toBe("open");
  });

  it("UPDATES it, and proves the mutation landed by updated_at strictly advancing", async () => {
    const expected = createdPr();
    const form = formFor({ label: "update" });
    const result = await api().updatePr({
      body: unwrap(renderPrBody({ form })),
      number: expected.number,
      owner: OWNER,
      repo: REPO,
      title: form.title,
    });
    expect(result.isOk()).toBe(true);
    const pr = result._unsafeUnwrap();
    expect(pr.number).toBe(expected.number);
    // The whole point. `title` and `body` are redacted, so neither can prove the PATCH did anything;
    // `updated_at` is allowlisted and GitHub's own, so a strict advance is real evidence of a mutation.
    expect(Date.parse(pr.updatedAtIso)).toBeGreaterThan(Date.parse(expected.updatedAtIso));
  });
});
