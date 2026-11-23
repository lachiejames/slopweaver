/*
 * The ledger-line failures of the fleet import: each factory names its own code, carries the line it points at,
 * and is reachable through `FleetImportErrors` unchanged, so no caller needs to know the module they live in.
 */
import { describe, expect, it } from "vitest";

import { FleetImportErrors } from "../../../../store/fleet/errors.js";
import { LedgerImportErrors } from "../../../../store/fleet/ledgerImportErrors.js";

describe("LedgerImportErrors", () => {
  it("builds the autonomy divergence with the act, the line and the stored-row-stands message", () => {
    const error = LedgerImportErrors.autonomyImportDiverged({
      actionId: "act-1",
      entryKind: "action",
      lineNumber: 4,
      path: "/h/autonomy.jsonl",
    });
    expect(error.code).toBe("AUTONOMY_IMPORT_DIVERGED");
    expect(error.message).toBe(
      "/h/autonomy.jsonl:4 differs from the stored action for act act-1; the stored row stands and was not overwritten",
    );
  });

  it("builds the grant divergence with the grant and the line", () => {
    const error = LedgerImportErrors.grantImportDiverged({
      entryKind: "grant",
      grantId: "g-001",
      lineNumber: 2,
      path: "/h/grants.jsonl",
    });
    expect(error.code).toBe("GRANT_IMPORT_DIVERGED");
    expect(error.message).toBe(
      "/h/grants.jsonl:2 differs from the stored grant for grant g-001; the stored row stands and was not overwritten",
    );
  });

  it("builds the fallback divergence naming which document differs", () => {
    const error = LedgerImportErrors.fallbackImportDiverged({ document: "receipt", path: "/h/fb/a", requestId: "a" });
    expect(error.code).toBe("FALLBACK_IMPORT_DIVERGED");
    expect(error.message).toBe(
      "/h/fb/a's receipt differs from the stored receipt for a; the stored row stands and was not overwritten",
    );
  });

  it("builds the refused autonomy line pointing at the repair verb", () => {
    const error = LedgerImportErrors.autonomyLineRefused({ lineNumber: 7, path: "/h/autonomy.jsonl", why: "bad id" });
    expect(error.code).toBe("AUTONOMY_LINE_REFUSED");
    expect(error.message).toBe(
      "/h/autonomy.jsonl:7 is not a record the ledger can hold (bad id) — repair it with `slopweaver autonomy adopt`, then import again",
    );
  });

  it("is spread into FleetImportErrors, which builds the very same failures", () => {
    expect(
      FleetImportErrors.grantImportDiverged({ entryKind: "grant", grantId: "g", lineNumber: 1, path: "/p" }),
    ).toEqual(LedgerImportErrors.grantImportDiverged({ entryKind: "grant", grantId: "g", lineNumber: 1, path: "/p" }));
  });
});
