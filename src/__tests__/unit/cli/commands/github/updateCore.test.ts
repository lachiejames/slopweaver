/**
 * The `github pr update` decisions. Every one of these is a policy that was previously absent or wrong, so
 * each test names the failure it prevents rather than merely exercising the branch.
 */
import { describe, expect, it } from "vitest";

import {
  ALLOW_FOREIGN_PR,
  ALLOW_PR_REPLACE,
  authorisationFor,
  cachedCandidateUsable,
  formTargetMismatch,
  type LivePr,
  replaceDecisionFor,
  selectPrCandidate,
  updateFreshnessFor,
  updateHeadRefusal,
  writeWouldChangeNothing,
} from "../../../../../cli/commands/github/updateCore.js";
import { wholeFormInputRefusal } from "../../../../../cli/commands/github/wholeFormRefusal.js";
import { unwrap } from "../../../../../lib/result.js";
import { parseAuthoringFile, renderAuthoringFile } from "../../../../../outbound/github/authoringFile.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import { applyEdit } from "../../../../../outbound/github/merge.js";
import { bodyHash } from "../../../../../outbound/github/prLedger.js";
import { recoverPrForm } from "../../../../../outbound/github/recovery.js";
import { renderPrBody } from "../../../../../outbound/github/render.js";
import { stampForWrite } from "../../../../../outbound/github/stamp.js";
import type { PrForm, PrFormDraft, PrTarget } from "../../../../../outbound/github/types.js";

/** A live pull request; each test overrides only what it is about. */
function pr({ overrides }: { overrides: Partial<LivePr> }): LivePr {
  const base: LivePr = {
    authorId: 41,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "a description",
    draft: true,
    head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "a".repeat(40) },
    number: 213,
    state: "open",
    title: "a title",
  };
  return { ...base, ...overrides };
}

const BRANCH = { base: "main", head: "feature", kind: "branch", owner: "o", repo: "r" } as const;

/** The example draft on this file's pull request. */
const DRAFT: PrFormDraft = {
  ...EXAMPLE_PR_FORM,
  target: { base: "main", head: "feature", owner: "o", repo: "r" },
  title: "a title",
};

/** The day every fixture here was written — after the example's problem was seen. */
const WRITTEN_ON = "2026-09-30";

/** `draft` checked for a write on `today` and rendered, the bytes a live description carries. */
function renderedBody({ draft, today = WRITTEN_ON }: { draft: PrFormDraft; today?: string }): string {
  return unwrap(renderPrBody({ form: unwrap(stampForWrite({ draft, today })) }));
}

/** Recover a live body into its stamped form and trailing bytes, throwing when the recovery refuses. */
function recovered({ body, target, title }: { body: string; target: PrTarget; title: string }): {
  form: PrForm;
  trailing: string;
} {
  const outcome = recoverPrForm({ live: { draft: true, target, title }, liveBody: body, number: 7, record: undefined });
  if (outcome.kind === "refused") throw new Error(outcome.reason);
  return { form: outcome.form, trailing: outcome.trailing };
}

describe("authorisationFor — authorship is authorisation, by immutable id", () => {
  it("allows the authed user's own pull request", () => {
    expect(
      authorisationFor({ allowForeign: false, authedUserId: 41, prAuthorId: 41, purpose: "description-update" }),
    ).toStrictEqual({ kind: "self" });
  });

  it("refuses a pull request authored by a different account, naming the escape", () => {
    const decided = authorisationFor({
      allowForeign: false,
      authedUserId: 41,
      prAuthorId: 99,
      purpose: "description-update",
    });
    expect(decided.kind).toBe("refused");
    expect(decided.kind === "refused" ? decided.reason : "").toContain(ALLOW_FOREIGN_PR);
  });

  it("lets the override through, and says loudly that it was used", () => {
    const decided = authorisationFor({
      allowForeign: true,
      authedUserId: 41,
      prAuthorId: 99,
      purpose: "description-update",
    });
    expect(decided.kind).toBe("overridden");
    expect(decided.kind === "overridden" ? decided.notice : "").toContain("OVERRIDDEN");
  });

  it("does NOT use the override when the ids already match, so the notice cannot appear spuriously", () => {
    expect(
      authorisationFor({ allowForeign: true, authedUserId: 41, prAuthorId: 41, purpose: "description-update" }),
    ).toStrictEqual({ kind: "self" });
  });

  // An installation token can fail `users.getAuthenticated` outright, and an App-created pull request can
  // expose a bot author. Neither is branched on by guessing.
  it("fails closed when the authed identity could not be read, even with the override set", () => {
    const decided = authorisationFor({
      allowForeign: true,
      authedUserId: undefined,
      prAuthorId: 41,
      purpose: "description-update",
    });
    expect(decided.kind).toBe("refused");
  });

  it("fails closed when the pull request carries no author", () => {
    const decided = authorisationFor({
      allowForeign: false,
      authedUserId: 41,
      prAuthorId: undefined,
      purpose: "description-update",
    });
    expect(decided.kind).toBe("refused");
  });
});

