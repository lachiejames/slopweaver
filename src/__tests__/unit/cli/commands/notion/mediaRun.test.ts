/**
 * The `notion attach` COMMAND — the order of the gates, and the one bookkeeping step that is not
 * bookkeeping: re-recording the canonical digest after the page has changed.
 *
 * The negative assertions carry the weight. A dry run that resolved a token would have an effect where it
 * promises none; a pass that skipped the ownership check would start deleting blocks off a page nothing
 * proves is ours; and a pass that attached without re-recording the digest would make the very next
 * `notion page update` refuse the page it had just finished writing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type NotionImageDeps, runNotionImage } from "../../../../../cli/commands/notion/mediaRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { NotionMediaApi, PageBlock } from "../../../../../corpus/notion/mediaApi.js";
import type { CanonicalMarkdown, NotionWriteApi, WrittenPage } from "../../../../../corpus/notion/writeApi.js";
import { err as failure, ok } from "../../../../../lib/result.js";
import { canonicalHash } from "../../../../../outbound/notion/markdownBody.js";
import { placeholderMarker, withMediaMarkers } from "../../../../../outbound/notion/mediaPlaceholder.js";
import { confirmPage, readExternalEditOverrides, readPageRecord } from "../../../../../outbound/notion/pageLedger.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { notionApiFailure } from "../../../../notionApiErrorFixture.js";

const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";
const URL = "https://app.notion.com/p/x-0000000000000000000000000000a003";
const BOT = "3b300000-0000-818b-91d1-0027228eae95";
const PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";
const BODY = "## TL;DR\n\n![The hero shot](file:./hero.png)\n\nprose\n";

/** argv as the router hands it over: node, script, noun, verb, then the verb's own arguments. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "notion", "image", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-notion-image-"));
  fixtureDirs.push(dir);
  return dir;
}

/** A home whose ledger already owns `PAGE`, as a real publish would have left it. */
function ownedHome({ canonical = "before" }: { canonical?: string } = {}): string {
  const home = tempHome();
  confirmPage({
    canonical,
    home,
    images: [],
    intent: "abc",
    nowIso: "2026-08-22T00:00:00.000Z",
    pageId: PAGE,
    url: URL,
  });
  return home;
}

/**
 * A home whose ledger owns `PAGE`, recorded with the REAL canonical digest of `markdown` — unlike
 * `ownedHome`'s placeholder strings, which no code ever compares against a live hash. Needed only for the
 * byte-identical external-edit case, since that path is the one that actually hashes the page it reads back.
 */
function ownedHomeWithRealHash({ markdown }: { markdown: string }): string {
  const home = tempHome();
  confirmPage({
    canonical: canonicalHash({ canonical: markdown }),
    home,
    images: [],
    intent: "abc",
    nowIso: "2026-08-22T00:00:00.000Z",
    pageId: PAGE,
    url: URL,
  });
  return home;
}

/** The blocks a just-published page carries: a heading plus one marker per placeholder. */
function markerBlocks({ markdown }: { markdown: string }): readonly PageBlock[] {
  return withMediaMarkers({ markdown }).placeholders.map((placeholder, at): PageBlock => ({
    hasChildren: false,
    id: `marker-${String(at)}`,
    parentId: PAGE,
    text: placeholderMarker({ id: placeholder.id }),
    type: "paragraph",
  }));
}

