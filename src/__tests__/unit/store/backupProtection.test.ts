/**
 * A backup under the owner's protected-path registry: which registries are read and how a bad one holds the run,
 * which places a run may write to, which home places hold it, and what the files leg's walk prunes. Every registry
 * is synthetic and handed in; no test reads the owner's own.
 */
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { type ProtectedPath, renderProtectedPaths } from "../../../protectedPaths/registry.js";
import { stateHomePaths } from "../../../stateHome.js";
import { walkBackedUpFiles } from "../../../store/backup/files.js";
import {
  admitBackupRun,
  type BackupProtection,
  heldRunMayRecord,
  NO_PROTECTION,
  protectedDestinationLines,
  readProtectionFrom,
  refuseProtectedPassphrase,
  resolvedFolder,
  STAGING_ROOT_ROLE,
  sourceProtectionHit,
  spellingsUnderHome,
  withResolvedSpellings,
  writeProtectionHit,
} from "../../../store/backup/protectedPaths.js";
import { BackupProtectionErrors } from "../../../store/backup/protectedPathsErrors.js";
import { digestFile } from "../../../store/backup/stack.js";
import { stagingRoot } from "../../../store/backup/staging.js";

import { removeSandboxHomes, sandboxHome } from "./backupRunWorld.js";

afterEach(() => {
  removeSandboxHomes();
});

const ADDED = "2026-11-01T00:00:00.000Z";

/**
 * One registry entry.
 *
 * @param path the absolute path it protects
 * @param mode what a session may not do there
 * @param why the owner's reason, a fixed fixture one by default
 * @returns the entry
 */
function entry({
  path,
  mode,
  why = "fixture: kept from every session",
}: {
  path: string;
  mode: ProtectedPath["mode"];
  why?: string;
}): ProtectedPath {
  return { addedIso: ADDED, mode, path, why };
}

/**
 * A run's protection over the given entries.
 *
 * @param entries what the owner protects
 * @returns the protection
 */
function protecting({ entries }: { entries: readonly ProtectedPath[] }): BackupProtection {
  return { entries };
}

/**
 * The slash-separated relative paths a walk carried.
 *
 * @param protection what the walk honours
 * @param home the sandbox home
 * @returns each file's path relative to the home
 */
function carried({ protection, home }: { protection: BackupProtection; home: string }): readonly string[] {
  return unwrap(walkBackedUpFiles({ home, protection })).files.map((file) => file.relativePath);
}

describe("reading the registries that apply to a run", () => {
  it("reads an absent registry as protecting nothing", () => {
    const read = readProtectionFrom({ homes: ["/fixture/home"], readText: () => undefined });
    expect(unwrap(read)).toEqual({ entries: [] });
  });

  it("joins every home's entries, and reads a home listed twice once", () => {
    const first = entry({ mode: "no-access", path: "/fixture/one" });
    const second = entry({ mode: "read-only", path: "/fixture/two" });
    const texts = new Map([
      [stateHomePaths({ home: "/fixture/a" }).protectedPathsJson, [first]],
      [stateHomePaths({ home: "/fixture/b" }).protectedPathsJson, [second]],
    ]);
    const read = readProtectionFrom({
      homes: ["/fixture/a", "/fixture/b", "/fixture/a"],
      readText: ({ path }) => renderProtectedPaths({ registry: { paths: texts.get(path)!, schemaVersion: 1 } }),
    });
    expect(unwrap(read).entries).toEqual([first, second]);
  });

  it("holds the run on a registry that does not parse, naming the file", () => {
    const file = stateHomePaths({ home: "/fixture/a" }).protectedPathsJson;
    const read = readProtectionFrom({ homes: ["/fixture/a"], readText: () => "not a registry" });
    const error = unwrapErr(read);
    expect(error.code).toBe("BACKUP_PROTECTION_MALFORMED");
    expect(error.message).toContain(`the protected-path registry ${file} is malformed`);
    expect(error.message).toContain("the backup is HELD");
  });

  it("holds the run on a registry that cannot be read, rather than reading it as empty", () => {
    const read = readProtectionFrom({
      homes: ["/fixture/a"],
      readText: () => {
        throw new Error("EACCES: fixture");
      },
    });
    const error = unwrapErr(read);
    expect(error.code).toBe("BACKUP_PROTECTION_UNREADABLE");
    expect(error.message).toContain("EACCES: fixture");
  });
});

