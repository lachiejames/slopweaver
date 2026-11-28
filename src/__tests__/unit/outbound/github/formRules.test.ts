/**
 * The rules a C3 body is held to beyond its shape, read by both the write schema and the CI gate: ranked risk, a real
 * seen day, every word cap, a visual-proof claim that agrees with its slots, a Not-checked phrase the reader can split,
 * and where proof is hosted. The last describe checks the door applies them, each message led by its code.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DESCRIPTION_RULE_FILES } from "../../../../outbound/github/descriptionReviewTypes.js";
import {
  c3FormErrors,
  type FormRuleIssue,
  PROOF_REASON_CAP,
  WORD_CAPS,
} from "../../../../outbound/github/formRules.js";
import { QUOTE_CAPS } from "../../../../outbound/github/quoteRules.js";
import type { PrBody } from "../../../../outbound/github/types.js";
import { prFormWriteSchema } from "../../../../outbound/github/writeSchema.js";
import {
  FEATURE_BODY,
  FIX_BODY,
  formOf,
  P1_CHECKED,
  P2_CHECKED,
  P3_CHECKED,
  QUOTE_BODY,
  shot,
  TESTS_BODY,
  TESTS_ONLY_BODY,
  t,
} from "./fixtures.js";

/** Every issue on a body written today, in the current layout and with no title. */
function issuesOf({ body, today }: { body: PrBody; today: string | undefined }): readonly FormRuleIssue[] {
  return c3FormErrors({ body, layout: 2, title: undefined, today });
}

/** Every issue on a body as `code path`, no clock. */
function codes({ body, today }: { body: PrBody; today?: string }): readonly string[] {
  return issuesOf({ body, today }).map((issue) => `${issue.code} ${issue.path.join(".")}`);
}

/** A run of `n` words. */
function words({ n }: { n: number }): string {
  return Array.from({ length: n }, () => "word").join(" ");
}

