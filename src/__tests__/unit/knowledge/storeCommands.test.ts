/**
 * The four store-backed knowledge verbs, exercised where they can be exercised without a database.
 *
 * Each one's REFUSAL paths are the whole of what a unit test can honestly reach: `--help`, a malformed
 * argument list, a missing required flag, and the store-not-configured refusal. What a connected database
 * does with them is proven against a real Postgres, not mocked here — `.claude/rules/testing.md` bans the
 * mock that would be needed to fake one, and a faked database proves the fake.
 *
 * The `SLOPWEAVER_STORE_URL` cases matter beyond coverage: they are the witness that every one of these
 * verbs refuses with a REASON rather than reporting an empty result, which is the property recall's whole
 * design rests on.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { knowledgeDetectCommand, runKnowledgeDetect } from "../../../cli/commands/knowledge/detect.js";
import { knowledgeExportCommand, runKnowledgeExport } from "../../../cli/commands/knowledge/exportMemories.js";
import {
  knowledgeImportLessonsCommand,
  runKnowledgeImportLessons,
} from "../../../cli/commands/knowledge/importLessons.js";
import {
  knowledgePruneCommand,
  runKnowledgePrune,
  runKnowledgePruneWithDeps,
} from "../../../cli/commands/knowledge/prune.js";
import { knowledgeRecallCommand, runKnowledgeRecall } from "../../../cli/commands/knowledge/recall.js";
import { knowledgeRecalledCommand, runKnowledgeRecalled } from "../../../cli/commands/knowledge/recalled.js";
import {
  knowledgeRememberCommand,
  runKnowledgeRemember,
  runKnowledgeRememberWithDeps,
} from "../../../cli/commands/knowledge/remember.js";
import { knowledgeRestoreCommand, runKnowledgeRestore } from "../../../cli/commands/knowledge/restoreMemories.js";
import { knowledgeTraceCommand, runKnowledgeTrace } from "../../../cli/commands/knowledge/trace.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { STORE_URL_ENV } from "../../../store/client.js";
import { knowledgeDomainFake } from "../../knowledgeDomainFixture.js";

/** The argv shape the runners slice: node, index.js, noun, verb, then the verb's own flags. */
function argv({ flags }: { flags: readonly string[] }): readonly string[] {
  return ["node", "index.js", "knowledge", "verb", ...flags];
}

const cleanups: (() => void)[] = [];

