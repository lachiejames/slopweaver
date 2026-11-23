/**
 * The reader is exercised through an INJECTED fake, which is a plain function rather than a mock: the seam
 * takes a `NotionMarkdownReader`, so a test supplies one that answers from a map. Nothing is stubbed and
 * `vi.fn` is never reached for.
 *
 * Every fixture is synthetic. Real bodies from the workspace carry customer and staff member names.
 */
import { describe, expect, it } from "vitest";

import { createNotionItemBudget } from "../../../../corpus/notion/itemCrawl.js";
import {
  type CanonicalNotionMarkdown,
  type NotionMarkdownReader,
  notionIdFromUrl,
  renderMarkdownBody,
} from "../../../../corpus/notion/liveMarkdown.js";
import type { IngestError } from "../../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../../lib/result.js";

/** A reader that answers from a map, and records the order it was asked in. */
const readerOver = ({
  bodies,
  asked,
  failing = new Set<string>(),
}: {
  bodies: Readonly<Record<string, Partial<CanonicalNotionMarkdown> & { markdown: string }>>;
  asked: string[];
  failing?: ReadonlySet<string>;
}): NotionMarkdownReader => ({
  retrieveMarkdown: ({ id }): Promise<Result<CanonicalNotionMarkdown, IngestError>> => {
    asked.push(id);
    if (failing.has(id)) {
      // A literal rather than a factory call, because `IngestError` has no factory: `toIngestError` builds
      // one from a THROWN value, and there is nothing thrown here to build from. 404 classifies as
      // `unshared`, which is the non-fatal arm this test needs.
      return Promise.resolve(
        err({
          kind: "http",
          message: "object_not_found",
          operation: "notion.pages.retrieveMarkdown",
          provider: "notion",
          status: 404,
        } satisfies IngestError),
      );
    }
    const body = bodies[id];
    if (body === undefined) {
      return Promise.resolve(ok({ markdown: "", truncated: false, unknownBlockIds: [] }));
    }
    return Promise.resolve(ok({ truncated: false, unknownBlockIds: [], ...body }));
  },
});

const BUDGET = (): ReturnType<typeof createNotionItemBudget> => createNotionItemBudget({ maxCalls: 50 });
/** Ids as the API spells them: dashed. A url spells them undashed, through {@link bare}. */
const ID_A = "a0000006-0000-4000-8000-000000000006";
const ID_B = "22222222-2222-2222-2222-222222222222";
const ID_C = "33333333-3333-3333-3333-333333333333";
const bare = ({ id }: { id: string }): string => id.replaceAll("-", "");

describe("notionIdFromUrl", () => {
  it("reads an undashed id off a titled page url as the DASHED id the API and bronze key on", () => {
    expect(notionIdFromUrl({ url: `https://www.notion.so/Some-Page-${bare({ id: ID_A })}` })).toBe(ID_A);
  });

  it("reads a dashed id unchanged", () => {
    expect(notionIdFromUrl({ url: `https://notion.so/${ID_A}` })).toBe(ID_A);
  });

  it("lowercases an uppercase id, so one page never has two spellings", () => {
    expect(notionIdFromUrl({ url: "https://notion.so/Page-0123456789ABCDEF0123456789ABCDEF" })).toBe(
      "01234567-89ab-cdef-0123-456789abcdef",
    );
  });

  it("returns undefined when the url carries no id", () => {
    expect(notionIdFromUrl({ url: "https://example.com/not-notion" })).toBeUndefined();
  });
});

