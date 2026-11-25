import { describe, expect, it } from "vitest";
import {
  codexHumanLines,
  codexResultJson,
  parseCodexPlanOptions,
  parseCodexReviewOptions,
  validatePropertiesFile,
  verdictOf,
} from "../../../../../cli/commands/codex/core.js";
import { CodexCommandErrors } from "../../../../../cli/commands/codex/errors.js";
import type { CompletedPass } from "../../../../../codex/orchestrate.js";
import type { CodexArtifactRecord, CodexPassOutcome } from "../../../../../codex/types.js";
import { HomeReclaimErrors } from "../../../../../home/reclaim/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const PLAN_ARGV = ["node", "cli", "plan", "--pass", "p1", "--task-file", "./t.md", "--bound-seconds", "1800"];
const REVIEW_ARGV = [
  "--pass",
  "r3",
  "--property-id",
  "r3-01",
  "--property",
  "no migration is destructive",
  "--base",
  "origin/main",
  "--bound-seconds",
  "240",
  "--max-diff-bytes",
  "262144",
];

describe("parseCodexPlanOptions", () => {
  it("accepts a complete plan invocation", () => {
    const options = unwrap(parseCodexPlanOptions({ rest: PLAN_ARGV.slice(3) }));
    expect(options.pass).toBe("p1");
    expect(options.taskFile).toBe("./t.md");
    expect(options.boundSeconds).toBe(1800);
  });

  it("runs on the repository default model when no --model is named", () => {
    expect(unwrap(parseCodexPlanOptions({ rest: PLAN_ARGV.slice(3) })).model).toBe("gpt-5.6-sol");
  });

  it("takes a per-pass --model override", () => {
    const options = unwrap(parseCodexPlanOptions({ rest: [...PLAN_ARGV.slice(3), "--model", "gpt-6-astra"] }));
    expect(options.model).toBe("gpt-6-astra");
  });

  it("REFUSES a --model that cannot be a model id, before anything is spent", () => {
    const errors = unwrapErr(parseCodexPlanOptions({ rest: [...PLAN_ARGV.slice(3), "--model", "GPT 6; rm"] }));
    expect(errors).toEqual(['--model must be a Codex model id such as gpt-5.6-sol, got "GPT 6; rm"']);
  });

  it("REFUSES a repeated --model, so a malformed first one cannot hide behind a valid last one", () => {
    const errors = unwrapErr(
      parseCodexPlanOptions({
        rest: [...PLAN_ARGV.slice(3), "--model", "GPT 6; rm", "--model=gpt-6-astra"],
      }),
    );
    expect(errors).toEqual([
      "--model was given 2 times — pass it once; the parser would keep only the last and drop the rest",
    ]);
  });

  it("REFUSES a missing bound, and says why there is no default", () => {
    const errors = unwrapErr(parseCodexPlanOptions({ rest: ["--pass", "p1", "--task-file", "./t.md"] }));
    expect(errors[0]).toContain("--bound-seconds is REQUIRED and has no default");
    expect(errors[0]).toContain("only the caller knows what this pass is worth");
  });

  it("refuses a review pass id on the plan verb", () => {
    const errors = unwrapErr(
      parseCodexPlanOptions({ rest: ["--pass", "r1", "--task-file", "./t.md", "--bound-seconds", "60"] }),
    );
    expect(errors[0]).toContain("--pass must be one of p1|p2|p3 for a plan pass");
  });

  it("refuses an unknown pass id", () => {
    const errors = unwrapErr(
      parseCodexPlanOptions({ rest: ["--pass", "p9", "--task-file", "./t.md", "--bound-seconds", "60"] }),
    );
    expect(errors[0]).toContain('got "p9"');
  });

  it("refuses a non-integer bound", () => {
    const errors = unwrapErr(
      parseCodexPlanOptions({ rest: ["--pass", "p1", "--task-file", "./t.md", "--bound-seconds", "abc"] }),
    );
    expect(errors[0]).toContain("must be a positive whole number");
  });

  it("refuses an unknown flag rather than silently dropping it", () => {
    expect(unwrapErr(parseCodexPlanOptions({ rest: [...PLAN_ARGV.slice(3), "--turbo"] })).length).toBeGreaterThan(0);
  });
});

