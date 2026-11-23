import { describe, expect, it } from "vitest";

import { normaliseAlertName } from "../../../../live/slack/alertName.js";
import { type AlertTally, foldTally, type RawAlertMessage, tallyAlerts } from "../../../../live/slack/alertTally.js";
import { ALERT_SUMMARY_ROW_LABEL_MAX } from "../../../../outbound/artifact/alertSummary.js";

/** A notification the way a Slack app posts one: the substance in the first attachment, `text` empty. */
function notification({ title }: { title: string }): RawAlertMessage {
  return { attachments: [{ fallback: title }], text: "" };
}

/**
 * A window of raw messages standing in for a real alerts channel: one dominant monitor, one that recovers, a tie,
 * a per-occurrence tail that must NOT fragment, Slack bookkeeping, and someone talking.
 *
 * Every monitor name here is invented. This is a public repository and no production monitor name may reach it.
 */
function windowFixture(): readonly RawAlertMessage[] {
  return [
    notification({ title: "Triggered: queue depth high" }),
    notification({ title: "Triggered: queue depth high" }),
    notification({ title: "Recovered: queue depth high" }),
    notification({ title: "Triggered: upstream latency on @host:node-7" }),
    notification({ title: "Triggered: upstream latency on @host:node-2" }),
    notification({ title: "Warn: cache eviction rate" }),
    notification({ title: "Triggered: token refresh 401" }),
    { subtype: "channel_join", text: "someone joined the channel" },
    { subtype: "message_changed", text: "Triggered: queue depth high" },
    { text: "is anyone looking at the queue thing?" },
  ];
}

