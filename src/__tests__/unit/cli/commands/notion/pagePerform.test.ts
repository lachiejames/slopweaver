/*
 * The archive lane's perform step over a fake provider that logs every call: it reads the page first so the
 * report can name what went, and an unreadable page is never archived blind.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { NotionPageArgs } from "../../../../../cli/commands/notion/pageCore.js";
import { performArchive } from "../../../../../cli/commands/notion/pagePerform.js";
import type { NotionPageDeps, WriteContext } from "../../../../../cli/commands/notion/writeContext.js";
import type { NotionMediaApi } from "../../../../../corpus/notion/mediaApi.js";
import type { NotionWriteApi, WrittenPage } from "../../../../../corpus/notion/writeApi.js";
import { err, ok } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { notionApiFailure } from "../../../../notionApiErrorFixture.js";

const PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";
const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";
const URL = "https://app.notion.com/p/x-0000000000000000000000000000a003";
const BOT = "3b300000-0000-818b-91d1-0027228eae95";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "notion-archive-"));
  homes.push(home);
  return home;
}

/** An `archive` invocation's parsed args, as `parseNotionPageArgs` would produce them. */
const ARCHIVE_ARGS: NotionPageArgs = {
  adopt: false,
  bodySource: "-",
  dryRun: false,
  home: undefined,
  icon: undefined,
  json: false,
  mediaBase: undefined,
  overwriteExternalEdit: undefined,
  page: PAGE,
  parent: undefined,
  title: undefined,
  to: undefined,
  verb: "archive",
};

/** The page as the provider reads it back. */
const PAGE_READ: WrittenPage = {
  archived: false,
  id: PAGE,
  lastEditedBy: BOT,
  lastEditedTime: "2026-08-22T00:00:00.000Z",
  parent: { id: PARENT, kind: "page_id" },
  url: URL,
};

/**
 * A write context over a fake provider that logs every call. `readable` decides whether the page reads back;
 * `archiveError` makes the archive call itself fail with that message.
 */
function harness({ readable, archiveError }: { readable: boolean; archiveError: string | undefined }): {
  readonly ctx: WriteContext;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const landmine = ({ name }: { name: string }): never => {
    throw new Error(`${name} must not be called`);
  };
  const api: NotionWriteApi = {
    archivePage: async () => {
      calls.push("archivePage");
      return archiveError === undefined ? ok(undefined) : err(notionApiFailure({ message: archiveError }));
    },
    botUserId: async () => landmine({ name: "botUserId" }),
    createPage: async () => landmine({ name: "createPage" }),
    movePage: async () => landmine({ name: "movePage" }),
    replaceMarkdown: async () => landmine({ name: "replaceMarkdown" }),
    retrieveMarkdown: async () => landmine({ name: "retrieveMarkdown" }),
    retrievePage: async () => {
      calls.push("retrievePage");
      return readable ? ok(PAGE_READ) : err(notionApiFailure({ message: "object_not_found" }));
    },
    updatePageHeader: async () => landmine({ name: "updatePageHeader" }),
  };
  const mediaApi: NotionMediaApi = {
    deleteBlock: async () => landmine({ name: "deleteBlock" }),
    insertMediaAfter: async () => landmine({ name: "insertMediaAfter" }),
    listChildren: async () => landmine({ name: "listChildren" }),
    uploadFile: async () => landmine({ name: "uploadFile" }),
  };
  const deps: NotionPageDeps = {
    bareRefContext: () => landmine({ name: "bareRefContext" }),
    doorLedger: memoryDoorLedger().port,
    env: () => undefined,
    err: () => landmine({ name: "err" }),
    makeApis: () => landmine({ name: "makeApis" }),
    nowIso: () => "2026-08-22T00:00:00.000Z",
    out: () => landmine({ name: "out" }),
    readBody: () => landmine({ name: "readBody" }),
    readMedia: () => landmine({ name: "readMedia" }),
    resolveToken: () => landmine({ name: "resolveToken" }),
  };
  const home = freshHome();
  return {
    calls,
    ctx: {
      api,
      args: ARCHIVE_ARGS,
      body: "",
      deps,
      destination: PAGE,
      home,
      intent: `archive:${PAGE}`,
      mediaApi,
      mediaBase: home,
      moveTo: undefined,
    },
  };
}

describe("performArchive", () => {
  it("reads the page, archives it, and reports it archived with its URL", async () => {
    const h = harness({ archiveError: undefined, readable: true });

    expect(await performArchive({ ctx: h.ctx })).toEqual({ kind: "archived", pageId: PAGE, url: URL });
    expect(h.calls).toEqual(["retrievePage", "archivePage"]);
  });

  it("refuses to archive a page it cannot read, and never calls archive", async () => {
    const h = harness({ archiveError: undefined, readable: false });

    expect(await performArchive({ ctx: h.ctx })).toEqual({
      kind: "failed",
      reason: `page ${PAGE} could not be read, so it was not archived`,
    });
    expect(h.calls).toEqual(["retrievePage"]);
  });

  it("reports the provider's own error when the archive call fails", async () => {
    const h = harness({ archiveError: "socket hang up", readable: true });

    expect(await performArchive({ ctx: h.ctx })).toEqual({ kind: "failed", reason: "socket hang up" });
    expect(h.calls).toEqual(["retrievePage", "archivePage"]);
  });
});
