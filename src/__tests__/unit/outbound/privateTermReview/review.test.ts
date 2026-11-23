/**
 * THE PRIVATE-WORDS REVIEW end to end, over a throwaway home and a real packet repository. A meant match HOLDS a
 * write. The packet's review binds only to its own commits. A Claude fallback cannot be recorded by the session that
 * held the write, and a CLEAN receipt releases those exact bytes once. A BROKEN receipt keeps the write held. Every
 * term here is synthetic.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FORBIDDEN_IDENTIFIER_RULES } from "../../../../hygiene/forbiddenIdentifiers.js";
import { PRIVATE_TERMS_HEADER_V2, parsePrivateTerms } from "../../../../hygiene/privateTerms.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { CALENDAR_DESTINATION } from "../../../../outbound/calendar/writePrivacyPayload.js";
import type { PrivacyPolicy } from "../../../../outbound/privacyCheck.js";
import { type PrivateTermReviewPort, privateTermWriteRefusal } from "../../../../outbound/privateTermReview/gate.js";
import {
  decidePrivateTermWrite,
  type PrivateTermWriteInput,
  requestDigest,
  writeFindingsOf,
} from "../../../../outbound/privateTermReview/hold.js";
import { preparePrivateTermPacket, privateTermPacketFacts } from "../../../../outbound/privateTermReview/packet.js";
import {
  bindPrivateTermReview,
  decidePrivateTermReviewerFreshness,
  privateTermReceiptOf,
} from "../../../../outbound/privateTermReview/record.js";
import { readHold, releaseOrHold, writeReceipt } from "../../../../outbound/privateTermReview/store.js";
import {
  PRIVATE_TERM_REVIEW_PROPERTY,
  PRIVATE_TERM_REVIEW_PROPERTY_ID,
  type PrivateTermReviewReceipt,
  type PrivateTermWriteDraft,
} from "../../../../outbound/privateTermReview/types.js";
import type { PageReviewCandidate } from "../../../../pages/review.js";
import type { VisibleSupervisorSession } from "../../../../supervisor/session.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "private-term-review-"));
  homes.push(home);
  return home;
}

/** A policy over seven-cell rows; `meaning` empty leaves the row unmeant. */
function policyOf({ meaning }: { meaning: string }): PrivacyPolicy {
  const text = [
    PRIVATE_TERMS_HEADER_V2,
    `pt-00000000000a\tperson\ti\tquillfeather\t${meaning}\tthe acme calendar\trelay:acme-row`,
    "",
  ].join("\n");
  return {
    denylist: [],
    identifierRules: FORBIDDEN_IDENTIFIER_RULES,
    privateTerms: unwrap(parsePrivateTerms({ text })),
  };
}

const MEANT = policyOf({ meaning: "a colleague at acme" });

/** One calendar insert carrying `summary`, into `calendarId`. */
function writeOf({ summary, calendarId = "primary" }: { summary: string; calendarId?: string }): PrivateTermWriteInput {
  return {
    command: "calendar calendar.events.insert",
    contents: [{ locus: "calendar calendar.events.insert summary", text: summary }],
    destination: "the owner's Google Calendar",
    family: "google-calendar",
    request: {
      body: { summary },
      operation: "calendar.events.insert",
      target: { calendarId, conferenceDataVersion: 0, sendUpdates: "none" },
    },
  };
}

/** The draft a meant match is held as, for one write. */
function draftOfWrite({ write }: { write: PrivateTermWriteInput }): PrivateTermWriteDraft {
  const { decision } = decide({ policy: MEANT, write });
  if (decision.kind !== "review") {
    throw new Error(`expected a review, got ${decision.kind}`);
  }
  return decision.draft;
}

/** The decision for one write under one policy, the findings computed the way every guard computes them. */
function decide({ write, policy }: { write: PrivateTermWriteInput; policy: PrivacyPolicy }) {
  const findings = writeFindingsOf({ contents: write.contents, destination: CALENDAR_DESTINATION, policy });
  return {
    decision: decidePrivateTermWrite({ findings, policy, privacyDestination: CALENDAR_DESTINATION, write }),
    findings,
  };
}