describe("renderMarkdownBody", () => {
  it("reads a body in ONE request and reports no skip", async () => {
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: BUDGET(),
      pageId: ID_A,
      reader: readerOver({ asked, bodies: { [ID_A]: { markdown: "## Plan\n\nship it" } } }),
    });
    expect(asked).toEqual([ID_A]);
    expect(body.text).toBe("## Plan\n\nship it");
    expect(body.skips).toEqual([]);
    expect(body.childPageIds).toEqual([]);
  });

  it("RETURNS a child page rather than fetching it", async () => {
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: BUDGET(),
      pageId: ID_A,
      reader: readerOver({
        asked,
        bodies: {
          [ID_A]: { markdown: `intro <page url="https://notion.so/Child-${bare({ id: ID_B })}">Child</page>` },
          [ID_B]: { markdown: "the child body that must NOT be inlined" },
        },
      }),
    });
    expect(asked).toEqual([ID_A]);
    expect(body.childPageIds).toEqual([ID_B]);
    expect(body.text).not.toContain("must NOT be inlined");
  });

  it("recovers an unknown block through the same endpoint and keeps its text", async () => {
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: BUDGET(),
      pageId: ID_A,
      reader: readerOver({
        asked,
        bodies: {
          [ID_A]: {
            markdown: `top <unknown url="https://notion.so/${bare({ id: ID_C })}" alt="bookmark"/>`,
            truncated: true,
          },
          [ID_C]: { markdown: "the recovered subtree" },
        },
      }),
    });
    expect(asked).toEqual([ID_A, ID_C]);
    expect(body.text).toContain("the recovered subtree");
    expect(body.skips).toEqual([]);
  });

  it("records a skip when an unknown block cannot be read", async () => {
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: BUDGET(),
      pageId: ID_A,
      reader: readerOver({
        asked,
        bodies: { [ID_A]: { markdown: `<unknown url="https://notion.so/${bare({ id: ID_C })}"/>` } },
        failing: new Set([ID_C]),
      }),
    });
    expect(asked).toEqual([ID_A, ID_C]);
    expect(body.skips.length).toBe(1);
    expect(body.skips[0]?.subject).toBe("unknown block");
  });

  it("stops recovering once the item budget is spent, and says so", async () => {
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: createNotionItemBudget({ maxCalls: 1 }),
      pageId: ID_A,
      reader: readerOver({
        asked,
        bodies: {
          [ID_A]: { markdown: `<unknown url="https://notion.so/${bare({ id: ID_C })}"/>` },
          [ID_C]: { markdown: "late" },
        },
      }),
    });
    expect(asked).toEqual([ID_A]);
    expect(body.skips.length).toBe(1);
    expect(body.skips[0]?.reason).toBe("item-deadline");
  });

  it("marks a truncated body incomplete even when Notion names nothing to fetch", async () => {
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: BUDGET(),
      pageId: ID_A,
      reader: readerOver({ asked, bodies: { [ID_A]: { markdown: "half a page", truncated: true } } }),
    });
    expect(body.skips.length).toBe(1);
    expect(body.skips[0]?.reason).toBe("result-limit");
    expect(body.skips[0]?.subject).toBe("page body");
  });

  it("marks a body that inlines a database as borrowing content", async () => {
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: BUDGET(),
      pageId: ID_A,
      reader: readerOver({
        asked,
        bodies: {
          [ID_A]: {
            markdown: `<database url="https://notion.so/${bare({ id: ID_B })}" inline="true">Risks</database>`,
          },
        },
      }),
    });
    expect(body.borrowsContent).toBe(true);
  });

  it("returns an empty body and one skip when the page itself cannot be read", async () => {
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: BUDGET(),
      pageId: ID_A,
      reader: readerOver({ asked, bodies: {}, failing: new Set([ID_A]) }),
    });
    expect(body.text).toBe("");
    expect(body.skips.length).toBe(1);
    expect(body.skips[0]?.subject).toBe("page body");
    // The field that separates this from a genuinely blank page — every OTHER field is identical between
    // the two, so a caller storing the tree would otherwise record "read, and empty" about an unread page.
    expect(body.bodyUnread).toBe(true);
    expect(body.tree).toEqual([]);
  });

  it("calls a genuinely blank page READ, so its empty tree is a fact rather than a failure", async () => {
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: BUDGET(),
      pageId: ID_A,
      reader: readerOver({ asked, bodies: { [ID_A]: { markdown: "" } } }),
    });
    expect(body.bodyUnread).toBe(false);
    expect(body.tree).toEqual([]);
    expect(body.skips).toEqual([]);
  });

  it("keeps a body read successfully marked as read after recovering an unknown block", async () => {
    // The fold must carry the flag rather than recompute it: a recovery pass that failed must not turn a
    // body that WAS read into one reported unread.
    const asked: string[] = [];
    const body = await renderMarkdownBody({
      itemBudget: BUDGET(),
      pageId: ID_A,
      reader: readerOver({
        asked,
        bodies: { [ID_A]: { markdown: `<unknown url="https://notion.so/${bare({ id: ID_C })}" />` } },
        failing: new Set([ID_C]),
      }),
    });
    expect(body.bodyUnread).toBe(false);
    expect(body.skips.length).toBe(1);
    expect(body.skips[0]?.subject).toBe("unknown block");
  });
});
