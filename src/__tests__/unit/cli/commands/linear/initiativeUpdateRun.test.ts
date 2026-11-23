/**
 * `linear initiative-update create` — the status report posted TO an initiative, as opposed to the
 * `initiative update` verb that edits one. The name collision is Linear's, and these cases are what keep the
 * two apart mechanically rather than by reading.
 *
 * The rest pin what this verb shares with its project-side twin and must keep: health is required and
 * reaches the input, health is part of the intent id, the body folds only when there is something to fold,
 * and the report states the health Linear ECHOED rather than the one that was asked for.
 *
 * Every edge is a plain injected function. No mocks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";

import { linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import {
  initiativeUpdateDryRunLines,
  initiativeUpdateInputFor,
  initiativeUpdateIntentId,
  initiativeUpdateOutcomeLines,
  parseLinearInitiativeUpdateForm,
} from "../../../../../cli/commands/linear/initiativeUpdateCore.js";
import {
  type LinearInitiativeUpdateWriteDeps,
  runLinearInitiativeUpdate,
} from "../../../../../cli/commands/linear/initiativeUpdateRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { WrittenObject } from "../../../../../corpus/linear/write.js";
import type { LinearInitiativeWriteApi, ReadInitiativeUpdate } from "../../../../../corpus/linear/writeInitiative.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readAppendRecord } from "../../../../../outbound/linear/commentLedger.js";
import type { LinearInitiativeUpdateForm } from "../../../../../outbound/linear/initiativeTypes.js";
import { renderInitiativeUpdateBody } from "../../../../../outbound/linear/render.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

/** Every scratch home this file mints, removed in `afterAll` — see `.claude/rules/testing.md`. */
const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-initiative-update-"));
  homes.push(home);
  return home;
}

const INITIATIVE_ID = "aa831adf-e969-430b-abd3-d72397f6b8e9";

const FORM_TEXT = JSON.stringify({
  artifact: { summary: "Two projects landed and one slipped a fortnight." },
  fields: { health: "atRisk", initiativeId: INITIATIVE_ID },
});

// What a write echoes under `@linear/sdk`: the bare id. The health a report prints comes from the read-back.
const WRITTEN: WrittenObject = { id: "u1" };

const READ: ReadInitiativeUpdate = {
  body: "b",
  health: "atRisk",
  id: "u1",
  updatedAt: "2026-09-07T00:00:00.000Z",
  url: "https://linear.test/initiative/x/activity#u1",
};

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.initiativeUpdateCreate", provider: "linear" };
}

const NOT_THIS_LANE = (): never => {
  throw new Error("linear initiative-update never calls the initiative-object lane");
};

function harness({
  create,
  read,
  form = FORM_TEXT,
}: {
  create?: "ok" | "fail";
  read?: "ok" | "missing";
  form?: string;
}): {
  deps: LinearInitiativeUpdateWriteDeps;
  calls: string[];
  out: string[];
  err: string[];
  createInput: () => Readonly<Record<string, unknown>> | undefined;
} {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let createInput: Readonly<Record<string, unknown>> | undefined;
  const api: LinearInitiativeWriteApi = {
    archiveInitiativeUpdate: NOT_THIS_LANE,
    createInitiative: NOT_THIS_LANE,
    createInitiativeLink: NOT_THIS_LANE,
    createInitiativeUpdate: ({ id, input }) => {
      calls.push(`create:${id}`);
      createInput = input;
      return create === "fail" ? errAsync(ingestError({ message: "boom" })) : okAsync(WRITTEN);
    },
    deleteInitiative: NOT_THIS_LANE,
    deleteInitiativeLink: NOT_THIS_LANE,
    readInitiative: NOT_THIS_LANE,
    readInitiativeLink: NOT_THIS_LANE,
    readInitiativeUpdate: () => {
      calls.push("read");
      return read === "missing" ? okAsync(undefined) : okAsync(READ);
    },
    updateInitiative: NOT_THIS_LANE,
  };
  return {
    calls,
    createInput: () => createInput,
    deps: {
      bareRefContext: () => ({ repos: [] }),
      env: () => undefined,
      doorLedger: memoryDoorLedger().port,
      err: (line) => err.push(line),
      makeApi: () => api,
      nowIso: () => "2026-09-07T00:00:00.000Z",
      out: (line) => out.push(line),
      readForm: () => form,
      resolveToken: () => "lin_api_fake",
    },
    err,
    out,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "initiative-update", ...rest];
}

function formOf({ raw }: { raw: string }): LinearInitiativeUpdateForm {
  return unwrap(parseLinearInitiativeUpdateForm({ raw }));
}

describe("the form", () => {
  it("refuses a health Linear does not have", () => {
    const parsed = parseLinearInitiativeUpdateForm({
      raw: JSON.stringify({ artifact: { summary: "s" }, fields: { health: "amber", initiativeId: INITIATIVE_ID } }),
    });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual(["fields.health: Invalid input"]);
  });

  it("refuses an update with no health, which would leave the initiative reading its old one", () => {
    const parsed = parseLinearInitiativeUpdateForm({
      raw: JSON.stringify({ artifact: { summary: "s" }, fields: { initiativeId: INITIATIVE_ID } }),
    });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual(["fields.health: Invalid input"]);
  });

  it("refuses a multi-line summary, which is the whole report above the fold", () => {
    const parsed = parseLinearInitiativeUpdateForm({
      raw: JSON.stringify({
        artifact: { summary: "line one\nline two" },
        fields: { health: "onTrack", initiativeId: INITIATIVE_ID },
      }),
    });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "artifact.summary: an initiative update summary is ONE line — put the rest in detail, which folds",
    ]);
  });

  it("refuses a summary that opens Linear's collapsible delimiter and would close the fold early", () => {
    const parsed = parseLinearInitiativeUpdateForm({
      raw: JSON.stringify({
        artifact: { summary: "+++ nope" },
        fields: { health: "onTrack", initiativeId: INITIATIVE_ID },
      }),
    });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      'artifact.summary: a line beginning with "+++" is Linear\'s collapsible delimiter and would close the detail block early',
    ]);
  });
});