describe("normaliseAlertName — what counts as THE SAME alert", () => {
  it("strips the leading lifecycle word so a trigger and its recovery share one row", () => {
    expect(normaliseAlertName({ title: "Triggered: queue depth high" })).toBe("queue depth high");
    expect(normaliseAlertName({ title: "Recovered: queue depth high" })).toBe("queue depth high");
    expect(normaliseAlertName({ title: "Re-Triggered: queue depth high" })).toBe("queue depth high");
  });

  it("matches the lifecycle word case-insensitively, and with or without the colon", () => {
    expect(normaliseAlertName({ title: "TRIGGERED queue depth high" })).toBe("queue depth high");
    expect(normaliseAlertName({ title: "no data — disk writes" })).toBe("disk writes");
  });

  it("tries the LONGER lifecycle word first, so `re-` is not left behind as part of the name", () => {
    // The failure this prevents is a split row: `re-triggered: x` matching `triggered` would normalise to
    // `re-` plus nothing useful, and one monitor would be tallied under two names.
    expect(normaliseAlertName({ title: "Re-Triggered: queue depth high" })).toBe("queue depth high");
    expect(normaliseAlertName({ title: "Auto-Resolved: queue depth high" })).toBe("queue depth high");
  });

  it("requires a separator after the lifecycle word, so a real word is not mistaken for a state", () => {
    // `ok` is a lifecycle word and `okra` is not. Without the separator rule this normalises to `ra pipeline
    // stalled` and quietly invents a monitor.
    expect(normaliseAlertName({ title: "okra pipeline stalled" })).toBeUndefined();
  });

  it("cuts an entity reference whose value carries a DIGIT, so one monitor does not fragment per host", () => {
    expect(normaliseAlertName({ title: "Triggered: upstream latency on @host:node-7" })).toBe("upstream latency");
    expect(normaliseAlertName({ title: "Triggered: upstream latency on @host:node-2" })).toBe("upstream latency");
    expect(normaliseAlertName({ title: "Triggered: signup failures for @user:4471" })).toBe("signup failures");
  });

  it("KEEPS an entity value with no digit, because a stable key is what tells two alerts apart", () => {
    // Measured against a real channel: cutting this collapsed five distinct violations into one row, which deleted
    // exactly the axis the owner asked to see. The value is folded back onto the monitor's own words rather than
    // replacing them, so two monitors keyed on the same field stay two rows.
    expect(normaliseAlertName({ title: "Warn: audit — invariant violation on @invariant:order_missing" })).toBe(
      "audit — invariant violation · order_missing",
    );
    expect(normaliseAlertName({ title: "Warn: guard — violation on @guardName:requireOrder" })).toBe(
      "guard — violation · requireOrder",
    );
  });

  it("keeps two different stable keys on the same monitor as two different rows", () => {
    const first = normaliseAlertName({ title: "Warn: audit — violation on @invariant:order_missing" })!;
    const second = normaliseAlertName({ title: "Warn: audit — violation on @invariant:stranded_task" })!;

    expect(first).toBe("audit — violation · order_missing");
    expect(second).toBe("audit — violation · stranded_task");
  });

  it("cuts an entity reference with an empty value rather than leaving a dangling separator", () => {
    expect(normaliseAlertName({ title: "Warn: disk writes on @host:" })).toBe("disk writes");
  });

  it("returns the name UNBOUNDED, because what counts as the same alert is not a question about width", () => {
    // The bound is applied by `tallyAlerts` AFTER condensing — see the tally's own tests. Trimming here would cut
    // the discriminating key off a name whose repeated middle was about to be dropped anyway.
    const name = normaliseAlertName({ title: `Warn: audit — invariant violation on @invariant:${"k".repeat(90)}` })!;

    expect(name.length).toBeGreaterThan(ALERT_SUMMARY_ROW_LABEL_MAX);
  });

  it("drops a trailing bracketed group that carries a digit, and KEEPS one that does not", () => {
    expect(normaliseAlertName({ title: "Triggered: disk writes (id 4471)" })).toBe("disk writes");
    expect(normaliseAlertName({ title: "Triggered: disk writes [build 88]" })).toBe("disk writes");
    // A parenthesised word is almost always part of the name a person gave the monitor, so it stays.
    expect(normaliseAlertName({ title: "Triggered: disk writes (staging)" })).toBe("disk writes (staging)");
  });

  it("drops a trailing occurrence number and keeps a digit that is part of the name", () => {
    expect(normaliseAlertName({ title: "Triggered: disk writes #431" })).toBe("disk writes");
    expect(normaliseAlertName({ title: "Triggered: token refresh 401" })).toBe("token refresh 401");
    expect(normaliseAlertName({ title: "Triggered: 5xx rate" })).toBe("5xx rate");
  });

  it("collapses whitespace and trims a separator a cut left dangling", () => {
    expect(normaliseAlertName({ title: "Triggered:   queue   depth  high  " })).toBe("queue depth high");
    expect(normaliseAlertName({ title: "Triggered: queue depth high — on @host:node-1" })).toBe("queue depth high");
  });

  it("is undefined for a message with no lifecycle word, which is how a non-notification is recognised", () => {
    expect(normaliseAlertName({ title: "is anyone looking at the queue thing?" })).toBeUndefined();
    expect(normaliseAlertName({ title: "" })).toBeUndefined();
  });

  it("is undefined for a title that is ONLY a lifecycle word, because it names no monitor", () => {
    expect(normaliseAlertName({ title: "Recovered:" })).toBeUndefined();
    expect(normaliseAlertName({ title: "Triggered" })).toBeUndefined();
  });
});

