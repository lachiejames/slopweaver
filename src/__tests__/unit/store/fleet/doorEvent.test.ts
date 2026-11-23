/**
 * The door ledger's projection, and the one decision in it that is a judgement: provenance.
 *
 * The provenance boundary is driven from BOTH sides with an explicit separator instant rather than through
 * the shipped constant, so these cases keep meaning what they say if it is ever re-derived, and separate
 * cases pin both constants.
 *
 * The two REGRESSION cases at the end are the counterexample review found, kept as tests: the
 * first version of this module separated on the ambient-home guard COMMIT, and a worktree on a pre-guard
 * commit went on writing test records for nearly four hours after it.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  AMBIENT_HOME_GUARD_ISO,
  doorProvenance,
  LAST_PROVEN_TEST_WRITE_ISO,
  projectDoorLine,
} from "../../../../store/fleet/doorEvent.js";

const GUARD = "2026-09-03T17:08:55.922Z";
const PATH = "/tmp/door.jsonl";

/** A real line from the live ledger, reduced to the fields the projection reads. */
const REAL_LINE = JSON.stringify({
  action: "verb:slack.post",
  duplicateKey: "17a781b818464232d582e2cdfe31e239",
  effect: "external-write",
  findings: [],
  overridden: [],
  runId: "c9f61506-66ce-4282-8e43-2546aec64cbb",
  schemaVersion: 1,
  status: "pass",
  tsIso: "2026-07-31T01:16:36.673Z",
});

