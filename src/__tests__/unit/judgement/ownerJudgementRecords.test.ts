/** The pure half of the owner-judgement store: rows to values and back, the active projection, import records. */
import { describe, expect, it } from "vitest";

import type { OwnerCorrection, OwnerDirective } from "../../../judgement/ownerDirective.js";
import {
  correctionOfRow,
  correctionRowOf,
  directiveOfRow,
  directiveRowOf,
  EMPTY_OWNER_DIRECTIVE_OVERLAY,
  importedRowsOf,
  importRecordsOf,
  overlayOfActiveRows,
  type StoredOwnerCorrection,
  type StoredOwnerDirective,
  snapshotMarkerRefusal,
} from "../../../judgement/ownerJudgementRecords.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DIRECTIVE: OwnerDirective = {
  id: "acme-response-policy",
  source: {
    contentHash: `sha256:${"c".repeat(64)}`,
    file: "acme-response-policy.md",
    modified: "2026-10-01T00:00:00.000Z",
  },
  text: "answer acme tickets from the runbook first",
};

const CORRECTION: OwnerCorrection = {
  id: "acme-ticket-correction",
  source: { contentHash: `sha256:${"d".repeat(64)}`, file: "acme-ticket-correction.md", modified: null },
  subject: {
    container: "C0ACME",
    source: "slack",
    sourceId: "1700000000.000100",
    url: "https://acme.example/archives/C0ACME/p1700000000000100",
  },
  text: "the ABC-1 outage was the queue, not the database",
};

/** A stored directive version with a synthetic row id. */
function storedDirective({
  directive = DIRECTIVE,
  state = "active",
  rowId = "row-1",
}: {
  directive?: OwnerDirective;
  state?: "active" | "inactive";
  rowId?: string;
} = {}): StoredOwnerDirective {
  return { ...directiveRowOf({ directive, origin: "legacy-file", state }), rowId };
}

/** A stored correction version with a synthetic row id. */
function storedCorrection({
  correction = CORRECTION,
  state = "active",
}: {
  correction?: OwnerCorrection;
  state?: "active" | "inactive";
} = {}): StoredOwnerCorrection {
  return { ...correctionRowOf({ correction, origin: "memory", state }), rowId: "row-2" };
}

describe("rows and values", () => {
  it("round-trips a directive through its stored columns", () => {
    expect(unwrap(directiveOfRow({ row: storedDirective() }))).toEqual(DIRECTIVE);
  });

  it("round-trips a correction's subject, its URL included", () => {
    expect(unwrap(correctionOfRow({ row: storedCorrection() }))).toEqual(CORRECTION);
  });

  it("stores an absent subject URL as null and reads it back absent, never as an empty string", () => {
    const { url: _url, ...subject } = CORRECTION.subject;
    const bare: OwnerCorrection = { ...CORRECTION, subject };

    expect(correctionRowOf({ correction: bare, origin: "memory", state: "active" }).subjectUrl).toBe(null);
    expect(unwrap(correctionOfRow({ row: storedCorrection({ correction: bare }) }))).toEqual(bare);
  });

  it("refuses a stored directive whose content hash is malformed, naming the row and its id", () => {
    const row: StoredOwnerDirective = { ...storedDirective(), sourceContentHash: "sha256:short" };

    const refused = unwrapErr(directiveOfRow({ row }));
    expect([refused.code, refused.message.startsWith("owner_directive row row-1 (id acme-response-policy)")]).toEqual([
      "OWNER_DIRECTIVE_ROW_UNREADABLE",
      true,
    ]);
  });

  it("refuses a stored correction with an empty subject", () => {
    const row: StoredOwnerCorrection = { ...storedCorrection(), subjectSourceId: "" };

    expect(unwrapErr(correctionOfRow({ row })).code).toBe("OWNER_DIRECTIVE_ROW_UNREADABLE");
  });
});

