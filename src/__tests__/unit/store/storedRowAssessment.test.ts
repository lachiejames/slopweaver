/**
 * The pure half of the stored-row assessment: which rows are due, the day's slice, the verdicts file the session
 * writes, and the re-check against the row as stored. Synthetic keys and digests only; no row text anywhere.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { contentDataClassFactsFromFields, ownerTurnDataClassFacts } from "../../../store/dataClassIntake.js";
import { composeDataClassRules, type DataClassRule } from "../../../store/dataClassRules.js";
import {
  type RecordedStoredRowAssessment,
  storedRowAssessmentIndex,
} from "../../../store/recordedDataClassAssessment.js";
import {
  assessmentRuleFor,
  type DueStoredRow,
  dueStoredRows,
  newestFirst,
  parseStoredRowVerdictsFile,
  rowKeyFits,
  STORED_ROW_REASON_MAX_CHARS,
  type StoredRowAssessmentCandidate,
  type StoredRowVerdict,
  storedRowAssessmentSlice,
  storedRowMismatchLine,
  storedRowsAssessedToday,
  storedRowVerdictMismatch,
} from "../../../store/storedRowAssessment.js";

const DEFAULTS = composeDataClassRules({ installation: [] });
const PRIVATE = contentDataClassFactsFromFields({
  author: "U0FIXTURE",
  container: "slack/D0FIXTURE",
  kind: "message",
  source: "slack",
  visibility: "private",
});
const PUBLIC = contentDataClassFactsFromFields({
  author: "U0FIXTURE",
  container: "slack/C0FIXTURE",
  kind: "message",
  source: "slack",
  visibility: "public",
});
const ROW_A = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const ROW_B = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
const DIGEST = "a".repeat(64);
const PRIVATE_LANE = "default:private-lane";

/** One content candidate, private by default. */
const candidate = ({
  rowId = ROW_A,
  orderAtIso = "2026-11-20T10:00:00.000Z",
  facts = PRIVATE,
  requestSha256 = DIGEST,
}: Partial<StoredRowAssessmentCandidate> = {}): StoredRowAssessmentCandidate => ({
  facts,
  orderAtIso,
  requestSha256,
  rowId,
  table: "content",
});

/** One due row, sent by the private-lane default. */
const due = (over: Partial<StoredRowAssessmentCandidate> = {}): DueStoredRow => ({
  ...candidate(over),
  ruleId: PRIVATE_LANE,
});

/** A recorded stored-row verdict at an instant, for {@link ROW_A} by default. */
const recorded = ({
  recordedAtIso = "2026-11-20T21:30:00.000Z",
  rowId = ROW_A,
}: {
  recordedAtIso?: string;
  rowId?: string;
} = {}): RecordedStoredRowAssessment => ({
  recordedAtIso,
  requestSha256: DIGEST,
  ruleId: PRIVATE_LANE,
  subject: { kind: "stored-row", rowId, table: "content" },
  verdict: { dataClass: "personal", kind: "classified", reason: "a family arrangement" },
  version: 2,
});

describe("assessmentRuleFor", () => {
  it("names the rule that sends a private-lane row, and nothing for a row the rules leave unmatched", () => {
    expect(assessmentRuleFor({ facts: PRIVATE, rules: DEFAULTS })).toBe(PRIVATE_LANE);
    expect(assessmentRuleFor({ facts: PUBLIC, rules: DEFAULTS })).toBeUndefined();
    expect(assessmentRuleFor({ facts: ownerTurnDataClassFacts(), rules: DEFAULTS })).toBe(
      "default:owner-captured-speech",
    );
  });

  it("names nothing once an installation rule classifies the row itself", () => {
    const rules = composeDataClassRules({
      installation: [{ action: "personal", id: "install:dm", match: { container: ["slack/D0FIXTURE"] } }],
    });
    expect(assessmentRuleFor({ facts: PRIVATE, rules })).toBeUndefined();
  });
});

describe("dueStoredRows", () => {
  it("lists a row sent for assessment with no verdict for its words, and never one the rules leave unmatched", () => {
    const rows = dueStoredRows({
      assessed: new Map(),
      page: [candidate(), candidate({ facts: PUBLIC, rowId: ROW_B })],
      rules: DEFAULTS,
    });
    expect(rows.map((row) => [row.rowId, row.ruleId])).toEqual([[ROW_A, PRIVATE_LANE]]);
  });

  it("drops a row already assessed over these words under this rule, and lists it again once its words move", () => {
    const assessed = storedRowAssessmentIndex({ records: [recorded()] });
    expect(dueStoredRows({ assessed, page: [candidate()], rules: DEFAULTS })).toEqual([]);
    const moved = dueStoredRows({ assessed, page: [candidate({ requestSha256: "b".repeat(64) })], rules: DEFAULTS });
    expect(moved.map((row) => row.rowId)).toEqual([ROW_A]);
  });

  it("lists a row again when another rule now sends it", () => {
    const assessed = storedRowAssessmentIndex({ records: [recorded()] });
    const rerouted: DataClassRule[] = [
      { action: "assess", id: "install:dm-assess", match: { visibility: ["private"] } },
    ];
    const rows = dueStoredRows({
      assessed,
      page: [candidate()],
      rules: composeDataClassRules({ installation: rerouted }),
    });
    expect(rows.map((row) => row.ruleId)).toEqual(["install:dm-assess"]);
  });
});

