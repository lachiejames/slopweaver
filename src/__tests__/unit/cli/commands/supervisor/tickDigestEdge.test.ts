/**
 * What `tick open`'s digest reads beside its captured readings: the previous pass's holds, said UNKNOWN when its
 * file is missing or malformed, and the checkout a broken recipe's fix row resolves to, said as set-repo's own
 * refusal when there is none.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  persistTickDigest,
  readPriorDigest,
  readPriorHolds,
  readRecipeFixCheckout,
  TICK_DIGEST_FILE,
} from "../../../../../cli/commands/supervisor/tickDigestEdge.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tick-edge-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("readPriorHolds", () => {
  it("reads the previous tick's holds, none on the seat's first tick", () => {
    mkdirSync(join(dir, "tick-2"));
    const judgement = {
      claim: "waits on Smith",
      judgementId: "j-1",
      kind: "hold-rationale",
      subject: { id: "land-18099", kind: "handover", label: "EEEE-861 rebase" },
      whyNotDerived: "risk-call",
      witness: { kind: "command", ref: "slopweaver handover list" },
    };
    writeFileSync(join(dir, "tick-2", "tick.json"), JSON.stringify({ judgements: [judgement] }));

    expect([readPriorHolds({ dir, tick: 1 }), readPriorHolds({ dir, tick: 3 })]).toEqual([
      { kind: "none" },
      { held: new Map([["land-18099", "waits on Smith"]]), kind: "read", tick: 2 },
    ]);
  });

  it("calls a missing or malformed previous tick unreadable, never an empty one", () => {
    mkdirSync(join(dir, "tick-2"));
    writeFileSync(join(dir, "tick-2", "tick.json"), "{ not json");
    const missing = readPriorHolds({ dir, tick: 2 });
    const malformed = readPriorHolds({ dir, tick: 3 });

    expect([missing.kind, malformed.kind]).toEqual(["unreadable", "unreadable"]);
    expect([JSON.stringify(missing), JSON.stringify(malformed)]).toEqual([
      expect.stringContaining(join(dir, "tick-1", "tick.json")),
      expect.stringContaining(join(dir, "tick-2", "tick.json")),
    ]);
  });
});

describe("readPriorDigest and persistTickDigest", () => {
  it("round-trips a digest exactly — order, duplicates, inner spaces — and reads none on the first tick", () => {
    mkdirSync(join(dir, "tick-2"));
    const lines = ["queue leader: none", "kept: x", "kept: x", "watch:  two  spaces "];
    const written = persistTickDigest({ dir: join(dir, "tick-2"), lines });

    expect(written.isOk()).toBe(true);
    expect(unwrap(written)).toBe(join(dir, "tick-2", TICK_DIGEST_FILE));
    expect([readPriorDigest({ dir, tick: 1 }), readPriorDigest({ dir, tick: 3 })]).toEqual([
      { kind: "none" },
      { kind: "read", lines, tick: 2 },
    ]);
  });

  it("keeps an entry carrying a newline or a backslash one entry, never a phantom second line", () => {
    mkdirSync(join(dir, "tick-2"));
    mkdirSync(join(dir, "tick-3"));
    const lines = ["ready: P1 r1 — seed\nevent: outage svc — new", "path: C:\\n\\x", "", "kept: \\\\n"];
    persistTickDigest({ dir: join(dir, "tick-2"), lines });
    writeFileSync(join(dir, "tick-3", TICK_DIGEST_FILE), "cut: short");

    expect([readPriorDigest({ dir, tick: 3 }), readPriorDigest({ dir, tick: 4 })]).toEqual([
      { kind: "read", lines, tick: 2 },
      {
        kind: "unreadable",
        tick: 3,
        why: `${join(dir, "tick-3", TICK_DIGEST_FILE)}: does not end in a newline, so its last entry was cut short`,
      },
    ]);
  });

  it("calls an earlier tick with no digest file unreadable — an older build's open, never an empty digest", () => {
    mkdirSync(join(dir, "tick-2"));
    writeFileSync(join(dir, "tick-2", "tick.json"), "{}");

    expect(readPriorDigest({ dir, tick: 3 })).toEqual({
      kind: "unreadable",
      tick: 2,
      why: expect.stringContaining(join(dir, "tick-2", TICK_DIGEST_FILE)),
    });
  });

  it("calls a linked digest unreadable rather than folding against another tick's baseline", () => {
    mkdirSync(join(dir, "tick-1"));
    mkdirSync(join(dir, "tick-9"));
    writeFileSync(join(dir, "tick-9", TICK_DIGEST_FILE), "events: no alerts\n");
    symlinkSync(join("..", "tick-9", TICK_DIGEST_FILE), join(dir, "tick-1", TICK_DIGEST_FILE));

    expect(readPriorDigest({ dir, tick: 2 })).toEqual({
      kind: "unreadable",
      tick: 1,
      why: expect.stringContaining(join(dir, "tick-1", TICK_DIGEST_FILE)),
    });
  });

  it("calls a linked tick directory unreadable, whatever regular digest it holds", () => {
    mkdirSync(join(dir, "tick-9"));
    writeFileSync(join(dir, "tick-9", TICK_DIGEST_FILE), "events: no alerts\n");
    symlinkSync("tick-9", join(dir, "tick-1"));

    expect(readPriorDigest({ dir, tick: 2 })).toEqual({
      kind: "unreadable",
      tick: 1,
      why: `${join(dir, "tick-1")}: is not a directory this seat wrote (absent, or a link)`,
    });
  });

  it("calls a FIFO or non-UTF-8 digest unreadable, never hanging on the open", () => {
    mkdirSync(join(dir, "tick-1"));
    mkdirSync(join(dir, "tick-2"));
    execFileSync("mkfifo", [join(dir, "tick-1", TICK_DIGEST_FILE)]);
    writeFileSync(join(dir, "tick-2", TICK_DIGEST_FILE), Buffer.from([0x65, 0x3a, 0xff, 0x0a]));

    expect([readPriorDigest({ dir, tick: 2 }), readPriorDigest({ dir, tick: 3 })]).toEqual([
      { kind: "unreadable", tick: 1, why: `${join(dir, "tick-1", TICK_DIGEST_FILE)}: is not a regular file` },
      { kind: "unreadable", tick: 2, why: `${join(dir, "tick-2", TICK_DIGEST_FILE)}: is not valid UTF-8` },
    ]);
  });

  it("never reads a tick past the safe-integer range, where n-1 would name the tick itself", () => {
    const tick = 1e21;
    // The tick's OWN directory, with a digest: what `n - 1` would read if nothing refused it.
    mkdirSync(join(dir, `tick-${String(tick)}`));
    writeFileSync(join(dir, `tick-${String(tick)}`, TICK_DIGEST_FILE), "reconcile: aligned\n");

    expect(readPriorDigest({ dir, tick })).toEqual({
      kind: "unreadable",
      tick: tick - 1,
      why: "tick 1e+21 is past the safe-integer range, so n-1 is not exact",
    });
  });

  it("refuses to persist where the tick directory is a file, naming the digest file", () => {
    writeFileSync(join(dir, "tick-9"), "not a directory");
    const written = persistTickDigest({ dir: join(dir, "tick-9"), lines: ["a: 1"] });

    expect(written.isErr()).toBe(true);
    expect(unwrapErr(written).code).toBe("FILE_FAILED");
    expect(unwrapErr(written).message).toContain(join(dir, "tick-9", TICK_DIGEST_FILE));
  });
});

describe("readRecipeFixCheckout", () => {
  it("carries set-repo's own refusal when this home declares no slopweaver checkout", () => {
    expect(readRecipeFixCheckout({ home: dir })).toEqual({
      kind: "unresolved",
      why: expect.stringContaining("slopweaver"),
    });
  });
});
