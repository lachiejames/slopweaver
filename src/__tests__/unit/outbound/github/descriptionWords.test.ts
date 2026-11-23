/**
 * The content rules a layout-2 description is held to: each rule refuses the shape the owner ruled out and leaves the
 * nearest shape that is fine alone, so a rule that widens or narrows shows up here.
 */
import { describe, expect, it } from "vitest";

import { descriptionWordIssues } from "../../../../outbound/github/descriptionWords.js";
import type { Content, PrBody } from "../../../../outbound/github/types.js";
import { FEATURE_BODY, FIX_BODY, TESTS_BODY, TESTS_ONLY_BODY, t } from "./fixtures.js";

/** Every issue on a body and title as `code path`. */
function codes({ body, title }: { body: PrBody; title?: string }): readonly string[] {
  return descriptionWordIssues({ body, title }).map((issue) => `${issue.code} ${issue.path.join(".")}`);
}

/** A body whose solution proof is a reason. */
function withSolutionReason({ reason }: { reason: Content }): PrBody {
  return { ...TESTS_ONLY_BODY, solutionProof: { kind: "reason", reason } };
}

describe("descriptionWordIssues", () => {
  it("passes every fixture with a plain title", () => {
    const bodies = [TESTS_BODY, FIX_BODY, FEATURE_BODY, TESTS_ONLY_BODY];
    expect(bodies.flatMap((body) => codes({ body, title: "fix(widgets): refuse an open store" }))).toStrictEqual([]);
  });

  it.each([
    "The unit test below fails on main.",
    "A regression test pins it.",
    "Reproduced by the new test.",
    "The test fails before this change and passes after it.",
    "`yarn vitest run a.test.ts` shows it.",
  ])("refuses a proof reason that is a sentence about a test: %s", (text) => {
    expect(codes({ body: withSolutionReason({ reason: t({ text }) }) })).toContain(
      "PROOF_IS_TEST_SENTENCE solutionProof.reason",
    );
  });

  it("leaves a reason that mentions a test without saying what it proves", () => {
    expect(codes({ body: withSolutionReason({ reason: t({ text: "A refactor of the test helpers." }) }) })).toEqual([]);
  });

  it("names the capture verb when it refuses a test sentence", () => {
    const [issue] = descriptionWordIssues({
      body: withSolutionReason({ reason: t({ text: "The test fails on main." }) }),
      title: undefined,
    });
    expect(issue!.message).toContain("slopweaver browser terminal-shot");
  });

  it("refuses one reason in both proof slots, at the solution's", () => {
    const reason = t({ text: "Nothing on screen changes." });
    const body: PrBody = {
      ...TESTS_ONLY_BODY,
      problemProof: { kind: "reason", reason },
      solutionProof: { kind: "reason", reason: t({ text: " nothing on  screen changes. " }) },
    };
    expect(codes({ body })).toStrictEqual(["REASON_REPEATED solutionProof.reason"]);
  });

  it("refuses Slopweaver's own words in the title and the explainer, naming each word once", () => {
    const body: PrBody = { ...FIX_BODY, explainer: t({ text: "The seat lost its handoff, and the seat stalled." }) };
    const issues = descriptionWordIssues({ body, title: "fix(handover): a lap relays the row" });
    expect(issues.map((issue) => `${issue.code} ${issue.path.join(".")}`)).toStrictEqual([
      "TEAMMATE_WORDS title",
      "TEAMMATE_WORDS explainer",
    ]);
    expect(issues[1]!.message).toContain('("seat", "handoff")');
  });

  it("reads past the title's kind and scope, a backtick span and a code run", () => {
    const body: PrBody = {
      ...FIX_BODY,
      explainer: [
        { kind: "text", text: "The " },
        { kind: "code", text: "seat" },
        { kind: "text", text: " verb refused a store left open." },
      ],
    };
    expect(codes({ body, title: "fix(seat): the `lap` verb refuses an open store" })).toStrictEqual([]);
  });

  it.each([
    "Lint and typecheck pass.",
    "The whole-repo typecheck was left to CI.",
    "Every gate is green.",
    "CI passes on the head.",
  ])("refuses a check reporting CI's work: %s", (text) => {
    expect(codes({ body: { ...FIX_BODY, checks: [t({ text })] } })).toStrictEqual(["CI_WORK checks.0"]);
  });

  it("reads CI's work in a grouped check and a not-checked item too", () => {
    const body: PrBody = {
      ...FIX_BODY,
      checkGroups: [{ items: [t({ text: "Lint passes." })], label: t({ text: "On this machine" }) }],
      notChecked: [{ check: t({ text: "A full test run" }), why: t({ text: "Left to CI." }) }],
    };
    expect(codes({ body })).toStrictEqual(["CI_WORK checkGroups.0.items.0", "CI_WORK notChecked.0.check"]);
  });

  it("refuses code written as plain text, naming each piece and what it is", () => {
    const body: PrBody = {
      ...FIX_BODY,
      checks: [t({ text: "Running yarn vitest with --config set reads render.ts and STORE_PATH." })],
    };
    const issues = descriptionWordIssues({ body, title: undefined });
    expect(issues.map((issue) => issue.code)).toStrictEqual(["CODE_UNFORMATTED"]);
    expect(issues[0]!.message).toBe(
      'a flag "--config", a variable "STORE_PATH", a file name "render.ts", a command "yarn vitest" is written as ' +
        'plain text. Put each in a { "kind": "code" } run (in an authoring file or a title, between backticks)',
    );
  });

  it("leaves code in a code run, a product name and a hyphenated word", () => {
    const body: PrBody = {
      ...FIX_BODY,
      checks: [
        [
          { kind: "code", text: "yarn vitest --config x.ts" },
          { kind: "text", text: " runs on Node.js, read-only." },
        ],
      ],
    };
    expect(codes({ body })).toStrictEqual([]);
  });

  it("refuses bold that is not a figure, and keeps a short figure", () => {
    const bold = ({ text }: { text: string }): PrBody => ({
      ...FIX_BODY,
      explainer: [
        { kind: "text", text: "The store opened in " },
        { kind: "strong", text },
        { kind: "text", text: "." },
      ],
    });
    expect([
      codes({ body: bold({ text: "every" }) }),
      codes({ body: bold({ text: "1 of 3 starts and then some more" }) }),
      codes({ body: bold({ text: "309.9 seconds" }) }),
    ]).toStrictEqual([["BOLD_NOT_A_FIGURE explainer"], ["BOLD_NOT_A_FIGURE explainer"], []]);
  });

  it("refuses a commit id outside a link, in prose or as a whole code run, and keeps a linked one", () => {
    const sha = "8995a2a1";
    const body = ({ check }: { check: Content }): PrBody => ({ ...FIX_BODY, checks: [check] });
    expect([
      codes({ body: body({ check: t({ text: `Read at ${sha} on main.` }) }) }),
      codes({ body: body({ check: [{ kind: "code", text: sha }] }) }),
      codes({
        body: body({ check: [{ kind: "link", text: sha, url: `https://github.com/acme/widgets/commit/${sha}` }] }),
      }),
    ]).toStrictEqual([["COMMIT_UNLINKED checks.0"], ["COMMIT_UNLINKED checks.0"], []]);
  });

  it("does not read a plain word or a number as a commit", () => {
    expect(codes({ body: { ...FIX_BODY, checks: [t({ text: "It decoded 1234567 rows of deadbeef." })] } })).toEqual([]);
  });

  it.each(["Anyone starting the store", "Any install with a store", "For anyone with a store", "Everyone"])(
    "refuses an explainer opening on everybody: %s",
    (text) => {
      expect(codes({ body: { ...FIX_BODY, explainer: t({ text: `${text} met it open.` }) } })).toStrictEqual([
        "AUDIENCE_UNNAMED explainer",
      ]);
    },
  );

  it("withholds a quoting rule's text when the description carries a credential shape, keeping its code and path", () => {
    // Built at runtime so this file carries no credential shape the repository gate would refuse.
    const token = `ghp_${"a".repeat(30)}`;
    const [issue] = descriptionWordIssues({
      body: { ...FIX_BODY, explainer: t({ text: `People rotating ${token} met it.` }) },
      title: undefined,
    });
    expect([issue!.code, issue!.path, issue!.message.includes(token)]).toStrictEqual([
      "CODE_UNFORMATTED",
      ["explainer"],
      false,
    ]);
    expect(issue!.message).toContain("the description carries a credential shape");
  });

  it("quotes the found text in full when no credential shape is present", () => {
    const [issue] = descriptionWordIssues({
      body: { ...FIX_BODY, explainer: t({ text: "People setting max_rows met it." }) },
      title: undefined,
    });
    expect(issue!.message).toContain('a variable "max_rows"');
  });
});
