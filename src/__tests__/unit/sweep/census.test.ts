/**
 * The board census document — built from classified rows, serialised, and validated back strictly.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  findingsDigest,
  parseSweepBoardCensus,
  renderSweepBoardCensusJson,
  sweepBoardCensus,
} from "../../../sweep/census.js";
import type { SweepCandidate } from "../../../sweep/classify.js";

/** sha256 of zero bytes — the digest of the producer's clean pass, an empty findings document. */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const candidate = ({ slug, verdict }: Pick<SweepCandidate, "slug" | "verdict">): SweepCandidate => ({
  act: "none",
  path: `/h/handovers/${slug}.md`,
  slug,
  verdict,
  witness: "a witness",
});

describe("sweepBoardCensus", () => {
  it("counts every verdict, zeroes included, over the whole pass rather than the shown selection", () => {
    const census = sweepBoardCensus({
      candidates: [
        candidate({ slug: "a", verdict: "UNWITNESSED" }),
        candidate({ slug: "b", verdict: "UNWITNESSED" }),
        candidate({ slug: "c", verdict: "SHIPPED" }),
        candidate({ slug: "d", verdict: "OVERTAKEN" }),
        candidate({ slug: "e", verdict: "UNCARDED" }),
        candidate({ slug: "f", verdict: "PR_ENDED" }),
      ],
      findingLines: [],
      scanned: 6,
    });
    expect(census).toEqual({
      census: {
        CONTRADICTED: 0,
        KEEP: 0,
        ORPHANED: 0,
        OVERTAKEN: 1,
        PR_ENDED: 1,
        SHIPPED: 1,
        SUPERSEDED: 0,
        UNCARDED: 1,
        UNWITNESSED: 2,
      },
      findingsSha256: EMPTY_SHA256,
      producer: "sweep board",
      scanned: 6,
      schemaVersion: 5,
      swept: 6,
    });
  });

  it("round-trips through its own serialiser and parser", () => {
    const census = sweepBoardCensus({
      candidates: [candidate({ slug: "a", verdict: "KEEP" })],
      findingLines: ['{"slug":"a"}'],
      scanned: 1,
    });
    const text = renderSweepBoardCensusJson({ census });
    expect(unwrap(parseSweepBoardCensus({ value: JSON.parse(text) }))).toEqual(census);
  });
});

describe("findingsDigest", () => {
  it("digests the lines joined by newlines, so a reader dropping only the terminal newline agrees", () => {
    expect(findingsDigest({ lines: [] })).toBe(EMPTY_SHA256);
    expect(findingsDigest({ lines: ["a", "b"] })).toBe(findingsDigest({ lines: ["a\nb"] }));
    expect(findingsDigest({ lines: ["a", "b"] })).not.toBe(findingsDigest({ lines: ["ab"] }));
  });
});

describe("parseSweepBoardCensus", () => {
  it("refuses a document missing the UNWITNESSED count, naming the path", () => {
    const value = {
      census: {
        CONTRADICTED: 0,
        KEEP: 0,
        ORPHANED: 0,
        OVERTAKEN: 0,
        PR_ENDED: 0,
        SHIPPED: 0,
        SUPERSEDED: 0,
        UNCARDED: 0,
      },
      findingsSha256: EMPTY_SHA256,
      producer: "sweep board",
      scanned: 1,
      schemaVersion: 5,
      swept: 0,
    };
    expect(unwrapErr(parseSweepBoardCensus({ value }))).toEqual([
      "census.UNWITNESSED: Invalid input: expected number, received undefined",
    ]);
  });

  it("refuses another schema version, so a census with no findings digest is never read as paired", () => {
    const census = sweepBoardCensus({ candidates: [], findingLines: [], scanned: 0 });
    expect(unwrapErr(parseSweepBoardCensus({ value: { ...census, schemaVersion: 1 } }))).toEqual([
      "schemaVersion: Invalid input: expected 5",
    ]);
  });

  it("refuses a version 4 census, which counts no PR_ENDED rows", () => {
    const { census, ...rest } = sweepBoardCensus({ candidates: [], findingLines: [], scanned: 0 });
    const { PR_ENDED: _dropped, ...older } = census;
    expect(unwrapErr(parseSweepBoardCensus({ value: { ...rest, census: older, schemaVersion: 4 } }))).toEqual([
      "schemaVersion: Invalid input: expected 5",
      "census.PR_ENDED: Invalid input: expected number, received undefined",
    ]);
  });
});