/** A throwaway directory this test may write a fixture into. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-import-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

let savedUrl: string | undefined;

beforeEach(() => {
  savedUrl = process.env[STORE_URL_ENV];
  delete process.env[STORE_URL_ENV];
});

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
  if (savedUrl === undefined) {
    delete process.env[STORE_URL_ENV];
    return;
  }
  process.env[STORE_URL_ENV] = savedUrl;
});

describe("every store-backed verb is wired to a runner", () => {
  it("exports a command object per verb", () => {
    expect([
      typeof knowledgeExportCommand,
      typeof knowledgeImportLessonsCommand,
      typeof knowledgePruneCommand,
      typeof knowledgeRecallCommand,
      typeof knowledgeRememberCommand,
      typeof knowledgeRestoreCommand,
    ]).toEqual(["function", "function", "function", "function", "function", "function"]);
  });
});

describe("knowledge recall", () => {
  it("prints usage for --help without opening a connection", async () => {
    expect(await runKnowledgeRecall(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses an empty query as a usage failure", async () => {
    expect(await runKnowledgeRecall(argv({ flags: [] }))).toBe(EXIT_USAGE);
  });

  it("refuses a limit past the page bound before any connection is attempted", async () => {
    expect(await runKnowledgeRecall(argv({ flags: ["datadog", "--limit", "500"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a kind outside the two-value vocabulary", async () => {
    expect(await runKnowledgeRecall(argv({ flags: ["datadog", "--kind", "fact"] }))).toBe(EXIT_USAGE);
  });

  it("refuses with the store URL missing, rather than answering an empty page", async () => {
    expect(await runKnowledgeRecall(argv({ flags: ["datadog"] }))).toBe(EXIT_ERROR);
  });
});

describe("knowledge trace", () => {
  const complete: readonly string[] = [
    "--domain",
    "store-detective",
    "--question",
    "why did the staging pool exhaust",
    "--probe",
    "slopweaver store probe k6",
    "--evidence",
    "exact 0",
  ];

  it("is wired to its runner — the exported command IS what the manifest dispatches", async () => {
    expect(await knowledgeTraceCommand(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("prints usage for --help without opening a connection", async () => {
    expect(await runKnowledgeTrace(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses a missing outcome as a usage failure", async () => {
    expect(await runKnowledgeTrace(argv({ flags: complete }))).toBe(EXIT_USAGE);
  });

  it("refuses an empty probe that says nothing about what it does not prove, before any connection", async () => {
    expect(await runKnowledgeTrace(argv({ flags: [...complete, "--outcome", "empty"] }))).toBe(EXIT_USAGE);
  });

  it("refuses with the store URL missing, rather than reporting a write that never happened", async () => {
    expect(await runKnowledgeTrace(argv({ flags: [...complete, "--outcome", "paid"] }))).toBe(EXIT_ERROR);
  });
});

describe("knowledge recalled", () => {
  it("is wired to its runner — the exported command IS what the manifest dispatches", async () => {
    expect(await knowledgeRecalledCommand(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses with no claim id, since there is nothing to account against", async () => {
    expect(await runKnowledgeRecalled(argv({ flags: ["--outcome", "held", "--evidence", "checked"] }))).toBe(
      EXIT_USAGE,
    );
  });

  it("refuses a broke with no verdict, before any connection is attempted", async () => {
    expect(
      await runKnowledgeRecalled(argv({ flags: ["l-abc", "--outcome", "broke", "--evidence", "it is gone"] })),
    ).toBe(EXIT_USAGE);
  });

  it("refuses a verdict on an outcome that did not break", async () => {
    expect(
      await runKnowledgeRecalled(
        argv({ flags: ["l-abc", "--outcome", "held", "--evidence", "still true", "--verdict", "refuted"] }),
      ),
    ).toBe(EXIT_USAGE);
  });

  it("refuses with the store URL missing, rather than reporting an accounting row it never wrote", async () => {
    expect(
      await runKnowledgeRecalled(argv({ flags: ["l-abc", "--outcome", "held", "--evidence", "still true"] })),
    ).toBe(EXIT_ERROR);
  });
});

describe("knowledge detect", () => {
  it("is wired to its runner — the exported command IS what the manifest dispatches", async () => {
    expect(await knowledgeDetectCommand(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses with no task, since a wave with no task briefs nobody", async () => {
    expect(await runKnowledgeDetect(argv({ flags: ["--term", "staging"] }))).toBe(EXIT_USAGE);
  });

  it("refuses with no --term, before any connection is attempted", async () => {
    expect(await runKnowledgeDetect(argv({ flags: ["why", "does", "it", "exhaust"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a slots value that is not a whole number of at least one", async () => {
    expect(await runKnowledgeDetect(argv({ flags: ["a task", "--term", "staging", "--slots", "0"] }))).toBe(EXIT_USAGE);
  });

  it("refuses with the store URL missing, rather than planning a wave off no counts", async () => {
    expect(await runKnowledgeDetect(argv({ flags: ["a task", "--term", "staging"] }))).toBe(EXIT_ERROR);
  });
});

describe("knowledge import-lessons", () => {
  it("prints usage for --help", async () => {
    expect(await runKnowledgeImportLessons(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses without a file", async () => {
    expect(await runKnowledgeImportLessons(argv({ flags: ["--dry-run"] }))).toBe(EXIT_USAGE);
  });

  it("refuses when neither --dry-run nor --apply is given", async () => {
    expect(await runKnowledgeImportLessons(argv({ flags: ["--file", "/nowhere/lessons.jsonl"] }))).toBe(EXIT_USAGE);
  });

  it("refuses when BOTH --dry-run and --apply are given", async () => {
    expect(
      await runKnowledgeImportLessons(argv({ flags: ["--file", "/nowhere/x.jsonl", "--dry-run", "--apply"] })),
    ).toBe(EXIT_USAGE);
  });
});

describe("knowledge export", () => {
  it("prints usage for --help", async () => {
    expect(await runKnowledgeExport(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses without --out", async () => {
    expect(await runKnowledgeExport(argv({ flags: [] }))).toBe(EXIT_USAGE);
  });

  it("refuses with the store URL missing, before writing any file", async () => {
    expect(await runKnowledgeExport(argv({ flags: ["--out", "/nowhere/export.jsonl"] }))).toBe(EXIT_ERROR);
  });
});

describe("knowledge restore", () => {
  it("prints usage for --help", async () => {
    expect(await runKnowledgeRestore(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses without --file", async () => {
    expect(await runKnowledgeRestore(argv({ flags: [] }))).toBe(EXIT_USAGE);
  });
});

describe("knowledge prune", () => {
  /** A plan file in a throwaway directory, one line per entry. */
  function planFile({ lines }: { lines: readonly string[] }): string {
    const path = join(scratch(), "plan.jsonl");
    writeFileSync(path, lines.join("\n"));
    return path;
  }

  it("prints usage for --help without opening a connection", async () => {
    expect(await runKnowledgePrune(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses without --plan", async () => {
    expect(await runKnowledgePrune(argv({ flags: [] }))).toBe(EXIT_USAGE);
  });

  it("refuses an empty --plan value as usage", async () => {
    expect(await runKnowledgePrune(argv({ flags: ["--plan", ""] }))).toBe(EXIT_USAGE);
  });

  it("fails, not usage, on a --plan that names no file", async () => {
    expect(await runKnowledgePrune(argv({ flags: ["--plan", join(scratch(), "absent.jsonl")] }))).toBe(EXIT_ERROR);
  });

  it("refuses a malformed plan whole, before any connection is attempted", async () => {
    const plan = planFile({ lines: ['{"op":"retire","id":"l-aaaa","reason":"fine"}', "not json"] });
    const deps = { domains: knowledgeDomainFake().port };
    expect(await runKnowledgePruneWithDeps({ argv: argv({ flags: ["--plan", plan, "--apply"] }), deps })).toBe(
      EXIT_USAGE,
    );
  });

  it("refuses with a reason when a valid plan meets an unconfigured store", async () => {
    const plan = planFile({ lines: ['{"op":"retire","id":"l-aaaa","reason":"canon carries it"}'] });
    expect(await runKnowledgePrune(argv({ flags: ["--plan", plan] }))).toBe(EXIT_ERROR);
  });
});