describe("replaceDecisionFor — the mode fails loudly first, then takes a key", () => {
  it("refuses a replacement by default, naming the escape", () => {
    const decided = replaceDecisionFor({ allowReplace: false, unchanged: false });
    expect(decided.kind).toBe("refused");
    expect(decided.kind === "refused" ? decided.reason : "").toContain(ALLOW_PR_REPLACE);
  });

  it("allows it with the key, and says loudly that it was used", () => {
    const decided = replaceDecisionFor({ allowReplace: true, unchanged: false });
    expect(decided.kind).toBe("allowed");
    expect(decided.kind === "allowed" ? decided.notice : "").toContain("OVERRIDDEN");
  });

  // A refusal here would make an idempotent re-run demand the variable, which teaches the caller to export it
  // permanently — the opposite of a single-run escape.
  it("does not demand the key when the replacement changes nothing", () => {
    const decided = replaceDecisionFor({ allowReplace: false, unchanged: true });
    expect(decided.kind).toBe("allowed");
    expect(decided.kind === "allowed" ? decided.notice : "").toContain("byte-identical");
  });
});

describe("selectPrCandidate — a branch address must be unique or refuse", () => {
  it("resolves a single match", () => {
    const chosen = selectPrCandidate({ address: BRANCH, candidates: [pr({ overrides: {} })] });
    expect(chosen.kind).toBe("one");
    expect(chosen.kind === "one" ? chosen.candidate.number : 0).toBe(213);
  });

  it("refuses when nothing matches, and points at --number", () => {
    const chosen = selectPrCandidate({ address: BRANCH, candidates: [] });
    expect(chosen.kind).toBe("none");
    expect(chosen.kind === "none" ? chosen.reason : "").toContain("--number");
  });

  // Two pull requests can share a base/head pair over time. Picking either silently is the worst outcome.
  it("refuses two matches, listing both numbers, and never picks one", () => {
    const chosen = selectPrCandidate({
      address: BRANCH,
      candidates: [pr({ overrides: { number: 10 } }), pr({ overrides: { number: 20 } })],
    });
    expect(chosen.kind).toBe("many");
    expect(chosen.kind === "many" ? chosen.reason : "").toContain("#10, #20");
  });

  it("compares the base repository case-insensitively, as GitHub does", () => {
    const chosen = selectPrCandidate({ address: BRANCH, candidates: [pr({ overrides: { baseRepoFullName: "O/R" } })] });
    expect(chosen.kind).toBe("one");
  });

  it("compares the base ref EXACTLY, because git refs are case-sensitive", () => {
    const chosen = selectPrCandidate({ address: BRANCH, candidates: [pr({ overrides: { baseRef: "Main" } })] });
    expect(chosen.kind).toBe("none");
  });

  // `head.repo` is null once a fork is deleted. Coalescing that to the base repository would let a
  // deleted-fork pull request answer a plain same-repository address.
  it("does not match a plain head against a pull request whose head repository is gone", () => {
    const orphaned = pr({
      overrides: { head: { label: "someone:feature", ref: "feature", repoFullName: undefined, sha: "b".repeat(40) } },
    });
    expect(selectPrCandidate({ address: BRANCH, candidates: [orphaned] }).kind).toBe("none");
  });

  it("does not match a plain head against a fork's branch of the same name", () => {
    const fork = pr({
      overrides: { head: { label: "someone:feature", ref: "feature", repoFullName: "someone/r", sha: "c".repeat(40) } },
    });
    expect(selectPrCandidate({ address: BRANCH, candidates: [fork] }).kind).toBe("none");
  });

  it("matches a qualified owner:ref head, comparing the owner case-insensitively and the ref exactly", () => {
    const fork = pr({
      overrides: { head: { label: "Someone:feature", ref: "feature", repoFullName: "Someone/r", sha: "d".repeat(40) } },
    });
    const chosen = selectPrCandidate({ address: { ...BRANCH, head: "someone:feature" }, candidates: [fork] });
    expect(chosen.kind).toBe("one");
  });

  it("refuses a qualified head whose ref differs in case", () => {
    const fork = pr({
      overrides: { head: { label: "someone:Feature", ref: "Feature", repoFullName: "someone/r", sha: "e".repeat(40) } },
    });
    expect(selectPrCandidate({ address: { ...BRANCH, head: "someone:feature" }, candidates: [fork] }).kind).toBe(
      "none",
    );
  });
});

