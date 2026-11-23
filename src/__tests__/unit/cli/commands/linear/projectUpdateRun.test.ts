/**
 * `linear project-update create` — the verb that posts a project STATUS UPDATE, which nothing here could do
 * before: the write door's `projectUpdate` is Linear's project-EDIT mutation, so there was no path at all.
 *
 * The cases below pin the four things that make this a different write from a comment rather than a copy of
 * one: health is required and reaches the provider input, health is part of the intent id, the body folds
 * only when there is something to fold, and the report states the health Linear ECHOED.
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
  parseLinearProjectUpdateForm,
  projectUpdateDryRunLines,
  projectUpdateInputFor,
  projectUpdateIntentId,
  projectUpdateOutcomeLines,
} from "../../../../../cli/commands/linear/projectUpdateCore.js";
import {
  type LinearProjectUpdateWriteDeps,
  runLinearProjectUpdate,
} from "../../../../../cli/commands/linear/projectUpdateRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearWriteApi, ReadProjectUpdate, WrittenObject } from "../../../../../corpus/linear/write.js";
import { readProjectUpdateFrom } from "../../../../../corpus/linear/writeReadBack.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readAppendRecord } from "../../../../../outbound/linear/commentLedger.js";
import type { LinearProjectUpdateForm } from "../../../../../outbound/linear/projectUpdateTypes.js";
import { renderProjectUpdateBody } from "../../../../../outbound/linear/render.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

/** Every scratch home this file mints, removed in `afterAll` — see `.claude/rules/testing.md`. */
const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-project-update-"));
  homes.push(home);
  return home;
}

const PROJECT_ID = "92f14fe7-e9a9-4f21-a7b1-0305e82c3301";

const FORM_TEXT = JSON.stringify({
  artifact: { summary: "Four items shipped and three are still open." },
  fields: { health: "atRisk", projectId: PROJECT_ID },
});

// A write echoes an id and nothing else; every display field is the read-back's to give.
const WRITTEN: WrittenObject = { id: "u1" };

const READ: ReadProjectUpdate = {
  body: "b",
  health: "atRisk",
  id: "u1",
  updatedAt: "2026-08-30T10:00:00.000Z",
  url: "https://linear.test/project/backend/updates/u1",
};

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.projectUpdateCreate", provider: "linear" };
}

const NOT_THIS_LANE = (): never => {
  throw new Error("linear project-update never calls the issue/comment/relation lane");
};

function harness({
  home,
  create,
  read,
  form = FORM_TEXT,
}: {
  home: string;
  create?: "ok" | "fail";
  // Omitted ⇒ the update is found. "missing" models a create that never landed.
  read?: "ok" | "missing";
  form?: string;
}): {
  deps: LinearProjectUpdateWriteDeps;
  calls: string[];
  out: string[];
  err: string[];
  createInput: () => Readonly<Record<string, unknown>> | undefined;
} {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let createInput: Readonly<Record<string, unknown>> | undefined;
  const api: LinearWriteApi = {
    createComment: NOT_THIS_LANE,
    createIssue: NOT_THIS_LANE,
    createMilestone: NOT_THIS_LANE,
    createProject: NOT_THIS_LANE,
    createProjectUpdate: ({ id, input }) => {
      calls.push(`create:${id}`);
      createInput = input;
      return create === "fail" ? errAsync(ingestError({ message: "boom" })) : okAsync(WRITTEN);
    },
    createRelation: NOT_THIS_LANE,
    deleteComment: NOT_THIS_LANE,
    deleteIssue: NOT_THIS_LANE,
    deleteMilestone: NOT_THIS_LANE,
    deleteProject: NOT_THIS_LANE,
    deleteProjectUpdate: NOT_THIS_LANE,
    deleteRelation: NOT_THIS_LANE,
    readComment: NOT_THIS_LANE,
    readIssue: NOT_THIS_LANE,
    readMilestone: NOT_THIS_LANE,
    readProject: NOT_THIS_LANE,
    readProjectUpdate: () => {
      calls.push("read");
      return read === "missing" ? okAsync(undefined) : okAsync(READ);
    },
    readRelation: NOT_THIS_LANE,
    updateIssue: NOT_THIS_LANE,
    updateProject: NOT_THIS_LANE,
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
      nowIso: () => "2026-08-30T10:00:00.000Z",
      out: (line) => out.push(line),
      readForm: () => form,
      resolveToken: ({ home: given }) => {
        calls.push(given === home ? "token:same-home" : "token:WRONG-HOME");
        return "lin_api_fake";
      },
    },
    err,
    out,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "project-update", ...rest];
}

function formOf({ raw }: { raw: string }): LinearProjectUpdateForm {
  return unwrap(parseLinearProjectUpdateForm({ raw }));
}

