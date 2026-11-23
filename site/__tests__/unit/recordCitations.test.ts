/*
 * A record a card names by a bare id is the chip that opens it. A bare monitor number on a card
 * ("archive #monitor-feed and delete muted monitor 50001") opens a citation chip to that Datadog monitor, and a
 * bare compliance id on a card (a control or a risk, printed as `ABC-1`) is hyperlinked too. The records below are
 * the shape `handover row --json` publishes for such cards.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { NO_RECORD_REFERENCES, recordReferencesOf } from "../../components/live/readRecords";
import { type CardReferences, inlineSegments, NO_CARD_REFERENCES } from "../../lib/inlineCitations";
import { citedRecord } from "../../lib/recordCitation";

const MONITOR = "https://ap1.datadoghq.com/monitors/50001";
const CONTROL = "https://app.vanta.com/c/acme/controls?controlId=access-revoked-termination-gdpr";
const REGISTER = "https://app.vanta.com/c/acme/risk-management/risk-register";
const PULL_17594 = "https://github.com/acme/acme-admin/pull/17594";

/** Three records as the board published them. */
const RECORDS = [
  { id: "50001", kind: "datadog-monitor", title: "[ERROR] {{service.name}}", url: MONITOR },
  { id: "HRS-29", kind: "vanta-control", title: "Access revoked upon termination", url: CONTROL },
  { id: "TTX-2", kind: "vanta-risk", title: undefined, url: REGISTER },
];

const WITH_RECORDS: CardReferences = {
  ...NO_CARD_REFERENCES,
  records: recordReferencesOf({ payload: { referenceContext: { records: RECORDS } } }),
};

describe("recordReferencesOf", () => {
  it("reads monitors by id and printed Vanta ids by their capitals", () => {
    const read = recordReferencesOf({ payload: { referenceContext: { records: RECORDS } } });
    expect([...read.monitors]).toEqual([["50001", { title: "[ERROR] {{service.name}}", url: MONITOR }]]);
    expect([...read.printed]).toEqual([
      ["HRS-29", { title: "Access revoked upon termination", url: CONTROL }],
      ["TTX-2", { title: undefined, url: REGISTER }],
    ]);
  });

  it("reads a board with no table, or a table that is not a list, as no records", () => {
    expect(recordReferencesOf({ payload: {} })).toBe(NO_RECORD_REFERENCES);
    expect(recordReferencesOf({ payload: { referenceContext: { records: "50001" } } })).toBe(NO_RECORD_REFERENCES);
  });

  it("drops an entry alone when it will not read, names an unknown kind or links anything but https", () => {
    const read = recordReferencesOf({
      payload: {
        referenceContext: {
          records: [
            ...RECORDS,
            "50002",
            { id: "50003", kind: "datadog-dashboard", url: "https://ap1.datadoghq.com/dashboard/50003" },
            { id: "50004", kind: "datadog-monitor", url: "http://ap1.datadoghq.com/monitors/50004" },
            { id: "50005", kind: "datadog-monitor", title: 7, url: "https://ap1.datadoghq.com/monitors/50005" },
            { id: "", kind: "datadog-monitor", url: "https://ap1.datadoghq.com/monitors/" },
          ],
        },
      },
    });
    expect([...read.monitors.keys()]).toEqual(["50001"]);
    expect([...read.printed.keys()]).toEqual(["HRS-29", "TTX-2"]);
  });

  it("drops an id two entries give different addresses, and keeps one repeated with the same", () => {
    const read = recordReferencesOf({
      payload: {
        referenceContext: {
          records: [
            ...RECORDS,
            { id: "50001", kind: "datadog-monitor", url: "https://app.datadoghq.com/monitors/50001" },
            { id: "HRS-29", kind: "vanta-control", url: CONTROL },
          ],
        },
      },
    });
    expect([...read.monitors.keys()]).toEqual([]);
    expect([...read.printed.keys()]).toEqual(["HRS-29", "TTX-2"]);
  });

  it("never refuses the board over a table that will not read", () => {
    const linear = { linearTeamKeys: ["QQQQ"], linearWorkspaceSlug: "acme" };
    const board = readBoard({ referenceContext: { ...linear, records: [7] }, rows: [], unresolved: 0 })!;
    expect(board.records.monitors.size).toBe(0);
    expect(board.linear).toEqual({ teamKeys: ["QQQQ"], workspaceSlug: "acme" });
    const published = readBoard({ referenceContext: { ...linear, records: RECORDS }, rows: [], unresolved: 0 })!;
    expect([...published.records.monitors.keys()]).toEqual(["50001"]);
  });
});

