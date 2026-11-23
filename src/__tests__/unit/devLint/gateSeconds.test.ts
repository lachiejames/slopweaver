import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gateSecondsPath, readGateSeconds, recordGateSeconds } from "../../../devLint/gateSeconds.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("gate seconds", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "gate-seconds-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const plant = ({ text }: { text: string }) => {
    const path = gateSecondsPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };

  it("reads an absent record as no record, which is plan order", () => {
    const read = readGateSeconds({ home });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read).size).toBe(0);
  });

  it("round-trips a run's seconds, rounded to a tenth", () => {
    recordGateSeconds({
      home,
      previous: new Map(),
      results: [
        { elapsedMs: 61_449, name: "prettier" },
        { elapsedMs: 380, name: "control-bytes" },
      ],
    });

    expect([...unwrap(readGateSeconds({ home }))]).toEqual([
      ["prettier", 61.4],
      ["control-bytes", 0.4],
    ]);
  });

  // A lane that runs a subset must not erase what the rest took last time.
  it("keeps a gate this run did not time, and one whose result carries no elapsed time", () => {
    recordGateSeconds({
      home,
      previous: new Map([
        ["knip", 21.3],
        ["oxlint", 40],
      ]),
      results: [{ elapsedMs: 4_000, name: "hygiene" }, { name: "oxlint" }],
    });

    expect(Object.fromEntries(unwrap(readGateSeconds({ home })))).toEqual({ hygiene: 4, knip: 21.3, oxlint: 40 });
  });

  it("writes a versioned record a reader can diff", () => {
    recordGateSeconds({ home, previous: new Map(), results: [{ elapsedMs: 1_000, name: "knip" }] });

    expect(readFileSync(gateSecondsPath({ home }), "utf8")).toBe(
      '{\n  "seconds": {\n    "knip": 1\n  },\n  "version": 1\n}\n',
    );
  });

  it("never throws when the record cannot be written, so a finished lap keeps its verdict", () => {
    // A directory where the record goes: the atomic rename onto it fails, exactly as an unwritable home would.
    mkdirSync(join(gateSecondsPath({ home }), "occupied"), { recursive: true });

    expect(() =>
      recordGateSeconds({ home, previous: new Map(), results: [{ elapsedMs: 1_000, name: "knip" }] }),
    ).not.toThrow();
    expect(unwrapErr(readGateSeconds({ home })).code).toBe("GATE_SECONDS_MALFORMED");
  });

  it("refuses a record that is not a regular file before reading it, so a FIFO can never block the lap", () => {
    mkdirSync(gateSecondsPath({ home }), { recursive: true });

    const error = unwrapErr(readGateSeconds({ home }));

    expect(error.code).toBe("GATE_SECONDS_MALFORMED");
    expect(error.message).toBe(`${gateSecondsPath({ home })} is not a gate-seconds record: not a regular file`);
  });

  it("answers a record whose directory denies access as unreadable, never a throw", () => {
    plant({ text: JSON.stringify({ seconds: { knip: 1 }, version: 1 }) });
    const directory = dirname(gateSecondsPath({ home }));
    chmodSync(directory, 0o000);
    try {
      const error = unwrapErr(readGateSeconds({ home }));

      expect(error.code).toBe("GATE_SECONDS_UNREADABLE");
      expect(error.message).toContain("EACCES");
    } finally {
      chmodSync(directory, 0o700);
    }
  });

  it("refuses a record that is not JSON, naming the file", () => {
    plant({ text: "{ not json" });

    const error = unwrapErr(readGateSeconds({ home }));

    expect(error.code).toBe("GATE_SECONDS_NOT_JSON");
    expect(error.path).toBe(gateSecondsPath({ home }));
    expect(error.message).toContain(`${gateSecondsPath({ home })} is not JSON`);
  });

  it("refuses a record of the wrong shape rather than ordering by it", () => {
    plant({ text: JSON.stringify({ seconds: { knip: -1 }, version: 1 }) });
    const error = unwrapErr(readGateSeconds({ home }));

    expect(error.code).toBe("GATE_SECONDS_MALFORMED");
    expect(error.message).toContain("is not a gate-seconds record");
  });
});