describe("cachedCandidateUsable — a cached record must not resolve to a closed pull request", () => {
  // The hole this closes: a record naming a MERGED pull request on main...feature was accepted on topology
  // alone, while a later hand-opened pull request reusing the branch pair is the one the caller means. Same
  // author, so authorisation passes, and the write lands on the wrong one.
  it("accepts an open candidate whose topology matches", () => {
    expect(cachedCandidateUsable({ address: BRANCH, candidate: pr({ overrides: {} }) })).toBe(true);
  });

  it("rejects a merged candidate", () => {
    expect(cachedCandidateUsable({ address: BRANCH, candidate: pr({ overrides: { state: "closed" } }) })).toBe(false);
  });

  it("rejects an open candidate whose topology no longer matches the address", () => {
    expect(cachedCandidateUsable({ address: BRANCH, candidate: pr({ overrides: { baseRef: "release" } }) })).toBe(
      false,
    );
  });
});

describe("updateHeadRefusal — the first read is pinned to the head the caller derived at", () => {
  const derived = "a".repeat(40);

  it("refuses when the live head is another one", () => {
    expect(updateHeadRefusal({ expectHead: derived, headSha: "b".repeat(40), number: 7 })).toBe(
      `#7 is at ${"b".repeat(40)}, not the expected head ${derived}, so nothing was sent. Re-derive the edit from the current head`,
    );
  });

  it("lets the write through on the expected head, or when none was named", () => {
    expect(updateHeadRefusal({ expectHead: derived, headSha: derived, number: 7 })).toBeUndefined();
    expect(updateHeadRefusal({ expectHead: undefined, headSha: "b".repeat(40), number: 7 })).toBeUndefined();
  });
});

describe("updateFreshnessFor — the second read is what keeps the race one round trip", () => {
  it("passes when nothing moved", () => {
    expect(updateFreshnessFor({ current: pr({ overrides: {} }), previewed: pr({ overrides: {} }) })).toStrictEqual({
      fresh: true,
    });
  });

  const moved: ReadonlyArray<{ what: string; overrides: Partial<LivePr> }> = [
    { overrides: { number: 214 }, what: "the pull-request number" },
    { overrides: { authorId: 99 }, what: "the author" },
    { overrides: { body: "a human rewrote it in the window" }, what: "the description" },
    { overrides: { title: "a human retitled it" }, what: "the title" },
    { overrides: { state: "closed" }, what: "the open/closed state" },
    { overrides: { draft: false }, what: "the draft state" },
  ];

  it.each(moved)("refuses when $what changed, and says which", ({ overrides, what }) => {
    const checked = updateFreshnessFor({ current: pr({ overrides }), previewed: pr({ overrides: {} }) });
    expect(checked.fresh).toBe(false);
    expect(checked.fresh === false ? checked.reason : "").toContain(what);
  });

  // The head SHA is the one field a body-only comparison misses, and it is the one a gold proof anchor is
  // checked against. A force-push inside the window would otherwise leave a stale anchor: valid locally,
  // red in CI, reported here as success.
  it("refuses when the head commit moved, even though the description did not", () => {
    const forcePushed = pr({
      overrides: { head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "f".repeat(40) } },
    });
    const checked = updateFreshnessFor({ current: forcePushed, previewed: pr({ overrides: {} }) });
    expect(checked.fresh).toBe(false);
    expect(checked.fresh === false ? checked.reason : "").toContain("the head commit");
  });

  it("tolerates GitHub reporting the state in a different case", () => {
    const checked = updateFreshnessFor({
      current: pr({ overrides: { state: "OPEN" } }),
      previewed: pr({ overrides: {} }),
    });
    expect(checked.fresh).toBe(true);
  });
});

