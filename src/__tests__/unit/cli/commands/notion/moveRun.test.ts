import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runMove } from "../../../../../cli/commands/notion/moveRun.js";
import type { NotionPageArgs } from "../../../../../cli/commands/notion/pageCore.js";
import type { NotionPageDeps, WriteContext } from "../../../../../cli/commands/notion/writeContext.js";
import type { NotionMediaApi } from "../../../../../corpus/notion/mediaApi.js";
import type { NotionWriteApi, WrittenPage } from "../../../../../corpus/notion/writeApi.js";
import { ok } from "../../../../../lib/result.js";
import { confirmPage, readPageRecord } from "../../../../../outbound/notion/pageLedger.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

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
  const home = mkdtempSync(join(tmpdir(), "notion-move-"));
  homes.push(home);
  return home;
}

/** A home whose page ledger records PAGE as a confirmed create of slopweaver's. */
function ownedHome(): string {
  const home = freshHome();
  confirmPage({
    canonical: "hash-1",
    home,
    images: [],
    intent: "intent-1",
    nowIso: "2026-08-01T00:00:00.000Z",
    pageId: PAGE,
    url: URL,
  });
  return home;
}

/** Every path under `root` with its bytes (directories as `null`), sorted, so a whole-tree change is visible. */
function treeSnapshot({ root }: { root: string }): readonly (readonly [string, string | null])[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .toSorted()
    .map((relative): readonly [string, string | null] => {
      const path = join(root, relative);
      return [relative, statSync(path).isDirectory() ? null : readFileSync(path, "utf8")];
    });
}

/** A `move` invocation's parsed args, as `parseNotionPageArgs` would produce them. */
const MOVE_ARGS: NotionPageArgs = {
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
  to: PARENT,
  verb: "move",
};