describe("tallyAlerts — the numbers the card reports", () => {
  it("produces the exact rows, total, skipped and read count for the fixture window", () => {
    expect(tallyAlerts({ messages: windowFixture() })).toEqual({
      fired: [
        { count: 3, name: "queue depth high", severity: "green" },
        { count: 2, name: "upstream latency", severity: "red" },
        { count: 1, name: "cache eviction rate", severity: "orange" },
        { count: 1, name: "token refresh 401", severity: "red" },
      ],
      read: 10,
      rows: [
        { count: 3, label: "queue depth high", severity: "green" },
        { count: 2, label: "upstream latency", severity: "red" },
        { count: 1, label: "cache eviction rate", severity: "orange" },
        { count: 1, label: "token refresh 401", severity: "red" },
      ],
      skipped: 3,
      total: 7,
    } satisfies AlertTally);
  });

  it("orders noisiest first and breaks ties on the name, so the same window tallies identically", () => {
    const first = tallyAlerts({ messages: windowFixture() }).rows.map((row) => row.label);
    const reversed = tallyAlerts({ messages: [...windowFixture()].toReversed() }).rows.map((row) => row.label);

    expect(first).toEqual(["queue depth high", "upstream latency", "cache eviction rate", "token refresh 401"]);
    expect(reversed).toEqual(first);
  });

  it("SKIPS every message carrying a Slack subtype, including one whose text looks like an alert", () => {
    // `message_changed` carries the original alert text, so a parser reading text alone would double-count an
    // edit as a second firing. The fixture includes exactly that case.
    const withoutBookkeeping = windowFixture().filter((message) => message.subtype === undefined);
    const tally = tallyAlerts({ messages: withoutBookkeeping });

    expect(tally.skipped).toBe(1);
    expect(tally.total).toBe(7);
  });

  it("reads the attachment title when there is no fallback, and the message text when there is neither", () => {
    const messages: readonly RawAlertMessage[] = [
      { attachments: [{ title: "Triggered: disk writes" }] },
      { text: "Triggered: disk writes" },
      { attachments: [{ fallback: "" }], text: "Triggered: disk writes" },
    ];

    expect(tallyAlerts({ messages }).rows).toEqual([{ count: 3, label: "disk writes", severity: "red" }]);
  });

  it("distinguishes a QUIET window from an UNPARSED one, which is the whole reason `skipped` exists", () => {
    const quiet = tallyAlerts({ messages: [] });
    const unparsed = tallyAlerts({ messages: Array.from({ length: 40 }, () => ({ text: "some other format" })) });

    expect(quiet).toEqual({ fired: [], read: 0, rows: [], skipped: 0, total: 0 } satisfies AlertTally);
    expect(unparsed).toEqual({ fired: [], read: 40, rows: [], skipped: 40, total: 0 } satisfies AlertTally);
  });

  it("ignores an attachments value that is not an array, rather than throwing on it", () => {
    const messages: readonly RawAlertMessage[] = [
      { attachments: "not an array", text: "Triggered: disk writes" },
      { attachments: [], text: "Triggered: disk writes" },
      { attachments: ["not an object"], text: "Triggered: disk writes" },
    ];

    expect(tallyAlerts({ messages }).rows).toEqual([{ count: 3, label: "disk writes", severity: "red" }]);
  });
});

describe("tallyAlerts — the row labels a reader actually sees", () => {
  /** Three rows of one monitor keyed on different invariants, plus one of another. The shape a real card had. */
  function repeated(): readonly RawAlertMessage[] {
    return [
      notification({ title: "Warn: Integrity — Owed-End-State Invariant Violation on @invariant:purchase_outside" }),
      notification({ title: "Warn: Integrity — Owed-End-State Invariant Violation on @invariant:deposit_uncredited" }),
      notification({ title: "Warn: Integrity — Owed-End-State Invariant Violation on @invariant:line_unentitled" }),
      notification({ title: "Warn: Guard — Violation Detected on @guardName:requirePanel" }),
    ];
  }

  it("drops the clause every row repeats, keeping the monitor head and the key that differs", () => {
    // The rendering this fixes: three of five rows on a real card spent 46 identical characters saying the same
    // thing, and two were long enough that the key — the only part that differed — was truncated off the end.
    expect(tallyAlerts({ messages: repeated() }).rows.map((row) => row.label)).toEqual([
      "Guard · requirePanel",
      "Integrity · deposit_uncredited",
      "Integrity · line_unentitled",
      "Integrity · purchase_outside",
    ]);
  });

  it("changes no count while shortening a label", () => {
    const tally = tallyAlerts({ messages: repeated() });

    expect(tally.total).toBe(4);
    expect(tally.rows.every((row) => row.count === 1)).toBe(true);
  });

  it("KEEPS the full names when condensing would merge two rows, rather than half-condensing the table", () => {
    // Here the dropped clause IS the discriminator, so condensing collides. All-or-nothing: a half-condensed table
    // is one whose rows are not comparable — a reader cannot tell a different monitor from the same one spelled out.
    const messages = [
      notification({ title: "Warn: Integrity — check A on @invariant:same_key" }),
      notification({ title: "Warn: Integrity — check B on @invariant:same_key" }),
    ];

    expect(tallyAlerts({ messages }).rows.map((row) => row.label)).toEqual([
      "Integrity — check A · same_key",
      "Integrity — check B · same_key",
    ]);
  });

  it("leaves a name with no key alone, because nothing in it repeats", () => {
    const messages = [notification({ title: "Warn: Payments — duplicate mint prevented (guard reuse)" })];

    expect(tallyAlerts({ messages }).rows[0]!.label).toBe("Payments — duplicate mint prevented (guard reuse)");
  });

  it("bounds every label at the form's row-label cap, with the elision visible", () => {
    const messages = [notification({ title: `Warn: ${"m".repeat(200)}` })];
    const label = tallyAlerts({ messages }).rows[0]!.label;

    expect(label.length).toBe(ALERT_SUMMARY_ROW_LABEL_MAX);
    expect(label.endsWith("…")).toBe(true);
  });

  it("MERGES two rows the bound made identical, and sums their counts rather than showing the row twice", () => {
    const shared = "s".repeat(ALERT_SUMMARY_ROW_LABEL_MAX);
    const messages = [
      notification({ title: `Warn: ${shared}-one` }),
      notification({ title: `Warn: ${shared}-one` }),
      notification({ title: `Warn: ${shared}-two` }),
    ];
    const tally = tallyAlerts({ messages });

    expect(tally.rows.length).toBe(1);
    expect(tally.rows[0]!.count).toBe(3);
    expect(tally.total).toBe(3);
  });
});