describe("formTargetMismatch — a complete form must describe the pull request it is sent to", () => {
  const form = DRAFT;

  it("accepts a form whose target matches", () => {
    expect(formTargetMismatch({ form, live: pr({ overrides: {} }) })).toBeUndefined();
  });

  it("accepts a form whose head is written as the qualified label", () => {
    const qualified: PrFormDraft = { ...form, target: { ...form.target, head: "o:feature" } };
    expect(formTargetMismatch({ form: qualified, live: pr({ overrides: {} }) })).toBeUndefined();
  });

  it("names the repository when it disagrees", () => {
    const elsewhere: PrFormDraft = { ...form, target: { ...form.target, repo: "other" } };
    expect(formTargetMismatch({ form: elsewhere, live: pr({ overrides: {} }) })).toContain("o/other");
  });

  it("names the base branch when it disagrees", () => {
    const rebased: PrFormDraft = { ...form, target: { ...form.target, base: "release" } };
    expect(formTargetMismatch({ form: rebased, live: pr({ overrides: {} }) })).toContain("release");
  });

  it("names the head branch when it disagrees", () => {
    const other: PrFormDraft = { ...form, target: { ...form.target, head: "something-else" } };
    expect(formTargetMismatch({ form: other, live: pr({ overrides: {} }) })).toContain("something-else");
  });

  it("compares the repository case-insensitively", () => {
    const shouty: PrFormDraft = { ...form, target: { ...form.target, owner: "O", repo: "R" } };
    expect(formTargetMismatch({ form: shouty, live: pr({ overrides: {} }) })).toBeUndefined();
  });
});

describe("selectPrCandidate — a closed pull request is never the one you meant to edit", () => {
  // The incoherence this closes: cachedCandidateUsable rejected a hint for naming a closed pull request, and
  // then this fallback — which lists state:"all" — handed back the very same one. A branch pair reused after
  // its pull request merged therefore resolved to the MERGED pull request, and the update rewrote a
  // description on work already landed.
  it("does not resolve to a merged pull request that still matches the branch pair", () => {
    const merged = pr({ overrides: { number: 10, state: "closed" } });
    expect(selectPrCandidate({ address: BRANCH, candidates: [merged] }).kind).toBe("none");
  });

  it("picks the open one when a merged pull request shares the branch pair", () => {
    const merged = pr({ overrides: { number: 10, state: "closed" } });
    const live = pr({ overrides: { number: 20, state: "open" } });
    const chosen = selectPrCandidate({ address: BRANCH, candidates: [merged, live] });
    expect(chosen.kind).toBe("one");
    expect(chosen.kind === "one" ? chosen.candidate.number : 0).toBe(20);
  });

  it("does not call two candidates ambiguous when only one of them is open", () => {
    const chosen = selectPrCandidate({
      address: BRANCH,
      candidates: [pr({ overrides: { number: 10, state: "closed" } }), pr({ overrides: { number: 20 } })],
    });
    expect(chosen.kind).toBe("one");
  });

  it("lists ambiguous numbers NUMERICALLY, so 9 comes before 10", () => {
    const chosen = selectPrCandidate({
      address: BRANCH,
      candidates: [pr({ overrides: { number: 10 } }), pr({ overrides: { number: 9 } })],
    });
    expect(chosen.kind === "many" ? chosen.reason : "").toContain("#9, #10");
  });
});

