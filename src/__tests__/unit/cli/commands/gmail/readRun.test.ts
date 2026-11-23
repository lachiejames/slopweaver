/** Unit: the `gmail list` / `gmail read` shells — dispatch, the human vs `--json` choice, and exit codes. */
import { describe, expect, it } from "vitest";
import {
  type GmailReadDeps,
  runGmailList,
  runGmailMeasure,
  runGmailRead,
} from "../../../../../cli/commands/gmail/readRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import type { GmailMeasureResult } from "../../../../../live/gmail/measure.js";
import type { GmailListingResult, GmailMessageResult, GmailReadMessage } from "../../../../../live/gmail/read.js";

const NOW = "2026-08-27T12:00:00.000Z";

const MESSAGE: GmailReadMessage = {
  attachments: [],
  authored: "the body",
  body: "the body",
  bodyFormat: "text",
  htmlLinks: [],
  cc: [],
  from: "sender@example.test",
  id: "m1",
  labelIds: ["INBOX"],
  quotedCharsDropped: 0,
  sentAtIso: NOW,
  snippet: "the bod",
  subject: "the subject",
  threadId: "t1",
  to: ["me@example.test"],
  unsubscribe: {
    kind: "one-click",
    listUnsubscribe: "<https://sender.example.test/u?t=1>",
    listUnsubscribePost: "List-Unsubscribe=One-Click",
  },
};

const LISTING: GmailListingResult = {
  document: {
    coverage: { detail: "1 message(s) read as metadata only, capped at 25", kind: "bounded", residue: ["more exists"] },
    data: { entries: [] },
    readAtIso: NOW,
    source: "gmail",
    target: { address: "is:unread", identity: "me@example.test", kind: "search" },
  },
  listing: {
    account: "me@example.test",
    more: true,
    entries: [
      {
        from: "sender@example.test",
        hasAttachments: false,
        id: "m1",
        labelIds: ["INBOX", "UNREAD"],
        sentAtIso: NOW,
        snippet: "the bod",
        subject: "the subject",
        threadId: "t1",
        unread: true,
      },
    ],
    labelIds: [],
    query: "is:unread",
    resultSizeEstimate: 1,
  },
};

const READ: GmailMessageResult = {
  document: {
    coverage: { detail: "one message, read in full", kind: "bounded", residue: ["thread may hold others"] },
    data: { messages: [] },
    readAtIso: NOW,
    source: "gmail",
    target: { address: "m1", identity: "me@example.test", kind: "message" },
  },
  payload: { account: "me@example.test", messages: [MESSAGE], threadId: "t1", unreadMessages: 0 },
};

const MEASUREMENT: GmailMeasureResult = {
  document: {
    coverage: { detail: "7 message(s) enumerated in 1 listing call(s); 2 read for size", kind: "bounded", residue: [] },
    data: {},
    readAtIso: NOW,
    source: "gmail",
    target: { address: "me@example.test", identity: "me@example.test", kind: "mailbox" },
  },
  measurement: {
    account: "me@example.test",
    bytesSampled: 2,
    complete: true,
    estimatedBytes: 7000,
    listCalls: 1,
    meanMessageBytes: 1000,
    messagesCounted: 7,
    messagesTotalReported: 9,
    newestSentAtIso: "2026-08-01T00:00:00.000Z",
    oldestSentAtIso: "2026-01-01T00:00:00.000Z",
    query: undefined,
  },
};

/** Captured shell output plus the arguments each seam was called with. */
interface Captured {
  readonly deps: GmailReadDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly calls: string[];
}

/** The labels a list call named, joined — or "-" when it named none, so the call record never has an empty slot. */
function labelsOf({ labelIds }: { labelIds: readonly string[] }): string {
  const joined = labelIds.join("+");
  if (joined === "") {
    return "-";
  }
  return joined;
}

