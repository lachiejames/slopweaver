/**
 * `productionDestinationLastEdited` — each provider's last-edit clock, read through plain injected client
 * factories (Notion, Linear) or a plain injected store clock (local). Nothing is a mock and nothing reaches the
 * network. The store's own `fileExists` and `latestFrozen` are proven against the real stack in
 * `src/__tests__/integration/publishedPagesRead.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type LinearDocumentReader,
  type NotionPageReader,
  productionDestinationLastEdited,
} from "../../../../../cli/commands/proposal/driftFreshness.js";
import type { ReadLinearDocument } from "../../../../../corpus/linear/writeDocument.js";
import type { WrittenPage } from "../../../../../corpus/notion/writeApi.js";
import type { IngestError } from "../../../../../lib/ingestError.js";
import { err, errAsync, ok, okAsync, type Result } from "../../../../../lib/result.js";
import type { ProposalAddress } from "../../../../../outbound/proposal/address.js";
import type { PageClock, ReadPageClock } from "../../../../../pages/published.js";
import { PAGE_FILENAME, PAGES_DIRECTORY } from "../../../../../pages/url.js";
import {
  type PublishedPagesReadError,
  PublishedPagesReadErrors,
} from "../../../../../store/publishedPages/readErrors.js";

/** Every token variable `config.ts` reads before the secrets file, cleared so the home's file is the only source. */
const TOKEN_ENV = ["LINEAR_API_KEY", "LINEAR_TOKEN", "NOTION_TOKEN", "NOTION_API_KEY"] as const;

const fixtureDirs: string[] = [];
let savedEnv: Map<string, string | undefined> = new Map();

