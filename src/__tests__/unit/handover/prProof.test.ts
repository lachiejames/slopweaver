/**
 * The proof verdict per pull request: only a READ body lacking what the owner asked for accuses, and the sentence it leads
 * with names the gap.
 */
import { describe, expect, it } from "vitest";

import type { HisWords } from "../../../handover/hisWords.js";
import { currencyPullRequestsOf, proofAskedOn, proofAskedPrs, prProofOf } from "../../../handover/prProof.js";
import type { PrOnBoard } from "../../../handover/prSteers.js";

const ID = "acme/acme-admin#17564";

/** A quote of the owner's, synthetic words. */
function quote({ words, atIso, anchor }: { words: string; atIso: string; anchor: string }): HisWords {
  return { anchor, atIso, cut: "none", where: "console-voice", words };
}

const ASK = quote({
  anchor: "talk:proof",
  atIso: "2026-09-25T02:41:26.704Z",
  words: "it needs before and after proof with screenshots and links to the CI runs",
});
const LATER_DATADOG = quote({
  anchor: "talk:dd",
  atIso: "2026-10-01T00:00:00.000Z",
  words: "I want a Datadog link too",
});
const NOT_AN_ASK = quote({ anchor: "talk:ok", atIso: "2026-10-02T00:00:00.000Z", words: "the approach makes sense" });

/** A pull request on the board. */
function pr({ quotes }: { quotes: readonly HisWords[] }): PrOnBoard {
  return {
    identity: ID,
    rowSlugs: ["proof-row", "card-row"],
    steers: quotes.map((one) => ({ identity: ID, quote: one, rowSlug: "proof-row" })),
  };
}

describe("proofAskedOn", () => {
  it("folds every asking quote's kinds and quotes the latest", () => {
    expect(proofAskedOn({ pr: pr({ quotes: [ASK, LATER_DATADOG, NOT_AN_ASK] }) })).toEqual({
      anchor: "talk:dd",
      atIso: "2026-10-01T00:00:00.000Z",
      kinds: ["image", "run-link", "datadog"],
      rowSlug: "proof-row",
      words: "I want a Datadog link too",
    });
  });

  it("answers no ask when no quote asks for proof", () => {
    expect(proofAskedOn({ pr: pr({ quotes: [NOT_AN_ASK] }) })).toBe(undefined);
  });
});

describe("prProofOf", () => {
  const ask = proofAskedOn({ pr: pr({ quotes: [ASK] }) })!;

  it("leads with the gap off a read body carrying none of it", () => {
    expect(prProofOf({ ask, body: { body: "## Summary\nlifts the logger", kind: "read" }, identity: ID })).toEqual({
      ask,
      gap:
        'You asked for proof on acme/acme-admin#17564 on 2026-09-25 ("it needs before and after proof ' +
        'with screenshots and links to the CI runs") and its body still carries no screenshot, no Actions run link.',
      kind: "requested-and-unmet",
      missing: ["image", "run-link"],
    });
  });

  it("names only what the body still lacks", () => {
    const body = "![before](https://github.com/user-attachments/assets/a)";
    expect(prProofOf({ ask, body: { body, kind: "read" }, identity: ID })).toEqual(
      expect.objectContaining({ kind: "requested-and-unmet", missing: ["run-link"] }),
    );
  });

  it("is met when the body carries every kind asked", () => {
    const body = "![after](https://x/a.png)\nhttps://github.com/acme/acme-admin/actions/runs/42";
    expect(prProofOf({ ask, body: { body, kind: "read" }, identity: ID })).toEqual({ ask, kind: "requested-and-met" });
  });

  it("never accuses off a body it could not read", () => {
    expect(prProofOf({ ask, body: { kind: "unread", why: "rate limited" }, identity: ID })).toEqual({
      ask,
      kind: "body-unread",
      why: "rate limited",
    });
  });
});

describe("currencyPullRequestsOf", () => {
  const prs = new Map<string, PrOnBoard>([
    [ID, pr({ quotes: [ASK] })],
    ["o/r#1", { identity: "o/r#1", rowSlugs: ["other"], steers: [] }],
  ]);

  it("reads only the pull requests the owner asked proof on", () => {
    expect(proofAskedPrs({ prs }).map(({ pr: one }) => one.identity)).toEqual([ID]);
  });

  it("calls a pull request GitHub did not answer unread, and a whole failed read unread with its reason", () => {
    const asked = proofAskedPrs({ prs });

    expect(
      currencyPullRequestsOf({ asked, bodies: { bodies: new Map(), kind: "read" } }).map((one) => one.proof),
    ).toEqual([
      expect.objectContaining({ kind: "body-unread", why: "GitHub returned no pull request at that address" }),
    ]);
    expect(currencyPullRequestsOf({ asked, bodies: { kind: "unread", why: "no GitHub credential" } })).toEqual([
      {
        identity: ID,
        proof: expect.objectContaining({ kind: "body-unread", why: "no GitHub credential" }),
        rowSlugs: ["proof-row", "card-row"],
      },
    ]);
  });
});
