import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import { runDevAnswerQualityWithDeps } from "../../../../../cli/commands/dev/answerQuality.js";
import {
  DEV_ANSWER_QUALITY_FLAG_NAMES,
  DEV_ANSWER_QUALITY_USAGE,
  parseDevAnswerQualityArgs,
  renderGrades,
  renderSelftest,
  scopeFromFlags,
} from "../../../../../cli/commands/dev/answerQualityCore.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const FIXTURE = resolve(import.meta.dirname, "../../../../../../eval/answer-quality.fixture.json");

/** A logger fake — two plain sinks, no mocking library. */
function sink(): {
  readonly lines: string[];
  readonly errors: string[];
  readonly log: { out: (arg: { line: string }) => void; error: (arg: { msg: string }) => void };
} {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    errors,
    lines,
    log: {
      error: ({ msg }: { msg: string }) => {
        errors.push(msg);
      },
      out: ({ line }: { line: string }) => {
        lines.push(line);
      },
    },
  };
}

const argvFor = ({ tail }: { tail: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "dev",
  "answer-quality",
  ...tail,
];

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "answer-quality-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("parseDevAnswerQualityArgs", () => {
  it("declares every flag the usage line advertises", () => {
    expect(DEV_ANSWER_QUALITY_FLAG_NAMES).toEqual(["--artifact", "--candidates", "--cases", "--json", "--selftest"]);
    for (const flag of DEV_ANSWER_QUALITY_FLAG_NAMES) {
      expect(DEV_ANSWER_QUALITY_USAGE).toContain(flag);
    }
  });

  it("refuses a flag the verb does not declare", () => {
    const errors = unwrapErr(parseDevAnswerQualityArgs({ rest: ["--rubric", "x"] }));
    expect(errors.join(" ")).toContain("rubric");
  });
});

describe("scopeFromFlags", () => {
  it("reads a grading scope", () => {
    const flags = unwrap(parseDevAnswerQualityArgs({ rest: ["--cases", "a.json", "--candidates", "b.json"] }));
    expect(unwrap(scopeFromFlags({ flags }))).toEqual({
      candidates: "b.json",
      cases: "a.json",
      json: false,
      selftest: false,
    });
  });

  it("reads a self-test scope", () => {
    const flags = unwrap(parseDevAnswerQualityArgs({ rest: ["--cases", "a.json", "--selftest", "--json"] }));
    expect(unwrap(scopeFromFlags({ flags }))).toEqual({
      candidates: undefined,
      cases: "a.json",
      json: true,
      selftest: true,
    });
  });

  it("requires --cases", () => {
    const flags = unwrap(parseDevAnswerQualityArgs({ rest: ["--selftest"] }));
    const error = unwrapErr(scopeFromFlags({ flags }));
    expect(error.code).toBe("CASES_PATH_MISSING");
    expect(error.message).toBe("--cases <path> is required");
  });

  it("refuses --candidates and --selftest together rather than ignoring one", () => {
    const flags = unwrap(
      parseDevAnswerQualityArgs({ rest: ["--cases", "a.json", "--candidates", "b.json", "--selftest"] }),
    );
    const error = unwrapErr(scopeFromFlags({ flags }));
    expect(error.code).toBe("MODE_CONFLICT");
    expect(error.message).toBe("--candidates and --selftest are alternatives — pass one");
  });

  it("refuses neither of them", () => {
    const flags = unwrap(parseDevAnswerQualityArgs({ rest: ["--cases", "a.json"] }));
    const error = unwrapErr(scopeFromFlags({ flags }));
    expect(error.code).toBe("MODE_MISSING");
    expect(error.message).toContain("--candidates <path> to grade answers");
  });
});

describe("renderGrades", () => {
  it("puts every named reason under its grade and says which half gates", () => {
    const lines = renderGrades({
      grades: [
        {
          band: "degraded",
          candidateLabel: "caveat stripped",
          caseId: "case-01",
          dimensions: [{ kind: "claims", met: 1, total: 1 }],
          reasons: ["caveat dropped: does not claim it was reproduced"],
          score: 0.75,
        },
      ],
    });
    expect(lines).toContain("    - caveat dropped: does not claim it was reproduced");
    expect(lines.at(-1)).toBe(
      "1 candidate(s) graded. Grading gates nothing — the --selftest half is what `dev gate` runs.",
    );
  });
});