describe("c3FormErrors", () => {
  it("passes every cut-4 fixture", () => {
    expect([TESTS_BODY, FIX_BODY, FEATURE_BODY, TESTS_ONLY_BODY].flatMap((body) => codes({ body }))).toStrictEqual([]);
  });

  it("refuses an empty risk list, naming the fix", () => {
    const issues = issuesOf({ body: { ...FIX_BODY, risk: { items: [] } }, today: undefined });
    expect(issues.map((issue) => `${issue.code} ${issue.path.join(".")}`)).toStrictEqual(["RISK_UNRANKED risk.items"]);
    expect(issues[0]!.message).toBe("the risk items cannot be ranked: there are none; name at least one");
  });

  it("refuses risk items whose level rises, naming the item", () => {
    const issues = issuesOf({ body: { ...FIX_BODY, risk: { items: [P3_CHECKED, P1_CHECKED] } }, today: undefined });
    expect(issues.map((issue) => issue.message)).toStrictEqual([
      "the risk items cannot be ranked: item 2 is high after a low one; list them high first, then medium, then " +
        "low, so the top item is the worst",
    ]);
  });

  it("accepts two items of the same level", () => {
    expect(codes({ body: { ...FIX_BODY, risk: { items: [P2_CHECKED, P2_CHECKED] } } })).toStrictEqual([]);
  });

  it("caps a check group's label and each of its checks, at their own paths", () => {
    const body: PrBody = {
      ...FIX_BODY,
      checkGroups: [
        {
          items: [t({ text: "It refuses an open store." }), t({ text: words({ n: WORD_CAPS.check + 1 }) })],
          label: t({ text: words({ n: WORD_CAPS.checkGroupLabel + 1 }) }),
        },
      ],
    };
    expect(codes({ body })).toStrictEqual(["WORD_CAP checkGroups.0.label", "WORD_CAP checkGroups.0.items.1"]);
  });

  it("judges a layout-2 body's words and leaves a layout-1 body's as they were published", () => {
    const body: PrBody = { ...FIX_BODY, explainer: t({ text: "Anyone starting the store met it open." }) };
    const judged = ({ layout }: { layout: 1 | 2 }): readonly string[] =>
      c3FormErrors({ body, layout, title: "fix: keep the seat", today: undefined }).map((issue) => issue.code);
    expect([judged({ layout: 2 }), judged({ layout: 1 })]).toStrictEqual([["TEAMMATE_WORDS", "AUDIENCE_UNNAMED"], []]);
  });

  it("refuses a seen day after the day of the write, and judges none with no clock", () => {
    const body: PrBody = {
      ...FIX_BODY,
      problemSeen: { by: "agent", kind: "seen", on: "2026-11-20", what: "it broke" },
    };
    expect([codes({ body, today: "2026-11-18" }), codes({ body })]).toStrictEqual([["SEEN_DAY problemSeen.on"], []]);
  });

  it("says which day was seen and which is today, naming the field to fix", () => {
    const body: PrBody = {
      ...FIX_BODY,
      problemSeen: { by: "agent", kind: "seen", on: "2026-11-20", what: "it broke" },
    };
    expect(issuesOf({ body, today: "2026-11-18" }).map((issue) => issue.message)).toStrictEqual([
      "the problem is marked seen on 2026-11-20, after today (2026-11-18). Set problemSeen.on to the day it was seen",
    ]);
  });

  it("accepts a problem seen on the day of the write", () => {
    expect(codes({ body: FIX_BODY, today: "2026-11-16" })).toStrictEqual([]);
  });

  it("reports unranked items and a seen day after today together, in that order", () => {
    const body: PrBody = {
      ...FIX_BODY,
      problemSeen: { by: "agent", kind: "seen", on: "2026-11-20", what: "it broke" },
      risk: { items: [P3_CHECKED, P1_CHECKED] },
    };
    expect(codes({ body, today: "2026-11-18" })).toStrictEqual(["RISK_UNRANKED risk.items", "SEEN_DAY problemSeen.on"]);
  });

  it("refuses a seen day that is not a real calendar day", () => {
    const body: PrBody = {
      ...FIX_BODY,
      problemSeen: { by: "agent", kind: "seen", on: "2026-02-30", what: "it broke" },
    };
    expect(codes({ body })).toStrictEqual(["BADGE problemSeen"]);
  });

  it("caps a worst case and a risk check, each at its own item", () => {
    const body: PrBody = {
      ...FIX_BODY,
      risk: {
        items: [
          { ...P2_CHECKED, worst: words({ n: WORD_CAPS.worst + 1 }) },
          {
            check: { kind: "unchecked", why: words({ n: WORD_CAPS.hover + 1 }) },
            worst: "it breaks",
            worstKind: "something-working-breaks",
          },
        ],
      },
    };
    expect(codes({ body })).toStrictEqual(["WORD_CAP risk.items.0.worst", "WORD_CAP risk.items.1.check"]);
  });

  it("names the risk item and its count when a worst case runs over", () => {
    const body: PrBody = { ...FIX_BODY, risk: { items: [{ ...P2_CHECKED, worst: words({ n: 21 }) }] } };
    expect(issuesOf({ body, today: undefined }).map((issue) => issue.message)).toStrictEqual([
      "Risk item 1's worst case is 21 words (max 20). Trim it.",
    ]);
  });

  it("caps the seen line a problem hover carries", () => {
    const body: PrBody = { ...FEATURE_BODY, problemSeen: { kind: "not-seen", why: words({ n: WORD_CAPS.hover + 1 }) } };
    expect(codes({ body })).toStrictEqual(["WORD_CAP problemSeen"]);
  });

  it("caps the explainer at the owner's 70 words, counting the rendered cell", () => {
    const at = issuesOf({ body: { ...FIX_BODY, explainer: t({ text: words({ n: 70 }) }) }, today: undefined });
    const over = issuesOf({ body: { ...FIX_BODY, explainer: t({ text: words({ n: 71 }) }) }, today: undefined });
    expect([at.length, over.map((issue) => issue.message)]).toStrictEqual([
      0,
      ["The explainer is 71 words (max 70). Trim it."],
    ]);
  });

  it("caps every visible section at its own path", () => {
    const body: PrBody = {
      ...FEATURE_BODY,
      checks: [t({ text: words({ n: WORD_CAPS.check + 1 }) })],
      notChecked: [
        {
          check: t({ text: words({ n: WORD_CAPS.uncheckedCheck + 1 }) }),
          why: t({ text: words({ n: WORD_CAPS.uncheckedWhy + 1 }) }),
        },
      ],
      rerun: [{ content: t({ text: words({ n: WORD_CAPS.rerunNote + 1 }) }), kind: "note" }],
      solutionProof: {
        image: shot({ alt: "saved expiry", id: "77777777-aaaa-4bbb-8ccc-000000000009" }),
        kind: "screenshot",
        proves: t({ text: words({ n: WORD_CAPS.proves + 1 }) }),
        runBy: "agent",
      },
    };
    expect(codes({ body })).toStrictEqual([
      "WORD_CAP solutionProof.proves",
      "WORD_CAP checks.0",
      "WORD_CAP notChecked.0.check",
      "WORD_CAP notChecked.0.why",
      "WORD_CAP rerun.0",
    ]);
  });

  it("refuses a reason the proof hover quotes when the hover would run past its cap, naming that reason's slot", () => {
    const long = Array.from({ length: 22 }, () => "longword").join(" ");
    const issues = issuesOf({
      body: { ...FEATURE_BODY, problemProof: { kind: "reason", reason: t({ text: long }) } },
      today: undefined,
    });
    expect(issues.map((issue) => `${issue.code} ${issue.path.join(".")}`)).toStrictEqual(["BADGE problemProof"]);
    expect(issues[0]!.message).toContain("Shorten the field it is built from");
  });

  it("refuses nothing-on-screen beside a screenshot, which contradicts itself", () => {
    expect(codes({ body: { ...FIX_BODY, visualProof: "nothing-on-screen" } })).toStrictEqual([
      "VISUAL_PROOF visualProof",
    ]);
  });

  it("accepts screen-change with two reasons, which reads not run yet", () => {
    expect(codes({ body: { ...TESTS_ONLY_BODY, visualProof: "screen-change" } })).toStrictEqual([]);
  });

  it("refuses a Not-checked phrase carrying a full stop, which the reader splits at", () => {
    const body: PrBody = {
      ...FEATURE_BODY,
      notChecked: [
        { check: t({ text: "The warning. On a real sign-in" }), why: t({ text: "Tests cover it." }) },
        { check: t({ text: "A work account." }), why: t({ text: "Out of scope." }) },
      ],
    };
    expect(codes({ body })).toStrictEqual(["UNCHECKED_SPLIT notChecked.0.check", "UNCHECKED_SPLIT notChecked.1.check"]);
  });

  it("refuses a screenshot off user-attachments, and a look-alike with a path after the id", () => {
    const off = ({ url }: { url: string }): PrBody => ({
      ...FIX_BODY,
      solutionProof: {
        image: { alt: "after", kind: "image", url },
        kind: "screenshot",
        proves: t({ text: "It refuses." }),
        runBy: "agent",
      },
    });
    expect([
      codes({ body: off({ url: "https://example.com/after.png" }) }),
      codes({ body: off({ url: "https://github.com/user-attachments/assets/abc/extra" }) }),
    ]).toStrictEqual([
      ["IMAGE_NOT_USER_ATTACHMENT solutionProof.image.url"],
      ["IMAGE_NOT_USER_ATTACHMENT solutionProof.image.url"],
    ]);
  });

  it("names the upload verb when a screenshot is hosted off user-attachments", () => {
    const body: PrBody = {
      ...FIX_BODY,
      problemProof: {
        image: { alt: "before", kind: "image", url: "https://example.com/a.png" },
        kind: "screenshot",
        proves: t({ text: "On main, it goes through." }),
        runBy: "agent",
      },
    };
    expect(issuesOf({ body, today: undefined }).map((issue) => issue.message)).toStrictEqual([
      "the screenshot https://example.com/a.png is not a GitHub user-attachments upload. Upload the file with " +
        "`slopweaver github attach <file>` and use the https://github.com/user-attachments/assets/<id> URL it prints",
    ]);
  });

  it("withholds a hosting refusal whose screenshot address carries a credential shape, keeping its code and path", () => {
    // Built at runtime so this file carries no credential shape the repository gate would refuse.
    const token = `ghp_${"a".repeat(30)}`;
    const body: PrBody = {
      ...FIX_BODY,
      solutionProof: {
        image: { alt: "after", kind: "image", url: `https://example.com/${token}` },
        kind: "screenshot",
        proves: t({ text: "It refuses." }),
        runBy: "agent",
      },
    };
    const issues = issuesOf({ body, today: undefined });
    expect(issues.map((issue) => [issue.code, issue.path, issue.message.includes(token)])).toStrictEqual([
      ["IMAGE_NOT_USER_ATTACHMENT", ["solutionProof", "image", "url"], false],
    ]);
    expect(issues[0]!.message).toContain("the description carries a credential shape");
  });

  it("refuses a release-download link in a check, naming the upload verb", () => {
    const url = "https://github.com/o/r/releases/download/proof-1/after.png";
    const issues = issuesOf({
      body: { ...FIX_BODY, checks: [[{ kind: "link", text: "the proof", url }]] },
      today: undefined,
    });
    expect(issues.map((issue) => `${issue.code} ${issue.path.join(".")}`)).toStrictEqual([
      "EVIDENCE_RELEASE_DOWNLOAD checks.0.0",
    ]);
    expect(issues[0]!.message).toContain("slopweaver github attach");
  });

  it.each([
    "https://github.com/o/r/pull/7#issuecomment-123456",
    "https://github.com/o/r/pull/7#discussion_r123456",
    "https://github.com/o/r/pull/7#pullrequestreview-123456",
  ])("refuses a comment link in a proof reason: %s", (url) => {
    const issues = issuesOf({
      body: { ...FEATURE_BODY, problemProof: { kind: "reason", reason: [{ kind: "link", text: "the comment", url }] } },
      today: undefined,
    });
    expect(issues.map((issue) => `${issue.code} ${issue.path.join(".")}`)).toStrictEqual([
      "EVIDENCE_COMMENT_LINK problemProof.reason.0",
    ]);
    expect(issues[0]!.message).toContain("slopweaver github attach");
  });

  it.each([
    "https://github.com/o/r/blob/main/proof/after.png",
    "https://github.com/o/r/raw/main/proof/run.mp4",
    "https://raw.githubusercontent.com/o/r/main/proof/after.JPEG",
  ])("refuses a committed media file linked from a proof line: %s", (url) => {
    const body: PrBody = {
      ...FIX_BODY,
      solutionProof: {
        image: shot({ alt: "after", id: "22222222-aaaa-4bbb-8ccc-000000000003" }),
        kind: "screenshot",
        proves: [{ kind: "link", text: "the shot", url }],
        runBy: "agent",
      },
    };
    const issues = issuesOf({ body, today: undefined });
    expect(issues.map((issue) => `${issue.code} ${issue.path.join(".")}`)).toStrictEqual([
      "EVIDENCE_COMMITTED_MEDIA solutionProof.proves.0",
    ]);
    expect(issues[0]!.message).toContain("slopweaver github attach");
  });

  it.each([
    "https://github.com/o/r/blob/main/src/outbound/github/render.ts#L12",
    "https://app.datadoghq.com/logs?query=service%3Aapi",
    "https://linear.app/acme/issue/ABC-1",
    "https://acme.slack.com/archives/C0SYN000000000/p1700000000000000",
    "https://github.com/o/r/actions/runs/1",
  ])("allows a check linking code, Datadog, Linear, Slack or a CI run: %s", (url) => {
    expect(codes({ body: { ...FIX_BODY, checks: [[{ kind: "link", text: "the run", url }]] } })).toStrictEqual([]);
    expect(
      codes({
        body: { ...FEATURE_BODY, problemProof: { kind: "reason", reason: [{ kind: "link", text: "x", url }] } },
      }),
    ).toStrictEqual([]);
  });
});

