import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { dripArtifactSchema, plainArtifactSchema } from "../../../../outbound/artifact/asMeSchema.js";

const BOUNDS = { maxMessages: 3, messageVisibleMax: 40 };

/** One message carrying a single text run — the common shape, stated once. */
function message({ text }: { text: string }) {
  return { runs: [{ text, type: "text" }] };
}

describe("dripArtifactSchema", () => {
  it("names the one-card form on a SOLE message's newline, because a split is not what that caller wants", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "pls review\nand merge" })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain('send it as `{"kind":"one-card"}`');
  });

  it("WITHHOLDS the one-card hint from a multi-message drip, where the split it names is the right fix", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "one\ntwo" }), message({ text: "three" })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).not.toContain("one-card");
  });

  it("accepts a drip of short messages and returns it parsed", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "Shipped the thing." }), message({ text: "Docs to follow." })],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.messages.length : 0).toBe(2);
  });

  it("rejects a message over the OPERATOR'S cap, naming the measurement and the cap", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "x".repeat(41) })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("41 visible chars, over the 40 cap");
  });

  it("names --body on a width refusal, because a ONE-message drip is exactly what it replaces", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "x".repeat(41) })],
    });

    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain(
      "or send it as one plain message with `--body`, which applies neither rule — only the target platform's own maximum length. Private exact voice rules still apply at the send seam,",
    );
  });

  it("withholds --body from a MULTI-message drip, which it would silently collapse to one", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "x".repeat(41) }), message({ text: "the second thought" })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).not.toContain("--body");
  });

  it("leaves --body out of refusals it cannot remedy, so the advice never sends someone in a circle", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [{ runs: [{ label: "the PR", type: "link", url: "not-a-url" }] }],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" ")).not.toContain("--body");
  });

  it("bounds by VISIBLE length, so a long URL costs only its label", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [{ runs: [{ label: "the PR", type: "link", url: `https://example.com/${"a".repeat(300)}` }] }],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects more messages than the operator allows", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "a" }), message({ text: "b" }), message({ text: "c" }), message({ text: "d" })],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an empty drip", () => {
    expect(dripArtifactSchema(BOUNDS).safeParse({ kind: "drip", messages: [] }).success).toBe(false);
  });

  it("rejects a newline inside a message — the gap between messages IS the spacing", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "one\ntwo" })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("NO internal line breaks");
  });

  it("rejects a newline in a LINK LABEL too, not only in a text run", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [{ runs: [{ label: "the\nPR", type: "link", url: "https://example.com/1" }] }],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("NO internal line breaks");
  });

  it("names --body on a newline refusal too — the same one-message remedy, reached the other way", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "one\ntwo" })],
    });

    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain(
      "or send it as one plain message with `--body`, which applies neither rule — only the target platform's own maximum length. Private exact voice rules still apply at the send seam,",
    );
  });

  it("rejects a carriage return as well as a newline", () => {
    expect(dripArtifactSchema(BOUNDS).safeParse({ kind: "drip", messages: [message({ text: "a\rb" })] }).success).toBe(
      false,
    );
  });

  it("makes a CITATION chip unrepresentable — citations are bot-only", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [{ runs: [{ citationId: "c1", type: "citation" }] }],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts mentions, groups, links, broadcasts and styled text — the human lane keeps them all", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [
        {
          runs: [
            { person: "ada", type: "mention" },
            { handle: "engineers", type: "group" },
          ],
        },
        { runs: [{ range: "here", type: "broadcast" }] },
        { runs: [{ bold: true, text: "shipped", type: "text" }] },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("does NOT scan the words — an em-dash and markdown-looking text both pass", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "shipped — *finally*" })],
    });

    expect(parsed.success).toBe(true);
  });

  it("reports EVERY violation in one pass rather than stopping at the first", () => {
    const parsed = dripArtifactSchema(BOUNDS).safeParse({
      kind: "drip",
      messages: [message({ text: "x".repeat(50) }), message({ text: "y".repeat(60) })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? 0 : parsed.error.issues.length).toBe(2);
  });

  it("rejects the bot's `update` kind — the two artifacts are not interchangeable", () => {
    expect(dripArtifactSchema(BOUNDS).safeParse({ detail: [], kind: "update", tldr: "x" }).success).toBe(false);
  });
});