describe("matching an entry by where it really is", () => {
  it("adds the resolved spelling beside the original, resolving only the folder that holds it", () => {
    const original = entry({ mode: "no-access", path: "/linked/vault" });
    const asked: string[] = [];
    const resolved = withResolvedSpellings({
      protection: protecting({ entries: [original] }),
      resolveParent: ({ path }) => {
        asked.push(path);
        return "/real/place";
      },
    });
    expect(resolved.entries).toEqual([original, { ...original, path: "/real/place/vault" }]);
    expect(asked).toEqual(["/linked"]);
  });

  it("adds nothing when the folder resolves to itself or cannot be resolved", () => {
    const original = entry({ mode: "no-access", path: "/plain/vault" });
    const protection = protecting({ entries: [original] });
    expect(withResolvedSpellings({ protection, resolveParent: ({ path }) => path }).entries).toEqual([original]);
    expect(withResolvedSpellings({ protection, resolveParent: () => undefined }).entries).toEqual([original]);
  });
});

describe("which places a run may write to", () => {
  const noAccess = protecting({ entries: [entry({ mode: "no-access", path: "/fixture/vault" })] });
  const readOnly = protecting({ entries: [entry({ mode: "read-only", path: "/fixture/archive" })] });

  it("refuses a place at, under or above a no-access path", () => {
    expect(writeProtectionHit({ protection: noAccess, targets: ["/fixture/vault"] })!.path).toBe("/fixture/vault");
    expect(writeProtectionHit({ protection: noAccess, targets: ["/fixture/vault/backups"] })!.path).toBe(
      "/fixture/vault",
    );
    expect(writeProtectionHit({ protection: noAccess, targets: ["/fixture"] })!.path).toBe("/fixture/vault");
  });

  it("refuses a place at or under a read-only path, and allows one beside or above it", () => {
    expect(writeProtectionHit({ protection: readOnly, targets: ["/fixture/archive"] })!.mode).toBe("read-only");
    expect(writeProtectionHit({ protection: readOnly, targets: ["/fixture/archive/backups"] })!.mode).toBe("read-only");
    expect(writeProtectionHit({ protection: readOnly, targets: ["/fixture"] })).toBe(undefined);
    expect(writeProtectionHit({ protection: readOnly, targets: ["/fixture/archived"] })).toBe(undefined);
  });

  it("refuses on any one spelling of the place, the resolved one included", () => {
    expect(writeProtectionHit({ protection: noAccess, targets: ["/elsewhere/link", "/fixture/vault/x"] })!.path).toBe(
      "/fixture/vault",
    );
  });

  it("reads a source under a read-only path, and never one under a no-access path", () => {
    expect(sourceProtectionHit({ protection: readOnly, targets: ["/fixture/archive/x.jsonl"] })).toBe(undefined);
    expect(sourceProtectionHit({ protection: noAccess, targets: ["/fixture/vault/x.jsonl"] })!.path).toBe(
      "/fixture/vault",
    );
    expect(sourceProtectionHit({ protection: noAccess, targets: ["/fixture"] })).toBe(undefined);
  });
});

