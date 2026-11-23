import { describe, expect, it } from "vitest";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import {
  dryRunSelfReviewLine,
  githubSelfReviewDoorRequest,
  missingWalkthroughLine,
  parseSelfReviewForm,
  reviewThreadIdsFor,
  selfReviewAuthorshipRefusal,
  selfReviewDiffAnchorRefusals,
  selfReviewDiffLineSet,
  selfReviewPublicationReasons,
} from "../../../../../cli/commands/github/selfReviewCore.js";
import { parsePrivateTerms } from "../../../../../hygiene/privateTerms.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";

function rawForm({ body = "This keeps the retry boundary beside the provider call." }: { body?: string } = {}): string {
  return JSON.stringify({ comments: [{ body, kind: "explanation", line: 42, path: "src/example.ts" }] });
}

describe("missingWalkthroughLine", () => {
  it("names the exact round to post on a pull request just opened with none", () => {
    expect(missingWalkthroughLine({ number: 17519, repoSlug: "acme/acme-admin" })).toBe(
      "⚠ opened #17519 with no self-review walkthrough. Every pull request of the owner's carries inline notes guiding " +
        "the reviewer — post a round with `slopweaver github pr update --repo acme/acme-admin --number 17519 " +
        "--self-review -`",
    );
  });

  it("names the flag on a dry run, where no pull request exists yet", () => {
    expect(missingWalkthroughLine({ number: undefined, repoSlug: "acme/acme-admin" })).toBe(
      "⚠ would open with no self-review walkthrough: pass --self-review with inline notes guiding the reviewer " +
        "(what to read first, why a surprising line is there)",
    );
  });
});

describe("dryRunSelfReviewLine", () => {
  it("counts the comments a supplied round would post", () => {
    expect(dryRunSelfReviewLine({ comments: 3, repoSlug: "acme/acme-admin" })).toBe(
      "would post 3 inline self-review comment(s) once created",
    );
  });

  it("warns, naming the flag, when no round was supplied", () => {
    expect(dryRunSelfReviewLine({ comments: undefined, repoSlug: "acme/acme-admin" })).toBe(
      missingWalkthroughLine({ number: undefined, repoSlug: "acme/acme-admin" }),
    );
  });
});

describe("parseSelfReviewForm", () => {
  it("accepts the strict reviewer-walkthrough shape exactly", () => {
    expect(parseSelfReviewForm({ denylist: [], exactVoiceRules: [], privateTerms: [], raw: rawForm() })).toEqual(
      ok({
        comments: [
          {
            body: "This keeps the retry boundary beside the provider call.",
            kind: "explanation",
            line: 42,
            path: "src/example.ts",
          },
        ],
      }),
    );
  });

  it("refuses a comment over the 50-word ceiling", () => {
    const body = Array.from({ length: 51 }, () => "word").join(" ");
    expect(
      parseSelfReviewForm({ denylist: [], exactVoiceRules: [], privateTerms: [], raw: rawForm({ body }) }),
    ).toEqual(
      err(
        GithubVerbErrors.formInvalid({
          form: "--self-review",
          reasons: ["comments.0.body: body must be at most 50 words"],
        }),
      ),
    );
  });

  it("refuses unknown keys instead of silently dropping them", () => {
    const raw = JSON.stringify({
      comments: [{ body: "Plain explanation.", kind: "explanation", line: 4, path: "a.ts", position: 9 }],
    });
    const result = parseSelfReviewForm({ denylist: [], exactVoiceRules: [], privateTerms: [], raw });
    expect(result).toEqual(
      err(
        GithubVerbErrors.formInvalid({
          form: "--self-review",
          reasons: [
            'comments.0: unknown field "position" — REFUSED, not ignored. No field here is close to it, so it is probably a field from another schema.\nthis form\'s fields are: body, kind, line, path',
          ],
        }),
      ),
    );
  });

  it("reuses private exact voice rules over authored prose", () => {
    expect(
      parseSelfReviewForm({
        denylist: [],
        exactVoiceRules: [{ kind: "phrase", value: "happy to" }],
        privateTerms: [],
        raw: rawForm({ body: "Happy to explain why this boundary exists." }),
      }),
    ).toEqual(
      err(
        GithubVerbErrors.formInvalid({
          form: "--self-review",
          reasons: [
            'comments[0].body matches the configured phrase voice rule "happy to". Rewrite the authored prose; inline self-review comments have no voice-rule override.',
          ],
        }),
      ),
    );
  });

  it("refuses two comments on the same path and line", () => {
    const raw = JSON.stringify({
      comments: [
        { body: "First.", kind: "explanation", line: 4, path: "a.ts" },
        { body: "Second.", kind: "test", line: 4, path: "a.ts" },
      ],
    });
    expect(parseSelfReviewForm({ denylist: [], exactVoiceRules: [], privateTerms: [], raw })).toEqual(
      err(
        GithubVerbErrors.formInvalid({
          form: "--self-review",
          reasons: ["comments.1: only one self-review comment may target a path and line"],
        }),
      ),
    );
  });
});