function fakeDeps({ failure = false }: { failure?: boolean } = {}): Captured {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const calls: string[] = [];
  return {
    calls,
    deps: {
      list: async ({ query = "-", labelIds, limit, home = "-" }) => {
        calls.push(`list:${query}:${labelsOf({ labelIds })}:${String(limit)}:${home}`);
        return failure ? err(GmailErrors.notConnected()) : ok(LISTING);
      },
      measure: async ({ query = "-", byteSample, home = "-" }) => {
        calls.push(`measure:${query}:${String(byteSample)}:${home}`);
        return failure ? err(GmailErrors.notConnected()) : ok(MEASUREMENT);
      },
      read: async ({ address, thread, home = "-" }) => {
        calls.push(`read:${address}:${String(thread)}:${home}`);
        return failure ? err(GmailErrors.scopeMissing({ missing: ["scope-x"] })) : ok(READ);
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
  };
}

describe("runGmailList", () => {
  it("passes the parsed query, labels, limit and home through to the reader", async () => {
    const captured = fakeDeps();
    const code = await runGmailList({
      deps: captured.deps,
      rest: ["--query", "is:unread", "--label", "INBOX", "--limit", "5", "--home", "/tmp/h"],
    });
    expect(code).toBe(EXIT_OK);
    expect(captured.calls).toStrictEqual(["list:is:unread:INBOX:5:/tmp/h"]);
  });

  it("renders the human view with the residue above the rows", async () => {
    const captured = fakeDeps();
    await runGmailList({ deps: captured.deps, rest: [] });
    const rendered = captured.out.join("\n");
    expect(rendered).toContain("residue:");
    expect(rendered.indexOf("more exists")).toBeLessThan(rendered.indexOf("the subject"));
  });

  it("emits the shared document as JSON under --json", async () => {
    const captured = fakeDeps();
    await runGmailList({ deps: captured.deps, rest: ["--json"] });
    expect(JSON.parse(captured.out[0]!)).toStrictEqual(LISTING.document);
  });

  it("refuses a bad limit with EXIT_USAGE, having called no reader at all", async () => {
    const captured = fakeDeps();
    const code = await runGmailList({ deps: captured.deps, rest: ["--limit", "999"] });
    expect(code).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
  });

  it("reports a typed read failure on the diagnostic lane and exits with an error", async () => {
    const captured = fakeDeps({ failure: true });
    const code = await runGmailList({ deps: captured.deps, rest: [] });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.out).toStrictEqual([]);
    expect(captured.diagnostics[0]).toContain("slopweaver gmail connect");
  });
});

describe("runGmailRead", () => {
  it("passes the id and --thread through", async () => {
    const captured = fakeDeps();
    const code = await runGmailRead({ deps: captured.deps, rest: ["t1", "--thread"] });
    expect(code).toBe(EXIT_OK);
    expect(captured.calls).toStrictEqual(["read:t1:true:-"]);
  });

  it("renders the message envelope and body in the human view", async () => {
    const captured = fakeDeps();
    await runGmailRead({ deps: captured.deps, rest: ["m1"] });
    const rendered = captured.out.join("\n");
    expect(rendered).toContain("subject: the subject");
    expect(rendered).toContain("the body");
  });

  it("prints the unsubscribe pair the message's own headers carry, verbatim beside its kind", async () => {
    const captured = fakeDeps();
    await runGmailRead({ deps: captured.deps, rest: ["m1"] });
    const lines = captured.out.join("\n").split("\n");
    expect(lines.filter((line) => line.startsWith("unsubscribe:"))).toEqual([
      "unsubscribe: one-click · <https://sender.example.test/u?t=1> · post List-Unsubscribe=One-Click",
    ]);
  });

  it("emits the shared document as JSON under --json", async () => {
    const captured = fakeDeps();
    await runGmailRead({ deps: captured.deps, rest: ["m1", "--json"] });
    expect(JSON.parse(captured.out[0]!)).toStrictEqual(READ.document);
  });

  it("refuses a missing id with EXIT_USAGE and calls no reader", async () => {
    const captured = fakeDeps();
    const code = await runGmailRead({ deps: captured.deps, rest: [] });
    expect(code).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
  });

  it("names the missing scope when the grant is too narrow", async () => {
    const captured = fakeDeps({ failure: true });
    const code = await runGmailRead({ deps: captured.deps, rest: ["m1"] });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics[0]).toContain("scope-x");
  });
});

describe("runGmailMeasure", () => {
  it("passes the parsed query, byte sample and home through to the measurer", async () => {
    const captured = fakeDeps();
    const code = await runGmailMeasure({
      deps: captured.deps,
      rest: ["--query", "from:x", "--sample-bytes", "5", "--home", "/tmp/h"],
    });
    expect(code).toBe(EXIT_OK);
    expect(captured.calls).toEqual(["measure:from:x:5:/tmp/h"]);
  });

  it("renders the three headline numbers in the human lane", async () => {
    const captured = fakeDeps();
    await runGmailMeasure({ deps: captured.deps, rest: [] });
    expect(captured.out[0]).toContain("messages:       7 listable");
    expect(captured.out[0]).toContain("oldest:         2026-01-01T00:00:00.000Z");
    expect(captured.out[0]).toContain("size (ESTIMATE): 6.8 KB");
  });

  it("emits the shared document, not the human render, under --json", async () => {
    const captured = fakeDeps();
    await runGmailMeasure({ deps: captured.deps, rest: ["--json"] });
    expect(JSON.parse(captured.out[0]!).target.kind).toBe("mailbox");
  });

  it("refuses a non-numeric --sample-bytes before any credential is read", async () => {
    const captured = fakeDeps();
    const code = await runGmailMeasure({ deps: captured.deps, rest: ["--sample-bytes", "lots"] });
    expect(code).toBe(EXIT_USAGE);
    expect(captured.calls).toEqual([]);
    expect(captured.diagnostics[0]).toContain("--sample-bytes must be a number");
  });

  it("reports a measurement failure on the diagnostic lane and exits non-zero", async () => {
    const captured = fakeDeps({ failure: true });
    const code = await runGmailMeasure({ deps: captured.deps, rest: [] });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.out).toEqual([]);
  });
});