describe("admitting a run", () => {
  it("admits a run whose staging root and secrets are clear, handing on the protection it read", () => {
    const home = sandboxHome();
    const protection = protecting({ entries: [entry({ mode: "no-access", path: join(dirname(home), "other") })] });
    expect(unwrap(admitBackupRun({ home, read: () => ok(protection) }))).toEqual(protection);
  });

  it("holds a run whose staging root is protected, and forbids recording into it", () => {
    const home = sandboxHome();
    const staging = stagingRoot({ home });
    const guarded = entry({ mode: "read-only", path: staging });
    const error = unwrapErr(admitBackupRun({ home, read: () => ok(protecting({ entries: [guarded] })) }));
    expect(error).toEqual(
      BackupProtectionErrors.protectedPlace({ entry: guarded, role: STAGING_ROOT_ROLE, target: staging }),
    );
    expect(error.message).toContain(`HELD: the backup staging root ${staging} reaches ${staging}`);
    expect(heldRunMayRecord({ error })).toBe(false);
  });

  it("holds a run whose secrets folder holds a no-access path, and lets it record why", () => {
    const home = sandboxHome();
    const secrets = stateHomePaths({ home }).secrets;
    const guarded = entry({ mode: "no-access", path: join(secrets, "one-token") });
    const error = unwrapErr(admitBackupRun({ home, read: () => ok(protecting({ entries: [guarded] })) }));
    expect(error).toEqual(
      BackupProtectionErrors.protectedPlace({
        entry: guarded,
        role: "the credentials leg's source",
        target: secrets,
      }),
    );
    expect(heldRunMayRecord({ error })).toBe(true);
  });

  it("holds a home given through a link by where its staging root really is", () => {
    const real = sandboxHome();
    const alias = join(dirname(real), "alias-home");
    symlinkSync(real, alias);
    const physicalStaging = stagingRoot({ home: resolvedFolder({ path: real })! });
    const guarded = entry({ mode: "read-only", path: physicalStaging });
    const error = unwrapErr(admitBackupRun({ home: alias, read: () => ok(protecting({ entries: [guarded] })) }));
    expect(error).toEqual(
      BackupProtectionErrors.protectedPlace({
        entry: guarded,
        role: STAGING_ROOT_ROLE,
        target: stagingRoot({ home: alias }),
      }),
    );
    expect(spellingsUnderHome({ home: alias, path: stagingRoot({ home: alias }) })).toEqual([
      stagingRoot({ home: alias }),
      physicalStaging,
    ]);
    rmSync(alias);
  });

  it("holds a home given through a link by where its secrets folder really is", () => {
    const real = sandboxHome();
    const alias = join(dirname(real), "alias-secrets-home");
    symlinkSync(real, alias);
    const guarded = entry({
      mode: "no-access",
      path: stateHomePaths({ home: resolvedFolder({ path: real })! }).secrets,
    });
    const error = unwrapErr(admitBackupRun({ home: alias, read: () => ok(protecting({ entries: [guarded] })) }));
    expect(error).toEqual(
      BackupProtectionErrors.protectedPlace({
        entry: guarded,
        role: "the credentials leg's source",
        target: stateHomePaths({ home: alias }).secrets,
      }),
    );
    rmSync(alias);
  });

  it("refuses a new master password whose file is read-only, which a night reading secrets/ is not", () => {
    const home = sandboxHome();
    const passphrase = join(stateHomePaths({ home }).secrets, "backup-passphrase");
    const guarded = entry({ mode: "read-only", path: passphrase });
    const protection = protecting({ entries: [guarded] });
    expect(unwrapErr(refuseProtectedPassphrase({ home, path: passphrase, protection }))).toEqual(
      BackupProtectionErrors.protectedPlace({
        entry: guarded,
        role: "the master password's file",
        target: passphrase,
      }),
    );
    expect(unwrap(admitBackupRun({ home, read: () => ok(protection) }))).toEqual(protection);
    expect(unwrap(refuseProtectedPassphrase({ home, path: passphrase, protection: NO_PROTECTION }))).toBe(undefined);
  });

  it("spells a place under a home that is no link once", () => {
    const home = resolvedFolder({ path: sandboxHome() })!;
    expect(spellingsUnderHome({ home, path: join(home, "secrets") })).toEqual([join(home, "secrets")]);
  });

  it("forbids recording when the protection itself is unknown", () => {
    const error = BackupProtectionErrors.malformed({ file: "/fixture/protected-paths.json", why: "fixture" });
    expect(heldRunMayRecord({ error })).toBe(false);
    expect(
      heldRunMayRecord({ error: BackupProtectionErrors.unreadable({ file: "/fixture/p.json", why: "fixture" }) }),
    ).toBe(false);
  });
});

describe("which configured destinations --status names as held", () => {
  it("names a destination reached through a link into a protected folder, and passes one that is clear", () => {
    const home = sandboxHome();
    const kept = join(home, "kept");
    const clear = join(home, "clear");
    mkdirSync(kept);
    mkdirSync(clear);
    const link = join(home, "link-to-kept");
    symlinkSync(kept, link);
    const guarded = entry({ mode: "read-only", path: resolvedFolder({ path: kept })! });
    expect(protectedDestinationLines({ protection: protecting({ entries: [guarded] }), roots: [clear, link] })).toEqual(
      [BackupProtectionErrors.protectedPlace({ entry: guarded, role: "destination", target: link }).message],
    );
  });

  it("names nothing when nothing is protected", () => {
    const home = sandboxHome();
    expect(protectedDestinationLines({ protection: NO_PROTECTION, roots: [home, join(home, "absent")] })).toEqual([]);
  });
});

