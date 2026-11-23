/**
 * The grant journal's projection — three envelope shapes flattened into one row.
 *
 * The same projection serves the verbs writing `grant_row` today and the one-time import of a legacy journal,
 * so a case here holds for both.
 *
 * The envelopes are built with `../../../../grants/grant.ts`'s own writers where it exposes them and by
 * hand where it does not, so a case asserts against the shape that module really produces.
 */
import { describe, expect, it } from "vitest";

import type { GrantEntry } from "../../../../grants/grant.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";
import { grantEntryRow, grantImportDivergences, projectGrantLine } from "../../../../store/fleet/grantRow.js";

const PATH = "/tmp/grants/journal.jsonl";

const GRANT_LINE = JSON.stringify({
  grant: {
    anchor: "transcript:a0000007#33dac8fe",
    change: "export const LIMIT = 40;",
    changeKind: "literal",
    id: "g-001",
    pinnedAtRecord: true,
    recordedAtIso: "2026-09-14T10:00:00.000Z",
    recordedBySessionId: "supervisor-session",
    target: { kind: "file", path: "src/lib/paging.ts" },
  },
  kind: "grant",
});

describe("projectGrantLine", () => {
  it("flattens a grant envelope, reading the fields from inside it rather than off the envelope", () => {
    const row = unwrap(projectGrantLine({ line: GRANT_LINE, lineNumber: 1, path: PATH }));

    expect(row.entryKind).toBe("grant");
    expect(row.grantId).toBe("g-001");
    expect(row.changeKind).toBe("literal");
    expect(row.change).toBe("export const LIMIT = 40;");
    expect(row.anchor).toBe("transcript:a0000007#33dac8fe");
    expect(row.targetFile).toBe("src/lib/paging.ts");
    expect(row.bySession).toBe("supervisor-session");
    expect(row.recordedAt.toISOString()).toBe("2026-09-14T10:00:00.000Z");
  });

  it("leaves targetFile NULL for a SYSTEM target, so the two are distinguishable in the table", () => {
    const line = JSON.stringify({
      grant: {
        anchor: "a",
        change: "c",
        changeKind: "diff",
        id: "g-002",
        pinnedAtRecord: false,
        recordedAtIso: "2026-09-14T10:00:00.000Z",
        recordedBySessionId: "s",
        target: { kind: "system", name: "datadog" },
      },
      kind: "grant",
    });

    const row = unwrap(projectGrantLine({ line, lineNumber: 1, path: PATH }));

    expect(row.targetFile).toBe(null);
  });

  it("flattens a performance into detail, carrying what the session actually wrote", () => {
    const line = JSON.stringify({
      kind: "performance",
      performance: {
        grantId: "g-001",
        performedAtIso: "2026-09-14T11:00:00.000Z",
        performedBySessionId: "worker-session",
        wrote: "export const LIMIT = 40;",
      },
    });

    const row = unwrap(projectGrantLine({ line, lineNumber: 2, path: PATH }));

    expect(row.entryKind).toBe("performance");
    expect(row.grantId).toBe("g-001");
    expect(row.detail).toBe("export const LIMIT = 40;");
    expect(row.refusalCode).toBe(null);
    expect(row.change).toBe(null);
  });

  it("flattens a refusal, keeping the code a refusal is required to name", () => {
    const line = JSON.stringify({
      kind: "refusal",
      refusal: {
        code: "CHANGE_MISMATCH",
        grantId: "g-001",
        refusedAtIso: "2026-09-14T12:00:00.000Z",
        refusedBySessionId: "worker-session",
        why: "the file already reads 41",
      },
    });

    const row = unwrap(projectGrantLine({ line, lineNumber: 3, path: PATH }));

    expect(row.entryKind).toBe("refusal");
    expect(row.refusalCode).toBe("CHANGE_MISMATCH");
    expect(row.detail).toBe("the file already reads 41");
  });

  it("keeps the envelope whole, so a field this projection ignores is still recoverable", () => {
    const row = unwrap(projectGrantLine({ line: GRANT_LINE, lineNumber: 1, path: PATH }));

    expect(row.entry["kind"]).toBe("grant");
  });

  it("refuses a line the journal's own decoder does not accept", () => {
    const result = projectGrantLine({ line: JSON.stringify({ kind: "nonsense" }), lineNumber: 4, path: PATH });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("UNREADABLE_LINE");
  });

  it("gives the same line at the same position the same key, so a re-import is a no-op", () => {
    const once = unwrap(projectGrantLine({ line: GRANT_LINE, lineNumber: 11, path: PATH }));
    const again = unwrap(projectGrantLine({ line: GRANT_LINE, lineNumber: 11, path: PATH }));

    expect(once.importKey).toBe(again.importKey);
  });
});

