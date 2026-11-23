/**
 * The `linear project` COMMAND — same orchestration-assertion rationale
 * `src/__tests__/unit/cli/commands/linear/run/create.test.ts` states for `linear issue`: every edge is a plain injected function, and these assert what is called, in what order, and what
 * is NOT called.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseLinearProjectArgs,
  parseLinearProjectForm,
  projectDryRunLines,
  projectIntentId,
  projectWriteId,
} from "../../../../../cli/commands/linear/projectCore.js";
import { type LinearProjectWriteDeps, runLinearProject } from "../../../../../cli/commands/linear/projectRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearWriteApi, ReadProject, WrittenObject } from "../../../../../corpus/linear/write.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { unwrap } from "../../../../../lib/result.js";
import { listProjectIds, readProjectRecord } from "../../../../../outbound/linear/projectLedger.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const FORM = JSON.stringify({ fields: { name: "A project", teamIds: ["team-1"] } });
const OTHER_FORM = JSON.stringify({ fields: { name: "A different project", teamIds: ["team-1"] } });
/** The SAME name/teams as FORM, but requesting a priority change — a field the read-back cannot see. */
const SAME_NAME_NEW_PRIORITY = JSON.stringify({ fields: { name: "A project", priority: 2, teamIds: ["team-1"] } });

// A write echoes an id and nothing else; every display field is the read-back's to give.
const WRITTEN: WrittenObject = { id: "x" };
const READ: ReadProject = {
  id: "x",
  name: "A project",
  slugId: "a-project",
  url: "https://linear.test/project/a-project",
  description: undefined,
  targetDate: undefined,
  updatedAt: "2026-08-16T10:00:00.000Z",
};

function nameOf({ input }: { input: Readonly<Record<string, unknown>> }): string | undefined {
  const value = input["name"];
  return typeof value === "string" ? value : undefined;
}

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.projectCreate", provider: "linear" };
}

function notUsedByLinearProject(): never {
  throw new Error("linear project never calls the issue/milestone lane");
}