describe("c3FormErrors — a proof reason is at most two sentences", () => {
  /** A body whose solution slot is the reason given, its problem slot untouched. */
  function withSolutionReason({ reason }: { reason: PrBody["checks"][number] }): PrBody {
    return { ...TESTS_ONLY_BODY, solutionProof: { kind: "reason", reason } };
  }

  it("states the cap in the same words as the rule file the description review reads", () => {
    const rulePath = "skills/github/reference/composing-a-body.md";
    const rule = readFileSync(new URL(`../../../../../${rulePath}`, import.meta.url), "utf8").replace(/\s+/gu, " ");
    expect(DESCRIPTION_RULE_FILES).toContain(rulePath);
    expect(rule).toContain(`so ${PROOF_REASON_CAP}.`);
  });

  it("refuses three sentences, naming the slot and where the rest goes", () => {
    const issues = issuesOf({
      body: withSolutionReason({
        reason: t({ text: "Not run yet. There is no screenshot. The checks below are the proof." }),
      }),
      today: undefined,
    });
    expect(issues.map((issue) => `${issue.code} ${issue.path.join(".")}`)).toStrictEqual([
      "PROOF_REASON_SENTENCES solutionProof.reason",
    ]);
    expect(issues[0]!.message).toBe(
      "solutionProof.reason is 3 sentences, and a proof slot's reason is at most two sentences: why there is no " +
        "screenshot, then where the proof is instead. Move a result into checks and an unrun check into notChecked",
    );
  });

  it("accepts the reason and the pointer to the proof, a final full stop omitted included", () => {
    expect(
      codes({
        body: withSolutionReason({
          reason: t({ text: "Nothing on screen changes. The checks below are the proof" }),
        }),
      }),
    ).toStrictEqual([]);
    expect(codes({ body: withSolutionReason({ reason: t({ text: "Nothing on screen changes." }) }) })).toStrictEqual(
      [],
    );
  });

  it("does not end a sentence on a code or link run's own full stop", () => {
    const reason: PrBody["checks"][number] = [
      { kind: "text", text: "Nothing on screen changes. " },
      { kind: "code", text: "yarn test. " },
      { kind: "text", text: " and " },
      { kind: "link", text: "the run. Twice.", url: "https://github.com/o/r/actions/runs/1" },
      { kind: "text", text: " judge it." },
    ];
    expect(codes({ body: withSolutionReason({ reason }) })).toStrictEqual([]);
  });

  it("does not end a sentence on an abbreviation's full stop, yet still counts a real third sentence", () => {
    const two = t({
      text: "Nothing changes on screen, e.g. only internals. The linked record, i.e. the run, is the proof.",
    });
    const three = t({ text: "Nothing changes on screen, e.g. only internals. The linked record shows it. Twice." });
    expect(codes({ body: withSolutionReason({ reason: two }) })).toStrictEqual([]);
    expect(codes({ body: withSolutionReason({ reason: three }) })).toStrictEqual([
      "PROOF_REASON_SENTENCES solutionProof.reason",
    ]);
  });

  it("counts a sentence that ends inside a closing quote", () => {
    const quoted = t({ text: 'No screenshot. "Nothing moves." Done.' });
    expect(codes({ body: withSolutionReason({ reason: quoted }) })).toStrictEqual([
      "PROOF_REASON_SENTENCES solutionProof.reason",
    ]);
  });

  it("reports both slots when both run long, and never a screenshot slot", () => {
    const long = t({ text: "One. Two. Three." });
    const both: PrBody = {
      ...TESTS_ONLY_BODY,
      problemProof: { kind: "reason", reason: long },
      solutionProof: { kind: "reason", reason: long },
    };
    expect(codes({ body: both }).filter((code) => code.startsWith("PROOF_REASON"))).toStrictEqual([
      "PROOF_REASON_SENTENCES problemProof.reason",
      "PROOF_REASON_SENTENCES solutionProof.reason",
    ]);
    expect(codes({ body: FEATURE_BODY })).toStrictEqual([]);
  });
});

