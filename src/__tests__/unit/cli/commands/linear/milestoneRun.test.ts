/**
 * The `linear milestone create` COMMAND — same orchestration-assertion rationale as
 * `src/__tests__/unit/cli/commands/linear/run/create.test.ts`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import {
  milestoneDryRunLines,
  milestoneOutcomeLines,
  parseLinearMilestoneForm,
} from "../../../../../cli/commands/linear/milestoneCore.js";
import { type LinearMilestoneWriteDeps, runLinearMilestone } from "../../../../../cli/commands/linear/milestoneRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearWriteApi, ReadMilestone, WrittenObject } from "../../../../../corpus/linear/write.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { unwrap } from "../../../../../lib/result.js";
import { listMilestoneIds, readMilestoneRecord } from "../../../../../outbound/linear/milestoneLedger.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const FORM = JSON.stringify({ fields: { name: "A milestone", projectId: "puuid-1" } });

// A write echoes an id and nothing else; every display field is the read-back's to give.
const WRITTEN: WrittenObject = { id: "x" };
const READ: ReadMilestone = {
  description: undefined,
  id: "x",
  name: "A milestone",
  projectId: "puuid-1",
  projectUrl: "https://linear.test/project/a-project",
  targetDate: undefined,
  updatedAt: "2026-08-16T10:00:00.000Z",
};

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.projectMilestoneCreate", provider: "linear" };
}

function notUsedByLinearMilestone(): never {
  throw new Error("linear milestone never calls the issue/project lane");
}

function harness({ home, create, read }: { home: string; create?: "ok" | "fail"; read?: "ok" | "missing" | "error" }): {
  deps: LinearMilestoneWriteDeps;
  calls: string[];
  out: string[];
  err: string[];
} {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const api: LinearWriteApi = {
    createComment: notUsedByLinearMilestone,
    createRelation: notUsedByLinearMilestone,
    createProjectUpdate: notUsedByLinearMilestone,
    deleteProjectUpdate: notUsedByLinearMilestone,
    readProjectUpdate: notUsedByLinearMilestone,
    deleteComment: notUsedByLinearMilestone,
    deleteRelation: notUsedByLinearMilestone,
    readComment: notUsedByLinearMilestone,
    readRelation: notUsedByLinearMilestone,
    createIssue: notUsedByLinearMilestone,
    createMilestone: ({ id }) => {
      calls.push(`create:${id}`);
      return create === "fail" ? errAsync(ingestError({ message: "boom" })) : okAsync(WRITTEN);
    },
    createProject: notUsedByLinearMilestone,
    deleteIssue: notUsedByLinearMilestone,
    deleteMilestone: notUsedByLinearMilestone,
    deleteProject: notUsedByLinearMilestone,
    readIssue: notUsedByLinearMilestone,
    readMilestone: () => {
      calls.push("read");
      if (read === "error") {
        return errAsync(ingestError({ message: "read blew up" }));
      }
      if (read === "missing" || (create === "fail" && read === undefined)) {
        return okAsync(undefined);
      }
      return okAsync(READ);
    },
    readProject: notUsedByLinearMilestone,
    updateIssue: notUsedByLinearMilestone,
    updateProject: notUsedByLinearMilestone,
  };
  return {
    calls,
    deps: {
      bareRefContext: () => ({ repos: [] }),
      env: () => undefined,
      doorLedger: memoryDoorLedger().port,
      err: (line) => err.push(line),
      makeApi: () => {
        calls.push("makeApi");
        return api;
      },
      nowIso: () => "2026-08-16T10:00:00.000Z",
      out: (line) => out.push(line),
      readForm: () => FORM,
      resolveToken: ({ home: given }) => {
        calls.push(`token:${given === home ? "same-home" : "WRONG-HOME"}`);
        return "lin_api_fake";
      },
    },
    err,
    out,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "milestone", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-milestone-run-"));
  fixtureDirs.push(home);
  return home;
}

describe("dry run touches nothing", () => {
  it("prints the fields and performs NO effect at all", async () => {
    const home = tempHome();
    const h = harness({ home });
    const code = await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual([]);
    expect(listMilestoneIds({ home })).toEqual([]);
    expect(h.out.join("\n")).toContain("name:         A milestone");
  });
});

describe("milestoneDryRunLines — what an unset target or description says", () => {
  it("previews (none) for a target and a description the form leaves unset", () => {
    const lines = milestoneDryRunLines({ form: unwrap(parseLinearMilestoneForm({ raw: FORM })), id: "id-1" });
    expect(lines.slice(3)).toEqual([
      "target:       (none)",
      "sort order:   (default)",
      "--- description ---",
      "(none)",
      "--- end ---",
    ]);
  });

  it("previews the target and description a form sets", () => {
    const raw = JSON.stringify({
      fields: { description: "Ship it.", name: "A milestone", projectId: "puuid-1", targetDate: "2026-12-01" },
    });
    const lines = milestoneDryRunLines({ form: unwrap(parseLinearMilestoneForm({ raw })), id: "id-1" });
    expect(lines.slice(3)).toEqual([
      "target:       2026-12-01",
      "sort order:   (default)",
      "--- description ---",
      "Ship it.",
      "--- end ---",
    ]);
  });
});

describe("create", () => {
  it("runs token → api → reserve → create → read back → confirm, in that order", async () => {
    const home = tempHome();
    const h = harness({ home });
    const code = await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls[0]).toBe("token:same-home");
    expect(h.calls[1]).toBe("makeApi");
    expect(h.calls[2]?.startsWith("create:")).toBe(true);
    expect(h.calls[3]).toBe("read");
    expect(h.out[0]).toBe('created milestone "A milestone"');
    expect(h.out[1]).toBe(`project: ${READ.projectUrl}`);
  });

  it("confirms the ledger record", async () => {
    const home = tempHome();
    const h = harness({ home });
    await runLinearMilestone({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps });
    const id = listMilestoneIds({ home })[0]!;

    expect(readMilestoneRecord({ home, id })!.confirmedIso).toBe("2026-08-16T10:00:00.000Z");
  });

  it("REFUSES a second identical intent instead of filing a duplicate", async () => {
    const home = tempHome();
    await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: harness({ home }).deps,
    });
    const second = harness({ home });
    const code = await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.calls.some((c) => c.startsWith("create:"))).toBe(false);
    expect(second.out.join(" ")).toContain("already reserved");
  });

  it("reports UNCONFIRMED, not success, when the read-back finds nothing", async () => {
    const home = tempHome();
    const h = harness({ home, read: "missing" });
    const code = await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out.join(" ")).toContain("could NOT be read back");
  });

  it("reports a real mutation failure as a fault", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", home });
    const code = await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.out.join(" ")).toContain("the write failed");
  });

  it("reports the write as LANDED when the milestone is found at the caller-chosen id after a transport error", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", home, read: "ok" });
    const code = await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.out[0]).toBe('created milestone "A milestone", despite a transport error — found at the id we chose.');
  });

  it("refuses when no token can be resolved, and never builds the API", async () => {
    const home = tempHome();
    const h = harness({ home });
    const deps: LinearMilestoneWriteDeps = { ...h.deps, resolveToken: () => undefined };
    const code = await runLinearMilestone({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls.includes("makeApi")).toBe(false);
    expect(h.err.join(" ")).toContain("no Linear token for this home");
  });
});

describe("argument safety", () => {
  it("REFUSES an unknown flag rather than ignoring it", async () => {
    const h = harness({ home: tempHome() });
    const code = await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--dryrun"] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.err.join(" ")).toContain("unknown flag: --dryrun");
    expect(h.calls).toEqual([]);
  });

  it("REFUSES a missing sub-verb", async () => {
    const h = harness({ home: tempHome() });
    const code = await runLinearMilestone({ argv: argv({ rest: ["--form", "-"] }), deps: h.deps });

    expect(code).toBe(EXIT_USAGE);
    expect(h.err.join(" ")).toContain("usage: slopweaver linear milestone create");
  });

  it("uses the usage exit code for a bad invocation, not the fault code", async () => {
    const h = harness({ home: tempHome() });
    expect(await runLinearMilestone({ argv: argv({ rest: ["create"] }), deps: h.deps })).toBe(EXIT_USAGE);
  });
});

describe("bare-reference gate", () => {
  it("linkifies a resolvable bare reference in the markdown description as a real link", async () => {
    const home = tempHome();
    const h = harness({ home });
    const deps: LinearMilestoneWriteDeps = {
      ...h.deps,
      bareRefContext: () => ({ repos: [{ owner: "acme", repo: "widget" }] }),
      readForm: () =>
        JSON.stringify({ fields: { description: "caused by #10", name: "A milestone", projectId: "puuid-1" } }),
    };
    const code = await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.out.join("\n")).toContain("caused by [#10](https://github.com/acme/widget/issues/10)");
  });

  it("refuses an unresolvable reference before any token, door or network effect", async () => {
    const home = tempHome();
    const h = harness({ home });
    const deps: LinearMilestoneWriteDeps = {
      ...h.deps,
      bareRefContext: () => ({ repos: [] }),
      readForm: () =>
        JSON.stringify({ fields: { description: "caused by #10", name: "A milestone", projectId: "puuid-1" } }),
    };
    const code = await runLinearMilestone({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toEqual([]);
    expect(h.out.some((line) => line.startsWith("refused:"))).toBe(true);
  });
});

describe("the project pointer line", () => {
  it("prints the url when the follow-up project read found one", () => {
    const lines = milestoneOutcomeLines({ outcome: { kind: "written", milestone: READ } });

    expect(lines[1]).toBe("project: https://linear.test/project/a-project");
  });

  it("names the project ID, and why there is no link, when the project is gone", () => {
    const milestone: ReadMilestone = { ...READ, projectUrl: undefined };
    const lines = milestoneOutcomeLines({ outcome: { kind: "written", milestone } });

    expect(lines[1]).toBe("project: puuid-1 (no project found at that id, so there is no URL to print)");
  });
});
