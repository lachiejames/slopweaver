import { describe, expect, it } from "vitest";

import type { VantaSyncReport } from "../../../../../atlas/vanta/sync.js";
import { VantaSyncRunErrors } from "../../../../../atlas/vanta/syncErrors.js";
import {
  exitCodeForVantaSyncError,
  exitCodeForVantaSyncReport,
  parseVantaVerbOptions,
  renderVantaSyncChangesLine,
  renderVantaSyncLines,
} from "../../../../../cli/commands/vanta/core.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseVantaVerbOptions", () => {
  it("defaults home and json when neither flag is given", () => {
    const options = unwrap(parseVantaVerbOptions({ defaultHome: "/tmp/default-home", rest: [] }));
    expect(options).toEqual({ home: "/tmp/default-home", json: false });
  });

  it("honours an explicit --home and --json", () => {
    const options = unwrap(
      parseVantaVerbOptions({ defaultHome: "/tmp/default-home", rest: ["--home", "/tmp/other", "--json"] }),
    );
    expect(options).toEqual({ home: "/tmp/other", json: true });
  });

  it("refuses an unknown flag", () => {
    const result = parseVantaVerbOptions({ defaultHome: "/tmp/x", rest: ["--bogus"] });
    expect(unwrapErr(result)).toEqual(["unknown flag: --bogus"]);
  });
});

const report = ({
  credentialsConfigured,
  kinds,
}: Pick<VantaSyncReport, "credentialsConfigured" | "kinds">): VantaSyncReport => ({
  changes: { outcome: "not-recorded", reason: "a fixture" },
  credentialsConfigured,
  kinds,
  lockReleaseError: null,
});

describe("exitCodeForVantaSyncReport", () => {
  it("returns exitExpectedEmpty when credentials were absent", () => {
    const code = exitCodeForVantaSyncReport({
      exitError: EXIT_ERROR,
      exitExpectedEmpty: EXIT_EXPECTED_EMPTY,
      exitOk: EXIT_OK,
      report: report({ credentialsConfigured: false, kinds: [] }),
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("returns exitOk when every kind synced completely", () => {
    const code = exitCodeForVantaSyncReport({
      exitError: EXIT_ERROR,
      exitExpectedEmpty: EXIT_EXPECTED_EMPTY,
      exitOk: EXIT_OK,
      report: report({
        credentialsConfigured: true,
        kinds: [{ complete: true, entityCount: 1, kind: "control", reasons: [] }],
      }),
    });
    expect(code).toBe(EXIT_OK);
  });

  it("returns exitError when any kind is incomplete", () => {
    const code = exitCodeForVantaSyncReport({
      exitError: EXIT_ERROR,
      exitExpectedEmpty: EXIT_EXPECTED_EMPTY,
      exitOk: EXIT_OK,
      report: report({
        credentialsConfigured: true,
        kinds: [{ complete: false, entityCount: 0, kind: "control", reasons: ["boom"] }],
      }),
    });
    expect(code).toBe(EXIT_ERROR);
  });
});

describe("exitCodeForVantaSyncError", () => {
  it("defers a run a live lock holder stopped, so the scheduler gives the slot back", () => {
    const code = exitCodeForVantaSyncError({
      error: VantaSyncRunErrors.contended({ lines: ["could not acquire the Vanta atlas sync lock: held"] }),
      exitDeferred: EXIT_DEFERRED,
      exitError: EXIT_ERROR,
    });
    expect(code).toBe(EXIT_DEFERRED);
  });

  it("fails every other refusal", () => {
    const code = exitCodeForVantaSyncError({
      error: VantaSyncRunErrors.refused({ lines: ["nothing was written — this generation is not published"] }),
      exitDeferred: EXIT_DEFERRED,
      exitError: EXIT_ERROR,
    });
    expect(code).toBe(EXIT_ERROR);
  });
});

describe("renderVantaSyncLines", () => {
  it("names the missing env vars when credentials are not configured", () => {
    const lines = renderVantaSyncLines({ report: report({ credentialsConfigured: false, kinds: [] }) });
    expect(lines.some((line) => line.includes("VANTA_CLIENT_ID"))).toBe(true);
  });

  it("prints one line per kind plus its reasons", () => {
    const lines = renderVantaSyncLines({
      report: report({
        credentialsConfigured: true,
        kinds: [{ complete: false, entityCount: 0, kind: "control", reasons: ["boom"] }],
      }),
    });
    expect(lines[0]).toContain("control: INCOMPLETE, 0 record(s)");
    expect(lines[1]).toBe("  boom");
    expect(lines[2]).toBe("changes: not recorded — a fixture");
  });
});

describe("renderVantaSyncChangesLine", () => {
  it("names the totals, the path and the reading verb when a record was written", () => {
    const line = renderVantaSyncChangesLine({
      changes: {
        at: "2026-10-01T00:00:00.000Z",
        outcome: "recorded",
        path: "/h/vanta/changes/2026-10-01T00-00-00.000Z.json",
        totals: { added: 2, baseline: 1, changed: 7, incomplete: 0, removed: 3 },
      },
    });
    expect(line).toBe(
      "changes: 2 added, 3 removed, 7 changed, 1 baseline kind(s), 0 unread kind(s) — /h/vanta/changes/2026-10-01T00-00-00.000Z.json (read with `slopweaver atlas vanta changes`)",
    );
  });

  it("shouts a failed write, because that window is lost", () => {
    const line = renderVantaSyncChangesLine({ changes: { outcome: "failed", reason: "disk full" } });
    expect(line).toBe("changes: NOT RECORDED — disk full");
  });
});
