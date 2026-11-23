/*
 * What the `linear issue` command's test files share: the form every case files, the in-memory Linear API fake
 * and the deps wired around it, the argv builder, and the throwaway homes each case mints with the hook that
 * removes them. Moved here when the verb's one test file was split by describe.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, ok, okAsync } from "neverthrow";
import { afterEach } from "vitest";
import type { LinearWriteDeps } from "../../../../../../cli/commands/linear/writeDeps.js";
import type { LinearWriteApi, ReadIssue, WrittenObject } from "../../../../../../corpus/linear/write.js";
import type { IngestError } from "../../../../../../lib/ingestError.js";
import type { AssigneeResolution } from "../../../../../../outbound/linear/assigneeIndex.js";
import type { StateCatalog } from "../../../../../../outbound/linear/stateCatalog.js";
import { memoryAutonomyLedgerPort } from "../../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import { emptyMentionResolution } from "../../../../../linearMentionFixtures.js";

const FORM = JSON.stringify({
  artifact: {
    aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
    kind: "structured",
    problem: [{ kind: "para", text: "It is broken." }],
    solution: [{ kind: "para", text: "Unbreak it." }],
  },
  fields: { teamId: "00000000-0000-4000-8000-000000000001", title: "A title" },
});

/** The SAME artifact as FORM, but requesting a priority change — a field the read-back cannot see. */
export const SAME_BODY_NEW_PRIORITY = JSON.stringify({
  artifact: {
    aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
    kind: "structured",
    problem: [{ kind: "para", text: "It is broken." }],
    solution: [{ kind: "para", text: "Unbreak it." }],
  },
  fields: { priority: 2, teamId: "00000000-0000-4000-8000-000000000001", title: "A title" },
});

// A write echoes an id and nothing else; the identifier and URL are the read-back's to give.
const WRITTEN: WrittenObject = { id: "x" };
const READ: ReadIssue = {
  description: "d",
  id: "x",
  identifier: "AAA-9",
  title: "A title",
  updatedAt: "2026-08-02T10:00:00.000Z",
  url: "https://linear.test/AAA-9",
};

/** Read the description out of a provider input bag, which the API types as an index signature. */
function descriptionOf({ input }: { input: Readonly<Record<string, unknown>> }): string | undefined {
  const value = input["description"];
  return typeof value === "string" ? value : undefined;
}

/** Read the assignee id out of a provider input bag. */
function assigneeOf({ input }: { input: Readonly<Record<string, unknown>> }): string | undefined {
  const value = input["assigneeId"];
  return typeof value === "string" ? value : undefined;
}

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.issueCreate", provider: "linear" };
}

/** A roster that resolves nothing, for the cases whose form assigns nobody. */
const EMPTY_RESOLUTION: AssigneeResolution = {
  held: false,
  roster: {
    addressableKeys: 0,
    collisions: [],
    derivedPeople: 0,
    freshness: { kind: "fresh" },
    heldPeople: 0,
  },
  target: undefined,
};

// What the fake last saw: the body Linear holds and the assignee the last create sent. Shared by reference
// between the API fake that writes it and the readers `harness()` returns.
interface SentState {
  sent: string | undefined;
  sentAssignee: string | undefined;
}

const notUsedByLinearIssue = (): never => {
  throw new Error("linear issue never calls the project/milestone lane");
};

/** The fake's `readIssue`: what Linear would hand back for the issue the harness last wrote. */
function readIssueFake({
  calls,
  state,
  create,
  read,
}: {
  calls: string[];
  state: SentState;
  create: "ok" | "fail" | undefined;
  read: "ok" | "missing" | "normalised" | "error" | undefined;
}): LinearWriteApi["readIssue"] {
  return () => {
    calls.push("read");
    // A create that FAILED leaves no issue to find, so the default read must agree with that. Pass
    // `read: "ok"` alongside `create: "fail"` to model the other case: the mutation errored but Linear
    // had already committed it, and the response was lost in transit.
    if (read === "error") {
      return errAsync(ingestError({ message: "read blew up" }));
    }
    if (read === "missing" || (create === "fail" && read === undefined)) {
      return okAsync(undefined);
    }
    // The stored body is derived from what was actually sent, so the fidelity comparison is exercised
    // against real rendered bytes rather than a stub that would differ on every line by accident.
    const stored = read === "normalised" ? `${state.sent!}\n+++` : state.sent;
    return okAsync({ ...READ, description: stored });
  };
}

/** The fake's `updateIssue`: records the call and moves the stored body only on a successful update. */
function updateIssueFake({
  calls,
  state,
  update,
}: {
  calls: string[];
  state: SentState;
  update: "ok" | "fail" | undefined;
}): LinearWriteApi["updateIssue"] {
  return ({ id, input }) => {
    calls.push(`update:${id}`);
    // A FAILED update must not move the stored body: that is the whole point of the lost-response case.
    if (update === "fail") {
      return errAsync(ingestError({ message: "boom" }));
    }
    // An update that carries no description leaves the stored body as it was.
    const described = descriptionOf({ input });
    if (described !== undefined) {
      state.sent = described;
    }
    return okAsync(WRITTEN);
  };
}

