/**
 * The pure core of the heap guard: the reserve arithmetic, the suggestion rounding, and the two edges that
 * read the real isolate. The edges are exercised for real — they are what a refusal's numbers come from, and
 * a test that faked them would prove nothing about whether `collectGarbage` can reach a binding without
 * `--expose-gc`, which is the one thing about it worth knowing.
 */
import { describe, expect, it } from "vitest";
import {
  assessHeapBudget,
  COLLECT_RESERVE_FRACTION,
  canCollectInto,
  collectGarbage,
  guardHeap,
  HEAP_RESERVE_FRACTION,
  readHeap,
  toMib,
  unguardedHeap,
} from "../../../lib/heapBudget.js";

const MIB = 1024 * 1024;

describe("assessHeapBudget", () => {
  it("fits when used + projected lands under the reserved ceiling, reporting the headroom", () => {
    const verdict = assessHeapBudget({
      projectedBytes: 100 * MIB,
      reading: { externalBytes: 0, limitBytes: 1000 * MIB, usedBytes: 500 * MIB },
      reserveFraction: 0.1,
    });
    expect(verdict).toEqual({ fits: true, headroomBytes: 300 * MIB });
  });

  it("refuses when the landing crosses the reserved ceiling, naming the shortfall and a ceiling that holds it", () => {
    const verdict = assessHeapBudget({
      projectedBytes: 500 * MIB,
      reading: { externalBytes: 0, limitBytes: 1000 * MIB, usedBytes: 500 * MIB },
      reserveFraction: 0.1,
    });
    // landing 1000 > usable 900; a ceiling that holds 1000 with 10% free is 1,112 MiB → rounded up to 1,536.
    expect(verdict).toEqual({
      collected: false,
      fits: false,
      limitBytes: 1000 * MIB,
      projectedBytes: 500 * MIB,
      shortfallBytes: 100 * MIB,
      suggestedLimitMib: 1536,
      usedBytes: 500 * MIB,
    });
  });

  it("treats landing exactly on the reserved ceiling as fitting with zero headroom", () => {
    const verdict = assessHeapBudget({
      projectedBytes: 400 * MIB,
      reading: { externalBytes: 0, limitBytes: 1000 * MIB, usedBytes: 500 * MIB },
      reserveFraction: 0.1,
    });
    expect(verdict).toEqual({ fits: true, headroomBytes: 0 });
  });

  it("clamps a negative projection to zero rather than manufacturing headroom", () => {
    const verdict = assessHeapBudget({
      projectedBytes: -5000 * MIB,
      reading: { externalBytes: 0, limitBytes: 1000 * MIB, usedBytes: 900 * MIB },
      reserveFraction: 0.1,
    });
    expect(verdict).toEqual({ fits: true, headroomBytes: 0 });
  });

  it("keeps 15% of the ceiling in reserve by default — the band the measured fatal sat inside", () => {
    expect(HEAP_RESERVE_FRACTION).toBe(0.15);
    // 4,215 MiB live on a 4,288 MB ceiling is the run that died; the default reserve refuses it.
    const died = assessHeapBudget({
      projectedBytes: 4215 * MIB,
      reading: { externalBytes: 0, limitBytes: 4288 * MIB, usedBytes: 0 },
    });
    expect(died.fits).toBe(false);
    // The same live set on the 6,144 MB ceiling that answered fits.
    const answered = assessHeapBudget({
      projectedBytes: 4215 * MIB,
      reading: { externalBytes: 0, limitBytes: 6144 * MIB, usedBytes: 0 },
    });
    expect(answered.fits).toBe(true);
  });
});

describe("toMib", () => {
  it("rounds to the nearest whole MiB", () => {
    expect(toMib({ bytes: 1.5 * MIB })).toBe(2);
    expect(toMib({ bytes: 0 })).toBe(0);
  });
});

