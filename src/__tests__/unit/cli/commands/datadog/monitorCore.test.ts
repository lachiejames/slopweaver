import { describe, expect, it } from "vitest";

import {
  iacGuard,
  monitorErrorExit,
  parseDatadogMonitorOptions,
} from "../../../../../cli/commands/datadog/monitorCore.js";
import {
  approvalLines,
  monitorCommandLine,
  monitorDiffLines,
  monitorHeadline,
} from "../../../../../cli/commands/datadog/monitorLines.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { DatadogMonitorWriteErrors } from "../../../../../datadog/monitorWriteErrors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { cpuMonitor } from "../../../../monitorApiFake.js";

describe("parseDatadogMonitorOptions", () => {
  it("reads an update's change from its flags, splitting --tags", () => {
    expect(
      unwrap(parseDatadogMonitorOptions({ rest: ["update", "50100", "--query", "q", "--tags", "a, b,"] })),
    ).toEqual({
      approve: undefined,
      change: { kind: "flags", value: { query: "q", tags: ["a", "b"] } },
      home: undefined,
      iacOverride: undefined,
      id: 50100,
      json: false,
      mode: "update",
    });
  });

  it("takes a delete's ids comma-separated, repeats dropped, order kept", () => {
    expect(unwrap(parseDatadogMonitorOptions({ rest: ["delete", "3,1", "3"] }))).toMatchObject({
      ids: [3, 1],
      mode: "delete",
    });
  });

  it("refuses an update with no change, and one with both --patch and a change flag", () => {
    expect(unwrapErr(parseDatadogMonitorOptions({ rest: ["update", "1"] })).code).toBe("OPTIONS_REFUSED");
    expect(unwrapErr(parseDatadogMonitorOptions({ rest: ["update", "1", "--patch", "-", "--name", "n"] })).code).toBe(
      "OPTIONS_REFUSED",
    );
  });

  it("refuses an id that is not a positive whole number", () => {
    expect(unwrapErr(parseDatadogMonitorOptions({ rest: ["show", "07"] })).code).toBe("INVALID_FLAG_VALUE");
    expect(unwrapErr(parseDatadogMonitorOptions({ rest: ["delete", "1,-2"] })).code).toBe("INVALID_FLAG_VALUE");
  });

  it("refuses a blank --iac-override rather than reading it as absent", () => {
    expect(unwrapErr(parseDatadogMonitorOptions({ rest: ["delete", "1", "--iac-override", " "] })).code).toBe(
      "OPTIONS_REFUSED",
    );
  });

  it("names a missing or unknown sub-verb", () => {
    expect(unwrapErr(parseDatadogMonitorOptions({ rest: [] })).code).toBe("SUB_VERB_MISSING");
    expect(unwrapErr(parseDatadogMonitorOptions({ rest: ["mute", "1"] })).code).toBe("SUB_VERB_UNKNOWN");
  });
});

describe("iacGuard", () => {
  const TAGS = ["managed-by:acme-iac"] as const;
  const managed = cpuMonitor({ tags: ["managed-by:acme-iac"] });

  it("attaches nothing when no managed monitor is in scope, even with a reason given", () => {
    expect(unwrap(iacGuard({ iacManagedTags: TAGS, iacOverride: "why", monitors: [cpuMonitor()] }))).toEqual([]);
  });

  it("is inert with no configured tag: no refusal, and no acknowledgement for a refusal that never fired", () => {
    expect(unwrap(iacGuard({ iacManagedTags: [], iacOverride: undefined, monitors: [managed] }))).toEqual([]);
    expect(unwrap(iacGuard({ iacManagedTags: [], iacOverride: "why", monitors: [managed] }))).toEqual([]);
  });

  it("refuses exactly the managed monitors without a reason, with the register's four lines", () => {
    const other = cpuMonitor({ id: 50791 });
    const error = unwrapErr(iacGuard({ iacManagedTags: TAGS, iacOverride: undefined, monitors: [managed, other] }));
    expect(error).toMatchObject({ code: "IAC_MANAGED_REFUSED", ids: [50100] });
    expect(error.message).toContain('--iac-override "<why>"');
  });

  it("turns a reason into ONE ledger acknowledgement when a configured tag matched", () => {
    expect(unwrap(iacGuard({ iacManagedTags: TAGS, iacOverride: "deployment gone", monitors: [managed] }))).toEqual([
      { reason: "deployment gone", subject: "datadog-iac-managed" },
    ]);
  });
});

describe("monitorErrorExit", () => {
  it("answers 2 for a change that is not one, 3 for a refusal, 1 for a Datadog failure", () => {
    expect(monitorErrorExit({ error: DatadogMonitorWriteErrors.patchInvalid({ detail: "x" }) })).toBe(EXIT_USAGE);
    expect(monitorErrorExit({ error: DatadogMonitorWriteErrors.alertOnlyRefused({ id: 1, violations: [] }) })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(monitorErrorExit({ error: DatadogMonitorWriteErrors.readFailed({ cause: "x", id: 1 }) })).toBe(EXIT_ERROR);
  });
});

describe("the lines a preview prints", () => {
  it("diffs each change, a multi-line value line by line", () => {
    expect(monitorDiffLines({ changes: [{ after: "a\nb", before: undefined, field: "message" }] })).toEqual([
      "  message",
      "    - (unset)",
      "    + a",
      "    + b",
    ]);
  });

  it("heads each monitor with its name, state, creator and tags", () => {
    expect(monitorHeadline({ monitor: cpuMonitor({ creator: null }) })).toBe(
      'monitor 50100 "Host CPU high" (metric alert, state Alert, creator not recorded, ' +
        "modified 2026-09-01T00:00:00.000000+00:00) tags [team:platform]",
    );
  });

  it("quotes a query so the re-run line pastes back unchanged", () => {
    expect(monitorCommandLine({ tokens: ["update", "50100", "--query", "avg:x{!host:a} > 1"] })).toBe(
      "slopweaver datadog monitor update 50100 --query 'avg:x{!host:a} > 1'",
    );
  });

  it("ends on the digest and the exact re-run", () => {
    expect(approvalLines({ command: "slopweaver datadog monitor delete 1", digest: "d" })).toEqual([
      "approve: d",
      "not sent — to apply exactly this, re-run: slopweaver datadog monitor delete 1 --approve d",
    ]);
  });
});
