import { describe, expect, it } from "vitest";

import type { CapturedResponse, PageCapture, ResponseAccounting } from "../../../../../browser/pageTransport.js";
import {
  parseSlackSavedArgs,
  renderSlackSavedReport,
  SLACK_SAVED_DEFAULT_SETTLE_MS,
  SLACK_SAVED_MAX_SETTLE_MS,
  savedReportFromCapture,
} from "../../../../../cli/commands/slack/savedCore.js";
import { SAVED_LIST_PATH, SavedListErrors } from "../../../../../cli/commands/slack/savedList.js";
import { runSlackSaved, SLACK_SAVED_LEASE_PLATFORM } from "../../../../../cli/commands/slack/savedRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const WORKSPACE = "https://example-workspace.slack.com";
const API = "https://example-org.enterprise.slack.com";
const LATER = "https://app.slack.com/client/E0SYN1ABCDEFGH/later";
const ONE_LOST: ResponseAccounting = { bodyFailed: 1, bodySucceeded: 1, eligible: 2, seen: 40 };

/** One raw `saved_items[]` entry, overridable field by field. Every id is synthetic. */
function rawItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date_completed: 0,
    date_created: 1_790_000_000,
    date_due: 0,
    date_snoozed_until: 0,
    date_updated: 1_790_000_000,
    is_archived: false,
    item_id: "C0SYN1ABCDEFGH",
    item_type: "message",
    state: "in_progress",
    todo_state: "uncompleted",
    ts: "1790000000.000100",
    ...over,
  };
}

/** One `ok` answer from `saved.list`. */
function listBody({
  items,
  total = items.length,
  cursor = "",
}: {
  items: readonly Record<string, unknown>[];
  total?: number;
  cursor?: string;
}): Record<string, unknown> {
  return {
    counts: {
      archived_count: 0,
      completed_count: total - items.length,
      total_count: total,
      uncompleted_count: items.length,
      uncompleted_overdue_count: 0,
    },
    ok: true,
    response_metadata: { next_cursor: cursor },
    saved_items: items,
  };
}

/** One captured response. */
function response({ body, url = `${API}${SAVED_LIST_PATH}` }: { body: unknown; url?: string }): CapturedResponse {
  return { body, method: "POST", statusCode: 200, url };
}

/** One capture of `/later`, complete by default: every body it counted as kept is one of `responses`. */
function capture({
  responses,
  accounting = { bodyFailed: 0, bodySucceeded: responses.length, eligible: responses.length, seen: 40 },
}: {
  responses: readonly CapturedResponse[];
  accounting?: ResponseAccounting;
}): PageCapture {
  return {
    finalUrl: LATER,
    links: [],
    linksBlockedBecause: null,
    observedAt: "2026-10-13T00:00:00.000Z",
    requestedUrl: LATER,
    responseAccounting: accounting,
    responses,
    screenshotBlockedBecause: null,
    screenshotPng: null,
    statusCode: 200,
    title: "Later",
  };
}