describe("the form", () => {
  it("refuses a health Linear does not have", () => {
    const parsed = parseLinearProjectUpdateForm({
      raw: JSON.stringify({ artifact: { summary: "s" }, fields: { health: "amber", projectId: PROJECT_ID } }),
    });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual(["fields.health: Invalid input"]);
  });

  it("refuses an update with no health at all, which would leave the project reading its old one", () => {
    const parsed = parseLinearProjectUpdateForm({
      raw: JSON.stringify({ artifact: { summary: "s" }, fields: { projectId: PROJECT_ID } }),
    });

    expect(linearVerbErrorLines({ error: unwrapErr(parsed) })).toEqual(["fields.health: Invalid input"]);
  });

  it("accepts the minimum a status update can be: a project, a health and one line", () => {
    const form = formOf({ raw: FORM_TEXT });

    expect(form.fields.health).toBe("atRisk");
    expect(form.artifact.summary).toBe("Four items shipped and three are still open.");
  });
});

describe("the rendered body", () => {
  it("has NO collapsible when there is nothing to fold — a fold onto nothing teaches nobody to open one", () => {
    const body = renderProjectUpdateBody({ artifact: { summary: "Shipped four, three open." } });

    expect(body).toBe("Shipped four, three open.");
  });

  it("folds detail behind the collapsible when there is some", () => {
    const body = renderProjectUpdateBody({
      artifact: { detail: [{ kind: "para", text: "JJJJ-690 landed." }], summary: "Shipped four." },
    });

    expect(body).toContain("+++ Detail and evidence");
    expect(body.startsWith("Shipped four.")).toBe(true);
  });
});

describe("the provider input", () => {
  it("carries the health, the project and the rendered body", () => {
    const input = projectUpdateInputFor({ form: formOf({ raw: FORM_TEXT }) });

    expect(input["health"]).toBe("atRisk");
    expect(input["projectId"]).toBe(PROJECT_ID);
    expect(input["body"]).toBe("Four items shipped and three are still open.");
  });
});

describe("the intent id", () => {
  it("is the same for the same report, so a retry cannot post it twice", () => {
    const form = formOf({ raw: FORM_TEXT });

    expect(projectUpdateIntentId({ form })).toBe(projectUpdateIntentId({ form }));
  });

  it("CHANGES when only the health does — the same words at a different health are a different report", () => {
    const atRisk = formOf({ raw: FORM_TEXT });
    const offTrack = formOf({
      raw: JSON.stringify({
        artifact: { summary: "Four items shipped and three are still open." },
        fields: { health: "offTrack", projectId: PROJECT_ID },
      }),
    });

    expect(projectUpdateIntentId({ form: atRisk })).not.toBe(projectUpdateIntentId({ form: offTrack }));
  });

  // Measured: a cycle proposal redrafts its body every pass, so a body-keyed id let the same overdue
  // window be answered twice, each a fresh reservation and a second notification to every watcher.
  it("is keyed by the overdue window when the form names one, whatever the words or health", () => {
    const first = windowForm({
      health: "atRisk",
      overdueSince: WINDOW,
      summary: "Nothing moved since the last update.",
    });
    const redraft = windowForm({
      health: "onTrack",
      overdueSince: WINDOW,
      summary: "Two items moved: INFR-1, INFR-2.",
    });

    expect(projectUpdateIntentId({ form: first })).toBe(projectUpdateIntentId({ form: redraft }));
  });

  it("is a new id for the next window, so a real post never blocks the one after it", () => {
    const answered = windowForm({ health: "atRisk", overdueSince: WINDOW, summary: "Shipped four." });
    const next = windowForm({ health: "atRisk", overdueSince: "2026-08-30T11:16:04.713Z", summary: "Shipped four." });

    expect(projectUpdateIntentId({ form: answered })).not.toBe(projectUpdateIntentId({ form: next }));
  });

  it("differs across projects answering the same instant", () => {
    const here = windowForm({ health: "atRisk", overdueSince: WINDOW, summary: "Shipped four." });
    const there = formOf({
      raw: JSON.stringify({
        artifact: { summary: "Shipped four." },
        fields: { health: "atRisk", overdueSince: WINDOW, projectId: "another-project" },
      }),
    });

    expect(projectUpdateIntentId({ form: here })).not.toBe(projectUpdateIntentId({ form: there }));
  });

  it("never sends the window to Linear — it keys the reservation and nothing else", () => {
    const input = projectUpdateInputFor({
      form: windowForm({ health: "atRisk", overdueSince: WINDOW, summary: "Shipped four." }),
    });

    expect(Object.keys(input).toSorted()).toEqual(["body", "health", "projectId"]);
  });

  it("refuses a window that is not an ISO instant", () => {
    const parsed = parseLinearProjectUpdateForm({
      raw: JSON.stringify({
        artifact: { summary: "Shipped four." },
        fields: { health: "atRisk", overdueSince: "last tuesday", projectId: PROJECT_ID },
      }),
    });

    expect(parsed.isErr()).toBe(true);
    expect(linearVerbErrorLines({ error: parsed._unsafeUnwrapErr() }).join("\n")).toContain("fields.overdueSince");
  });
});

/** The instant a cycle proposal's overdue window opened — its own `movedAtIso`. */
const WINDOW = "2026-06-29T02:32:49.781Z";