const GRANT_ENTRY = JSON.parse(GRANT_LINE) as GrantEntry & { kind: "grant" };

describe("grantEntryRow", () => {
  it("projects a runtime entry with its derived key, keeping the envelope whole as the entry column", () => {
    const row = unwrap(grantEntryRow({ entry: GRANT_ENTRY, importKey: "written:grant:g-001", verbatim: GRANT_ENTRY }));
    expect(row.importKey).toBe("written:grant:g-001");
    expect(row.entry).toEqual(GRANT_ENTRY);
    expect(row.grantId).toBe("g-001");
    expect(row.recordedAt.toISOString()).toBe("2026-09-14T10:00:00.000Z");
  });

  it("answers the entry's own instant text when it is not a readable instant", () => {
    const entry: GrantEntry = {
      kind: "performance",
      performance: { grantId: "g-001", performedAtIso: "later", performedBySessionId: "s", wrote: "w" },
    };
    expect(unwrapErr(grantEntryRow({ entry, importKey: "k", verbatim: entry }))).toBe("later");
  });
});

describe("grantImportDivergences", () => {
  const projected = unwrap(projectGrantLine({ line: GRANT_LINE, lineNumber: 3, path: PATH }));
  const storedRow = ({ entry }: { entry: unknown }) => ({
    entry,
    entryKind: "grant",
    grantId: "g-001",
    importKey: "written:grant:g-001",
  });

  it("finds none when the stored row holds the same entry, whatever its key order", () => {
    const reversedGrant = Object.fromEntries(Object.entries(GRANT_ENTRY.grant).toReversed());
    const reordered = { kind: "grant", grant: reversedGrant };
    expect(Object.keys(reversedGrant)).not.toEqual(Object.keys(GRANT_ENTRY.grant));
    expect(
      grantImportDivergences({
        path: PATH,
        projected: [{ lineNumber: 3, row: projected }],
        stored: [storedRow({ entry: reordered })],
      }),
    ).toEqual([]);
  });

  it("reports a line whose grant differs from the one the store holds under its id, naming the line", () => {
    const differing = { ...GRANT_ENTRY, grant: { ...GRANT_ENTRY.grant, change: "x" } };
    expect(
      grantImportDivergences({
        path: PATH,
        projected: [{ lineNumber: 3, row: projected }],
        stored: [storedRow({ entry: differing })],
      }),
    ).toEqual([
      FleetImportErrors.grantImportDiverged({ entryKind: "grant", grantId: "g-001", lineNumber: 3, path: PATH }),
    ]);
  });

  it("does not read a row the store holds and no line produced as a divergence", () => {
    expect(grantImportDivergences({ path: PATH, projected: [], stored: [storedRow({ entry: GRANT_ENTRY })] })).toEqual(
      [],
    );
  });

  it("reads a refusal line edited since an earlier import as one more refusal, never a divergence", () => {
    const refusalLine = ({ why }: { why: string }): string =>
      JSON.stringify({
        kind: "refusal",
        refusal: {
          code: "CHANGE_MISMATCH",
          grantId: "g-001",
          refusedAtIso: "2026-09-14T12:00:00.000Z",
          refusedBySessionId: "s",
          why,
        },
      });
    const first = unwrap(projectGrantLine({ line: refusalLine({ why: "A" }), lineNumber: 1, path: PATH }));
    const edited = unwrap(projectGrantLine({ line: refusalLine({ why: "B" }), lineNumber: 1, path: PATH }));
    const asStored = ({ row }: { row: typeof first }) => ({
      entry: row.entry,
      entryKind: "refusal",
      grantId: "g-001",
      importKey: row.importKey,
    });

    expect(edited.importKey).not.toBe(first.importKey);
    expect(
      grantImportDivergences({
        path: PATH,
        projected: [{ lineNumber: 1, row: edited }],
        stored: [asStored({ row: first }), asStored({ row: edited })],
      }),
    ).toEqual([]);
  });

  it("reports a line the store holds no row for at all, since the import's insert should have landed it", () => {
    expect(grantImportDivergences({ path: PATH, projected: [{ lineNumber: 3, row: projected }], stored: [] })).toEqual([
      FleetImportErrors.grantImportDiverged({ entryKind: "grant", grantId: "g-001", lineNumber: 3, path: PATH }),
    ]);
  });
});
