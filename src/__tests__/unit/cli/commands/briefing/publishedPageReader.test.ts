/**
 * The production page seams: the store prefetch answers a page's newest frozen bytes over one connection, driven
 * here through a plain fake store, and the file matcher finds every page a path opens by the file's identity over a
 * real home.
 */
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { PublishedPageReadErrors } from "../../../../../briefing/publishedPageRead.js";
import {
  type OpenPagesReader,
  pagesOpenedOnDisk,
  prefetchPagesWith,
} from "../../../../../cli/commands/briefing/publishedPageReader.js";
import { err, ok, type Result, unwrap } from "../../../../../lib/result.js";
import { FreezeStoreErrors } from "../../../../../outbound/briefing/errors.js";
import type { PublishedPagesReader } from "../../../../../store/publishedPages/read.js";
import {
  type PublishedPagesReadError,
  PublishedPagesReadErrors,
} from "../../../../../store/publishedPages/readErrors.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home holding one page, `queue`, and a `pages/alias` symlink to it. */
function homeWithQueue(): { home: string; queue: string } {
  const home = mkdtempSync(join(tmpdir(), "sw-ppr-"));
  dirs.push(home);
  const queue = join(home, "pages", "queue", "index.html");
  mkdirSync(join(home, "pages", "queue"), { recursive: true });
  writeFileSync(queue, "<p>the queue page</p>", "utf8");
  symlinkSync("queue", join(home, "pages", "alias"));
  return { home, queue };
}

describe("pagesOpenedOnDisk", () => {
  it("answers every page whose file a symlinked slug opens, the link's own name included", () => {
    const { home } = homeWithQueue();
    const pagesDirectory = join(home, "pages");

    expect(pagesOpenedOnDisk({ pagesDirectory, path: join(pagesDirectory, "alias", "index.html") }).toSorted()).toEqual(
      ["alias", "queue"],
    );
  });

  it("matches a hard link outside pages/ to the page by identity, which no path resolver folds", () => {
    const { home, queue } = homeWithQueue();
    const elsewhere = join(home, "elsewhere.html");
    linkSync(queue, elsewhere);

    expect(realpathSync.native(elsewhere)).not.toBe(realpathSync.native(queue));
    expect(pagesOpenedOnDisk({ pagesDirectory: join(home, "pages"), path: elsewhere }).toSorted()).toEqual([
      "alias",
      "queue",
    ]);
  });

  it("matches a subject naming no file by the page directory it names, through an alias of that directory", () => {
    const { home } = homeWithQueue();
    mkdirSync(join(home, "pages", "gone"));
    symlinkSync(join(home, "pages", "gone"), join(home, "gone-alias"));

    expect(
      pagesOpenedOnDisk({ pagesDirectory: join(home, "pages"), path: join(home, "gone-alias", "index.html") }),
    ).toEqual(["gone"]);
  });

  it("answers nothing for a path that is no page file and names no page directory", () => {
    const { home } = homeWithQueue();
    const pagesDirectory = join(home, "pages");

    expect([
      pagesOpenedOnDisk({ pagesDirectory, path: join(home, "nowhere", "index.html") }),
      pagesOpenedOnDisk({ pagesDirectory, path: join(pagesDirectory, "queue", "other.html") }),
      pagesOpenedOnDisk({ pagesDirectory: join(home, "no-pages"), path: join(pagesDirectory, "queue", "index.html") }),
    ]).toEqual([[], [], []]);
  });
});

/** A local page's published address under a fixed synthetic home. */
function address({ slug }: { slug: string }): string {
  return pathToFileURL(join("/home/acme", "pages", slug, "index.html")).href;
}

/** What one key's latest freeze answers in a fake store. */
type Answer = { readonly html: string } | { readonly bytes: Uint8Array } | { readonly error: PublishedPagesReadError };

/** A fake store over keyed answers, recording every open and every key asked. */
function fakeStore({
  answers,
  closing = ok(undefined),
}: {
  answers: Record<string, Answer>;
  closing?: Result<undefined, PublishedPagesReadError>;
}): { open: OpenPagesReader; opens: number[]; asked: string[] } {
  const opens: number[] = [];
  const asked: string[] = [];
  const latestFrozen: PublishedPagesReader["latestFrozen"] = async ({ pageKey }) => {
    asked.push(pageKey);
    const answer = answers[pageKey]!;
    if ("error" in answer) {
      return err(answer.error);
    }
    const bytes = "bytes" in answer ? answer.bytes : new TextEncoder().encode(answer.html);
    return ok({
      bodySha256: "0".repeat(64),
      bytes,
      frozenAt: new Date("2026-11-09T00:00:00Z"),
      pageKey,
      versionCount: 1,
    });
  };
  const open: OpenPagesReader = async ({ read }) => {
    opens.push(opens.length + 1);
    const answered = await read({ latestFrozen });
    return closing.isErr() ? err(closing.error) : answered;
  };
  return { asked, open, opens };
}