describe("tallyAlerts — the ts a citation is built from", () => {
  it("carries no ts at all when no message had one", () => {
    expect(tallyAlerts({ messages: windowFixture() }).rows.every((row) => row.ts === undefined)).toBe(true);
  });

  it("carries the ts of a row's only occurrence", () => {
    const messages: readonly RawAlertMessage[] = [
      { ...notification({ title: "Triggered: disk writes" }), ts: "100.0" },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.ts).toBe("100.0");
  });

  it("carries the LATEST ts across repeated occurrences, regardless of the order they arrive in", () => {
    const forward: readonly RawAlertMessage[] = [
      { ...notification({ title: "Triggered: disk writes" }), ts: "100.0" },
      { ...notification({ title: "Recovered: disk writes" }), ts: "300.0" },
      { ...notification({ title: "Triggered: disk writes" }), ts: "200.0" },
    ];

    expect(tallyAlerts({ messages: forward }).rows[0]!.ts).toBe("300.0");
    expect(tallyAlerts({ messages: [...forward].toReversed() }).rows[0]!.ts).toBe("300.0");
  });

  it("compares ts NUMERICALLY, not lexicographically", () => {
    // A lexicographic compare would call "9.0" later than "10.0", which is backwards.
    const messages: readonly RawAlertMessage[] = [
      { ...notification({ title: "Triggered: disk writes" }), ts: "9.0" },
      { ...notification({ title: "Triggered: disk writes" }), ts: "10.0" },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.ts).toBe("10.0");
  });

  it("survives condensing a repeated clause, since condensing only relabels", () => {
    const messages: readonly RawAlertMessage[] = [
      { ...notification({ title: "Warn: Integrity — check A on @invariant:same_key" }), ts: "50.0" },
      { ...notification({ title: "Warn: Integrity — check B on @invariant:same_key" }), ts: "60.0" },
    ];
    const rows = tallyAlerts({ messages }).rows;

    expect(rows.find((row) => row.label === "Integrity — check A · same_key")!.ts).toBe("50.0");
    expect(rows.find((row) => row.label === "Integrity — check B · same_key")!.ts).toBe("60.0");
  });

  it("carries the LATER ts through a bound-cap merge, when two labels collapse into one", () => {
    const shared = "s".repeat(ALERT_SUMMARY_ROW_LABEL_MAX);
    const messages: readonly RawAlertMessage[] = [
      { ...notification({ title: `Warn: ${shared}-one` }), ts: "10.0" },
      { ...notification({ title: `Warn: ${shared}-two` }), ts: "20.0" },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.ts).toBe("20.0");
  });
});