/** A recording harness: a fake API that logs every call, plus captured output. */
function harness({
  home,
  create,
  read,
  update,
  form = FORM,
}: {
  home: string;
  create?: "ok" | "fail";
  update?: "ok" | "fail";
  form?: string;
  read?: "ok" | "missing" | "error";
}): { deps: LinearProjectWriteDeps; calls: string[]; out: string[]; err: string[] } {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let storedName = READ.name;
  // A write whose input names no project leaves the stored name as it stood: Linear changes only what is sent.
  const storeNameFrom = ({ input }: { input: Readonly<Record<string, unknown>> }): void => {
    const sent = nameOf({ input });
    if (sent === undefined) {
      return;
    }
    storedName = sent;
  };
  const api: LinearWriteApi = {
    createComment: notUsedByLinearProject,
    createRelation: notUsedByLinearProject,
    createProjectUpdate: notUsedByLinearProject,
    deleteProjectUpdate: notUsedByLinearProject,
    readProjectUpdate: notUsedByLinearProject,
    deleteComment: notUsedByLinearProject,
    deleteRelation: notUsedByLinearProject,
    readComment: notUsedByLinearProject,
    readRelation: notUsedByLinearProject,
    createIssue: notUsedByLinearProject,
    createMilestone: notUsedByLinearProject,
    createProject: ({ id, input }) => {
      calls.push(`create:${id}`);
      storeNameFrom({ input });
      return create === "fail" ? errAsync(ingestError({ message: "boom" })) : okAsync(WRITTEN);
    },
    deleteIssue: notUsedByLinearProject,
    deleteMilestone: notUsedByLinearProject,
    deleteProject: notUsedByLinearProject,
    readIssue: notUsedByLinearProject,
    readMilestone: notUsedByLinearProject,
    readProject: () => {
      calls.push("read");
      if (read === "error") {
        return errAsync(ingestError({ message: "read blew up" }));
      }
      if (read === "missing" || (create === "fail" && read === undefined)) {
        return okAsync(undefined);
      }
      return okAsync({ ...READ, name: storedName });
    },
    updateIssue: notUsedByLinearProject,
    updateProject: ({ id, input }) => {
      calls.push(`update:${id}`);
      if (update === "fail") {
        return errAsync(ingestError({ message: "boom" }));
      }
      storeNameFrom({ input });
      return okAsync(WRITTEN);
    },
  };
  return {
    calls,
    deps: {
      bareRefContext: () => ({ repos: [] }),
      doorLedger: memoryDoorLedger().port,
      env: () => undefined,
      err: (line) => err.push(line),
      makeApi: () => {
        calls.push("makeApi");
        return api;
      },
      nowIso: () => "2026-08-16T10:00:00.000Z",
      out: (line) => out.push(line),
      readForm: () => form,
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
  return ["node", "slopweaver", "linear", "project", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-project-run-"));
  fixtureDirs.push(home);
  return home;
}

describe("dry run touches nothing", () => {
  it("prints the fields and performs NO effect at all", async () => {
    const home = tempHome();
    const h = harness({ home });
    const code = await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual([]);
    expect(listProjectIds({ home })).toEqual([]);
    expect(h.out.join("\n")).toContain("name:       A project");
  });
});

describe("retired-team gate", () => {
  const SUP_ID = "26397148-cb19-4cd5-bf02-60964b2c2a78";
  const INTO_SUP = JSON.stringify({ fields: { name: "A project", teamIds: [SUP_ID] } });

  /** A home whose retired-teams list names SUP. */
  function retiringHome(): string {
    const home = tempHome();
    const list = { teams: [{ fileInstead: "SOPS", teamId: SUP_ID, teamKey: "SUP", why: "they left SUP" }] };
    writeFileSync(stateHomePaths({ home }).linearRetiredTeamsJson, JSON.stringify(list));
    return home;
  }

  it("refuses a dry run into a retired team, so the preview says what the write would be told", async () => {
    const home = retiringHome();
    const h = harness({ form: INTO_SUP, home });
    const code = await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toEqual([]);
    expect(h.out.join("\n")).toContain("slopweaver linear project create files into SUP");
  });

  it("refuses the live write into a retired team before it builds the API", async () => {
    const home = retiringHome();
    const h = harness({ form: INTO_SUP, home });
    const code = await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).toEqual(["token:same-home"]);
    expect(listProjectIds({ home })).toEqual([]);
  });
});

describe("projectDryRunLines — what an unset field says the write will do", () => {
  it("says no lead, the team default status and no target when the form sets none", () => {
    const lines = projectDryRunLines({ form: unwrap(parseLinearProjectForm({ raw: FORM })), id: "id-1" });
    expect(lines.filter((line) => /^(lead|status|target):/u.test(line))).toEqual([
      "lead:       (none)",
      "status:     (team default)",
      "target:     (none)",
    ]);
  });

  it("names the lead, status and target a form sets", () => {
    const raw = JSON.stringify({
      fields: { leadId: "user-1", name: "A project", statusId: "status-2", targetDate: "2026-12-01", teamIds: ["t"] },
    });
    const lines = projectDryRunLines({ form: unwrap(parseLinearProjectForm({ raw })), id: "id-1" });
    expect(lines.filter((line) => /^(lead|status|target):/u.test(line))).toEqual([
      "lead:       user-1",
      "status:     status-2",
      "target:     2026-12-01",
    ]);
  });
});

describe("projectWriteId", () => {
  const form = unwrap(parseLinearProjectForm({ raw: FORM }));
  const PROJECT_UUID = "0b5e6c1e-7f3a-4c2d-9e8f-1a2b3c4d5e6f";

  it("uses the --project-id the operator named", () => {
    const args = unwrap(parseLinearProjectArgs({ argv: ["update", "--form", "-", "--project-id", PROJECT_UUID] }));
    expect(projectWriteId({ args, form })).toBe(PROJECT_UUID);
  });

  it("derives a create's id from its intent", () => {
    const args = unwrap(parseLinearProjectArgs({ argv: ["create", "--form", "-"] }));
    expect(projectWriteId({ args, form })).toBe(projectIntentId({ form }));
  });
});

describe("create", () => {
  it("runs token → api → reserve → create → read back → confirm, in that order", async () => {
    const home = tempHome();
    const h = harness({ home });
    const code = await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls[0]).toBe("token:same-home");
    expect(h.calls[1]).toBe("makeApi");
    expect(h.calls[2]?.startsWith("create:")).toBe(true);
    expect(h.calls[3]).toBe("read");
    expect(h.out[0]).toBe('created project "A project"');
    expect(h.out[1]).toBe(READ.url);
  });

  it("confirms the ledger record with the read-back identity", async () => {
    const home = tempHome();
    const h = harness({ home });
    await runLinearProject({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: h.deps });
    const id = listProjectIds({ home })[0]!;
    const record = readProjectRecord({ home, id })!;

    expect(record.name).toBe("A project");
    expect(record.confirmedIso).toBe("2026-08-16T10:00:00.000Z");
  });

  it("REFUSES a second identical intent instead of filing a duplicate", async () => {
    const home = tempHome();
    await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: harness({ home }).deps,
    });
    const second = harness({ home });
    const code = await runLinearProject({
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
    const code = await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out.join(" ")).toContain("could NOT be read back");
  });

  it("reports a real mutation failure as a fault", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", home });
    const code = await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.out.join(" ")).toContain("the write failed");
  });

  it("refuses when no token can be resolved, and never builds the API", async () => {
    const home = tempHome();
    const h = harness({ home });
    const deps: LinearProjectWriteDeps = { ...h.deps, resolveToken: () => undefined };
    const code = await runLinearProject({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls.includes("makeApi")).toBe(false);
    expect(h.err.join(" ")).toContain("no Linear token for this home");
  });
});