describe("prefetchPagesWith", () => {
  it("reads each key once over one open, however many spellings name it, and answers each spelling", async () => {
    const store = fakeStore({ answers: { queue: { html: "<p>v2</p>" } } });
    const spelled = address({ slug: "queue" });
    const query = `${spelled}?from=card`;

    const reader = unwrap(await prefetchPagesWith({ open: store.open, urls: [spelled, query, spelled] }));

    expect([unwrap(reader({ url: spelled })), unwrap(reader({ url: query }))]).toEqual(["<p>v2</p>", "<p>v2</p>"]);
    expect({ asked: store.asked, opens: store.opens }).toEqual({ asked: ["queue"], opens: [1] });
  });

  it("opens nothing for no URLs, and its reader answers any URL as never fetched", async () => {
    const store = fakeStore({ answers: {} });
    const url = address({ slug: "queue" });

    const reader = unwrap(await prefetchPagesWith({ open: store.open, urls: [] }));

    expect(store.opens).toEqual([]);
    expect(reader({ url })._unsafeUnwrapErr()).toStrictEqual(PublishedPageReadErrors.notPrefetched({ url }));
  });

  it("keeps a page the store holds no freeze of as exactly that, beside the pages it read", async () => {
    const never = PublishedPagesReadErrors.neverFrozen({ pageKey: "draft" });
    const store = fakeStore({ answers: { draft: { error: never }, queue: { html: "<p>q</p>" } } });

    const reader = unwrap(
      await prefetchPagesWith({ open: store.open, urls: [address({ slug: "queue" }), address({ slug: "draft" })] }),
    );

    expect(reader({ url: address({ slug: "draft" }) })._unsafeUnwrapErr()).toStrictEqual(never);
    expect(unwrap(reader({ url: address({ slug: "queue" }) }))).toBe("<p>q</p>");
  });

  it("refuses the whole set, naming the page, when the store cannot give one for any other reason", async () => {
    const down = PublishedPagesReadErrors.unavailable({ cause: new Error("connection refused"), doing: "connect" });
    const store = fakeStore({ answers: { queue: { error: down } } });
    const url = address({ slug: "queue" });

    const refused = (await prefetchPagesWith({ open: store.open, urls: [url] }))._unsafeUnwrapErr();

    expect(refused).toStrictEqual(PublishedPageReadErrors.unreadable({ cause: down, url }));
    expect(refused.message).toBe(
      `${url} could not be read from the published-page store: the published-page store did not connect: connection refused`,
    );
  });

  it("refuses bytes that are not UTF-8 rather than substituting a replacement character", async () => {
    const store = fakeStore({ answers: { queue: { bytes: new Uint8Array([0x3c, 0xff, 0x3e]) } } });
    const url = address({ slug: "queue" });

    const refused = (await prefetchPagesWith({ open: store.open, urls: [url] }))._unsafeUnwrapErr();

    expect([refused.code, refused.url, refused.cause.constructor.name]).toEqual([
      "PUBLISHED_PAGE_UNREADABLE",
      url,
      "TypeError",
    ]);
  });

  it("refuses a store that fails to close after reading, naming the first page asked for", async () => {
    const closing = PublishedPagesReadErrors.unavailable({ cause: new Error("socket hang up"), doing: "close" });
    const store = fakeStore({ answers: { queue: { html: "<p>q</p>" } }, closing: err(closing) });
    const url = address({ slug: "queue" });

    const refused = (await prefetchPagesWith({ open: store.open, urls: [url] }))._unsafeUnwrapErr();

    expect(refused).toStrictEqual(PublishedPageReadErrors.unreadable({ cause: closing, url }));
  });

  it("refuses a file address that names no page before opening the store", async () => {
    const store = fakeStore({ answers: {} });
    const url = "file:///home/acme/notes/index.html";

    const refused = (await prefetchPagesWith({ open: store.open, urls: [url] }))._unsafeUnwrapErr();

    expect(refused.cause).toStrictEqual(FreezeStoreErrors.fileAddressNotAPage({ artifact: url }));
    expect(store.opens).toEqual([]);
  });
});