describe("writeWouldChangeNothing — a no-op must never be reported as an update", () => {
  const live = { body: "the exact live body", title: "the live title" };

  it("is true when both the body and the title already match", () => {
    expect(writeWouldChangeNothing({ live, renderedBody: live.body, renderedTitle: live.title })).toBe(true);
  });

  it("is false when the body differs", () => {
    expect(writeWouldChangeNothing({ live, renderedBody: "something else", renderedTitle: live.title })).toBe(false);
  });

  // A PATCH sends the title too, so a title-only change is a real change and must not short-circuit.
  it("is false when only the TITLE differs", () => {
    expect(writeWouldChangeNothing({ live, renderedBody: live.body, renderedTitle: "a retitle" })).toBe(false);
  });

  it("is false when the live body is absent, because writing one is a change", () => {
    expect(
      writeWouldChangeNothing({
        live: { body: undefined, title: live.title },
        renderedBody: "",
        renderedTitle: live.title,
      }),
    ).toBe(false);
  });

  it("does not treat a whitespace difference as identical", () => {
    expect(writeWouldChangeNothing({ live, renderedBody: `${live.body} `, renderedTitle: live.title })).toBe(false);
  });
});

/*
 * The write path's half of the appended-block fix, proved with pure functions rather than argued.
 *
 * `performUpdate` sends `renderAndCheck({ form }).body + trailing`, and `writeWouldChangeNothing` compares that
 * against the LIVE body — which carries the block. Forgetting the re-append does not merely lose a footer
 * quietly: it makes every no-op edit look like a change, and the PATCH that follows deletes somebody else's
 * content. Both halves are asserted, so the second is the falsifier for the first.
 */
describe("the sent body re-appends a third party's block, or a no-op edit deletes it", () => {
  const target: PrTarget = { base: "main", head: "pr-trailing", owner: "o", repo: "r" };
  const draft: PrFormDraft = { ...DRAFT, target, title: "fix(github): tolerate an appended block" };
  const appended = "\n<!-- auto-generated by coderabbit.ai -->\n\n## Summary by CodeRabbit\n";
  const liveBody = renderedBody({ draft }) + appended;
  const live = { body: liveBody, title: draft.title };
  const back = recovered({ body: liveBody, target, title: draft.title });
  const merged: PrForm = unwrap(stampForWrite({ draft: applyEdit({ edit: {}, form: back.form }), today: WRITTEN_ON }));

  it("recovers the description and the block as two separate parts", () => {
    expect(back.form.explainer).toStrictEqual(draft.explainer);
    expect(back.trailing).toBe(appended);
  });

  it("reports a no-op edit as unchanged once the block is re-appended", () => {
    const sent = unwrap(renderPrBody({ form: merged })) + back.trailing;
    expect(writeWouldChangeNothing({ live, renderedBody: sent, renderedTitle: draft.title })).toBe(true);
  });

  it("reports a phantom change when the block is dropped, which is the deletion this prevents", () => {
    const withoutBlock = unwrap(renderPrBody({ form: merged }));
    expect(writeWouldChangeNothing({ live, renderedBody: withoutBlock, renderedTitle: draft.title })).toBe(false);
  });
});

/*
 * `--pull` then `--file` with no edits in between must stay a no-op. No byte of a C3 description depends on the
 * day it is written, so the write on a later day renders the bytes already live, which this pins through the same
 * pure steps the verb runs.
 */
