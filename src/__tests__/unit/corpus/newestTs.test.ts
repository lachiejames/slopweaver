/**
 * `newestTs` is a lexical maximum over zero-padded ISO instants, `undefined` for an empty batch. Each case
 * varies only `tsIso`, so nothing else on the record can be what decided the answer.
 */
import { describe, expect, it } from "vitest";

import { newestTs, newestTsAtClock } from "../../../corpus/newestTs.js";
import type { CorpusRecord } from "../../../corpus/types.js";

/** A record whose timestamp is the only field a case varies. */
function recordAt({ tsIso }: { tsIso: string }): CorpusRecord {
  return {
    container: "acme/widgets",
    kind: "pr",
    refs: [],
    source: "github",
    sourceId: `#${tsIso}`,
    text: "body",
    tsIso,
    url: "https://github.com/acme/widgets/pull/1",
  };
}

describe("newestTs", () => {
  it("answers undefined for an empty batch", () => {
    expect(newestTs({ records: [] })).toBeUndefined();
  });

  it("answers the newest instant from an unsorted batch", () => {
    const records = [
      recordAt({ tsIso: "2026-09-02T10:00:00.000Z" }),
      recordAt({ tsIso: "2026-09-05T08:30:00.000Z" }),
      recordAt({ tsIso: "2026-09-01T23:59:59.999Z" }),
    ];

    expect(newestTs({ records })).toBe("2026-09-05T08:30:00.000Z");
  });

  it("answers the shared instant when two records tie for newest", () => {
    const records = [
      recordAt({ tsIso: "2026-09-05T08:30:00.000Z" }),
      recordAt({ tsIso: "2026-09-04T00:00:00.000Z" }),
      recordAt({ tsIso: "2026-09-05T08:30:00.000Z" }),
    ];

    expect(newestTs({ records })).toBe("2026-09-05T08:30:00.000Z");
  });

  it("orders across a year, month and day boundary by the instant, not by where it sits in the batch", () => {
    const records = [
      recordAt({ tsIso: "2026-12-31T23:59:59.999Z" }),
      recordAt({ tsIso: "2027-01-01T00:00:00.000Z" }),
      recordAt({ tsIso: "2026-02-28T12:00:00.000Z" }),
    ];

    expect(newestTs({ records })).toBe("2027-01-01T00:00:00.000Z");
  });

  it("answers the only instant of a one-record batch", () => {
    expect(newestTs({ records: [recordAt({ tsIso: "2026-09-05T08:30:00.000Z" })] })).toBe("2026-09-05T08:30:00.000Z");
  });
});

describe("newestTsAtClock", () => {
  const NOW = "2026-09-05T00:00:00.000Z";

  it("never banks a meeting that has not happened yet", () => {
    expect(newestTsAtClock({ nowIso: NOW, records: [recordAt({ tsIso: "2027-06-01T00:00:00.000Z" })] })).toBe(NOW);
  });

  it("banks the newest record when it is in the past", () => {
    const records = [recordAt({ tsIso: "2026-01-01T00:00:00.000Z" }), recordAt({ tsIso: "2026-03-01T00:00:00.000Z" })];
    expect(newestTsAtClock({ nowIso: NOW, records })).toBe("2026-03-01T00:00:00.000Z");
  });

  it("banks nothing when nothing was committed", () => {
    expect(newestTsAtClock({ nowIso: NOW, records: [] })).toBe(undefined);
  });
});
