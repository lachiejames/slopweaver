import { describe, expect, it } from "vitest";

import {
  bareFileNamesIn,
  hasPinnedLink,
  renderSelfReviewComment,
  renderSelfReviewComments,
  SELF_REVIEW_KIND_PREFIX,
  SELF_REVIEW_KINDS,
  type SelfReviewComment,
  type SelfReviewForm,
  type SelfReviewVoiceFinding,
  selfReviewFormSchema,
  selfReviewVoiceFindings,
} from "../../../../outbound/github/selfReview.js";
import type { ExactVoiceRule } from "../../../../outbound/voice/exactRules.js";

const COMMENT: SelfReviewComment = {
  body: "This splits the parser so the review reads one change.",
  kind: "explanation",
  line: 12,
  path: "src/outbound/github/parse.ts",
};

/** A body of exactly `count` words. */
function wordsOf({ count }: { count: number }): string {
  return Array.from({ length: count }, () => "word").join(" ");
}

/** `count` comments on one file, each on its own line so no locus repeats. */
function commentsOf({ count }: { count: number }): readonly SelfReviewComment[] {
  return Array.from({ length: count }, (_, index) => ({ ...COMMENT, line: index + 1 }));
}

/** The messages a refused parse carries, in issue order. */
function refusalMessages({ value }: { value: unknown }): readonly string[] {
  const parsed = selfReviewFormSchema.safeParse(value);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues.map((issue) => issue.message);
}

describe("selfReviewFormSchema", () => {
  it("parses a valid round unchanged", () => {
    const form: SelfReviewForm = {
      comments: [COMMENT, { body: "Second note on the guard.", kind: "risk", line: 40, path: "src/lib/result.ts" }],
    };
    const parsed = selfReviewFormSchema.safeParse(form);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      comments: [
        {
          body: "This splits the parser so the review reads one change.",
          kind: "explanation",
          line: 12,
          path: "src/outbound/github/parse.ts",
        },
        { body: "Second note on the guard.", kind: "risk", line: 40, path: "src/lib/result.ts" },
      ],
    });
  });

  it("accepts 1 comment and refuses 0", () => {
    expect(selfReviewFormSchema.safeParse({ comments: commentsOf({ count: 1 }) }).success).toBe(true);
    expect(selfReviewFormSchema.safeParse({ comments: [] }).success).toBe(false);
  });

  it("accepts 100 comments and refuses 101", () => {
    expect(selfReviewFormSchema.safeParse({ comments: commentsOf({ count: 100 }) }).success).toBe(true);
    expect(selfReviewFormSchema.safeParse({ comments: commentsOf({ count: 101 }) }).success).toBe(false);
  });

  it("accepts a 50-word body and refuses a 51-word one with the word-cap message", () => {
    expect(selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, body: wordsOf({ count: 50 }) }] }).success).toBe(
      true,
    );
    expect(refusalMessages({ value: { comments: [{ ...COMMENT, body: wordsOf({ count: 51 }) }] } })).toEqual([
      "body must be at most 50 words",
    ]);
  });

  it("refuses a whitespace-only body as carrying no authored prose", () => {
    expect(refusalMessages({ value: { comments: [{ ...COMMENT, body: "   " }] } })).toEqual([
      "body must contain authored prose",
    ]);
  });

  it("accepts line 1 and refuses line 0", () => {
    expect(selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, line: 1 }] }).success).toBe(true);
    expect(selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, line: 0 }] }).success).toBe(false);
  });

  it("accepts line 2147483647 and refuses 2147483648", () => {
    expect(selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, line: 2_147_483_647 }] }).success).toBe(true);
    expect(selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, line: 2_147_483_648 }] }).success).toBe(false);
  });

  it("refuses a fractional line", () => {
    expect(selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, line: 1.5 }] }).success).toBe(false);
  });

  it("accepts a nested repository-relative path and refuses every non-relative shape with the path message", () => {
    expect(selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, path: "a/b/c.ts" }] }).success).toBe(true);
    const refused = ["/abs/file.ts", "src\\file.ts", "src//file.ts", "./file.ts", "src/../file.ts"].map((path) =>
      refusalMessages({ value: { comments: [{ ...COMMENT, path }] } }),
    );
    expect(refused).toEqual([
      ["path must be repository-relative"],
      ["path must be repository-relative"],
      ["path must be repository-relative"],
      ["path must be repository-relative"],
      ["path must be repository-relative"],
    ]);
  });

  it("refuses an empty path", () => {
    expect(selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, path: "" }] }).success).toBe(false);
  });

  it("refuses a second comment on the same path and line, at the second comment's index", () => {
    const parsed = selfReviewFormSchema.safeParse({ comments: [COMMENT, { ...COMMENT, body: "Another note." }] });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => ({ message: issue.message, path: issue.path }))).toEqual([
      { message: "only one self-review comment may target a path and line", path: ["comments", 1] },
    ]);
  });

  it("accepts two comments on the same path when their lines differ", () => {
    expect(selfReviewFormSchema.safeParse({ comments: [COMMENT, { ...COMMENT, line: 13 }] }).success).toBe(true);
  });

  it("refuses an unknown key on a comment and on the form", () => {
    const onComment = selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, side: "RIGHT" }] });
    const onForm = selfReviewFormSchema.safeParse({ comments: [COMMENT], event: "COMMENT" });
    expect(onComment.success).toBe(false);
    expect(onForm.success).toBe(false);
    expect(onComment.error!.issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
    expect(onForm.error!.issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
  });
});