describe("the files leg's walk under protection", () => {
  it("prunes a no-access folder under corpus/bronze, carries its sibling, and names it with the owner's reason", () => {
    const home = sandboxHome();
    const withheld = join(stateHomePaths({ home }).corpus.bronze, "provider");
    mkdirSync(withheld, { recursive: true });
    writeFileSync(join(withheld, "chat.jsonl"), '{"id":"withheld"}\n');
    const protection = protecting({ entries: [entry({ mode: "no-access", path: withheld, why: "fixture: private" })] });
    const walked = unwrap(walkBackedUpFiles({ home, protection }));
    expect(walked.files.map((file) => file.relativePath)).toEqual([
      join("corpus", "bronze", "slack", "6d_2026-09-08.jsonl"),
      join("knowledge", "lessons.jsonl"),
    ]);
    expect(walked.skippedProtectedPaths).toEqual([{ path: withheld, why: "fixture: private" }]);
  });

  it("carries that same folder when nothing protects it, so the prune is what left it out", () => {
    const home = sandboxHome();
    const withheld = join(stateHomePaths({ home }).corpus.bronze, "provider");
    mkdirSync(withheld, { recursive: true });
    writeFileSync(join(withheld, "chat.jsonl"), '{"id":"withheld"}\n');
    expect(carried({ home, protection: NO_PROTECTION })).toContain(join("corpus", "bronze", "provider", "chat.jsonl"));
  });

  it("never lists or digests anything under the protected folder", () => {
    const home = sandboxHome();
    const withheld = join(stateHomePaths({ home }).corpus.bronze, "provider");
    mkdirSync(join(withheld, "deeper"), { recursive: true });
    writeFileSync(join(withheld, "deeper", "chat.jsonl"), '{"id":"withheld"}\n');
    const digested: string[] = [];
    const protection = protecting({ entries: [entry({ mode: "no-access", path: withheld })] });
    // Unlistable as well, so a walk that opened it would fail here rather than pass quietly.
    chmodSync(withheld, 0o000);
    try {
      const walked = walkBackedUpFiles({
        digest: (args) => {
          digested.push(args.path);
          return digestFile(args);
        },
        home,
        protection,
      });
      expect(walked.isOk()).toBe(true);
      // Matched on the folder's own name, since a digest is handed the walk's physical spelling of every file.
      expect(digested.filter((path) => path.includes(join("bronze", "provider")))).toEqual([]);
      expect(digested.length).toBe(2);
    } finally {
      chmodSync(withheld, 0o700);
    }
  });

  it("skips a whole root the owner marked no-access", () => {
    const home = sandboxHome();
    const knowledge = stateHomePaths({ home }).knowledge;
    const walked = unwrap(
      walkBackedUpFiles({ home, protection: protecting({ entries: [entry({ mode: "no-access", path: knowledge })] }) }),
    );
    expect(walked.files.map((file) => file.relativePath)).toEqual([
      join("corpus", "bronze", "slack", "6d_2026-09-08.jsonl"),
    ]);
    expect(walked.skippedProtectedPaths.map((skip) => skip.path)).toEqual([knowledge]);
  });

  it("still carries a read-only source, since a backup only reads it", () => {
    const home = sandboxHome();
    const slack = join(stateHomePaths({ home }).corpus.bronze, "slack");
    const protection = protecting({ entries: [entry({ mode: "read-only", path: slack })] });
    const walked = unwrap(walkBackedUpFiles({ home, protection }));
    expect(walked.files.map((file) => file.relativePath)).toEqual([
      join("corpus", "bronze", "slack", "6d_2026-09-08.jsonl"),
      join("knowledge", "lessons.jsonl"),
    ]);
    expect(walked.skippedProtectedPaths).toEqual([]);
  });

  it("prunes a root that is a link by where it resolves, not only by its spelling", () => {
    const home = sandboxHome();
    const knowledge = stateHomePaths({ home }).knowledge;
    const elsewhere = join(dirname(home), "elsewhere");
    mkdirSync(join(elsewhere, "knowledge"), { recursive: true });
    writeFileSync(join(elsewhere, "knowledge", "lessons.jsonl"), '{"lesson":"withheld"}\n');
    rmSync(knowledge, { force: true, recursive: true });
    symlinkSync(join(elsewhere, "knowledge"), knowledge);
    const protection = withResolvedSpellings({
      protection: protecting({ entries: [entry({ mode: "no-access", path: elsewhere })] }),
      resolveParent: resolvedFolder,
    });
    expect(carried({ home, protection })).toEqual([join("corpus", "bronze", "slack", "6d_2026-09-08.jsonl")]);
    expect(carried({ home, protection: NO_PROTECTION })).toEqual([
      join("corpus", "bronze", "slack", "6d_2026-09-08.jsonl"),
      join("knowledge", "lessons.jsonl"),
    ]);
  });

  it("digests a linked root's file where the walk judged it, so a re-pointed link cannot redirect the read", () => {
    const home = sandboxHome();
    const knowledge = stateHomePaths({ home }).knowledge;
    const elsewhere = join(dirname(home), "elsewhere-digest");
    mkdirSync(join(elsewhere, "knowledge"), { recursive: true });
    writeFileSync(join(elsewhere, "knowledge", "lessons.jsonl"), '{"lesson":"carried"}\n');
    rmSync(knowledge, { force: true, recursive: true });
    symlinkSync(join(elsewhere, "knowledge"), knowledge);
    const digested: string[] = [];
    const walked = unwrap(
      walkBackedUpFiles({
        digest: (args) => {
          digested.push(args.path);
          return digestFile(args);
        },
        home,
        protection: NO_PROTECTION,
      }),
    );
    expect(digested).toContain(join(resolvedFolder({ path: join(elsewhere, "knowledge") })!, "lessons.jsonl"));
    expect(digested).not.toContain(join(knowledge, "lessons.jsonl"));
    expect(walked.files.map((file) => file.relativePath)).toContain(join("knowledge", "lessons.jsonl"));
    rmSync(elsewhere, { force: true, recursive: true });
  });
});
