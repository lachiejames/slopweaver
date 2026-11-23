/** The `linear label create` COMMAND — same orchestration-assertion rationale as `relationRun.test.ts`. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import { labelIntentId } from "../../../../../cli/commands/linear/labelCore.js";
import { type LinearLabelWriteDeps, runLinearLabel } from "../../../../../cli/commands/linear/labelRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearLabelWriteApi, ReadLinearLabel } from "../../../../../corpus/linear/writeLabels.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { readAppendRecord } from "../../../../../outbound/linear/commentLedger.js";
import type { LinearLabelCreateForm } from "../../../../../outbound/linear/labelTypes.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const TEAM_ID = "5fd296ef-baa7-4bc4-ab3d-3afbc6202759";

const ISSUE_FORM: LinearLabelCreateForm = { fields: { name: "Can drive", teamId: TEAM_ID }, kind: "issue" };
const PROJECT_FORM: LinearLabelCreateForm = { fields: { name: "Audit" }, kind: "project" };

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.issueLabelCreate", provider: "linear" };
}

function readBackOf({ form, id }: { form: LinearLabelCreateForm; id: string }): ReadLinearLabel {
  return {
    groupType: undefined,
    id,
    isGroup: false,
    kind: form.kind,
    name: form.fields.name,
    parentId: undefined,
    teamId: form.fields.teamId,
  };
}

function harness({
  home,
  form,
  create,
  read,
}: {
  home: string;
  form: LinearLabelCreateForm;
  create: "ok" | "fail";
  read: "ok" | "missing" | "error";
}): { deps: LinearLabelWriteDeps; calls: string[]; out: string[]; err: string[]; sentInput: () => unknown } {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let sent: unknown;
  const createArm =
    ({ lane }: { lane: string }): LinearLabelWriteApi["createIssueLabel"] =>
    ({ id, input }) => {
      calls.push(`create-${lane}:${id}`);
      if (create === "fail") {
        return errAsync(ingestError({ message: "boom" }));
      }
      sent = input;
      return okAsync({ id });
    };
  const readArm =
    ({ lane }: { lane: string }): LinearLabelWriteApi["readIssueLabel"] =>
    ({ id }) => {
      calls.push(`read-${lane}`);
      if (read === "error") {
        return errAsync(ingestError({ message: "read blew up" }));
      }
      if (read === "missing") {
        return okAsync(undefined);
      }
      return okAsync(readBackOf({ form, id }));
    };
  const api: LinearLabelWriteApi = {
    createIssueLabel: createArm({ lane: "issue" }),
    createProjectLabel: createArm({ lane: "project" }),
    deleteIssueLabel: () => {
      throw new Error("label create never deletes");
    },
    deleteProjectLabel: () => {
      throw new Error("label create never deletes");
    },
    readIssueLabel: readArm({ lane: "issue" }),
    readProjectLabel: readArm({ lane: "project" }),
  };
  return {
    calls,
    deps: {
      doorLedger: memoryDoorLedger().port,
      err: (line) => err.push(line),
      makeApi: () => {
        calls.push("makeApi");
        return api;
      },
      nowIso: () => "2026-10-24T09:00:00.000Z",
      out: (line) => out.push(line),
      readForm: () => JSON.stringify(form),
      resolveToken: ({ home: given }) => {
        calls.push(`token:${given === home ? "same-home" : "WRONG-HOME"}`);
        return "lin_api_fake";
      },
    },
    err,
    out,
    sentInput: () => sent,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "label", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-label-"));
  fixtureDirs.push(home);
  return home;
}

describe("runLinearLabel", () => {
  it("creates a team issue label at the derived id, reads it back, and records the team as its subject", async () => {
    const home = tempHome();
    const { deps, calls, out, sentInput } = harness({ create: "ok", form: ISSUE_FORM, home, read: "ok" });
    const id = labelIntentId({ form: ISSUE_FORM });

    expect(await runLinearLabel({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_OK,
    );
    expect(calls).toEqual(["token:same-home", "makeApi", `create-issue:${id}`, "read-issue"]);
    expect(sentInput()).toEqual({ name: "Can drive", teamId: TEAM_ID });
    expect(out).toEqual(["created the label", `${id}  issue label "Can drive" on team ${TEAM_ID}`]);
    expect(readAppendRecord({ home, id, kind: "linear-labels" })!.subject).toBe(TEAM_ID);
    expect(readAppendRecord({ home, id, kind: "linear-labels" })!.confirmedIso).toBe("2026-10-24T09:00:00.000Z");
  });

  it("routes a project label to the project lane and records it against the workspace", async () => {
    const home = tempHome();
    const { deps, calls, out } = harness({ create: "ok", form: PROJECT_FORM, home, read: "ok" });
    const id = labelIntentId({ form: PROJECT_FORM });

    expect(await runLinearLabel({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_OK,
    );
    expect(calls).toEqual(["token:same-home", "makeApi", `create-project:${id}`, "read-project"]);
    expect(out[1]!).toBe(`${id}  project label "Audit" on the whole workspace`);
    expect(readAppendRecord({ home, id, kind: "linear-labels" })!.subject).toBe("workspace");
  });

  it("emits ONE JSON document under --json, carrying the intent id", async () => {
    const home = tempHome();
    const { deps, out } = harness({ create: "ok", form: ISSUE_FORM, home, read: "ok" });
    const id = labelIntentId({ form: ISSUE_FORM });

    await runLinearLabel({ argv: argv({ rest: ["create", "--form", "-", "--json", "--home", home] }), deps });

    expect(out.length).toBe(1);
    expect(JSON.parse(out[0]!)).toEqual({
      id,
      outcome: { kind: "written", label: { id, isGroup: false, kind: "issue", name: "Can drive", teamId: TEAM_ID } },
    });
  });

  it("REFUSES the same label a second time", async () => {
    const home = tempHome();
    await runLinearLabel({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: harness({ create: "ok", form: ISSUE_FORM, home, read: "ok" }).deps,
    });
    const second = harness({ create: "ok", form: ISSUE_FORM, home, read: "ok" });

    expect(
      await runLinearLabel({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: second.deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.calls).toEqual(["token:same-home", "makeApi"]);
    expect(second.out[0]!).toContain("already reserved");
  });

  it("a dry run prints the label and its id, and performs no effect", async () => {
    const home = tempHome();
    const { deps, calls, out } = harness({ create: "ok", form: ISSUE_FORM, home, read: "ok" });
    const id = labelIntentId({ form: ISSUE_FORM });

    expect(
      await runLinearLabel({ argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }), deps }),
    ).toBe(EXIT_OK);
    expect(calls).toEqual([]);
    expect(out).toEqual([
      `label id:    ${id}  (derived from the form, so a retry reuses it)`,
      "kind:        issue label",
      "name:        Can drive",
      `applies to:  team ${TEAM_ID}`,
    ]);
  });

  it("reports UNCONFIRMED when the create answered but the read-back found nothing", async () => {
    const home = tempHome();
    const { deps, out } = harness({ create: "ok", form: ISSUE_FORM, home, read: "missing" });

    expect(await runLinearLabel({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(out[0]!).toContain("could NOT be read back");
  });

  it("reports LANDED when the create errored but the label is at the id we chose", async () => {
    const home = tempHome();
    const { deps, out } = harness({ create: "fail", form: ISSUE_FORM, home, read: "ok" });

    expect(await runLinearLabel({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_OK,
    );
    expect(out[0]!).toContain("despite a transport error");
    expect(out[2]!).toBe("the error was: boom");
  });

  it("reports INDETERMINATE when the create and the read-back both errored", async () => {
    const home = tempHome();
    const { deps, out } = harness({ create: "fail", form: ISSUE_FORM, home, read: "error" });

    expect(await runLinearLabel({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(out[0]!).toContain("unknown whether it landed");
  });

  it("reports FAILED only once a read-back established the label is absent", async () => {
    const home = tempHome();
    const { deps, out } = harness({ create: "fail", form: ISSUE_FORM, home, read: "missing" });

    expect(await runLinearLabel({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_ERROR,
    );
    expect(out).toEqual(["the write failed: boom"]);
  });

  it("refuses a missing subcommand with the usage, before any effect", async () => {
    const home = tempHome();
    const { deps, calls, err } = harness({ create: "ok", form: ISSUE_FORM, home, read: "ok" });

    expect(await runLinearLabel({ argv: argv({ rest: ["--form", "-"] }), deps })).toBe(EXIT_USAGE);
    expect(calls).toEqual([]);
    expect(err.at(-1)!).toContain("usage: slopweaver linear label create");
  });
});