describe("selfReviewVoiceFindings", () => {
  const rules: readonly ExactVoiceRule[] = [
    { kind: "phrase", value: "happy to" },
    { anyOf: ["I think", "probably"], kind: "at-least-one" },
  ];

  it("reports every broken rule in form order, with the comment path, kind and quoted label", () => {
    const form: SelfReviewForm = {
      comments: [
        { ...COMMENT, body: "Happy to split this later." },
        { ...COMMENT, body: "I think this guard is needed.", line: 13 },
        { ...COMMENT, body: "I think the first half holds.\nhappy to revisit it", line: 14 },
      ],
    };
    const expected: readonly SelfReviewVoiceFinding[] = [
      { kind: "phrase", label: 'matches the configured phrase voice rule "happy to"', path: "comments[0].body" },
      {
        kind: "at-least-one",
        label: 'carries none of the configured at-least-one voice markers ["I think","probably"]',
        path: "comments[0].body",
      },
      {
        kind: "phrase",
        label: 'matches the configured phrase voice rule "happy to"',
        path: "comments[2].body.line[1]",
      },
      {
        kind: "at-least-one",
        label: 'carries none of the configured at-least-one voice markers ["I think","probably"]',
        path: "comments[2].body.line[1]",
      },
    ];
    expect(selfReviewVoiceFindings({ form, rules })).toEqual(expected);
  });

  it("reports nothing for prose that breaks no rule", () => {
    const form: SelfReviewForm = { comments: [{ ...COMMENT, body: "I think this guard is probably needed." }] };
    expect(selfReviewVoiceFindings({ form, rules })).toEqual([]);
  });
});

