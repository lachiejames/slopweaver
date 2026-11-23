/**
 * The `notion page` COMMAND — the orchestration itself: what is called, in what order, and what is NOT.
 *
 * The negative assertions carry most of the weight. A dry run that resolved a token, recorded a door
 * decision or reserved an intent would make the next real run look like a duplicate; an update that skipped
 * the authorship read would replace a human's edit with no evidence at all. Both are invisible to a test
 * that only checks the happy path returned zero.
 *
 * Every edge is a plain injected function. No mocks.
 *
 * What the command's test files share: the page ids and body every case reads, the argv builder, the throwaway
 * homes and the hook that removes them, and the recording harness. Moved here when the command's one test file
 * was split by describe.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { NotionPageDeps } from "../../../../../../cli/commands/notion/writeContext.js";
import type { NotionMediaApi, PageBlock } from "../../../../../../corpus/notion/mediaApi.js";
import type { CanonicalMarkdown, NotionWriteApi, WrittenPage } from "../../../../../../corpus/notion/writeApi.js";
import type { NotionApiError } from "../../../../../../corpus/notion/writeErrors.js";
import { err as failure, ok, type Result } from "../../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../../doorLedgerFixture.js";
import {
  NOTION_REFUSED_TEXT,
  notionApiFailure,
  notionDeadHostRefusal,
  notionPrivacyRefusal,
} from "../../../../../notionApiErrorFixture.js";

export const PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";
export const PAGE = "3c300000-0000-817c-a1d1-da9a9b003e05";
export const URL = "https://app.notion.com/p/x-0000000000000000000000000000a003";
const BOT = "3b300000-0000-818b-91d1-0027228eae95";
export const BODY = "## TL;DR\n\nIt is broken.";

/**
 * argv as the router hands it over: node, script, noun, verb, then the verb's own arguments.
 *
 * @returns the full argv the `notion page` verb receives
 */
export function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "notion", "page", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every directory {@link tempHome} minted; call it once at module scope. */
export function useTempHomes(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A throwaway state home, removed after every test by the hook {@link useTempHomes} registers.
 *
 * @returns the new home directory's path
 */
export function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-notion-page-"));
  fixtureDirs.push(dir);
  return dir;
}

/**
 * How a fake mutation answers: it lands, its response is lost (`fail`, ambiguous), or the write transport refused it
 * before the wire on a privacy finding (`refused`) or a dead Datadog host (`deadHost`), as the real seam reports one.
 */
type FakeWrite = "ok" | "fail" | "refused" | "deadHost";

/** The text a privacy-refused fake write carries. */
export const REFUSED_TEXT = NOTION_REFUSED_TEXT;

/** The failure a fake mutation in `mode` answers with, in the real seam's shape. */
function fakeFailure({ mode }: { mode: Exclude<FakeWrite, "ok"> }): NotionApiError {
  if (mode === "refused") {
    return notionPrivacyRefusal();
  }
  if (mode === "deadHost") {
    return notionDeadHostRefusal();
  }
  return notionApiFailure({ message: "socket hang up" });
}

/** What a fake mutation in `mode` answers, `value` when it lands. */
async function fakeAnswer<T>({ mode, value }: { mode: FakeWrite; value: T }): Promise<Result<T, NotionApiError>> {
  return mode === "ok" ? ok(value) : failure(fakeFailure({ mode }));
}

/* What the fakes share and mutate: the last markdown a write sent, and the parent the page sits under now. */
interface FakeState {
  sent: string | undefined;
  currentParent: string | undefined;
}

// The page as the provider answers it right now, under whatever parent the last accepted move left it.
function fakePage({ state, lastEditedBy }: { state: FakeState; lastEditedBy: string | undefined }): WrittenPage {
  return {
    archived: false,
    id: PAGE,
    lastEditedBy,
    lastEditedTime: "2026-08-22T00:00:00.000Z",
    parent: state.currentParent === undefined ? undefined : { id: state.currentParent, kind: "page_id" },
    url: URL,
  };
}

// The fake media API: logs every call, and lists `pageBlocks` as the page's only children.
function fakeMediaApi({ calls, pageBlocks }: { calls: string[]; pageBlocks: readonly PageBlock[] }): NotionMediaApi {
  return {
    deleteBlock: ({ blockId }) => {
      calls.push(`deleteBlock:${blockId}`);
      return Promise.resolve(ok(undefined));
    },
    insertMediaAfter: ({ afterBlockId, caption }) => {
      calls.push(`insertMediaAfter:${afterBlockId}:${caption}`);
      return Promise.resolve(ok(`block-${afterBlockId}`));
    },
    listChildren: ({ parentId, cursor }) => {
      calls.push("listChildren");
      // One page of children, and only for the page itself: a marker published by this lane is a top-level
      // paragraph, so a fake that answers deeper parents would be modelling something the pass never needs.
      const blocks = parentId === PAGE && cursor === undefined ? pageBlocks : [];
      return Promise.resolve(ok({ blocks, nextCursor: undefined }));
    },
    uploadFile: ({ filename, bytes }) => {
      calls.push(`uploadFile:${filename}:${String(bytes.byteLength)}`);
      return Promise.resolve(ok(`upload-${filename}`));
    },
  };
}