describe("c3FormErrors — a quote is the lines that prove it", () => {
  /** The quote body with its problem quote's text replaced. */
  function withProblemText({ text }: { text: string }): PrBody {
    const quote = QUOTE_BODY.problemProof;
    if (quote.kind !== "quote") {
      throw new Error("QUOTE_BODY's problem proof is a quote");
    }
    return { ...QUOTE_BODY, problemProof: { ...quote, text } };
  }

  it("passes a quote body, nothing on screen beside two quotes included", () => {
    expect(codes({ body: QUOTE_BODY })).toStrictEqual([]);
  });

  it("accepts exactly the line and width caps, and refuses one past either", () => {
    const atCap = Array.from({ length: QUOTE_CAPS.lines }, () => "x".repeat(QUOTE_CAPS.lineChars)).join("\n");
    const tooMany = `${atCap}\nx`;
    const tooWide = `${"x".repeat(QUOTE_CAPS.lineChars + 1)}`;
    expect(codes({ body: withProblemText({ text: atCap }) })).toStrictEqual([]);
    expect(codes({ body: withProblemText({ text: tooMany }) })).toStrictEqual(["QUOTE_LINES problemProof.text"]);
    expect(issuesOf({ body: withProblemText({ text: tooWide }), today: undefined })[0]!.message).toBe(
      "problemProof.text is 1 lines, the widest 201 characters (max 20 lines of 200). Quote only the lines that " +
        "prove it; the source line points at the rest",
    );
  });

  it("refuses a quote of a million lines rather than overflowing the stack measuring it", () => {
    const text = Array.from({ length: 1_000_000 }, () => "x").join("\n");
    expect(codes({ body: withProblemText({ text }) })).toStrictEqual(["QUOTE_LINES problemProof.text"]);
  });

  it.each([
    ["an email address", "login failed for someone@example.com"],
    ["an IPv4 address", "connect ECONNREFUSED 203.0.113.7:5432"],
    ["an IPv6 address", "bound to fe80::1ff:fe23:4567:890a then closed"],
  ])("refuses %s in a quote rather than publishing or rewriting it", (_name, text) => {
    expect(codes({ body: withProblemText({ text }) })).toStrictEqual(["QUOTE_PII problemProof.text"]);
  });

  it("never reads a quote's output as the author's prose", () => {
    expect(
      codes({ body: withProblemText({ text: "I think we should fix this. The unit tests below prove it." }) }),
    ).toStrictEqual([]);
  });

  it("refuses a screenshot beside a quote when nothing is on screen", () => {
    const body: PrBody = { ...QUOTE_BODY, solutionProof: FIX_BODY.solutionProof };
    expect(codes({ body })).toStrictEqual(["VISUAL_PROOF visualProof"]);
  });
});

