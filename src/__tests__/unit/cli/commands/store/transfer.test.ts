/**
 * The store transfer verbs' argument parsing and printed reports. Pure.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { type Parsed, storeCommandErrorLines } from "../../../../../cli/commands/store/errors.js";
import {
  parseStoreImportQuestionsArgs,
  parseStoreImportResolveArgs,
} from "../../../../../cli/commands/store/importArgs.js";
import { importQuestionsLines } from "../../../../../cli/commands/store/importQuestionsRun.js";
import { importResolveLine } from "../../../../../cli/commands/store/importResolveRun.js";
import { parseStoreExportArgs, parseStoreImportArgs } from "../../../../../cli/commands/store/transferArgs.js";
import { transferLines, transferReport } from "../../../../../cli/commands/store/transferLines.js";
import { STORE_IMPORT_COMPARISON_VERSION } from "../../../../../store/transfer/compare.js";

/** The lines a refused transfer invocation prints. */
const refusalLines = ({ parsed }: { parsed: Parsed<unknown> }): readonly string[] =>
  storeCommandErrorLines({ error: unwrapErr(parsed) });

describe("parseStoreExportArgs", () => {
  it("requires --out", () => {
    const parsed = parseStoreExportArgs({ rest: ["--json"] });
    expect(unwrapErr(parsed).code).toBe("ARGUMENTS_REFUSED");
    expect(refusalLines({ parsed })).toEqual(["store export: --out needs a <dir> value"]);
  });

  it("wraps a flag the tokeniser refused as FLAGS_INVALID", () => {
    expect(unwrapErr(parseStoreExportArgs({ rest: ["--sauce"] })).code).toBe("FLAGS_INVALID");
  });

  it("reads --out, --home and --json", () => {
    expect(unwrap(parseStoreExportArgs({ rest: ["--out", "x", "--home", "h", "--json"] }))).toEqual({
      home: "h",
      json: true,
      out: "x",
    });
  });
});

describe("parseStoreImportArgs", () => {
  it("requires --from", () => {
    expect(refusalLines({ parsed: parseStoreImportArgs({ rest: [] }) })).toEqual([
      "store import: --from needs a <dir> value",
    ]);
  });

  it("reads --unmanifested and --home", () => {
    expect(unwrap(parseStoreImportArgs({ rest: ["--from", "d", "--unmanifested", "--home", "h"] }))).toEqual({
      approve: undefined,
      from: "d",
      home: "h",
      json: false,
      mode: "plan",
      unmanifested: true,
    });
  });

  it("refuses an empty --home alongside a missing --from", () => {
    expect(refusalLines({ parsed: parseStoreImportArgs({ rest: ["--home", ""] }) })).toEqual([
      "store import: --from needs a <dir> value",
      "store import: --home needs a <dir> value",
    ]);
  });

  it("reads --approve as exactly one plan digest", () => {
    const digest = `sha256:${"b".repeat(64)}`;
    expect(unwrap(parseStoreImportArgs({ rest: ["--from", "d", "--approve", digest] }))).toEqual({
      approve: digest,
      from: "d",
      home: undefined,
      json: false,
      mode: "plan",
      unmanifested: false,
    });
  });

  it("refuses an --approve that is not a plan digest, naming the shape", () => {
    const parsed = parseStoreImportArgs({ rest: ["--from", "d", "--approve", "sha256:abc"] });
    expect(unwrapErr(parsed).code).toBe("ARGUMENTS_REFUSED");
    expect(refusalLines({ parsed })).toEqual([
      "store import: --approve needs the plan digest the plan printed, sha256: and 64 hex",
    ]);
  });

  it("refuses --stop-on-conflict without --apply, since only an apply meets a difference", () => {
    expect(refusalLines({ parsed: parseStoreImportArgs({ rest: ["--from", "d", "--stop-on-conflict"] }) })).toEqual([
      "store import: --stop-on-conflict decides how --apply <batch-id> meets a difference; it needs --apply",
    ]);
  });
});

