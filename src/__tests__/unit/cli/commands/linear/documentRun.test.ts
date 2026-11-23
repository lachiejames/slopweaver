/**
 * `linear document create|update` — the shell's ordering and the update's three refusals.
 *
 * The fake API holds documents in a map, so a create followed by an update round-trips through the same
 * stored content the ledger digested: the conflict guard is exercised against a page that really changed,
 * not against a flag a test set. Every edge is a plain injected function. No mocks.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errAsync, err as errResult, ok, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";

import { documentIntentId, parseLinearDocumentForm } from "../../../../../cli/commands/linear/documentCore.js";
import type { LinearDocumentWriteDeps } from "../../../../../cli/commands/linear/documentDeps.js";
import { runLinearDocument } from "../../../../../cli/commands/linear/documentRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearDocumentWriteApi, ReadLinearDocument } from "../../../../../corpus/linear/writeDocument.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { unwrap } from "../../../../../lib/result.js";
import { readDocumentRecord } from "../../../../../outbound/linear/documentLedger.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { emptyMentionResolution } from "../../../../linearMentionFixtures.js";

const STORE_DOWN = IdentityRosterErrors.storeUnavailable({ doing: "read the roster", reason: "disk full" });

const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-document-"));
  homes.push(home);
  return home;
}

const PROJECT_ID = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

function formText({ lead, projectId = PROJECT_ID }: { lead: string; projectId?: string }): string {
  return JSON.stringify({
    content: [
      { kind: "para", text: lead },
      { kind: "heading", text: "Why now" },
      { kind: "para", text: "The queue doubled in a week." },
    ],
    fields: { destination: { id: projectId, kind: "project" }, title: "Move intake to one queue" },
  });
}

function ingestError({ message }: { message: string }): IngestError {
  return { kind: "http", message, operation: "linear.documentCreate", provider: "linear" };
}

/**
 * A Linear that stores what it is sent, verbatim, so a read-back is what the last write left. `ignoresUpdates`
 * acknowledges an update and stores nothing — the counterexample a successful mutation's read-back must catch.
 */
function fakeLinear({
  createFails = false,
  ignoresUpdates = false,
}: { createFails?: boolean; ignoresUpdates?: boolean } = {}): {
  api: LinearDocumentWriteApi;
  calls: string[];
  store: Map<string, ReadLinearDocument>;
} {
  const calls: string[] = [];
  const store = new Map<string, ReadLinearDocument>();
  const put = ({ id, input }: { id: string; input: Readonly<Record<string, unknown>> }): void => {
    const before = store.get(id);
    store.set(id, {
      content: String(input["content"]),
      id,
      initiativeId: undefined,
      issueId: undefined,
      projectId: before === undefined ? String(input["projectId"]) : before.projectId,
      slugId: "abc123",
      title: String(input["title"]),
      updatedAt: `2026-10-22T00:00:0${String(calls.length)}.000Z`,
      url: `https://linear.test/document/${id}`,
    });
  };
  const api: LinearDocumentWriteApi = {
    createDocument: ({ id, input }) => {
      calls.push(`create:${id}`);
      if (createFails) {
        return errAsync(ingestError({ message: "socket hang up" }));
      }
      put({ id, input });
      return okAsync({ id });
    },
    deleteDocument: () => okAsync(true),
    readDocument: ({ id }) => {
      calls.push(`read:${id}`);
      return okAsync(store.get(id));
    },
    updateDocument: ({ id, input }) => {
      calls.push(`update:${id}:${Object.keys(input).toSorted().join(",")}`);
      if (!ignoresUpdates) {
        put({ id, input });
      }
      return okAsync({ id });
    },
  };
  return { api, calls, store };
}

