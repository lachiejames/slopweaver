import { describe, expect, it } from "vitest";

import { parseStoreStatusArgs } from "../../../cli/commands/store/statusCore.js";
import { driftSection } from "../../../cli/commands/store/statusRun.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import {
  type BronzeDriftReport,
  type ContentKey,
  contentKeyOf,
  driftLines,
  driftRepairCommand,
  missingContentIds,
} from "../../../store/bronzeDriftCore.js";
import { PRESENCE_BATCH, presenceBatches } from "../../../store/contentPresence.js";
import { StoreErrors } from "../../../store/errors.js";

const report = (over: Partial<BronzeDriftReport> = {}): BronzeDriftReport => ({
  bytesOmitted: 0,
  candidates: 0,
  examples: [],
  excluded: 0,
  filesOmitted: 0,
  filesScanned: 0,
  linesRead: 0,
  missing: 0,
  present: 0,
  refused: 0,
  scope: "windows",
  source: "slack",
  ...over,
});

describe("contentKeyOf", () => {
  it("joins on a byte a Slack native id cannot contain, so two different pairs cannot collide", () => {
    expect(contentKeyOf({ key: { source: "slack", sourceId: "C1:1.2" } })).toBe("slack\u0000C1:1.2");
    expect(contentKeyOf({ key: { source: "calendar", sourceId: "a" } })).toBe("calendar\u0000a");
  });
});

describe("missingContentIds", () => {
  it("counts the candidates the store does not hold, in scan order", () => {
    const candidates: readonly ContentKey[] = [
      { source: "slack", sourceId: "a" },
      { source: "slack", sourceId: "b" },
      { source: "slack", sourceId: "c" },
    ];
    expect(missingContentIds({ candidates, present: new Set(["slack\u0000b"]), scanned: "slack" })).toEqual({
      examples: ["a", "c"],
      missing: 2,
    });
  });

  it("reports nothing missing when the store holds every candidate", () => {
    const candidates: readonly ContentKey[] = [
      { source: "slack", sourceId: "a" },
      { source: "slack", sourceId: "b" },
    ];
    expect(
      missingContentIds({ candidates, present: new Set(["slack\u0000a", "slack\u0000b"]), scanned: "slack" }),
    ).toEqual({ examples: [], missing: 0 });
  });

  it("holds a row present under ANOTHER source, rather than calling it missing from the scanned one", () => {
    const candidates: readonly ContentKey[] = [{ source: "calendar", sourceId: "a" }];
    expect(missingContentIds({ candidates, present: new Set(["calendar\u0000a"]), scanned: "slack" })).toEqual({
      examples: [],
      missing: 0,
    });
  });

  it("writes an example from another source as source:id, because that row is an anomaly not a plain miss", () => {
    const candidates: readonly ContentKey[] = [
      { source: "calendar", sourceId: "a" },
      { source: "slack", sourceId: "b" },
    ];
    expect(missingContentIds({ candidates, present: new Set<string>(), scanned: "slack" })).toEqual({
      examples: ["calendar:a", "b"],
      missing: 2,
    });
  });

  it("reports nothing over an empty scan, rather than treating the store's rows as a surplus", () => {
    expect(missingContentIds({ candidates: [], present: new Set(["slack\u0000a"]), scanned: "slack" })).toEqual({
      examples: [],
      missing: 0,
    });
  });

  it("keeps at most ten examples however many it counted, and counts them all", () => {
    const candidates: readonly ContentKey[] = Array.from({ length: 25 }, (_unused, index) => ({
      source: "slack" as const,
      sourceId: `id-${String(index)}`,
    }));
    const absent = missingContentIds({ candidates, present: new Set<string>(), scanned: "slack" });
    expect(absent.missing).toBe(25);
    expect(absent.examples).toEqual(["id-0", "id-1", "id-2", "id-3", "id-4", "id-5", "id-6", "id-7", "id-8", "id-9"]);
  });
});

describe("driftRepairCommand", () => {
  it("names the whole-source repair, not the one file a reader happens to be looking at", () => {
    expect(driftRepairCommand({ source: "linear" })).toBe("slopweaver store ingest --source linear --limit 2000 --all");
  });
});

