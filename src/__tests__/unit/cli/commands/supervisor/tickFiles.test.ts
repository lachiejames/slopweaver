/**
 * The shared reads of `supervisor tick`: a JSON file named when it will not parse, the two snapshot ages the
 * render judges, and a reading that never completed digested as how it ended rather than as empty.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  datableRun,
  digestReadings,
  fileAgeMinutes,
  fileIdentity,
  homeOutsideSeat,
  readJson,
  readRegularFileBytes,
  runAgeMinutes,
  underSeatByIdentity,
} from "../../../../../cli/commands/supervisor/tickFiles.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { orgHealthLines } from "../../../../../supervisor/digestNotice.js";
import { TickWorkflowErrors } from "../../../../../supervisor/tickWorkflowErrors.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tick-files-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("datableRun", () => {
  it("passes a list whose nowIso the render can date", () => {
    const passed = datableRun({ bytes: Buffer.from('{"nowIso":"2026-10-05T01:00:00.000Z"}'), path: "/s/l.json" });

    expect(unwrap(passed)).toBeUndefined();
  });

  it("refuses an ISO instant Date.parse cannot read, a missing nowIso, a non-object and bytes that are not JSON", () => {
    const refused = [
      '{"nowIso":"2026-01-01T00:00:00,000Z"}',
      '{"generatedIso":"2026-10-05T01:00:00.000Z"}',
      '["2026-10-05T01:00:00.000Z"]',
      "not json",
    ].map((text) => unwrapErr(datableRun({ bytes: Buffer.from(text), path: "/s/l.json" })));
    const expected = TickWorkflowErrors.captureInvalid({
      path: "/s/l.json",
      reason: "carries no nowIso the render can date, so its age could not be judged",
    });

    expect(refused).toEqual([expected, expected, expected, expected]);
    expect(expected.message).toBe("/s/l.json: carries no nowIso the render can date, so its age could not be judged");
  });
});

describe("readRegularFileBytes", () => {
  it("returns a regular file's exact bytes, invalid UTF-8 included", () => {
    writeFileSync(join(dir, "list.json"), Buffer.from([0x7b, 0xff, 0x7d]));

    expect([...unwrap(readRegularFileBytes({ path: join(dir, "list.json") }))]).toEqual([0x7b, 0xff, 0x7d]);
  });

  it("refuses a directory", () => {
    expect(unwrapErr(readRegularFileBytes({ path: dir }))).toBe(`${dir}: is not a regular file`);
  });

  it("refuses a link rather than following it to a regular file", () => {
    writeFileSync(join(dir, "real.json"), "{}");
    symlinkSync(join(dir, "real.json"), join(dir, "linked.json"));

    expect(unwrapErr(readRegularFileBytes({ path: join(dir, "linked.json") }))).toContain("ELOOP");
  });

  it("refuses a FIFO with no writer instead of hanging on its open", () => {
    const path = join(dir, "handed-list");
    execFileSync("mkfifo", [path]);

    expect(unwrapErr(readRegularFileBytes({ path }))).toBe(`${path}: is not a regular file`);
  });
});

describe("fileIdentity", () => {
  it("keeps two inodes apart past 2^53, where a Number would round them together", () => {
    const first = fileIdentity({ dev: 1n, ino: 9007199254740992n });
    const second = fileIdentity({ dev: 1n, ino: 9007199254740993n });

    expect(first).toBe("1:9007199254740992");
    expect(second).toBe("1:9007199254740993");
  });
});

describe("underSeatByIdentity", () => {
  const identities = new Map([
    ["/work/Seat", "1:7"],
    ["/work/seat", "1:7"],
    ["/work", "1:2"],
    ["/", "1:1"],
  ]);
  const identityOf: Parameters<typeof underSeatByIdentity>[0]["identityOf"] = (candidate) => identities.get(candidate);

  it("finds the seat above a path spelled another way, through a component that does not exist yet", () => {
    expect(underSeatByIdentity({ identityOf, path: "/work/seat/new/home", seatIdentity: "1:7" })).toBe(true);
  });

  it("walks to the root and stops when no ancestor is the seat", () => {
    expect(underSeatByIdentity({ identityOf, path: "/work/other/home", seatIdentity: "1:7" })).toBe(false);
  });
});

describe("homeOutsideSeat", () => {
  it.runIf(process.platform === "darwin")(
    "refuses a home under the seat spelled in another case, on the case-insensitive filesystem macOS ships",
    () => {
      mkdirSync(join(dir, "Seat"));

      const refused = homeOutsideSeat({ dir: join(dir, "Seat"), home: join(dir, "seat", "home") });

      expect(unwrapErr(refused).message).toContain("--home sits inside the seat directory");
    },
  );

  it("passes a home beside the seat", () => {
    mkdirSync(join(dir, "Seat"));

    expect(homeOutsideSeat({ dir: join(dir, "Seat"), home: join(dir, "home") }).isOk()).toBe(true);
  });
});

describe("readJson", () => {
  it("parses a document whole", () => {
    writeFileSync(join(dir, "a.json"), '{"a":1}');

    expect(unwrap(readJson({ path: join(dir, "a.json") }))).toEqual({ a: 1 });
  });

  it("names the file that will not parse", () => {
    writeFileSync(join(dir, "b.json"), "receipt line\n{}");

    expect(unwrapErr(readJson({ path: join(dir, "b.json") }))).toContain(join(dir, "b.json"));
  });
});

describe("snapshot ages", () => {
  it("reads open pages by mtime and the owner's list by its own stamp", () => {
    const pages = join(dir, "open-pages.json");
    writeFileSync(pages, "[]");
    utimesSync(pages, new Date("2026-09-27T00:00:00Z"), new Date("2026-09-27T00:00:00Z"));
    writeFileSync(join(dir, "run.json"), JSON.stringify({ nowIso: "2026-09-27T00:30:00Z" }));

    expect(fileAgeMinutes({ nowIso: "2026-09-27T01:30:00Z", path: pages })).toBe(90);
    expect(runAgeMinutes({ nowIso: "2026-09-27T01:30:00Z", path: join(dir, "run.json") })).toBe(60);
  });

  it("has no age for a file the seat does not hold, or a list with no stamp", () => {
    writeFileSync(join(dir, "run.json"), "{}");

    expect(fileAgeMinutes({ nowIso: "2026-09-27T01:30:00Z", path: join(dir, "none.json") })).toBe(undefined);
    expect(runAgeMinutes({ nowIso: "2026-09-27T01:30:00Z", path: join(dir, "run.json") })).toBe(undefined);
  });
});

describe("digestReadings", () => {
  it("parses a completed JSON reading, keeps text, and names one that ran out of budget", () => {
    writeFileSync(join(dir, "capacity.json"), '{"hold":false}');
    writeFileSync(join(dir, "gauge.txt"), "REACT NOW: x\n");
    const base = { argv: [], bytes: 1, errFile: "e", exitCode: 0 };
    const exited = { durationMs: 1, exitCode: 0, kind: "exited" as const };
    const timedOut = { durationMs: 9, kind: "timed-out" as const, signal: "SIGKILL" as const, timeoutMs: 8 };

    const map = digestReadings({
      dir,
      readings: [
        { ...base, child: exited, completed: true, file: "capacity.json", name: "capacity" },
        { ...base, child: exited, completed: true, file: "gauge.txt", name: "gauge" },
        { ...base, child: timedOut, completed: false, exitCode: null, file: "listen.json", name: "listen" },
      ],
    });

    expect([...map.entries()]).toEqual([
      ["capacity", { kind: "json", value: { hold: false } }],
      ["gauge", { kind: "text", text: "REACT NOW: x\n" }],
      ["listen", { child: timedOut, kind: "unavailable" }],
    ]);
  });

  it("carries a failed org-health read and a refused note from the capture into the digest's lines", () => {
    writeFileSync(
      join(dir, "org-health.json"),
      JSON.stringify({
        actions: [{ detail: "the hand register would not write", kind: "refused", stepId: "mon-org-health-inc98" }],
        readings: [{ because: "the last read did not finish", monitorId: "org-health", state: "unmeasurable" }],
      }),
    );
    const base = { argv: [], bytes: 1, errFile: "e" };
    const deferred = { durationMs: 40, exitCode: 4, kind: "exited" as const };
    const exited = { durationMs: 1, exitCode: 0, kind: "exited" as const };

    const readings = digestReadings({
      dir,
      readings: [
        {
          ...base,
          child: deferred,
          completed: false,
          exitCode: 4,
          file: "org-health-read.json",
          name: "org-health-read",
        },
        { ...base, child: exited, completed: true, exitCode: 0, file: "org-health.json", name: "org-health" },
      ],
    });

    expect(
      orgHealthLines({
        inputs: {
          openPagesAgeMinutes: undefined,
          priorHolds: { kind: "none" },
          readings,
          recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
          runAgeMinutes: undefined,
        },
      }),
    ).toEqual([
      "org-health-read: unavailable — exit 4",
      "org health: UNMEASURABLE — the last read did not finish",
      "org health: refused mon-org-health-inc98 — the hand register would not write",
    ]);
  });

  it("never caps a refusal behind the overflow line, however many actions worked before it", () => {
    const settled = Array.from({ length: 9 }, (_, index) => ({
      detail: "a duplicate occurrence",
      kind: "settled",
      stepId: `mon-org-health-dup${String(index)}`,
    }));
    writeFileSync(
      join(dir, "org-health.json"),
      JSON.stringify({
        actions: [
          ...settled,
          { detail: "the note would not re-raise", kind: "refused", stepId: "mon-org-health-inc98" },
        ],
        readings: [{ monitorId: "org-health", state: "clear" }],
      }),
    );
    const exited = { durationMs: 1, exitCode: 0, kind: "exited" as const };
    const readings = digestReadings({
      dir,
      readings: [
        {
          argv: [],
          bytes: 1,
          child: exited,
          completed: true,
          errFile: "e",
          exitCode: 0,
          file: "org-health.json",
          name: "org-health",
        },
      ],
    });

    const lines = orgHealthLines({
      inputs: {
        openPagesAgeMinutes: undefined,
        priorHolds: { kind: "none" },
        readings,
        recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
        runAgeMinutes: undefined,
      },
    });
    expect(lines.slice(0, 3)).toEqual([
      "org-health-read: not captured this tick",
      `org health: UNMEASURABLE — this tick's incident read did not complete, so the pass's "org health: clear" is not now's`,
      "org health: refused mon-org-health-inc98 — the note would not re-raise",
    ]);
    expect(lines.length).toBe(3 + 8 + 1);
  });
});
