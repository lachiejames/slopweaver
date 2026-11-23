/**
 * Unit: the `calendar free` shell. The reader is injected, so what is under test is dispatch, the
 * human-vs-`--json` choice, and the exit code — no Google account and no network.
 */
import { describe, expect, it } from "vitest";
import { type CalendarFreeDeps, runCalendarFree } from "../../../../../cli/commands/calendar/freeRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { CalendarErrors } from "../../../../../live/calendar/errors.js";
import type { CalendarFreeResult } from "../../../../../live/calendar/free.js";

const NOW = new Date("2026-09-13T01:00:00.000Z");

const FREE: CalendarFreeResult = {
  document: {
    coverage: { detail: "1 open stretch(es)", kind: "bounded", residue: ["r1"] },
    data: {},
    readAtIso: "2026-09-13T01:00:00.000Z",
    source: "calendar",
    target: { address: "primary,a@x.test", identity: "me@x.test", kind: "free/busy window" },
  },
  free: {
    account: "me@x.test",
    between: { endMinute: 1020, startMinute: 540 },
    calendars: [
      { busy: [], calendarId: "primary", error: undefined },
      { busy: [{ endMs: 1, startMs: 0 }], calendarId: "a@x.test", error: undefined },
    ],
    minutes: 30,
    slots: [{ endMs: Date.parse("2026-09-14T01:00:00Z"), startMs: Date.parse("2026-09-14T00:00:00Z") }],
    timeMaxIso: "2026-09-14T14:00:00.000Z",
    timeMinIso: "2026-09-13T14:00:00.000Z",
    zone: "Australia/Melbourne",
  },
};

/** Deps that record every call and answer with one fixed result. */
function deps({ answer }: { answer: CalendarFreeResult | undefined }): {
  deps: CalendarFreeDeps;
  out: string[];
  diagnostics: string[];
  calls: unknown[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const calls: unknown[] = [];
  return {
    calls,
    deps: {
      free: async (args) => {
        calls.push(args);
        return answer === undefined ? err(CalendarErrors.notConnected()) : ok(answer);
      },
      now: () => NOW,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("runCalendarFree", () => {
  it("passes the parsed request to the reader and renders the human text", async () => {
    const d = deps({ answer: FREE });
    const code = await runCalendarFree({
      deps: d.deps,
      rest: [
        "--minutes",
        "30",
        "--with",
        "a@x.test",
        "--from",
        "2026-09-14",
        "--days",
        "1",
        "--between",
        "09:00-17:00",
      ],
    });
    expect(code).toBe(EXIT_OK);
    expect(d.calls).toStrictEqual([
      {
        between: { endMinute: 1020, startMinute: 540 },
        calendarIds: ["primary", "a@x.test"],
        home: undefined,
        minutes: 30,
        timeMaxIso: "2026-09-15T00:00:00.000Z",
        timeMinIso: "2026-09-14T00:00:00.000Z",
        zone: undefined,
      },
    ]);
    expect(d.out[0]).toContain("calendar free: me@x.test");
    expect(d.out[0]).toContain("  a@x.test: 1 busy interval(s)");
    expect(d.out[0]).toContain("  2026-09-14 Mon 10:00 → 11:00 (60 min)");
  });

  it("shows the whole instant when a slot ends on the NEXT local day, never a bare time reading backwards", async () => {
    const d = deps({
      answer: {
        ...FREE,
        free: {
          ...FREE.free,
          slots: [{ endMs: Date.parse("2026-10-04T13:00:00Z"), startMs: Date.parse("2026-10-03T22:00:00Z") }],
        },
      },
    });
    expect(await runCalendarFree({ deps: d.deps, rest: ["--minutes", "30"] })).toBe(EXIT_OK);
    expect(d.out[0]).toContain("2026-10-04 Sun 09:00 → 2026-10-05 Mon 00:00 (900 min)");
  });

  it("emits the provider document under --json", async () => {
    const d = deps({ answer: FREE });
    expect(await runCalendarFree({ deps: d.deps, rest: ["--minutes", "30", "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(d.out[0]!)).toStrictEqual(FREE.document);
  });

  it("refuses on the parser before touching the reader", async () => {
    const d = deps({ answer: FREE });
    expect(await runCalendarFree({ deps: d.deps, rest: [] })).toBe(EXIT_USAGE);
    expect(d.calls).toStrictEqual([]);
    expect(d.diagnostics[0]).toContain("--minutes is required");
  });

  it("reports a reader failure by its message and exits non-zero", async () => {
    const d = deps({ answer: undefined });
    expect(await runCalendarFree({ deps: d.deps, rest: ["--minutes", "30"] })).toBe(EXIT_ERROR);
    expect(d.diagnostics).toStrictEqual([CalendarErrors.notConnected().message]);
  });
});