describe("self-review kind", () => {
  it("refuses a comment with no kind and one with a kind outside the closed set", () => {
    const { kind: _omitted, ...withoutKind } = COMMENT;
    const missing = selfReviewFormSchema.safeParse({ comments: [withoutKind] });
    const unknown = selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, kind: "nit" }] });
    expect(missing.error!.issues.map((issue) => issue.path)).toEqual([["comments", 0, "kind"]]);
    expect(unknown.error!.issues.map((issue) => issue.path)).toEqual([["comments", 0, "kind"]]);
  });

  it("pins every kind to its one emoji", () => {
    expect(SELF_REVIEW_KINDS.map((kind) => `${kind} ${SELF_REVIEW_KIND_PREFIX[kind]}`)).toEqual([
      "behaviour-change ⚠️",
      "moved-unchanged ♻️",
      "risk 🚩",
      "test 🧪",
      "explanation 💡",
    ]);
  });

  it("renders the kind's emoji, one space, then the body, keeping the locus", () => {
    expect(renderSelfReviewComment({ comment: { ...COMMENT, kind: "behaviour-change" } })).toEqual({
      body: "⚠️ This splits the parser so the review reads one change.",
      line: 12,
      path: "src/outbound/github/parse.ts",
    });
    expect(renderSelfReviewComment({ comment: { ...COMMENT, kind: "moved-unchanged" } }).body).toBe(
      "♻️ This splits the parser so the review reads one change.",
    );
  });

  it("refuses a body that types a prefix itself, with or without the variation selector", () => {
    const typed = ["⚠️ Changes the retry.", "⚠ Changes the retry.", "  ♻️ Moved as is."].map((body) =>
      refusalMessages({ value: { comments: [{ ...COMMENT, body }] } }),
    );
    const message =
      "body must not open with an emoji prefix: `kind` renders it (behaviour-change ⚠️, moved-unchanged ♻️, risk 🚩, test 🧪, explanation 💡)";
    expect(typed).toEqual([[message], [message], [message]]);
  });

  it("accepts an emoji later in the body", () => {
    expect(selfReviewFormSchema.safeParse({ comments: [{ ...COMMENT, body: "Keeps the ⚠️ marker." }] }).success).toBe(
      true,
    );
  });
});

describe("renderSelfReviewComments", () => {
  it("renders every comment of a round in order, each opening with its kind", () => {
    const form = {
      comments: [
        { body: "The guard moved here.", kind: "moved-unchanged" as const, line: 4, path: "src/a.ts" },
        { body: "Covers the empty input.", kind: "test" as const, line: 9, path: "src/b.ts" },
      ],
    };
    expect(renderSelfReviewComments({ form })).toStrictEqual([
      { body: "♻️ The guard moved here.", line: 4, path: "src/a.ts" },
      { body: "🧪 Covers the empty input.", line: 9, path: "src/b.ts" },
    ]);
  });

  it("renders no round as no comments", () => {
    expect(renderSelfReviewComments({ form: undefined })).toStrictEqual([]);
  });
});

describe("bareFileNamesIn", () => {
  it("names every file written outside backticks, paths included", () => {
    expect(bareFileNamesIn({ body: "Moves parse.ts beside src/lib/result.ts and docs/store.md." })).toEqual([
      "parse.ts",
      "src/lib/result.ts",
      "docs/store.md",
    ]);
  });

  it("lets a backticked name, a product name and a version number through", () => {
    expect(bareFileNamesIn({ body: "Moves `parse.ts` for Node.js on version 1.2.3, see `a/b.md`." })).toEqual([]);
  });

  it("refuses a bare file name in the schema with its fix", () => {
    expect(refusalMessages({ value: { comments: [{ ...COMMENT, body: "Mirrors selfReview.ts exactly." }] } })).toEqual([
      "body names selfReview.ts outside backticks; write it as `selfReview.ts`",
    ]);
  });
});

describe("hasPinnedLink", () => {
  it("flags a blob link pinned to a commit and one pinned to a line", () => {
    expect(hasPinnedLink({ body: "See https://github.com/acme/app/blob/0123abcd/src/a.ts here." })).toBe(true);
    expect(hasPinnedLink({ body: "See https://github.com/acme/app/blob/main/src/a.ts#L12 here." })).toBe(true);
  });

  it("lets a branch link with no line and a pull request link through", () => {
    expect(hasPinnedLink({ body: "See https://github.com/acme/app/blob/main/README" })).toBe(false);
    expect(hasPinnedLink({ body: "See https://github.com/acme/app/pull/12" })).toBe(false);
  });

  it("refuses a pinned link in the schema", () => {
    const body = "Same as https://github.com/acme/app/blob/main/src/a#L4 above.";
    expect(refusalMessages({ value: { comments: [{ ...COMMENT, body }] } })).toEqual([
      "body must not link a GitHub blob pinned to a commit or a line, which goes stale on every rebase; name the file in backticks instead",
    ]);
  });
});