describe("driftLines", () => {
  it("states what a clean scan did NOT read, so a zero cannot be read as a synchronised corpus", () => {
    expect(
      driftLines({
        report: report({
          bytesOmitted: 6899158625,
          candidates: 400,
          filesOmitted: 1,
          filesScanned: 3,
          linesRead: 512,
          present: 400,
        }),
      }),
    ).toEqual([
      "slack: 0 of 400 bronze id(s) missing from the store · 3 file(s), 512 line(s) read · " +
        "1 file(s) not scanned (6899158625 bytes)",
      "  examined: 400 present · 0 line(s) excluded by the denylist · 0 refused — neither is a missing id",
    ]);
  });

  it("says nothing was omitted when a full scan read everything", () => {
    expect(
      driftLines({ report: report({ candidates: 2, filesScanned: 1, linesRead: 2, present: 2, scope: "full" }) })[0],
    ).toBe("slack: 0 of 2 bronze id(s) missing from the store · 1 file(s), 2 line(s) read · nothing omitted");
  });

  it("prints examples and the repair command only when something is missing", () => {
    expect(
      driftLines({
        report: report({
          candidates: 10,
          examples: ["1758318539.482919", "1758318540.117209"],
          excluded: 4,
          filesScanned: 2,
          linesRead: 20,
          missing: 2,
          present: 8,
          refused: 1,
          source: "github",
        }),
      }),
    ).toEqual([
      "github: 2 of 10 bronze id(s) missing from the store · 2 file(s), 20 line(s) read · nothing omitted",
      "  examined: 8 present · 4 line(s) excluded by the denylist · 1 refused — neither is a missing id",
      "  e.g. 1758318539.482919, 1758318540.117209",
      "  repair: slopweaver store ingest --source github --limit 2000 --all",
    ]);
  });
});

describe("parseStoreStatusArgs and the drift scan's bounds", () => {
  it("scans the windows scope over every source, and gates on nothing, by default", () => {
    const args = unwrap(parseStoreStatusArgs({ rest: [] }));
    expect(args.check).toBe(false);
    expect(args.scope).toBe("windows");
    expect("source" in args).toBe(false);
  });

  it("takes a named source and the full scope with no other flag, because the scan is not opt-in", () => {
    const args = unwrap(parseStoreStatusArgs({ rest: ["--source", "slack", "--full"] }));
    expect(args.scope).toBe("full");
    expect(args.source).toBe("slack");
    expect(args.check).toBe(false);
  });

  it("reads --check as the gate, separately from what the scan reads", () => {
    const args = unwrap(parseStoreStatusArgs({ rest: ["--check"] }));
    expect(args.check).toBe(true);
    expect(args.scope).toBe("windows");
  });

  it("refuses a source the store has no column for, naming the vocabulary", () => {
    const refused = parseStoreStatusArgs({ rest: ["--source", "jira"] });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr()[0]).toBe(
      `source: Invalid option: expected one of "github"|"slack"|"linear"|"notion"|"self"|"gmail"|"calendar"|"fathom"|"chatgpt"|"outlook-calendar"`,
    );
    expect(refused._unsafeUnwrapErr()[1]).toBe(
      "sources: github, slack, linear, notion, self, gmail, calendar, fathom, chatgpt, outlook-calendar",
    );
  });
});

describe("presenceBatches", () => {
  it("splits at the batch size, keeping input order", () => {
    expect(presenceBatches({ size: 2, sourceIds: ["a", "b", "c", "d", "e"] })).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("yields no batch at all over an empty input, so no caller issues an `in ()`", () => {
    expect(presenceBatches({ sourceIds: [] })).toEqual([]);
  });

  it("keeps one whole statement's worth under the default size", () => {
    const ids = Array.from({ length: PRESENCE_BATCH + 1 }, (_unused, index) => `id-${String(index)}`);
    const batches = presenceBatches({ sourceIds: ids });
    expect(batches.length).toBe(2);
    expect(batches[0]!.length).toBe(PRESENCE_BATCH);
    expect(batches[1]).toEqual([`id-${String(PRESENCE_BATCH)}`]);
  });
});

describe("driftSection", () => {
  it("renders one line per source and reports the scan as completed", () => {
    const section = driftSection({
      drift: ok({ reports: [report({ candidates: 2, missing: 1, examples: ["a"] })], withheld: [] }),
    });
    expect(section.failure).toBe(null);
    expect(section.reports.length).toBe(1);
    expect(section.withheld).toEqual([]);
    expect(section.lines[0]).toContain("slack: 1 of 2 bronze id(s) missing");
  });

  it("names a failed scan as NOT MEASURED, and carries no reports for --json to claim", () => {
    const section = driftSection({
      drift: err(StoreErrors.bronzeUnreadable({ cause: new Error("EACCES"), path: "/tmp/b/x.jsonl" })),
    });
    expect(section.failure).toBe("bronze drift: NOT MEASURED — bronze at /tmp/b/x.jsonl could not be read: EACCES");
    expect(section.reports).toEqual([]);
    expect(section.withheld).toEqual([]);
    expect(section.lines).toEqual(["bronze drift: NOT MEASURED — bronze at /tmp/b/x.jsonl could not be read: EACCES"]);
  });
});
