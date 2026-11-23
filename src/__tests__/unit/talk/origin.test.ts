/**
 * Where a board row came from, read out of the row's own file: the owner's quoted words, the provenance sections, every
 * anchor, and — for a finding — the plain fact that they never asked for it. The case: asked where a card came
 * from, the voice must be able to quote the owner.
 */
import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../handover/doc.js";
import { fitToBytes, QUOTE_MAX_CHARS, rowOriginOf, transcriptPointers } from "../../../talk/origin.js";

const SESSION = "a0000007-0000-4000-8000-000000000008";
const RECORD = "33dac8fe-ef61-4b56-956f-1a3377e33841";

const ASK = `---
slug: atlas-jumpcloud
summary: an atlas of the JumpCloud tenancy, like \`atlas-trelica-apps\`
status: ready
kind: ask
askedIso: 2026-09-20T01:00:00.000Z
anchor: transcript:${SESSION}#${RECORD}
ruling: build it read-only
---

# Atlas: JumpCloud

## Why

Owner ruling, 20 Sep 2026: _"we should build a jumpcloud atlas so we can see who owns each device"_

A paragraph with no quotation in it at all.

## Where this came from

The Vanta sweep in \`vanta-failing-devices-sweep\` named it first.

## Plan

Walk the Directory API.
`;

const FINDING = `---
slug: a-finding-row
status: ready
kind: ask
origin: finding
observedBy: some-seat
---

# A thing a session noticed
`;

const originOf = ({ text }: { text: string }): ReturnType<typeof rowOriginOf> =>
  rowOriginOf({ doc: parseHandoverDoc({ path: "/h/row.md", text }), text });

describe("rowOriginOf", () => {
  it("quotes the ruling and every paragraph attributed to the owner, and only those", () => {
    expect(originOf({ text: ASK }).quotes).toEqual([
      "ruling: build it read-only",
      'Owner ruling, 20 Sep 2026: _"we should build a jumpcloud atlas so we can see who owns each device"_',
    ]);
  });

  it("keeps the provenance section apart from the owner's words", () => {
    expect(originOf({ text: ASK }).whereFrom).toEqual([
      "## Where this came from\n\nThe Vanta sweep in `vanta-failing-devices-sweep` named it first.",
    ]);
  });

  it("names the other rows its summary and provenance point at, never itself", () => {
    expect(originOf({ text: ASK }).mentions).toEqual(["vanta-failing-devices-sweep", "atlas-trelica-apps"]);
  });

  it("collects the front-matter anchor once, even when the body repeats it", () => {
    expect(originOf({ text: `${ASK}\nSee transcript:${SESSION}#${RECORD}.\n` }).anchors).toEqual([
      `transcript:${SESSION}#${RECORD}`,
    ]);
  });

  it("says a finding did not come from the owner, and who observed it", () => {
    const origin = originOf({ text: FINDING });
    expect(origin.fromOwner).toBe(false);
    expect(origin.observedBy).toBe("some-seat");
    expect(originOf({ text: ASK }).fromOwner).toBe(true);
  });

  it("cuts a long quotation and marks the cut", () => {
    const long = `---\nslug: long-row\nstatus: ready\nruling: ${"w".repeat(QUOTE_MAX_CHARS + 20)}\n---\n`;
    expect(originOf({ text: long }).quotes).toEqual([
      `${`ruling: ${"w".repeat(QUOTE_MAX_CHARS + 20)}`.slice(0, QUOTE_MAX_CHARS)} …`,
    ]);
  });
});

describe("transcriptPointers", () => {
  it("splits a transcript anchor into its session and record, and skips any other anchor", () => {
    expect(transcriptPointers({ anchors: ["slack:C1/123.456", `transcript:${SESSION}#${RECORD}`] })).toEqual([
      { anchor: `transcript:${SESSION}#${RECORD}`, recordId: RECORD, sessionId: SESSION },
    ]);
  });
});

describe("fitToBytes", () => {
  it("shrinks until the value fits, and says it cut", () => {
    const fitted = fitToBytes({
      maxBytes: 10,
      shrink: (current: readonly string[]) => (current.length === 0 ? undefined : current.slice(0, -1)),
      value: ["aaaa", "bbbb", "cccc"],
    });
    expect(fitted).toEqual({ cut: true, value: ["aaaa"] });
  });

  it("returns the value untouched when it already fits", () => {
    expect(fitToBytes({ maxBytes: 100, shrink: () => undefined, value: ["a"] })).toEqual({ cut: false, value: ["a"] });
  });
});
