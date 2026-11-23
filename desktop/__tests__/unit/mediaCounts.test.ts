/**
 * The capture ledger behind the sharing edge: the site stops a share with `track.stop()` and the observer
 * reports that AND the `ended` event, so a double release must count once and a stray report not at all.
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_MEDIA_LEDGER,
  type MediaLedger,
  type MediaReport,
  mediaCounts,
  parseMediaReport,
  reduceMediaLedger,
  totalMediaCounts,
  windowAudioTracks,
} from "../../src/mediaCounts";

/** Apply reports in order from an empty ledger. */
function ledgerAfter({ reports }: { reports: readonly MediaReport[] }): MediaLedger {
  return reports.reduce((ledger, report) => reduceMediaLedger({ ledger, report }), EMPTY_MEDIA_LEDGER);
}

describe("reduceMediaLedger", () => {
  it("counts a share and a microphone separately", () => {
    const ledger = ledgerAfter({
      reports: [
        { id: "a-1", kind: "acquired", media: "display" },
        { id: "a-2", kind: "acquired", media: "audio" },
      ],
    });
    expect(mediaCounts({ ledger })).toEqual({ audioTracks: 1, displayTracks: 1 });
  });

  it("counts a track stopped and then ended as released once", () => {
    const ledger = ledgerAfter({
      reports: [
        { id: "a-1", kind: "acquired", media: "display" },
        { id: "a-2", kind: "acquired", media: "display" },
        { id: "a-1", kind: "released" },
        { id: "a-1", kind: "released" },
      ],
    });
    expect(mediaCounts({ ledger })).toEqual({ audioTracks: 0, displayTracks: 1 });
  });

  it("ignores a release for a track it never saw", () => {
    const ledger = ledgerAfter({
      reports: [
        { id: "a-1", kind: "acquired", media: "audio" },
        { id: "zz", kind: "released" },
      ],
    });
    expect(mediaCounts({ ledger })).toEqual({ audioTracks: 1, displayTracks: 0 });
  });

  it("refuses to revive a released id, and counts a duplicate acquire once", () => {
    const ledger = ledgerAfter({
      reports: [
        { id: "a-1", kind: "acquired", media: "display" },
        { id: "a-1", kind: "acquired", media: "display" },
        { id: "a-2", kind: "acquired", media: "display" },
        { id: "a-2", kind: "released" },
        { id: "a-2", kind: "acquired", media: "display" },
      ],
    });
    expect(mediaCounts({ ledger })).toEqual({ audioTracks: 0, displayTracks: 1 });
  });

  it("counts nothing in an empty ledger", () => {
    expect(mediaCounts({ ledger: EMPTY_MEDIA_LEDGER })).toEqual({ audioTracks: 0, displayTracks: 0 });
  });
});

describe("windowAudioTracks", () => {
  const consoleMic = ledgerAfter({ reports: [{ id: "c-1", kind: "acquired", media: "audio" }] });
  const voiceMic = ledgerAfter({
    reports: [
      { id: "v-1", kind: "acquired", media: "audio" },
      { id: "v-2", kind: "acquired", media: "display" },
    ],
  });

  it("counts only the asked window's microphone, never another's", () => {
    // A call open in the console window held the one microphone, and the voice's look was let through.
    const ledgers = new Map([[1, consoleMic]]);
    expect(windowAudioTracks({ contentsId: 2, ledgers })).toBe(0);
    expect(windowAudioTracks({ contentsId: 1, ledgers })).toBe(1);
  });

  it("counts the window's audio tracks and not its display tracks", () => {
    expect(windowAudioTracks({ contentsId: 2, ledgers: new Map([[2, voiceMic]]) })).toBe(1);
  });

  it("counts nothing for a window that does not exist", () => {
    expect(windowAudioTracks({ contentsId: undefined, ledgers: new Map([[1, consoleMic]]) })).toBe(0);
  });
});

describe("totalMediaCounts", () => {
  const consoleMic = ledgerAfter({ reports: [{ id: "c-1", kind: "acquired", media: "audio" }] });
  const voiceShare = ledgerAfter({
    reports: [
      { id: "v-1", kind: "acquired", media: "audio" },
      { id: "v-2", kind: "acquired", media: "display" },
    ],
  });
  const ledgers = new Map([
    [1, consoleMic],
    [2, voiceShare],
  ]);

  it("sums every window's tracks when none is left out", () => {
    expect(totalMediaCounts({ exceptContentsId: undefined, ledgers })).toEqual({ audioTracks: 2, displayTracks: 1 });
  });

  it("leaves the named window's tracks out of the sum", () => {
    expect(totalMediaCounts({ exceptContentsId: 2, ledgers })).toEqual({ audioTracks: 1, displayTracks: 0 });
  });

  it("counts nothing when the only window is the one left out", () => {
    const only = new Map([[2, voiceShare]]);
    expect(totalMediaCounts({ exceptContentsId: 2, ledgers: only })).toEqual({ audioTracks: 0, displayTracks: 0 });
  });
});

describe("parseMediaReport", () => {
  it("reads an acquire and a release", () => {
    expect(parseMediaReport({ value: { id: "x-1", kind: "acquired", media: "audio" } })).toEqual({
      id: "x-1",
      kind: "acquired",
      media: "audio",
    });
    expect(parseMediaReport({ value: { id: "x-1", kind: "released" } })).toEqual({ id: "x-1", kind: "released" });
  });

  it("drops anything that is not exactly a report", () => {
    const rejected = [
      null,
      "x-1",
      { kind: "released" },
      { id: "", kind: "released" },
      { id: "x".repeat(65), kind: "released" },
      { id: "x-1", kind: "acquired" },
      { id: "x-1", kind: "acquired", media: "camera" },
      { id: "x-1", kind: "stopped" },
      { id: 7, kind: "released" },
    ];
    expect(rejected.map((value) => parseMediaReport({ value }))).toEqual(rejected.map(() => undefined));
  });

  it("accepts an id at the 64-character limit", () => {
    expect(parseMediaReport({ value: { id: "x".repeat(64), kind: "released" } })).toEqual({
      id: "x".repeat(64),
      kind: "released",
    });
  });
});