describe("tallyAlerts — the embedded link, real telemetry over Slack", () => {
  it("carries no embeddedLink at all when no attachment carried one", () => {
    expect(tallyAlerts({ messages: windowFixture() }).rows.every((row) => row.embeddedLink === undefined)).toBe(true);
  });

  it("prefers the attachment's title_link over anything in its text", () => {
    const messages: readonly RawAlertMessage[] = [
      {
        attachments: [
          {
            fallback: "Triggered: disk writes",
            text: "See <https://example.slack.invalid/wrong|this> instead.",
            title_link: "https://app.datadoghq.com/monitors/123",
          },
        ],
        ts: "100.0",
      },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.embeddedLink).toBe("https://app.datadoghq.com/monitors/123");
  });

  it("falls back to the first link Slack would render inside the attachment text, with no title_link", () => {
    const messages: readonly RawAlertMessage[] = [
      {
        attachments: [
          {
            fallback: "Triggered: disk writes",
            text: "More than 0 events matched: <https://app.datadoghq.com/logs?query=a|Logs>",
          },
        ],
        ts: "100.0",
      },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.embeddedLink).toBe("https://app.datadoghq.com/logs?query=a");
  });

  it("decodes the HTML entities Slack escapes inside attachment text, so the URL is well-formed", () => {
    const messages: readonly RawAlertMessage[] = [
      {
        attachments: [
          {
            fallback: "Triggered: disk writes",
            text: "<https://app.datadoghq.com/logs?query=a%3Ab&amp;live=true|Logs>",
          },
        ],
        ts: "100.0",
      },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.embeddedLink).toBe(
      "https://app.datadoghq.com/logs?query=a%3Ab&live=true",
    );
  });

  it("carries no embeddedLink when the attachment has neither field", () => {
    const messages: readonly RawAlertMessage[] = [
      { attachments: [{ fallback: "Triggered: disk writes" }], ts: "100.0" },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.embeddedLink).toBeUndefined();
  });

  it("ties the embedded link to the SAME occurrence as ts, never an older one's", () => {
    const messages: readonly RawAlertMessage[] = [
      {
        attachments: [{ fallback: "Triggered: disk writes", title_link: "https://app.datadoghq.com/monitors/OLD" }],
        ts: "100.0",
      },
      {
        attachments: [{ fallback: "Triggered: disk writes", title_link: "https://app.datadoghq.com/monitors/NEW" }],
        ts: "200.0",
      },
    ];
    const row = tallyAlerts({ messages }).rows[0]!;

    expect(row.ts).toBe("200.0");
    expect(row.embeddedLink).toBe("https://app.datadoghq.com/monitors/NEW");
  });

  it("survives a bound-cap merge, carrying the link of whichever side is more recent", () => {
    const shared = "s".repeat(ALERT_SUMMARY_ROW_LABEL_MAX);
    const messages: readonly RawAlertMessage[] = [
      {
        attachments: [{ fallback: `Warn: ${shared}-one`, title_link: "https://app.datadoghq.com/monitors/OLD" }],
        ts: "10.0",
      },
      {
        attachments: [{ fallback: `Warn: ${shared}-two`, title_link: "https://app.datadoghq.com/monitors/NEW" }],
        ts: "20.0",
      },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.embeddedLink).toBe("https://app.datadoghq.com/monitors/NEW");
  });
});

