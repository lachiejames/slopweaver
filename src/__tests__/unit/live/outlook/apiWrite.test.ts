/**
 * The Outlook seam's writes in `live/outlook/apiWrite.ts`, over a real Graph SDK client whose wire is a scripted
 * fake: the exact method, URL, headers and body each write sends (a send and a reply-creation send NO body, a
 * move and a patch send their JSON), the validated answer, and how a 4xx, a 5xx and an undeclared 2xx answer are
 * told apart (a plain failure versus "it may have happened").
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { PREFER_IMMUTABLE, PREFER_READ } from "../../../../live/outlook/apiCore.js";
import { writeMethods } from "../../../../live/outlook/apiWrite.js";
import { type FakeGraph, fakeGraph } from "./fakeGraph.js";

const MESSAGE_URL = "https://graph.microsoft.com/v1.0/me/messages";

const DRAFT_PAYLOAD = {
  bccRecipients: [],
  body: { content: "Hello.", contentType: "text" },
  ccRecipients: [],
  subject: "Hi",
  toRecipients: [{ emailAddress: { address: "a@example.test" } }],
} as const;

/** The write methods over a fake Graph that answers every request with `status` and `json`. */
function writesOver({ status, json }: { status: number; json: unknown }): {
  readonly methods: ReturnType<typeof writeMethods>;
  readonly graph: FakeGraph;
} {
  const graph = fakeGraph({ answers: [{ json, status }] });
  return { graph, methods: writeMethods({ graph: graph.client, scopeId: "scope-apiwrite-test" }) };
}

