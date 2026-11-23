/**
 * The bump description composer, judged by BOTH gates standing between it and a sent description.
 *
 * The assertion that matters is the round trip: stamp and render the composed draft and feed it to the REAL
 * `gatePrBody` — the same function `dev-gate` runs — rather than to a restatement of its rules. A composer whose
 * output that function rejects would have `github bump-drive` rewrite the same description every four hours
 * forever, which is the one failure this step must not have.
 *
 * The second gate was found by the first live pass rather than by this file, which is why it is here now:
 * `github pr update` runs the above-the-fold voice pass before it sends, and it refused both rewrites on a
 * colon introducing a list. The last describe feeds the composed cells to the real `aboveFoldFindings`, and
 * its middle case reddens on the exact sentence that was refused, so the clean verdict beside it is evidence
 * rather than silence.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { prAboveFoldCells, prBelowFoldCells } from "../../../../outbound/github/aboveFold.js";
import { BUMP_WORST_CASE, prFormOfBump } from "../../../../outbound/github/bumpBodyForm.js";
import { renderPrBody } from "../../../../outbound/github/render.js";
import { stampForWrite } from "../../../../outbound/github/stamp.js";
import type { PrFormDraft } from "../../../../outbound/github/types.js";
import { prFormWriteSchema } from "../../../../outbound/github/writeSchema.js";
import { aboveFoldFindings, belowFoldFindings } from "../../../../outbound/voice/aboveFold.js";
import { gatePrBody } from "../../../../prformat/prBodyGate.js";
import { landingRowFake } from "../../../landingRowFake.js";

const OBSERVED = "2026-09-20T09:00:00.000Z";

/** One renovate bump as `github landing` reads it. */
const bump = landingRowFake({
  authorLogin: "acme-renovate",
  baseRefName: "main",
  headOid: "5ee3ee0012345678901234567890123456789012",
  headRefName: "renovate/zod-4.x",
  number: 893,
  repoSlug: "octo-self/slopweaver",
  title: "Update dependency zod to v4.4.3",
  url: "https://github.com/octo-self/slopweaver/pull/893",
});

/**
 * The description the door would write for a draft on the day it was observed.
 *
 * @param draft the composed draft
 * @returns the rendered description
 */
function rendered({ draft }: { draft: PrFormDraft }): string {
  return unwrap(renderPrBody({ form: unwrap(stampForWrite({ draft, today: OBSERVED.slice(0, 10) })) }));
}