/** The in-memory Linear API fake: the issue lane records every call, every other lane throws. */
function fakeApi({
  calls,
  state,
  create,
  read,
  update,
}: {
  calls: string[];
  state: SentState;
  create: "ok" | "fail" | undefined;
  read: "ok" | "missing" | "normalised" | "error" | undefined;
  update: "ok" | "fail" | undefined;
}): LinearWriteApi {
  return {
    createIssue: ({ id, input }) => {
      calls.push(`create:${id}`);
      state.sent = descriptionOf({ input });
      state.sentAssignee = assigneeOf({ input });
      return create === "fail" ? errAsync(ingestError({ message: "boom" })) : okAsync(WRITTEN);
    },
    createComment: notUsedByLinearIssue,
    createRelation: notUsedByLinearIssue,
    createProjectUpdate: notUsedByLinearIssue,
    deleteProjectUpdate: notUsedByLinearIssue,
    readProjectUpdate: notUsedByLinearIssue,
    deleteComment: notUsedByLinearIssue,
    deleteRelation: notUsedByLinearIssue,
    readComment: notUsedByLinearIssue,
    readRelation: notUsedByLinearIssue,
    createMilestone: notUsedByLinearIssue,
    createProject: notUsedByLinearIssue,
    deleteMilestone: notUsedByLinearIssue,
    deleteProject: notUsedByLinearIssue,
    deleteIssue: () => {
      calls.push("delete");
      return okAsync(true);
    },
    readIssue: readIssueFake({ calls, create, read, state }),
    readMilestone: notUsedByLinearIssue,
    readProject: notUsedByLinearIssue,
    updateIssue: updateIssueFake({ calls, state, update }),
    updateProject: notUsedByLinearIssue,
  };
}

/** The `linear issue` deps wired around one API fake, recording into the harness's call and output lists. */
function harnessDeps({
  home,
  api,
  calls,
  out,
  err,
  form,
  resolution,
  catalog,
}: {
  home: string;
  api: LinearWriteApi;
  calls: string[];
  out: string[];
  err: string[];
  form: string;
  resolution: AssigneeResolution;
  catalog: StateCatalog | undefined;
}): LinearWriteDeps {
  return {
    autonomy: memoryAutonomyLedgerPort(),
    bareRefContext: () => ({ repos: [] }),
    env: () => undefined,
    doorLedger: memoryDoorLedger().port,
    err: (line) => err.push(line),
    makeApi: () => {
      calls.push("makeApi");
      return api;
    },
    nowIso: () => "2026-08-02T10:00:00.000Z",
    out: (line) => out.push(line),
    previewMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
    resolveMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
    previewAssignee: async () => ok(resolution),
    readForm: () => form,
    // The default harness assigns nobody and sets no state, so both destination gates pass with an empty
    // roster and no catalog. The cases that exercise them supply their own resolution and catalog.
    resolveAssignee: async () => ok(resolution),
    resolveToken: ({ home: given }) => {
      calls.push(`token:${given === home ? "same-home" : "WRONG-HOME"}`);
      return "lin_api_fake";
    },
    stateCatalog: () => catalog,
  };
}

/**
 * Wire `linear issue`'s deps around an in-memory Linear API fake that records every call it receives.
 *
 * @returns the deps, the recorded calls and output lines, and readers for the body and assignee last sent
 */
export function harness({
  home,
  create,
  read,
  storedBody,
  update,
  form = FORM,
  resolution = EMPTY_RESOLUTION,
  catalog,
}: {
  home: string;
  create?: "ok" | "fail";
  update?: "ok" | "fail";
  form?: string;
  // What the identity roster resolves the form's `assignee` key to. Omitted ⇒ resolves nothing, which is
  // correct for every case whose form assigns nobody.
  resolution?: AssigneeResolution;
  // What `linear states` last recorded for the destination team. Omitted ⇒ nothing ever read it.
  catalog?: StateCatalog;
  // The body Linear already holds, for a harness acting on an issue an EARLIER harness created. Without
  // it a fresh harness reads back an absent description and the update guard sees a real conflict.
  storedBody?: string | undefined;
  // "normalised" echoes the sent body with a fourth `+++` line appended — measured during the PR6 build
  // as something Linear does to a collapsible on ingest. The default echoes it unchanged.
  read?: "ok" | "missing" | "normalised" | "error";
}): {
  deps: LinearWriteDeps;
  sentBody: () => string | undefined;
  sentAssignee: () => string | undefined;
  calls: string[];
  out: string[];
  err: string[];
} {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const state: SentState = { sent: storedBody, sentAssignee: undefined };
  const api = fakeApi({ calls, create, read, state, update });
  return {
    calls,
    deps: harnessDeps({ api, calls, catalog, err, form, home, out, resolution }),
    err,
    out,
    sentAssignee: () => state.sentAssignee,
    sentBody: () => state.sent,
  };
}

/**
 * Prefix a `linear issue` argument list with the program, binary, noun and verb tokens the runner expects.
 *
 * @returns the full argv the runner parses
 */
export function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "issue", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every directory {@link tempHome} minted; call it once at module scope. */
export function useTempHomeCleanup(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * Mint a throwaway home under the per-file temp root, recorded so the registered cleanup removes it.
 *
 * @returns the new home's path
 */
export function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-run-"));
  fixtureDirs.push(home);
  return home;
}
