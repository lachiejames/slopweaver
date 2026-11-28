/**
 * `convertToC3` — a pre-C3 reading-order body into a C3 draft and the report of every gap, over the frozen legacy
 * fixtures. It sends nothing; what it leaves blank, the C3 write door refuses by name when the file is pushed back.
 */
import { describe, expect, it } from "vitest";

import { convertToC3 } from "../../../../../outbound/github/legacy/convertToC3.js";
import type { PrFormDraft } from "../../../../../outbound/github/types.js";
import { prFormWriteSchema } from "../../../../../outbound/github/writeSchema.js";
import { CLICK_THROUGH, FULL_BODY, MINIMAL_BODY, TARGET } from "./fixtures.js";

const SHELL = { draft: false, target: TARGET, title: "fix(render): read bodies in order" };

describe("convertToC3", () => {
  it("carries the routing, joins Problem and Change into the explainer, and maps every risk item", () => {
    const { form } = convertToC3({ body: FULL_BODY, shell: SHELL });
    expect([form.title, form.target, form.draft]).toStrictEqual([SHELL.title, TARGET, false]);
    expect(form.explainer).toStrictEqual([
      { kind: "text", text: "A reviewer meets the table before the risk. Render the body in reading order." },
    ]);
    expect(form.risk.items).toStrictEqual([
      {
        check: { check: "the round-trip test", kind: "checked" },
        worst: "A body parses into the wrong form",
        worstKind: "loses-leaks-or-changes-off-machine",
      },
      {
        check: { kind: "unchecked", why: "no live body read" },
        worst: "An old body is misread",
        worstKind: "only-tests-docs-or-dev-tooling",
      },
    ]);
  });

  it.each([
    [
      "Problem ends on a code run",
      [{ kind: "code", text: "acme" }],
      [{ kind: "text", text: "Render it." }],
      [
        { kind: "code", text: "acme" },
        { kind: "text", text: " Render it." },
      ],
    ],
    [
      "Change opens on a link",
      [{ kind: "text", text: "It broke." }],
      [{ kind: "link", text: "ABC-1", url: "https://example.com/ABC-1" }],
      [
        { kind: "text", text: "It broke. " },
        { kind: "link", text: "ABC-1", url: "https://example.com/ABC-1" },
      ],
    ],
    [
      "neither side is text",
      [{ kind: "strong", text: "Broke" }],
      [{ kind: "em", text: "fixed" }],
      [
        { kind: "strong", text: "Broke" },
        { kind: "text", text: " " },
        { kind: "em", text: "fixed" },
      ],
    ],
  ] as const)("joins Problem and Change with no two text runs side by side when %s", (_, problem, change, joined) => {
    const { form } = convertToC3({ body: { ...FULL_BODY, change, problem }, shell: SHELL });
    expect(form.explainer).toStrictEqual(joined);
  });

  it.each([
    [0, "loses-leaks-or-changes-off-machine"],
    [1, "loses-leaks-or-changes-off-machine"],
    [2, "something-working-breaks"],
    [3, "only-tests-docs-or-dev-tooling"],
    [4, "only-tests-docs-or-dev-tooling"],
  ] as const)("reads a P%i item as the kind whose level its badge showed: %s", (priority, worstKind) => {
    const [item] = FULL_BODY.risk.items;
    const body = { ...FULL_BODY, risk: { ...FULL_BODY.risk, items: [{ ...item!, priority }] } };
    expect(convertToC3({ body, shell: SHELL }).form.risk.items[0]!.worstKind).toBe(worstKind);
  });

  it("splits the claims into checks and Not checked items, and keeps the notes as re-run items", () => {
    const { form } = convertToC3({ body: FULL_BODY, shell: SHELL });
    expect(form.checks).toStrictEqual([[{ kind: "text", text: "The body parses back." }]]);
    expect(form.notChecked).toStrictEqual([
      {
        check: [{ kind: "text", text: "Old bodies convert." }],
        why: [{ kind: "text", text: "no live body was converted" }],
      },
    ]);
    expect(form.rerun).toStrictEqual([
      { content: [{ kind: "text", text: "Golden bytes pin the layout." }], kind: "note" },
    ]);
  });

  it("makes a Before-and-after image a screenshot whose claim is left to write, and a side with none a blank reason", () => {
    const { form } = convertToC3({ body: FULL_BODY, shell: SHELL });
    expect(form.solutionProof).toStrictEqual({
      image: {
        alt: "the badge row",
        kind: "image",
        url: "https://github.com/user-attachments/assets/0b6a1c2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      },
      kind: "screenshot",
      proves: [],
      runBy: "agent",
    });
    expect(form.problemProof).toStrictEqual({ kind: "reason", reason: [] });
    expect(form.visualProof).toBe("screen-change");
  });

  it("keeps a seen day but never invents what was seen or who ran it", () => {
    const { form } = convertToC3({ body: FULL_BODY, shell: SHELL });
    expect(form.problemSeen).toStrictEqual({ by: "unrecorded", kind: "seen", on: "2026-09-20", what: "" });
    expect(convertToC3({ body: MINIMAL_BODY, shell: SHELL }).form.problemSeen).toStrictEqual({
      kind: "not-seen",
      why: "",
    });
  });

  it("reports every field to write and every retired field it dropped", () => {
    const { report } = convertToC3({ body: { ...FULL_BODY, clickThrough: CLICK_THROUGH }, shell: SHELL });
    expect(report).toStrictEqual([
      "write: ## Explainer — the old Problem and Change, joined; trim it to 70 words and say what broke, for whom, and what changes",
      "write: problem-seen.what — what was seen on that day; problem-seen.by stays unrecorded unless the record says who ran it",
      "write: ## Proof of the problem — reason: why there is no screenshot",
      "write: ## Proof of the solution — the line the screenshot proves, and who ran it",
      "check: risk kind — each item's kind was read from its old priority's level; set the kind its worst case is",
      "dropped: the gold anchor — a C3 description does not publish it",
      "dropped: the review grade — a C3 description does not publish it",
      "dropped: the origin line — a C3 description does not publish it",
      'dropped: "Why this approach" — a C3 description does not publish it',
      'dropped: "Where to look" — a C3 description does not publish it',
      'dropped: "Fails on main" (re-add its command under ## Re-run if it still matters) — a C3 description does not publish it',
      "dropped: the click-through (add its screenshot as Proof of the solution if it proves it) — a C3 description does not publish it",
    ]);
  });

  it("leaves a draft the C3 write door refuses until its blanks are written", () => {
    const { form } = convertToC3({ body: MINIMAL_BODY, shell: SHELL });
    const draft: PrFormDraft = form;
    const parsed = prFormWriteSchema.safeParse(draft);
    expect(parsed.success).toBe(false);
    const refusedPaths = parsed.error!.issues.map((issue) => issue.path.join("."));
    expect(refusedPaths).toEqual(
      expect.arrayContaining(["problemSeen.why", "problemProof.reason", "solutionProof.reason"]),
    );
    expect(form.visualProof).toBe("nothing-on-screen");
  });
});