/** A recording harness: fake seams that log every call, plus captured output. */
function harness({
  body = BODY,
  lastEditedBy = BOT,
  canonical = "after",
  token = "tok",
  blocks = markerBlocks({ markdown: BODY }),
  retrieveMarkdown = "ok",
  insert = "ok",
}: {
  body?: string;
  lastEditedBy?: string | undefined;
  canonical?: string;
  token?: string | null;
  blocks?: readonly PageBlock[];
  retrieveMarkdown?: "ok" | "fail";
  insert?: "ok" | "fail";
} = {}): { deps: NotionImageDeps; calls: string[]; homes: string[]; out: string[]; err: string[] } {
  const calls: string[] = [];
  // Every home the API factory was built with: the verb must hand it the home it resolved, never an ambient one.
  const homes: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const page: WrittenPage = {
    archived: false,
    id: PAGE,
    lastEditedBy,
    lastEditedTime: "2026-08-22T00:00:00.000Z",
    parent: { id: PARENT, kind: "page_id" },
    url: URL,
  };
  const read: CanonicalMarkdown = { markdown: canonical, truncated: false, unknownBlockIds: [] };
  const api: NotionWriteApi = {
    archivePage: async () => ok(undefined),
    botUserId: () => {
      calls.push("botUserId");
      return Promise.resolve(ok(BOT));
    },
    createPage: () => Promise.resolve(failure(notionApiFailure({ message: "not used" }))),
    movePage: () => Promise.resolve(failure(notionApiFailure({ message: "not used" }))),
    replaceMarkdown: () => Promise.resolve(failure(notionApiFailure({ message: "not used" }))),
    retrieveMarkdown: () => {
      calls.push("retrieveMarkdown");
      return Promise.resolve(
        retrieveMarkdown === "ok" ? ok(read) : failure(notionApiFailure({ message: "socket hang up" })),
      );
    },
    retrievePage: () => {
      calls.push("retrievePage");
      return Promise.resolve(ok(page));
    },
    updatePageHeader: () => Promise.resolve(ok(undefined)),
  };
  const mediaApi: NotionMediaApi = {
    deleteBlock: ({ blockId }) => {
      calls.push(`deleteBlock:${blockId}`);
      return Promise.resolve(ok(undefined));
    },
    insertMediaAfter: ({ afterBlockId }) => {
      calls.push(`insertMediaAfter:${afterBlockId}`);
      return Promise.resolve(
        insert === "ok" ? ok(`block-${afterBlockId}`) : failure(notionApiFailure({ message: "refused" })),
      );
    },
    listChildren: ({ parentId, cursor }) => {
      calls.push("listChildren");
      return Promise.resolve(
        ok({ blocks: parentId === PAGE && cursor === undefined ? blocks : [], nextCursor: undefined }),
      );
    },
    uploadFile: ({ filename }) => {
      calls.push(`uploadFile:${filename}`);
      return Promise.resolve(ok(`upload-${filename}`));
    },
  };
  return {
    calls,
    deps: {
      doorLedger: memoryDoorLedger().port,
      err: (line) => err.push(line),
      makeApis: ({ home }) => {
        calls.push("makeApis");
        homes.push(home);
        return { api, mediaApi };
      },
      nowIso: () => "2026-08-22T01:00:00.000Z",
      out: (line) => out.push(line),
      readBody: () => body,
      readMedia: ({ path }) => {
        calls.push(`readMedia:${path}`);
        return { bytes: new Uint8Array([1, 2, 3, 4]) };
      },
      resolveToken: () => {
        calls.push("resolveToken");
        // `null` means "no token configured": an `undefined` default parameter would silently restore "tok".
        if (token === null) {
          return undefined;
        }
        return token;
      },
    },
    err,
    homes,
    out,
  };
}

describe("runNotionImage — parse and dry run", () => {
  it("exits usage on a bad sub-command, touching nothing", async () => {
    const h = harness();
    expect(await runNotionImage({ argv: argv({ rest: ["detach"] }), deps: h.deps })).toBe(EXIT_USAGE);
    expect(h.calls).toEqual([]);
  });

  it("previews without a token, a page read, an upload or a ledger write", async () => {
    const h = harness();
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--dry-run"] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual([]);
    expect(h.out.some((line) => line.includes("./hero.png"))).toBe(true);
  });
});