function harness({ form, api }: { form: string; api: LinearDocumentWriteApi }): {
  deps: LinearDocumentWriteDeps;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    deps: {
      bareRefContext: () => ({ repos: [] }),
      env: () => undefined,
      doorLedger: memoryDoorLedger().port,
      err: (line) => err.push(line),
      makeApi: () => api,
      nowIso: () => "2026-10-22T00:00:00.000Z",
      out: (line) => out.push(line),
      previewMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      readForm: () => form,
      resolveMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      resolveToken: () => "lin_api_fake",
    },
    err,
    out,
  };
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "linear", "document", ...rest];
}

const LEAD = "This proposes one intake queue for every site.";

describe("linear document create", () => {
  it("creates at the form's derived id, on the named project, and confirms the ledger", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const run = harness({ api: linear.api, form: formText({ lead: LEAD }) });
    const id = documentIntentId({ form: unwrap(parseLinearDocumentForm({ raw: formText({ lead: LEAD }) })) });

    const code = await runLinearDocument({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(linear.calls).toEqual([`create:${id}`, `read:${id}`]);
    expect(linear.store.get(id)!.projectId).toBe(PROJECT_ID);
    expect(run.out.slice(0, 3)).toEqual([
      'created document "Move intake to one queue"',
      `https://linear.test/document/${id}`,
      `document id: ${id}`,
    ]);
    expect(readDocumentRecord({ home, id })!.confirmedIso).toBe("2026-10-22T00:00:00.000Z");
  });

  it("refuses the same form a second time as a duplicate, without a second create", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const first = harness({ api: linear.api, form: formText({ lead: LEAD }) });
    await runLinearDocument({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: first.deps });
    const second = harness({ api: linear.api, form: formText({ lead: LEAD }) });

    const code = await runLinearDocument({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: second.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(linear.calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
    expect(second.out[0]).toBe("refused: this exact intent was already reserved at 2026-10-22T00:00:00.000Z.");
  });

  it("reports a create whose response was lost as failed when nothing is at the reserved id", async () => {
    const home = tempHome();
    const linear = fakeLinear({ createFails: true });
    const run = harness({ api: linear.api, form: formText({ lead: LEAD }) });

    const code = await runLinearDocument({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(run.out).toEqual(["the write failed: socket hang up"]);
  });

  it("dry-runs with no call to Linear and no ledger record", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const run = harness({ api: linear.api, form: formText({ lead: LEAD }) });
    const id = documentIntentId({ form: unwrap(parseLinearDocumentForm({ raw: formText({ lead: LEAD }) })) });

    const code = await runLinearDocument({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(linear.calls).toEqual([]);
    expect(readDocumentRecord({ home, id })).toBeUndefined();
    expect(run.out).toContain(`${LEAD}\n\n## Why now\n\nThe queue doubled in a week.`);
  });

  it("refuses a mention the roster cannot address before anything is reserved", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const run = harness({ api: linear.api, form: formText({ lead: "This proposes one queue, owned by @{nobody}." }) });

    const code = await runLinearDocument({
      argv: argv({ rest: ["create", "--form", "-", "--home", home] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(linear.calls).toEqual([]);
    expect(run.err.join("\n")).toContain("nobody");
  });

  it("exits ERROR before anything is reserved, naming the store, when the roster cannot resolve the mentions", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const run = harness({ api: linear.api, form: formText({ lead: LEAD }) });
    const deps: LinearDocumentWriteDeps = { ...run.deps, resolveMentions: async () => errResult(STORE_DOWN) };

    const code = await runLinearDocument({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps });

    expect(code).toBe(EXIT_ERROR);
    expect(linear.calls).toEqual([]);
    expect(run.err).toEqual([STORE_DOWN.message]);
  });

  it("exits ERROR on a dry run, naming the store, when the roster cannot preview the mentions", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const run = harness({ api: linear.api, form: formText({ lead: LEAD }) });
    const deps: LinearDocumentWriteDeps = { ...run.deps, previewMentions: async () => errResult(STORE_DOWN) };

    const code = await runLinearDocument({
      argv: argv({ rest: ["create", "--form", "-", "--dry-run", "--home", home] }),
      deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(linear.calls).toEqual([]);
    expect(run.err).toEqual([STORE_DOWN.message]);
  });

  it("refuses --document-id on create as a usage error", async () => {
    const linear = fakeLinear();
    const run = harness({ api: linear.api, form: formText({ lead: LEAD }) });

    const code = await runLinearDocument({
      argv: argv({ rest: ["create", "--form", "-", "--document-id", PROJECT_ID] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(run.err.join("\n")).toContain("--document-id is for update only");
  });
});

/** Create the page once, returning its id. */
async function created({ home, linear }: { home: string; linear: ReturnType<typeof fakeLinear> }): Promise<string> {
  const run = harness({ api: linear.api, form: formText({ lead: LEAD }) });
  await runLinearDocument({ argv: argv({ rest: ["create", "--form", "-", "--home", home] }), deps: run.deps });
  return documentIntentId({ form: unwrap(parseLinearDocumentForm({ raw: formText({ lead: LEAD }) })) });
}

describe("linear document update", () => {
  it("re-renders the title and content only, never a parent id", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const id = await created({ home, linear });
    const run = harness({
      api: linear.api,
      form: formText({ lead: "This proposes one intake queue, live in November." }),
    });

    const code = await runLinearDocument({
      argv: argv({ rest: ["update", "--form", "-", "--document-id", id, "--home", home] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_OK);
    // The precheck read, the update, the read-back.
    expect(linear.calls.slice(-3)).toEqual([`read:${id}`, `update:${id}:content,title`, `read:${id}`]);
    expect(linear.store.get(id)!.content).toContain("live in November");
    expect(run.out[0]).toBe('updated document "Move intake to one queue"');
  });

  it("never reports an acknowledged update as written when the page reads exactly as the precheck left it", async () => {
    const home = tempHome();
    const linear = fakeLinear({ ignoresUpdates: true });
    const id = await created({ home, linear });
    const before = linear.store.get(id)!;
    const run = harness({
      api: linear.api,
      form: formText({ lead: "This proposes one intake queue, live in November." }),
    });

    const code = await runLinearDocument({
      argv: argv({ rest: ["update", "--form", "-", "--document-id", id, "--home", home] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(linear.calls.slice(-3)).toEqual([`read:${id}`, `update:${id}:content,title`, `read:${id}`]);
    expect(run.out[0]).toBe(
      'Linear acknowledged the update to "Move intake to one queue", but the page reads as it did before it ' +
        `(updatedAt ${before.updatedAt} has not moved), so nothing shows the update applied.`,
    );
  });

  it("refuses a page somebody edited since slopweaver last wrote it", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const id = await created({ home, linear });
    linear.store.set(id, { ...linear.store.get(id)!, content: "A colleague rewrote this." });
    const run = harness({ api: linear.api, form: formText({ lead: LEAD }) });

    const code = await runLinearDocument({
      argv: argv({ rest: ["update", "--form", "-", "--document-id", id, "--home", home] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(linear.calls.some((call) => call.startsWith("update:"))).toBe(false);
    expect(run.err[0]).toContain("was edited since slopweaver last wrote it");
  });

  it("refuses a form that names a different destination", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const id = await created({ home, linear });
    const run = harness({
      api: linear.api,
      form: formText({ lead: LEAD, projectId: "a0000071-0000-4000-8000-000000000077" }),
    });

    const code = await runLinearDocument({
      argv: argv({ rest: ["update", "--form", "-", "--document-id", id, "--home", home] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.err[0]).toContain("An update never moves a page");
  });

  it("refuses a document slopweaver has no record of creating", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const run = harness({ api: linear.api, form: formText({ lead: LEAD }) });

    const code = await runLinearDocument({
      argv: argv({ rest: ["update", "--form", "-", "--document-id", PROJECT_ID, "--home", home] }),
      deps: run.deps,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(linear.calls).toEqual([]);
    expect(run.err[0]).toContain(`no readable record of creating document ${PROJECT_ID}`);
  });
});
