import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type ReadWindow, readWindow, spendBudget, utf8BoundaryAtOrBefore } from "../../../talk/codeBounds.js";

describe("readWindow", () => {
  it("carries the whole file and reports no continuation when it fits the budget", () => {
    const window = unwrap(readWindow({ budget: 1024, from: 0, size: 300 }));
    expect(window.start).toBe(0);
    expect(window.end).toBe(300);
    expect(window.truncated).toBe(false);
    expect(window.nextFrom).toBe(null);
  });

  it("truncates at the budget and hands back the byte the next window resumes at", () => {
    const window = unwrap(readWindow({ budget: 100, from: 0, size: 300 }));
    expect(window.end).toBe(100);
    expect(window.truncated).toBe(true);
    expect(window.nextFrom).toBe(100);
  });

  it("advances across a single 2 MiB line, which a line cursor could not", () => {
    const size = 2 * 1024 * 1024;
    const first = unwrap(readWindow({ budget: 262_144, from: 0, size }));
    const second = unwrap(readWindow({ budget: 262_144, from: first.nextFrom!, size }));
    expect(first.nextFrom).toBe(262_144);
    expect(second.start).toBe(262_144);
    expect(second.end).toBe(524_288);
    expect(second.truncated).toBe(true);
  });

  it("reaches the end in exactly the number of windows the budget implies, losing nothing", () => {
    const size = 1000;
    const windows: number[] = [];
    let from: number | null = 0;
    while (from !== null) {
      // Annotated because the loop variable's narrowing would otherwise be inferred through this call's
      // own result — a circularity TypeScript reports as TS7022 on the binding rather than on the loop.
      const read: ReadWindow = unwrap(readWindow({ budget: 300, from, size }));
      windows.push(read.end - read.start);
      from = read.nextFrom;
    }
    expect(windows).toEqual([300, 300, 300, 100]);
  });

  it("treats a continuation that reached the end as an empty, untruncated window rather than an error", () => {
    const window = unwrap(readWindow({ budget: 300, from: 300, size: 300 }));
    expect(window.start).toBe(300);
    expect(window.end).toBe(300);
    expect(window.truncated).toBe(false);
    expect(window.nextFrom).toBe(null);
  });

  it("refuses an offset past the end, which is a computed offset rather than a followed one", () => {
    const failure = unwrapErr(readWindow({ budget: 300, from: 301, size: 300 }));
    expect(failure.code).toBe("WINDOW_INVALID");
    expect(failure.message).toContain("301");
  });

  it("refuses a negative offset", () => {
    const failure = unwrapErr(readWindow({ budget: 300, from: -1, size: 300 }));
    expect(failure.code).toBe("WINDOW_INVALID");
  });

  it("refuses a fractional offset", () => {
    const failure = unwrapErr(readWindow({ budget: 300, from: 1.5, size: 300 }));
    expect(failure.code).toBe("WINDOW_INVALID");
  });

  it("carries nothing, and says the file is unfinished, on a zero budget", () => {
    const window = unwrap(readWindow({ budget: 0, from: 0, size: 300 }));
    expect(window.end).toBe(0);
    expect(window.truncated).toBe(true);
    expect(window.nextFrom).toBe(0);
  });

  it("reports an empty file as complete", () => {
    const window = unwrap(readWindow({ budget: 300, from: 0, size: 0 }));
    expect(window.end).toBe(0);
    expect(window.truncated).toBe(false);
    expect(window.nextFrom).toBe(null);
  });
});

describe("spendBudget", () => {
  it("grants what a file wants while the total has room", () => {
    expect(spendBudget({ spent: 100, total: 1000, want: 200 })).toEqual({ exhausted: false, grant: 200 });
  });

  it("grants only the remainder and reports exhaustion when a file would overrun the total", () => {
    expect(spendBudget({ spent: 900, total: 1000, want: 500 })).toEqual({ exhausted: true, grant: 100 });
  });

  it("grants nothing once the total is spent, so a thousand small hits cannot leak past it", () => {
    expect(spendBudget({ spent: 1000, total: 1000, want: 50 })).toEqual({ exhausted: true, grant: 0 });
  });

  it("reports exhaustion when a file takes the total exactly", () => {
    expect(spendBudget({ spent: 0, total: 500, want: 500 })).toEqual({ exhausted: true, grant: 500 });
  });

  it("grants nothing for a file that wants nothing, without claiming exhaustion", () => {
    expect(spendBudget({ spent: 0, total: 1000, want: 0 })).toEqual({ exhausted: false, grant: 0 });
  });
});

describe("utf8BoundaryAtOrBefore", () => {
  const euro = new TextEncoder().encode("a€b");

  it("leaves a cut that already sits on a lead byte alone", () => {
    expect(utf8BoundaryAtOrBefore({ at: 1, bytes: euro })).toBe(1);
  });

  it("snaps a cut inside a three-byte character back to its lead byte", () => {
    expect(utf8BoundaryAtOrBefore({ at: 2, bytes: euro })).toBe(1);
    expect(utf8BoundaryAtOrBefore({ at: 3, bytes: euro })).toBe(1);
  });

  it("does not snap past the end of a character that completed before the cut", () => {
    expect(utf8BoundaryAtOrBefore({ at: 4, bytes: euro })).toBe(4);
  });

  it("stitches two snapped windows back into the original text", () => {
    const text = "héllo wörld — every accent here is multi-byte";
    const bytes = new TextEncoder().encode(text);
    const cut = utf8BoundaryAtOrBefore({ at: 10, bytes });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const head = decoder.decode(bytes.slice(0, cut));
    const tail = decoder.decode(bytes.slice(cut));
    expect(head + tail).toBe(text);
  });

  it("clamps a cut past the buffer to its length", () => {
    expect(utf8BoundaryAtOrBefore({ at: 99, bytes: euro })).toBe(euro.length);
  });

  it("clamps a negative cut to zero", () => {
    expect(utf8BoundaryAtOrBefore({ at: -5, bytes: euro })).toBe(0);
  });
});