describe("storedRowsAssessedToday", () => {
  it("counts only stored-row verdicts recorded on the local day the instant falls in", () => {
    const nowMs = new Date(2026, 10, 20, 22, 0).getTime();
    const records = [
      recorded({ recordedAtIso: new Date(2026, 10, 20, 21, 30).toISOString() }),
      recorded({ recordedAtIso: new Date(2026, 10, 19, 21, 30).toISOString(), rowId: ROW_B }),
    ];
    expect(storedRowsAssessedToday({ nowMs, records })).toBe(1);
    expect(storedRowsAssessedToday({ nowMs, records: [] })).toBe(0);
  });
});

describe("newestFirst", () => {
  it("orders newest first, breaking a tie by table then row key", () => {
    const rows = newestFirst({
      rows: [
        due({ orderAtIso: "2026-11-19T10:00:00.000Z", rowId: ROW_A }),
        due({ orderAtIso: "2026-11-20T10:00:00.000Z", rowId: ROW_B }),
        due({ orderAtIso: "2026-11-20T10:00:00.000Z", rowId: ROW_A }),
      ],
    });
    expect(rows.map((row) => [row.orderAtIso.slice(0, 10), row.rowId])).toEqual([
      ["2026-11-20", ROW_A],
      ["2026-11-20", ROW_B],
      ["2026-11-19", ROW_A],
    ]);
  });
});

describe("storedRowAssessmentSlice", () => {
  const older = due({ orderAtIso: "2026-11-19T10:00:00.000Z", rowId: ROW_A });
  const newer = due({ orderAtIso: "2026-11-20T10:00:00.000Z", rowId: ROW_B });

  it("takes the newest rows across tables up to the day's remaining capacity, reporting the backlog", () => {
    const slice = storedRowAssessmentSlice({ assessedToday: 1, limit: 2, perTable: [[older], [newer]] });
    expect(slice.due.map((row) => row.rowId)).toEqual([ROW_B]);
    expect([slice.assessedToday, slice.remaining, slice.moreDue]).toEqual([1, 1, true]);
  });

  it("offers nothing once the day's capacity is used, still reporting what waits", () => {
    const slice = storedRowAssessmentSlice({ assessedToday: 3, limit: 2, perTable: [[older]] });
    expect([slice.due, slice.remaining, slice.moreDue]).toEqual([[], 0, true]);
  });

  it("reports no backlog when every due row fits", () => {
    const slice = storedRowAssessmentSlice({ assessedToday: 0, limit: 25, perTable: [[older], [newer], []] });
    expect([slice.due.length, slice.moreDue]).toEqual([2, false]);
  });
});

describe("rowKeyFits", () => {
  it("wants a uuid for content and owner_capture, and a hex digest for owner_turn", () => {
    expect(rowKeyFits({ rowId: ROW_A, table: "content" })).toBe(true);
    expect(rowKeyFits({ rowId: ROW_A, table: "owner_capture" })).toBe(true);
    expect(rowKeyFits({ rowId: DIGEST, table: "owner_turn" })).toBe(true);
    expect(rowKeyFits({ rowId: DIGEST, table: "content" })).toBe(false);
    expect(rowKeyFits({ rowId: ROW_A, table: "owner_turn" })).toBe(false);
  });
});

/** One verdicts-file entry, for {@link ROW_A} by default. */
const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  class: "personal",
  reason: "a family arrangement",
  requestSha256: DIGEST,
  rowId: ROW_A,
  ruleId: PRIVATE_LANE,
  table: "content",
  ...over,
});

/** The file text holding these entries. */
const file = ({ entries }: { entries: readonly Record<string, unknown>[] }): string =>
  JSON.stringify({ verdicts: entries });