describe("the rendered body", () => {
  it("has NO collapsible when there is nothing to fold", () => {
    expect(renderInitiativeUpdateBody({ artifact: { summary: "Two landed, one slipped." } })).toBe(
      "Two landed, one slipped.",
    );
  });

  it("folds detail behind the collapsible when there is some", () => {
    const body = renderInitiativeUpdateBody({
      artifact: { detail: [{ kind: "para", text: "The platform project slipped." }], summary: "Two landed." },
    });

    expect(body).toContain("+++ Detail and evidence");
    expect(body.startsWith("Two landed.")).toBe(true);
  });
});

describe("the provider input", () => {
  it("carries the health, the INITIATIVE and the rendered body", () => {
    const input = initiativeUpdateInputFor({ form: formOf({ raw: FORM_TEXT }) });

    expect(input["health"]).toBe("atRisk");
    expect(input["initiativeId"]).toBe(INITIATIVE_ID);
    expect(input["body"]).toBe("Two projects landed and one slipped a fortnight.");
  });

  it("names no projectId at all — that field belongs to the other verb entirely", () => {
    expect(initiativeUpdateInputFor({ form: formOf({ raw: FORM_TEXT }) })["projectId"]).toBe(undefined);
  });
});

describe("the intent id", () => {
  it("is the same for the same report, so a retry cannot post it twice", () => {
    const form = formOf({ raw: FORM_TEXT });

    expect(initiativeUpdateIntentId({ form })).toBe(initiativeUpdateIntentId({ form }));
  });

  it("CHANGES when only the health does — the same words at a different health are a different report", () => {
    const atRisk = formOf({ raw: FORM_TEXT });
    const onTrack = formOf({
      raw: JSON.stringify({
        artifact: { summary: "Two projects landed and one slipped a fortnight." },
        fields: { health: "onTrack", initiativeId: INITIATIVE_ID },
      }),
    });

    expect(initiativeUpdateIntentId({ form: atRisk })).not.toBe(initiativeUpdateIntentId({ form: onTrack }));
  });
});

describe("the dry run", () => {
  it("prints the destination, the health and the exact bytes, and performs no effect", async () => {
    const home = tempHome();
    const h = harness({});

    const code = await runLinearInitiativeUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toStrictEqual([]);
    const id = initiativeUpdateIntentId({ form: formOf({ raw: FORM_TEXT }) });
    expect(readAppendRecord({ home, id, kind: "linear-initiative-updates" })).toBe(undefined);
  });

  it("names the health and the initiative on their own lines", () => {
    const lines = initiativeUpdateDryRunLines({ form: formOf({ raw: FORM_TEXT }), id: "abc" });

    expect(lines).toContain("health:     atRisk");
    expect(lines).toContain(`initiative: ${INITIATIVE_ID}`);
  });

  it("counts no evidence links on an update that carries none, and each link on one that does", () => {
    const bare = formOf({ raw: FORM_TEXT });
    const linked = {
      ...bare,
      artifact: { ...bare.artifact, evidence: [{ label: "the roadmap", url: "https://linear.test/r" }] },
    };

    expect(initiativeUpdateDryRunLines({ form: bare, id: "abc" })).toContain("evidence:   0 link(s)");
    expect(initiativeUpdateDryRunLines({ form: linked, id: "abc" })).toContain("evidence:   1 link(s)");
  });
});

describe("the live write", () => {
  it("reserves, creates, reads back and reports the health Linear echoed", async () => {
    const home = tempHome();
    const h = harness({});

    const code = await runLinearInitiativeUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    const id = initiativeUpdateIntentId({ form: formOf({ raw: FORM_TEXT }) });
    expect(h.calls).toStrictEqual([`create:${id}`, "read"]);
    expect(h.out[0]).toBe("posted the initiative update, health atRisk");
    expect(h.createInput()!["initiativeId"]).toBe(INITIATIVE_ID);
    expect(readAppendRecord({ home, id, kind: "linear-initiative-updates" })!.subject).toBe(INITIATIVE_ID);
  });

  it("refuses the identical report a second time", async () => {
    const home = tempHome();
    await runLinearInitiativeUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: harness({}).deps,
    });
    const second = harness({});

    const code = await runLinearInitiativeUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.calls).toStrictEqual([]);
    expect(second.out[0]).toContain("already reserved");
  });

  it("says UNCONFIRMED rather than claiming a post nobody could read back", async () => {
    const h = harness({ read: "missing" });

    const code = await runLinearInitiativeUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--home", tempHome()] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out[0]).toContain("could NOT be read back");
  });
});

describe("the report", () => {
  it("tells a reader NOT to re-run an indeterminate post", () => {
    const lines = initiativeUpdateOutcomeLines({ outcome: { kind: "indeterminate", reason: "boom" } });

    expect(lines.some((line) => line.includes("Do NOT re-run this"))).toBe(true);
  });

  it("names the initiative, never the project, in the duplicate refusal", () => {
    const lines = initiativeUpdateOutcomeLines({
      outcome: { kind: "duplicate", reservedIso: "2026-09-07T00:00:00.000Z" },
    });

    expect(lines.join(" ")).toContain("same initiative cannot be posted twice");
    expect(lines.join(" ")).not.toContain("project");
  });
});
