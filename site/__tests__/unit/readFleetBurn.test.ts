/*
 * The recorded `fleet burn --json` reader: each host's three states read exactly, and any host that will not read
 * refusing the whole report rather than drawing a plausible half.
 */
import { describe, expect, it } from "vitest";

import { readFleetBurn, readFleetBurnReading } from "../../components/live/readFleetBurn";
import { readSeats } from "../../components/live/readNow";

/** A report as the verb prints one, a measured Claude and a partial Codex. */
const REPORT = {
  activeWithinMinutes: 10,
  fromIso: "2026-10-07T09:00:00.000Z",
  hosts: {
    claude: {
      activeSessions: 4,
      kind: "measured",
      outputTokens: 8_950_000,
      projectedWeekTokens: 20_510_000_000,
      sessions: 210,
      totalTokens: 2_930_000_000,
    },
    codex: {
      activeSessions: 1,
      kind: "partial",
      outputTokens: 2000,
      problems: ["/r.jsonl: its cumulative token counter fell inside the window"],
      sessions: 3,
      totalTokens: 41_000,
    },
  },
  observedAtIso: "2026-10-08T09:00:00.000Z",
  windowHours: 24,
};

describe("readFleetBurn", () => {
  it("reads a measured host and a partial one exactly", () => {
    expect(readFleetBurn(REPORT)).toEqual({
      activeWithinMinutes: 10,
      claude: REPORT.hosts.claude,
      codex: REPORT.hosts.codex,
      windowHours: 24,
    });
  });

  it("reads an unavailable host as its reason alone", () => {
    const report = { ...REPORT, hosts: { ...REPORT.hosts, codex: { kind: "unavailable", why: "no Codex home" } } };
    expect(readFleetBurn(report)!.codex).toEqual({ kind: "unavailable", why: "no Codex home" });
  });

  it("refuses the whole report when one host's state is unknown or a field its state carries is missing", () => {
    const { projectedWeekTokens: _dropped, ...noProjection } = REPORT.hosts.claude;
    expect([
      readFleetBurn({ ...REPORT, hosts: { ...REPORT.hosts, codex: { kind: "estimated" } } }),
      readFleetBurn({ ...REPORT, hosts: { ...REPORT.hosts, claude: noProjection } }),
      readFleetBurn({ ...REPORT, hosts: { claude: REPORT.hosts.claude } }),
      readFleetBurn({ ...REPORT, windowHours: "24" }),
      readFleetBurn("not a report"),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("refuses a negative or fractional count, and a zero-length window, rather than drawing it as measured", () => {
    const claude = (over: Record<string, unknown>) => ({
      ...REPORT,
      hosts: { ...REPORT.hosts, claude: { ...REPORT.hosts.claude, ...over } },
    });
    expect([
      readFleetBurn(claude({ projectedWeekTokens: -7, totalTokens: -1 })),
      readFleetBurn(claude({ sessions: 1.5 })),
      readFleetBurn(claude({ activeSessions: -1 })),
      readFleetBurn(claude({ activeSessions: 4, sessions: 0 })),
      readFleetBurn(claude({ outputTokens: 2, projectedWeekTokens: 7, totalTokens: 1 })),
      readFleetBurn(
        claude({ activeSessions: 0, outputTokens: 0, projectedWeekTokens: 700, sessions: 0, totalTokens: 100 }),
      ),
      readFleetBurn({ ...REPORT, windowHours: 0 }),
      readFleetBurn({ ...REPORT, activeWithinMinutes: -10 }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("refuses a seven-day amount that is not the window's total at its rate", () => {
    const claude = (projectedWeekTokens: number) => ({
      ...REPORT,
      hosts: { ...REPORT.hosts, claude: { ...REPORT.hosts.claude, projectedWeekTokens } },
    });
    expect([
      readFleetBurn(claude(20_510_000_001)),
      readFleetBurn(claude(999)),
      readFleetBurn(claude(20_510_000_000))!.claude,
    ]).toEqual([undefined, undefined, REPORT.hosts.claude]);
  });

  it("refuses a report missing either instant of its window, or carrying one that is not an instant", () => {
    const { fromIso: _from, ...noFrom } = REPORT;
    const { observedAtIso: _observed, ...noObserved } = REPORT;
    expect([
      readFleetBurn(noFrom),
      readFleetBurn(noObserved),
      readFleetBurn({ ...REPORT, fromIso: "yesterday" }),
      readFleetBurn({ ...REPORT, fromIso: "2026-10-09T09:00:00.000Z" }),
      readFleetBurn({ ...REPORT, windowHours: 12 }),
      readFleetBurn({ ...REPORT, fromIso: "2026-02-30T09:00:00.000Z", observedAtIso: "2026-03-03T09:00:00.000Z" }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads the ledger's envelope around the report", () => {
    const reading = readFleetBurnReading({
      by: "tick-12",
      document: REPORT,
      observedAtIso: "2026-10-08T09:00:00.000Z",
      readingId: "r1",
      recordedAtIso: "2026-10-08T09:00:05.000Z",
    });
    expect([reading!.by, reading!.value.claude.kind]).toEqual(["tick-12", "measured"]);
  });
});

describe("readSeats, a seat's host", () => {
  /** A watch report carrying one row with these extra fields. */
  const report = (extra: Record<string, unknown>) => ({
    diagnostics: [],
    observedAtIso: "2026-10-08T09:00:00.000Z",
    rows: [
      {
        cwd: "/w",
        lastEventName: "agent.hook.Stop",
        mapped: true,
        quietMinutes: 1,
        signal: "working",
        toolCalls: 2,
        workspaceId: "W1",
        ...extra,
      },
    ],
    suppressed: 0,
    suppressedOldestQuietMinutes: null,
  });

  it("carries the host a row named, reads a row from before the field as naming none, and refuses one that moved", () => {
    expect([
      readSeats(report({ host: "codex" }))!.rows[0].host,
      readSeats(report({}))!.rows[0].host,
      readSeats(report({ host: 7 })),
    ]).toEqual(["codex", undefined, undefined]);
  });

  it("carries a row's session id, activity instants and manager flag, and reads a row from before them as not read", () => {
    const newer = readSeats(
      report({
        lastActivityAtIso: "2026-10-08T08:59:00.000Z",
        manager: false,
        openedAtIso: "2026-10-08T07:00:00.000Z",
        sessionId: "S-1",
      }),
    )!.rows[0];
    const older = readSeats(report({}))!.rows[0];
    expect([
      [newer.sessionId, newer.lastActivityAtIso, newer.openedAtIso, newer.manager],
      [older.sessionId, older.lastActivityAtIso, older.openedAtIso, older.manager],
    ]).toEqual([
      ["S-1", "2026-10-08T08:59:00.000Z", "2026-10-08T07:00:00.000Z", false],
      [undefined, undefined, undefined, undefined],
    ]);
  });

  it("reads an empty session id as none, so the card draws NOT MEASURED rather than opening a transcript by it", () => {
    expect(readSeats(report({ sessionId: "" }))!.rows[0].sessionId).toBe(undefined);
  });

  it("carries the title a session gave itself, reads a row from before the field or an empty one as none, and refuses one that moved", () => {
    expect([
      readSeats(report({ sessionTitle: "Board ready set read failure" }))!.rows[0].sessionTitle,
      readSeats(report({}))!.rows[0].sessionTitle,
      readSeats(report({ sessionTitle: "" }))!.rows[0].sessionTitle,
      readSeats(report({ sessionTitle: 7 })),
    ]).toEqual(["Board ready set read failure", undefined, undefined, undefined]);
  });

  it("refuses a row whose session id, activity instant or manager flag is present but malformed", () => {
    expect([
      readSeats(report({ sessionId: 7 })),
      readSeats(report({ lastActivityAtIso: "unknown" })),
      readSeats(report({ openedAtIso: "2026-02-30T09:00:00.000Z" })),
      readSeats(report({ manager: "yes" })),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("refuses a row whose title, ref or attention is present but not a string, rather than reading it as absent", () => {
    expect([
      readSeats(report({ attentionKind: 7, host: "claude" })),
      readSeats(report({ title: null })),
      readSeats(report({ workspaceRef: false })),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("reads the oldest suppressed seat as a number or the verb's null, and refuses a missing key or any other value", () => {
    const withOldest = (value: unknown) => ({ ...report({}), suppressed: 1, suppressedOldestQuietMinutes: value });
    const { suppressedOldestQuietMinutes: _dropped, ...noOldest } = report({});
    expect([
      readSeats(withOldest(90))!.suppressedOldestQuietMinutes,
      readSeats(withOldest(null))!.suppressedOldestQuietMinutes,
      readSeats(noOldest),
      readSeats(withOldest("bad")),
      readSeats(withOldest(-5)),
    ]).toEqual([90, undefined, undefined, undefined, undefined]);
  });

  it("refuses a report whose instant is missing or is not one the verb printed", () => {
    const { observedAtIso: _dropped, ...noInstant } = report({});
    expect([
      readSeats(noInstant),
      readSeats({ ...report({}), observedAtIso: "not-an-iso-instant" }),
      readSeats({ ...report({}), observedAtIso: "2026-02-30T09:00:00.000Z" }),
      readSeats(report({}))!.observedAtIso,
    ]).toEqual([undefined, undefined, undefined, "2026-10-08T09:00:00.000Z"]);
  });

  it("refuses a row or report whose minutes or counts are negative or fractional", () => {
    expect([
      readSeats(report({ quietMinutes: -1 })),
      readSeats(report({ quietMinutes: 1.5 })),
      readSeats(report({ toolCalls: -2 })),
      readSeats(report({ toolCalls: 1.5 })),
      readSeats({ ...report({}), suppressed: -1 }),
      readSeats({ ...report({}), suppressed: 0.5 }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});