describe("projectDoorLine", () => {
  it("reads every column off one real ledger line", () => {
    const row = unwrap(projectDoorLine({ guardIso: GUARD, line: REAL_LINE, lineNumber: 7, path: PATH }));

    expect(row.action).toBe("verb:slack.post");
    expect(row.effect).toBe("external-write");
    expect(row.status).toBe("pass");
    expect(row.doorRunId).toBe("c9f61506-66ce-4282-8e43-2546aec64cbb");
    expect(row.duplicateKey).toBe("17a781b818464232d582e2cdfe31e239");
    expect(row.occurredAt.toISOString()).toBe("2026-07-31T01:16:36.673Z");
    expect(row.acknowledgement).toBe(null);
  });

  it("keeps a finding's summary, which is the whole record of what was NOT sent", () => {
    const held = JSON.stringify({
      action: "verb:slack.post",
      effect: "external-write",
      findings: [{ code: "slack.duplicate-send", severity: "warn", summary: "already gone out" }],
      overridden: [],
      status: "warn",
      tsIso: "2026-09-04T00:00:00.000Z",
    });

    const row = unwrap(projectDoorLine({ guardIso: GUARD, line: held, lineNumber: 1, path: PATH }));

    expect(row.findings).toEqual([{ code: "slack.duplicate-send", severity: "warn", summary: "already gone out" }]);
  });

  it("projects the acknowledgements LIST, which is what a door write records now", () => {
    const waived = JSON.stringify({
      acknowledgements: [
        { reason: "approved by a human reviewer", subject: "codex-loop-incomplete" },
        { reason: "replaced by run 33717812345", subject: "ci-rollup-superseded" },
      ],
      action: "verb:github.enqueue",
      effect: "external-write",
      findings: [],
      overridden: [],
      status: "pass",
      tsIso: "2026-09-20T00:00:00.000Z",
    });

    const row = unwrap(projectDoorLine({ guardIso: GUARD, line: waived, lineNumber: 1, path: PATH }));

    expect(row.acknowledgement).toEqual([
      { reason: "approved by a human reviewer", subject: "codex-loop-incomplete" },
      { reason: "replaced by run 33717812345", subject: "ci-rollup-superseded" },
    ]);
  });

  it("still projects a HISTORICAL singular acknowledgement, lifted into the one-element list", () => {
    const waived = JSON.stringify({
      acknowledgement: { reason: "a one-word typo fix", subject: "codex-loop-incomplete" },
      action: "verb:github.enqueue",
      effect: "external-write",
      findings: [],
      overridden: [],
      status: "pass",
      tsIso: "2026-09-04T00:00:00.000Z",
    });

    const row = unwrap(projectDoorLine({ guardIso: GUARD, line: waived, lineNumber: 1, path: PATH }));

    expect(row.acknowledgement).toEqual([{ reason: "a one-word typo fix", subject: "codex-loop-incomplete" }]);
  });

  it("carries an overridden code list through as strings", () => {
    const waived = JSON.stringify({
      action: "verb:slack.post",
      effect: "external-write",
      findings: [],
      overridden: ["slack.duplicate-send"],
      status: "pass",
      tsIso: "2026-09-04T00:00:00.000Z",
    });

    const row = unwrap(projectDoorLine({ guardIso: GUARD, line: waived, lineNumber: 1, path: PATH }));

    expect(row.overridden).toEqual(["slack.duplicate-send"]);
  });

  it("gives two identical lines at different positions different import keys", () => {
    const first = unwrap(projectDoorLine({ guardIso: GUARD, line: REAL_LINE, lineNumber: 1, path: PATH }));
    const second = unwrap(projectDoorLine({ guardIso: GUARD, line: REAL_LINE, lineNumber: 2, path: PATH }));

    expect(first.importKey).not.toBe(second.importKey);
    // Zero-padded, so the keys sort in source order as text — the property `importKey.ts` exists for.
    expect(first.importKey.endsWith(":0000000001")).toBe(true);
    expect(second.importKey.endsWith(":0000000002")).toBe(true);
  });

  it("gives the same line at the same position the same key, so a re-import is a no-op", () => {
    const once = unwrap(projectDoorLine({ guardIso: GUARD, line: REAL_LINE, lineNumber: 42, path: PATH }));
    const again = unwrap(projectDoorLine({ guardIso: GUARD, line: REAL_LINE, lineNumber: 42, path: PATH }));

    expect(once.importKey).toBe(again.importKey);
  });

  it("refuses a line that is not JSON, naming the file and the line", () => {
    const result = projectDoorLine({ guardIso: GUARD, line: "{not json", lineNumber: 9, path: PATH });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("UNREADABLE_LINE");
    expect(result._unsafeUnwrapErr().message).toContain("/tmp/door.jsonl:9");
  });

  it("refuses a line missing the action, naming the field", () => {
    const line = JSON.stringify({ effect: "external-write", status: "pass", tsIso: "2026-09-04T00:00:00.000Z" });

    const result = projectDoorLine({ guardIso: GUARD, line, lineNumber: 3, path: PATH });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("carries no action");
  });

  it("derives a pre-door gate row's action from its gate when the line predates the action field", () => {
    const line = JSON.stringify({
      effect: "external-write",
      findings: [{ code: "voice-rule", message: "matches the configured literal voice rule", path: "lead" }],
      gate: "above-the-fold-voice",
      hatch: "SLOPWEAVER_ALLOW_VOICE_RULES",
      schemaVersion: 1,
      status: "refused",
      surface: "slack",
      tsIso: "2026-09-19T02:25:39.244Z",
    });

    const row = unwrap(projectDoorLine({ guardIso: GUARD, line, lineNumber: 199955, path: PATH }));

    expect(row.action).toBe("gate:above-the-fold-voice");
    expect(row.status).toBe("refused");
  });

  it("keeps a written action over the gate, so a current gate row projects exactly as written", () => {
    const line = JSON.stringify({
      action: "gate:above-the-fold-voice",
      effect: "external-write",
      gate: "some-other-gate",
      status: "refused",
      tsIso: "2026-09-19T02:30:08.124Z",
    });

    const row = unwrap(projectDoorLine({ guardIso: GUARD, line, lineNumber: 1, path: PATH }));

    expect(row.action).toBe("gate:above-the-fold-voice");
  });

  it("refuses a timestamp it cannot read rather than defaulting it", () => {
    const line = JSON.stringify({
      action: "verb:slack.post",
      effect: "external-write",
      status: "pass",
      tsIso: "the day before yesterday",
    });

    const result = projectDoorLine({ guardIso: GUARD, line, lineNumber: 4, path: PATH });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("UNREADABLE_INSTANT");
  });
});

