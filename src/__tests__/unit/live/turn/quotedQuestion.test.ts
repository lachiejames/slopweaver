import { describe, expect, it } from "vitest";

import { turnHeldForm } from "../../../../live/turn/answer.js";
import { turnBlockedForm } from "../../../../live/turn/blockedForm.js";
import { turnFailureForm } from "../../../../live/turn/failureForm.js";
import { questionForPlainField, slackUserIdsIn } from "../../../../live/turn/quotedQuestion.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";

/**
 * The live shape that produced this: ask `C0SYN000006`/`1789952379.135579`, whose stored text opens with a
 * colleague's tag and carries the bot's own further down. Two ids, exactly as the finding describes.
 */
const TWO_IDS = "<@U0SYN000002> makes sense. <@U0SYN000005> I want you to do the following";

const NAMES = { U0SYN000002: "Rosa", U0SYN000005: "acme-bot" };

/** The `tldr` of a failure card built over one question, parsed through the REAL schema the gate lives in. */
function failureTldr({ question, names }: { question: string; names?: Readonly<Record<string, string>> }): {
  readonly ok: boolean;
  readonly tldr: string;
} {
  const card = turnFailureForm({
    cause: "broke",
    modelId: "claude -p",
    question,
    reason: "the world model could not be read",
    ...(names === undefined ? {} : { names }),
  });
  return { ok: updateArtifactSchema.safeParse(card.artifact).success, tldr: card.artifact.tldr };
}

describe("questionForPlainField", () => {
  it("renders two raw user tags as the names the door resolved", () => {
    expect(questionForPlainField({ names: NAMES, question: TWO_IDS })).toBe(
      "@Rosa makes sense. @acme-bot I want you to do the following",
    );
  });

  it("renders an id the door could not place as the id itself, never a generic", () => {
    expect(questionForPlainField({ names: {}, question: "ping <@U0NOBODY> about it" })).toBe("ping @U0NOBODY about it");
  });

  it("prefers the angle form's own label on a channel, and falls back to its id", () => {
    expect(questionForPlainField({ question: "in <#C123|general> and <#C456>" })).toBe("in #general and #C456");
  });

  it("renders a broadcast and a user group without their markup", () => {
    expect(questionForPlainField({ question: "<!here> and <!subteam^S0ENG>" })).toBe("@here and @S0ENG");
  });

  it("keeps a linked URL's authored label, and strips a bare URL's scheme", () => {
    expect(
      questionForPlainField({ question: "see <https://example.com|the PR> and https://github.com/a/b/pull/1" }),
    ).toBe("see the PR and github.com/a/b/pull/1");
  });

  /**
   * Ordering, asserted rather than assumed: `scanRawMarkup` is ONE `matchAll` over one alternation, so its
   * spans arrive ascending and non-overlapping — which is the precondition the splice loop here relies on.
   * A scanner that ever grouped by kind instead would reassemble this sentence in the wrong order.
   */
  it("splices four spans of four different kinds back in the order they were written", () => {
    expect(
      questionForPlainField({
        names: NAMES,
        question: "<@U0SYN000002> is <#C9|deploys> broken? <!here> see <https://example.com|the run>",
      }),
    ).toBe("@Rosa is #deploys broken? @here see the run");
  });

  it("rewrites a link whose own label is a URL until no URL is left", () => {
    expect(questionForPlainField({ question: "see <https://a.test|https://b.test> now" })).toBe("see b.test now");
  });

  it("rewrites markup a resolved name carries, and still ends when that name tags its own id", () => {
    expect(questionForPlainField({ names: { U0LOOP: "<@U0LOOP>" }, question: "ask <@U0LOOP>" })).toBe("ask @@U0LOOP");
  });

  it("returns a question with no markup byte-identical, so no existing card moves", () => {
    const plain = "what did we decide about the staging pool?";
    expect(questionForPlainField({ names: NAMES, question: plain })).toBe(plain);
  });
});

