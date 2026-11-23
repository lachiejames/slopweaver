/**
 * Proving a Gemini meeting's transcript is in gmail bronze — by identity AND by the title and date its mail named.
 *
 * The bronze half is a real round trip: records go through the one bronze committer into a throwaway home and the
 * proof streams them back, so what is under test is what a run actually reads.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { createBronzeCommitter } from "../../../../corpus/corpusWriter.js";
import {
  type MeetingProofExpectation,
  meetingSourceId,
  provesMeetingTranscript,
  readMeetingTranscriptProofs,
} from "../../../../corpus/gmail/meetingProof.js";
import { redactText } from "../../../../corpus/redact.js";
import type { CorpusRecord } from "../../../../corpus/types.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const EXPECTED: MeetingProofExpectation = { meetingDate: "2 Oct 2026", messageId: "m1", title: "the owner / Tobias" };

/** A transcript row exactly as the meeting projection shapes one. */
const transcript = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  attrs: { meetingDate: "2 Oct 2026" },
  container: "mail/meetings",
  kind: "transcript",
  refs: [],
  source: "gmail",
  sourceId: "m1:meeting",
  text: "the owner: shall we ship it\nTobias: yes",
  title: "the owner / Tobias",
  tsIso: "2026-10-02T03:00:00.000Z",
  url: "https://docs.google.com/document/d/doc1/edit",
  visibility: "private",
  ...over,
});

describe("meetingSourceId", () => {
  it("is the carrier message id suffixed, the key the projection stores under", () => {
    expect(meetingSourceId({ messageId: "1a0fb200128e6aca" })).toBe("1a0fb200128e6aca:meeting");
  });
});

describe("provesMeetingTranscript", () => {
  it("proves a transcript row carrying the title and date the mail named", () => {
    const proof = provesMeetingTranscript({ expectation: EXPECTED, record: transcript() });
    expect([proof.verdict, proof.sourceId, proof.messageId]).toEqual(["proven", "m1:meeting", "m1"]);
  });

  it("names the first check each wrong row fails", () => {
    const verdicts = [
      provesMeetingTranscript({ expectation: EXPECTED, record: undefined }),
      provesMeetingTranscript({ expectation: EXPECTED, record: transcript({ kind: "message" }) }),
      provesMeetingTranscript({ expectation: EXPECTED, record: transcript({ container: "mail/inbox" }) }),
      provesMeetingTranscript({ expectation: EXPECTED, record: transcript({ text: "  \n" }) }),
      provesMeetingTranscript({ expectation: EXPECTED, record: transcript({ title: "the owner / Seth" }) }),
      provesMeetingTranscript({ expectation: EXPECTED, record: transcript({ attrs: { meetingDate: "3 Oct 2026" } }) }),
      provesMeetingTranscript({ expectation: EXPECTED, record: transcript({ attrs: {} }) }),
    ].map((proof) => proof.verdict);
    expect(verdicts).toEqual([
      "absent",
      "wrong-kind",
      "wrong-kind",
      "empty-text",
      "wrong-title",
      "wrong-date",
      "wrong-date",
    ]);
  });

  it("compares the title as bronze STORED it, through the same redaction", () => {
    const withToken = { ...EXPECTED, title: `Rotate ghp_${"a".repeat(36)} today` };
    const stored = redactText({ text: withToken.title }).text;
    expect(stored).not.toBe(withToken.title);
    const proof = provesMeetingTranscript({ expectation: withToken, record: transcript({ title: stored }) });
    expect(proof.verdict).toBe("proven");
  });
});

describe("readMeetingTranscriptProofs over a real home", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });
  const freshHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), "meeting-proof-"));
    homes.push(home);
    return home;
  };

  it("proves a committed transcript, and reads an unwritten one as absent", () => {
    const home = freshHome();
    unwrap(
      createBronzeCommitter({ home, window: { since: "2026-10-02", until: "2026-10-02" } }).commit({
        records: [transcript()],
      }),
    );

    const proofs = unwrap(
      readMeetingTranscriptProofs({
        expectations: [EXPECTED, { meetingDate: "2 Oct 2026", messageId: "m2", title: "Lunch" }],
        home,
        protection: () => ok([]),
      }),
    );

    expect([proofs.get("m1")!.verdict, proofs.get("m2")!.verdict]).toEqual(["proven", "absent"]);
    expect(proofs.get("m1")!.record!.text).toBe("the owner: shall we ship it\nTobias: yes");
  });

  it("reads a home with no gmail bronze at all as every transcript absent", () => {
    const proofs = unwrap(
      readMeetingTranscriptProofs({ expectations: [EXPECTED], home: freshHome(), protection: () => ok([]) }),
    );
    expect(proofs.get("m1")!.verdict).toBe("absent");
  });

  it("fails on a malformed line carrying a wanted identity, never reading it as absent", () => {
    const home = freshHome();
    const dir = bronzeSourceDir({ home, source: "gmail" });
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "2026-10-02_2026-10-02.jsonl");
    writeFileSync(path, '{"sourceId":"m1:meeting","source":"gmail"\n', "utf8");

    const failed = unwrapErr(readMeetingTranscriptProofs({ expectations: [EXPECTED], home, protection: () => ok([]) }));
    expect(failed).toMatchObject({ code: "BRONZE_MALFORMED", line: 0, path });
  });

  it("ignores a malformed line that carries no wanted identity", () => {
    const home = freshHome();
    const dir = bronzeSourceDir({ home, source: "gmail" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-10-01_2026-10-01.jsonl"), '{"sourceId":"other"\n', "utf8");

    const proofs = unwrap(readMeetingTranscriptProofs({ expectations: [EXPECTED], home, protection: () => ok([]) }));
    expect(proofs.get("m1")!.verdict).toBe("absent");
  });

  it("refuses when the protect list marks gmail bronze no-access, never reading every transcript as absent", () => {
    const home = freshHome();
    const dir = bronzeSourceDir({ home, source: "gmail" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-10-02_2026-10-02.jsonl"), '{"sourceId":"m1:meeting"}\n', "utf8");
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: dir, why: "fixture" };

    const failed = unwrapErr(
      readMeetingTranscriptProofs({ expectations: [EXPECTED], home, protection: () => ok([entry]) }),
    );

    expect(failed).toStrictEqual({
      code: "BRONZE_PROTECTED",
      message: `refusing to read gmail: it would search ${dir}, which the owner's protect list marks no-access at ${dir} (fixture)`,
    });
  });
});
