/*
 * The owner's protect list as the store verbs honour it, over a throwaway home with synthetic bronze only.
 *
 * Three layers, each pinned where it decides: `protectedBronze.ts` maps the shared reader's registries into the
 * store's errors (failing CLOSED) and judges a path; `store status`'s drift section turns a protected source into a withheld line with no repair
 * command and no `--check` failure; `store ingest`'s preflight refuses a protected source or file before the
 * store is opened, under the invocation's own `--home`. No registry is read from the operator's own home:
 * every account home here is injected, and every registry path is under the throwaway one.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { StoreIngestArgs } from "../../../cli/commands/store/core.js";
import { ingestPreflight } from "../../../cli/commands/store/ingestRun.js";
import type { StoreStatusArgs } from "../../../cli/commands/store/statusCore.js";
import { driftSection, statusDrift, statusExit } from "../../../cli/commands/store/statusRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import { listBronzeFiles } from "../../../corpus/bronzeStorage.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { ownerProtection, type ProtectionTextReader, protectionHomes } from "../../../protectedPaths/ownerEntries.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";
import type { PresenceProbe } from "../../../store/bronzeDrift.js";
import { driftRepairCommand } from "../../../store/bronzeDriftCore.js";
import { type StoreError, StoreErrors } from "../../../store/errors.js";
import { listProtectedBronzeFiles, ownerProtectionFor, protectedBronzeFile } from "../../../store/protectedBronze.js";

const WHY = "synthetic: the owner keeps this folder private";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "protected-bronze-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One protect-list entry, as the registry parser yields it. */
const entry = ({ path, mode = "no-access" }: { path: string; mode?: ProtectedPath["mode"] }): ProtectedPath => ({
  addedIso: "2026-11-21T10:42:00.000Z",
  mode,
  path,
  why: WHY,
});

/** One storable calendar line, addressed by its native id. */
const line = ({ sourceId }: { sourceId: string }): string =>
  JSON.stringify({
    attrs: {},
    author: "someone@example.test",
    container: "primary",
    kind: "event",
    raw: {},
    refs: [],
    source: "calendar",
    sourceId,
    text: `body for ${sourceId}`,
    title: null,
    tsIso: "2026-09-18T04:00:00.000Z",
    url: `https://example.test/${sourceId}`,
    visibility: "private",
  });

/** Write one bronze file under the throwaway home, returning its path. */
const writeBronze = ({ source, basename }: { source: string; basename: string }): string => {
  const dir = join(home, "corpus", "bronze", source);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, basename);
  writeFileSync(path, `${line({ sourceId: `${source}-1` })}\n`, "utf8");
  return path;
};

/** A registry document holding the entries given. */
const registry = ({ paths }: { paths: readonly ProtectedPath[] }): string =>
  JSON.stringify({ paths, schemaVersion: 1 });

/** The throwaway home's chatgpt bronze directory, the one the protected cases withhold. */
const chatgptDir = (): string => join(home, "corpus", "bronze", "chatgpt");

/** A probe that answers "the store holds nothing", whatever it was asked. */
const holdsNothing: PresenceProbe = async () => ok(new Set<string>());

const STATUS_ARGS: StoreStatusArgs = { check: false, json: false, scope: "windows" };

const INGEST_ARGS: StoreIngestArgs = { all: true, from: 0, json: false, limit: 2000 };

const UNKNOWN = StoreErrors.protectionUnknown({ reason: "the registry is malformed" });

/**
 * The store's protection over fixture homes only: the shared reader reads both registries, with the account
 * default injected so the owner's own registry is never read.
 *
 * @param accountHome resolves the account default; the home in use when omitted
 * @param readText reads a registry's text in place of the filesystem reader
 * @returns what `store status` and `store ingest` would be handed
 */
const storeProtection = ({
  accountHome = () => home,
  readText,
}: {
  accountHome?: () => string;
  readText?: ProtectionTextReader;
} = {}): Result<readonly ProtectedPath[], StoreError> =>
  ownerProtectionFor({
    home,
    read: ({ home: inUse }) =>
      protectionHomes({ accountHome, home: inUse }).andThen((homes) =>
        ownerProtection({ homes, ...(readText === undefined ? {} : { readText }) }),
      ),
  });

