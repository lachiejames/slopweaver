/**
 * `loopBreakage` — the required cause, the pure line, the once-per-death guard, and a real append round-trip
 * in a temp home.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  LOOP_BREAKAGE_FILE,
  type LoopBreakage,
  loopBreakageAlreadyRecorded,
  loopBreakageLine,
  recordLoopBreakage,
  requireCause,
} from "../../../../live/turn/loopBreakage.js";
import { LoopBreakageErrors } from "../../../../live/turn/loopBreakageErrors.js";

const BREAKAGE: LoopBreakage = {
  atIso: "2026-08-26T08:40:38.000Z",
  cause: "workspace-gone: the reviewer's cmux workspace no longer exists, so its session went with it",
  didInstead: "reported the death and left the verdict path untouched",
  error: "cmux has no workspace id-workspace:9",
  thread: "C1/1785000000.000100",
  what: "the reviewer for this ask died — workspace workspace:9 (id-workspace:9)",
};

function freshHome(): string {
  const home = join(tmpdir(), `slopweaver-loop-breakage-${String(process.pid)}-${String(Math.random()).slice(2)}`);
  mkdirSync(home, { recursive: true });
  return home;
}

describe("requireCause", () => {
  it("passes a row whose every field is filled, unchanged", () => {
    expect(unwrap(requireCause({ breakage: BREAKAGE }))).toStrictEqual(BREAKAGE);
  });

  it("refuses an empty cause as CAUSE_MISSING", () => {
    expect(unwrapErr(requireCause({ breakage: { ...BREAKAGE, cause: "" } }))).toStrictEqual(
      LoopBreakageErrors.causeMissing(),
    );
  });

  it("refuses a whitespace-only cause — a blank is not an explanation", () => {
    expect(unwrapErr(requireCause({ breakage: { ...BREAKAGE, cause: "  \n\t" } })).code).toBe("CAUSE_MISSING");
  });

  it("reports the missing cause FIRST, even when another field is blank too", () => {
    expect(unwrapErr(requireCause({ breakage: { ...BREAKAGE, cause: "", what: "" } })).code).toBe("CAUSE_MISSING");
  });

  it("refuses a blank didInstead and names that field", () => {
    expect(unwrapErr(requireCause({ breakage: { ...BREAKAGE, didInstead: " " } }))).toStrictEqual(
      LoopBreakageErrors.fieldMissing({ field: "didInstead" }),
    );
  });

  it("refuses a blank thread and names that field", () => {
    expect(unwrapErr(requireCause({ breakage: { ...BREAKAGE, thread: "" } }))).toStrictEqual(
      LoopBreakageErrors.fieldMissing({ field: "thread" }),
    );
  });

  it("refuses an ABSENT cause the same way as a blank one", () => {
    const { cause: _dropped, ...noCause } = BREAKAGE;
    expect(unwrapErr(requireCause({ breakage: noCause })).code).toBe("CAUSE_MISSING");
  });

  it("refuses a blank atIso — a row no windowed reader could place", () => {
    expect(unwrapErr(requireCause({ breakage: { ...BREAKAGE, atIso: "" } }))).toStrictEqual(
      LoopBreakageErrors.fieldMissing({ field: "atIso" }),
    );
  });

  it("refuses a blank what and a blank error, each by name", () => {
    expect(unwrapErr(requireCause({ breakage: { ...BREAKAGE, what: "" } })).message).toBe(
      "a loop-breakage row needs a non-empty what",
    );
    expect(unwrapErr(requireCause({ breakage: { ...BREAKAGE, error: "" } })).message).toBe(
      "a loop-breakage row needs a non-empty error",
    );
  });
});

describe("loopBreakageLine", () => {
  it("renders the hand-written rows' field names plus a cause, so the ledger stays one ledger", () => {
    expect(JSON.parse(loopBreakageLine({ breakage: BREAKAGE }))).toStrictEqual({
      at: "2026-08-26T08:40:38.000Z",
      cause: "workspace-gone: the reviewer's cmux workspace no longer exists, so its session went with it",
      didInstead: "reported the death and left the verdict path untouched",
      error: "cmux has no workspace id-workspace:9",
      thread: "C1/1785000000.000100",
      what: "the reviewer for this ask died — workspace workspace:9 (id-workspace:9)",
    });
  });

  it("carries no trailing newline — the appender owns that", () => {
    expect(loopBreakageLine({ breakage: BREAKAGE }).endsWith("\n")).toBe(false);
  });
});

describe("loopBreakageAlreadyRecorded", () => {
  const text = `${loopBreakageLine({ breakage: BREAKAGE })}\n`;

  it("matches on thread AND what together", () => {
    expect(loopBreakageAlreadyRecorded({ text, thread: BREAKAGE.thread, what: BREAKAGE.what })).toBe(true);
  });

  it("does not match a second death on the same ask, which names a different workspace", () => {
    expect(
      loopBreakageAlreadyRecorded({
        text,
        thread: BREAKAGE.thread,
        what: "the reviewer for this ask died — workspace workspace:12 (id-workspace:12)",
      }),
    ).toBe(false);
  });

  it("does not match the same failure on a different ask", () => {
    expect(loopBreakageAlreadyRecorded({ text, thread: "C2/1785000000.000200", what: BREAKAGE.what })).toBe(false);
  });

  it("skips a malformed line rather than treating the file as unreadable", () => {
    expect(
      loopBreakageAlreadyRecorded({
        text: `not json\n\n${loopBreakageLine({ breakage: BREAKAGE })}\n`,
        thread: BREAKAGE.thread,
        what: BREAKAGE.what,
      }),
    ).toBe(true);
  });

  it("is false against an empty ledger", () => {
    expect(loopBreakageAlreadyRecorded({ text: "", thread: BREAKAGE.thread, what: BREAKAGE.what })).toBe(false);
  });
});

describe("recordLoopBreakage", () => {
  it("refuses a row with no cause and writes nothing — not even the ledger directory", () => {
    const home = freshHome();
    expect(recordLoopBreakage({ breakage: { ...BREAKAGE, cause: "" }, home })).toStrictEqual({
      error: LoopBreakageErrors.causeMissing(),
      kind: "refused",
      why: LoopBreakageErrors.causeMissing().message,
      written: false,
    });
    expect(existsSync(join(home, "ledgers", LOOP_BREAKAGE_FILE))).toBe(false);
  });

  it("appends one row to ledgers/loop-breakage.jsonl, creating the directory", () => {
    const home = freshHome();
    expect(recordLoopBreakage({ breakage: BREAKAGE, home })).toStrictEqual({ written: true });
    const text = readFileSync(join(home, "ledgers", LOOP_BREAKAGE_FILE), "utf8");
    expect(text).toBe(`${loopBreakageLine({ breakage: BREAKAGE })}\n`);
  });

  it("writes ONE row for one death, however many times it is polled", () => {
    const home = freshHome();
    recordLoopBreakage({ breakage: BREAKAGE, home });
    expect(recordLoopBreakage({ breakage: { ...BREAKAGE, atIso: "2026-08-26T08:41:00.000Z" }, home })).toStrictEqual({
      kind: "duplicate",
      why: "already recorded — one thread and step is one row, however many times it is reported",
      written: false,
    });
    expect(
      readFileSync(join(home, "ledgers", LOOP_BREAKAGE_FILE), "utf8")
        .trim()
        .split("\n"),
    ).toHaveLength(1);
  });

  it("appends alongside rows a session wrote by hand, rather than replacing the file", () => {
    const home = freshHome();
    mkdirSync(join(home, "ledgers"), { recursive: true });
    const handWritten =
      '{"at":"2026-08-26T07:52:18Z","thread":"live/boot","what":"a skill gap","error":"e","didInstead":"d"}';
    writeFileSync(join(home, "ledgers", LOOP_BREAKAGE_FILE), `${handWritten}\n`, "utf8");
    recordLoopBreakage({ breakage: BREAKAGE, home });
    const lines = readFileSync(join(home, "ledgers", LOOP_BREAKAGE_FILE), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(handWritten);
  });

  // The audit's probe: a write killed partway leaves the ledger with no trailing newline. Appended straight
  // onto that tail, the next death fused into one unparseable line, so the dedup could not see it and the same
  // death was written a second time.
  it("starts its row on a fresh line after a torn tail, so the death parses and is recorded once", () => {
    const home = freshHome();
    mkdirSync(join(home, "ledgers"), { recursive: true });
    const path = join(home, "ledgers", LOOP_BREAKAGE_FILE);
    const torn = '{"at":"2026-08-26T07:52:18Z","thread":"live/bo';
    writeFileSync(path, torn, "utf8");
    expect(recordLoopBreakage({ breakage: BREAKAGE, home })).toStrictEqual({ written: true });
    expect(recordLoopBreakage({ breakage: { ...BREAKAGE, atIso: "2026-08-26T08:41:00.000Z" }, home })).toStrictEqual({
      kind: "duplicate",
      why: "already recorded — one thread and step is one row, however many times it is reported",
      written: false,
    });
    expect(readFileSync(path, "utf8")).toBe(`${torn}\n${loopBreakageLine({ breakage: BREAKAGE })}\n`);
  });
});
