/*
 * The gate on a hand step asking the owner to react to a message drafted as the owner — `src/hand/draftAsOwner.ts` — and its
 * console restatement, `site/lib/draftAsOwner.ts`, run over ONE corpus so the two copies of the criterion cannot drift.
 *
 * On a steer row about drafted replies, the owner expected them to show on the card itself.
 * The first case is a sentence in that step's shape.
 */
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { draftAsOwnerPhrase, UNDRAWN_DRAFT_HATCH, undrawnDraftVerdict } from "../../../hand/draftAsOwner.js";

/** The step the owner opened, in the hands register's shape with invented refs. */
const ROSA =
  "Read the two replies to Rosa drafted as you on #101 and #102, and say whether to post them and close #103";

/** Every text, and the phrase the criterion finds in it — `undefined` where it must find none. */
const CORPUS: readonly (readonly [string, string | undefined])[] = [
  [ROSA, "drafted as you"],
  ["Read the reply WRITTEN AS YOU in the ISO thread", "WRITTEN AS YOU"],
  ["Archive Alice's draft reply after she sends it", undefined],
  ["Read the notes written as you speak, and correct the transcript", undefined],
  ["Is it worded as you said it", undefined],
  ["Approve your draft reply-handling policy before publishing it to Support", undefined],
  ["Read your draft post-mortem", undefined],
  ["Review your draft message retention policy before publishing it to Support", undefined],
  ["Say whether your draft reply to Jonah goes out", undefined],
  ["Review the employment contract drafted under your name and sign it", undefined],
  ["Check the migration runbook written as you and I discussed, then approve it", undefined],
  ["Check the migration runbook written as you and me agreed, then approve it", undefined],
  ["Review the migration runbook written as you and Seth discussed, then approve it", undefined],
  ["Is the announcement written as you, Seth, and I discussed ready to send?", undefined],
  ["Is the announcement written as you, Seth and Jo agreed ready to send?", undefined],
  ["Is the announcement written as you, <@U123>, and I discussed ready to send?", undefined],
  ["The payments-channel post is drafted as you and UNSENT on the page", "drafted as you"],
  ["The reply is drafted as you, and unsent", "drafted as you"],
  ["The reply is drafted as you, unsent on the page", "drafted as you"],
  ["The reply is written as you and not yet sent", "written as you"],
  ["Post the reply drafted as you.", "drafted as you"],
  ["The reply drafted as you", "drafted as you"],
  ["A reply drafted as you, to Rosa", "drafted as you"],
  ["Say whether the draft reply to Jonah goes out", undefined],
  ["Review draft PR #1403 before it lands", undefined],
  ["Read the draft pull request", undefined],
  ["Read the draft postmortem page", undefined],
  ["Sign in to Google Cloud so the monitor deploy can finish", undefined],
  ["A reply drafted by the bot", undefined],
];

/** The console's copy of the criterion, loaded at run time: `src` cannot import `site/` statically. */
async function consolePhrase(): Promise<(args: { texts: readonly (string | undefined)[] }) => string | undefined> {
  const path = fileURLToPath(new URL("../../../../site/lib/draftAsOwner.ts", import.meta.url));
  const module = (await import(path)) as {
    draftAsOwnerPhrase: (args: { texts: readonly (string | undefined)[] }) => string | undefined;
  };
  return module.draftAsOwnerPhrase;
}

describe("draftAsOwnerPhrase", () => {
  it("finds the phrase in each text of the corpus, and none where there is none", () => {
    expect(CORPUS.length).toBeGreaterThan(0);
    expect(CORPUS.map(([text]) => draftAsOwnerPhrase({ texts: [text] }))).toEqual(CORPUS.map(([, phrase]) => phrase));
  });

  it("agrees with the console's copy on every text of the corpus", async () => {
    const phrase = await consolePhrase();
    expect(CORPUS.map(([text]) => phrase({ texts: [text] }))).toEqual(CORPUS.map(([, found]) => found));
  });

  it("reads `where` when `what` says nothing, and skips an absent field", () => {
    expect(draftAsOwnerPhrase({ texts: ["Pick one", undefined, "the reply drafted as you, in the DM"] })).toBe(
      "drafted as you",
    );
  });
});

describe("undrawnDraftVerdict", () => {
  const base = { command: "slopweaver hand post", draftIds: [], env: {}, texts: [ROSA, undefined] } as const;

  it("refuses the step the owner opened: it names no parked draft and opens no ask", () => {
    const verdict = undrawnDraftVerdict({ ...base, opened: "no-ask" });
    expect(verdict.kind).toBe("refused");
    const lines = (verdict as { lines: readonly string[] }).lines.join("\n");
    expect(lines).toContain(
      "slopweaver hand post blocked because the step asks the owner to react to a message drafted as the owner and carries no draft the card can draw",
    );
    expect(lines).toContain('it says "drafted as you", and it names no parked draft and opens no ask');
    expect(lines).toContain("SLOPWEAVER_ALLOW_UNDRAWN_DRAFT=1 slopweaver hand post");
  });

  it("refuses a step whose opened ask offers no message, and says that is why", () => {
    const verdict = undrawnDraftVerdict({ ...base, opened: "offers-none" });
    expect((verdict as { lines: readonly string[] }).lines[0]).toContain(
      "it names no parked draft, and the ask it opens offers no message",
    );
  });

  it("admits the step when its ask offers the message, or it names a parked draft", () => {
    expect(undrawnDraftVerdict({ ...base, opened: "offers-message" })).toEqual({ kind: "ok" });
    expect(undrawnDraftVerdict({ ...base, draftIds: ["sd-1fb4cd0e"], opened: "no-ask" })).toEqual({ kind: "ok" });
  });

  it("admits a step that names no draft as the owner, whatever it opens", () => {
    expect(undrawnDraftVerdict({ ...base, opened: "no-ask", texts: ["Review draft PR #1403"] })).toEqual({
      kind: "ok",
    });
  });

  it("admits the step past the hatch, and says its card will show the draft missing", () => {
    expect(undrawnDraftVerdict({ ...base, env: { [UNDRAWN_DRAFT_HATCH]: "1" }, opened: "no-ask" })).toEqual({
      kind: "hatched",
      lines: [
        `recorded past SLOPWEAVER_ALLOW_UNDRAWN_DRAFT=1: it says "drafted as you" and carries no draft, so its card ` +
          "will say the draft is missing",
      ],
    });
  });
});