describe("ownerProtectionFor", () => {
  it("reads the home in use and the account default, each once", () => {
    writeFileSync(join(home, "protected-paths.json"), registry({ paths: [entry({ path: "/a" })] }));
    expect(unwrap(storeProtection({ accountHome: () => join(home, "absent") })).map((each) => each.path)).toEqual([
      "/a",
    ]);
    expect(unwrap(storeProtection()).map((each) => each.path)).toEqual(["/a"]);
  });

  it("fails CLOSED when the account default cannot be resolved, as the store's own error", () => {
    const error = unwrapErr(
      storeProtection({
        accountHome: () => {
          throw new Error("no passwd entry");
        },
      }),
    );
    expect(error).toEqual(
      StoreErrors.protectionUnknown({ reason: "the account's default home could not be resolved: no passwd entry" }),
    );
  });

  it("merges both homes' registries", () => {
    const other = join(home, "account");
    mkdirSync(other);
    writeFileSync(join(home, "protected-paths.json"), registry({ paths: [entry({ path: "/a" })] }));
    writeFileSync(join(other, "protected-paths.json"), registry({ paths: [entry({ mode: "read-only", path: "/b" })] }));
    const entries = unwrap(storeProtection({ accountHome: () => other }));
    expect(entries.map((each) => [each.path, each.mode])).toEqual([
      ["/a", "no-access"],
      ["/b", "read-only"],
    ]);
  });

  it("fails CLOSED on a malformed registry", () => {
    writeFileSync(join(home, "protected-paths.json"), "{ not json");
    const error = unwrapErr(storeProtection());
    expect(error.code).toBe("PROTECTION_UNKNOWN");
    expect(error.message).toContain(join(home, "protected-paths.json"));
    expect(error.message).toContain(
      `the owner's protect list could not be read, so no bronze is read: ${join(home, "protected-paths.json")} is not a protected-path registry`,
    );
  });

  it("fails CLOSED on a registry that cannot be read, rather than reading it as absent", () => {
    const error = unwrapErr(
      storeProtection({
        readText: () => {
          throw new Error("EACCES: permission denied");
        },
      }),
    );
    expect(error).toEqual(
      StoreErrors.protectionUnknown({
        reason: `${join(home, "protected-paths.json")} could not be read: EACCES: permission denied`,
      }),
    );
  });

  it("fails CLOSED on a registry that is a dangling symlink, which a plain read reports as ENOENT", () => {
    symlinkSync(join(home, "missing-registry.json"), join(home, "protected-paths.json"));
    const error = unwrapErr(storeProtection());
    expect(error.code).toBe("PROTECTION_UNKNOWN");
    expect(error.message).toContain(`${join(home, "protected-paths.json")} could not be read`);
    const file = join(home, "protected-paths.json");
    expect(error).toEqual(
      StoreErrors.protectionUnknown({
        reason: `${file} could not be read: ENOENT: no such file or directory, open '${file}'`,
      }),
    );
  });

  it("resolves an alias entry whose last part does not exist yet, so its real ancestor is refused", () => {
    const real = join(home, "real");
    mkdirSync(real);
    const alias = join(home, "alias");
    symlinkSync(real, alias);
    writeFileSync(join(home, "protected-paths.json"), registry({ paths: [entry({ path: join(alias, "private") })] }));
    const entries = unwrap(storeProtection());
    const resolved = join(realpathSync(real), "private");
    expect(entries.map((each) => each.path)).toEqual([join(alias, "private"), resolved]);
    mkdirSync(join(home, "corpus", "bronze"), { recursive: true });
    const dir = join(home, "corpus", "bronze", "calendar");
    symlinkSync(real, dir);
    expect(unwrapErr(listProtectedBronzeFiles({ entries, home, source: "calendar" }))).toEqual(
      StoreErrors.bronzeProtected({ path: dir, protectedPath: resolved, why: WHY }),
    );
  });

  it("covers an entry recorded through a symlinked alias under its real path too", () => {
    const path = writeBronze({ basename: "2026-11-20_2026-11-21.jsonl", source: "chatgpt" });
    const alias = join(home, "alias");
    symlinkSync(chatgptDir(), alias);
    writeFileSync(join(home, "protected-paths.json"), registry({ paths: [entry({ path: alias })] }));
    const entries = unwrap(storeProtection());
    const real = realpathSync(chatgptDir());
    expect(entries.map((each) => each.path)).toEqual([alias, real]);
    expect(unwrapErr(protectedBronzeFile({ entries, path: realpathSync(path) }))).toEqual(
      StoreErrors.bronzeProtected({ path: realpathSync(path), protectedPath: real, why: WHY }),
    );
  });
});