/** The draft a meant match is held as. */
function draftOf({ summary }: { summary: string }): PrivateTermWriteDraft {
  return draftOfWrite({ write: writeOf({ summary }) });
}

const WRITER: VisibleSupervisorSession = { host: "claude-code", id: "a0000001-0000-4000-8000-000000000001" };
const REVIEWER: VisibleSupervisorSession = { host: "claude-code", id: "a0000002-0000-4000-8000-000000000002" };

/** A BROKEN receipt as a store would answer it. */
const BROKEN_RECEIPT: PrivateTermReviewReceipt = {
  holdId: "ph-000000000009",
  holdKey: "e".repeat(64),
  preparationId: "prep-0009",
  receiptId: "rc-0009",
  recordedAtIso: "2026-11-22T00:06:00.000Z",
  recordedBy: null,
  reviewer: "codex",
  reviewId: "r-0009",
  schemaVersion: 1,
  summary: "match 1 names the colleague outside where the meaning allows",
  verdict: "BROKEN",
};

/** A counter minting `ph-` ids. */
function holdIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `ph-${String(next).padStart(12, "0")}`;
  };
}

describe("decidePrivateTermWrite", () => {
  it("sends a write no row matches", () => {
    expect(decide({ policy: MEANT, write: writeOf({ summary: "lunch with acme" }) }).decision).toStrictEqual({
      kind: "send",
    });
  });

  it("refuses outright a match on a row with no meaning, naming the row by id", () => {
    const { decision } = decide({
      policy: policyOf({ meaning: "" }),
      write: writeOf({ summary: "lunch with Quillfeather" }),
    });
    expect(decision).toStrictEqual({ kind: "refuse-unmeant", termIds: ["pt-00000000000a"] });
  });

  it("holds a match on a meant row, and a reworded text is a different hold", () => {
    const first = draftOf({ summary: "lunch with Quillfeather" });
    expect(first.matches).toStrictEqual([
      { className: "person", content: 0, end: 23, line: 1, start: 11, termId: "pt-00000000000a" },
    ]);
    expect(first.terms[0]!.meaning).toBe("a colleague at acme");
    expect(draftOf({ summary: "lunch with Quillfeather!" }).holdKey).not.toBe(first.holdKey);
    expect(draftOf({ summary: "lunch with Quillfeather" }).holdKey).toBe(first.holdKey);
  });

  it("keys the hold on the whole request, so the same text bound for another calendar is a different hold", () => {
    const here = draftOfWrite({ write: writeOf({ summary: "lunch with Quillfeather" }) });
    const there = draftOfWrite({
      write: writeOf({ calendarId: "team@example.com", summary: "lunch with Quillfeather" }),
    });
    expect(there.contents).toStrictEqual(here.contents);
    expect(there.holdKey).not.toBe(here.holdKey);
    expect(here.requestSha256).toBe(
      requestDigest({ request: writeOf({ summary: "lunch with Quillfeather" }).request }),
    );
  });
});

describe("requestDigest", () => {
  it("ignores key order and tells bytes, strings, arrays and absence apart", () => {
    expect(requestDigest({ request: { a: 1, b: "x" } })).toBe(requestDigest({ request: { b: "x", a: 1 } }));
    const digests = [
      requestDigest({ request: { file: new Uint8Array([0x61]) } }),
      requestDigest({ request: { file: "a" } }),
      requestDigest({ request: { file: ["a"] } }),
      requestDigest({ request: { file: undefined } }),
      requestDigest({ request: {} }),
    ];
    expect(new Set(digests).size).toBe(5);
  });
});

