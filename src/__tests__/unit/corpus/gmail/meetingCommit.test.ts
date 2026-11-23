/**
 * The targeted transcript commit: one bronze write through the one committer, under the gmail refresh slot, and
 * never beside another writer. A real round trip into a throwaway home and a throwaway slot root.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  commitMeetingTranscripts,
  GmailMeetingCommitErrors,
  meetingTranscriptWindow,
} from "../../../../corpus/gmail/meetingCommit.js";
import { readMeetingTranscriptProofs } from "../../../../corpus/gmail/meetingProof.js";
import { refreshSlotDir } from "../../../../corpus/refreshSlot.js";
import type { CorpusRecord } from "../../../../corpus/types.js";
import { slotMarker } from "../../../../lib/loadSlotMarker.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const transcript = ({ id, tsIso }: { id: string; tsIso: string }): CorpusRecord => ({
  attrs: { meetingDate: "2 Oct 2026" },
  container: "mail/meetings",
  kind: "transcript",
  refs: [],
  source: "gmail",
  sourceId: `${id}:meeting`,
  text: "Ana: shall we ship it\nBo: yes",
  title: "Widget Working Group",
  tsIso,
  url: "https://docs.google.com/document/d/doc1/edit",
  visibility: "private",
});

describe("meetingTranscriptWindow", () => {
  it("spans the first and last day the records fall on, and nothing for no records", () => {
    expect(
      meetingTranscriptWindow({
        records: [
          transcript({ id: "m2", tsIso: "2026-10-03T01:00:00.000Z" }),
          transcript({ id: "m1", tsIso: "2026-09-30T23:00:00.000Z" }),
        ],
      }),
    ).toEqual({ since: "2026-09-30", until: "2026-10-03" });
    expect(meetingTranscriptWindow({ records: [] })).toBe(undefined);
  });
});

describe("commitMeetingTranscripts", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
  const fresh = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "meeting-commit-"));
    dirs.push(dir);
    return dir;
  };

  it("writes once, dedups the second write, and releases the slot it took", () => {
    const home = fresh();
    const slotRoot = fresh();
    const records = [transcript({ id: "m1", tsIso: "2026-10-02T03:00:00.000Z" })];

    const first = unwrap(commitMeetingTranscripts({ home, records, slotRoot }));
    const second = unwrap(commitMeetingTranscripts({ home, records, slotRoot }));

    expect([first.written, first.deduped, second.written, second.deduped]).toEqual([1, 0, 0, 1]);
    expect(first.window).toEqual({ since: "2026-10-02", until: "2026-10-02" });
    expect(readdirSync(join(refreshSlotDir({ root: slotRoot, source: "gmail" }), "lane-0"))).toEqual(["free"]);
    const proofs = unwrap(
      readMeetingTranscriptProofs({
        expectations: [{ meetingDate: "2 Oct 2026", messageId: "m1", title: "Widget Working Group" }],
        home,
      }),
    );
    expect(proofs.get("m1")!.verdict).toBe("proven");
  });

  it("writes nothing and takes no slot for no records", () => {
    const slotRoot = fresh();
    expect(unwrap(commitMeetingTranscripts({ home: fresh(), records: [], slotRoot }))).toEqual({
      deduped: 0,
      excluded: 0,
      window: undefined,
      written: 0,
    });
    expect(readdirSync(slotRoot)).toEqual([]);
  });

  it("refuses beside another live process holding the gmail slot, naming its pid", () => {
    const home = fresh();
    const slotRoot = fresh();
    const lane = join(refreshSlotDir({ root: slotRoot, source: "gmail" }), "lane-0");
    mkdirSync(lane, { recursive: true });
    // Written after the parent started, as a genuine holder's slot is: a slot dated before its own pid started is
    // a reused pid, and its lane is taken over.
    const holder = { ceilingMib: 1024, pid: process.ppid, startedAtIso: "2099-01-01T00:00:00.000Z" };
    writeFileSync(join(lane, slotMarker({ lease: { limit: 1, slot: holder } })), "");

    const refused = unwrapErr(
      commitMeetingTranscripts({
        home,
        records: [transcript({ id: "m1", tsIso: "2026-10-02T03:00:00.000Z" })],
        slotRoot,
      }),
    );

    expect(refused).toEqual(GmailMeetingCommitErrors.refreshSlotHeld({ holderPid: process.ppid }));
    const proofs = unwrap(
      readMeetingTranscriptProofs({
        expectations: [{ meetingDate: "2 Oct 2026", messageId: "m1", title: "Widget Working Group" }],
        home,
      }),
    );
    expect(proofs.get("m1")!.verdict).toBe("absent");
  });

  it("refuses, writing nothing, when the gmail slot cannot be taken at all", () => {
    const home = fresh();
    const slotRoot = fresh();
    writeFileSync(refreshSlotDir({ root: slotRoot, source: "gmail" }), "");

    const refused = unwrapErr(
      commitMeetingTranscripts({
        home,
        records: [transcript({ id: "m1", tsIso: "2026-10-02T03:00:00.000Z" })],
        slotRoot,
      }),
    );

    expect(refused.code).toBe("REFRESH_SLOT_UNAVAILABLE");
    expect(refused.message).toContain("gmail's refresh slot could not be taken");
  });
});