describe("parseStoreImportArgs --apply", () => {
  const BATCH = "0f1e2d3c-4b5a-4968-8776-655443322110";

  it("reads a staged batch id, --stop-on-conflict, --home and --json, and needs no --from", () => {
    expect(
      unwrap(parseStoreImportArgs({ rest: ["--apply", BATCH, "--stop-on-conflict", "--home", "h", "--json"] })),
    ).toEqual({ batchId: BATCH, home: "h", json: true, mode: "apply", stopOnConflict: true });
    expect(unwrap(parseStoreImportArgs({ rest: ["--apply", BATCH] }))).toEqual({
      batchId: BATCH,
      home: undefined,
      json: false,
      mode: "apply",
      stopOnConflict: false,
    });
  });

  it("refuses a batch id that is not a lowercase uuid", () => {
    const refusal = ["store import: --apply needs the staged batch id staging printed, a lowercase uuid"];
    expect(refusalLines({ parsed: parseStoreImportArgs({ rest: ["--apply", BATCH.toUpperCase()] }) })).toEqual(refusal);
    expect(refusalLines({ parsed: parseStoreImportArgs({ rest: ["--apply", "batch-1"] }) })).toEqual(refusal);
  });

  it("refuses every plan-only flag beside --apply, naming each, alongside an empty --home", () => {
    const rest = ["--apply", BATCH, "--from", "d", "--approve", `sha256:${"b".repeat(64)}`, "--unmanifested"];
    expect(refusalLines({ parsed: parseStoreImportArgs({ rest: [...rest, "--home", ""] }) })).toEqual([
      "store import: --home needs a <dir> value",
      "store import: --apply applies a batch already staged, so it takes no --from, --approve, --unmanifested",
    ]);
  });
});

describe("parseStoreImportResolveArgs", () => {
  it("reads the question, the answer, --home and --json", () => {
    const rest = ["--question", "import-q-0123456789abcdef", "--action", "activate", "--home", "h", "--json"];
    expect(unwrap(parseStoreImportResolveArgs({ rest }))).toEqual({
      action: "activate",
      home: "h",
      json: true,
      question: "import-q-0123456789abcdef",
    });
  });

  it("refuses a malformed question id and a missing answer together", () => {
    expect(unwrapErr(parseStoreImportResolveArgs({ rest: ["--question", "q-1"] }))).toEqual([
      "store import-resolve: --question needs a staged question id, import-q- and 16 hex",
      "store import-resolve: --action needs the answer, one the question lists",
    ]);
  });
});

describe("parseStoreImportQuestionsArgs", () => {
  it("reads --home and --json, and refuses an empty --home", () => {
    expect(unwrap(parseStoreImportQuestionsArgs({ rest: ["--json"] }))).toEqual({ home: undefined, json: true });
    expect(unwrapErr(parseStoreImportQuestionsArgs({ rest: ["--home", ""] }))).toEqual([
      "store import-questions: --home needs a <dir> value",
    ]);
  });
});

describe("transferLines", () => {
  it("prints the plan's counts and every question with its answers, and says nothing was written", () => {
    const report = transferReport({
      dir: "/x",
      manifested: false,
      parts: [
        { bytes: 4, kind: "memories", rows: 1, sha256: "a".repeat(64), status: "read" },
        { kind: "owner-voice", status: "unavailable" },
      ],
      plan: {
        comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
        digest: "sha256:plan",
        parts: [
          { conflicting: 1, identical: 0, kind: "memories", new: 0, role: "record", status: "compared" },
          { kind: "owner-voice", status: "unavailable" },
        ],
        questions: [
          {
            actions: ["keep-current", "take-imported"],
            id: "import-q-0000000000000001",
            imported: "lesson: the queue drains in order",
            key: "m-1",
            kind: "conflict",
            live: "lesson: the queue drains out of order",
            part: "memories",
          },
        ],
        unmet: [],
      },
      stage: null,
      verb: "import",
    });
    expect(report.writes).toBe(0);
    expect(transferLines({ report })).toEqual([
      "store import: /x (no manifest — read as an unmanifested export)",
      "  memories          1 row(s)           4 bytes  sha256:aaaaaaaaaaaa",
      "  owner-voice  unavailable — this export holds no such file",
      `  digest ${report.digest}`,
      "  against the live store:",
      "  memories          0 new       0 identical       1 conflicting  (record)",
      "  owner-voice  not in this export — the store's rows are left as they are",
      "  1 question(s) to answer before anything takes effect:",
      "  import-q-0000000000000001  conflict  memories m-1",
      "      imported: lesson: the queue drains in order",
      "      current:  lesson: the queue drains out of order",
      "      answers: keep-current | take-imported",
      "  plan sha256:plan",
      "  planned only: compared with the live store, and nothing was written",
    ]);
  });

  it("closes an export's report without a plan", () => {
    const report = transferReport({ dir: "/x", manifested: true, parts: [], plan: null, stage: null, verb: "export" });
    expect(transferLines({ report }).at(-1)).toBe(
      "  re-read with the import's own reader before publishing; nothing in the store or the home changed",
    );
  });

  it("closes a staged import with the batch and the rows written, and counts them as the report's writes", () => {
    const report = transferReport({
      dir: "/x",
      manifested: true,
      parts: [],
      plan: {
        comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
        digest: "sha256:plan",
        parts: [],
        questions: [],
        unmet: [],
      },
      stage: { batchId: "b-1", items: 3, outcome: "staged", questions: 1, writes: 5 },
      verb: "import",
    });
    expect(report.writes).toBe(5);
    expect(transferLines({ report }).at(-1)).toBe(
      "  staged batch b-1: 3 item(s), 1 question(s), 5 row(s) written; nothing is live",
    );
  });

  it("closes an import already staged with zero rows written", () => {
    const report = transferReport({
      dir: "/x",
      manifested: true,
      parts: [],
      plan: {
        comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
        digest: "sha256:plan",
        parts: [],
        questions: [],
        unmet: [],
      },
      stage: { batchId: "b-1", items: 3, outcome: "already-staged", questions: 1, writes: 0 },
      verb: "import",
    });
    expect(report.writes).toBe(0);
    expect(transferLines({ report }).at(-1)).toBe("  already staged as batch b-1: 0 rows written; nothing is live");
  });

  it("names every need nothing live or written provides, after the questions and before the plan digest", () => {
    const report = transferReport({
      dir: "/x",
      manifested: true,
      parts: [],
      plan: {
        comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
        digest: "sha256:plan",
        parts: [],
        questions: [],
        unmet: [
          {
            key: "bbbbbbbb-0000-4000-8000-000000000003",
            needs: "recording aaaaaaaa-0000-4000-8000-000000000001 of claim l-0000000000000001",
            part: "memory-recalls",
          },
        ],
      },
      stage: null,
      verb: "import",
    });
    expect(transferLines({ report }).slice(-5, -1)).toEqual([
      "  no questions: nothing in this export needs a decision before it is restored",
      "  1 need(s) nothing live or written provides, so this export will not apply as planned:",
      "    memory-recalls bbbbbbbb-0000-4000-8000-000000000003 needs recording aaaaaaaa-0000-4000-8000-000000000001 of claim l-0000000000000001",
      "  plan sha256:plan",
    ]);
  });
});