describe("renderSelftest", () => {
  it("spells out a failure's detail rather than only its count", () => {
    const lines = renderSelftest({
      outcomes: [
        {
          caseId: "case-01",
          detail: "golden scored 0.500 (degraded)",
          property: "verbatim",
          redacted: {
            band: "degraded",
            family: "verbatim-golden-scores-top",
            metrics: [{ name: "score", value: 0.5 }],
          },
          state: "fail",
        },
      ],
    });
    expect(lines).toContain("FAIL case-01 · verbatim: golden scored 0.500 (degraded)");
    expect(lines.at(-1)).toBe("0 passed, 1 failed, 0 skipped");
  });
});

describe("runDevAnswerQualityWithDeps", () => {
  it("prints the usage for --help and exits OK", () => {
    const io = sink();
    expect(runDevAnswerQualityWithDeps({ argv: argvFor({ tail: ["--help"] }), log: io.log })).toBe(EXIT_OK);
    expect(io.lines).toEqual([DEV_ANSWER_QUALITY_USAGE]);
  });

  it("exits USAGE on a contradictory flag combination", () => {
    const io = sink();
    const code = runDevAnswerQualityWithDeps({
      argv: argvFor({ tail: ["--cases", FIXTURE, "--candidates", "b.json", "--selftest"] }),
      log: io.log,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(io.errors.join("\n")).toContain("alternatives");
  });

  it("exits ERROR naming the path when the cases file cannot be read", () => {
    const io = sink();
    const missing = join(dir, "nope.json");
    const code = runDevAnswerQualityWithDeps({
      argv: argvFor({ tail: ["--cases", missing, "--selftest"] }),
      log: io.log,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(io.errors).toEqual([`cannot read ${missing}`]);
  });

  it("self-tests the committed fixture green, with no property skipped", () => {
    const io = sink();
    const code = runDevAnswerQualityWithDeps({
      argv: argvFor({ tail: ["--cases", FIXTURE, "--selftest"] }),
      log: io.log,
    });
    expect(code).toBe(EXIT_OK);
    expect(io.lines.at(-1)).toBe("13 passed, 0 failed, 0 skipped");
  });

  it("exits ERROR when a rubric no longer fits its own golden", () => {
    const io = sink();
    const path = join(dir, "broken.json");
    writeFileSync(
      path,
      JSON.stringify({
        cases: [
          {
            claims: [{ id: "c1", label: "names the replica set", requires: [["replica set"]] }],
            goldenText: "The pool exhausted.",
            id: "case-01",
          },
        ],
        schemaVersion: 1,
      }),
    );
    const code = runDevAnswerQualityWithDeps({ argv: argvFor({ tail: ["--cases", path, "--selftest"] }), log: io.log });
    expect(code).toBe(EXIT_ERROR);
    expect(io.lines.join("\n")).toContain("FAIL case-01 · verbatim-golden-scores-top");
  });

  it("grades a caveat-stripped near-copy below the golden and names what it dropped", () => {
    const io = sink();
    const path = join(dir, "candidates.json");
    writeFileSync(
      path,
      JSON.stringify({
        candidates: [
          {
            caseId: "fixture-refusal",
            label: "caveat stripped",
            text: "Nothing in the corpus records an on-call payment policy. The thirty closest hits were coverage rosters and paging behaviour.",
          },
        ],
        schemaVersion: 1,
      }),
    );
    const code = runDevAnswerQualityWithDeps({
      argv: argvFor({ tail: ["--cases", FIXTURE, "--candidates", path] }),
      log: io.log,
    });
    expect(code).toBe(EXIT_OK);
    expect(io.lines.join("\n")).toContain("- caveat dropped: the absence is only as good as the wordings tried");
  });

  it("refuses a candidate naming a case the file does not hold", () => {
    const io = sink();
    const path = join(dir, "orphan.json");
    writeFileSync(
      path,
      JSON.stringify({
        candidates: [{ caseId: "case-99", label: "orphan", text: "anything" }],
        schemaVersion: 1,
      }),
    );
    const code = runDevAnswerQualityWithDeps({
      argv: argvFor({ tail: ["--cases", FIXTURE, "--candidates", path] }),
      log: io.log,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(io.errors).toEqual(["candidate orphan names unknown case case-99"]);
  });

  it("emits the grades as one JSON document under --json", () => {
    const io = sink();
    const code = runDevAnswerQualityWithDeps({
      argv: argvFor({ tail: ["--cases", FIXTURE, "--selftest", "--json"] }),
      log: io.log,
    });
    expect(code).toBe(EXIT_OK);
    expect(io.lines.length).toBe(1);
    expect(io.lines[0]!.startsWith('{"outcomes":')).toBe(true);
  });

  it("writes the redacted artifact, carrying the cases file's own digest and nothing of its prose", () => {
    const io = sink();
    const path = join(dir, "per-case.md");
    const code = runDevAnswerQualityWithDeps({
      argv: argvFor({ tail: ["--cases", FIXTURE, "--selftest", "--artifact", path] }),
      log: io.log,
    });
    expect(code).toBe(EXIT_OK);
    const written = readFileSync(path, "utf8");
    const digest = createHash("sha256").update(readFileSync(FIXTURE, "utf8"), "utf8").digest("hex");
    expect(written).toContain(`sha256 \`${digest}\``);
    expect(written).toContain("- cases: 2\n- outcomes: ");
    expect(written).toContain("| case-1 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |");
    expect(written).toContain("**13 passed, 0 failed, 0 skipped**");
    expect(written).toContain("| case-1 | degrades-down · caveat-dropped · e1 |");
    // Both halves: the label really is in the file the run READ, and really is not in the file it WROTE.
    expect(readFileSync(FIXTURE, "utf8")).toContain("does not claim the reported bug was reproduced");
    expect(written).not.toContain("does not claim the reported bug was reproduced");
    // Nor are the ids that file authored, however synthetic they look — only the labels the build minted.
    expect(readFileSync(FIXTURE, "utf8")).toContain("reported-bug-not-reproduced");
    expect(written).not.toContain("reported-bug-not-reproduced");
    expect(written).not.toContain("fixture-diagnosis");
    // The mapping back to them goes to the operator's terminal instead.
    expect(io.lines.join("\n")).toContain("case-1 = fixture-diagnosis");
    expect(io.lines.join("\n")).toContain("case-1/e1 = reported-bug-not-reproduced");
  });

  it("refuses --artifact beside --candidates rather than publishing a grading run", () => {
    const io = sink();
    const candidates = join(dir, "candidates.json");
    writeFileSync(
      candidates,
      JSON.stringify({
        candidates: [{ caseId: "fixture-refusal", label: "anything", text: "anything" }],
        schemaVersion: 1,
      }),
    );
    const artifact = join(dir, "never-written.md");
    const code = runDevAnswerQualityWithDeps({
      argv: argvFor({ tail: ["--cases", FIXTURE, "--candidates", candidates, "--artifact", artifact] }),
      log: io.log,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(io.errors.join("\n")).toContain("--artifact publishes a per-case self-test run — pass --selftest");
    expect(existsSync(artifact)).toBe(false);
  });

  it("publishes a minted label for a case id that is prose, keeping the prose out of the file", () => {
    const io = sink();
    const cases = join(dir, "prose-id.json");
    writeFileSync(
      cases,
      JSON.stringify({
        cases: [
          {
            claims: [{ id: "c1", label: "the pool exhausted", requires: [["pool"]] }],
            goldenText: "The pool exhausted.",
            id: "the customer's own thread",
          },
        ],
        schemaVersion: 1,
      }),
    );
    const artifact = join(dir, "prose-id.md");
    const code = runDevAnswerQualityWithDeps({
      argv: argvFor({ tail: ["--cases", cases, "--selftest", "--artifact", artifact] }),
      log: io.log,
    });
    expect(code).toBe(EXIT_OK);
    // Both halves: the prose id really is what the run read, and really is not what it wrote.
    expect(readFileSync(cases, "utf8")).toContain("the customer's own thread");
    expect(readFileSync(artifact, "utf8")).not.toContain("the customer's own thread");
    expect(readFileSync(artifact, "utf8")).toContain("| case-1 | verbatim-golden-scores-top |");
    expect(io.lines.join("\n")).toContain("case-1 = the customer's own thread");
  });
});