describe("savedReportFromCapture", () => {
  it("reads a kept saved.list into pointers, each message linked off the workspace", () => {
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body: listBody({ items: [rawItem()] }) })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("read");
    expect(report.items).toEqual([
      {
        channel: "C0SYN1ABCDEFGH",
        completedAtIso: null,
        dueAtIso: null,
        isArchived: false,
        itemType: "message",
        permalink: "https://example-workspace.slack.com/archives/C0SYN1ABCDEFGH/p1790000000000100",
        savedAtIso: "2026-09-21T14:13:20.000Z",
        snoozedUntilIso: null,
        state: "in_progress",
        todoState: "uncompleted",
        ts: "1790000000.000100",
        unlinkableBecause: null,
      },
    ]);
    expect(report.responseOrigins).toEqual([API]);
    expect(report.because).toBe(null);
  });

  it("still reads the list when an UNRELATED body was lost, and says so rather than claiming completeness", () => {
    const report = savedReportFromCapture({
      capture: capture({ accounting: ONE_LOST, responses: [response({ body: listBody({ items: [rawItem()] }) })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("read");
    expect(report.because).toContain("1 other response body(ies) were lost");
  });

  it("counts an eligible body that was neither kept nor recorded as failed as lost, never as zero", () => {
    const unaccounted: ResponseAccounting = { bodyFailed: 0, bodySucceeded: 1, eligible: 2, seen: 40 };
    const report = savedReportFromCapture({
      capture: capture({ accounting: unaccounted, responses: [response({ body: listBody({ items: [rawItem()] }) })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.because).toContain("1 other response body(ies) were lost");
  });

  it("adds a failed body to one counted as kept but not held, rather than reporting the larger of the two", () => {
    const both: ResponseAccounting = { bodyFailed: 1, bodySucceeded: 2, eligible: 3, seen: 40 };
    const report = savedReportFromCapture({
      capture: capture({ accounting: both, responses: [response({ body: listBody({ items: [rawItem()] }) })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("read");
    expect(report.because).toContain("2 other response body(ies) were lost");
  });

  it("counts a body the accounting calls kept but the capture does not hold as lost", () => {
    const overclaimed: ResponseAccounting = { bodyFailed: 0, bodySucceeded: 3, eligible: 3, seen: 40 };
    const report = savedReportFromCapture({
      capture: capture({
        accounting: overclaimed,
        responses: [response({ body: { ok: true }, url: `${API}/api/users.prefs.get` })],
      }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("capture-incomplete");
    expect(report.because).toBe("the page lost 2 response body(ies), so an absent saved.list call proves nothing");
  });

  it("names a complete load with no saved.list call as not-observed", () => {
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body: { ok: true }, url: `${API}/api/users.prefs.get` })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("not-observed");
    expect(report.callsObserved).toBe(0);
  });

  it("refuses to call a list absent when a body was lost and none was saved.list", () => {
    const report = savedReportFromCapture({
      capture: capture({ accounting: ONE_LOST, responses: [] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("capture-incomplete");
  });

  it("refuses a body whose shape drifted, naming the field rather than reading around it", () => {
    const drifted = listBody({ items: [rawItem({ new_field: 1 })] });
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body: drifted })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("response-invalid");
    expect(report.because).toContain("new_field");
    expect(report.items).toEqual([]);
  });

  it("keeps a lost body's count beside a drifted shape, so neither hides the other", () => {
    const drifted = listBody({ items: [rawItem({ new_field: 1 })] });
    const report = savedReportFromCapture({
      capture: capture({ accounting: ONE_LOST, responses: [response({ body: drifted })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("response-invalid");
    expect(report.because).toContain("new_field");
    expect(report.because).toContain("; 1 other response body(ies) were also lost on this load");
  });

  it("reports Slack's own ok:false as invalid, carrying its error", () => {
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body: { error: "not_authed", ok: false } })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("response-invalid");
    expect(report.because).toBe("saved.list answered ok:false — not_authed");
  });

  it("builds no link for a pointer that is not a message", () => {
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body: listBody({ items: [rawItem({ item_type: "file" })] }) })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.items[0]!.permalink).toBe(null);
    expect(report.items[0]!.unlinkableBecause).toBe(
      'item type "file" is not a message, so no message link is built for it',
    );
  });

  it("builds no link for an item id that is not a conversation", () => {
    const report = savedReportFromCapture({
      capture: capture({
        responses: [response({ body: listBody({ items: [rawItem({ item_id: "U0SYN1ABCDEFGH" })] }) })],
      }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.items[0]!.unlinkableBecause).toBe('item_id "U0SYN1ABCDEFGH" is not a conversation id');
  });

  it("merges a repeated call's identical rows into one item and says it did", () => {
    const body = listBody({ items: [rawItem()] });
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body }), response({ body })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.callsObserved).toBe(2);
    expect(report.items.length).toBe(1);
    expect(renderSlackSavedReport({ report })).toContain(
      "  the client called saved.list 2 times on this load — any row two calls shared agreed and is listed once",
    );
    expect(report.because).toBe(null);
  });

  it("names two calls that held different rows, rather than passing their union off as one answer", () => {
    const counts = {
      archived_count: 0,
      completed_count: 0,
      total_count: 2,
      uncompleted_count: 2,
      uncompleted_overdue_count: 0,
    };
    const report = savedReportFromCapture({
      capture: capture({
        responses: [
          response({ body: { ...listBody({ items: [rawItem()] }), counts } }),
          response({ body: { ...listBody({ items: [rawItem({ item_id: "C0SYN2ABCDEFGH" })] }), counts } }),
        ],
      }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("read");
    expect(report.items.length).toBe(2);
    expect(report.because).toBe(
      "the 2 saved.list calls on this load held different rows (1, 1 item(s)) — this list is their union, " +
        "which no single call returned",
    );
  });

  // Each row is one state whose count is 0 while the load holds one row in it; every other count describes
  // that row, so the one note is the state under test. The fixture's capture is observed at the fixture's own instant.
  const ONE_ROW_COUNTS = {
    archived_count: 0,
    completed_count: 0,
    total_count: 1,
    uncompleted_count: 0,
    uncompleted_overdue_count: 0,
  };

  it.each([
    { counts: {}, item: {}, label: "uncompleted" },
    { counts: { uncompleted_count: 1 }, item: { date_due: 1_790_000_000 }, label: "overdue" },
    { counts: {}, item: { todo_state: "completed" }, label: "completed" },
    { counts: { uncompleted_count: 1 }, item: { is_archived: true }, label: "archived" },
  ])("names a $label count below the rows this load holds in that state", ({ counts, item, label }) => {
    const body = { ...listBody({ items: [rawItem(item)] }), counts: { ...ONE_ROW_COUNTS, ...counts } };
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("read");
    expect(report.because).toBe(
      `saved.list counts 0 ${label} item(s) but this load holds 1 — its counts do not describe these rows`,
    );
  });

  it.each([
    { counted: 2, counts: { uncompleted_count: 2 }, held: 1, label: "uncompleted" },
    { counted: 1, counts: { uncompleted_count: 1, uncompleted_overdue_count: 1 }, held: 0, label: "overdue" },
    { counted: 1, counts: { completed_count: 1, uncompleted_count: 1 }, held: 0, label: "completed" },
    { counted: 1, counts: { archived_count: 1, uncompleted_count: 1 }, held: 0, label: "archived" },
  ])(
    "marks a $label count above its rows a gap, even when the total claims every row is here",
    ({ counted, counts, held, label }) => {
      const body = { ...listBody({ items: [rawItem()] }), counts: { ...ONE_ROW_COUNTS, ...counts } };
      const report = savedReportFromCapture({
        capture: capture({ responses: [response({ body })] }),
        workspaceUrl: WORKSPACE,
      });
      expect(report.outcome).toBe("read");
      expect(report.firstLoadTruncated).toBe(true);
      expect(report.because).toBe(
        `saved.list counts ${String(counted)} ${label} item(s) but this load holds ${String(held)} while its ` +
          "total says every row is here — a row is unread, or its counts contradict",
      );
    },
  );

  it("names a todo_state it does not know, since no count was checked against those rows", () => {
    const body = {
      ...listBody({ items: [rawItem({ todo_state: "open" })] }),
      counts: {
        archived_count: 0,
        completed_count: 0,
        total_count: 1,
        uncompleted_count: 0,
        uncompleted_overdue_count: 0,
      },
    };
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("read");
    expect(report.because).toBe(
      'saved.list returned todo_state "open", which this verb does not know — those rows were checked against ' +
        "no open or completed count",
    );
  });

  it("names no state when every count covers its rows", () => {
    const body = {
      ...listBody({ items: [rawItem({ date_due: 1_790_000_000, is_archived: true })] }),
      counts: {
        archived_count: 1,
        completed_count: 0,
        total_count: 1,
        uncompleted_count: 1,
        uncompleted_overdue_count: 1,
      },
    };
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("read");
    expect(report.because).toBe(null);
    expect(report.firstLoadTruncated).toBe(false);
  });

  it("refuses two calls on one load that disagree about the counts", () => {
    const report = savedReportFromCapture({
      capture: capture({
        responses: [
          response({ body: listBody({ items: [rawItem()] }) }),
          response({ body: listBody({ items: [rawItem()], total: 9 }) }),
        ],
      }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("response-invalid");
    expect(report.because).toBe(SavedListErrors.countsDisagree().message);
  });

  it("refuses two calls that hold the same item with different fields, rather than keep either", () => {
    const report = savedReportFromCapture({
      capture: capture({
        responses: [
          response({ body: listBody({ items: [rawItem()] }) }),
          response({ body: listBody({ items: [rawItem({ state: "complete" })] }) }),
        ],
      }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("response-invalid");
    expect(report.because).toBe(SavedListErrors.itemDisagrees({ key: "C0SYN1ABCDEFGH/1790000000.000100" }).message);
    expect(report.items).toEqual([]);
  });

  it("refuses one answer that repeats an item, rather than merge it under the counts", () => {
    const body = listBody({ items: [rawItem(), rawItem(), rawItem()], total: 1 });
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("response-invalid");
    expect(report.because).toBe("saved.list returned item C0SYN1ABCDEFGH/1790000000.000100 3 times in one answer");
  });

  it("refuses counts that total fewer items than the rows returned", () => {
    const body = listBody({ items: [rawItem(), rawItem({ ts: "1790000000.000200" })], total: 1 });
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("response-invalid");
    expect(report.because).toBe(
      "saved.list returned 2 distinct item(s) but counts only 1 — its counts cannot describe these rows",
    );
  });

  it("marks the first load truncated when the counts exceed the rows returned", () => {
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body: listBody({ items: [rawItem()], total: 5 }) })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.firstLoadTruncated).toBe(true);
    expect(report.nextCursorPresent).toBe(false);
  });

  it("marks the first load truncated when a next cursor is present, and says so in the GAP line", () => {
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body: listBody({ cursor: "c2", items: [rawItem()] }) })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.nextCursorPresent).toBe(true);
    expect(report.firstLoadTruncated).toBe(true);
    expect(renderSlackSavedReport({ report })).toContain(
      "  GAP: the first load held 1 of 1 item(s) (1 open), and Slack offered a next page — this verb follows no " +
        "cursor and scrolls nothing, so the rest is unread",
    );
  });

  it("reads an empty list as read, not as absence", () => {
    const report = savedReportFromCapture({
      capture: capture({ responses: [response({ body: listBody({ items: [] }) })] }),
      workspaceUrl: WORKSPACE,
    });
    expect(report.outcome).toBe("read");
    expect(report.items).toEqual([]);
    expect(report.firstLoadTruncated).toBe(false);
  });
});

describe("renderSlackSavedReport", () => {
  it("prints one line per item, the counts, every gap and where to read the text", () => {
    const report = savedReportFromCapture({
      capture: capture({
        accounting: ONE_LOST,
        responses: [response({ body: listBody({ items: [rawItem({ date_due: 1_792_000_000 })], total: 3 }) })],
      }),
      workspaceUrl: WORKSPACE,
    });
    expect(renderSlackSavedReport({ report })).toEqual([
      `slack saved: read — 1 item(s) from ${LATER}`,
      "  [in_progress] due 2026-10-14T17:46:40.000Z saved 2026-09-21T14:13:20.000Z " +
        "https://example-workspace.slack.com/archives/C0SYN1ABCDEFGH/p1790000000000100",
      "  counts: 3 total, 1 open (0 overdue), 2 completed, 0 archived",
      "  GAP: the first load held 1 of 3 item(s) (1 open) — this verb follows no cursor and scrolls nothing, " +
        "so the rest is unread",
      "  1 other response body(ies) were lost on this load — if one was a second saved.list call, this list is " +
        "short of what the client saw",
      "  no message text was fetched — read one deliberately with `slopweaver slack read-thread <permalink>`",
    ]);
  });
});

describe("parseSlackSavedArgs", () => {
  it("defaults to the declared settle, plain output and the ambient home", () => {
    expect(unwrap(parseSlackSavedArgs({ rest: [] }))).toEqual({
      home: undefined,
      json: false,
      settleMs: SLACK_SAVED_DEFAULT_SETTLE_MS,
    });
  });

  it("reads every flag it declares", () => {
    expect(unwrap(parseSlackSavedArgs({ rest: ["--json", "--settle", "30000", "--home", "/h"] }))).toEqual({
      home: "/h",
      json: true,
      settleMs: 30_000,
    });
  });

  it("refuses a positional, because the only list it reads is the owner's own", () => {
    expect(unwrapErr(parseSlackSavedArgs({ rest: ["U0SYN1ABCDEFGH"] })).code).toBe("POSITIONAL_COUNT_INVALID");
  });

  it("refuses a settle that is not a whole number of milliseconds", () => {
    expect(unwrapErr(parseSlackSavedArgs({ rest: ["--settle", "1.5"] })).code).toBe("INVALID_FLAG_VALUE");
  });

  it("refuses a settle past the ceiling", () => {
    const over = String(SLACK_SAVED_MAX_SETTLE_MS + 1);
    expect(unwrapErr(parseSlackSavedArgs({ rest: ["--settle", over] })).code).toBe("INVALID_FLAG_VALUE");
  });
});

describe("runSlackSaved", () => {
  it("refuses a bad invocation before touching the browser", async () => {
    expect(await runSlackSaved({ rest: ["extra"] })).toBe(EXIT_USAGE);
  });

  it("takes the relay lease under its own name, which a refused walk prints", () => {
    expect(SLACK_SAVED_LEASE_PLATFORM).toBe("slack saved");
  });
});