describe("a mutation whose response was lost", () => {
  it("reports the write as LANDED when the project is found at the caller-chosen id", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", home, read: "ok" });
    const code = await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.out[0]).toBe('created project "A project", despite a transport error — found at the id we chose.');
  });

  it("does NOT call an update landed just because the project exists — it existed before", async () => {
    const home = tempHome();
    const first = harness({ home });
    await runLinearProject({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });
    const id = listProjectIds({ home })[0]!;

    const second = harness({ form: OTHER_FORM, home, update: "fail" });
    const code = await runLinearProject({
      argv: argv({ rest: ["update", "--form", "-", "--project-id", id, "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.out.some((line) => line.startsWith("updated"))).toBe(false);
  });

  it("will not call an update landed on name evidence when a FIELD change cannot be seen", async () => {
    const home = tempHome();
    const first = harness({ home });
    await runLinearProject({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });
    const id = listProjectIds({ home })[0]!;

    const second = harness({ form: SAME_NAME_NEW_PRIORITY, home, update: "fail" });
    const code = await runLinearProject({
      argv: argv({ rest: ["update", "--form", "-", "--project-id", id, "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.out.some((line) => line.startsWith("updated"))).toBe(false);
  });
});

describe("update", () => {
  it("reports the verb that actually ran, not 'created'", async () => {
    const home = tempHome();
    const first = harness({ home });
    await runLinearProject({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });
    const id = listProjectIds({ home })[0]!;

    const second = harness({ home });
    const code = await runLinearProject({
      argv: argv({ rest: ["update", "--form", "-", "--project-id", id, "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(second.out[0]).toBe('updated project "A project"');
  });

  it("refuses a project slopweaver has no record of creating", async () => {
    const home = tempHome();
    const h = harness({ home });
    const code = await runLinearProject({
      argv: argv({
        rest: ["update", "--form", "-", "--project-id", "752562e2-b5aa-4934-b0aa-03e0165a6196", "--home", home],
      }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join(" ")).toContain("no record of creating project");
    expect(h.calls.some((c) => c.startsWith("update:"))).toBe(false);
  });
});

describe("argument safety", () => {
  it("REFUSES an unknown flag rather than ignoring it", async () => {
    const h = harness({ home: tempHome() });
    const code = await runLinearProject({ argv: argv({ rest: ["create", "--form", "-", "--dryrun"] }), deps: h.deps });

    expect(code).toBe(EXIT_USAGE);
    expect(h.err.join(" ")).toContain("unknown flag: --dryrun");
    expect(h.calls).toEqual([]);
  });

  it("accepts the --flag=value form", async () => {
    const h = harness({ home: tempHome() });
    const code = await runLinearProject({ argv: argv({ rest: ["create", "--form=-", "--dry-run"] }), deps: h.deps });

    expect(code).toBe(EXIT_OK);
    expect(h.out.join("\n")).toContain("name:       A project");
  });

  it("REFUSES a --project-id that could escape the ledger directory", async () => {
    const h = harness({ home: tempHome() });
    const code = await runLinearProject({
      argv: argv({ rest: ["update", "--form", "-", "--project-id", "../../escape"] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.err.join(" ")).toContain("must be a UUID v4");
  });

  it("uses the usage exit code for a bad invocation, not the fault code", async () => {
    const h = harness({ home: tempHome() });
    expect(await runLinearProject({ argv: argv({ rest: ["create"] }), deps: h.deps })).toBe(EXIT_USAGE);
  });

  it("refuses update with no --project-id", async () => {
    const h = harness({ home: tempHome() });
    const code = await runLinearProject({ argv: argv({ rest: ["update", "--form", "-"] }), deps: h.deps });

    expect(code).toBe(EXIT_USAGE);
    expect(h.err.join(" ")).toContain("--project-id <uuid> is required for update");
  });
});

describe("bare-reference gate", () => {
  const WITH_BARE_REF = JSON.stringify({
    fields: { description: "caused by #10", name: "A project", teamIds: ["team-1"] },
  });

  it("linkifies a resolvable bare reference in the plain-text description as its bare URL", async () => {
    const home = tempHome();
    const h = harness({ form: WITH_BARE_REF, home });
    const deps: LinearProjectWriteDeps = {
      ...h.deps,
      bareRefContext: () => ({ repos: [{ owner: "acme", repo: "widget" }] }),
    };
    const code = await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.out.join("\n")).toContain("description: caused by https://github.com/acme/widget/issues/10");
    expect(h.out.join("\n")).not.toContain("caused by #10");
  });

  it("refuses an unresolvable reference before any token, door or network effect", async () => {
    const home = tempHome();
    const h = harness({ form: WITH_BARE_REF, home });
    const deps: LinearProjectWriteDeps = { ...h.deps, bareRefContext: () => ({ repos: [] }) };
    const code = await runLinearProject({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.calls).toEqual([]);
    expect(h.out.some((line) => line.startsWith("refused:"))).toBe(true);
  });
});