describe("dripArtifactSchema — a SOLE message's own cap", () => {
  it("bounds a sole message by soleMessageVisibleMax, not messageVisibleMax", () => {
    const parsed = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 10, soleMessageVisibleMax: 40 }).safeParse({
      kind: "drip",
      messages: [message({ text: "x".repeat(40) })],
    });

    expect(parsed.success).toBe(true);
  });

  it("still refuses a sole message once it clears soleMessageVisibleMax, naming that cap", () => {
    const parsed = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 10, soleMessageVisibleMax: 40 }).safeParse({
      kind: "drip",
      messages: [message({ text: "x".repeat(41) })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("41 visible chars, over the 40 cap");
  });

  it("leaves messageVisibleMax governing every message once there is more than one, even with soleMessageVisibleMax set wide", () => {
    const parsed = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 10, soleMessageVisibleMax: 40 }).safeParse({
      kind: "drip",
      messages: [message({ text: "x".repeat(11) }), message({ text: "y" })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("11 visible chars, over the 10 cap");
  });

  it("falls back to messageVisibleMax for a sole message when soleMessageVisibleMax is left unset", () => {
    // Every caller that predates this field must keep behaving exactly as before.
    const parsed = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 10 }).safeParse({
      kind: "drip",
      messages: [message({ text: "x".repeat(11) })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("11 visible chars, over the 10 cap");
  });
});

describe("plainArtifactSchema — the escape hatch", () => {
  it("accepts newlines, markdown and raw mention syntax, all of which the drip form refuses", () => {
    const parsed = plainArtifactSchema({ maxChars: 100 }).safeParse({
      kind: "plain",
      text: "line one\n\nline two *bold* <@U0ADA>",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.text : "").toBe("line one\n\nline two *bold* <@U0ADA>");
  });

  it("applies NO length preference — only the mechanical platform ceiling the caller supplies", () => {
    expect(plainArtifactSchema({ maxChars: 100 }).safeParse({ kind: "plain", text: "x".repeat(100) }).success).toBe(
      true,
    );
    expect(plainArtifactSchema({ maxChars: 100 }).safeParse({ kind: "plain", text: "x".repeat(101) }).success).toBe(
      false,
    );
  });

  it("rejects an empty body", () => {
    expect(plainArtifactSchema({ maxChars: 100 }).safeParse({ kind: "plain", text: "" }).success).toBe(false);
  });
});

describe("the provider boundary", () => {
  const artifactDir = join(import.meta.dirname, "../../../../outbound/artifact");

  it("imports NOTHING from a platform SDK, so PR6/7/8 can reuse the schema without depending on Slack", () => {
    const offenders = readdirSync(artifactDir)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) => {
        const source = readFileSync(join(artifactDir, file), "utf8");
        return [...source.matchAll(/from\s+"(@(?:slack|linear|notionhq|octokit)\/[^"]+)"/g)].map(
          (match) => `${file} imports ${String(match[1])}`,
        );
      });

    expect(offenders).toEqual([]);
  });

  it("never mentions a platform-specific block type, which is how a leak usually starts", () => {
    const offenders = readdirSync(artifactDir)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) =>
        /\b(KnownBlock|RichTextBlock|MessageAttachment|chat\.postMessage)\b/.test(
          readFileSync(join(artifactDir, file), "utf8"),
        ),
      );

    expect(offenders).toEqual([]);
  });
});

describe("the escape-hatch sentence names a bound rather than promising acceptance", () => {
  it("does not claim a plain body is unbounded, because the platform ceiling still applies", () => {
    // A sole message wide enough to breach Slack's own 40,000-character maximum still gets the hint, and
    // that is correct ONLY because the hint promises the two drip rules are gone rather than promising the
    // send will succeed. An adversarial pass falsified the stronger wording with exactly this input.
    const parsed = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 300 }).safeParse({
      kind: "drip",
      messages: [message({ text: "x".repeat(40_001) })],
    });
    const complaint = parsed.success ? "" : parsed.error.issues[0]!.message;

    expect(complaint).toContain("only the target platform's own maximum length");
    // …and names the two checks that DO survive the switch, so following the hint cannot trade one refusal
    // for a surprise one. The mention check is real behaviour, proved in
    // `../../cli/commands/slack/dripShell/bodyChecks.test.ts`; this asserts the sentence keeps telling the truth about it.
    expect(complaint).toContain("every raw `<@U…>` in it names somebody the roster knows");
    expect(
      plainArtifactSchema({ maxChars: 40_000 }).safeParse({ kind: "plain", text: "x".repeat(40_001) }).success,
    ).toBe(false);
  });
});

describe("the escape hatch is offered only when a plain body could carry the same message", () => {
  it("withholds --body from a sole message built from a LINK, which a plain body cannot carry", () => {
    // Found by an adversarial pass: an over-wide link label tripped the width rule and was handed the
    // `--body` hint, and following it could only have flattened the link into text and lost its target.
    const parsed = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 40 }).safeParse({
      kind: "drip",
      messages: [{ runs: [{ label: "x".repeat(41), type: "link", url: "https://example.com/1" }] }],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).not.toContain("--body");
  });

  it("withholds --body from a sole message carrying a MENTION, whose identity a bare string cannot hold", () => {
    const parsed = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 5 }).safeParse({
      kind: "drip",
      messages: [{ runs: [{ person: "someone-with-a-long-key", type: "mention" }] }],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).not.toContain("--body");
  });

  it("withholds --body from a sole message whose text is STYLED, since the span would be lost", () => {
    const parsed = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 40 }).safeParse({
      kind: "drip",
      messages: [{ runs: [{ bold: true, text: "x".repeat(41), type: "text" }] }],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).not.toContain("--body");
  });
});

describe("the hint claims the rules are gone, never that the message is unchanged", () => {
  it("still offers --body for unstyled text carrying raw platform markup, and promises only the rules", () => {
    // Found adversarially: text that is INERT inside a structured run GAINS meaning through the plain lane,
    // which parses it. The hint is still correct here because it claims only that the width and newline
    // rules do not apply — it is a pointer to a flag, not a certificate that the result is identical.
    // Pinning that wording is what stops a future edit quietly upgrading it back into an equivalence claim.
    //
    // An asterisk pair rather than the `<@U…>` this case was originally written against: raw mention markup
    // no longer reaches this refusal at all, because `../../../../outbound/artifact/typedRuns.ts` converts
    // it to a `mention` run before the width is measured — at which point the message is no longer
    // all-plain-text and the hint is withheld for the OTHER reason the hint has. Emphasis markup has no
    // typed run to become, so it is still the live example of the property being pinned.
    const parsed = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 40 }).safeParse({
      kind: "drip",
      messages: [message({ text: `*shipped* ${"x".repeat(41)}` })],
    });
    const complaint = parsed.success ? "" : parsed.error.issues[0]!.message;

    expect(complaint).toContain("which applies neither rule");
    expect(complaint).not.toContain("same message");
    expect(complaint).not.toContain("identical");
  });
});
