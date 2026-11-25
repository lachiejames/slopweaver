/**
 * The self-recording contract: one serialisation, printed and appended as the same text, observed at the document's
 * own instant rather than the append clock.
 */
import { describe, expect, it } from "vitest";

import { printedReadingOutputOf } from "../../../readings/printedReading.js";

/** A document whose own instant is an hour before the append. */
const DOCUMENT = { observedAtIso: "2026-11-20T08:00:00.000Z", rows: [{ seat: "acme-fixture" }] };

describe("printedReadingOutputOf", () => {
  it("prints one JSON text and appends nothing when no --record-reading was given", () => {
    expect(
      printedReadingOutputOf({
        by: undefined,
        document: DOCUMENT,
        home: "/h",
        observedAtIso: DOCUMENT.observedAtIso,
        producer: "session watch",
        recordedAtIso: "2026-11-20T09:00:00.000Z",
      }),
    ).toStrictEqual({
      append: undefined,
      text: '{"observedAtIso":"2026-11-20T08:00:00.000Z","rows":[{"seat":"acme-fixture"}]}',
    });
  });

  it("appends exactly the printed text under the producer, by and home it was given", () => {
    const output = printedReadingOutputOf({
      by: "sync-now",
      document: DOCUMENT,
      home: "/h",
      observedAtIso: DOCUMENT.observedAtIso,
      producer: "fleet burn",
      recordedAtIso: "2026-11-20T09:00:00.000Z",
    });
    expect(output.append).toStrictEqual({
      by: "sync-now",
      document: '{"observedAtIso":"2026-11-20T08:00:00.000Z","rows":[{"seat":"acme-fixture"}]}',
      home: "/h",
      nowIso: "2026-11-20T09:00:00.000Z",
      observedAtIso: "2026-11-20T08:00:00.000Z",
      producer: "fleet burn",
    });
    expect(output.append!.document).toBe(output.text);
  });

  it("observes the reading at the document's instant, never the later append clock", () => {
    const output = printedReadingOutputOf({
      by: "sync-now",
      document: DOCUMENT,
      home: "/h",
      observedAtIso: DOCUMENT.observedAtIso,
      producer: "session watch",
      recordedAtIso: "2026-11-20T09:00:00.000Z",
    });
    expect([output.append!.observedAtIso, output.append!.nowIso]).toEqual([
      "2026-11-20T08:00:00.000Z",
      "2026-11-20T09:00:00.000Z",
    ]);
  });
});