describe("privateTermWriteRefusal", () => {
  const refusalFor = ({ review, summary }: { review: PrivateTermReviewPort | undefined; summary: string }) => {
    const write = writeOf({ summary });
    const { findings } = decide({ policy: MEANT, write });
    return privateTermWriteRefusal({
      findings,
      policy: MEANT,
      privacyDestination: CALENDAR_DESTINATION,
      review,
      write,
    });
  };

  it("lets a write no row matches through", () => {
    expect(refusalFor({ review: undefined, summary: "lunch with acme" })).toBe(undefined);
  });

  it("refuses a meant match outright where the guard holds no review port", () => {
    expect(refusalFor({ review: undefined, summary: "lunch with Quillfeather" })).toContain(
      "this write's door cannot hold a write for a review, so a match refuses outright",
    );
  });

  it("holds a meant match, printing the hold id and the prepare step, never the term", () => {
    const home = freshHome();
    const review: PrivateTermReviewPort = {
      home,
      releaseOrHold: ({ draft }) =>
        releaseOrHold({ draft, heldBy: WRITER, home, newHoldId: holdIds(), nowIso: "2026-11-22T00:00:00.000Z" }),
    };
    const lines = refusalFor({ review, summary: "lunch with Quillfeather" })!.split("\n");
    expect(lines.length).toBe(4);
    expect(lines[0]).toBe(
      "calendar calendar.events.insert held before sending: a private term matched on a row carrying the owner's meaning, so a review judges it in context.",
    );
    expect(lines[1]).toContain("calendar calendar.events.insert summary line 1: ");
    expect(lines[2]).toBe(
      `  hold ph-000000000001. Prepare its review: slopweaver private-terms review-prepare --hold ph-000000000001 --home ${home}`,
    );
    expect(lines.join("\n").toLowerCase()).not.toContain("quillfeather");
  });

  it("sends a meant match the store releases", () => {
    const review: PrivateTermReviewPort = {
      home: "/h",
      releaseOrHold: () => ok({ kind: "released", receiptId: "rc-0001" }),
    };
    expect(refusalFor({ review, summary: "lunch with Quillfeather" })).toBe(undefined);
  });

  it("names a BROKEN receipt the store answers with", () => {
    const review: PrivateTermReviewPort = {
      home: "/h",
      releaseOrHold: () => ok({ broken: [BROKEN_RECEIPT], holdId: "ph-000000000009", kind: "held" }),
    };
    expect(refusalFor({ review, summary: "lunch with Quillfeather" })!.split("\n").at(-1)).toBe(
      "  Receipt(s) rc-0009 came back BROKEN for exactly this write: reword it and run it again, which is a new hold.",
    );
  });

  it("refuses rather than sends when the review store throws", () => {
    const review: PrivateTermReviewPort = {
      home: "/h",
      releaseOrHold: () => {
        throw new Error("disk full");
      },
    };
    expect(refusalFor({ review, summary: "lunch with Quillfeather" })).toContain(
      "the review store could not hold it, so it is refused: disk full",
    );
  });
});

/** A review of `packet` as its record would state it. */
function candidateOf({
  packet,
  verdict,
  reviewer,
}: {
  packet: { repoRoot: string; baseSha: string; headSha: string; diffSha256: string };
  verdict: "CLEAN" | "BROKEN";
  reviewer: "codex" | "claude-fallback";
}): PageReviewCandidate {
  return {
    ...packet,
    completedAtIso: "2026-11-22T00:05:00.000Z",
    id: "r-0001",
    pass: "r1",
    property: { id: PRIVATE_TERM_REVIEW_PROPERTY_ID, statement: PRIVATE_TERM_REVIEW_PROPERTY },
    reviewer,
    summary: "match 1 names a colleague in the owner's own calendar, which the meaning allows",
    verdict,
  };
}