describe("parseCodexReviewOptions", () => {
  it("takes a per-pass --model override on a review", () => {
    expect(unwrap(parseCodexReviewOptions({ rest: [...REVIEW_ARGV, "--model", "gpt-6-astra"] })).model).toBe(
      "gpt-6-astra",
    );
  });

  it("accepts a single inline property", () => {
    const options = unwrap(parseCodexReviewOptions({ rest: REVIEW_ARGV }));
    expect(options.pass).toBe("r3");
    expect(options.property?.id).toBe("r3-01");
    expect(options.property?.statement).toBe("no migration is destructive");
    expect(options.base).toBe("origin/main");
    expect(options.maxDiffBytes).toBe(262_144);
    expect(options.concurrency).toBe(1);
  });

  it("accepts a properties file with an explicit concurrency", () => {
    const options = unwrap(
      parseCodexReviewOptions({
        rest: [
          "--pass",
          "r1",
          "--properties-file",
          "./props.json",
          "--base",
          "main",
          "--bound-seconds",
          "240",
          "--max-diff-bytes",
          "1000",
          "--concurrency",
          "4",
        ],
      }),
    );
    expect(options.propertiesFile).toBe("./props.json");
    expect(options.concurrency).toBe(4);
    expect(options.property).toBeUndefined();
  });

  it("REFUSES a review with no property at all — that shape never converges", () => {
    const errors = unwrapErr(
      parseCodexReviewOptions({
        rest: ["--pass", "r1", "--base", "main", "--bound-seconds", "240", "--max-diff-bytes", "10"],
      }),
    );
    expect(errors[0]).toContain("supply either --property-id with --property, or --properties-file");
    expect(errors[0]).toContain("1h50m without converging");
  });

  it("refuses both a properties file AND an inline property", () => {
    const errors = unwrapErr(parseCodexReviewOptions({ rest: [...REVIEW_ARGV, "--properties-file", "./p.json"] }));
    expect(errors).toContain("--properties-file cannot be combined with an inline --property; choose one source");
  });

  it("refuses --property without --property-id", () => {
    const errors = unwrapErr(
      parseCodexReviewOptions({
        rest: ["--pass", "r1", "--property", "x", "--base", "main", "--bound-seconds", "9", "--max-diff-bytes", "9"],
      }),
    );
    expect(errors).toContain("--property-id and --property must be given together");
  });

  it("refuses a property id that is not path-safe — ids name artifact directories", () => {
    const errors = unwrapErr(
      parseCodexReviewOptions({
        rest: [
          "--pass",
          "r1",
          "--property-id",
          "../escape",
          "--property",
          "x",
          "--base",
          "main",
          "--bound-seconds",
          "9",
          "--max-diff-bytes",
          "9",
        ],
      }),
    );
    expect(errors[0]).toContain("--property-id must be path-safe");
  });

  it("REFUSES a missing --max-diff-bytes: a byte cap is the caller's decision", () => {
    const errors = unwrapErr(
      parseCodexReviewOptions({
        rest: ["--pass", "r1", "--property-id", "a", "--property", "x", "--base", "m", "--bound-seconds", "9"],
      }),
    );
    expect(errors[0]).toContain("--max-diff-bytes is REQUIRED and has no default");
  });

  it("refuses a plan pass id on the review verb", () => {
    const errors = unwrapErr(parseCodexReviewOptions({ rest: REVIEW_ARGV.map((a) => (a === "r3" ? "p1" : a)) }));
    expect(errors[0]).toContain("--pass must be one of r1|r2|r3 for a review pass");
  });
});