describe("prFormWriteSchema — a quote's shape", () => {
  /** The write schema's messages for the quote body with its problem quote's fields replaced. */
  function refusals({ over }: { over: Record<string, unknown> }): readonly string[] {
    const parsed = prFormWriteSchema.safeParse({
      ...formOf({ body: QUOTE_BODY }),
      problemProof: { ...QUOTE_BODY.problemProof, ...over },
    });
    return parsed.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  }

  it("accepts the quote body as a whole form", () => {
    expect(prFormWriteSchema.safeParse(formOf({ body: QUOTE_BODY })).success).toBe(true);
  });

  it("refuses a blank line, which would not read back", () => {
    expect(refusals({ over: { text: "first\n\nsecond" } })).toStrictEqual([
      "problemProof.text: a quote carries a blank line, which would not read back: the description splits at blank " +
        "lines. Quote only the lines that prove it, with no blank line between them",
    ]);
  });

  it("refuses a carriage return", () => {
    expect(refusals({ over: { text: "first\r\nsecond" } })).toStrictEqual([
      "problemProof.text: a carriage return in a quote may not read back. Use a newline alone",
    ]);
  });

  it("refuses a source that is neither a link nor a code run", () => {
    expect(refusals({ over: { source: { kind: "text", text: "the log" } } })[0]).toContain("problemProof.source");
  });
});