describe("doorProvenance", () => {
  it("calls a row before the separator unattributable", () => {
    const verdict = doorProvenance({ guardIso: GUARD, occurredAt: new Date("2026-09-03T17:08:55.921Z") });

    expect(verdict).toBe("unattributable");
  });

  it("calls a row AT the separator unattributable, because that instant IS a test write", () => {
    const verdict = doorProvenance({ guardIso: GUARD, occurredAt: new Date(GUARD) });

    expect(verdict).toBe("unattributable");
  });

  it("calls a row strictly after the separator attributed", () => {
    const verdict = doorProvenance({ guardIso: GUARD, occurredAt: new Date("2026-09-03T17:08:55.923Z") });

    expect(verdict).toBe("attributed");
  });

  it("stamps the projected row, so the column is never left to a caller to fill", () => {
    const row = unwrap(projectDoorLine({ guardIso: GUARD, line: REAL_LINE, lineNumber: 1, path: PATH }));

    // REAL_LINE is a Slack post — inside the era the test suite was polluting the ledger.
    expect(row.provenance).toBe("unattributable");
  });

  it("pins the separator to the last row that carries a proven test marker", () => {
    // Two independent markers agree on this instant, and the module header carries both commands: the
    // last `C1` fixture-channel row is 17:08:55.875Z and the last row on the dominant fixture
    // duplicateKey is 17:08:55.922Z, in the same burst. A constant that drifts off it re-labels rows.
    expect(LAST_PROVEN_TEST_WRITE_ISO).toBe("2026-09-03T17:08:55.922Z");
  });

  it("keeps the guard commit as the explanation, not the criterion", () => {
    // `git log --format='%H %cI' --diff-filter=A -- src/__tests__/setup-ambient-home.ts` prints the guard
    // commit and the instant asserted below.
    expect(AMBIENT_HOME_GUARD_ISO).toBe("2026-09-03T13:15:51Z");
    expect(new Date(AMBIENT_HOME_GUARD_ISO).getTime()).toBeLessThan(new Date(LAST_PROVEN_TEST_WRITE_ISO).getTime());
  });

  it("REGRESSION: a test lap that ran seven minutes after the guard commit is not attributed", () => {
    // The counterexample review found: one second holds 37 door rows, 20 of them on one
    // duplicateKey — one of the three keys accounting for
    // 137,217 rows across the whole ledger. A worktree on a pre-guard commit was still running the suite.
    const line = JSON.stringify({
      action: "verb:slack.post",
      duplicateKey: "b1aaf6c437b93abdf3fcd1ed14b9bda4",
      effect: "external-write",
      findings: [],
      overridden: [],
      status: "pass",
      tsIso: "2026-09-03T13:22:36.000Z",
    });

    const row = unwrap(projectDoorLine({ guardIso: LAST_PROVEN_TEST_WRITE_ISO, line, lineNumber: 1, path: PATH }));

    expect(row.provenance).toBe("unattributable");
  });

  it("REGRESSION: the last C1 fixture row is not attributed either", () => {
    // `C1` is a two-character channel id no real Slack channel has. Eight rows carrying it sit AFTER the
    // guard commit, which is the second half of the same counterexample.
    const line = JSON.stringify({
      action: "verb:slack.post",
      effect: "external-write",
      findings: [
        {
          code: "slack.duplicate-send",
          severity: "warn",
          summary: "this exact message has already gone out to C1 under this identity",
        },
      ],
      overridden: [],
      status: "warn",
      tsIso: "2026-09-03T17:08:55.875Z",
    });

    const row = unwrap(projectDoorLine({ guardIso: LAST_PROVEN_TEST_WRITE_ISO, line, lineNumber: 1, path: PATH }));

    expect(row.provenance).toBe("unattributable");
  });
});