beforeEach(() => {
  savedEnv = new Map(TOKEN_ENV.map((name) => [name, process.env[name]]));
  for (const name of TOKEN_ENV) {
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A temp home holding the named tokens as owner-only secret files. */
function homeWith({ tokens }: { tokens: Readonly<Record<string, string>> }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-drift-freshness-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "secrets"), { mode: 0o700 });
  for (const [name, value] of Object.entries(tokens)) {
    writeFileSync(join(home, "secrets", name), value, { mode: 0o600 });
  }
  return home;
}

const NOTION_PAGE: WrittenPage = {
  archived: false,
  id: "page-1",
  lastEditedBy: undefined,
  lastEditedTime: "2026-07-07T05:07:00.000Z",
  parent: undefined,
  url: "https://example.test/page-1",
};

const LINEAR_DOCUMENT: ReadLinearDocument = {
  content: undefined,
  id: "doc-1",
  initiativeId: undefined,
  issueId: undefined,
  projectId: undefined,
  slugId: "abc123",
  title: "A proposal",
  updatedAt: "2026-07-09T01:02:03.000Z",
  url: "https://example.test/doc-1",
};

/** A Notion factory that counts how many clients it built and answers from one table. */
function notionFactory({ pages }: { pages: Readonly<Record<string, WrittenPage>> }): {
  make: (args: { token: string }) => NotionPageReader;
  built: string[];
} {
  const built: string[] = [];
  return {
    built,
    make: ({ token }) => {
      built.push(token);
      return { retrievePage: ({ pageId }) => Promise.resolve(ok(pages[pageId])) };
    },
  };
}

/** A Linear factory that counts how many clients it built and answers from one table. */
function linearFactory({ documents }: { documents: Readonly<Record<string, ReadLinearDocument>> }): {
  make: (args: { token: string }) => LinearDocumentReader;
  built: string[];
} {
  const built: string[] = [];
  return {
    built,
    make: ({ token }) => {
      built.push(token);
      return { readDocument: ({ id }) => okAsync(documents[id]) };
    },
  };
}

const notionAddress = ({ id }: { id: string }): ProposalAddress => ({ id, provider: "notion" });
const linearAddress = ({ id }: { id: string }): ProposalAddress => ({ id, provider: "linear" });

describe("productionDestinationLastEdited over Notion", () => {
  it("reads a page's last_edited_time, building one client for the whole scan", async () => {
    const home = homeWith({ tokens: { "notion-token": "notion-fixture" } });
    const notion = notionFactory({ pages: { "page-1": NOTION_PAGE } });
    const read = productionDestinationLastEdited({ makeNotionApi: notion.make });

    const first = await read({ address: notionAddress({ id: "page-1" }), home });
    const second = await read({ address: notionAddress({ id: "page-gone" }), home });

    expect(first).toEqual({ lastEditedIso: "2026-07-07T05:07:00.000Z" });
    expect(second).toEqual({ why: "Notion has no page page-gone (deleted, or the integration cannot see it)" });
    expect(notion.built).toEqual(["notion-fixture"]);
  });

  it("builds a second client for a second home's token rather than answering through the first", async () => {
    const homeA = homeWith({ tokens: { "notion-token": "token-a" } });
    const homeB = homeWith({ tokens: { "notion-token": "token-b" } });
    const notion = notionFactory({ pages: { "page-1": NOTION_PAGE } });
    const read = productionDestinationLastEdited({ makeNotionApi: notion.make });

    await read({ address: notionAddress({ id: "page-1" }), home: homeA });
    await read({ address: notionAddress({ id: "page-1" }), home: homeB });
    await read({ address: notionAddress({ id: "page-1" }), home: homeA });

    expect(notion.built).toEqual(["token-a", "token-b"]);
  });

  it("builds a Notion client per HOME even when two homes share a token, so neither's policy judges the other", async () => {
    const homeA = homeWith({ tokens: { "notion-token": "shared-token" } });
    const homeB = homeWith({ tokens: { "notion-token": "shared-token" } });
    const builtFor: string[] = [];
    const read = productionDestinationLastEdited({
      makeNotionApi: ({ home }) => {
        builtFor.push(home);
        return { retrievePage: () => Promise.resolve(ok(NOTION_PAGE)) };
      },
    });

    await read({ address: notionAddress({ id: "page-1" }), home: homeA });
    await read({ address: notionAddress({ id: "page-1" }), home: homeB });
    await read({ address: notionAddress({ id: "page-1" }), home: homeA });

    expect(builtFor).toEqual([homeA, homeB]);
  });

  it("names a trashed page as gone, never as last edited at its final edit", async () => {
    const home = homeWith({ tokens: { "notion-token": "notion-fixture" } });
    const notion = notionFactory({ pages: { "page-1": { ...NOTION_PAGE, archived: true } } });
    const read = productionDestinationLastEdited({ makeNotionApi: notion.make });

    const result = await read({ address: notionAddress({ id: "page-1" }), home });

    expect(result).toEqual({ why: "Notion page page-1 is archived or in the trash" });
  });

  it("names a read that rejects rather than letting it end the scan", async () => {
    const home = homeWith({ tokens: { "notion-token": "notion-fixture" } });
    const read = productionDestinationLastEdited({
      makeNotionApi: () => ({ retrievePage: () => Promise.reject(new Error("socket reset")) }),
    });

    const result = await read({ address: notionAddress({ id: "page-1" }), home });

    expect(result).toEqual({ why: "notion page-1 could not be read (socket reset)" });
  });

  it("still resolves when the rejection is a value that cannot be printed", async () => {
    const home = homeWith({ tokens: { "notion-token": "notion-fixture" } });
    const read = productionDestinationLastEdited({
      // oxlint-disable-next-line prefer-promise-reject-errors -- the case under test IS a non-Error rejection
      makeNotionApi: () => ({ retrievePage: () => Promise.reject(Object.create(null) as unknown) }),
    });

    const result = await read({ address: notionAddress({ id: "page-1" }), home });

    expect(result).toEqual({ why: "notion page-1 could not be read ([object Object])" });
  });

  it("names the missing token rather than building a client", async () => {
    const notion = notionFactory({ pages: {} });
    const read = productionDestinationLastEdited({ makeNotionApi: notion.make });

    const result = await read({ address: notionAddress({ id: "page-1" }), home: homeWith({ tokens: {} }) });

    expect(result).toEqual({ why: "no Notion token configured; run `slopweaver connect notion`" });
    expect(notion.built).toEqual([]);
  });
});

const UPSTREAM_FAILURE: IngestError = {
  kind: "http",
  message: "HTTP 500: upstream",
  operation: "linear.document.readBack",
};

describe("productionDestinationLastEdited over Linear", () => {
  it("reads a document's updatedAt, building one client for the whole scan", async () => {
    const home = homeWith({ tokens: { "linear-token": "linear-fixture" } });
    const linear = linearFactory({ documents: { "doc-1": LINEAR_DOCUMENT } });
    const read = productionDestinationLastEdited({ makeLinearApi: linear.make });

    const first = await read({ address: linearAddress({ id: "doc-1" }), home });
    const second = await read({ address: linearAddress({ id: "doc-gone" }), home });

    expect(first).toEqual({ lastEditedIso: "2026-07-09T01:02:03.000Z" });
    expect(second).toEqual({ why: "Linear has no document doc-gone (deleted, or the token cannot see it)" });
    expect(linear.built).toEqual(["linear-fixture"]);
  });

  it("names the missing token rather than building a client", async () => {
    const linear = linearFactory({ documents: {} });
    const read = productionDestinationLastEdited({ makeLinearApi: linear.make });

    const result = await read({ address: linearAddress({ id: "doc-1" }), home: homeWith({ tokens: {} }) });

    expect(result).toEqual({ why: "no Linear token configured; run `slopweaver connect linear`" });
    expect(linear.built).toEqual([]);
  });

  it("carries a failed read's message as the reason", async () => {
    const home = homeWith({ tokens: { "linear-token": "linear-fixture" } });
    const read = productionDestinationLastEdited({
      makeLinearApi: () => ({
        readDocument: () => errAsync(UPSTREAM_FAILURE),
      }),
    });

    expect(await read({ address: linearAddress({ id: "doc-1" }), home })).toEqual({ why: "HTTP 500: upstream" });
  });
});

describe("productionDestinationLastEdited over a local page", () => {
  /** The URL `page publish` answers with for `slug` under `home`; the store, not this path, holds the page. */
  function pageUrl({ home, slug = "a-proposal" }: { home: string; slug?: string }): string {
    return pathToFileURL(join(home, PAGES_DIRECTORY, slug, PAGE_FILENAME)).href;
  }

  /** A store clock answering one fixed reply, recording every home and slug it was asked about. */
  function storeClock({ reply }: { reply: Result<PageClock, PublishedPagesReadError> }): {
    readPageClock: ReadPageClock;
    asked: string[];
  } {
    const asked: string[] = [];
    return {
      asked,
      readPageClock: async ({ home, slug }) => {
        asked.push(`${home}:${slug}`);
        return reply;
      },
    };
  }

  const FROZEN = ok<PageClock>({ frozenAt: new Date("2026-07-05T00:00:00.000Z"), published: true });

  it("reads the newest freeze's instant from the store, asking by the slug the publish recorded", async () => {
    const home = homeWith({ tokens: {} });
    const clock = storeClock({ reply: FROZEN });
    const read = productionDestinationLastEdited({ readPageClock: clock.readPageClock });

    const result = await read({ address: { id: "a-proposal", provider: "local", url: pageUrl({ home }) }, home });

    expect(result).toEqual({ lastEditedIso: "2026-07-05T00:00:00.000Z" });
    expect(clock.asked).toEqual([`${home}:a-proposal`]);
  });

  it("names a page the store no longer publishes as gone, never as last edited at its final freeze", async () => {
    const home = homeWith({ tokens: {} });
    const read = productionDestinationLastEdited({
      readPageClock: storeClock({ reply: ok({ published: false }) }).readPageClock,
    });

    const result = await read({ address: { id: "a-proposal", provider: "local", url: pageUrl({ home }) }, home });

    expect(result).toEqual({ why: "local page a-proposal is no longer published in the store" });
  });

  it("names a store it cannot read as unassessable, carrying the store's own reason", async () => {
    const home = homeWith({ tokens: {} });
    const read = productionDestinationLastEdited({
      readPageClock: storeClock({
        reply: err(
          PublishedPagesReadErrors.unavailable({ cause: new Error("connection refused"), doing: "be opened" }),
        ),
      }).readPageClock,
    });

    const result = await read({ address: { id: "a-proposal", provider: "local", url: pageUrl({ home }) }, home });

    expect(result).toEqual({
      why: "local page a-proposal could not be read from the store: the published-page store did not be opened: connection refused",
    });
  });

  it("refuses a local address whose URL names a different page, never asking the store", async () => {
    const home = homeWith({ tokens: {} });
    const url = pageUrl({ home });
    const clock = storeClock({ reply: FROZEN });
    const read = productionDestinationLastEdited({ readPageClock: clock.readPageClock });

    const result = await read({ address: { id: "another-proposal", provider: "local", url }, home });

    expect(result).toEqual({ why: `local page another-proposal was recorded at ${url}, which names page a-proposal` });
    expect(clock.asked).toEqual([]);
  });

  it("refuses a page published under another home, rather than reading this home's same-slug freeze", async () => {
    const url = pageUrl({ home: homeWith({ tokens: {} }) });
    const home = homeWith({ tokens: {} });
    const clock = storeClock({ reply: FROZEN });
    const read = productionDestinationLastEdited({ readPageClock: clock.readPageClock });

    const result = await read({ address: { id: "a-proposal", provider: "local", url }, home });

    expect(result).toEqual({
      why: `local page a-proposal is at ${fileURLToPath(url)}, not ${fileURLToPath(pageUrl({ home }))} where this home publishes it, so its freezes are not here`,
    });
    expect(clock.asked).toEqual([]);
  });

  it("refuses a nested look-alike under this home's pages, rather than reading the real page's freeze", async () => {
    const home = homeWith({ tokens: {} });
    const decoy = pageUrl({ home: join(home, PAGES_DIRECTORY, "decoy") });
    const clock = storeClock({ reply: FROZEN });
    const read = productionDestinationLastEdited({ readPageClock: clock.readPageClock });

    const result = await read({ address: { id: "a-proposal", provider: "local", url: decoy }, home });

    expect(result).toEqual({
      why: `local page a-proposal is at ${fileURLToPath(decoy)}, not ${fileURLToPath(pageUrl({ home }))} where this home publishes it, so its freezes are not here`,
    });
    expect(clock.asked).toEqual([]);
  });

  it("refuses a local address whose URL is not a local page", async () => {
    const clock = storeClock({ reply: FROZEN });
    const read = productionDestinationLastEdited({ readPageClock: clock.readPageClock });
    const url = "https://example.test/a-proposal";

    const result = await read({
      address: { id: "a-proposal", provider: "local", url },
      home: homeWith({ tokens: {} }),
    });

    expect(result).toEqual({ why: `local page a-proposal was recorded at ${url}, which is not a local page address` });
    expect(clock.asked).toEqual([]);
  });

  it("refuses a local address recorded with no URL", async () => {
    const clock = storeClock({ reply: FROZEN });
    const read = productionDestinationLastEdited({ readPageClock: clock.readPageClock });

    const result = await read({ address: { id: "a-proposal", provider: "local" }, home: homeWith({ tokens: {} }) });

    expect(result).toEqual({ why: "local page a-proposal was recorded with no URL, so its freezes cannot be found" });
    expect(clock.asked).toEqual([]);
  });
});