describe("listProtectedBronzeFiles", () => {
  it("lists exactly what the loader's own listing lists, in the same order, when nothing is protected", () => {
    writeBronze({ basename: "2026-09-18_2026-09-19.jsonl", source: "calendar" });
    writeBronze({ basename: "compact.jsonl", source: "calendar" });
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", source: "calendar" });
    const listed = unwrap(listProtectedBronzeFiles({ entries: [], home, source: "calendar" }));
    expect(listed).toEqual(unwrap(listBronzeFiles({ home, protection: () => ok([]), source: "calendar" })));
    expect(listed.map((file) => file.path.slice(file.path.lastIndexOf("/") + 1))).toEqual([
      "compact.jsonl",
      "2026-09-17_2026-09-18.jsonl",
      "2026-09-18_2026-09-19.jsonl",
    ]);
  });

  it("refuses a source whose directory is a symlink into a no-access tree", () => {
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "private.jsonl"), `${line({ sourceId: "secret" })}\n`);
    mkdirSync(join(home, "corpus", "bronze"), { recursive: true });
    const dir = join(home, "corpus", "bronze", "calendar");
    symlinkSync(elsewhere, dir);
    const protectedPath = realpathSync(elsewhere);
    expect(
      unwrapErr(listProtectedBronzeFiles({ entries: [entry({ path: protectedPath })], home, source: "calendar" })),
    ).toEqual(StoreErrors.bronzeProtected({ path: dir, protectedPath, why: WHY }));
  });

  it("refuses under a relative home an absolute entry names, even where the source has no bronze yet", () => {
    const relativeHome = relative(process.cwd(), home);
    const dir = join(relativeHome, "corpus", "bronze", "chatgpt");
    expect(
      unwrapErr(
        listProtectedBronzeFiles({ entries: [entry({ path: chatgptDir() })], home: relativeHome, source: "chatgpt" }),
      ),
    ).toEqual(StoreErrors.bronzeProtected({ path: dir, protectedPath: chatgptDir(), why: WHY }));
  });
});

describe("protectedBronzeFile", () => {
  it("refuses a file under a no-access path, judged by its absolute spelling", () => {
    const path = writeBronze({ basename: "2026-11-20_2026-11-21.jsonl", source: "chatgpt" });
    expect(unwrapErr(protectedBronzeFile({ entries: [entry({ path: chatgptDir() })], path }))).toEqual(
      StoreErrors.bronzeProtected({ path, protectedPath: chatgptDir(), why: WHY }),
    );
  });

  it("refuses a symlink whose target is no-access, and answers an allowed file's real spelling", () => {
    const target = writeBronze({ basename: "2026-11-20_2026-11-21.jsonl", source: "chatgpt" });
    const link = join(home, "link.jsonl");
    symlinkSync(target, link);
    const real = realpathSync(target);
    expect(unwrapErr(protectedBronzeFile({ entries: [entry({ path: real })], path: link }))).toEqual(
      StoreErrors.bronzeProtected({ path: link, protectedPath: real, why: WHY }),
    );
    expect(unwrap(protectedBronzeFile({ entries: [], path: link }))).toBe(real);
  });
});

