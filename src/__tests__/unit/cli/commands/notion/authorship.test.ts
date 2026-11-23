/**
 * The Notion authorship check, and the byte-identical break-glass over an external edit.
 *
 * MEASURED: Notion rewrites `last_edited_by` on some actions the API exposes no content
 * for at all — a mermaid diagram's display-mode toggle. Since the only way to become last editor again is an
 * update, and that is exactly what the old check refused, a single such click locked slopweaver out of a
 * page it authored forever. These cases pin the fix: a byte-identical touch is not an edit, and a genuine
 * one needs `--overwrite-external-edit` and is journaled, never silent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  botIsLastEditor,
  externalEditDescription,
  externalEditRefusal,
  resolveExternalEdit,
} from "../../../../../cli/commands/notion/authorship.js";
import type { NotionWriteApi, WrittenPage } from "../../../../../corpus/notion/writeApi.js";
import { err as failure, ok } from "../../../../../lib/result.js";
import { readExternalEditOverrides } from "../../../../../outbound/notion/pageLedger.js";
import { notionApiFailure } from "../../../../notionApiErrorFixture.js";

const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";
const URL = "https://app.notion.com/p/x-0000000000000000000000000000a003";
const BOT = "3b300000-0000-818b-91d1-0027228eae95";
const PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-notion-authorship-"));
  fixtureDirs.push(dir);
  return dir;
}

/** A fake write API answering `botUserId`/`retrievePage` only — the two calls `botIsLastEditor` makes. */
function fakeApi({
  bot = "ok",
  page = "ok",
  lastEditedBy = BOT,
}: {
  bot?: "ok" | "fail";
  page?: "ok" | "fail" | "missing";
  lastEditedBy?: string | undefined;
} = {}): NotionWriteApi {
  const written: WrittenPage = {
    archived: false,
    id: PAGE,
    lastEditedBy,
    lastEditedTime: "2026-08-30T21:00:00.000Z",
    parent: { id: PARENT, kind: "page_id" },
    url: URL,
  };
  return {
    archivePage: async () => ok(undefined),
    botUserId: () => Promise.resolve(bot === "ok" ? ok(BOT) : failure(notionApiFailure({ message: "socket hang up" }))),
    createPage: () => Promise.resolve(failure(notionApiFailure({ message: "not used" }))),
    movePage: () => Promise.resolve(failure(notionApiFailure({ message: "not used" }))),
    replaceMarkdown: () => Promise.resolve(failure(notionApiFailure({ message: "not used" }))),
    retrieveMarkdown: () => Promise.resolve(failure(notionApiFailure({ message: "not used" }))),
    retrievePage: () => {
      if (page === "fail") {
        return Promise.resolve(failure(notionApiFailure({ message: "socket hang up" })));
      }
      return Promise.resolve(ok(page === "missing" ? undefined : written));
    },
    updatePageHeader: () => Promise.resolve(failure(notionApiFailure({ message: "not used" }))),
  };
}

/**
 * {@link fakeApi} whose page reads back with exactly these edit fields — `undefined` included, which a
 * defaulted parameter would silently replace.
 */
function apiReadingBack({ edit }: { edit: Pick<WrittenPage, "lastEditedBy" | "lastEditedTime"> }): NotionWriteApi {
  const page: WrittenPage = {
    archived: false,
    id: PAGE,
    ...edit,
    parent: { id: PARENT, kind: "page_id" },
    url: URL,
  };
  return { ...fakeApi(), retrievePage: () => Promise.resolve(ok(page)) };
}

describe("botIsLastEditor", () => {
  it("says yes when the bot is the last editor", async () => {
    const check = await botIsLastEditor({ api: fakeApi(), pageId: PAGE });
    expect(check).toEqual({ url: URL, yes: true });
  });

  it("names an external edit rather than refusing outright", async () => {
    const check = await botIsLastEditor({ api: fakeApi({ lastEditedBy: "a-human-user-id" }), pageId: PAGE });
    expect(check).toEqual({
      externalEdit: true,
      lastEditedBy: "a-human-user-id",
      lastEditedTime: "2026-08-30T21:00:00.000Z",
      url: URL,
    });
  });

  it("words an external edit Notion reports with no editor as an unknown user", async () => {
    const check = await botIsLastEditor({
      api: apiReadingBack({ edit: { lastEditedBy: undefined, lastEditedTime: "2026-08-30T21:00:00.000Z" } }),
      pageId: PAGE,
    });
    expect(check).toEqual({
      externalEdit: true,
      lastEditedBy: "an unknown user",
      lastEditedTime: "2026-08-30T21:00:00.000Z",
      url: URL,
    });
  });

  it("words an external edit Notion reports with no edit time as an unknown time", async () => {
    const check = await botIsLastEditor({
      api: apiReadingBack({ edit: { lastEditedBy: "a-human-user-id", lastEditedTime: undefined } }),
      pageId: PAGE,
    });
    expect(check).toEqual({
      externalEdit: true,
      lastEditedBy: "a-human-user-id",
      lastEditedTime: "an unknown time",
      url: URL,
    });
  });

  it("is a hard failure, not an external edit, when the bot id cannot be read", async () => {
    const check = await botIsLastEditor({ api: fakeApi({ bot: "fail" }), pageId: PAGE });
    expect("reason" in check ? check.reason : "").toContain("integration's own user id");
  });

  it("is a hard failure when the page cannot be read back", async () => {
    const check = await botIsLastEditor({ api: fakeApi({ page: "fail" }), pageId: PAGE });
    expect("reason" in check ? check.reason : "").toContain("could not read the page back");
  });

  it("is a hard failure when the page does not exist", async () => {
    const check = await botIsLastEditor({ api: fakeApi({ page: "missing" }), pageId: PAGE });
    expect("reason" in check ? check.reason : "").toContain("does not exist");
  });
});

