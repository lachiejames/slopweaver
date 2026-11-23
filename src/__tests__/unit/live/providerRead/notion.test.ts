/*
 * `parseNotionReadAddress` and `readNotionObject`: which Notion links yield an object id, how a page read
 * expands nested blocks beside its raw slice, and when a nested file is opened, over a plain fake API seam.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "#lib/result.js";

import { NotionLiveErrors } from "../../../../live/notion/errors.js";
import { type NotionReadApi, parseNotionReadAddress, readNotionObject } from "../../../../live/notion/read.js";
import { NOW } from "./fixtures.js";

/** A Notion page read's nested bounds: the default call ceiling and a clock that never moves. */
const NESTED = { maxCalls: 400, nowMs: (): number => 0 };

describe("Notion named-object reads", () => {
  const id = "12345678-1234-1234-1234-1234567890ab";

  it("extracts the object id from a Notion page URL", () => {
    expect(
      unwrap(
        parseNotionReadAddress({
          address: "https://www.notion.so/Workspace-123456781234123412341234567890ab",
          kind: "page",
        }),
      ),
    ).toEqual({
      address: "https://www.notion.so/Workspace-123456781234123412341234567890ab",
      id,
      identity: id,
      kind: "page",
    });
    expect(
      unwrap(
        parseNotionReadAddress({
          address: "Read https://www.notion.so/Workspace-123456781234123412341234567890ab now",
          kind: "page",
        }),
      ).address,
    ).toBe("https://www.notion.so/Workspace-123456781234123412341234567890ab");
    expect(
      unwrap(
        parseNotionReadAddress({
          address: "Read https://app.notion.com/p/Workspace-123456781234123412341234567890ab now",
          kind: "page",
        }),
      ),
    ).toEqual({
      address: "https://app.notion.com/p/Workspace-123456781234123412341234567890ab",
      id,
      identity: id,
      kind: "page",
    });
    expect(
      unwrapErr(
        parseNotionReadAddress({
          address: "https://evilapp.notion.com/p/Workspace-123456781234123412341234567890ab",
          kind: "page",
        }),
      ),
    ).toEqual(
      NotionLiveErrors.invalidAddress({
        message:
          "Notion read needs a bare object UUID or a full https://*.notion.so/...<32-hex-id> or https://app.notion.com/...<32-hex-id> URL",
      }),
    );
  });

  it("expands a toggle's children into the tree and keeps the raw top-level slice untouched", async () => {
    const toggle = { has_children: true, id: "t1", type: "toggle" };
    const inside = { has_children: false, id: "p1", type: "paragraph" };
    const result = await readNotionObject({
      address: id,
      after: undefined,
      api: {
        listBlockChildren: ({ id: listed }) =>
          Promise.resolve(
            listed === "t1"
              ? ok({ hasMore: false, nextCursor: undefined, results: [inside] })
              : ok({ hasMore: true, nextCursor: "next", results: [toggle] }),
          ),
        retrieveDatabase: () => Promise.resolve(ok({ object: "database" })),
        retrievePage: () => Promise.resolve(ok({ id, object: "page" })),
      },
      kind: "page",
      limit: 25,
      nested: NESTED,
      nowIso: () => NOW,
    });
    const document = unwrap(result);

    expect(document.coverage).toEqual({
      detail:
        "one page object and its first top-level block page, every block nested beneath it expanded; " +
        "child pages and databases are named, not read",
      kind: "bounded",
      residue: [
        "only the page object and first 25 top-level blocks were requested",
        "more top-level blocks remain: read the next slice with --after next",
      ],
    });
    expect(document.data).toEqual({
      blockTree: [
        { block: toggle, children: [{ block: inside, children: [], expansion: "leaf" }], expansion: "complete" },
      ],
      blocks: { hasMore: true, nextCursor: "next", results: [toggle] },
      nested: { calls: 1, callLimit: 400, complete: true, linkedObjects: [], stoppedBy: null, unexpanded: [] },
      page: { id, object: "page" },
    });
  });

  it("reads database metadata without traversing blocks or rows", async () => {
    let blockReads = 0;
    const result = await readNotionObject({
      address: id,
      after: undefined,
      api: {
        listBlockChildren: () => {
          blockReads += 1;
          return Promise.resolve(ok({ hasMore: false, nextCursor: undefined, results: [] }));
        },
        retrieveDatabase: () => Promise.resolve(ok({ id, object: "database" })),
        retrievePage: () => Promise.resolve(ok({ id, object: "page" })),
      },
      kind: "database",
      limit: 25,
      nested: NESTED,
      nowIso: () => NOW,
    });

    expect(blockReads).toBe(0);
    expect(unwrap(result).coverage.residue).toEqual([
      "database rows, linked pages and data-source contents were not requested",
    ]);
  });

  it("opens a file nested inside a toggle only when asked, and says so in the same residue", async () => {
    const hosted = "https://prod-files-secure.s3.us-west-2.amazonaws.com/ff0ccd01/report.pdf?X-Amz-Signature=abc";
    const api: NotionReadApi = {
      listBlockChildren: ({ id: listed }) =>
        Promise.resolve(
          ok({
            hasMore: false,
            nextCursor: undefined,
            results:
              listed === "t1"
                ? [{ pdf: { file: { url: hosted } }, type: "pdf" }]
                : [{ has_children: true, id: "t1", type: "toggle" }],
          }),
        ),
      retrieveDatabase: () => Promise.resolve(ok({ object: "database" })),
      retrievePage: () => Promise.resolve(ok({ id, object: "page" })),
    };
    const withoutAssets = await readNotionObject({
      address: id,
      after: undefined,
      api,
      kind: "page",
      limit: 25,
      nested: NESTED,
      nowIso: () => NOW,
    });
    expect(unwrap(withoutAssets).attachments).toBe(undefined);
    expect(unwrap(withoutAssets).coverage.residue).toEqual([
      "only the page object and first 25 top-level blocks were requested",
    ]);

    const withAssets = await readNotionObject({
      address: id,
      after: undefined,
      api,
      assets: {
        scopeId: "notion:test",
        transport: () => Promise.resolve({ contentRange: null, contentType: null, ok: false, status: 403 }),
      },
      kind: "page",
      limit: 25,
      nested: NESTED,
      nowIso: () => NOW,
    });
    expect(unwrap(withAssets).attachments).toEqual([
      { outcome: "unfetched", reason: "ranged probe returned 403", url: hosted },
    ]);
    expect(unwrap(withAssets).coverage.residue).toEqual([
      "only the page object and first 25 top-level blocks were requested",
      "files were opened from the page's own properties and every block this slice returned, nested ones included",
      `${hosted}: not fetched — ranged probe returned 403`,
    ]);
  });
});