describe("writeMethods.createDraft", () => {
  it("POSTs the payload as JSON to /me/messages and answers the created message", async () => {
    const { methods, graph } = writesOver({ json: { id: "draft-1", isDraft: true, subject: "Hi" }, status: 201 });

    const created = unwrap(await methods.createDraft({ payload: DRAFT_PAYLOAD }));

    expect(created).toEqual({ id: "draft-1", isDraft: true, subject: "Hi" });
    expect(graph.seen.length).toBe(1);
    expect(graph.seen[0]!.method).toBe("POST");
    expect(graph.seen[0]!.url).toBe(MESSAGE_URL);
    expect(graph.seen[0]!.headers["prefer"]).toBe(PREFER_READ);
    expect(JSON.parse(String(graph.seen[0]!.body))).toEqual(DRAFT_PAYLOAD);
  });

  it("reads a created message in an undeclared shape as an unknown outcome pointing at Drafts, not a failure", async () => {
    const { methods } = writesOver({ json: { surprise: true }, status: 201 });

    const refused = unwrapErr(await methods.createDraft({ payload: DRAFT_PAYLOAD }));

    expect(refused.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(refused.message).toContain("outlook.drafts.create did not report back cleanly");
    expect(refused.message).toContain("check your Drafts folder before running it again");
  });

  it("reads a 5xx as an unknown outcome and does not replay the create", async () => {
    const { methods, graph } = writesOver({
      json: { error: { code: "ServiceNotAvailable", message: "synthetic outage" } },
      status: 503,
    });

    const refused = unwrapErr(await methods.createDraft({ payload: DRAFT_PAYLOAD }));

    expect(refused.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(graph.seen.length).toBe(1);
  });

  it("reads a 4xx as the plain failure it is, since Graph did not act", async () => {
    const { methods } = writesOver({
      json: { error: { code: "ErrorInvalidRecipients", message: "synthetic bad recipient" } },
      status: 400,
    });

    const refused = unwrapErr(await methods.createDraft({ payload: DRAFT_PAYLOAD }));

    expect(refused.code).toBe("API_FAILED");
  });
});

describe("writeMethods.createReply", () => {
  it("POSTs to the message's createReply with the id percent-encoded and NO body", async () => {
    const { methods, graph } = writesOver({ json: { id: "reply-draft-1", isDraft: true }, status: 201 });

    const reply = unwrap(await methods.createReply({ replyTo: "AAMk/id+1=" }));

    expect(reply).toEqual({ id: "reply-draft-1", isDraft: true });
    expect(graph.seen[0]!.method).toBe("POST");
    expect(graph.seen[0]!.url).toBe(`${MESSAGE_URL}/AAMk%2Fid%2B1%3D/createReply`);
    expect(graph.seen[0]!.body).toBe(undefined);
    expect(graph.seen[0]!.headers["prefer"]).toBe(PREFER_READ);
  });
});

describe("writeMethods.moveMessage", () => {
  it("POSTs the destination folder id as JSON and answers the moved message", async () => {
    const { methods, graph } = writesOver({ json: { id: "msg-1", parentFolderId: "archive-folder" }, status: 201 });

    const moved = unwrap(await methods.moveMessage({ destinationId: "archive-folder", id: "msg-1" }));

    expect(moved).toEqual({ id: "msg-1", parentFolderId: "archive-folder" });
    expect(graph.seen[0]!.method).toBe("POST");
    expect(graph.seen[0]!.url).toBe(`${MESSAGE_URL}/msg-1/move`);
    expect(JSON.parse(String(graph.seen[0]!.body))).toEqual({ destinationId: "archive-folder" });
    expect(graph.seen[0]!.headers["prefer"]).toBe(PREFER_IMMUTABLE);
  });

  it("names the destination folder as where to look when the outcome is unknown", async () => {
    const { methods } = writesOver({ json: { surprise: true }, status: 201 });

    const refused = unwrapErr(await methods.moveMessage({ destinationId: "archive-folder", id: "msg-1" }));

    expect(refused.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(refused.message).toContain("check the destination folder before running it again");
  });
});

describe("writeMethods.patchDraft and patchMessage", () => {
  it("PATCHes a draft's fields as JSON with the body-text preference", async () => {
    const { methods, graph } = writesOver({ json: { id: "draft-1", subject: "New subject" }, status: 200 });

    const patched = unwrap(await methods.patchDraft({ id: "draft-1", payload: { subject: "New subject" } }));

    expect(patched).toEqual({ id: "draft-1", subject: "New subject" });
    expect(graph.seen[0]!.method).toBe("PATCH");
    expect(graph.seen[0]!.url).toBe(`${MESSAGE_URL}/draft-1`);
    expect(JSON.parse(String(graph.seen[0]!.body))).toEqual({ subject: "New subject" });
    expect(graph.seen[0]!.headers["prefer"]).toBe(PREFER_READ);
  });

  it("PATCHes a message's read state and categories as JSON with the immutable-id preference", async () => {
    const { methods, graph } = writesOver({
      json: { categories: ["Waiting on"], id: "msg-1", isRead: true },
      status: 200,
    });

    const patched = unwrap(
      await methods.patchMessage({ id: "msg-1", patch: { categories: ["Waiting on"], isRead: true } }),
    );

    expect(patched).toEqual({ categories: ["Waiting on"], id: "msg-1", isRead: true });
    expect(graph.seen[0]!.method).toBe("PATCH");
    expect(graph.seen[0]!.url).toBe(`${MESSAGE_URL}/msg-1`);
    expect(JSON.parse(String(graph.seen[0]!.body))).toEqual({ categories: ["Waiting on"], isRead: true });
    expect(graph.seen[0]!.headers["prefer"]).toBe(PREFER_IMMUTABLE);
  });

  it("reads a patch answered in an undeclared shape as an unknown outcome pointing at the message", async () => {
    const { methods } = writesOver({ json: { surprise: true }, status: 200 });

    const refused = unwrapErr(await methods.patchMessage({ id: "msg-1", patch: { isRead: true } }));

    expect(refused.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(refused.message).toContain("check the message in Outlook before running it again");
  });
});

describe("writeMethods.sendDraft", () => {
  it("POSTs to the draft's send with NO body and answers nothing on Graph's empty 202", async () => {
    const { methods, graph } = writesOver({ json: undefined, status: 202 });

    const sent = unwrap(await methods.sendDraft({ id: "draft-1" }));

    expect(sent).toBe(undefined);
    expect(graph.seen[0]!.method).toBe("POST");
    expect(graph.seen[0]!.url).toBe(`${MESSAGE_URL}/draft-1/send`);
    expect(graph.seen[0]!.body).toBe(undefined);
    expect(graph.seen[0]!.headers["prefer"]).toBe(PREFER_IMMUTABLE);
  });

  it("reads a body where Graph documents none as an unknown outcome pointing at Sent Items", async () => {
    const { methods } = writesOver({ json: { id: "unexpected" }, status: 202 });

    const refused = unwrapErr(await methods.sendDraft({ id: "draft-1" }));

    expect(refused.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(refused.message).toContain("Graph answered with a body where it documents none");
    expect(refused.message).toContain("check your Sent Items folder before running it again");
  });

  it("reads a 5xx as an unknown outcome and never replays the send", async () => {
    const { methods, graph } = writesOver({
      json: { error: { code: "ServiceNotAvailable", message: "synthetic outage" } },
      status: 503,
    });

    const refused = unwrapErr(await methods.sendDraft({ id: "draft-1" }));

    expect(refused.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(graph.seen.length).toBe(1);
  });

  it("reads a 404 as the plain failure, since the draft was not there to send", async () => {
    const { methods } = writesOver({
      json: { error: { code: "ErrorItemNotFound", message: "synthetic not found" } },
      status: 404,
    });

    const refused = unwrapErr(await methods.sendDraft({ id: "draft-1" }));

    expect(refused.code).toBe("API_FAILED");
  });
});
