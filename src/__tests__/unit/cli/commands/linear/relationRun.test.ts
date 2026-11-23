/**
 * The `linear relation create` COMMAND — same orchestration-assertion rationale as
 * `src/__tests__/unit/cli/commands/linear/run/create.test.ts`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, okAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import { relationIntentId } from "../../../../../cli/commands/linear/relationCore.js";
import { type LinearRelationWriteDeps, runLinearRelation } from "../../../../../cli/commands/linear/relationRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearWriteApi, WrittenRelation } from "../../../../../corpus/linear/write.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { readAppendRecord } from "../../../../../outbound/linear/commentLedger.js";
import type { LinearRelationForm } from "../../../../../outbound/linear/commentTypes.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const BLOCKER = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const BLOCKED = "9c5f8e21-1111-4222-8333-0305e82c3302";

const TYPED_FORM: LinearRelationForm = {
  fields: { issueId: BLOCKER, relatedIssueId: BLOCKED, type: "blocks" },
};
const FORM = JSON.stringify(TYPED_FORM);

const WRITTEN: WrittenRelation = { id: "r-1", issueId: BLOCKER, relatedIssueId: BLOCKED, type: "blocks" };

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.issueRelationCreate", provider: "linear" };
}

function notUsedByLinearRelation(): never {
  throw new Error("linear relation never calls the issue/project/comment lane");
}

function harness({
  home,
  create,
  read,
  form = FORM,
}: {
  home: string;
  create?: "ok" | "fail";
  read?: "ok" | "missing" | "error";
  form?: string;
}): { deps: LinearRelationWriteDeps; calls: string[]; out: string[]; err: string[]; sentInput: () => unknown } {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let sent: unknown;
  const api: LinearWriteApi = {
    createComment: notUsedByLinearRelation,
    createIssue: notUsedByLinearRelation,
    createMilestone: notUsedByLinearRelation,
    createProject: notUsedByLinearRelation,
    createRelation: ({ id, input }) => {
      calls.push(`create:${id}`);
      if (create === "fail") {
        return errAsync(ingestError({ message: "boom" }));
      }
      sent = input;
      return okAsync(WRITTEN);
    },
    deleteComment: notUsedByLinearRelation,
    deleteIssue: notUsedByLinearRelation,
    deleteMilestone: notUsedByLinearRelation,
    deleteProject: notUsedByLinearRelation,
    createProjectUpdate: notUsedByLinearRelation,
    deleteProjectUpdate: notUsedByLinearRelation,
    readProjectUpdate: notUsedByLinearRelation,
    deleteRelation: notUsedByLinearRelation,
    readComment: notUsedByLinearRelation,
    readIssue: notUsedByLinearRelation,
    readMilestone: notUsedByLinearRelation,
    readProject: notUsedByLinearRelation,
    readRelation: () => {
      calls.push("read");
      if (read === "error") {
        return errAsync(ingestError({ message: "read blew up" }));
      }
      if (read === "missing" || (create === "fail" && read === undefined)) {
        return okAsync(undefined);
      }
      return okAsync(WRITTEN);
    },
    updateIssue: notUsedByLinearRelation,
    updateProject: notUsedByLinearRelation,
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
      nowIso: () => "2026-08-26T10:00:00.000Z",
      out: (line) => out.push(line),
      readForm: () => form,
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
  return ["node", "slopweaver", "linear", "relation", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-relation-"));
  fixtureDirs.push(home);
  return home;
}

describe("runLinearRelation", () => {
  it("asserts the edge, reads it back, and records the reservation against the first issue", async () => {
    const home = tempHome();
    const { deps, calls, out, sentInput } = harness({ home });
    const id = relationIntentId({ form: TYPED_FORM });

    expect(await runLinearRelation({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_OK,
    );
    expect(calls).toEqual(["token:same-home", "makeApi", `create:${id}`, "read"]);
    expect(sentInput()).toEqual({ issueId: BLOCKER, relatedIssueId: BLOCKED, type: "blocks" });
    expect(out[1]!).toBe(`${BLOCKER} —blocks→ ${BLOCKED}`);
    expect(readAppendRecord({ home, id, kind: "linear-relations" })!.subject).toBe(BLOCKER);
  });

  it("REFUSES the same edge a second time", async () => {
    const home = tempHome();
    await runLinearRelation({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: harness({ home }).deps,
    });
    const second = harness({ home });

    expect(
      await runLinearRelation({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: second.deps }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.out[0]!).toContain("already reserved");
  });

  it("gives the REVERSED edge its own id, because `A blocks B` is not `B blocks A`", () => {
    const forward = relationIntentId({ form: TYPED_FORM });
    const reverse = relationIntentId({
      form: { fields: { issueId: BLOCKED, relatedIssueId: BLOCKER, type: "blocks" } },
    });

    expect(forward === reverse).toBe(false);
  });

  it("a dry run spells out which way round `blocks` reads, and performs no effect", async () => {
    const home = tempHome();
    const { deps, calls, out } = harness({ home });

    expect(
      await runLinearRelation({ argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }), deps }),
    ).toBe(EXIT_OK);
    expect(calls).toEqual([]);
    expect(out[2]!).toBe(`reads as:    ${BLOCKER} BLOCKS ${BLOCKED}`);
  });

  it("reports UNCONFIRMED when the mutation landed but the read-back found nothing", async () => {
    const home = tempHome();
    const { deps, out } = harness({ home, read: "missing" });

    expect(await runLinearRelation({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(out[0]!).toContain("could NOT be read back");
  });

  it("reports FAILED only once a read-back established the relation is absent", async () => {
    const home = tempHome();
    const { deps, out } = harness({ create: "fail", home, read: "missing" });

    expect(await runLinearRelation({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_ERROR,
    );
    expect(out[0]!).toContain("the write failed");
  });

  it("refuses a self-relation at the form, before any effect", async () => {
    const home = tempHome();
    const self = JSON.stringify({ fields: { issueId: BLOCKER, relatedIssueId: BLOCKER, type: "blocks" } });
    const { deps, calls, err } = harness({ form: self, home });

    expect(await runLinearRelation({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_USAGE,
    );
    expect(calls).toEqual([]);
    expect(err.join("\n")).toContain("cannot be related to itself");
  });

  it("refuses a type outside the three this door writes", async () => {
    const home = tempHome();
    const similar = JSON.stringify({ fields: { issueId: BLOCKER, relatedIssueId: BLOCKED, type: "similar" } });
    const { deps, err } = harness({ form: similar, home });

    expect(await runLinearRelation({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps })).toBe(
      EXIT_USAGE,
    );
    expect(err.join("\n")).toContain("fields.type");
  });
});
