import { describe, expect, it } from "vitest";

import type { VantaChangeRecord } from "../../../../../atlas/vanta/changes.js";
import {
  filterVantaChangesByKind,
  parseVantaChangesOptions,
  renderUnreadVantaChangesLines,
  renderVantaChangeRecordLines,
} from "../../../../../cli/commands/vanta/changesCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SINCE = "2026-09-30T20:00:00.000Z";
const AT = "2026-10-01T00:00:00.000Z";

const RECORD: VantaChangeRecord = {
  at: AT,
  kinds: [
    {
      added: [{ name: "Acme", providerId: "v9", returned: false }],
      addedMore: 0,
      changedGroups: [
        {
          count: 3,
          examples: [
            {
              fields: [
                { after: '"FAIL"', before: '"OK"', field: "status" },
                { after: '"2"', before: '"1"', field: "lastRun" },
              ],
              name: null,
              providerId: "t1",
            },
          ],
          fields: ["lastRun", "status"],
        },
      ],
      counts: { added: 1, changed: 3, removed: 1, returned: 0, unchanged: 250 },
      fieldTally: { lastRun: 254, status: 3 },
      groupsOmitted: { entities: 251, groups: 1 },
      kind: "test",
      notes: ["companion write failed"],
      read: "complete",
      removed: [{ name: "Old", providerId: "t0" }],
      removedMore: 2,
      since: SINCE,
    },
    {
      added: [],
      addedMore: 0,
      changedGroups: [],
      counts: { added: 0, changed: 0, removed: 0, returned: 0, unchanged: 9 },
      fieldTally: {},
      groupsOmitted: { entities: 0, groups: 0 },
      kind: "policy",
      notes: [],
      read: "complete",
      removed: [],
      removedMore: 0,
      since: SINCE,
    },
    { entities: 40, kind: "framework", read: "baseline" },
    { kind: "risk", read: "incomplete", reasons: ["HTTP 503"] },
  ],
  version: 1,
};

describe("parseVantaChangesOptions", () => {
  it("lists every kind from the default home by default", () => {
    expect(unwrap(parseVantaChangesOptions({ defaultHome: "/h", rest: [] }))).toEqual({
      home: "/h",
      json: false,
      kind: null,
      mode: "list",
    });
  });

  it("narrows to one named kind", () => {
    expect(unwrap(parseVantaChangesOptions({ defaultHome: "/h", rest: ["--kind", "test", "--json"] }))).toEqual({
      home: "/h",
      json: true,
      kind: "test",
      mode: "list",
    });
  });

  it("refuses a kind Vanta does not have", () => {
    expect(unwrapErr(parseVantaChangesOptions({ defaultHome: "/h", rest: ["--kind", "nope"] }))[0]).toContain(
      "--kind nope is not a Vanta kind",
    );
  });

  it("reads --mark-read as a cursor move", () => {
    expect(unwrap(parseVantaChangesOptions({ defaultHome: "/h", rest: ["--mark-read", AT, "--home", "/o"] }))).toEqual({
      at: AT,
      home: "/o",
      json: false,
      mode: "mark-read",
    });
  });

  it("refuses --mark-read with --kind, because the cursor covers every kind", () => {
    expect(
      unwrapErr(parseVantaChangesOptions({ defaultHome: "/h", rest: ["--mark-read", AT, "--kind", "test"] })),
    ).toEqual(["--mark-read moves the cursor for every kind at once, so it takes no --kind"]);
  });
});

describe("filterVantaChangesByKind", () => {
  it("keeps every kind when none is named", () => {
    expect(filterVantaChangesByKind({ kind: null, records: [RECORD] })).toEqual([RECORD]);
  });

  it("keeps only the named kind, and drops a record that never touched it", () => {
    const other: VantaChangeRecord = {
      at: SINCE,
      kinds: [{ entities: 1, kind: "vendor", read: "baseline" }],
      version: 1,
    };
    const kept = filterVantaChangesByKind({ kind: "framework", records: [other, RECORD] });
    expect(kept).toEqual([{ ...RECORD, kinds: [{ entities: 40, kind: "framework", read: "baseline" }] }]);
  });
});

describe("renderVantaChangeRecordLines", () => {
  it("puts what moved first and folds every unmoved kind into one line", () => {
    expect(renderVantaChangeRecordLines({ record: RECORD })).toEqual([
      `== Vanta sync ${AT} ==`,
      `test: +1 added, 0 returned, -1 removed, ~3 changed, 250 unchanged — since ${SINCE}`,
      "  ! the sync still called this read failed: companion write failed",
      "  + Acme [v9]",
      "  - Old [t0]",
      "  - … and 2 more",
      "  ~ 3 changed lastRun, status",
      "      t1",
      '        status: "OK" → "FAIL"',
      '        lastRun: "1" → "2"',
      "      … and 2 more with the same fields",
      "  ~ … and 1 commoner group(s) covering 251 entit(ies); fields moved: lastRun×254, status×3",
      "framework: baseline — 40 entit(ies), the first read, so nothing compared",
      "risk: UNREAD this sync — nothing compared",
      "  HTTP 503",
      "no change: policy",
    ]);
  });
});

describe("renderUnreadVantaChangesLines", () => {
  it("says nothing is unread, and how far the log was judged", () => {
    expect(renderUnreadVantaChangesLines({ kind: null, records: [], throughAt: SINCE })).toEqual([
      `no unread Vanta changes (judged through ${SINCE})`,
    ]);
  });

  it("ends with the exact command that marks the listing judged", () => {
    const lines = renderUnreadVantaChangesLines({ kind: null, records: [RECORD], throughAt: null });
    expect(lines[0]).toBe("1 unread Vanta change record(s) (none judged yet)");
    expect(lines.at(-1)).toBe(`once judged: slopweaver atlas vanta changes --mark-read ${AT}`);
  });

  it("never offers --mark-read from a --kind listing, since the cursor covers every kind", () => {
    const lines = renderUnreadVantaChangesLines({ kind: "test", records: [RECORD], throughAt: null });
    expect(lines.at(-1)).toBe(
      "this listing shows test only — read the whole change, without --kind, before marking it judged",
    );
    expect(lines.some((line) => line.includes("--mark-read"))).toBe(false);
  });
});
