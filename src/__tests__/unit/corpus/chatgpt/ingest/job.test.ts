/**
 * The `refresh --source chatgpt` job's own shape and what it reads: cursorless and labelled, a refusal when nothing
 * was taken in, the whole synthetic export committed to real bronze under a temp home, and two or more held exports
 * read together with their gaps held to one bound.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { importChatgptExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { chatgptIngestJob, ingestStoredExport } from "../../../../../corpus/chatgpt/ingest.js";
import { readCorpusDir } from "../../../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";
import { createBronzeCommitter } from "../../../../../corpus/corpusWriter.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { projectRecord } from "../../../../../store/project.js";
import { FUTURE, syntheticExportAt, syntheticFileAlone } from "../../../../chatgptFixture.js";
import {
  bronzeTexts,
  conversation,
  keepingCommitter,
  NO_ZIP,
  refreshOf,
  storedOf,
  takeAt,
  tempDir,
  useTempDirs,
  WINDOW,
} from "./harness.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

/** The synthetic export, dated past every clock here so an import dates it at its own `nowIso`. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

useTempDirs();

describe("chatgptIngestJob", () => {
  it("declares itself cursorless, labelled, and sourced chatgpt", () => {
    const job = chatgptIngestJob({ home: "/nowhere", window: WINDOW });
    expect(job.cursorless).toBe(true);
    expect(job.label).toBe("chatgpt (history export)");
    expect(job.source).toBe("chatgpt");
    expect(job.window).toEqual(WINDOW);
  });

  it("refuses with the owner's one step when no export was ever taken in", async () => {
    const home = tempDir();
    const job = chatgptIngestJob({
      deps: {
        committer: keepingCommitter().committer,
        exportsRoot: join(home, "exports"),
        liveRoot: join(home, "live"),
      },
      home,
      window: WINDOW,
    });
    expect(unwrapErr(await job.run())).toEqual([ChatgptExportErrors.noImportedExport().message]);
  });

  it("reads the whole export into bronze, every visible message one private record, no gap", async () => {
    const home = tempDir();
    const exportsRoot = join(home, "exports");
    unwrap(
      importChatgptExport({ archive: NO_ZIP, from: FIXTURE, nowIso: "2026-10-17T00:00:00.000Z", root: exportsRoot }),
    );
    const job = chatgptIngestJob({
      deps: {
        committer: createBronzeCommitter({ home, protection: NO_ENTRIES, window: WINDOW }),
        exportsRoot,
        liveRoot: join(home, "live"),
      },
      home,
      window: WINDOW,
    });
    const run = unwrap(await job.run());
    expect(run.gaps).toEqual([]);
    expect(run.records).toEqual([]);
    expect(run.committedPerContainer).toBe(10);
    expect(run.projectedPerContainer).toBe(10);
    expect(run.notes!.length).toBe(1);
    expect(run.notes![0]!).toContain(
      "3 conversation(s) across 2 file(s), 10 message(s) projected, 5 withheld as not part of what the owner saw",
    );
    const bronze = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "chatgpt" }), home, protection: NO_ENTRIES }),
    ).records;
    expect(bronze.length).toBe(10);
    expect(bronze.filter((record) => record.visibility !== "private")).toEqual([]);
    expect(
      bronze.filter((record) => record.attrs?.["branch"] === "alternate").map((record) => record.sourceId),
    ).toEqual(["a0000100-0000-4000-8000-000000000107:a-r1-old"]);
  });

  it("writes only records the store projection accepts, so a refresh exit of 0 means every one was stored", async () => {
    // `chatgpt sync` receipts on the refresh's exit code alone, and the store leg counts a refused row without
    // failing. That is sound only because no record this source writes can be refused: storable source, a constant
    // container, no side row.
    const home = tempDir();
    const exportsRoot = join(home, "exports");
    unwrap(
      importChatgptExport({ archive: NO_ZIP, from: FIXTURE, nowIso: "2026-10-01T00:00:00.000Z", root: exportsRoot }),
    );
    unwrap(
      await chatgptIngestJob({
        deps: {
          committer: createBronzeCommitter({ home, protection: NO_ENTRIES, window: WINDOW }),
          exportsRoot,
          liveRoot: join(home, "live"),
        },
        home,
        window: WINDOW,
      }).run(),
    );
    const records = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "chatgpt" }), home, protection: NO_ENTRIES }),
    ).records;
    expect(records.length).toBe(10);
    expect(records.filter((record) => projectRecord({ record }).isErr())).toEqual([]);
  });

  it("counts what the owner's sync-author denylist kept out, as a note rather than a gap", () => {
    const stored = storedOf({ text: JSON.stringify([conversation({ id: "conv-1" })]) });
    const tally = ingestStoredExport({
      committer: {
        commit: ({ records }) => ok({ bySource: {}, deduped: 0, excluded: records.length, written: 0 }),
      },
      stored,
    });
    expect(tally.excluded).toBe(1);
    expect(tally.written).toBe(0);
    expect(tally.gaps).toEqual([]);
  });

  it("reads an older export beside the newer one, writing a chat both hold once", async () => {
    const home = tempDir();
    const exportsRoot = join(home, "exports");
    unwrap(
      importChatgptExport({ archive: NO_ZIP, from: FIXTURE, nowIso: "2026-10-01T00:00:00.000Z", root: exportsRoot }),
    );
    unwrap(
      importChatgptExport({
        archive: NO_ZIP,
        from: syntheticFileAlone({ member: "conversations-001.json", modifiedIso: FUTURE }),
        nowIso: "2026-10-17T00:00:00.000Z",
        root: exportsRoot,
      }),
    );
    const job = chatgptIngestJob({
      deps: {
        committer: createBronzeCommitter({ home, protection: NO_ENTRIES, window: WINDOW }),
        exportsRoot,
        liveRoot: join(home, "live"),
      },
      home,
      window: WINDOW,
    });
    const run = unwrap(await job.run());
    // Both run to the same latest activity, so the later import is the newer snapshot and the whole export only
    // fills in the two conversations it lacks.
    expect(run.notes!.length).toBe(2);
    expect(run.notes![0]!).toContain("taken in 2026-10-17T00:00:00.000Z");
    expect(run.notes![1]!).toContain("taken in 2026-10-01T00:00:00.000Z");
    expect(run.notes![1]!).toContain("1 conversation(s) left to the copy holding their latest version");
    expect(run.projectedPerContainer).toBe(10);
    expect(run.committedPerContainer).toBe(10);
  });

  it("writes both of two exports that tie on their latest chat and when the owner came by them, each chat its own", async () => {
    const home = tempDir();
    const root = join(home, "exports");
    const acquiredIso = "2026-10-10T00:00:00.000Z";
    takeAt({ acquiredIso, chats: [conversation({ id: "tie-a", text: "only in A" })], root });
    takeAt({ acquiredIso, chats: [conversation({ id: "tie-b", text: "only in B" })], root });
    const run = unwrap(await refreshOf({ home, root }).run());
    expect(run.gaps).toEqual([]);
    expect(bronzeTexts({ home })).toEqual(["only in A", "only in B"]);
  });

  it("holds the whole sync's gaps to one bound, however many held exports each raise their own", async () => {
    const home = tempDir();
    const root = join(home, "exports");
    for (const at of [1, 2, 3]) {
      const chats = Array.from({ length: 25 }, (_, index) =>
        conversation({
          contentType: `kind-${String(at)}-${String(index)}`,
          id: `bound-${String(at)}-${String(index)}`,
        }),
      );
      takeAt({ acquiredIso: `2026-10-0${String(at)}T00:00:00.000Z`, chats, root });
    }
    const gaps = unwrap(await refreshOf({ home, root }).run()).gaps!;
    expect(gaps.length).toBe(51);
    expect(gaps.at(-1)!.message).toBe(
      "chatgpt: and 13 more gap line(s) across the held exports, counted rather than named",
    );
  });
});