describe("parseStoredRowVerdictsFile", () => {
  it("reads a classified and an undecided entry, in file order", () => {
    const verdicts = unwrap(
      parseStoredRowVerdictsFile({
        text: file({ entries: [entry(), entry({ class: "undecided", reason: "cannot tell", rowId: ROW_B })] }),
      }),
    );
    expect(verdicts).toEqual([
      {
        requestSha256: DIGEST,
        rowId: ROW_A,
        ruleId: PRIVATE_LANE,
        table: "content",
        verdict: { dataClass: "personal", kind: "classified", reason: "a family arrangement" },
      },
      {
        requestSha256: DIGEST,
        rowId: ROW_B,
        ruleId: PRIVATE_LANE,
        table: "content",
        verdict: { kind: "undecided", reason: "cannot tell" },
      },
    ]);
  });

  it("refuses text that is not JSON", () => {
    expect(unwrapErr(parseStoredRowVerdictsFile({ text: "{" })).problems).toEqual(["the verdicts file is not JSON"]);
  });

  it("refuses an empty list, an extra key and the unknown class", () => {
    expect(unwrapErr(parseStoredRowVerdictsFile({ text: file({ entries: [] }) })).code).toBe(
      "STORED_ROW_VERDICTS_INVALID",
    );
    expect(
      unwrapErr(parseStoredRowVerdictsFile({ text: file({ entries: [entry({ title: "x" })] }) })).message,
    ).toContain("verdicts.0");
    expect(
      unwrapErr(parseStoredRowVerdictsFile({ text: file({ entries: [entry({ class: "unknown" })] }) })).message,
    ).toContain("verdicts.0.class");
  });

  it("refuses a blank reason, one past the bound, a malformed key and a row named twice, naming each", () => {
    const problems = unwrapErr(
      parseStoredRowVerdictsFile({
        text: file({
          entries: [
            entry({ reason: "  " }),
            entry({ reason: "x".repeat(STORED_ROW_REASON_MAX_CHARS + 1), rowId: ROW_B }),
            entry({ rowId: "not-a-key" }),
            entry({ rowId: ROW_B }),
          ],
        }),
      }),
    ).problems;
    expect(problems).toEqual([
      `verdicts.0 (content/${ROW_A}) gives no reason`,
      `verdicts.1 (content/${ROW_B})'s reason is 301 characters, over 300`,
      "verdicts.2 (content/not-a-key) names a row key that is not a content key",
      `verdicts.3 (content/${ROW_B}) names a row already named earlier in the file`,
    ]);
  });

  it("accepts a reason exactly at the bound", () => {
    const text = file({ entries: [entry({ reason: "x".repeat(STORED_ROW_REASON_MAX_CHARS) })] });
    expect(unwrap(parseStoredRowVerdictsFile({ text })).length).toBe(1);
  });
});

const VERDICT: StoredRowVerdict = {
  requestSha256: DIGEST,
  rowId: ROW_A,
  ruleId: PRIVATE_LANE,
  table: "content",
  verdict: { dataClass: "personal", kind: "classified", reason: "a family arrangement" },
};

describe("storedRowVerdictMismatch", () => {
  it("passes a row still sent by the same rule over the same words", () => {
    expect(
      storedRowVerdictMismatch({
        current: { facts: PRIVATE, requestSha256: DIGEST },
        rules: DEFAULTS,
        verdict: VERDICT,
      }),
    ).toBeUndefined();
  });

  it("names each thing that moved", () => {
    expect(storedRowVerdictMismatch({ current: undefined, rules: DEFAULTS, verdict: VERDICT })).toEqual({
      kind: "row-absent",
    });
    expect(
      storedRowVerdictMismatch({
        current: { facts: PUBLIC, requestSha256: DIGEST },
        rules: DEFAULTS,
        verdict: VERDICT,
      }),
    ).toEqual({ kind: "not-sent-for-assessment" });
    expect(
      storedRowVerdictMismatch({
        current: { facts: PRIVATE, requestSha256: DIGEST },
        rules: DEFAULTS,
        verdict: { ...VERDICT, ruleId: "install:old" },
      }),
    ).toEqual({ currentRuleId: PRIVATE_LANE, kind: "rule-moved" });
    expect(
      storedRowVerdictMismatch({
        current: { facts: PRIVATE, requestSha256: "b".repeat(64) },
        rules: DEFAULTS,
        verdict: VERDICT,
      }),
    ).toEqual({ currentSha256: "b".repeat(64), kind: "words-moved" });
  });
});

describe("storedRowMismatchLine", () => {
  it("names the row and what moved, quoting only a digest prefix", () => {
    expect(storedRowMismatchLine({ mismatch: { kind: "row-absent" }, verdict: VERDICT })).toBe(
      `content/${ROW_A}: the store no longer holds this row, so nothing was recorded for it`,
    );
    expect(
      storedRowMismatchLine({ mismatch: { currentSha256: "b".repeat(64), kind: "words-moved" }, verdict: VERDICT }),
    ).toBe(
      `content/${ROW_A}: its words changed since they were read (digest is now ${"b".repeat(12)}), ` +
        "so nothing was recorded for it; read store assessment-due again",
    );
  });
});
