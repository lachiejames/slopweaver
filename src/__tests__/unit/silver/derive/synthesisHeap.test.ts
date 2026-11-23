/**
 * Derive's synthesis is refused up front when the heap cannot hold it, rather than dying inside `deriveSilver`
 * at the ceiling — the projection, the refusal text, and the real pipeline over a temp home with a plain fake
 * guard standing in for the isolate.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type HeapGuard, type HeapShortfall, unguardedHeap } from "#lib/heapBudget.js";
import { unwrap, unwrapErr } from "#lib/result.js";
import { bronzeFile } from "../../../../corpus/corpusPaths.js";
import type { CorpusRecord } from "../../../../corpus/types.js";
import { runDerivePipeline } from "../../../../silver/derive/pipeline.js";
import {
  SYNTHESIS_HEAP_BYTES_PER_RECORD,
  synthesisHeapProjection,
  synthesisHeapRefusal,
} from "../../../../silver/derive/synthesisHeap.js";
import type { IdentityRosterSnapshot } from "../../../../silver/identityRoster.js";

const MIB = 1024 * 1024;

/** The roster as a store with no row reads it. */
const NO_ROW: IdentityRosterSnapshot = { records: [], retiredFile: undefined, revision: null };

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A shortfall as the real guard reports one after collecting: 3,456 MiB live of a 4,288 MiB ceiling. */
const SHORTFALL: HeapShortfall = {
  collected: true,
  fits: false,
  limitBytes: 4288 * MIB,
  projectedBytes: 1265 * MIB,
  shortfallBytes: 1076 * MIB,
  suggestedLimitMib: 5632,
  usedBytes: 3456 * MIB,
};

/** A temp home holding two slack bronze records and no silver. */
function seedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "synthesis-heap-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "corpus", "bronze", "slack"), { recursive: true });
  const lines = ["s1", "s2"].map((sourceId) => {
    const record: CorpusRecord = {
      author: "U1",
      container: "slack/c",
      kind: "message",
      refs: [],
      source: "slack",
      sourceId,
      text: "a slack message",
      tsIso: "2026-01-11T00:00:00Z",
      url: `https://example.test/${sourceId}`,
    };
    return `${JSON.stringify(record)}\n`;
  });
  writeFileSync(
    bronzeFile({ home, source: "slack", window: { since: "2026-01-01", until: "2026-02-01" } }),
    lines.join(""),
  );
  return home;
}

describe("synthesisHeapProjection", () => {
  it("projects the measured bytes per record", () => {
    expect(synthesisHeapProjection({ recordCount: 3_453_536 })).toBe(3_453_536 * 384);
    expect(SYNTHESIS_HEAP_BYTES_PER_RECORD).toBe(384);
  });

  it("projects nothing for no records", () => {
    expect(synthesisHeapProjection({ recordCount: 0 })).toBe(0);
  });
});

describe("synthesisHeapRefusal", () => {
  it("names the records, the reading, the ceiling and the command that would hold it", () => {
    expect(synthesisHeapRefusal({ recordCount: 3_453_536, shortfall: SHORTFALL })).toBe(
      "refusing to derive: synthesising silver over 3,453,536 records needs ~1265 MiB more heap, and 3456 MiB " +
        "is already live of a 4288 MiB ceiling — re-run with NODE_OPTIONS=--max-old-space-size=5632 slopweaver derive",
    );
  });

  it("says the reading counts garbage when the guard could not collect", () => {
    expect(synthesisHeapRefusal({ recordCount: 2, shortfall: { ...SHORTFALL, collected: false } })).toContain(
      "is already used, garbage included of a 4288 MiB ceiling",
    );
  });
});

describe("runDerivePipeline — the synthesis heap guard", () => {
  it("refuses before the synthesis when the guard says it cannot fit, and builds nothing", () => {
    const home = seedHome();
    const asked: number[] = [];
    const refusing: HeapGuard = ({ projectedBytes }) => {
      asked.push(projectedBytes);
      return { ...SHORTFALL, projectedBytes };
    };
    const phases: string[] = [];

    const result = runDerivePipeline({
      heapGuard: refusing,
      roster: NO_ROW,
      home,
      onPhase: (event) => {
        phases.push(event.phase);
      },
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([
      "refusing to derive: synthesising silver over 2 records needs ~0 MiB more heap, and 3456 MiB is already live " +
        "of a 4288 MiB ceiling — re-run with NODE_OPTIONS=--max-old-space-size=5632 slopweaver derive",
    ]);
    // Asked once, for exactly the two records the read returned.
    expect(asked).toEqual([2 * 384]);
    // The witness that `deriveSilver` never ran: the phase it opens with was never reported.
    expect(phases).toEqual(["read-corpus", "resolve-identities", "resolve-identities"]);
    expect(existsSync(join(home, "corpus", "silver"))).toBe(false);
  });

  it("builds silver when the guard says the synthesis fits", () => {
    const home = seedHome();

    const result = runDerivePipeline({ heapGuard: unguardedHeap, home, roster: NO_ROW });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).records.length).toBe(2);
  });
});