describe("validatePropertiesFile", () => {
  it("accepts a well-formed file", () => {
    const properties = unwrap(
      validatePropertiesFile({
        parsed: {
          properties: [
            { id: "r1-01", statement: "one" },
            { id: "r1-02", statement: "two" },
          ],
          schemaVersion: 1,
        },
      }),
    );
    expect(properties).toHaveLength(2);
    expect(properties[0]!.id).toBe("r1-01");
  });

  it("rejects a non-object", () => {
    expect(unwrapErr(validatePropertiesFile({ parsed: "nope" }))).toEqual(CodexCommandErrors.propertiesNotObject());
  });

  it("rejects an empty properties array", () => {
    const error = unwrapErr(validatePropertiesFile({ parsed: { properties: [] } }));
    expect(error.code).toBe("PROPERTIES_EMPTY");
    expect(error.message).toBe("the properties file must have a non-empty `properties` array");
  });

  it("rejects a duplicate id, because ids identify artifact directories", () => {
    const errors = unwrapErr(
      validatePropertiesFile({
        parsed: {
          properties: [
            { id: "same", statement: "one" },
            { id: "same", statement: "two" },
          ],
        },
      }),
    );
    expect(errors.code).toBe("PROPERTIES_ENTRIES_INVALID");
    expect(errors).toEqual(
      CodexCommandErrors.propertiesEntriesInvalid({
        reasons: ['properties[1].id "same" is a duplicate — ids identify artifacts'],
      }),
    );
  });

  it("rejects an empty statement, naming the index", () => {
    const errors = unwrapErr(validatePropertiesFile({ parsed: { properties: [{ id: "a", statement: "  " }] } }));
    expect(errors).toEqual(
      CodexCommandErrors.propertiesEntriesInvalid({ reasons: ["properties[0].statement must be a non-empty string"] }),
    );
  });
});

function passWith({
  outcome,
  artifactPath,
  attempts = [
    {
      kind: "initial",
      status: "answered",
      threadId: "t",
      startedAtIso: "",
      finishedAtIso: "",
      elapsedMs: 0,
      usage: { kind: "not-measured", reason: "sdk-reported-none" },
      items: { kind: "not-measured", reason: "sdk-reported-none" },
    },
  ],
}: {
  outcome: CodexPassOutcome;
  artifactPath: string | undefined;
  attempts?: CodexArtifactRecord["attempts"];
}) {
  const record = {
    attempts,
    outcome,
    scope: { mode: "review", pass: "r1", property: { id: "r1-01", statement: "s" } },
  } as unknown as CodexArtifactRecord;
  const pass: CompletedPass = {
    location: artifactPath === undefined ? undefined : { artifactPath, runDir: "/dir" },
    persistError: artifactPath === undefined ? "disk full" : undefined,
    record,
    scratchReclaim: { freedBytes: 4096, kind: "reclaimed" },
  };
  return pass;
}

const BROKEN: CodexPassOutcome = {
  answer: { counterexample: "c", evidence: "e", propertyId: "r1-01", summary: "s", verdict: "BROKEN" },
  kind: "answered",
  rawFinalResponse: "{}",
};

const CLEAN: CodexPassOutcome = {
  answer: { counterexample: "", evidence: "e", propertyId: "r1-01", summary: "s", verdict: "CLEAN" },
  kind: "answered",
  rawFinalResponse: "{}",
};

const NO_VERDICT: CodexPassOutcome = {
  kind: "no-verdict",
  rawFinalResponse: null,
  reason: "no-conclusion-in-bound",
  salvage: null,
};

describe("verdictOf", () => {
  it("reports BROKEN as a verdict — a review that finds a defect succeeded", () => {
    expect(verdictOf({ pass: passWith({ artifactPath: "/a.md", outcome: BROKEN }) })).toBe("BROKEN");
  });

  it("reports a no-verdict with its reason attached, so it cannot be read as clean", () => {
    expect(
      verdictOf({
        pass: passWith({
          artifactPath: "/a.md",
          outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "unrecoverable-abort", salvage: null },
        }),
      }),
    ).toBe("NO_VERDICT:unrecoverable-abort");
  });

  it("reports FATAL for a transport fault", () => {
    expect(
      verdictOf({
        pass: passWith({
          artifactPath: "/a.md",
          outcome: {
            cause: { quota: null, reported: null, thrown: "m" },
            error: { kind: "llm", message: "m", operation: "o" },
            kind: "fatal",
            salvage: null,
          },
        }),
      }),
    ).toBe("FATAL");
  });
});

