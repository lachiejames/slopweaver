/**
 * The autonomy register's projection, and the discriminator that decides which of its two shapes a line is.
 *
 * The case that earns its place is the LAST one: a line carrying a `steer` field on an action row. Four of
 * those sit in the live register today and zero real steer lines do, so a criterion keyed off `steer`
 * rather than `steeredIso` would read all four as steers and drop the `why` and `witness` that make an
 * autonomous act checkable.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  autonomyImportDivergences,
  importedAutonomyKey,
  projectAutonomyLine,
} from "../../../../store/fleet/autonomyEvent.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";

const PATH = "/tmp/autonomy.jsonl";

/** A real action line from the live register, reduced to the fields the projection reads. */
const ACTION_LINE = JSON.stringify({
  actionId: "16644-enqueue",
  bySession: "workspace:123 act-on-open-acme-admin-prs (fd64a339)",
  doneIso: "2026-09-12T02:06:09Z",
  kind: "press-merge-when-ready",
  subject: "https://github.com/acme/acme-admin/pull/16644",
  why: "Every gate GitHub publishes was already satisfied.",
  witness: "slopweaver github enqueue --pr 16644 -> 'queued #16644 into staging at position 1'",
});

describe("projectAutonomyLine", () => {
  it("reads an action line into the action columns", () => {
    const row = unwrap(projectAutonomyLine({ line: ACTION_LINE, lineNumber: 1, path: PATH }));

    expect(row.entryKind).toBe("action");
    expect(row.actionId).toBe("16644-enqueue");
    expect(row.kind).toBe("press-merge-when-ready");
    expect(row.subject).toBe("https://github.com/acme/acme-admin/pull/16644");
    expect(row.why).toBe("Every gate GitHub publishes was already satisfied.");
    expect(row.occurredAt.toISOString()).toBe("2026-09-12T02:06:09.000Z");
    expect(row.steer).toBe(null);
  });

  it("reads a steer line into the steer columns, leaving why and witness NULL", () => {
    const line = JSON.stringify({
      actionId: "16644-enqueue",
      bySession: "supervisor",
      steer: "yeah that one was right",
      steeredIso: "2026-09-13T09:00:00Z",
    });

    const row = unwrap(projectAutonomyLine({ line, lineNumber: 2, path: PATH }));

    expect(row.entryKind).toBe("steer");
    expect(row.steer).toBe("yeah that one was right");
    expect(row.why).toBe(null);
    expect(row.witness).toBe(null);
    expect(row.occurredAt.toISOString()).toBe("2026-09-13T09:00:00.000Z");
  });

  it("reads an ACTION that carries the owner's word inline as an action, not as a steer", () => {
    const line = JSON.stringify({
      actionId: "618-enqueue",
      bySession: "d26c60fc",
      doneIso: "2026-09-13T06:06:27Z",
      kind: "github.pr.enqueue",
      steer: "the owner had already said to queue these",
      subject: "https://github.com/lachiejames/slopweaver/pull/618",
      why: "Ten of ten checks passed on the rebased tree.",
      witness: "slopweaver github enqueue --pr 618 -> 'queued at position 1'",
    });

    const row = unwrap(projectAutonomyLine({ line, lineNumber: 3, path: PATH }));

    expect(row.entryKind).toBe("action");
    expect(row.steer).toBe("the owner had already said to queue these");
    expect(row.why).toBe("Ten of ten checks passed on the rebased tree.");
    expect(row.witness).toBe("slopweaver github enqueue --pr 618 -> 'queued at position 1'");
  });

  it("stores the validated record whole under the imported: prefix, so it can never collide with a mirror row", () => {
    const row = unwrap(projectAutonomyLine({ line: ACTION_LINE, lineNumber: 1, path: PATH }));

    expect(row.importKey).toBe(importedAutonomyKey({ line: ACTION_LINE, lineNumber: 1 }));
    expect(row.importKey.startsWith("imported:")).toBe(true);
    expect(row.record).toEqual(JSON.parse(ACTION_LINE));
  });

  it("refuses an action missing its witness through the ledger's own decoder, naming the line", () => {
    const line = JSON.stringify({
      actionId: "x",
      bySession: "workspace:1",
      doneIso: "2026-09-12T02:06:09Z",
      kind: "press-merge-when-ready",
      subject: "https://example.invalid/1",
      why: "because",
    });

    const error = unwrapErr(projectAutonomyLine({ line, lineNumber: 5, path: PATH }));

    expect(error.code).toBe("AUTONOMY_LINE_REFUSED");
    expect(error.message).toContain(`${PATH}:5 is not a record the ledger can hold`);
    expect(error.message).toContain("witness is not a string");
  });

  it("refuses a steer missing its words", () => {
    const line = JSON.stringify({ actionId: "x", bySession: "s", steeredIso: "2026-09-13T09:00:00Z" });

    const error = unwrapErr(projectAutonomyLine({ line, lineNumber: 6, path: PATH }));

    expect(error.code).toBe("AUTONOMY_LINE_REFUSED");
    expect(error.message).toContain("steer must carry actionId, steer, steeredIso and bySession as strings");
  });

  it("refuses a line with no actionId at all, and points at the repair verb", () => {
    const error = unwrapErr(projectAutonomyLine({ line: JSON.stringify({ kind: "x" }), lineNumber: 7, path: PATH }));

    expect(error.code).toBe("AUTONOMY_LINE_REFUSED");
    expect(error.message).toContain("actionId is not a string");
    expect(error.message).toContain("repair it with `slopweaver autonomy adopt`, then import again");
  });

  it("refuses an action with no instant, naming doneIso", () => {
    const line = JSON.stringify({ actionId: "x", bySession: "b", kind: "k", subject: "s", why: "w", witness: "t" });

    const error = unwrapErr(projectAutonomyLine({ line, lineNumber: 9, path: PATH }));

    expect(error.code).toBe("AUTONOMY_LINE_REFUSED");
    expect(error.message).toContain("doneIso is not a string");
  });
});

describe("autonomyImportDivergences", () => {
  const projected = [
    { lineNumber: 1, row: unwrap(projectAutonomyLine({ line: ACTION_LINE, lineNumber: 1, path: PATH })) },
  ];

  it("finds nothing when the store holds the same act, whatever its key order or import key", () => {
    const reordered = { ...JSON.parse(ACTION_LINE), actionId: "16644-enqueue" } as unknown;
    const stored = [{ actionId: "16644-enqueue", entryKind: "action", importKey: "verb:other", record: reordered }];

    expect(autonomyImportDivergences({ path: PATH, projected, stored })).toEqual([]);
  });

  it("names the line whose act the store holds differently, and the line the store never took", () => {
    const changed = { ...JSON.parse(ACTION_LINE), why: "a different reason" } as unknown;
    const held = [{ actionId: "16644-enqueue", entryKind: "action", importKey: "verb:other", record: changed }];
    const diverged = FleetImportErrors.autonomyImportDiverged({
      actionId: "16644-enqueue",
      entryKind: "action",
      lineNumber: 1,
      path: PATH,
    });

    expect(autonomyImportDivergences({ path: PATH, projected, stored: held })).toEqual([diverged]);
    expect(autonomyImportDivergences({ path: PATH, projected, stored: [] })).toEqual([diverged]);
  });
});