describe("prFormWriteSchema — the rules at the door", () => {
  it("accepts every fixture as a whole form", () => {
    const forms = [TESTS_BODY, FIX_BODY, FEATURE_BODY, TESTS_ONLY_BODY].map((body) => formOf({ body }));
    expect(forms.map((form) => prFormWriteSchema.safeParse(form).success)).toStrictEqual([true, true, true, true]);
  });

  it("refuses each retired field by name, saying where its job went", () => {
    const retired = ["origin", "review", "goldAnchor", "reviewers", "reviewLeftovers", "writtenOn"].map((key) => {
      const parsed = prFormWriteSchema.safeParse({ ...formOf({ body: FIX_BODY }), [key]: "x" });
      return parsed.error!.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message.slice(0, issue.message.indexOf(":"))}`,
      );
    });
    expect(retired).toStrictEqual([
      ["origin: origin is no longer published"],
      ["review: review is no longer published"],
      ["goldAnchor: goldAnchor is no longer published"],
      ["reviewers: reviewers left the description"],
      ["reviewLeftovers: reviewLeftovers left the description"],
      ["writtenOn: writtenOn is not a field"],
    ]);
  });

  it("applies the form rules at the door, each message led by its code", () => {
    const parsed = prFormWriteSchema.safeParse({
      ...formOf({ body: FIX_BODY }),
      explainer: t({ text: words({ n: 71 }) }),
      visualProof: "nothing-on-screen",
    });
    expect(parsed.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)).toStrictEqual([
      "explainer: WORD_CAP: The explainer is 71 words (max 70). Trim it.",
      'visualProof: VISUAL_PROOF: visualProof is "nothing-on-screen", but a proof slot carries a screenshot, which is ' +
        'something on screen. Set visualProof to "screen-change"',
    ]);
  });

  it("refuses a hosting rule at the door by its code", () => {
    const parsed = prFormWriteSchema.safeParse({
      ...formOf({ body: FIX_BODY }),
      checks: [[{ kind: "link", text: "the proof", url: "https://github.com/o/r/releases/download/p/a.png" }]],
    });
    expect(parsed.error!.issues.map((issue) => issue.message.split(":")[0])).toStrictEqual([
      "EVIDENCE_RELEASE_DOWNLOAD",
    ]);
  });

  it("refuses a newline inside a cell run", () => {
    const parsed = prFormWriteSchema.safeParse({ ...formOf({ body: FIX_BODY }), explainer: t({ text: "one\ntwo" }) });
    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toStrictEqual(["explainer"]);
  });
});