describe("citedRecord", () => {
  it("draws a known record as its chip, titled only when it has one, and an unknown one as words", () => {
    expect(citedRecord({ label: "TTX-2", record: { title: undefined, url: REGISTER } })).toEqual({
      kind: "cite",
      label: "TTX-2",
      url: REGISTER,
    });
    expect(citedRecord({ label: "50001", record: { title: "[ERROR] {{service.name}}", url: MONITOR } })).toEqual({
      kind: "cite",
      label: "50001",
      title: "[ERROR] {{service.name}}",
      url: MONITOR,
    });
    expect(citedRecord({ label: "50002", record: undefined })).toBe("words");
  });
});

describe("a monitor a card names", () => {
  it("is the Datadog monitor's chip, titled, in every spelling the cards use", () => {
    const cite = { kind: "cite", title: "[ERROR] {{service.name}}", url: MONITOR };
    expect(
      inlineSegments({ references: WITH_RECORDS, text: "archive #monitor-feed and delete muted monitor 50001" }),
    ).toEqual([
      { kind: "text", text: "archive #monitor-feed and delete muted " },
      { ...cite, label: "monitor 50001" },
    ]);
    expect(inlineSegments({ references: WITH_RECORDS, text: "monitor #50001." })).toEqual([
      { ...cite, label: "monitor #50001" },
      { kind: "text", text: "." },
    ]);
    expect(inlineSegments({ references: WITH_RECORDS, text: "Monitor ID: 50001" })).toEqual([
      { ...cite, label: "Monitor ID: 50001" },
    ]);
    // The `number` / `no.` a value noun already allows (review r3).
    for (const text of ["monitor number 50001", "Monitor no. 50001"]) {
      expect(inlineSegments({ references: WITH_RECORDS, text })).toEqual([{ ...cite, label: text }]);
    }
    expect(inlineSegments({ references: WITH_RECORDS, text: "the Monitors 50001 page" })).toEqual([
      { kind: "text", text: "the " },
      { ...cite, label: "Monitors 50001" },
      { kind: "text", text: " page" },
    ]);
  });

  it("stays words when the board knows no such monitor — never a pull request", () => {
    const references: CardReferences = {
      ...WITH_RECORDS,
      attested: new Map([["acme/acme-admin", 99999]]),
      checkouts: new Set(["acme/acme-admin"]),
      home: "acme/acme-admin",
    };
    expect(inlineSegments({ references, text: "delete muted monitor 50002" })).toEqual([
      { kind: "text", text: "delete muted monitor 50002" },
    ]);
    expect(inlineSegments({ references, text: "monitor #50002" })).toEqual([{ kind: "text", text: "monitor #50002" }]);
    // Field spellings that each of which used to link the number as an acme-admin pull request.
    for (const text of ["monitor_id: 50002", "monitor_id=50002", "Monitor id=50002"]) {
      expect(inlineSegments({ references, text })).toEqual([{ kind: "text", text }]);
    }
  });

  it("resolves every id a list names, and never reads a later one as a pull request — review r1", () => {
    const references: CardReferences = {
      ...NO_CARD_REFERENCES,
      attested: new Map([["acme/acme-admin", 99999]]),
      checkouts: new Set(["acme/acme-admin"]),
      home: "acme/acme-admin",
      records: recordReferencesOf({
        payload: {
          referenceContext: {
            records: [
              ...RECORDS,
              { id: "50003", kind: "datadog-monitor", url: "https://ap1.datadoghq.com/monitors/50003" },
            ],
          },
        },
      }),
    };
    const first = { kind: "cite", title: "[ERROR] {{service.name}}", url: MONITOR };
    const third = { kind: "cite", url: "https://ap1.datadoghq.com/monitors/50003" };
    expect(inlineSegments({ references, text: "monitors 50001, 50002 and #50003" })).toEqual([
      { ...first, label: "monitors 50001" },
      { kind: "text", text: ", 50002 and " },
      { ...third, label: "#50003" },
    ]);
    expect(inlineSegments({ references, text: "monitor 50002 & #50004, 50005" })).toEqual([
      { kind: "text", text: "monitor 50002 & #50004, 50005" },
    ]);
  });

  it("reads every spelling and separator review r2 found linking a monitor as a pull request", () => {
    const references: CardReferences = {
      ...WITH_RECORDS,
      attested: new Map([["acme/acme-admin", 99999]]),
      checkouts: new Set(["acme/acme-admin"]),
      home: "acme/acme-admin",
    };
    const cite = { kind: "cite", title: "[ERROR] {{service.name}}", url: MONITOR };
    expect(inlineSegments({ references, text: "Monitor IDs: 50001, 50002" })).toEqual([
      { ...cite, label: "Monitor IDs: 50001" },
      { kind: "text", text: ", 50002" },
    ]);
    expect(inlineSegments({ references, text: "monitors (50002, 50001)" })).toEqual([
      { kind: "text", text: "monitors (50002, " },
      { ...cite, label: "50001" },
      { kind: "text", text: ")" },
    ]);
    for (const text of [
      "monitor IDs 50002 and 50004",
      "monitor `50002`",
      "monitorId: 50002",
      "Monitor-ID: 50002",
      "monitor_ids=50002",
      "monitors #50002/#50004",
      "monitors 50002; 50004",
      "monitor 50002 (prod) and 50004",
    ]) {
      expect(inlineSegments({ references, text })).toEqual([{ kind: "text", text }]);
    }
  });

  it("still links a pull request the row carries straight after the noun — review r3", () => {
    const known = [PULL_17594];
    expect(inlineSegments({ known, references: WITH_RECORDS, text: "Adds two Datadog monitors (#17594)" })).toEqual([
      { kind: "text", text: "Adds two Datadog monitors (" },
      { kind: "cite", label: "#17594", url: PULL_17594 },
      { kind: "text", text: ")" },
    ]);
    expect(inlineSegments({ known, references: WITH_RECORDS, text: "Monitor: #17594 merged" })).toEqual([
      { kind: "text", text: "Monitor: " },
      { kind: "cite", label: "#17594", url: PULL_17594 },
      { kind: "text", text: " merged" },
    ]);
    expect(inlineSegments({ references: WITH_RECORDS, text: "monitor (#17594)" })).toEqual([
      { kind: "text", text: "monitor (#17594)" },
    ]);
  });

  it("still links a later number the row carries as a pull request — review r2", () => {
    expect(
      inlineSegments({
        known: [PULL_17594],
        references: WITH_RECORDS,
        text: "muted monitor 50001 and #17594 fixed it",
      }),
    ).toEqual([
      { kind: "text", text: "muted " },
      { kind: "cite", label: "monitor 50001", title: "[ERROR] {{service.name}}", url: MONITOR },
      { kind: "text", text: " and " },
      { kind: "cite", label: "#17594", url: PULL_17594 },
      { kind: "text", text: " fixed it" },
    ]);
  });
});