describe("store status over a home whose chatgpt bronze is no-access", () => {
  it("measures every other source and withholds chatgpt, printing no repair line for it", async () => {
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", source: "calendar" });
    writeBronze({ basename: "2026-11-20_2026-11-21.jsonl", source: "chatgpt" });
    const dir = chatgptDir();
    const section = driftSection({
      drift: await statusDrift({
        args: { ...STATUS_ARGS, home },
        probe: holdsNothing,
        protection: ok([entry({ path: dir })]),
      }),
    });
    expect(section.failure).toBe(null);
    expect(section.withheld).toEqual([{ path: dir, protectedPath: dir, source: "chatgpt", why: WHY }]);
    expect(section.reports.some((report) => report.source === "chatgpt")).toBe(false);
    expect(section.reports.find((report) => report.source === "calendar")!.missing).toBe(1);
    expect(section.lines.filter((printed) => printed.includes("chatgpt"))).toEqual([
      `chatgpt: NOT SCANNED — ${dir} reaches ${dir}, no-access on the owner's protect list (${WHY}); none of it ` +
        "was read, so there is no count and no repair line",
    ]);
    // The witness that a repair line IS printed for a measured gap, so its absence for chatgpt is evidence.
    expect(section.lines).toContain(`  repair: ${driftRepairCommand({ source: "calendar" })}`);
  });

  it("keeps a withheld source to one line when the owner's reason holds a newline", async () => {
    writeBronze({ basename: "2026-11-20_2026-11-21.jsonl", source: "chatgpt" });
    const dir = chatgptDir();
    const forged = `private\n  repair: ${driftRepairCommand({ source: "chatgpt" })}`;
    const section = driftSection({
      drift: await statusDrift({
        args: { ...STATUS_ARGS, home, source: "chatgpt" },
        probe: holdsNothing,
        protection: ok([{ ...entry({ path: dir }), why: forged }]),
      }),
    });
    expect(section.withheld.map((each) => each.why)).toEqual([forged]);
    expect(section.lines).toEqual([
      `chatgpt: NOT SCANNED — ${dir} reaches ${dir}, no-access on the owner's protect list (private repair: ` +
        `${driftRepairCommand({ source: "chatgpt" })}); none of it was read, so there is no count and no repair line`,
    ]);
  });

  it("does not fail --check on a withheld source alone, and still fails it on a measured gap", async () => {
    writeBronze({ basename: "2026-11-20_2026-11-21.jsonl", source: "chatgpt" });
    const withheldOnly = driftSection({
      drift: await statusDrift({
        args: { ...STATUS_ARGS, home },
        probe: holdsNothing,
        protection: ok([entry({ path: chatgptDir() })]),
      }),
    });
    expect(withheldOnly.withheld.map((each) => each.source)).toEqual(["chatgpt"]);
    expect(statusExit({ check: true, section: withheldOnly })).toBe(EXIT_OK);
    const measured = driftSection({
      drift: await statusDrift({ args: { ...STATUS_ARGS, home }, probe: holdsNothing, protection: ok([]) }),
    });
    expect(measured.reports.find((report) => report.source === "chatgpt")!.missing).toBe(1);
    expect(statusExit({ check: true, section: measured })).toBe(EXIT_ERROR);
  });

  it("measures nothing when the protect list cannot be read, which --check fails", async () => {
    writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", source: "calendar" });
    const unknown: StoreError = UNKNOWN;
    const section = driftSection({
      drift: await statusDrift({ args: { ...STATUS_ARGS, home }, probe: holdsNothing, protection: err(unknown) }),
    });
    expect(section.lines).toEqual([`bronze drift: NOT MEASURED — ${UNKNOWN.message}`]);
    expect(section.reports).toEqual([]);
    expect(statusExit({ check: true, section })).toBe(EXIT_ERROR);
    expect(statusExit({ check: false, section })).toBe(EXIT_OK);
  });
});

describe("store ingest's preflight", () => {
  it("refuses the printed repair line's source before the store is opened", () => {
    writeBronze({ basename: "2026-11-20_2026-11-21.jsonl", source: "chatgpt" });
    const dir = chatgptDir();
    const refused = unwrapErr(
      ingestPreflight({ args: { ...INGEST_ARGS, home, source: "chatgpt" }, protection: ok([entry({ path: dir })]) }),
    );
    expect(refused).toEqual(StoreErrors.bronzeProtected({ path: dir, protectedPath: dir, why: WHY }));
    expect(refused.message).toContain("A session never takes a path off the protect list");
  });

  it("refuses a --file under a no-access path", () => {
    const path = writeBronze({ basename: "2026-11-20_2026-11-21.jsonl", source: "chatgpt" });
    const dir = chatgptDir();
    expect(
      unwrapErr(
        ingestPreflight({ args: { ...INGEST_ARGS, file: path, home }, protection: ok([entry({ path: dir })]) }),
      ),
    ).toEqual(StoreErrors.bronzeProtected({ path, protectedPath: dir, why: WHY }));
  });

  it("lists --source under the invocation's own --home", () => {
    const path = writeBronze({ basename: "2026-09-17_2026-09-18.jsonl", source: "calendar" });
    const cleared = unwrap(ingestPreflight({ args: { ...INGEST_ARGS, home, source: "calendar" }, protection: ok([]) }));
    expect(cleared).toEqual({
      files: [{ bytes: Buffer.byteLength(`${line({ sourceId: "calendar-1" })}\n`), path }],
      kind: "source",
      protection: [],
      source: "calendar",
    });
  });

  it("refuses everything when the protect list cannot be read", () => {
    const unknown: StoreError = UNKNOWN;
    expect(
      unwrapErr(ingestPreflight({ args: { ...INGEST_ARGS, home, source: "calendar" }, protection: err(unknown) })),
    ).toEqual(UNKNOWN);
  });
});