describe("the hold, the packet, the receipt and the release", () => {
  it("releases a CLEAN-reviewed write once, then holds the same bytes again", () => {
    const home = freshHome();
    const draft = draftOf({ summary: "lunch with Quillfeather" });
    const newHoldId = holdIds();
    const held = unwrap(releaseOrHold({ draft, heldBy: WRITER, home, newHoldId, nowIso: "2026-11-22T00:00:00.000Z" }));
    expect(held).toStrictEqual({ broken: [], holdId: "ph-000000000001", kind: "held" });

    const hold = unwrap(readHold({ holdId: "ph-000000000001", home }));
    const prepared = unwrap(
      preparePrivateTermPacket({
        createdAtIso: "2026-11-22T00:01:00.000Z",
        hold,
        home,
        preparationId: "prep-0001",
        preparedBy: WRITER,
      }),
    );
    const { preparation, repoRoot } = prepared;
    const facts = unwrap(
      privateTermPacketFacts({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot }),
    );
    const packet = { ...preparation, diffSha256: facts.diffSha256, repoRoot };
    const candidate = candidateOf({ packet, reviewer: "codex", verdict: "CLEAN" });
    const bound = unwrap(bindPrivateTermReview({ candidate, facts, hold, preparation }));
    const receipt = privateTermReceiptOf({
      candidate: bound,
      preparation,
      receiptId: "rc-0001",
      recordedAtIso: "2026-11-22T00:06:00.000Z",
      recordedBy: REVIEWER,
    });
    unwrap(writeReceipt({ home, receipt }));
    expect(unwrapErr(writeReceipt({ home, receipt: { ...receipt, receiptId: "rc-0002" } })).code).toBe(
      "ALREADY_RECORDED",
    );

    const resend = () => releaseOrHold({ draft, heldBy: WRITER, home, newHoldId, nowIso: "2026-11-22T00:07:00.000Z" });
    expect(unwrap(resend())).toStrictEqual({ kind: "released", receiptId: "rc-0001" });
    expect(unwrap(resend())).toStrictEqual({ broken: [], holdId: "ph-000000000001", kind: "held" });
  });

  it("never releases on a CLEAN Claude fallback receipt, even one recorded by another session", () => {
    const home = freshHome();
    const draft = draftOf({ summary: "lunch with Quillfeather" });
    const newHoldId = holdIds();
    unwrap(releaseOrHold({ draft, heldBy: WRITER, home, newHoldId, nowIso: "2026-11-22T00:00:00.000Z" }));
    const hold = unwrap(readHold({ holdId: "ph-000000000001", home }));
    const { preparation, repoRoot } = unwrap(
      preparePrivateTermPacket({
        createdAtIso: "2026-11-22T00:01:00.000Z",
        hold,
        home,
        preparationId: "prep-0003",
        preparedBy: WRITER,
      }),
    );
    const facts = unwrap(
      privateTermPacketFacts({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot }),
    );
    const candidate = candidateOf({
      packet: { ...preparation, diffSha256: facts.diffSha256, repoRoot },
      reviewer: "claude-fallback",
      verdict: "CLEAN",
    });
    const bound = unwrap(bindPrivateTermReview({ candidate, facts, hold, preparation }));
    const own = decidePrivateTermReviewerFreshness({
      heldBy: hold.heldBy,
      preparedBy: preparation.preparedBy,
      recordedBy: WRITER,
      reviewer: bound.reviewer,
    });
    expect(unwrapErr(own).code).toBe("NOT_FRESH");
    const receipt = privateTermReceiptOf({
      candidate: bound,
      preparation,
      receiptId: "rc-0003",
      recordedAtIso: "2026-11-22T00:06:00.000Z",
      recordedBy: REVIEWER,
    });
    unwrap(writeReceipt({ home, receipt }));

    const resent = releaseOrHold({ draft, heldBy: WRITER, home, newHoldId, nowIso: "2026-11-22T00:07:00.000Z" });
    expect(unwrap(resent)).toStrictEqual({ broken: [], holdId: "ph-000000000001", kind: "held" });
  });

  it("keeps a BROKEN-reviewed write held, naming the receipt", () => {
    const home = freshHome();
    const draft = draftOf({ summary: "lunch with Quillfeather" });
    unwrap(releaseOrHold({ draft, heldBy: WRITER, home, newHoldId: holdIds(), nowIso: "2026-11-22T00:00:00.000Z" }));
    const hold = unwrap(readHold({ holdId: "ph-000000000001", home }));
    const { preparation, repoRoot } = unwrap(
      preparePrivateTermPacket({
        createdAtIso: "2026-11-22T00:01:00.000Z",
        hold,
        home,
        preparationId: "prep-0002",
        preparedBy: WRITER,
      }),
    );
    const facts = unwrap(
      privateTermPacketFacts({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot }),
    );
    const candidate = candidateOf({
      packet: { ...preparation, diffSha256: facts.diffSha256, repoRoot },
      reviewer: "codex",
      verdict: "BROKEN",
    });
    const bound = unwrap(bindPrivateTermReview({ candidate, facts, hold, preparation }));
    const receipt = privateTermReceiptOf({
      candidate: bound,
      preparation,
      receiptId: "rc-0003",
      recordedAtIso: "2026-11-22T00:06:00.000Z",
      recordedBy: null,
    });
    unwrap(writeReceipt({ home, receipt }));
    const resent = unwrap(
      releaseOrHold({ draft, heldBy: WRITER, home, newHoldId: holdIds(), nowIso: "2026-11-22T00:07:00.000Z" }),
    );
    expect(resent).toStrictEqual({ broken: [receipt], holdId: "ph-000000000001", kind: "held" });
  });

  it("refuses to bind a review of other commits or another property", () => {
    const home = freshHome();
    const draft = draftOf({ summary: "lunch with Quillfeather" });
    unwrap(releaseOrHold({ draft, heldBy: WRITER, home, newHoldId: holdIds(), nowIso: "2026-11-22T00:00:00.000Z" }));
    const hold = unwrap(readHold({ holdId: "ph-000000000001", home }));
    const { preparation, repoRoot } = unwrap(
      preparePrivateTermPacket({
        createdAtIso: "2026-11-22T00:01:00.000Z",
        hold,
        home,
        preparationId: "prep-0003",
        preparedBy: WRITER,
      }),
    );
    const facts = unwrap(
      privateTermPacketFacts({ baseSha: preparation.baseSha, headSha: preparation.headSha, repoRoot }),
    );
    const packet = { ...preparation, diffSha256: facts.diffSha256, repoRoot };
    const good = candidateOf({ packet, reviewer: "codex", verdict: "CLEAN" });
    const wrongBase = unwrapErr(
      bindPrivateTermReview({ candidate: { ...good, baseSha: "0".repeat(40) }, facts, hold, preparation }),
    );
    expect(wrongBase.code).toBe("WRONG_PACKET");
    const wrongProperty = unwrapErr(
      bindPrivateTermReview({
        candidate: { ...good, property: { id: "something-else", statement: PRIVATE_TERM_REVIEW_PROPERTY } },
        facts,
        hold,
        preparation,
      }),
    );
    expect(wrongProperty.code).toBe("WRONG_PACKET");
    const otherHold = unwrapErr(
      bindPrivateTermReview({ candidate: good, facts, hold: { ...hold, holdKey: "f".repeat(64) }, preparation }),
    );
    expect(otherHold.code).toBe("WRONG_PACKET");
  });
});

describe("decidePrivateTermReviewerFreshness", () => {
  it("takes a Codex review as fresh whoever records it", () => {
    expect(
      unwrap(
        decidePrivateTermReviewerFreshness({ heldBy: null, preparedBy: null, recordedBy: null, reviewer: "codex" }),
      ),
    ).toBe("codex");
  });

  it("refuses a fallback when the write was held outside any visible session", () => {
    expect(
      unwrapErr(
        decidePrivateTermReviewerFreshness({
          heldBy: null,
          preparedBy: WRITER,
          recordedBy: REVIEWER,
          reviewer: "claude-fallback",
        }),
      ).code,
    ).toBe("NOT_FRESH");
  });

  it("refuses a fallback recorded where no session is named", () => {
    expect(
      unwrapErr(
        decidePrivateTermReviewerFreshness({
          heldBy: WRITER,
          preparedBy: WRITER,
          recordedBy: null,
          reviewer: "claude-fallback",
        }),
      ).code,
    ).toBe("NOT_FRESH");
  });
});