describe("canCollectInto", () => {
  // The check that decides whether the guard may run a collection at all. It is pure, so the case that
  // killed the process once is reachable here without needing a nearly-full heap to reproduce it.
  it("allows a collection while used is below the collector's own band", () => {
    expect(
      canCollectInto({
        reading: { externalBytes: 0, limitBytes: 1000 * MIB, usedBytes: 900 * MIB },
        reserveFraction: 0.05,
      }),
    ).toBe(true);
  });

  it("refuses a collection once used ALONE has passed that band", () => {
    // 950 MiB is exactly the band of a 1,000 MiB limit at 5%, so this is the boundary itself.
    expect(
      canCollectInto({
        reading: { externalBytes: 0, limitBytes: 1000 * MIB, usedBytes: 950 * MIB },
        reserveFraction: 0.05,
      }),
    ).toBe(false);
    expect(
      canCollectInto({
        reading: { externalBytes: 0, limitBytes: 1000 * MIB, usedBytes: 990 * MIB },
        reserveFraction: 0.05,
      }),
    ).toBe(false);
  });

  it("uses the COLLECTOR's band by default, not the load's reserve", () => {
    expect(COLLECT_RESERVE_FRACTION).toBe(0.05);
    expect(HEAP_RESERVE_FRACTION).toBe(0.15);
    expect(canCollectInto({ reading: { externalBytes: 0, limitBytes: 1000 * MIB, usedBytes: 949 * MIB } })).toBe(true);
    expect(canCollectInto({ reading: { externalBytes: 0, limitBytes: 1000 * MIB, usedBytes: 951 * MIB } })).toBe(false);
  });

  it("sits between the two measured readings that bracket it", () => {
    // Measured: `derive` at --max-old-space-size=6656: 5,823 MiB used of a 6,848 MiB ceiling, after
    // reading 1,323 MiB of disk — arithmetically mostly garbage, and it must be collectable. Sharing the
    // load's 15% reserve refused exactly this, which is why every refusal past it quoted a dirty heap.
    const derive = { externalBytes: 0, limitBytes: 6848 * MIB, usedBytes: 5823 * MIB };
    expect(canCollectInto({ reading: derive })).toBe(true);
    expect(canCollectInto({ reading: derive, reserveFraction: HEAP_RESERVE_FRACTION })).toBe(false);
    // Measured: `ask` at the default ceiling: 4,215 MiB LIVE of 4,288 MB is the reading that died inside
    // the collector. It stays refused.
    expect(canCollectInto({ reading: { externalBytes: 0, limitBytes: 4288 * MIB, usedBytes: 4215 * MIB } })).toBe(
      false,
    );
  });
});

describe("the real-isolate edges", () => {
  it("reads a ceiling above what is used, and an external figure", () => {
    const reading = readHeap();
    expect(reading.limitBytes).toBeGreaterThan(reading.usedBytes);
    expect(reading.externalBytes).toBeGreaterThan(0);
  });

  it("can force a collection without the process having been started with --expose-gc", () => {
    // Allocate something collectable, drop it, and prove the binding was reached — the used figure falling
    // is the evidence that a REAL collection ran, not merely that a function was found.
    let junk: unknown[] | undefined = Array.from({ length: 200_000 }, (_unused, i) => ({ i }));
    expect(junk).toHaveLength(200_000);
    junk = undefined;
    const before = readHeap().usedBytes;
    expect(collectGarbage()).toBe(true);
    expect(readHeap().usedBytes).toBeLessThan(before);
  });

  it("guards a trivial projection as fitting and an impossible one as a shortfall", () => {
    expect(guardHeap({ projectedBytes: 1 }).fits).toBe(true);
    const impossible = guardHeap({ projectedBytes: Number.MAX_SAFE_INTEGER });
    expect(impossible.fits).toBe(false);
  });

  it("unguardedHeap always fits", () => {
    expect(unguardedHeap({ projectedBytes: Number.MAX_SAFE_INTEGER }).fits).toBe(true);
  });
});