describe("tallyAlerts — severity, a SHAPE lookup over the closed lifecycle vocabulary", () => {
  it("classifies every recognised lifecycle word, exhaustively", () => {
    const cases: readonly { readonly title: string; readonly severity: string }[] = [
      { severity: "red", title: "Triggered: disk writes" },
      { severity: "red", title: "Re-Triggered: disk writes" },
      { severity: "red", title: "Retriggered: disk writes" },
      { severity: "red", title: "Firing: disk writes" },
      { severity: "red", title: "Renotify: disk writes" },
      { severity: "orange", title: "Warn: disk writes" },
      { severity: "orange", title: "Warning: disk writes" },
      { severity: "orange", title: "No Data: disk writes" },
      { severity: "orange", title: "Nodata: disk writes" },
      { severity: "green", title: "Recovered: disk writes" },
      { severity: "green", title: "Resolved: disk writes" },
      { severity: "green", title: "Auto-Resolved: disk writes" },
      { severity: "green", title: "OK: disk writes" },
    ];

    for (const { title, severity } of cases) {
      const messages: readonly RawAlertMessage[] = [notification({ title })];

      expect(tallyAlerts({ messages }).rows[0]!.severity).toBe(severity);
    }
  });

  it("carries no severity for a message with no recognised lifecycle word", () => {
    expect(tallyAlerts({ messages: [{ text: "is anyone looking at the queue thing?" }] }).skipped).toBe(1);
  });

  it("takes the severity of the MOST RECENT occurrence, not the first or the noisiest", () => {
    const messages: readonly RawAlertMessage[] = [
      { ...notification({ title: "Triggered: disk writes" }), ts: "100.0" },
      { ...notification({ title: "Recovered: disk writes" }), ts: "200.0" },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.severity).toBe("green");
    expect(tallyAlerts({ messages: [...messages].toReversed() }).rows[0]!.severity).toBe("green");
  });

  it("ties severity to the SAME occurrence as ts and embeddedLink, never mixing evidence", () => {
    const messages: readonly RawAlertMessage[] = [
      {
        attachments: [{ fallback: "Triggered: disk writes", title_link: "https://app.datadoghq.com/monitors/OLD" }],
        ts: "100.0",
      },
      {
        attachments: [{ fallback: "Recovered: disk writes", title_link: "https://app.datadoghq.com/monitors/NEW" }],
        ts: "200.0",
      },
    ];
    const row = tallyAlerts({ messages }).rows[0]!;

    expect(row.severity).toBe("green");
    expect(row.embeddedLink).toBe("https://app.datadoghq.com/monitors/NEW");
    expect(row.ts).toBe("200.0");
  });

  it("survives a bound-cap merge, carrying the severity of whichever side is more recent", () => {
    const shared = "s".repeat(ALERT_SUMMARY_ROW_LABEL_MAX);
    const messages: readonly RawAlertMessage[] = [
      { ...notification({ title: `Triggered: ${shared}-one` }), ts: "10.0" },
      { ...notification({ title: `Recovered: ${shared}-two` }), ts: "20.0" },
    ];

    expect(tallyAlerts({ messages }).rows[0]!.severity).toBe("green");
  });
});

describe("foldTally — a dropped tail is STATED, never silent", () => {
  /** A tally of `count` distinct monitors, each firing one time fewer than the last. */
  function ladder({ monitors }: { monitors: number }): AlertTally {
    const rows = Array.from({ length: monitors }, (_unused, position) => ({
      count: monitors - position,
      label: `monitor-${String(position).padStart(2, "0")}`,
    }));
    return {
      fired: rows.map((row) => ({ count: row.count, name: row.label })),
      read: 0,
      rows,
      skipped: 0,
      total: rows.reduce((sum, row) => sum + row.count, 0),
    };
  }

  it("leaves a tally inside the limit untouched, and claims nothing about omissions", () => {
    const folded = foldTally({ limit: 10, tally: ladder({ monitors: 4 }) });

    expect(folded.rows.length).toBe(4);
    expect(folded.omitted).toBeUndefined();
  });

  it("keeps exactly the limit at the boundary, still with no omitted claim", () => {
    const folded = foldTally({ limit: 10, tally: ladder({ monitors: 10 }) });

    expect(folded.rows.length).toBe(10);
    expect(folded.omitted).toBeUndefined();
  });

  it("drops the QUIET tail and reports how many monitors and firings went with it", () => {
    // 17 monitors firing 17..1 is 153 in total; the ten noisiest account for 17..8, which is 125.
    const folded = foldTally({ limit: 10, tally: ladder({ monitors: 17 }) });

    expect(folded.rows.map((row) => row.count)).toEqual([17, 16, 15, 14, 13, 12, 11, 10, 9, 8]);
    expect(folded.omitted).toEqual({ count: 28, monitors: 7 });
  });

  it("accounts for every firing across the kept rows and the omitted note", () => {
    const tally = ladder({ monitors: 17 });
    const folded = foldTally({ limit: 10, tally });
    const kept = folded.rows.reduce((sum, row) => sum + row.count, 0);

    expect(kept + folded.omitted!.count).toBe(tally.total);
  });
});
