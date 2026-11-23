import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  buildReadingRecord,
  isSkipDocument,
  isSkipText,
  latestReadingFor,
  parseReadingLine,
  producerSlug,
  readingFileOf,
  readingsNewestFirst,
  validateReadingRecord,
} from "../../../readings/row.js";
import type { ReadingRecord } from "../../../readings/types.js";

const RECORDED = "2026-09-20T02:30:00.000Z";

/** One valid row, varying only what a test cares about. */
function row({
  producer = "github landing",
  by = "tick-12",
  recordedAtIso = RECORDED,
}: {
  producer?: string;
  by?: string;
  recordedAtIso?: string;
} = {}): ReadingRecord {
  return unwrap(
    buildReadingRecord({ by, bytes: 42, observedAtIso: "2026-09-20T02:29:00.000Z", producer, recordedAtIso }),
  );
}

describe("producerSlug", () => {
  it("keeps a flag spelled into the producer, so a flag SPLITS the key", () => {
    expect(producerSlug({ producer: "github landing --json --include-drafts" })).toBe(
      "github-landing-json-include-drafts",
    );
    expect(producerSlug({ producer: "  Github  Landing " })).toBe("github-landing");
  });

  it("is empty for a producer with no letter or digit", () => {
    expect(producerSlug({ producer: "--- ---" })).toBe("");
  });
});

describe("readingFileOf", () => {
  it("names the file by the instant without colons, and the id by the instant verbatim", () => {
    expect(readingFileOf({ recordedAtIso: RECORDED, slug: "github-landing" })).toEqual({
      file: "github-landing/2026-09-20T023000.000Z.json",
      readingId: "2026-09-20T02:30:00.000Z-github-landing",
    });
  });
});

describe("buildReadingRecord", () => {
  it("builds a row whose id and file are derived from the instant and the producer", () => {
    expect(row()).toEqual({
      by: "tick-12",
      bytes: 42,
      file: "github-landing/2026-09-20T023000.000Z.json",
      observedAtIso: "2026-09-20T02:29:00.000Z",
      producer: "github landing",
      readingId: "2026-09-20T02:30:00.000Z-github-landing",
      recordedAtIso: RECORDED,
    });
  });

  it("trims the producer and who took it", () => {
    const built = row({ by: "  sync-now ", producer: " github landing " });
    expect(built.by).toBe("sync-now");
    expect(built.producer).toBe("github landing");
  });

  it("refuses an empty producer, naming the field", () => {
    const failure = unwrapErr(
      buildReadingRecord({ by: "x", bytes: 1, observedAtIso: RECORDED, producer: "  ", recordedAtIso: RECORDED }),
    );
    expect(failure.code).toBe("INVALID_FIELD");
    expect(failure.message).toBe("producer must not be empty");
  });

  it("refuses a producer with no letter or digit, since it would name no directory", () => {
    const failure = unwrapErr(
      buildReadingRecord({ by: "x", bytes: 1, observedAtIso: RECORDED, producer: "---", recordedAtIso: RECORDED }),
    );
    expect(failure.message).toBe("producer must contain a letter or digit");
  });

  it("refuses an instant that is not ISO-8601", () => {
    const failure = unwrapErr(
      buildReadingRecord({ by: "x", bytes: 1, observedAtIso: "yesterday", producer: "p", recordedAtIso: RECORDED }),
    );
    expect(failure.message).toBe("observedAtIso must be an ISO-8601 instant");
  });

  it("refuses a negative or fractional byte count", () => {
    const negative = unwrapErr(
      buildReadingRecord({ by: "x", bytes: -1, observedAtIso: RECORDED, producer: "p", recordedAtIso: RECORDED }),
    );
    expect(negative.message).toBe("bytes must be a non-negative integer");
    const fractional = unwrapErr(
      buildReadingRecord({ by: "x", bytes: 1.5, observedAtIso: RECORDED, producer: "p", recordedAtIso: RECORDED }),
    );
    expect(fractional.message).toBe("bytes must be a non-negative integer");
  });
});

describe("validateReadingRecord", () => {
  it("refuses a stored row whose id disagrees with its instant and producer", () => {
    const failure = unwrapErr(validateReadingRecord({ value: { ...row(), readingId: "made-up" } }));
    expect(failure.message).toBe("readingId must be 2026-09-20T02:30:00.000Z-github-landing");
  });

  it("refuses a stored row whose file points elsewhere", () => {
    const failure = unwrapErr(validateReadingRecord({ value: { ...row(), file: "../../etc/passwd" } }));
    expect(failure.message).toBe("file must be github-landing/2026-09-20T023000.000Z.json");
  });

  it("refuses a value that is not an object", () => {
    expect(unwrapErr(validateReadingRecord({ value: "row" })).message).toBe("row must be an object");
  });
});