describe("importedRowsOf", () => {
  it("splits a home file's instructions into active legacy-file directive and correction rows", () => {
    const rows = importedRowsOf({
      records: [
        { correction: CORRECTION, kind: "correction" },
        { directive: DIRECTIVE, kind: "directive" },
      ],
    });

    expect(rows).toEqual({
      corrections: [correctionRowOf({ correction: CORRECTION, origin: "legacy-file", state: "active" })],
      directives: [directiveRowOf({ directive: DIRECTIVE, origin: "legacy-file", state: "active" })],
    });
  });

  it("answers no rows for an empty file", () => {
    expect(importedRowsOf({ records: [] })).toEqual({ corrections: [], directives: [] });
  });
});

describe("overlayOfActiveRows", () => {
  it("projects only active versions", () => {
    const retired = storedDirective({
      directive: { ...DIRECTIVE, text: "an earlier wording" },
      rowId: "row-0",
      state: "inactive",
    });

    expect(
      unwrap(overlayOfActiveRows({ stored: { corrections: [], directives: [retired, storedDirective()] } })),
    ).toEqual({ corrections: [], directives: [DIRECTIVE], schemaVersion: 2 });
  });

  it("keeps a directive and a correction that share one id, because they are two id spaces", () => {
    const shared: OwnerCorrection = { ...CORRECTION, id: DIRECTIVE.id };

    const overlay = unwrap(
      overlayOfActiveRows({
        stored: { corrections: [storedCorrection({ correction: shared })], directives: [storedDirective()] },
      }),
    );
    expect([overlay.directives.map((one) => one.id), overlay.corrections.map((one) => one.id)]).toEqual([
      ["acme-response-policy"],
      ["acme-response-policy"],
    ]);
  });

  it("refuses the whole projection when one active directive will not decode", () => {
    const row: StoredOwnerDirective = { ...storedDirective(), sourceContentHash: "sha256:short" };

    expect(
      unwrapErr(overlayOfActiveRows({ stored: { corrections: [storedCorrection()], directives: [row] } })).code,
    ).toBe("OWNER_DIRECTIVE_ROW_UNREADABLE");
  });

  it("refuses the whole projection when one active correction will not decode", () => {
    const row: StoredOwnerCorrection = { ...storedCorrection(), subjectSourceId: "" };

    expect(
      unwrapErr(overlayOfActiveRows({ stored: { corrections: [row], directives: [storedDirective()] } })).message,
    ).toContain("owner_correction row row-2 (id acme-ticket-correction) does not decode");
  });

  it("projects an empty authority to the empty overlay", () => {
    expect(unwrap(overlayOfActiveRows({ stored: { corrections: [], directives: [] } }))).toEqual(
      EMPTY_OWNER_DIRECTIVE_OVERLAY,
    );
  });
});

describe("snapshotMarkerRefusal", () => {
  it("lets a snapshot stand when it counts every imported row, a genuinely empty import included", () => {
    expect([
      snapshotMarkerRefusal({ marker: { observedRows: 2, records: 2, tableHasRows: true } }),
      snapshotMarkerRefusal({ marker: { observedRows: 0, records: 0, tableHasRows: false } }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses a snapshot counting fewer imported rows than the marker, with both numbers", () => {
    expect(snapshotMarkerRefusal({ marker: { observedRows: 1, records: 2, tableHasRows: true } })).toMatchObject({
      code: "OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT",
      expected: 2,
      observed: 1,
    });
  });

  it("refuses an uncounted marker over an emptied table as every imported row lost", () => {
    expect(snapshotMarkerRefusal({ marker: { records: 2, tableHasRows: false } })).toMatchObject({
      code: "OWNER_DIRECTIVE_IMPORT_MARKER_INCONSISTENT",
      expected: 2,
      observed: 0,
    });
  });

  it("refuses a snapshot whose marker is gone, because its rows are no longer the register", () => {
    expect(snapshotMarkerRefusal({ marker: undefined })).toMatchObject({
      code: "OWNER_DIRECTIVE_STORE_UNAVAILABLE",
      reason: "the marker the import wrote is gone",
    });
  });
});

describe("importRecordsOf", () => {
  it("lists a legacy overlay's directives, then its corrections, as import records", () => {
    expect(
      importRecordsOf({ overlay: { corrections: [CORRECTION], directives: [DIRECTIVE], schemaVersion: 2 } }),
    ).toEqual([
      { directive: DIRECTIVE, kind: "directive" },
      { correction: CORRECTION, kind: "correction" },
    ]);
  });
});