describe("externalEditDescription / externalEditRefusal", () => {
  const edit = { lastEditedBy: "a-human-user-id", lastEditedTime: "2026-08-30T21:00:00.000Z" };

  it("names who touched the page and when, with no mention of the flag", () => {
    const description = externalEditDescription({ edit });
    expect(description).toContain("a-human-user-id");
    expect(description).not.toContain("--overwrite-external-edit");
  });

  it("adds the flag on top of the same description", () => {
    const refusal = externalEditRefusal({ edit });
    expect(refusal).toContain(externalEditDescription({ edit }));
    expect(refusal).toContain("--overwrite-external-edit");
  });
});

describe("resolveExternalEdit", () => {
  const authorship = {
    externalEdit: true,
    lastEditedBy: "a-human-user-id",
    lastEditedTime: "2026-08-30T21:00:00.000Z",
    url: URL,
  } as const;

  it("needs no decision at all when the bot is the last editor", () => {
    const resolved = resolveExternalEdit({
      authorship: { url: URL, yes: true },
      canonical: "hash-a",
      home: tempHome(),
      nowIso: "2026-08-30T21:05:00.000Z",
      overwriteReason: undefined,
      pageId: PAGE,
      priorCanonical: "hash-b",
    });
    expect(resolved).toEqual({ blindSpot: undefined, overridden: false });
  });

  it("treats a byte-identical touch as no edit, journaling nothing", () => {
    const home = tempHome();
    const resolved = resolveExternalEdit({
      authorship,
      canonical: "hash-a",
      home,
      nowIso: "2026-08-30T21:05:00.000Z",
      overwriteReason: undefined,
      pageId: PAGE,
      priorCanonical: "hash-a",
    });
    expect(resolved).toEqual({ blindSpot: undefined, overridden: false });
    expect(readExternalEditOverrides({ home })).toEqual([]);
  });

  it("refuses a genuine edit with no flag, journaling nothing", () => {
    const home = tempHome();
    const resolved = resolveExternalEdit({
      authorship,
      canonical: "hash-a",
      home,
      nowIso: "2026-08-30T21:05:00.000Z",
      overwriteReason: undefined,
      pageId: PAGE,
      priorCanonical: "hash-b",
    });
    expect("reason" in resolved ? resolved.reason : "").toContain("a-human-user-id");
    expect(readExternalEditOverrides({ home })).toEqual([]);
  });

  it("overrides a genuine edit when given a reason, and journals it", () => {
    const home = tempHome();
    const resolved = resolveExternalEdit({
      authorship,
      canonical: "hash-a",
      home,
      nowIso: "2026-08-30T21:05:00.000Z",
      overwriteReason: "syncing gold on their behalf",
      pageId: PAGE,
      priorCanonical: "hash-b",
    });
    expect(resolved).toEqual({ blindSpot: undefined, overridden: true });
    expect(readExternalEditOverrides({ home })).toEqual([
      {
        canonicalHash: "hash-a",
        lastEditedBy: "a-human-user-id",
        lastEditedTime: "2026-08-30T21:00:00.000Z",
        nowIso: "2026-08-30T21:05:00.000Z",
        pageId: PAGE,
        reason: "syncing gold on their behalf",
      },
    ]);
  });

  it("treats a page with no prior confirmed canonical as a genuine edit, never as identical", () => {
    const home = tempHome();
    const resolved = resolveExternalEdit({
      authorship,
      canonical: "hash-a",
      home,
      nowIso: "2026-08-30T21:05:00.000Z",
      overwriteReason: undefined,
      pageId: PAGE,
      priorCanonical: undefined,
    });
    expect("reason" in resolved).toBe(true);
  });
});

describe("resolveExternalEdit — the table column-width blind spot", () => {
  const authorship = {
    externalEdit: true,
    lastEditedBy: "a-human-user-id",
    lastEditedTime: "2026-08-30T21:00:00.000Z",
    url: URL,
  } as const;

  /** One resolution over a byte-identical touch, with the table flag under test. */
  function waved({ carriesTable }: { carriesTable: boolean }): ReturnType<typeof resolveExternalEdit> {
    return resolveExternalEdit({
      authorship,
      canonical: "hash-a",
      carriesTable,
      home: tempHome(),
      nowIso: "2026-08-30T21:05:00.000Z",
      overwriteReason: undefined,
      pageId: PAGE,
      priorCanonical: "hash-a",
    });
  }

  it("still proceeds — a stated gap is not a refusal", () => {
    const resolved = waved({ carriesTable: true });
    expect("reason" in resolved).toBe(false);
    expect("reason" in resolved ? true : resolved.overridden).toBe(false);
  });

  it("names column widths as what it could not see, over a page that has a table", () => {
    const resolved = waved({ carriesTable: true });
    expect("reason" in resolved ? "" : resolved.blindSpot).toContain("COLUMN WIDTHS");
  });

  it("says nothing over a page with no table", () => {
    const resolved = waved({ carriesTable: false });
    expect("reason" in resolved ? "x" : resolved.blindSpot).toBe(undefined);
  });

  it("says nothing when the difference was real, since that path refuses or journals instead", () => {
    const resolved = resolveExternalEdit({
      authorship,
      canonical: "hash-a",
      carriesTable: true,
      home: tempHome(),
      nowIso: "2026-08-30T21:05:00.000Z",
      overwriteReason: "syncing gold on their behalf",
      pageId: PAGE,
      priorCanonical: "hash-b",
    });
    expect("reason" in resolved ? "x" : resolved.blindSpot).toBe(undefined);
    expect("reason" in resolved ? false : resolved.overridden).toBe(true);
  });
});