/** A write context over a fake provider that logs every call; the page reads back under PARENT. */
function harness({ home, moveTo }: { home: string; moveTo: string }): {
  readonly ctx: WriteContext;
  readonly calls: string[];
  readonly out: string[];
  readonly err: string[];
} {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const page: WrittenPage = {
    archived: false,
    id: PAGE,
    lastEditedBy: BOT,
    lastEditedTime: "2026-08-22T00:00:00.000Z",
    parent: { id: PARENT, kind: "page_id" },
    url: URL,
  };
  const landmine = ({ name }: { name: string }): never => {
    throw new Error(`${name} must not be called`);
  };
  const api: NotionWriteApi = {
    archivePage: async () => landmine({ name: "archivePage" }),
    botUserId: async () => {
      calls.push("botUserId");
      return ok(BOT);
    },
    createPage: async () => landmine({ name: "createPage" }),
    movePage: async ({ parentPageId }) => {
      calls.push(`movePage:${parentPageId}`);
      return ok(undefined);
    },
    replaceMarkdown: async () => landmine({ name: "replaceMarkdown" }),
    retrieveMarkdown: async () => landmine({ name: "retrieveMarkdown" }),
    retrievePage: async () => {
      calls.push("retrievePage");
      return ok(page);
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
    err: (line) => err.push(line),
    makeApis: () => landmine({ name: "makeApis" }),
    nowIso: () => "2026-08-22T00:00:00.000Z",
    out: (line) => out.push(line),
    readBody: () => landmine({ name: "readBody" }),
    readMedia: () => landmine({ name: "readMedia" }),
    resolveToken: () => landmine({ name: "resolveToken" }),
  };
  return {
    calls,
    ctx: {
      api,
      args: MOVE_ARGS,
      body: "",
      deps,
      destination: PAGE,
      home,
      intent: "move-intent",
      mediaApi,
      mediaBase: home,
      moveTo,
    },
    err,
    out,
  };
}

describe("runMove", () => {
  it("refuses a page as its own parent with exit 3, calling no provider edge and writing nothing", async () => {
    const home = ownedHome();
    const before = treeSnapshot({ root: home });
    const h = harness({ home, moveTo: PAGE });

    expect(await runMove({ ctx: h.ctx })).toBe(3);
    expect(h.err).toEqual([`a page cannot be its own parent: --page and --to are both ${PAGE}`]);
    expect(h.out).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(treeSnapshot({ root: home })).toEqual(before);
  });

  it("refuses an unowned page the bot last edited with exit 3, naming --adopt, and writes nothing", async () => {
    const home = freshHome();
    // A DIFFERENT page the ledger owns, so the home is not empty and a stray write would show.
    confirmPage({
      canonical: "hash-2",
      home,
      images: [],
      intent: "intent-2",
      nowIso: "2026-08-01T00:00:00.000Z",
      pageId: PARENT,
      url: "https://app.notion.com/p/other",
    });
    const before = treeSnapshot({ root: home });
    const h = harness({ home, moveTo: PARENT });

    expect(await runMove({ ctx: h.ctx })).toBe(3);
    expect(h.err).toEqual([
      `slopweaver has no record of creating page ${PAGE}, so it will not move it. A move changes where colleagues ` +
        "find the page and whose permissions it inherits, and this ledger is the only evidence the page was ours " +
        "to relocate.\nThe integration IS this page's last editor, so if slopweaver did write it, re-run with " +
        "--adopt to record that and then move.",
    ]);
    expect(h.calls).toEqual(["botUserId", "retrievePage"]);
    expect(treeSnapshot({ root: home })).toEqual(before);
  });

  it("reports an owned page already under the target as unmoved with exit 0, sending no move", async () => {
    const home = ownedHome();
    const recordBefore = readPageRecord({ home, pageId: PAGE });
    const h = harness({ home, moveTo: PARENT });

    expect(await runMove({ ctx: h.ctx })).toBe(0);
    expect(h.out).toEqual([`page ${PAGE} is already under ${PARENT}, so nothing was sent.`, URL]);
    expect(h.err).toEqual([]);
    expect(h.calls).toEqual(["retrievePage"]);
    expect(readPageRecord({ home, pageId: PAGE })).toEqual(recordBefore);
    expect(readPageRecord({ home, pageId: PAGE })).toEqual({
      confirmedIso: "2026-08-01T00:00:00.000Z",
      intent: "intent-1",
      lastCanonicalHash: "hash-1",
      pageId: PAGE,
      reservedIso: "2026-08-01T00:00:00.000Z",
      url: URL,
    });
  });
});

/** The page a move is sent under in the read-back cases — neither the page itself nor where it starts. */
const TARGET = "4a400000-0000-8102-a2f7-d1d8ef1fe6b0";
/** Somewhere the page was NOT sent, so a read-back naming it disagrees with the move. */
const ELSEWHERE = "5b500000-0000-8102-a2f7-d1d8ef1fe6b0";

/**
 * A harness whose first page read finds the page under PARENT and every later read returns `after` — the
 * read-back a move is judged on.
 */
function readBackHarness({ after }: { after: WrittenPage["parent"] }): ReturnType<typeof harness> {
  const h = harness({ home: ownedHome(), moveTo: TARGET });
  const reads: WrittenPage["parent"][] = [{ id: PARENT, kind: "page_id" }, after];
  const retrievePage: NotionWriteApi["retrievePage"] = async () => {
    h.calls.push("retrievePage");
    const parent = reads.length > 1 ? reads.shift() : reads[0];
    return ok({
      archived: false,
      id: PAGE,
      lastEditedBy: BOT,
      lastEditedTime: "2026-08-22T00:00:00.000Z",
      parent,
      url: URL,
    });
  };
  return { ...h, ctx: { ...h.ctx, api: { ...h.ctx.api, retrievePage } } };
}

/** The four lines an accepted move that reads back somewhere else reports, naming where it read back. */
function unconfirmedMoveLines({ under }: { under: string }): readonly string[] {
  return [
    `page ${PAGE} was written but could NOT be read back, so its state is unverified.`,
    URL,
    `the read-back failed with: the move was accepted but the page reads back under ${under}, not ${TARGET}`,
    "Do not re-run this: Notion assigns the page id, so a retry publishes a SECOND page.",
  ];
}

describe("runMove — the read-back is the claim", () => {
  it("reports an accepted move that reads back under another page as unconfirmed, naming that page", async () => {
    const h = readBackHarness({ after: { id: ELSEWHERE, kind: "page_id" } });

    expect(await runMove({ ctx: h.ctx })).toBe(3);
    expect(h.out).toEqual(unconfirmedMoveLines({ under: ELSEWHERE }));
    expect(h.calls).toEqual(["retrievePage", `movePage:${TARGET}`, "retrievePage"]);
  });

  it("says the page has no page parent when it reads back workspace-parented", async () => {
    const h = readBackHarness({ after: { id: undefined, kind: "workspace" } });

    expect(await runMove({ ctx: h.ctx })).toBe(3);
    expect(h.out).toEqual(unconfirmedMoveLines({ under: "no page parent" }));
  });

  it("says the page has no page parent when Notion returns no parent object at all", async () => {
    const h = readBackHarness({ after: undefined });

    expect(await runMove({ ctx: h.ctx })).toBe(3);
    expect(h.out).toEqual(unconfirmedMoveLines({ under: "no page parent" }));
  });
});