describe("parseReadingLine", () => {
  it("parses the line the store writes", () => {
    expect(unwrap(parseReadingLine({ line: JSON.stringify(row()), lineNumber: 1 }))).toEqual(row());
  });

  it("refuses a line that is not JSON, naming the line number", () => {
    const failure = unwrapErr(parseReadingLine({ line: "{not json", lineNumber: 7 }));
    expect(failure.code).toBe("CORRUPT_ROW");
    expect(failure.message).toBe("readings index line 7 is not a reading row — the line is not valid JSON");
  });

  it("refuses a line that spells a field twice", () => {
    // Spliced rather than replaced: a `replace` of one brace reads to a scanner as an incomplete sanitisation.
    const line = `{"by":"other",${JSON.stringify(row()).slice(1)}`;
    const failure = unwrapErr(parseReadingLine({ line, lineNumber: 2 }));
    expect(failure.message).toBe("readings index line 2 is not a reading row — the field `by` is written twice");
  });
});

describe("latestReadingFor", () => {
  const first = row({ recordedAtIso: "2026-09-20T01:00:00.000Z" });
  const second = row({ by: "sync-now", recordedAtIso: "2026-09-20T02:00:00.000Z" });
  const other = row({ producer: "claude gauge", recordedAtIso: "2026-09-20T03:00:00.000Z" });

  it("answers the latest row for the producer by append instant, whatever the file order", () => {
    expect(latestReadingFor({ producer: "github landing", records: [second, other, first] })).toEqual(second);
  });

  it("compares instants, not strings: an offset-spelled earlier instant does not win", () => {
    const offset = row({ by: "offset", recordedAtIso: "2026-09-20T11:00:00.000+10:00" });
    expect(latestReadingFor({ producer: "github landing", records: [offset, second] })).toEqual(second);
  });

  it("gives a tie to the row appended later in the index", () => {
    const later = row({ by: "later", recordedAtIso: "2026-09-20T02:00:00.000Z" });
    expect(latestReadingFor({ producer: "github landing", records: [second, later] })).toEqual(later);
  });

  it("matches a producer by slug, so a flag spelling does not split it in two", () => {
    expect(latestReadingFor({ producer: "Github Landing", records: [first] })).toEqual(first);
  });

  it("answers undefined for a producer with no rows", () => {
    expect(latestReadingFor({ producer: "velocity", records: [first, second, other] })).toBeUndefined();
  });
});

describe("readingsNewestFirst", () => {
  it("orders one producer's rows newest first, a tie going to the row appended later", () => {
    const first = row({ recordedAtIso: "2026-09-20T01:00:00.000Z" });
    const second = row({ by: "sync-now", recordedAtIso: "2026-09-20T02:00:00.000Z" });
    const tied = row({ by: "tied", recordedAtIso: "2026-09-20T02:00:00.000Z" });
    const other = row({ producer: "claude gauge", recordedAtIso: "2026-09-20T03:00:00.000Z" });
    expect(readingsNewestFirst({ producer: "github landing", records: [second, other, first, tied] })).toEqual([
      tied,
      second,
      first,
    ]);
  });
});

/** A cadence-skip document, verbatim: the skip that stood as the latest landing for half an hour. */
const SKIP =
  '{"cadenceMinutes":30,"kind":"skipped","lastReadAtIso":"2026-10-01T14:21:40.562Z","nextDueAtIso":"2026-10-01T14:51:40.562Z","selection":"acme/acme-admin,lachiejames/slopweaver@@me","why":"acme/acme-admin,lachiejames/slopweaver@@me was read 17 minute(s) ago and the cadence is 30 minute(s), so this tick makes no GitHub request"}';

describe("isSkipDocument", () => {
  it("is true for a cadence skip", () => {
    expect(isSkipDocument({ document: JSON.parse(SKIP) as unknown })).toBe(true);
  });

  it("is false for a landing reading, a nested skip, an array and null", () => {
    expect(isSkipDocument({ document: { rows: [], tally: { total: 0 } } })).toBe(false);
    expect(isSkipDocument({ document: { held: [{ kind: "skipped" }] } })).toBe(false);
    expect(isSkipDocument({ document: [{ kind: "skipped" }] })).toBe(false);
    expect(isSkipDocument({ document: null })).toBe(false);
  });
});

describe("isSkipText", () => {
  it("reads a skip from its printed bytes", () => {
    expect(isSkipText({ printed: SKIP })).toBe(true);
  });

  it("is false for a landing reading and for text that is not JSON", () => {
    expect(isSkipText({ printed: '{"rows":[],"tally":{"total":0}}' })).toBe(false);
    expect(isSkipText({ printed: '{"kind":"skipped"' })).toBe(false);
  });
});
