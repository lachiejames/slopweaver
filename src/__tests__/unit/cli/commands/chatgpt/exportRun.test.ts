/**
 * `chatgpt import-export` and `chatgpt sync` over the committed SYNTHETIC export, with the refresh leg a plain fake
 * that records its argv and answers a chosen exit: the receipt is written only after a refresh that succeeded
 * (0, or 3 for nothing new), is the last thing written, and makes the next sync a no-op.
 */
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type ChatgptExportVerbDeps,
  parseExportVerbArgs,
  runChatgptImportExport,
  runChatgptSync,
} from "../../../../../cli/commands/chatgpt/exportRun.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ChatgptExportErrors } from "../../../../../corpus/chatgpt/errors.js";
import { currentAsOfIso } from "../../../../../corpus/chatgpt/exportFreshness.js";
import { heldExports, importChatgptExport } from "../../../../../corpus/chatgpt/exportStore.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { judgeResyncAttempt } from "../../../../../live/resync/outcome.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { FUTURE, syntheticExportAt, syntheticFileAlone } from "../../../../chatgptFixture.js";
import { NO_PROTECTION, UNPROTECTED } from "../../../../noProtection.js";

/** The committed synthetic export. */
const FIXTURE = syntheticExportAt({ modifiedIso: FUTURE });

/** The four bytes every zip with members opens with. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "chatgpt-verb-"));
  dirs.push(dir);
  return dir;
}

/** Edges whose refresh leg answers each call from `exits`, in order, recording the argv it was given. */
function edges({
  exits,
  downloadsDir,
  nowIso = "2026-10-17T03:00:00.000Z",
}: {
  exits: number[];
  downloadsDir: string;
  nowIso?: string;
}): {
  deps: ChatgptExportVerbDeps;
  calls: (readonly string[])[];
} {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    deps: {
      archive: {
        extractZipMember: ({ zipPath }) =>
          err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
        listZip: ({ zipPath }) => err(ChatgptExportErrors.archiveUnreadable({ detail: "unused", path: zipPath })),
      },
      downloadsDir,
      nowIso: () => nowIso,
      protection: NO_PROTECTION,
      runVerb: (argv) => {
        calls.push(argv);
        return Promise.resolve(exits.shift()!);
      },
    },
  };
}

/** Whether the newest export a home holds has its receipt on disk. */
function newestReceipted({ home }: { home: string }): boolean {
  const root = stateHomePaths({ home }).corpus.chatgptExports;
  const newest = heldExports({ root }).exports[0]!;
  return existsSync(join(root, "receipts", `${newest.contentHash}.json`));
}

describe("parseExportVerbArgs", () => {
  it("reads --from, --home and --json for import-export, and refuses a flag it does not know", () => {
    expect(
      unwrap(parseExportVerbArgs({ rest: ["--from", "/x.zip", "--home", "/h", "--json"], verb: "import-export" })),
    ).toEqual({ from: "/x.zip", home: "/h", json: true, replay: false });
    expect(unwrapErr(parseExportVerbArgs({ rest: ["--since", "2026-01-01"], verb: "import-export" }))).toContain(
      "unknown flag: --since",
    );
    expect(unwrapErr(parseExportVerbArgs({ rest: ["--replay"], verb: "import-export" }))).toContain(
      "unknown flag: --replay",
    );
  });

  it("refuses --json on sync, whose refresh leg prints its own summary to stdout, and reads --replay", () => {
    expect(unwrapErr(parseExportVerbArgs({ rest: ["--json"], verb: "sync" }))).toContain("unknown flag: --json");
    expect(unwrap(parseExportVerbArgs({ rest: ["--replay", "--home", "/h"], verb: "sync" }))).toEqual({
      from: undefined,
      home: "/h",
      json: false,
      replay: true,
    });
  });
});