describe("importResolveLine and importQuestionsLines", () => {
  it("says how many rows an answer wrote", () => {
    expect(
      importResolveLine({
        outcome: { action: "leave-inactive", outcome: "recorded", questionId: "import-q-0123456789abcdef", writes: 1 },
      }),
    ).toBe("store import-resolve: import-q-0123456789abcdef answered leave-inactive; 1 row written; nothing is live");
    expect(
      importResolveLine({
        outcome: {
          action: "leave-inactive",
          outcome: "already-recorded",
          questionId: "import-q-0123456789abcdef",
          writes: 0,
        },
      }),
    ).toBe(
      "store import-resolve: import-q-0123456789abcdef was already answered leave-inactive; 0 rows written; nothing is live",
    );
  });

  it("prints each open question with one exact command per answer it takes", () => {
    const lines = importQuestionsLines({
      home: "/tmp/acme-home",
      report: {
        observedAtIso: "2026-11-01T00:00:00.000Z",
        questions: [
          {
            actions: ["activate", "leave-inactive"],
            batchId: "b-1",
            current: null,
            imported: "standing ask ask-1, covers acme",
            key: "ask-1",
            kind: "activation",
            part: "standing-asks",
            questionId: "import-q-0123456789abcdef",
            stagedAtIso: "2026-11-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(lines).toEqual([
      "store import-questions: 1 staged question(s) waiting for an answer",
      "  import-q-0123456789abcdef  activation  standing-asks ask-1  (batch b-1)",
      "      imported: standing ask ask-1, covers acme",
      "      answer: slopweaver store import-resolve --question import-q-0123456789abcdef --action activate --home /tmp/acme-home",
      "      answer: slopweaver store import-resolve --question import-q-0123456789abcdef --action leave-inactive --home /tmp/acme-home",
    ]);
  });

  it("says plainly when nothing is waiting", () => {
    expect(
      importQuestionsLines({
        home: "/tmp/acme-home",
        report: { observedAtIso: "2026-11-01T00:00:00.000Z", questions: [] },
      }),
    ).toEqual(["store import-questions: no staged import question is waiting for an answer"]);
  });

  it("carries an explicit --home into every printed answer, quoted where a shell needs it", () => {
    const lines = importQuestionsLines({
      home: "/tmp/acme home",
      report: {
        observedAtIso: "2026-11-01T00:00:00.000Z",
        questions: [
          {
            actions: ["activate"],
            batchId: "b-1",
            current: null,
            imported: "standing ask ask-1, covers acme",
            key: "ask-1",
            kind: "activation",
            part: "standing-asks",
            questionId: "import-q-0123456789abcdef",
            stagedAtIso: "2026-11-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(lines.at(-1)).toBe(
      "      answer: slopweaver store import-resolve --question import-q-0123456789abcdef --action activate --home '/tmp/acme home'",
    );
  });
});
