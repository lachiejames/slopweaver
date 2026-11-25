/**
 * The assembled Outlook seam in `live/outlook/api.ts`, over a real Graph SDK client whose wire is a scripted fake:
 * `makeOutlookApi` exposes every method of the `OutlookApi` contract (read, paged and write sets together), and a
 * call through it reaches the Graph endpoint that method names with the immutable-id preference.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { makeOutlookApi } from "../../../../live/outlook/api.js";
import { PREFER_IMMUTABLE } from "../../../../live/outlook/apiCore.js";
import { fakeGraph } from "./fakeGraph.js";

describe("makeOutlookApi", () => {
  it("exposes every method of the seam", () => {
    const { client } = fakeGraph({ answers: [{ json: {}, status: 200 }] });

    const api = makeOutlookApi({ graph: client, rateScopeKey: "owner@example.test" });

    expect(Object.keys(api).toSorted()).toEqual([
      "attachmentBytes",
      "conversation",
      "createDraft",
      "createReply",
      "getDraft",
      "getFolder",
      "getMessage",
      "listAttachments",
      "listCategories",
      "listFolders",
      "listMessages",
      "me",
      "messageDelta",
      "moveMessage",
      "patchDraft",
      "patchMessage",
      "searchMessages",
      "sendDraft",
    ]);
  });

  it("reads the bound identity from GET /me, selecting only the identity fields", async () => {
    const graph = fakeGraph({
      answers: [{ json: { id: "user-1", mail: null, userPrincipalName: "owner@example.test" }, status: 200 }],
    });
    const api = makeOutlookApi({ graph: graph.client, rateScopeKey: "owner@example.test" });

    const me = unwrap(await api.me());

    expect(me).toEqual({ id: "user-1", mail: null, userPrincipalName: "owner@example.test" });
    expect(graph.seen[0]!.method).toBe("GET");
    expect(graph.seen[0]!.url).toBe(
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    );
    expect(graph.seen[0]!.headers["prefer"]).toBe(PREFER_IMMUTABLE);
  });

  it("sends a write through the same assembled seam", async () => {
    const graph = fakeGraph({ answers: [{ json: undefined, status: 202 }] });
    const api = makeOutlookApi({ graph: graph.client, rateScopeKey: "owner@example.test" });

    unwrap(await api.sendDraft({ id: "draft-1" }));

    expect(graph.seen.map((request) => `${String(request.method)} ${request.url}`)).toEqual([
      "POST https://graph.microsoft.com/v1.0/me/messages/draft-1/send",
    ]);
  });
});
