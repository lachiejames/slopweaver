/**
 * `reviewerPacket` over an answer that declares a supersession — the reviewer is asked for the second
 * declaration, naming the exact message, and a follow-up that declared nothing says nothing about deleting.
 * Pure: every case is a literal in, a string out.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { reviewerPacket } from "../../../../../live/turn/review.js";
import { parseAnswerArm } from "../../../../../outbound/assistant/answerForm.js";
import { DECISION, RECORD } from "./harness.js";

/*
 * The DELETION duty in the packet the production reviewer actually reads.
 *
 * MEASURED: every test of the
 * supersession lane supplied the reviewer's warrant itself, so all of them passed while `reviewerPacket`
 * never asked a reviewer to produce one — and a reviewer obeying "write EXACTLY this shape" returned a
 * verdict with no `supersession`, the correction posted, and the delete refused on `UNREVIEWED` with both
 * answers left standing. These cases are over the REAL generator, which is where that gap lived.
 *
 * They assert the RENDERED example rather than a parsed one, and that is the right instrument rather than a
 * weaker one: the example is a template — `readAtIso` is the words "the instant you ran it, ISO 8601" — so
 * it deliberately does not survive the door's runtime parser, and what a reviewer copies is these bytes.
 */
describe("reviewerPacket — the supersession the composer declared", () => {
  const SUPERSEDED_TS = "1790054484.916599";
  // A SECOND declaration, and the reason it exists: mutating `targetTs: supersedes` to the one
  // literal this file used and every assertion still passed. One timestamp cannot tell a threaded value
  // apart from a constant that happens to equal it, so each binding below is checked against both.
  const OTHER_TS = "1790061193.442100";
  const warrantBlockFor = ({ ts }: { ts: string }) =>
    [
      '  "supersession": {',
      '    "reason": "why this answer REPLACES a central claim of that one — or, with `warranted` false, why it only adds",',
      `    "targetTs": "${ts}",`,
      '    "warranted": true',
      "  },",
    ].join("\n");

  const answerDeclaring = ({ supersedes }: { supersedes: string | undefined }) =>
    unwrap(
      parseAnswerArm({
        context: { repos: [] },
        raw: {
          body: [{ runs: [{ text: "4.2.1 is the affected version", type: "text" }], type: "paragraph" }],
          citations: [{ id: "1", label: "[1]", url: "https://example.slack.com/archives/C1/p1785000000000100" }],
          grounding: {
            evidence: {
              consultedEmpty: [],
              couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
              premiseChecks: [],
              read: [{ label: "the acme-bugs thread" }],
            },
            kind: "conversation",
            provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
            reason: "the thread says it",
          },
          images: [],
          index: [
            [
              { text: "affected version", type: "text" },
              { citationId: "1", type: "citation" },
            ],
          ],
          kind: "answer",
          lead: "4.2.1 is the affected version, not 4.2.0",
          measurements: [],
          ...(supersedes === undefined ? {} : { supersedes }),
        },
      }),
    );

  const packetFor = ({ supersedes }: { supersedes: string | undefined }) =>
    reviewerPacket({
      answer: answerDeclaring({ supersedes }),
      answerDigest: RECORD.answerDigest,
      askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
      askPermalink: undefined,
      authorSession: RECORD.authorSession,
      briefPath: "/tmp/brief.json",
      images: [],
      carriedReads: [],
      carriedSettled: [],
      changes: undefined,
      clock: { reviewStartedAt: undefined, spawnedAt: RECORD.spawnedAt },
      carriedUnresolved: [],
      decision: DECISION,
      ownerDirectiveCount: 0,
      question: "actually it's 4.2.1 that's affected isn't it?",
      reviewerSession: RECORD.reviewerSession,
      round: 1,
      verdictPath: "/tmp/v.json",
      voicePrinciples: [],
    });

  it("asks the reviewer for the second declaration, naming the exact message to open", () => {
    const packet = packetFor({ supersedes: SUPERSEDED_TS });

    expect(packet).toContain(`THIS ANSWER DECLARES A SUPERSESSION. Its form names \`${SUPERSEDED_TS}\``);
    expect(packet).toContain(`\`targetTs\` exactly \`${SUPERSEDED_TS}\``);
    expect(packet).toContain("posting the correction does NOT remove that message");
    expect(packet).toContain("`warranted: false` is a real answer");
    expect(packet).toContain("the delete is refused on it");
  });

  it("names the ts THIS form declared, in the duty and in the example — two asks, two targets", () => {
    expect(packetFor({ supersedes: OTHER_TS })).toContain(`Its form names \`${OTHER_TS}\``);
    expect(packetFor({ supersedes: OTHER_TS })).toContain(`\`targetTs\` exactly \`${OTHER_TS}\``);
    expect(packetFor({ supersedes: SUPERSEDED_TS })).toContain(warrantBlockFor({ ts: SUPERSEDED_TS }));
    expect(packetFor({ supersedes: OTHER_TS })).toContain(warrantBlockFor({ ts: OTHER_TS }));
  });

  it("says nothing at all about deleting when the follow-up declared nothing", () => {
    // Falsifiable against the two cases above: the same generator over the same answer, changed only in
    // `supersedes`, prints both of these — so an absence here is the declaration's doing, not the
    // assertion's. The shape is still shown, so this is not a packet that simply failed to render.
    const packet = packetFor({ supersedes: undefined });

    expect(packet).toContain("Write EXACTLY this shape");
    expect(packet.includes("DECLARES A SUPERSESSION")).toBe(false);
    expect(packet.includes('"supersession"')).toBe(false);
  });
});