describe("runNotionImage — the gates", () => {
  it("refuses without a token before anything else happens", async () => {
    const h = harness({ token: null });
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain("connect notion");
  });

  it("refuses a page the ledger does not own, and never reads a block", async () => {
    const h = harness();
    const home = tempHome();
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain("--adopt");
    expect(h.calls).toEqual(["resolveToken", "makeApis"]);
    expect(h.homes).toEqual([home]);
  });

  it("refuses a genuine external edit, naming the override flag", async () => {
    const home = ownedHome({ canonical: "before" });
    const h = harness({ canonical: "after", lastEditedBy: "someone-else" });
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain("someone-else");
    expect(h.err.join("\n")).toContain("--overwrite-external-edit");
    expect(h.calls.some((call) => call.startsWith("uploadFile"))).toBe(false);
  });

  it("treats a byte-identical external edit as no edit, and proceeds without the flag", async () => {
    const home = ownedHomeWithRealHash({ markdown: "unchanged content" });
    const h = harness({ canonical: "unchanged content", lastEditedBy: "someone-else" });
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls.some((call) => call.startsWith("uploadFile"))).toBe(true);
  });

  it("overwrites a genuine external edit when given the flag, and journals who last edited it and why", async () => {
    const home = ownedHome({ canonical: "before" });
    const h = harness({ canonical: "after", lastEditedBy: "someone-else" });
    const code = await runNotionImage({
      argv: argv({
        rest: [
          "attach",
          "--page",
          PAGE,
          "--from",
          "/draft/d.md",
          "--overwrite-external-edit",
          "syncing gold on their behalf",
          "--home",
          home,
        ],
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls.some((call) => call.startsWith("uploadFile"))).toBe(true);
    const overrides = readExternalEditOverrides({ home });
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.reason).toBe("syncing gold on their behalf");
    expect(overrides[0]!.lastEditedBy).toBe("someone-else");
  });

  it("refuses an address that is not a Notion page", async () => {
    const h = harness();
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", "not-a-page", "--from", "/draft/d.md"] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
  });
});

describe("runNotionImage — attaching", () => {
  it("attaches the image and re-records the digest, so the next update still sees an unchanged page", async () => {
    const home = ownedHome({ canonical: "before" });
    const h = harness();
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    const record = readPageRecord({ home, pageId: PAGE })!;
    expect(record.lastCanonicalHash).not.toBe("before");
    expect(record.images).toEqual([
      {
        blockId: "block-marker-0",
        fileUploadId: "upload-hero.png",
        placeholderId: withMediaMarkers({ markdown: BODY }).placeholders[0]!.id,
        source: "./hero.png",
      },
    ]);
  });

  it("leaves the recorded digest ALONE when it attached nothing, since the page did not change", async () => {
    const home = ownedHome({ canonical: "before" });
    const h = harness({ blocks: [] });
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(readPageRecord({ home, pageId: PAGE })!.lastCanonicalHash).toBe("before");
    expect(h.calls).not.toContain("retrieveMarkdown");
  });

  it("warns loudly when the images landed but the digest could not be re-recorded", async () => {
    const home = ownedHome({ canonical: "before" });
    const h = harness({ retrieveMarkdown: "fail" });
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err.join("\n")).toContain("will refuse until");
    expect(readPageRecord({ home, pageId: PAGE })!.lastCanonicalHash).toBe("before");
  });

  it("reports a per-image failure and exits non-zero without losing what did land", async () => {
    const h = harness({ insert: "fail" });
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", ownedHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.out.join("\n")).toContain("1 failed");
  });

  it("says plainly that there was nothing to do when the body carries no placeholders", async () => {
    const h = harness({ body: "## A\n\nprose\n" });
    const code = await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", ownedHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.out.join("\n")).toContain("nothing to attach");
  });

  it("emits the whole report as one document under --json", async () => {
    const h = harness();
    await runNotionImage({
      argv: argv({ rest: ["attach", "--page", PAGE, "--from", "/draft/d.md", "--home", ownedHome(), "--json"] }),
      deps: h.deps,
    });
    const parsed: unknown = JSON.parse(h.out.join("\n"));
    expect(parsed).toEqual({
      alreadyAttached: [],
      attached: [
        {
          blockId: "block-marker-0",
          blockType: "image",
          bytes: 4,
          fileUploadId: "upload-hero.png",
          placeholderId: withMediaMarkers({ markdown: BODY }).placeholders[0]!.id,
          source: "./hero.png",
        },
      ],
      failures: [],
      pageId: PAGE,
      placeholders: 1,
      unrecorded: null,
    });
  });
});