describe("a --pull then --file round trip with no edits is a no-op", () => {
  const liveBody = renderedBody({ draft: DRAFT });
  const back = recovered({ body: liveBody, target: DRAFT.target, title: DRAFT.title });
  const pulledFile = renderAuthoringFile({ form: back.form, pulledBodyHash: bodyHash({ body: liveBody }) });
  const pushed = unwrap(parseAuthoringFile({ source: pulledFile }));

  it("passes the whole-form refusal, since the file carries the live digest", () => {
    // The digest really is carried: with none at all the refusal below would pass vacuously.
    expect(pushed.pulledBodyHash).toBe(bodyHash({ body: liveBody }));
    expect(wholeFormInputRefusal({ input: pushed, live: { body: liveBody } })).toBe(undefined);
  });

  it("renders the bytes already live on a later day", () => {
    const sent = renderedBody({ draft: pushed.form, today: "2026-10-02" }) + back.trailing;
    expect(
      writeWouldChangeNothing({
        live: { body: liveBody, title: DRAFT.title },
        renderedBody: sent,
        renderedTitle: DRAFT.title,
      }),
    ).toBe(true);
  });

  it("recovers the same form when GitHub's web editor stored the live body with CRLF", () => {
    const crlfBody = liveBody.replaceAll("\n", "\r\n");
    expect(crlfBody).not.toBe(liveBody);
    expect(recovered({ body: crlfBody, target: DRAFT.target, title: DRAFT.title }).form).toStrictEqual(back.form);
  });

  it("is still a no-op when the live body is the same description stored with CRLF", () => {
    const crlfBody = liveBody.replaceAll("\n", "\r\n");
    const crlfBack = recovered({ body: crlfBody, target: DRAFT.target, title: DRAFT.title });
    const sent = renderedBody({ draft: crlfBack.form, today: "2026-10-02" }) + crlfBack.trailing;
    // The two really differ byte for byte, or the case below would pass with no normalising at all.
    expect(sent).not.toBe(crlfBody);
    expect(
      writeWouldChangeNothing({
        live: { body: crlfBody, title: DRAFT.title },
        renderedBody: sent,
        renderedTitle: DRAFT.title,
      }),
    ).toBe(true);
  });

  it("is a change when a CRLF live body says something the render does not", () => {
    const crlfBody = `${liveBody}\nan extra line\n`.replaceAll("\n", "\r\n");
    const sent = renderedBody({ draft: pushed.form, today: "2026-10-02" }) + back.trailing;
    expect(
      writeWouldChangeNothing({
        live: { body: crlfBody, title: DRAFT.title },
        renderedBody: sent,
        renderedTitle: DRAFT.title,
      }),
    ).toBe(false);
  });

  it("is a change once the file says something new, so the falsifier is a real change", () => {
    const edited: PrFormDraft = { ...pushed.form, title: "a retitle" };
    const sent = renderedBody({ draft: edited, today: "2026-10-02" }) + back.trailing;
    expect(
      writeWouldChangeNothing({
        live: { body: liveBody, title: DRAFT.title },
        renderedBody: sent,
        renderedTitle: edited.title,
      }),
    ).toBe(false);
  });
});

describe("wholeFormInputRefusal — a pulled file must still describe the live description", () => {
  const plainBody = renderedBody({ draft: DRAFT });

  it("lets a form replace a description that has no C3 shape, which is the conversion", () => {
    expect(wholeFormInputRefusal({ input: { form: DRAFT }, live: { body: "a retired table description" } })).toBe(
      undefined,
    );
  });

  it("lets a pulled file through whose digest matches the live description", () => {
    const input = { form: DRAFT, pulledBodyHash: bodyHash({ body: plainBody }) };
    expect(wholeFormInputRefusal({ input, live: { body: plainBody } })).toBe(undefined);
  });

  it("refuses a pulled file whose digest no longer matches the live description", () => {
    const refusal = wholeFormInputRefusal({
      input: { form: DRAFT, pulledBodyHash: "stale" },
      live: { body: plainBody },
    });
    expect(refusal).toContain("the live description has changed since this file was pulled");
  });

  // Nothing rewrites a CRLF body back to LF now that an unchanged re-send sends nothing, so a byte digest would
  // refuse this file over line endings alone.
  it("lets a file pulled at LF through once GitHub's web editor re-saved the same description with CRLF", () => {
    const crlfBody = plainBody.replaceAll("\n", "\r\n");
    expect(crlfBody).not.toBe(plainBody);
    const input = { form: DRAFT, pulledBodyHash: bodyHash({ body: plainBody }) };
    expect(wholeFormInputRefusal({ input, live: { body: crlfBody } })).toBe(undefined);
  });

  it("still refuses a file pulled at LF once the CRLF live description says something new", () => {
    const crlfBody = `${plainBody}\nan extra line\n`.replaceAll("\n", "\r\n");
    const input = { form: DRAFT, pulledBodyHash: bodyHash({ body: plainBody }) };
    expect(wholeFormInputRefusal({ input, live: { body: crlfBody } })).toContain(
      "the live description has changed since this file was pulled",
    );
  });
});
