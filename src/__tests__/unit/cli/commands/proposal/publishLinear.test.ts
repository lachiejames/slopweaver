/**
 * `proposal publish` to a `linear-document` destination, driven through the REAL `linear document` command over a
 * Linear that stores what it is sent — so what is under test is the form this adapter builds passing the door's
 * own checks, and the address it records being the document the door wrote.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, okAsync } from "neverthrow";
import { afterAll, describe, expect, it } from "vitest";

import type { LinearDocumentWriteDeps } from "../../../../../cli/commands/linear/documentDeps.js";
import { runLinearDocument } from "../../../../../cli/commands/linear/documentRun.js";
import type { PublishTarget } from "../../../../../cli/commands/proposal/publishCore.js";
import { linearPublishDestination, publishLinearProposal } from "../../../../../cli/commands/proposal/publishLinear.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { LinearDocumentWriteApi, ReadLinearDocument } from "../../../../../corpus/linear/writeDocument.js";
import type { ProposalDestination } from "../../../../../outbound/proposal/destination.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { emptyMentionResolution } from "../../../../linearMentionFixtures.js";

const homes: string[] = [];

afterAll(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-proposal-linear-"));
  homes.push(home);
  return home;
}

const PROJECT_ID = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

const DESTINATION: ProposalDestination = {
  kind: "linear-document",
  schemaVersion: 1,
  target: { id: PROJECT_ID, kind: "project" },
};

const MARKDOWN = "One queue for every site.\n\n## Why now\n\nThe queue doubled in a week.";

/** A Linear that stores what it is sent, verbatim, so a read-back is what the last write left. */
function fakeLinear(): { api: LinearDocumentWriteApi; calls: string[]; store: Map<string, ReadLinearDocument> } {
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
      put({ id, input });
      return okAsync({ id });
    },
    deleteDocument: () => okAsync(true),
    readDocument: ({ id }) => {
      calls.push(`read:${id}`);
      return okAsync(store.get(id));
    },
    updateDocument: ({ id, input }) => {
      calls.push(`update:${id}`);
      put({ id, input });
      return okAsync({ id });
    },
  };
  return { api, calls, store };
}

/** The door's edges over a fake Linear. `readForm` is a placeholder this adapter must replace. */
function documentDeps({ api }: { api: LinearDocumentWriteApi }): { deps: LinearDocumentWriteDeps; out: string[] } {
  const out: string[] = [];
  return {
    deps: {
      bareRefContext: () => ({ repos: [] }),
      doorLedger: memoryDoorLedger().port,
      env: () => undefined,
      err: (line) => out.push(`err: ${line}`),
      makeApi: () => api,
      nowIso: () => "2026-10-22T00:00:00.000Z",
      out: (line) => out.push(line),
      previewMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      readForm: () => "the adapter never reads this",
      resolveMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
      resolveToken: () => "lin_api_fake",
    },
    out,
  };
}

/** Publish once through the real door. */
async function publish({
  target,
  home,
  api,
  title = "Move intake to one queue",
  markdown = MARKDOWN,
  dryRun = false,
}: {
  target: PublishTarget;
  home: string;
  api: LinearDocumentWriteApi;
  title?: string;
  markdown?: string;
  dryRun?: boolean;
}): Promise<{ outcome: Awaited<ReturnType<typeof publishLinearProposal>>; out: string[]; err: string[] }> {
  const door = documentDeps({ api });
  const err: string[] = [];
  const outcome = await publishLinearProposal({
    documentDeps: door.deps,
    dryRun,
    err: (line) => err.push(line),
    home,
    icon: undefined,
    markdown,
    runDocument: runLinearDocument,
    target,
    title,
  });
  return { err, out: door.out, outcome };
}

describe("publishLinearProposal", () => {
  it("creates the document under the install's target and records the id and URL the door reported", async () => {
    const home = tempHome();
    const linear = fakeLinear();

    const { outcome } = await publish({ api: linear.api, home, target: { destination: DESTINATION, kind: "create" } });

    expect(outcome.code).toBe(EXIT_OK);
    const id = linear.calls[0]!.replace("create:", "");
    expect(outcome.address).toEqual({ id, provider: "linear", url: `https://linear.test/document/${id}` });
    expect(linear.store.get(id)!.projectId).toBe(PROJECT_ID);
    expect(linear.store.get(id)!.content).toBe(
      "One queue for every site.\n\n## Why now\n\nThe queue doubled in a week.",
    );
  });

  it("updates the recorded document in place on a re-publish, keeping its address", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    const first = await publish({ api: linear.api, home, target: { destination: DESTINATION, kind: "create" } });
    const address = first.outcome.address!;

    const second = await publish({
      api: linear.api,
      home,
      markdown: "One queue for every site, live in November.",
      target: { address, destination: DESTINATION, kind: "update" },
    });

    expect(second.outcome).toEqual({ address, code: EXIT_OK });
    expect(linear.calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
    expect(linear.store.get(address.id)!.content).toBe("One queue for every site, live in November.");
  });

  it("records nothing on a dry run, and sends Linear nothing", async () => {
    const home = tempHome();
    const linear = fakeLinear();

    const { outcome } = await publish({
      api: linear.api,
      dryRun: true,
      home,
      target: { destination: DESTINATION, kind: "create" },
    });

    expect(outcome).toEqual({ address: undefined, code: EXIT_OK });
    expect(linear.calls).toEqual([]);
  });

  it("records nothing when the door refuses, here the identical proposal a second time", async () => {
    const home = tempHome();
    const linear = fakeLinear();
    await publish({ api: linear.api, home, target: { destination: DESTINATION, kind: "create" } });

    const { outcome } = await publish({ api: linear.api, home, target: { destination: DESTINATION, kind: "create" } });

    expect(outcome).toEqual({ address: undefined, code: EXIT_EXPECTED_EMPTY });
    expect(linear.calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
  });

  it("refuses a blank title before calling the door", async () => {
    const home = tempHome();
    const linear = fakeLinear();

    const { outcome, err } = await publish({
      api: linear.api,
      home,
      target: { destination: DESTINATION, kind: "create" },
      title: "  ",
    });

    expect(outcome).toEqual({ address: undefined, code: EXIT_USAGE });
    expect(err).toEqual(['--title "<text>" is required to publish to a linear-document. Nothing was published.']);
    expect(linear.calls).toEqual([]);
  });

  it("refuses a local image before calling the door, naming its line", async () => {
    const home = tempHome();
    const linear = fakeLinear();

    const { outcome, err } = await publish({
      api: linear.api,
      home,
      markdown: "Intro.\n\n![queue](file:queue.png)",
      target: { destination: DESTINATION, kind: "create" },
    });

    expect(outcome).toEqual({ address: undefined, code: EXIT_USAGE });
    expect(err[0]).toContain("line 3: file:queue.png is a file on this machine");
    expect(linear.calls).toEqual([]);
  });
});

describe("linearPublishDestination", () => {
  it("returns the configured Linear target", () => {
    expect(linearPublishDestination({ target: { destination: DESTINATION, kind: "create" } })).toEqual({
      id: PROJECT_ID,
      kind: "project",
    });
  });

  it("throws on a destination that is not a Linear document, a dispatch defect", () => {
    const local: ProposalDestination = { kind: "local-page", schemaVersion: 1 };

    expect(() => linearPublishDestination({ target: { destination: local, kind: "create" } })).toThrow(
      "a local-page destination was dispatched to the Linear door",
    );
  });
});