describe("prFormOfBump", () => {
  it("passes the write schema the door parses it with", () => {
    const draft = prFormOfBump({ draft: true, observedIso: OBSERVED, row: bump });

    expect(prFormWriteSchema.safeParse(draft).success).toBe(true);
  });

  it("renders a description the real pr-format gate accepts as C3 on an owned pull request", () => {
    const body = rendered({ draft: prFormOfBump({ draft: true, observedIso: OBSERVED, row: bump }) });

    expect(gatePrBody({ body, owned: true })).toStrictEqual({ errors: [], shape: "c3" });
  });

  it("marks the problem seen by an agent on the day the pass observed it, and names who opened the bump", () => {
    const draft = prFormOfBump({ draft: true, observedIso: OBSERVED, row: bump });

    expect(draft.problemSeen).toStrictEqual({
      by: "agent",
      kind: "seen",
      on: "2026-09-20",
      what: "the resolved version was behind the one Renovate found",
    });
    expect(rendered({ draft })).toContain("acme-renovate");
  });

  it("ranks one risk of something working breaking, checked by the pull request's own checks", () => {
    const draft = prFormOfBump({ draft: true, observedIso: OBSERVED, row: bump });

    expect(draft.risk.items).toStrictEqual([
      {
        check: { check: "This repository's own checks ran on 5ee3ee0", kind: "checked" },
        worst: BUMP_WORST_CASE,
        worstKind: "something-working-breaks",
      },
    ]);
  });

  it("publishes no grade, anchor or origin, and links the checks rather than quoting them", () => {
    const body = rendered({ draft: prFormOfBump({ draft: true, observedIso: OBSERVED, row: bump }) });

    expect(body).not.toContain("proof-commit:");
    expect(body).not.toContain("proof-gold");
    expect(body).toContain("https://github.com/octo-self/slopweaver/pull/893/checks");
  });

  it("says nothing is on screen, so the proof reads tests only", () => {
    const draft = prFormOfBump({ draft: true, observedIso: OBSERVED, row: bump });

    expect(draft.visualProof).toBe("nothing-on-screen");
    expect(rendered({ draft })).toContain("tests%20only");
  });

  it("gives both proof slots a one-line reason, citing Renovate's pull request and linking the checks", () => {
    const draft = prFormOfBump({ draft: true, observedIso: OBSERVED, row: bump });

    expect([draft.problemProof, draft.solutionProof]).toStrictEqual([
      {
        kind: "reason",
        reason: [
          { kind: "text", text: "A version behind shows nothing on screen. " },
          { kind: "link", text: "Renovate's pull request", url: "https://github.com/octo-self/slopweaver/pull/893" },
          { kind: "text", text: " names the release." },
        ],
      },
      {
        kind: "reason",
        reason: [
          { kind: "text", text: "Nothing on screen changes. " },
          {
            kind: "link",
            text: "this repository's own checks on 5ee3ee0",
            url: "https://github.com/octo-self/slopweaver/pull/893/checks",
          },
          { kind: "text", text: " judge it." },
        ],
      },
    ]);
  });

  it("checks the diff by Renovate's own files view, names the unread release notes, and carries no fold", () => {
    const draft = prFormOfBump({ draft: true, observedIso: OBSERVED, row: bump });

    expect([draft.checks, draft.notChecked, draft.rerun]).toStrictEqual([
      [
        [
          { kind: "text", text: "Only this dependency's manifest and lockfile entries move, per " },
          { kind: "link", text: "Renovate's diff", url: "https://github.com/octo-self/slopweaver/pull/893/files" },
          { kind: "text", text: "." },
        ],
      ],
      [
        {
          check: [{ kind: "text", text: "The release notes" }],
          why: [{ kind: "text", text: "No changelog was read, so only the linked checks judge the release." }],
        },
      ],
      [],
    ]);
  });

  it("keeps renovate's own title and routes the form at the branch pair the row read", () => {
    const draft = prFormOfBump({ draft: false, observedIso: OBSERVED, row: bump });

    expect(draft.title).toBe("Update dependency zod to v4.4.3");
    expect(draft.target).toStrictEqual({
      base: "main",
      head: "renovate/zod-4.x",
      owner: "octo-self",
      repo: "slopweaver",
    });
    expect(draft.draft).toBe(false);
  });
});

describe("the second gate: the voice pass `github pr update` runs before it sends", () => {
  it("clears every above-the-fold and folded cell, which the first live pass did NOT", () => {
    const form = prFormOfBump({ draft: true, observedIso: OBSERVED, row: bump });

    const above = aboveFoldFindings({ cells: prAboveFoldCells({ form }), rules: [] });
    const below = belowFoldFindings({ cells: prBelowFoldCells({ form }), rules: [] });

    expect(above.map((finding) => `${finding.path}: ${finding.code}`)).toStrictEqual([]);
    expect(below.map((finding) => `${finding.path}: ${finding.code}`)).toStrictEqual([]);
  });

  it("is checked by a LIVE rule, since the same call reddens on the sentence the live pass was refused on", () => {
    const refused = aboveFoldFindings({
      cells: [
        {
          path: "explainer",
          text: "Renovate's own change, unedited: the manifest and lockfile entries move, and nothing else does.",
        },
      ],
      rules: [],
    });

    expect(refused.map((finding) => finding.code)).toStrictEqual(["colon-list"]);
  });

  it("is unmoved by a comma in renovate's title, because a code run reaches no prose rule", () => {
    const listy = landingRowFake({
      authorLogin: "acme-renovate",
      headOid: "5ee3ee0012345678901234567890123456789012",
      number: 893,
      repoSlug: "octo-self/slopweaver",
      title: "chore(deps): update dependency zod, vitest and drizzle-orm",
    });

    const form = prFormOfBump({ draft: true, observedIso: OBSERVED, row: listy });

    expect(aboveFoldFindings({ cells: prAboveFoldCells({ form }), rules: [] })).toStrictEqual([]);
    expect(rendered({ draft: form })).toContain("chore(deps): update dependency zod, vitest and drizzle-orm");
  });
});