// The fake `movePage`: mutates the provider's own parent, so `retrievePage` before and after a move answers
// what really happened rather than what the request asked for.
function fakeMovePage({
  calls,
  state,
  move,
  moveLandsAt,
}: {
  calls: string[];
  state: FakeState;
  move: FakeWrite;
  moveLandsAt: string | undefined;
}): NotionWriteApi["movePage"] {
  return ({ parentPageId }) => {
    calls.push(`movePage:${parentPageId}`);
    if (move !== "ok") {
      return fakeAnswer({ mode: move, value: undefined });
    }
    // A move lands where it was asked unless the case stages Notion filing the page somewhere else.
    if (moveLandsAt === undefined) {
      state.currentParent = parentPageId;
      return Promise.resolve(ok(undefined));
    }
    state.currentParent = moveLandsAt;
    return Promise.resolve(ok(undefined));
  };
}

// The fake write API: logs every call and records the last markdown a create or replace sent.
function fakeWriteApi({
  calls,
  state,
  lastEditedBy,
  canonical,
  create,
  replace,
  header,
  movePage,
}: {
  calls: string[];
  state: FakeState;
  lastEditedBy: string | undefined;
  canonical: string;
  create: FakeWrite;
  replace: FakeWrite;
  header: FakeWrite;
  movePage: NotionWriteApi["movePage"];
}): NotionWriteApi {
  const page = (): WrittenPage => fakePage({ lastEditedBy, state });
  const read: CanonicalMarkdown = { markdown: canonical, truncated: false, unknownBlockIds: [] };
  return {
    archivePage: async () => ok(undefined),
    botUserId: () => {
      calls.push("botUserId");
      return Promise.resolve(ok(BOT));
    },
    createPage: ({ markdown }) => {
      calls.push("createPage");
      state.sent = markdown;
      return fakeAnswer({ mode: create, value: page() });
    },
    replaceMarkdown: ({ markdown }) => {
      calls.push("replaceMarkdown");
      state.sent = markdown;
      return fakeAnswer({ mode: replace, value: undefined });
    },
    retrieveMarkdown: () => {
      calls.push("retrieveMarkdown");
      return Promise.resolve(ok(read));
    },
    movePage,
    retrievePage: () => {
      calls.push("retrievePage");
      return Promise.resolve(ok(page()));
    },
    updatePageHeader: () => {
      calls.push("updatePageHeader");
      return fakeAnswer({ mode: header, value: undefined });
    },
  };
}

// The injected deps: the API factory logs, records the home it was handed and hands back both fakes; output lands
// in `out` and `err`.
function fakeDeps({
  calls,
  homes,
  out,
  err,
  api,
  mediaApi,
  body,
  images,
  token,
}: {
  calls: string[];
  homes: string[];
  out: string[];
  err: string[];
  api: NotionWriteApi;
  mediaApi: NotionMediaApi;
  body: string;
  images: Readonly<Record<string, Uint8Array<ArrayBuffer>>>;
  token: string | null;
}): NotionPageDeps {
  return {
    bareRefContext: () => ({ repos: [] }),
    doorLedger: memoryDoorLedger().port,
    env: () => undefined,
    err: (line) => err.push(line),
    makeApis: ({ home }) => {
      calls.push("makeApis");
      homes.push(home);
      return { api, mediaApi };
    },
    nowIso: () => "2026-08-22T00:00:00.000Z",
    out: (line) => out.push(line),
    readBody: () => body,
    readMedia: ({ path }) => {
      calls.push(`readMedia:${path}`);
      return images[path] === undefined ? { error: `cannot read ${path}` } : { bytes: images[path] };
    },
    resolveToken: () => {
      calls.push("resolveToken");
      // `null` means "no token configured": an `undefined` default parameter would silently restore "tok".
      if (token === null) {
        return undefined;
      }
      return token;
    },
  };
}

/* What one harness models: the body, each fake write's outcome, the token, the media and the page's parent. */
interface HarnessOptions {
  body?: string;
  create?: FakeWrite;
  lastEditedBy?: string | undefined;
  canonical?: string;
  replace?: FakeWrite;
  header?: FakeWrite;
  token?: string | null;
  /** Resolved image path → its bytes. A path absent from this map reads as unreadable. */
  images?: Readonly<Record<string, Uint8Array<ArrayBuffer>>>;
  /** The blocks the fake page carries, so a marker can be found (or deliberately not). */
  pageBlocks?: readonly PageBlock[];
  /** The parent the fake page starts under. */
  startsUnder?: string | undefined;
  move?: FakeWrite;
  /** Where an accepted move actually LANDS the page — differs from the request to model a silent no-op. */
  moveLandsAt?: string | undefined;
}

/**
 * A recording harness: a fake API that logs every call, plus captured output.
 *
 * @returns the injected deps, the call log, captured stdout and stderr lines, and the last markdown sent
 */
export function harness({
  body = BODY,
  create = "ok",
  lastEditedBy = BOT,
  canonical = "## TL;DR\nIt is broken.",
  replace = "ok",
  header = "ok",
  token = "tok",
  images = {},
  pageBlocks = [],
  startsUnder = PARENT,
  move = "ok",
  moveLandsAt,
}: HarnessOptions = {}): {
  deps: NotionPageDeps;
  calls: string[];
  /** Every home the API factory was built with, in order. */
  homes: string[];
  out: string[];
  err: string[];
  sent: () => string | undefined;
} {
  const calls: string[] = [];
  const homes: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const state: FakeState = { currentParent: startsUnder, sent: undefined };
  const api = fakeWriteApi({
    calls,
    canonical,
    create,
    header,
    lastEditedBy,
    movePage: fakeMovePage({ calls, move, moveLandsAt, state }),
    replace,
    state,
  });
  const mediaApi = fakeMediaApi({ calls, pageBlocks });
  return {
    calls,
    deps: fakeDeps({ api, body, calls, err, homes, images, mediaApi, out, token }),
    err,
    homes,
    out,
    sent: () => state.sent,
  };
}