describe("codexResultJson", () => {
  it("emits the verdict and artifact path a caller must branch on", () => {
    const json = JSON.parse(
      codexResultJson({ passes: [passWith({ artifactPath: "/x/artifact.md", outcome: BROKEN })] }),
    );
    expect(json.schemaVersion).toBe(1);
    expect(json.passes).toHaveLength(1);
    expect(json.passes[0].verdict).toBe("BROKEN");
    expect(json.passes[0].artifactPath).toBe("/x/artifact.md");
    expect(json.passes[0].property).toBe("r1-01");
    expect(json.passes[0].persistError).toBe(null);
    expect(json.passes[0].scratchReclaim).toEqual({ freedBytes: 4096, status: "reclaimed" });
  });

  it("reports a failed scratch reclaim by code and message only, beside an unchanged verdict", () => {
    const failed: CompletedPass = {
      ...passWith({ artifactPath: "/x/artifact.md", outcome: CLEAN }),
      scratchReclaim: {
        error: HomeReclaimErrors.passScratchNotReclaimable({ artifactId: "abc", reason: "workspace-mismatch" }),
        kind: "failed",
      },
    };
    const json = JSON.parse(codexResultJson({ passes: [failed] }));
    expect(json.passes[0].verdict).toBe("CLEAN");
    expect(json.passes[0].scratchReclaim).toEqual({
      error: {
        code: "PASS_SCRATCH_NOT_RECLAIMABLE",
        message: "pass abc's scratch was left in place: the path is not the one this pass's own scratch was created at",
      },
      status: "failed",
    });
  });

  it("reports a scratch the pass never reclaimed, with why", () => {
    const unpersisted: CompletedPass = {
      ...passWith({ artifactPath: undefined, outcome: CLEAN }),
      scratchReclaim: { kind: "not-attempted", reason: "artifact-not-persisted" },
    };
    expect(JSON.parse(codexResultJson({ passes: [unpersisted] })).passes[0].scratchReclaim).toEqual({
      reason: "artifact-not-persisted",
      status: "not-attempted",
    });
  });

  it("reports a null artifact path and the persist error when the write failed", () => {
    const json = JSON.parse(codexResultJson({ passes: [passWith({ artifactPath: undefined, outcome: BROKEN })] }));
    expect(json.passes[0].artifactPath).toBe(null);
    expect(json.passes[0].persistError).toBe("disk full");
  });

  it("is one line, so a caller can read it without a parser that handles pretty-printing", () => {
    expect(codexResultJson({ passes: [passWith({ artifactPath: "/a.md", outcome: BROKEN })] })).not.toContain("\n");
  });
});

describe("codexHumanLines", () => {
  it("names the pass, verdict, composed context and artifact path", () => {
    expect(codexHumanLines({ passes: [passWith({ artifactPath: "/x/artifact.md", outcome: BROKEN })] })).toEqual([
      "r1 BROKEN — counterexample and diff evidence recorded for r1-01 → /x/artifact.md",
    ]);
  });

  it("says NOT PERSISTED with the reason when the artifact could not be written, and still composes context", () => {
    expect(codexHumanLines({ passes: [passWith({ artifactPath: undefined, outcome: BROKEN })] })).toEqual([
      "r1 BROKEN — counterexample and diff evidence recorded for r1-01 → NOT PERSISTED (disk full)",
    ]);
  });

  it("says NOT PERSISTED (unknown) when the artifact is missing and no persist error was recorded", () => {
    const pass: CompletedPass = {
      ...passWith({ artifactPath: undefined, outcome: CLEAN }),
      persistError: undefined,
    };
    expect(codexHumanLines({ passes: [pass] })).toEqual(["r1 CLEAN → NOT PERSISTED (unknown)"]);
    expect(JSON.parse(codexResultJson({ passes: [pass] })).passes[0].persistError).toBe(null);
  });

  it("keeps a first-try CLEAN line exactly as terse as before — no suffix", () => {
    expect(codexHumanLines({ passes: [passWith({ artifactPath: "/x/artifact.md", outcome: CLEAN })] })).toEqual([
      "r1 CLEAN → /x/artifact.md",
    ]);
  });

  it("enriches a no-verdict line with the composed reason, attempt chain and salvage", () => {
    expect(codexHumanLines({ passes: [passWith({ artifactPath: "/x/artifact.md", outcome: NO_VERDICT })] })).toEqual([
      "r1 NO_VERDICT:no-conclusion-in-bound — no valid conclusion before the bound expired; " +
        "attempts initial=answered; nothing was observed before the stop → /x/artifact.md",
    ]);
  });
});