describe("parseSelfReviewForm publication scan", () => {
  const firstPersonFix = 'name who acted — "the owner", or "an agent" for a session — or say what the change does';

  it("refuses first person and a denylisted term, naming the comment, the line and the fix", () => {
    const raw = JSON.stringify({
      comments: [
        { body: "We moved the guard.", kind: "moved-unchanged", line: 4, path: "a.ts" },
        { body: "Plain note on\nthe Zorblat path.", kind: "risk", line: 5, path: "a.ts" },
      ],
    });
    expect(parseSelfReviewForm({ denylist: ["zorblat"], exactVoiceRules: [], privateTerms: [], raw })).toEqual(
      err(
        GithubVerbErrors.formInvalid({
          form: "--self-review",
          reasons: [
            `comments.0.body: self-review comment line 1: "We" is first person — ${firstPersonFix}`,
            "comments.1.body: self-review comment line 2: a denylisted term (redacted here) — remove it",
          ],
        }),
      ),
    );
  });

  it("refuses the host named by its make and a home path", () => {
    const raw = JSON.stringify({
      comments: [{ body: "Runs on this Mac from /Users/someone/app.", kind: "explanation", line: 4, path: "a.ts" }],
    });
    expect(parseSelfReviewForm({ denylist: [], exactVoiceRules: [], privateTerms: [], raw })).toEqual(
      err(
        GithubVerbErrors.formInvalid({
          form: "--self-review",
          reasons: [
            'comments.0.body: self-review comment line 1: "this Mac" names the host by its make — write "this machine"',
            "comments.0.body: self-review comment line 1: an absolute home path (redacted here) — write a repository-relative path, or `$SLOPWEAVER_HOME/<path>` for the state home",
          ],
        }),
      ),
    );
  });
});

describe("selfReviewPublicationReasons", () => {
  it("returns nothing for clean prose, a quoted owner line and first person inside code", () => {
    expect(
      selfReviewPublicationReasons({
        denylist: [],
        form: {
          comments: [
            { body: "Keeps the retry beside the call.", kind: "explanation", line: 1, path: "a.ts" },
            { body: 'The owner asked "can we drop it" and `us` stays.', kind: "risk", line: 2, path: "a.ts" },
          ],
        },
        privateTerms: [],
      }),
    ).toEqual([]);
  });

  it("refuses a private term by class, never echoing it", () => {
    const privateTerms = unwrap(
      parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nplace\ti\tzorvane\tsynthetic\n" }),
    );
    expect(
      selfReviewPublicationReasons({
        denylist: [],
        form: { comments: [{ body: "Seen near Zorvane.", kind: "risk", line: 1, path: "a.ts" }] },
        privateTerms,
      }),
    ).toEqual([
      "comments.0.body: self-review comment line 1: a private place term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
    ]);
  });
});

