/**
 * A refresh that reads and cannot write is a world model that has silently stopped moving. Its only other
 * symptom is silence — the bot keeps answering from the corpus it already has, every gauge stays green —
 * so the fact has to reach the supervisor stream at `alert`, and the clearing half has to reach it too or
 * a briefing shows a frozen corpus forever.
 *
 * Measured: five days of no-op'd Slack refreshes, printed only to a stderr line mid-crawl.
 */
import { describe, expect, it } from "vitest";
import { type RefreshResult, refreshStreamEvents } from "../../../cli/commands/refresh/core.js";
import { coverageGap } from "../../../corpus/ingestJob.js";
import {
  meetsSeverity,
  parseSupervisorEvent,
  renderSupervisorEventLine,
  severityOf,
  supervisorEventLine,
} from "../../../events/event.js";

const NOW = "2026-08-29T04:00:00.000Z";

const result = (over: Partial<RefreshResult> = {}): RefreshResult => ({
  deduped: 0,
  errors: [],
  ok: true,
  projected: 0,
  source: "slack",
  warnings: [],
  written: 12,
  ...over,
});

describe("refreshStreamEvents", () => {
  it("publishes `committed` with the row count for a source that reached bronze", () => {
    const events = refreshStreamEvents({ nowIso: NOW, results: [result()] });

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("committed");
    expect(events[0]!.written).toBe(12);
    expect(events[0]!.corpusSource).toBe("slack");
    expect(events[0]!.why).toBe("refresh slack wrote 12 new row(s) to bronze");
  });

  it("publishes `write-refused` carrying the writer's own refusal, with nothing written", () => {
    const events = refreshStreamEvents({
      nowIso: NOW,
      results: [
        result({ errors: ["refusing to write slack: its dedup index needs more heap"], ok: false, written: 0 }),
      ],
    });

    expect(events[0]!.kind).toBe("write-refused");
    expect(events[0]!.written).toBe(0);
    expect(events[0]!.why).toContain("its world model is frozen");
    expect(events[0]!.why).toContain("refusing to write slack: its dedup index needs more heap");
  });

  it("words a coverage-gap failure as an incomplete read, never as rows that did not reach bronze", () => {
    const gap = "slack channel C_HANG was abandoned as stalled and not read this run; the next pass retries it whole";
    const events = refreshStreamEvents({
      nowIso: NOW,
      results: [result({ errors: [gap], gaps: [coverageGap({ message: gap })], ok: false, written: 7 })],
    });

    expect(events[0]!.kind).toBe("write-refused");
    expect(events[0]!.why).toBe(
      `refresh slack wrote 7 new row(s) but did NOT cover its window, so its world model is incomplete: ${gap}`,
    );
  });

  it("never reports a written count for a source that failed, whatever the result claimed", () => {
    const events = refreshStreamEvents({ nowIso: NOW, results: [result({ ok: false, written: 99 })] });

    expect(events[0]!.written).toBe(0);
  });

  it("publishes one event per source, in run order", () => {
    const events = refreshStreamEvents({
      nowIso: NOW,
      results: [result({ source: "github" }), result({ ok: false, source: "slack" }), result({ source: "linear" })],
    });

    expect(events.map((event) => event.corpusSource)).toEqual(["github", "slack", "linear"]);
    expect(events.map((event) => event.kind)).toEqual(["committed", "write-refused", "committed"]);
  });

  it("publishes nothing when no source ran", () => {
    expect(refreshStreamEvents({ nowIso: NOW, results: [] })).toEqual([]);
  });
});

describe("the severity a refresh event carries", () => {
  it("grades a refused write `alert`, so it clears a supervisor's alert-only floor", () => {
    const event = refreshStreamEvents({ nowIso: NOW, results: [result({ ok: false, written: 0 })] })[0]!;

    expect(severityOf({ event })).toBe("alert");
    expect(meetsSeverity({ event, minimum: "alert" })).toBe(true);
  });

  it("grades the clearing half `info`, so a healthy refresh is not an alert", () => {
    const event = refreshStreamEvents({ nowIso: NOW, results: [result()] })[0]!;

    expect(severityOf({ event })).toBe("info");
    expect(meetsSeverity({ event, minimum: "warn" })).toBe(false);
  });
});

describe("a refresh event on the wire", () => {
  it("round-trips through the stream's own encode/decode", () => {
    const event = refreshStreamEvents({ nowIso: NOW, results: [result({ ok: false, written: 0 })] })[0]!;

    expect(parseSupervisorEvent({ line: supervisorEventLine({ event }) })).toEqual(event);
  });

  it("names the corpus source in the `where` column a supervisor scans", () => {
    const event = refreshStreamEvents({ nowIso: NOW, results: [result({ ok: false, written: 0 })] })[0]!;

    expect(renderSupervisorEventLine({ event }).split("\t")).toEqual([
      "alert",
      NOW,
      "refresh",
      "write-refused",
      "slack",
      event.why,
    ]);
  });

  it("drops a line whose written count is not a whole number, rather than decoding a lie", () => {
    expect(
      parseSupervisorEvent({
        line: JSON.stringify({
          atIso: NOW,
          corpusSource: "slack",
          kind: "committed",
          source: "refresh",
          why: "x",
          written: "twelve",
        }),
      }),
    ).toBe(undefined);
  });
});
