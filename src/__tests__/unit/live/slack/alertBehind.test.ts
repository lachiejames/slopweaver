/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  type BehindMonitor,
  behindEntry,
  behindTargets,
  logSearchOf,
  monitorIdOf,
} from "../../../../live/slack/alertBehind.js";

/** The census map's monitors, in the two shapes a census holds: a log alert and a metric monitor. */
const monitors: readonly BehindMonitor[] = [
  {
    id: 100_002,
    query:
      'logs("env:(prod OR production) *:\\"Couldn\'t lease worker slot\\"").index("*").rollup("count").last("15m") > 20',
    type: "log alert",
  },
  { id: 500_001, query: "avg(last_5m):100 - avg:system.cpu.idle{*} by {host} > 90", type: "query alert" },
];

describe("monitorIdOf", () => {
  it("reads the id out of a monitor notification's own link, whatever the site host", () => {
    expect(
      monitorIdOf({
        link: "https://ap1.datadoghq.com/monitors/100002?from_ts=1789554667000&link_source=monitor_notif",
      }),
    ).toBe(100_002);
    expect(monitorIdOf({ link: "https://app.datadoghq.com/monitors/17" })).toBe(17);
  });

  it("reads nothing out of a link that is not a monitor", () => {
    expect(monitorIdOf({ link: "https://ap1.datadoghq.com/logs?query=service%3Ajobs-api" })).toBe(null);
    expect(monitorIdOf({ link: "https://acme.slack.com/archives/C1/p1789" })).toBe(null);
  });
});

describe("logSearchOf", () => {
  it("unwraps the log search a log alert evaluates, unescaping its quoted phrases", () => {
    expect(logSearchOf({ query: monitors[0]!.query })).toBe('env:(prod OR production) *:"Couldn\'t lease worker slot"');
  });

  it("unwraps nothing from a metric monitor's query", () => {
    expect(logSearchOf({ query: monitors[1]!.query })).toBe(null);
  });

  // A composite monitor is exactly this shape. Unwrapping its head would rerun one arm while the card claims
  // it reran the monitor's own query.
  it("unwraps nothing from a COMPOSITE log alert, rather than half of it", () => {
    const composite =
      'logs("service:billing-api \\"Invoice export finished\\"").index("*").rollup("count").last("1d") > 0 ' +
      'AND logs("service:mailer-api \\"Digest batch sent\\"").index("*").rollup("count").last("1d") > 0';

    expect(logSearchOf({ query: composite })).toBe(null);
  });

  it("unwraps nothing from a log alert whose search is empty", () => {
    expect(logSearchOf({ query: 'logs("  ").index("*").rollup("count").last("5m") > 0' })).toBe(null);
  });
});

describe("behindTargets", () => {
  const row = ({ count, id }: { count: number; id: number | null }) => ({
    count,
    label: `monitor ${String(id)}`,
    ...(id === null ? {} : { embeddedLink: `https://ap1.datadoghq.com/monitors/${String(id)}?x=1` }),
  });

  it("takes the noisiest row whose link names a census log alert", () => {
    const targets = behindTargets({ monitors, rows: [row({ count: 1, id: 100_002 }), row({ count: 9, id: 500_001 })] });
    expect(targets).toEqual([
      {
        monitor: "monitor 100002",
        monitorId: 100_002,
        search: 'env:(prod OR production) *:"Couldn\'t lease worker slot"',
      },
    ]);
  });

  it("takes nothing from a row with no link, an unknown monitor, or a non-log monitor", () => {
    expect(
      behindTargets({
        monitors,
        rows: [row({ count: 5, id: null }), row({ count: 4, id: 42 }), row({ count: 3, id: 500_001 })],
      }),
    ).toEqual([]);
  });

  it("never lines the same monitor up twice, however many rows point at it", () => {
    const targets = behindTargets({
      monitors,
      rows: [row({ count: 5, id: 100_002 }), { ...row({ count: 4, id: 100_002 }), label: "another label" }],
    });
    expect(targets.length).toBe(1);
  });

  it("stops at the card's own cap", () => {
    const many = [1, 2, 3, 4].map((n) => ({
      id: 900_000 + n,
      query: 'logs("service:x").last("5m") > 0',
      type: "log alert",
    }));
    const rows = many.map((monitor, index) => row({ count: 10 - index, id: monitor.id }));
    expect(behindTargets({ monitors: many, rows }).length).toBe(2);
  });
});

describe("behindEntry", () => {
  const target = { monitor: "Worker lease stalled", monitorId: 100_002, search: "service:jobs-api" };

  it("keeps the largest three groups, in order, with the count each carries", () => {
    const entry = behindEntry({
      citationUrl: "https://ap1.datadoghq.com/logs?query=x",
      groups: [
        { by: { service: "core-api" }, count: 11 },
        { by: { service: "jobs-api" }, count: 474 },
        { by: { service: "search-api" }, count: 3 },
        { by: { service: "export-api" }, count: 1 },
      ],
      target,
      total: 489,
    });
    expect(entry).toEqual({
      citationUrl: "https://ap1.datadoghq.com/logs?query=x",
      events: 489,
      groups: [
        { count: 474, name: "jobs-api" },
        { count: 11, name: "core-api" },
        { count: 3, name: "search-api" },
      ],
      monitor: "Worker lease stalled",
    });
  });

  it("drops a group the aggregate could not name, and a zero, rather than printing either", () => {
    const entry = behindEntry({
      citationUrl: null,
      groups: [
        { by: { env: "production" }, count: 4 },
        { by: { service: "jobs-api" }, count: 0 },
      ],
      target,
      total: 4,
    });
    expect(entry).toEqual({ events: 4, groups: [], monitor: "Worker lease stalled" });
  });

  it("drops a group whose count exceeds the total, which no share could describe honestly", () => {
    const entry = behindEntry({
      citationUrl: null,
      groups: [
        { by: { service: "jobs-api" }, count: 900 },
        { by: { service: "core-api" }, count: 4 },
      ],
      target,
      total: 10,
    });

    expect(entry.groups).toEqual([{ count: 4, name: "core-api" }]);
  });

  it("carries a zero total as a zero, which is a result rather than an absence", () => {
    expect(behindEntry({ citationUrl: null, groups: [], target, total: 0 }).events).toBe(0);
  });
});
