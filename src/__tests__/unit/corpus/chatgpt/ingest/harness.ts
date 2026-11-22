/*
 * What the `refresh --source chatgpt` test files share: the cursorless window, archive edges that never run, a
 * hand-built conversation, and the throwaway directories each case writes an export or a bronze home into, removed
 * after every case by the `afterEach` that `useTempDirs()` registers.
 *
 * The synthetic export is NOT shared: each test file mints its own. The unit lane reuses a fork across files, so this
 * module's body runs once, and a copy minted here would sit in the first file's temp root, removed when that file ends.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import type { ChatgptArchiveDeps } from "../../../../../corpus/chatgpt/archive.js";
import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { importChatgptExport, type StoredExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { chatgptIngestJob } from "../../../../../corpus/chatgpt/ingest.js";
import { readCorpusDir } from "../../../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";
import { type BronzeCommitter, createBronzeCommitter } from "../../../../../corpus/corpusWriter.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { chatId } from "../../../../chatgptFixture.js";
import { NO_PROTECTION, UNPROTECTED } from "../../../../noProtection.js";

/** A cursorless source's window: the epoch to the run. */
export const WINDOW = { since: "1970-01-01", until: "2026-10-17" };

/** Archive edges that never run. */
export const NO_ZIP: ChatgptArchiveDeps = {
  extractZipMember: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
  listZip: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
};

const dirs: string[] = [];

/** Register the `afterEach` that removes every directory minted since the last case. Call it once per test file. */
export function useTempDirs(): void {
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A fresh temp directory, removed after the test.
 *
 * @returns the new directory's absolute path
 */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-ingest-"));
  dirs.push(dir);
  return dir;
}

/**
 * A committer that keeps what it is handed and calls every record written.
 *
 * @returns the committer, and the records it was handed in commit order
 */
export function keepingCommitter(): { committer: BronzeCommitter; kept: CorpusRecord[] } {
  const kept: CorpusRecord[] = [];
  return {
    committer: {
      commit: ({ records }) => {
        kept.push(...records);
        return ok({ bySource: {}, deduped: 0, excluded: 0, written: records.length });
      },
    },
    kept,
  };
}

/**
 * A held export of one conversations file with the given text, built by hand.
 *
 * @param text the raw bytes its one `conversations.json` holds
 * @returns the held export, dated at its fixed instant
 */
export function storedOf({ text }: { text: string }): StoredExport {
  const directory = tempDir();
  const file = join(directory, "conversations.json");
  writeFileSync(file, text);
  return {
    acquiredAtIso: "2026-10-17T00:00:00.000Z",
    contentHash: "c".repeat(64),
    directory,
    files: [file],
    importedAtIso: "2026-10-17T00:00:00.000Z",
    latestActivityIso: null,
  };
}

/**
 * A minimal conversation with one user message; `id` is the name {@link chatId} turns into its id.
 *
 * @returns the conversation as an export's JSON element
 */
export function conversation({
  id,
  text = "hello",
  createTime = 1790000000,
  contentType = "text",
  title = null,
  updateTime = null,
  role = "user",
  recipient = "all",
  parts = [text],
}: {
  id: string;
  text?: string;
  createTime?: number | null;
  contentType?: string;
  title?: string | null;
  updateTime?: number | null;
  role?: string;
  recipient?: string;
  parts?: readonly unknown[];
}): Record<string, unknown> {
  return {
    create_time: createTime,
    current_node: "m",
    id: chatId({ name: id }),
    title,
    update_time: updateTime,
    mapping: {
      m: {
        id: "m",
        message: {
          author: { role },
          content: { content_type: contentType, parts },
          create_time: createTime,
          id: "m",
          recipient,
        },
        parent: "root",
      },
      root: { id: "root", message: null, parent: null },
    },
  };
}

/**
 * The same conversation as the web session's whole-conversation read answers it: `conversation_id` in place of
 * `id`, and a few of the top-level keys only that endpoint carries, with synthetic values.
 *
 * @param chat the conversation as an export's element, from {@link conversation}
 * @returns the conversation as the live read's body
 */
export function liveBody({ chat }: { chat: Record<string, unknown> }): Record<string, unknown> {
  const { id, ...rest } = chat;
  return {
    ...rest,
    conversation_id: id,
    default_model_slug: "synthetic-model",
    is_archived: false,
    moderation_results: [],
    safe_urls: [],
    voice: null,
  };
}

/**
 * Take a hand-built export in, its file dated when the owner came by it.
 *
 * @param root the exports root it is imported under
 * @param acquiredIso the instant its one file is dated
 * @returns the export as held
 */
export function takeAt({
  root,
  chats,
  acquiredIso,
}: {
  root: string;
  chats: readonly Record<string, unknown>[];
  acquiredIso: string;
}): StoredExport {
  const dir = tempDir();
  const file = join(dir, "conversations.json");
  writeFileSync(file, JSON.stringify(chats));
  const when = new Date(acquiredIso);
  utimesSync(file, when, when);
  return unwrap(
    importChatgptExport({ ...UNPROTECTED, archive: NO_ZIP, from: dir, nowIso: "2026-10-17T00:00:00.000Z", root }),
  ).stored;
}

/**
 * Where a home holds its ChatGPT live copy, taken from the one state-home contract rather than joined here.
 *
 * @returns the live copy root the refresh job reads under `home`
 */
export function liveRootOf({ home }: { home: string }): string {
  return stateHomePaths({ home }).corpus.chatgptLive;
}

/**
 * The refresh job over one export root and the live copy at {@link liveRootOf}, writing real bronze under `home`.
 *
 * @returns the job, not yet run
 */
export function refreshOf({ home, root }: { home: string; root: string }): ReturnType<typeof chatgptIngestJob> {
  return chatgptIngestJob({
    deps: {
      committer: createBronzeCommitter({ home, protection: NO_PROTECTION, window: WINDOW }),
      exportsRoot: root,
      liveRoot: liveRootOf({ home }),
    },
    home,
    window: WINDOW,
  });
}

/**
 * Every message text bronze holds, sorted.
 *
 * @returns the texts, sorted
 */
export function bronzeTexts({ home }: { home: string }): readonly string[] {
  return unwrap(readCorpusDir({ dir: bronzeSourceDir({ home, source: "chatgpt" }), home, protection: NO_PROTECTION }))
    .records.map((record) => record.text)
    .toSorted();
}
