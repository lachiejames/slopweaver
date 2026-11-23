/**
 * The settings apply's label reads and create, through a real Octokit over a recording fake transport: the list
 * read walks pages until a short one and refuses a list past its ceiling rather than answering with what it saw;
 * a 404 on one label is "no such label"; and a create sends the label once, with no description field for none.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  createRepoLabelVia,
  getRepoLabelVia,
  listRepoLabelsVia,
} from "../../../../corpus/github/repoManifestLabels.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  always,
  type FakeAnswer,
  recordingFetch,
  recordingScopeId,
  type SentRequest,
} from "../../../githubRecordingCtx.js";

const INPUT = { owner: "acme", repo: "widget" };

/** A write context over a real Octokit, built in this test file, whose fake transport records every request. */
function recordingCtx(fake: { sent: SentRequest[]; respond: (request: SentRequest) => FakeAnswer }): WriteCtx {
  return {
    client: new Octokit({ auth: "test-token", request: { fetch: recordingFetch(fake) } }),
    scopeId: recordingScopeId(),
  };
}

/** A full page of `count` labels named by their page and index. */
function labelPage({ page, count }: { page: string; count: number }): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    color: "ededed",
    description: null,
    name: `${page}-${String(index)}`,
  }));
}

describe("listRepoLabelsVia", () => {
  it("reads a single short page as the whole list, keeping colour and description", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      respond: always({
        data: [
          { color: "d73a4a", description: "Something isn't working", id: 1, name: "bug" },
          { color: "0e8a16", description: null, id: 2, name: "ready" },
        ],
        status: 200,
      }),
      sent,
    });

    expect(unwrap(await listRepoLabelsVia({ ctx, input: INPUT }))).toStrictEqual([
      { color: "d73a4a", description: "Something isn't working", name: "bug" },
      { color: "0e8a16", description: null, name: "ready" },
    ]);
    expect(sent.map((request) => request.url)).toStrictEqual([
      "https://api.github.com/repos/acme/widget/labels?page=1&per_page=100",
    ]);
  });

  it("reads on past a full page and stops at the first short one", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      respond: (request) =>
        request.url.includes("page=1&")
          ? { data: labelPage({ count: 100, page: "one" }), status: 200 }
          : { data: labelPage({ count: 2, page: "two" }), status: 200 },
      sent,
    });

    const labels = unwrap(await listRepoLabelsVia({ ctx, input: INPUT }));

    expect(labels.length).toBe(102);
    expect(labels.at(-1)!.name).toBe("two-1");
    expect(sent.length).toBe(2);
  });

  it("refuses a repository with more labels than the read ceiling rather than answering with a partial list", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: labelPage({ count: 100, page: "p" }), status: 200 }), sent });

    const error = unwrapErr(await listRepoLabelsVia({ ctx, input: INPUT }));

    expect(error.message).toContain("acme/widget defines more than 500 labels, so whether a label exists is unknown");
    expect(sent.length).toBe(5);
  });
});

describe("getRepoLabelVia", () => {
  it("reads one label by name", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({
      respond: always({ data: { color: "0e8a16", description: "Ready to land", id: 2, name: "ready" }, status: 200 }),
      sent,
    });

    expect(unwrap(await getRepoLabelVia({ ctx, input: { ...INPUT, name: "ready" } }))).toStrictEqual({
      color: "0e8a16",
      description: "Ready to land",
      name: "ready",
    });
    expect(sent.map((request) => request.url)).toStrictEqual(["https://api.github.com/repos/acme/widget/labels/ready"]);
  });

  it("answers a 404 as no such label", async () => {
    const ctx = recordingCtx({ respond: always({ data: { message: "Not Found" }, status: 404 }), sent: [] });

    expect(unwrap(await getRepoLabelVia({ ctx, input: { ...INPUT, name: "absent" } }))).toBe(undefined);
  });

  it("carries any other refusal as an error", async () => {
    const ctx = recordingCtx({ respond: always({ data: { message: "Forbidden" }, status: 403 }), sent: [] });

    expect(unwrapErr(await getRepoLabelVia({ ctx, input: { ...INPUT, name: "ready" } })).status).toBe(403);
  });
});

describe("createRepoLabelVia", () => {
  it("sends the name, colour and description once", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: { id: 3 }, status: 201 }), sent });
    const label = { color: "0e8a16", description: "Ready to land", name: "ready" };

    unwrap(await createRepoLabelVia({ ctx, input: { ...INPUT, label } }));

    expect(sent).toStrictEqual([
      {
        body: { color: "0e8a16", description: "Ready to land", name: "ready" },
        method: "POST",
        url: "https://api.github.com/repos/acme/widget/labels",
      },
    ]);
  });

  it("sends no description field for a label with none", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: { id: 3 }, status: 201 }), sent });

    unwrap(
      await createRepoLabelVia({ ctx, input: { ...INPUT, label: { color: "ededed", description: null, name: "x" } } }),
    );

    expect(sent.map((request) => request.body)).toStrictEqual([{ color: "ededed", name: "x" }]);
  });

  it("is sent once even when GitHub refuses it", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: { message: "Validation Failed" }, status: 422 }), sent });

    const error = unwrapErr(
      await createRepoLabelVia({ ctx, input: { ...INPUT, label: { color: "ededed", description: null, name: "x" } } }),
    );

    expect(error.status).toBe(422);
    expect(sent.length).toBe(1);
  });
});