describe("selfReviewAuthorshipRefusal", () => {
  it("accepts only an exact authenticated-author match", () => {
    expect(selfReviewAuthorshipRefusal({ authedUserId: 7, prAuthorId: 7 })).toBe(undefined);
    expect(selfReviewAuthorshipRefusal({ authedUserId: 7, prAuthorId: 8 })).toBe(
      "inline self-review comments may only be posted on the authenticated account's own pull request",
    );
  });

  it("fails closed when either side of the ownership proof is absent", () => {
    expect(selfReviewAuthorshipRefusal({ authedUserId: undefined, prAuthorId: 7 })).toContain(
      "self-review authorship cannot be checked",
    );
    expect(selfReviewAuthorshipRefusal({ authedUserId: 7, prAuthorId: undefined })).toContain(
      "self-review authorship cannot be checked",
    );
  });
});

describe("reviewThreadIdsFor", () => {
  it("maps returned comments to exact owning threads in comment order", () => {
    expect(
      reviewThreadIdsFor({
        commentIds: ["C2", "C1"],
        threads: [
          { commentIds: ["C1"], id: "T1", isResolved: false },
          { commentIds: ["C2", "reply"], id: "T2", isResolved: false },
        ],
      }),
    ).toEqual(ok(["T2", "T1"]));
  });

  it("refuses a comment id that is absent from the bounded readback", () => {
    expect(reviewThreadIdsFor({ commentIds: ["missing"], threads: [] })).toEqual(
      err(GithubVerbErrors.threadMappingNotOne({ commentId: "missing", count: 0 })),
    );
  });
});

describe("selfReviewDiffLineSet", () => {
  it("keeps context and added right-side lines, never a removed line", () => {
    const patch = ["@@ -1,3 +1,4 @@", " line1", "-line2 old", "+line2 new", "+line3 added", " line4"].join("\n");
    expect(selfReviewDiffLineSet({ patch })).toEqual(new Set([1, 2, 3, 4]));
  });

  it("restarts the right-side counter at each hunk header", () => {
    const patch = ["@@ -1,1 +1,1 @@", "-old", "+new", "@@ -10,1 +12,2 @@", " kept", "+added"].join("\n");
    expect(selfReviewDiffLineSet({ patch })).toEqual(new Set([1, 12, 13]));
  });
});

describe("selfReviewDiffAnchorRefusals", () => {
  const patch = ["@@ -1,2 +1,2 @@", " line1", "+line2"].join("\n");

  it("passes every comment whose path and line the diff exposes", () => {
    expect(
      selfReviewDiffAnchorRefusals({
        comments: [{ body: "b", kind: "explanation", line: 2, path: "a.ts" }],
        files: [{ patch, path: "a.ts" }],
      }),
    ).toEqual([]);
  });

  it("refuses a stale line and a file absent from the diff, each named", () => {
    expect(
      selfReviewDiffAnchorRefusals({
        comments: [
          { body: "b", kind: "explanation", line: 99, path: "a.ts" },
          { body: "c", kind: "explanation", line: 1, path: "missing.ts" },
        ],
        files: [{ patch, path: "a.ts" }],
      }),
    ).toEqual(["a.ts:99", "missing.ts:1"]);
  });

  it("refuses every line on a file GitHub reports with no patch (binary or rename-only)", () => {
    expect(
      selfReviewDiffAnchorRefusals({
        comments: [{ body: "b", kind: "explanation", line: 1, path: "image.png" }],
        files: [{ patch: undefined, path: "image.png" }],
      }),
    ).toEqual(["image.png:1"]);
  });
});

describe("githubSelfReviewDoorRequest", () => {
  it("records routing and counts without putting authored prose in the door ledger", () => {
    expect(
      githubSelfReviewDoorRequest({
        comments: 2,
        headSha: "abc",
        home: "/state",
        number: 7,
        previousThreads: 1,
        repo: "o/r",
      }),
    ).toEqual({
      action: { kind: "verb", noun: "github", verb: "pr self-review" },
      artifact: { comments: 2, headSha: "abc", number: 7, previousThreads: 1, repo: "o/r" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/state", requiresApproval: false },
    });
  });
});