describe("a Vanta id a card names", () => {
  it("is the control's chip, titled, and the risk's untitled", () => {
    expect(inlineSegments({ references: WITH_RECORDS, text: "TTX-2 and HRS-29 stay open" })).toEqual([
      { kind: "cite", label: "TTX-2", url: REGISTER },
      { kind: "text", text: " and " },
      { kind: "cite", label: "HRS-29", title: "Access revoked upon termination", url: CONTROL },
      { kind: "text", text: " stay open" },
    ]);
  });

  it("leaves a known Linear team's key to Linear, and a lower-case spelling as words", () => {
    const references: CardReferences = {
      ...WITH_RECORDS,
      linearTeamKeys: ["QQQQ", "HRS"],
      linearWorkspace: "acme",
    };
    expect(inlineSegments({ references, text: "HRS-29, hrs-29 and QQQQ-134" })).toEqual([
      { kind: "cite", label: "HRS-29", url: "https://linear.app/acme/issue/HRS-29" },
      { kind: "text", text: ", " },
      { kind: "cite", label: "hrs-29", url: "https://linear.app/acme/issue/HRS-29" },
      { kind: "text", text: " and " },
      { kind: "cite", label: "QQQQ-134", url: "https://linear.app/acme/issue/QQQQ-134" },
    ]);
    expect(inlineSegments({ references: WITH_RECORDS, text: "hrs-29" })).toEqual([{ kind: "text", text: "hrs-29" }]);
  });

  it("leaves a known Linear team's key as words when the install has no workspace to link it in — review r1", () => {
    const references: CardReferences = { ...WITH_RECORDS, linearTeamKeys: ["HRS"], linearWorkspace: undefined };
    expect(inlineSegments({ references, text: "HRS-29" })).toEqual([{ kind: "text", text: "HRS-29" }]);
  });

  it("leaves a key to Linear when the row carries another issue of its team — review r2", () => {
    const known = ["https://linear.app/acme/issue/HRS-5"];
    expect(inlineSegments({ known, references: WITH_RECORDS, text: "HRS-29" })).toEqual([
      { kind: "text", text: "HRS-29" },
    ]);
  });
});