describe("runChatgptSync", () => {
  it("takes the export in, refreshes it into the corpus and the store through the router, then receipts it", async () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_OK] });
    expect(await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] })).toBe(EXIT_OK);
    expect(calls).toEqual([["node", "slopweaver", "refresh", "--source", "chatgpt", "--store", "--home", home]]);
    expect(newestReceipted({ home })).toBe(true);
  });

  it("answers 3 the second time inside a day of the export — a verified sync the resync row can stamp", async () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_OK] });
    await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] });
    expect(await runChatgptSync({ deps, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(calls.length).toBe(1);
  });

  it("defers once the newest export is a day old, never claiming a fresh sync off the same archive", async () => {
    const home = tempDir();
    const first = edges({ downloadsDir: tempDir(), exits: [EXIT_OK] });
    await runChatgptSync({ deps: first.deps, rest: ["--from", FIXTURE, "--home", home] });
    const later = edges({ downloadsDir: tempDir(), exits: [], nowIso: "2026-10-18T03:00:00.000Z" });
    expect(await runChatgptSync({ deps: later.deps, rest: ["--home", home] })).toBe(EXIT_DEFERRED);
    expect(later.calls).toEqual([]);
  });

  it("fails closed once a held export will not read, so the resync row cannot stamp a sync off older store rows", async () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_OK] });
    await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] });
    const root = stateHomePaths({ home }).corpus.chatgptExports;
    const held = heldExports({ root }).exports[0]!;
    writeFileSync(join(root, held.contentHash, "manifest.json"), "{");
    const code = await runChatgptSync({ deps, rest: ["--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(calls.length).toBe(1);
    const judged = judgeResyncAttempt({
      afterClock: "2026-10-17T02:00:00.000Z",
      beforeClock: "2026-10-17T02:00:00.000Z",
      exitCode: code,
      recipeId: "resync-corpus-chatgpt",
      target: { kind: "corpus", source: "chatgpt" },
      walkStops: [],
    });
    expect(unwrapErr(judged).message).toBe("exited 1");
  });

  it("fails closed once a receipted export's bytes change under the same size, never calling it current", async () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_OK] });
    await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] });
    const member = heldExports({ root: stateHomePaths({ home }).corpus.chatgptExports }).exports[0]!.files[0]!;
    const bytes = readFileSync(member);
    bytes[1] = bytes[1]! ^ 1;
    writeFileSync(member, bytes);
    expect(await runChatgptSync({ deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(calls.length).toBe(1);
  });

  it("fails closed once a receipted OLDER export's bytes change under the same size, though nothing reads it", async () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_OK, EXIT_OK] });
    await runChatgptSync({
      deps,
      rest: ["--from", syntheticFileAlone({ member: "conversations-000.json", modifiedIso: FUTURE }), "--home", home],
    });
    await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] });
    const root = stateHomePaths({ home }).corpus.chatgptExports;
    const older = heldExports({ root }).exports[1]!;
    const bytes = readFileSync(older.files[0]!);
    bytes[1] = bytes[1]! ^ 1;
    writeFileSync(older.files[0]!, bytes);
    expect(await runChatgptSync({ deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(calls.length).toBe(2);
  });

  it("fails a scheduled sync on a zip in Downloads holding conversations but not one whole export", async () => {
    // Everything held is in, so passing that zip over would end "already in" over the export the owner just downloaded.
    const home = tempDir();
    const downloads = tempDir();
    const { calls, deps } = edges({ downloadsDir: downloads, exits: [EXIT_OK] });
    await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] });
    const short = join(downloads, "chatgpt-export.zip");
    writeFileSync(short, ZIP_MAGIC);
    const shortDeps: ChatgptExportVerbDeps = {
      ...deps,
      archive: { ...deps.archive, listZip: () => ok(["conversations-000.json", "conversations-002.json"]) },
    };
    expect(await runChatgptSync({ deps: shortDeps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect(calls.length).toBe(1);
  });

  it("fails a scheduled sync on a newer zip in Downloads that will not list, leaving the as-of record unwritten", async () => {
    // The held export is receipted and inside a day, so passing the zip over would end "already in" and stamp the
    // older corpus current while the export the owner just downloaded sat unread.
    const home = tempDir();
    const downloads = tempDir();
    const { calls, deps } = edges({ downloadsDir: downloads, exits: [EXIT_OK] });
    expect(await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] })).toBe(EXIT_OK);
    const asOf = join(stateHomePaths({ home }).corpus.chatgptExports, "as-of.json");
    utimesSync(asOf, 1_000, 1_000);
    writeFileSync(join(downloads, "chatgpt-export-newer.zip"), ZIP_MAGIC);
    expect(await runChatgptSync({ deps, rest: ["--home", home] })).toBe(EXIT_ERROR);
    expect([calls.length, statSync(asOf).mtimeMs]).toEqual([1, 1_000_000]);
  });

  it("forgets every receipt on --replay and refreshes every held export again, receipting each", async () => {
    // A rebuilt bronze or store would otherwise never see the chats only an older, receipted export holds.
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_OK, EXIT_OK, EXIT_OK] });
    await runChatgptSync({
      deps,
      rest: ["--from", syntheticFileAlone({ member: "conversations-000.json", modifiedIso: FUTURE }), "--home", home],
    });
    await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] });
    expect(await runChatgptSync({ deps, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(await runChatgptSync({ deps, rest: ["--replay", "--home", home] })).toBe(EXIT_OK);
    expect(calls.length).toBe(3);
    const root = stateHomePaths({ home }).corpus.chatgptExports;
    const held = heldExports({ root }).exports;
    expect(held.filter((one) => existsSync(join(root, "receipts", `${one.contentHash}.json`))).length).toBe(2);
  });

  it("refreshes a newer export whose receipt is a copy of an older one's, never calling it current", async () => {
    // The older export's rows are already in the store, so a sync that trusted the copied receipt would exit 3 with
    // every conversation only the newer export holds absent.
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_OK, EXIT_OK] });
    const older = syntheticFileAlone({ member: "conversations-000.json", modifiedIso: FUTURE });
    expect(await runChatgptSync({ deps, rest: ["--from", older, "--home", home] })).toBe(EXIT_OK);
    const root = stateHomePaths({ home }).corpus.chatgptExports;
    const olderHash = heldExports({ root }).exports[0]!.contentHash;
    const { stored } = unwrap(
      importChatgptExport({
        ...UNPROTECTED,
        archive: deps.archive,
        from: FIXTURE,
        nowIso: "2026-10-17T03:00:00.000Z",
        root,
      }),
    );
    copyFileSync(join(root, "receipts", `${olderHash}.json`), join(root, "receipts", `${stored.contentHash}.json`));
    expect(await runChatgptSync({ deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(calls.length).toBe(2);
    expect(JSON.parse(readFileSync(join(root, "receipts", `${stored.contentHash}.json`), "utf8")).contentHash).toBe(
      stored.contentHash,
    );
  });

  it("receipts a refresh that exited 3 — read whole, nothing new — like a 0", async () => {
    const home = tempDir();
    const { deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_EXPECTED_EMPTY] });
    expect(await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] })).toBe(EXIT_OK);
    expect(newestReceipted({ home })).toBe(true);
  });

  it("withholds the receipt from a failed refresh, so the next sync retries the same export", async () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_ERROR, EXIT_OK] });
    expect(await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] })).toBe(EXIT_ERROR);
    expect(newestReceipted({ home })).toBe(false);
    expect(await runChatgptSync({ deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(calls.length).toBe(2);
    expect(newestReceipted({ home })).toBe(true);
  });

  it("receipts an export whose refresh failed beside the newer one that arrived after it, never stranding it", async () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [EXIT_ERROR, EXIT_OK] });
    const failed = syntheticFileAlone({ member: "conversations-000.json", modifiedIso: FUTURE });
    expect(await runChatgptSync({ deps, rest: ["--from", failed, "--home", home] })).toBe(EXIT_ERROR);
    expect(await runChatgptSync({ deps, rest: ["--from", FIXTURE, "--home", home] })).toBe(EXIT_OK);
    expect(calls.length).toBe(2);
    const root = stateHomePaths({ home }).corpus.chatgptExports;
    const held = heldExports({ root }).exports;
    expect(held.length).toBe(2);
    expect(held.filter((one) => existsSync(join(root, "receipts", `${one.contentHash}.json`))).length).toBe(2);
  });

  it("takes in an unheld export from Downloads even when a held one was saved after it", async () => {
    const home = tempDir();
    const downloads = tempDir();
    // Two zips, each one whole `conversations.json` copied from one of the fixture's files; the newer one by mtime is
    // already held.
    const listings: Record<string, string> = {
      [join(downloads, "held.zip")]: "conversations-000.json",
      [join(downloads, "unheld.zip")]: "conversations-001.json",
    };
    for (const [path, seconds] of [
      [join(downloads, "unheld.zip"), 1_000],
      [join(downloads, "held.zip"), 2_000],
    ] as const) {
      writeFileSync(path, ZIP_MAGIC);
      utimesSync(path, seconds, seconds);
    }
    const { calls, deps } = edges({ downloadsDir: downloads, exits: [EXIT_OK, EXIT_OK] });
    const zipDeps: ChatgptExportVerbDeps = {
      ...deps,
      archive: {
        extractZipMember: ({ toPath, zipPath }) => {
          copyFileSync(join(FIXTURE, listings[zipPath]!), toPath);
          return ok(undefined);
        },
        listZip: () => ok(["conversations.json"]),
      },
    };
    expect(await runChatgptSync({ deps: zipDeps, rest: ["--from", join(downloads, "held.zip"), "--home", home] })).toBe(
      EXIT_OK,
    );
    expect(await runChatgptSync({ deps: zipDeps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(calls.length).toBe(2);
    expect(heldExports({ root: stateHomePaths({ home }).corpus.chatgptExports }).exports.length).toBe(2);
  });

  it("counts a byte-identical re-download as a fresh export: 3 off its file's time, not the first import's", async () => {
    const home = tempDir();
    const downloads = tempDir();
    const zipDeps = ({ nowIso }: { nowIso: string }): ChatgptExportVerbDeps => ({
      ...edges({ downloadsDir: downloads, exits: [EXIT_OK], nowIso }).deps,
      archive: {
        extractZipMember: ({ member, toPath }) => {
          copyFileSync(join(FIXTURE, member), toPath);
          return ok(undefined);
        },
        listZip: () => ok(["conversations-000.json"]),
      },
    });
    const first = join(downloads, "chatgpt-export.zip");
    writeFileSync(first, ZIP_MAGIC);
    utimesSync(first, new Date("2026-10-10T00:00:00.000Z"), new Date("2026-10-10T00:00:00.000Z"));
    expect(
      await runChatgptSync({ deps: zipDeps({ nowIso: "2026-10-10T01:00:00.000Z" }), rest: ["--home", home] }),
    ).toBe(EXIT_OK);
    // A week on, nothing new: the held export alone is past the window.
    const weekOn = zipDeps({ nowIso: "2026-10-17T03:00:00.000Z" });
    expect(await runChatgptSync({ deps: weekOn, rest: ["--home", home] })).toBe(EXIT_DEFERRED);
    // The owner exports again with no new chats: the same bytes, a newer file — current again, with nothing refreshed.
    const again = join(downloads, "chatgpt-export (1).zip");
    writeFileSync(again, ZIP_MAGIC);
    utimesSync(again, new Date("2026-10-17T02:00:00.000Z"), new Date("2026-10-17T02:00:00.000Z"));
    expect(await runChatgptSync({ deps: weekOn, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(heldExports({ root: stateHomePaths({ home }).corpus.chatgptExports }).exports.length).toBe(1);
  });

  it("refreshes a held export even when Downloads cannot be read, on a scheduled pass that named nothing", async () => {
    const home = tempDir();
    const first = edges({ downloadsDir: tempDir(), exits: [EXIT_ERROR] });
    await runChatgptSync({ deps: first.deps, rest: ["--from", FIXTURE, "--home", home] });
    const { calls, deps } = edges({ downloadsDir: join(tempDir(), "no-downloads"), exits: [EXIT_OK] });
    expect(await runChatgptSync({ deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(calls.length).toBe(1);
  });

  it("answers 3 and refreshes nothing when no export was ever downloaded", async () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [] });
    expect(await runChatgptSync({ deps, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(calls).toEqual([]);
  });

  it("fails on a --from the owner named that does not exist, refreshing nothing", async () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [] });
    expect(await runChatgptSync({ deps, rest: ["--from", join(tempDir(), "gone.zip"), "--home", home] })).toBe(
      EXIT_ERROR,
    );
    expect(calls).toEqual([]);
  });

  it("fails on one part of a split export, or a folder missing a part, taking nothing in and refreshing nothing", async () => {
    // Taken in, the part named would be read and receipted while the rest of the owner's history went unread.
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [] });
    const missingPart = tempDir();
    copyFileSync(join(FIXTURE, "conversations-001.json"), join(missingPart, "conversations-001.json"));
    const exits = [];
    for (const from of [
      join(FIXTURE, "conversations-000.json"),
      join(FIXTURE, "conversations-001.json"),
      missingPart,
    ]) {
      exits.push(await runChatgptSync({ deps, rest: ["--from", from, "--home", home] }));
    }
    expect(exits).toEqual([EXIT_ERROR, EXIT_ERROR, EXIT_ERROR]);
    expect(calls).toEqual([]);
    expect(heldExports({ root: stateHomePaths({ home }).corpus.chatgptExports }).exports).toEqual([]);
  });

  it("refuses an unknown flag before doing anything", async () => {
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [] });
    expect(await runChatgptSync({ deps, rest: ["--lookback-days", "3"] })).toBe(EXIT_USAGE);
    expect(calls).toEqual([]);
  });
});

