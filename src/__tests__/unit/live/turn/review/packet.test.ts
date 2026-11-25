/**
 * `reviewerPacket` — the packet a reviewer reads: its section order, the standing claims every verdict
 * classifies, the voice principles, and the exact parties and paths the verdict must carry.
 * Pure: every case is a literal in, a string out.
 */
import { describe, expect, it } from "vitest";

import { reviewerPacket } from "../../../../../live/turn/review.js";
import { ANSWER, DECISION, RECORD } from "./harness.js";

describe("reviewerPacket", () => {
  const packet = reviewerPacket({
    answer: ANSWER,
    answerDigest: RECORD.answerDigest,
    askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
    askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
    authorSession: RECORD.authorSession,
    briefPath: "/tmp/brief.json",
    images: [],
    carriedReads: [],
    carriedSettled: [],
    changes: undefined,
    clock: { reviewStartedAt: undefined, spawnedAt: RECORD.spawnedAt },
    carriedUnresolved: [],
    decision: DECISION,
    ownerDirectiveCount: 2,
    question: "why did the staging pool exhaust?",
    reviewerSession: RECORD.reviewerSession,
    round: 1,
    verdictPath: RECORD.verdictPath,
    voicePrinciples: [
      "no em-dashes anywhere in visible prose",
      "casual lowercase register, consistent across the thread",
    ],
  });

  it("names every mined principle and makes voice a material claim — a rule pointed at is a rule not checked", () => {
    expect(packet).toContain(
      "## 9. The MINED voice principles the answer must obey — named, so each is a claim you classify",
    );
    expect(packet).toContain("1. no em-dashes anywhere in visible prose");
    expect(packet).toContain("2. casual lowercase register, consistent across the thread");
    expect(packet).toContain("`the answer obeys every voice rule above`, `impact`");
    expect(packet).toContain("two consecutive bot messages in different registers");
    expect(packet).toContain("the grounding's evidence labels (`read`, `consultedEmpty`) and `couldNotSee` text");
  });

  it("tells the reviewer the exact vocabulary rules are NOT its job — the seven-round deadlock", () => {
    // `C0SYN000001/1790048248.995219`: a verdict recorded `rulesChecked: 4, violations: []` and the door then
    // refused those same bytes on a word rule the packet had never named. The packet has to say which set it
    // is putting in front of the reviewer, or `rulesChecked` reads as an attestation about the enforced one.
    expect(packet).toContain("They are NOT the");
    expect(packet).toContain("operator's exact vocabulary rules");
    expect(packet).toContain("run over these exact");
    expect(packet).toContain("clean verdict here can no longer be voided by one");
    expect(packet).toContain("`rulesChecked` is how many MINED PRINCIPLES are");
    expect(packet).toContain("listed above (2) and nothing else");
  });

  it("forbids a `broken` verdict for what an answer is ABOUT — a standing rule", () => {
    expect(packet).toContain("**A correct answer is NEVER `broken` for what it is ABOUT.**");
    expect(packet).toContain("ranks, compares or names colleagues");
    expect(packet).toContain("tact is the ASKER's onus");
    expect(packet).toContain("Judge whether the ranking is TRUE and cited; never");
  });

  it("makes a leaked confidence or a reader shown what they could not reach `broken`, beside the answer-scope rule", () => {
    expect(packet).toContain("**Who may SEE a fact is a different question, and it CAN be `broken`**");
    expect(packet).toContain("unchecked access is not permission");
    expect(packet).toContain("showing a reader access-controlled");
    expect(packet).toContain("without the owner's yes on THIS reply");
    expect(packet).toContain("decision (they will invite pilot members personally) is fine to share");
    expect(packet).toContain("what an answer is ABOUT never counts.");
    expect(packet.indexOf("NEVER `broken` for what it is ABOUT")).toBeLessThan(packet.indexOf("Who may SEE a fact"));
  });

  it("carries the answer-scope rule to a reviewer with NO voice profile loaded — it is not a voice rule", () => {
    const unprofiled = reviewerPacket({
      answer: ANSWER,
      answerDigest: RECORD.answerDigest,
      askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
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
      question: "who has been slowest to close out their assigned tickets?",
      reviewerSession: RECORD.reviewerSession,
      round: 1,
      verdictPath: RECORD.verdictPath,
      voicePrinciples: [],
    });

    expect(unprofiled).toContain("- none loaded — only the standing public voice rules apply.");
    expect(unprofiled).toContain("**A correct answer is NEVER `broken` for what it is ABOUT.**");
    expect(unprofiled).toContain("Judge whether the ranking is TRUE and cited; never");
  });

  it("puts what the question literally asked for FIRST, before the question itself", () => {
    // The priority reorder IS the fix for the six-round loop, so the position is the assertion: a reviewer
    // that reaches "did this hand back what was asked for" after eight sections has already spent the round.
    const deliverables = packet.indexOf("## 1. What the question literally asked for — CHECK THIS FIRST");
    const question = packet.indexOf("## 2. The question, as asked");

    expect(deliverables).toBeGreaterThan(-1);
    expect(question).toBeGreaterThan(deliverables);
  });

  it("makes a missing artifact outrank every nit, and unrequested scope grounds for nothing", () => {
    expect(packet).toContain("outranks every fine-detail correctness nit");
    expect(packet).toContain("Analysis the question did NOT request is not grounds for `broken` or");
  });

  it("names the deliverable claim as the FIRST of the two standing claims in every verdict", () => {
    expect(packet).toContain(
      "answer delivers every artifact the question asked for` — classify it before any other claim",
    );
  });

  it("names the concrete artifacts when the question asks for them", () => {
    const deployPacket = reviewerPacket({
      answer: ANSWER,
      answerDigest: RECORD.answerDigest,
      askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
      askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
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
      question: "deploy those two monitors locally and send me screenshots of the backtest",
      reviewerSession: RECORD.reviewerSession,
      round: 1,
      verdictPath: RECORD.verdictPath,
      voicePrinciples: [],
    });

    expect(deployPacket).toContain("a labelled `link` run");
    expect(deployPacket).toContain("the images themselves in `images`, as absolute paths");
  });

  it("opens by saying who composed it — code, never the answer's author", () => {
    expect(
      packet.startsWith("# Review packet — composed by `slopweaver turn review`, not by the answer's author"),
    ).toBe(true);
    expect(packet).toContain("the session that wrote the answer did not write a word of it");
  });

  it("carries the question, the thread pointer, and the answer as the exact JSON the digest was computed over", () => {
    expect(packet).toContain("why did the staging pool exhaust?");
    expect(packet).toContain(
      "slopweaver slack read-thread https://example.slack.com/archives/C1/p1785000000000100 --json",
    );
    expect(packet).toContain(JSON.stringify(ANSWER, null, 2));
    expect(packet).toContain("That conversation is ALWAYS in scope as evidence");
    expect(packet).toContain("Never mark a claim `unverifiable` without having read the thread.");
    expect(packet).toContain("`the thread has not already answered");
    expect(packet).toContain("whether the thread has made the answer moot");
  });

  it("quotes the digest in its own fenced block and warns off sha256sum", () => {
    expect(packet).toContain(`\`\`\`\n${RECORD.answerDigest}\n\`\`\``);
    expect(packet).toContain("never a `sha256sum` of a file");
  });

  it("lists the decision's live-read plan and truth mode, the grounding, and every citation", () => {
    expect(packet).toContain("- `fleet-status` (required): to read the live pool");
    expect(packet).toContain("The decision's truth mode is `current`");
    expect(packet).toContain(JSON.stringify(ANSWER.grounding, null, 2));
    expect(packet).toContain("- [1] https://example.slack.com/archives/C1/p1785000000000100");
  });

  it("points at the brief's owner directives by path rather than quoting them", () => {
    expect(packet).toContain("2 loaded. Read `/tmp/brief.json` at `routingInput.ownerDirectives`");
    expect(packet).toContain("never quote one");
  });

  it("names both parties exactly as the verdict must carry them, and where to write it", () => {
    expect(packet).toContain("`authorSession` must read exactly `author workspace workspace:1 (id-workspace:1)`");
    expect(packet).toContain("`reviewerSession` exactly `reviewer workspace workspace:9 (id-workspace:9)`");
    expect(packet).toContain(`Write EXACTLY this shape to \`${RECORD.verdictPath}\``);
    expect(packet).toContain(`"answerDigest": "${RECORD.answerDigest}"`);
  });

  it("says so when the decision named no live reads and no directives are loaded", () => {
    const bare = reviewerPacket({
      answer: ANSWER,
      answerDigest: RECORD.answerDigest,
      askIdentity: { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" },
      askPermalink: undefined,
      authorSession: "a",
      briefPath: "/tmp/brief.json",
      images: [],
      carriedReads: [],
      carriedSettled: [],
      changes: undefined,
      clock: { reviewStartedAt: undefined, spawnedAt: RECORD.spawnedAt },
      carriedUnresolved: [],
      decision: { ...DECISION, needs: [], truthMode: "none" },
      ownerDirectiveCount: 0,
      question: "yo",
      reviewerSession: "r",
      round: 1,
      verdictPath: "/tmp/v.json",
      voicePrinciples: [],
    });
    expect(bare).toContain("- none loaded — only the standing public voice rules apply.");
    expect(bare).toContain("- none — the decision named no live reads");
    expect(bare).toContain("None loaded — there is no owner correction to apply to these records.");
    expect(bare).toContain("The live thread: channel C1, thread 1785000000.000100 (ask 1785000000.000100)");
    expect(bare).not.toContain("slack read-thread https://");
  });
});