/** A form answering one overdue window on {@link PROJECT_ID}. */
function windowForm({
  health,
  overdueSince,
  summary,
}: {
  health: string;
  overdueSince: string;
  summary: string;
}): LinearProjectUpdateForm {
  return formOf({
    raw: JSON.stringify({ artifact: { summary }, fields: { health, overdueSince, projectId: PROJECT_ID } }),
  });
}

describe("the dry run", () => {
  it("prints the destination, the health and the exact bytes, and performs no effect", async () => {
    const home = tempHome();
    const h = harness({ home });

    const code = await runLinearProjectUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toStrictEqual([]);
    expect(h.out.some((line) => line.startsWith("health:     atRisk"))).toBe(true);
    const id = projectUpdateIntentId({ form: formOf({ raw: FORM_TEXT }) });
    expect(readAppendRecord({ home, id, kind: "linear-project-updates" })).toBe(undefined);
  });

  it("names the health on its own line rather than leaving a reader to find it in the body", () => {
    const lines = projectUpdateDryRunLines({ form: formOf({ raw: FORM_TEXT }), id: "abc" });

    expect(lines).toContain("health:     atRisk");
    expect(lines).toContain(`project:    ${PROJECT_ID}`);
  });

  it("counts no evidence links on an update that carries none, and each link on one that does", () => {
    const bare = formOf({ raw: FORM_TEXT });
    const evidence = [
      { label: "the board", url: "https://linear.test/a" },
      { label: "the run", url: "https://linear.test/b" },
    ];
    const linked = { ...bare, artifact: { ...bare.artifact, evidence } };

    expect(projectUpdateDryRunLines({ form: bare, id: "abc" })).toContain("evidence:0 link(s)");
    expect(projectUpdateDryRunLines({ form: linked, id: "abc" })).toContain("evidence:2 link(s)");
  });
});

describe("the live write", () => {
  it("reserves, creates, reads back and reports the health Linear echoed", async () => {
    const home = tempHome();
    const h = harness({ home });

    const code = await runLinearProjectUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.calls).toContain("token:same-home");
    expect(h.calls).toContain("read");
    expect(h.out[0]).toBe("posted the project update, health atRisk");
    expect(h.createInput()!["health"]).toBe("atRisk");
    const id = projectUpdateIntentId({ form: formOf({ raw: FORM_TEXT }) });
    expect(readAppendRecord({ home, id, kind: "linear-project-updates" })!.subject).toBe(PROJECT_ID);
  });

  it("refuses the SAME report a second time, from the reservation its own first run left", async () => {
    const home = tempHome();
    await runLinearProjectUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: harness({ home }).deps,
    });

    const second = harness({ home });
    const code = await runLinearProjectUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.calls).not.toContain("create:");
    expect(second.out.some((line) => line.startsWith("refused: this exact project update"))).toBe(true);
  });

  it("reports a create whose response was lost but whose object is there as LANDED", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", home });

    const code = await runLinearProjectUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.out[0]).toBe("posted the project update, despite a transport error — it was found at the id we chose.");
  });

  it("reports a create that errored and left nothing behind as FAILED, not as landed", async () => {
    const home = tempHome();
    const h = harness({ create: "fail", home, read: "missing" });

    const code = await runLinearProjectUpdate({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).not.toBe(EXIT_OK);
    expect(h.out.join("\n")).toContain("the write failed: boom");
  });
});

describe("the report", () => {
  it("states the health on the success line, because that is what a reader of the project acts on", () => {
    const lines = projectUpdateOutcomeLines({ outcome: { kind: "written", update: READ } });

    expect(lines[0]).toBe("posted the project update, health atRisk");
    expect(lines[1]).toBe("https://linear.test/project/backend/updates/u1");
  });

  it("tells a caller NOT to re-run an unconfirmed write", () => {
    const lines = projectUpdateOutcomeLines({ outcome: { kind: "unconfirmed", update: WRITTEN } });

    expect(lines.join("\n")).toContain("Do not re-run this");
  });
});

describe("the invocation", () => {
  it("refuses a verb that is not create", async () => {
    const home = tempHome();
    const h = harness({ home });

    const code = await runLinearProjectUpdate({
      argv: argv({ rest: ["edit", "--form", "-", "--home", home] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.err.join("\n")).toContain("slopweaver linear project-update create --form");
  });
});

describe("the read-back shaper", () => {
  it("shapes a well-formed node", () => {
    const shaped = readProjectUpdateFrom({
      data: { projectUpdate: { body: "b", health: "offTrack", id: "u1", updatedAt: "t", url: "u" } },
    });

    expect(shaped!.health).toBe("offTrack");
    expect(shaped!.body).toBe("b");
  });

  it("returns undefined for an id that does not exist, rather than inventing an empty update", () => {
    expect(readProjectUpdateFrom({ data: { projectUpdate: null } })).toBe(undefined);
  });

  it("returns undefined when health is missing, because a status update without one says nothing", () => {
    expect(readProjectUpdateFrom({ data: { projectUpdate: { id: "u1", updatedAt: "t", url: "u" } } })).toBe(undefined);
  });
});