describe("slackUserIdsIn", () => {
  it("names both ids, in the order they appear", () => {
    expect(slackUserIdsIn({ question: TWO_IDS })).toEqual(["U0SYN000002", "U0SYN000005"]);
  });

  it("reports one id once, however many times it was tagged", () => {
    expect(slackUserIdsIn({ question: "<@U1> ping <@U1> again" })).toEqual(["U1"]);
  });

  it("finds nothing in a question carrying no user tag", () => {
    expect(slackUserIdsIn({ question: "see <#C1> and <!here>" })).toEqual([]);
  });
});

describe("a quoted question never refuses the card that quotes it", () => {
  it("REFUSED the failure card before this fix — the exact bytes that did it", () => {
    // The falsifiable witness for the whole change: the SAME question, fed to the SAME builder, is the input
    // that made the notice unpostable. `names` resolves it; the case below proves an empty map does too.
    const { ok, tldr } = failureTldr({ names: NAMES, question: TWO_IDS });
    expect(ok).toBe(true);
    expect(tldr).toBe(
      'Something broke while I was answering "@Rosa makes sense. @acme-bot I want you to do the following". Nothing was posted.',
    );
  });

  it("passes the gate with NO names at all, so a door that resolved nothing still posts", () => {
    const { ok, tldr } = failureTldr({ question: TWO_IDS });
    expect(ok).toBe(true);
    expect(tldr).toContain("@U0SYN000002 makes sense. @U0SYN000005");
  });

  it("passes the gate on a question carrying a bare URL, a channel and a broadcast", () => {
    const { ok } = failureTldr({ question: "look at https://github.com/a/b/pull/1 in <#C1> <!here>" });
    expect(ok).toBe(true);
  });

  it("holds for the HELD notice too, which quotes the question the same way", () => {
    const card = turnHeldForm({
      modelId: "claude -p",
      names: NAMES,
      queued: { id: "q-1" },
      question: TWO_IDS,
      reason: "it needed a second look.",
    });
    expect(updateArtifactSchema.safeParse(card.artifact).success).toBe(true);
    expect(card.artifact.tldr).toBe(
      "Held for review, not sent: @Rosa makes sense. @acme-bot I want you to do the following",
    );
  });

  it("holds for the BLOCKED notice too", () => {
    const card = turnBlockedForm({
      modelId: "claude -p",
      names: NAMES,
      need: "sign-in",
      question: TWO_IDS,
      what: "sign in to Google Cloud on this machine.",
    });
    expect(updateArtifactSchema.safeParse(card.artifact).success).toBe(true);
    expect(card.artifact.tldr).toBe(
      'Still on "@Rosa makes sense. @acme-bot I want you to do the following". One step needs the owner before I can finish it.',
    );
  });

  it("still yields a non-empty tldr when the question is nothing BUT markup", () => {
    const { ok, tldr } = failureTldr({ names: NAMES, question: "<@U0SYN000002>" });
    expect(ok).toBe(true);
    expect(tldr).toBe('Something broke while I was answering "@Rosa". Nothing was posted.');
  });

  /**
   * The ordering rule, asserted rather than trusted: resolution runs BEFORE the clamp. Clamping first would
   * cut `<@U0SYN000002>` mid-token into a span `scanRawMarkup` no longer matches, so the card would PASS the
   * gate carrying an unreadable fragment — a silent wrong where the refusal was at least loud.
   */
  it("resolves before it clamps, so a long question is shortened as PROSE", () => {
    const card = turnFailureForm({
      cause: "broke",
      modelId: "claude -p",
      names: NAMES,
      question: `<@U0SYN000002> ${"q".repeat(400)}`,
      reason: "the world model could not be read",
    });
    expect(updateArtifactSchema.safeParse(card.artifact).success).toBe(true);
    expect(card.artifact.tldr.startsWith('Something broke while I was answering "@Rosa qqq')).toBe(true);
    expect(card.clamped).toEqual(["tldr"]);
  });
});