describe("knowledge remember", () => {
  /** A complete valid invocation, varying only what a test overrides. */
  function rememberFlags({ extra = [] }: { extra?: readonly string[] } = {}): readonly string[] {
    return [
      "--kind",
      "lesson",
      "--placement",
      "retrieved",
      "--domain",
      "datadog",
      "--claim",
      "APM adaptive sampling sits upstream of retention filters",
      "--evidence",
      "0 of 412 traces over 7d",
      "--verdict",
      "confirmed",
      "--learner",
      "fleet",
      "--behaviour-change",
      "check the agent sample rate first",
      "--retrieval-cue",
      "a datadog tracing task",
      "--tier",
      "2",
      "--surface",
      "api",
      ...extra,
    ];
  }

  it("prints usage for --help", async () => {
    expect(await runKnowledgeRemember(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses without --placement, so the question is never skipped by omission", async () => {
    const flags = rememberFlags().filter(
      (flag, index, all) => flag !== "--placement" && all[index - 1] !== "--placement",
    );
    expect(await runKnowledgeRemember(argv({ flags }))).toBe(EXIT_USAGE);
  });

  it("refuses a placement of skill BEFORE opening a connection", async () => {
    const flags = rememberFlags().map((flag) => (flag === "retrieved" ? "skill" : flag));
    expect(await runKnowledgeRemember(argv({ flags }))).toBe(EXIT_USAGE);
  });

  it("answers the PLACEMENT before any other missing flag", async () => {
    // The earlier test supplied every facet, so it could not see this: a writer who has already answered
    // the placement question wrong should be told the destination, not told about `--tier`.
    const flags = rememberFlags()
      .slice(0, -4)
      .map((flag) => (flag === "retrieved" ? "board" : flag));
    expect(await runKnowledgeRemember(argv({ flags }))).toBe(EXIT_USAGE);
  });

  it("refuses without --kind", async () => {
    const flags = rememberFlags().filter((flag, index, all) => flag !== "--kind" && all[index - 1] !== "--kind");
    expect(await runKnowledgeRemember(argv({ flags }))).toBe(EXIT_USAGE);
  });

  it("refuses a lesson missing its tier and surface", async () => {
    const flags = rememberFlags().slice(0, -4);
    expect(await runKnowledgeRemember(argv({ flags }))).toBe(EXIT_USAGE);
  });

  it("refuses a preference carrying a lesson facet, as the help has always promised", async () => {
    // The branch once returned before reading
    // `--tier`/`--surface`, so a preference passed with them was written with the facets silently dropped
    // while `--help` said they were refused.
    const flags = rememberFlags().map((flag) => (flag === "lesson" ? "preference" : flag));
    expect(await runKnowledgeRemember(argv({ flags }))).toBe(EXIT_USAGE);
  });

  it("refuses a preference carrying only --repro", async () => {
    const flags = rememberFlags()
      .slice(0, -4)
      .map((flag) => (flag === "lesson" ? "preference" : flag))
      .concat(["--repro", "rerun it"]);
    expect(await runKnowledgeRemember(argv({ flags }))).toBe(EXIT_USAGE);
  });

  it("refuses an empty behaviour-change by the builder, not by the database", async () => {
    const flags = rememberFlags().map((flag) => (flag === "check the agent sample rate first" ? "  " : flag));
    const deps = { domains: knowledgeDomainFake().port };
    expect(await runKnowledgeRememberWithDeps({ argv: argv({ flags }), deps })).toBe(EXIT_USAGE);
  });

  it("reaches the store only once every pure check passes, and refuses with no URL set", async () => {
    expect(await runKnowledgeRemember(argv({ flags: rememberFlags() }))).toBe(EXIT_ERROR);
  });
});

describe("knowledge import-lessons over a file with a blank line", () => {
  // A review found this BROKEN: a whitespace-only physical line was skipped with no output,
  // so the projected count and `wc -l` disagreed and nothing said why. A blank line still becomes no
  // recording — it carries no lesson — but the count is now reported, which is what "silently" meant.
  const row = JSON.stringify({
    claim: "APM adaptive sampling sits upstream of retention filters",
    domain: "datadog",
    evidence: "0 of 412 traces over 7d",
    id: "l-0000000000009003",
    recordedAtIso: "2026-09-07T22:23:24.368Z",
    run: "ad-hoc",
    surface: "api",
    tier: 2,
    verdict: "confirmed",
  });

  it("projects the real rows, and a dry run still opens no connection", async () => {
    const file = join(scratch(), "lessons.jsonl");
    writeFileSync(file, `${row}\n   \n${row}\n`);
    expect(await runKnowledgeImportLessons(argv({ flags: ["--file", file, "--dry-run"] }))).toBe(EXIT_OK);
  });

  it("refuses a malformed line rather than skipping it the way a blank one is skipped", async () => {
    const file = join(scratch(), "lessons.jsonl");
    writeFileSync(file, `${row}\n{ not json\n`);
    expect(await runKnowledgeImportLessons(argv({ flags: ["--file", file, "--dry-run"] }))).toBe(EXIT_ERROR);
  });
});