describe("currentAsOfIso", () => {
  const newest = {
    acquiredAtIso: "2026-10-10T00:00:00.000Z",
    contentHash: "a".repeat(64),
    directory: "/held/a",
    files: [],
    importedAtIso: "2026-10-16T00:00:00.000Z",
    latestActivityIso: "2026-10-09T00:00:00.000Z",
  };
  const nowIso = "2026-10-17T00:00:00.000Z";

  it("dates from when the owner came by the export, never from when it was taken in", () => {
    expect(currentAsOfIso({ newest, nowIso, seen: [] })).toBe(newest.acquiredAtIso);
  });

  it("takes a later download of the same export, ignores another export's file, and never passes now", () => {
    expect(currentAsOfIso({ newest, nowIso, seen: [] })).toBe("2026-10-10T00:00:00.000Z");
    expect(
      currentAsOfIso({
        newest,
        nowIso,
        seen: [
          { contentHash: "a".repeat(64), modifiedIso: "2026-10-15T00:00:00.000Z" },
          { contentHash: "b".repeat(64), modifiedIso: "2026-10-16T00:00:00.000Z" },
          { contentHash: "a".repeat(64), modifiedIso: "2026-10-01T00:00:00.000Z" },
        ],
      }),
    ).toBe("2026-10-15T00:00:00.000Z");
    expect(
      currentAsOfIso({
        newest,
        nowIso,
        seen: [{ contentHash: "a".repeat(64), modifiedIso: "2027-01-01T00:00:00.000Z" }],
      }),
    ).toBe(nowIso);
  });
});

describe("runChatgptImportExport", () => {
  it("answers 0 for a new export, 3 for one already held, and refreshes nothing", () => {
    const home = tempDir();
    const { calls, deps } = edges({ downloadsDir: tempDir(), exits: [] });
    expect(runChatgptImportExport({ deps, rest: ["--from", FIXTURE, "--home", home] })).toBe(EXIT_OK);
    expect(runChatgptImportExport({ deps, rest: ["--from", FIXTURE, "--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(heldExports({ root: stateHomePaths({ home }).corpus.chatgptExports }).exports.length).toBe(1);
    expect(calls).toEqual([]);
  });

  it("answers 3 when Downloads holds no export, and 1 when the folder it names cannot be read", () => {
    const home = tempDir();
    const { deps } = edges({ downloadsDir: tempDir(), exits: [] });
    expect(runChatgptImportExport({ deps, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(runChatgptImportExport({ deps, rest: ["--from", join(tempDir(), "gone"), "--home", home] })).toBe(
      EXIT_ERROR,
    );
  });
});
