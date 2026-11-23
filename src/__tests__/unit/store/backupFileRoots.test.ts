/**
 * Which roots the backup's files leg actually carries, and that each one resolves to its own directory.
 *
 * The two properties here are the ones the compiler cannot reach. `backedUpRootPaths` keys its map by
 * `(typeof BACKED_UP_FILE_ROOTS)[number]`, so a root the list gained and the map did not will not build —
 * but a key pointed at the wrong sibling's path type-checks perfectly, and would back one root up twice
 * while silently losing the other. And nothing in the type system says a root reaches the walk at all.
 *
 * Both are asserted against the constant rather than against a second copy of it, so widening the list
 * again does not redden these tests while a mis-mapped or unwalked root still does.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, unwrap } from "../../../lib/result.js";
import { BackupErrors } from "../../../store/backup/errors.js";
import { fileVanished, isNotFound } from "../../../store/backup/fileRace.js";
import { backedUpRootPaths, walkBackedUpFiles } from "../../../store/backup/files.js";
import { BACKED_UP_FILE_ROOTS, isBackedUpFileEligible } from "../../../store/backup/plan.js";
import { NO_PROTECTION } from "../../../store/backup/protectedPaths.js";
import { digestFile } from "../../../store/backup/stack.js";

const homes: string[] = [];

/** A throwaway home carrying exactly one file under every backed-up root, named for that root. */
function homeWithAFileInEveryRoot(): string {
  const home = mkdtempSync(join(tmpdir(), "backup-roots-"));
  for (const root of BACKED_UP_FILE_ROOTS) {
    const directory = join(home, ...root.split("/"));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "one.jsonl"), `{"root":"${root}"}\n`);
  }
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/**
 * A throwaway home whose `atlas` root carries one file of each shape the real one holds — a binary
 * artifact, a kind file, a manifest, an archived generation, and a withheld companion in both a live and
 * a `_superseded` position. The archived paths carry the archive id `reset` names the slot with, because
 * that level is exactly what the companion's depth turns on.
 *
 * The bytes are fixed and invented here: the point is which PATHS survive the walk, and a fixture built
 * from real atlas content would put provider data in the repository to prove nothing extra.
 */
function homeWithAnAtlas(): string {
  const home = mkdtempSync(join(tmpdir(), "backup-atlas-"));
  const write = ({ at, bytes }: { at: string; bytes: Buffer }): void => {
    const full = join(home, ...at.split("/"));
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, bytes);
  };
  write({ at: "atlas/vanta/artifacts/pages/abc.png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]) });
  write({ at: "atlas/vanta/artifacts/docs/policy.pdf", bytes: Buffer.from("%PDF-1.7\n") });
  write({ at: "atlas/vanta/controls.jsonl", bytes: Buffer.from('{"id":"one"}\n') });
  write({ at: "atlas/vanta/manifest.json", bytes: Buffer.from('{"kinds":[]}\n') });
  write({ at: "atlas/vanta/artifacts/policy-document/_sensitive/source.pdf", bytes: Buffer.from("%PDF-1.7\r") });
  write({ at: "atlas/vanta/_sensitive/financial/e1.json", bytes: Buffer.from('{"amount":1}\n') });
  write({
    at: "atlas/_superseded/vanta/2026-09-05T12-02-41.577Z/controls.jsonl",
    bytes: Buffer.from('{"id":"old"}\n'),
  });
  write({
    at: "atlas/_superseded/vanta/2026-09-05T12-02-41.577Z/_sensitive/financial/e1.json",
    bytes: Buffer.from('{"amount":2}\n'),
  });
  homes.push(home);
  return home;
}

describe("the backed-up roots", () => {
  it("carries the two content-addressed sidecars a bronze record only points at", () => {
    expect(BACKED_UP_FILE_ROOTS).toContain("corpus/attachments");
    expect(BACKED_UP_FILE_ROOTS).toContain("corpus/bodies");
  });

  it("carries atlas, whose artifact rows in Postgres are pointers at files only this root holds", () => {
    expect(BACKED_UP_FILE_ROOTS).toContain("atlas");
  });

  it("carries both page folders, so the backup taken before they are retired can give them back", () => {
    expect(BACKED_UP_FILE_ROOTS).toContain("pages");
    expect(BACKED_UP_FILE_ROOTS).toContain("published-pages");
  });

  it("resolves every root to its own same-named directory under the home", () => {
    expect(BACKED_UP_FILE_ROOTS.length).toBeGreaterThan(0);
    const home = homeWithAFileInEveryRoot();

    const resolved = backedUpRootPaths({ home }).map((path) => relative(home, path).split(sep).join("/"));

    expect(resolved).toEqual([...BACKED_UP_FILE_ROOTS]);
  });

  it("walks a file out of every root, so no root is declared and then skipped", () => {
    expect(BACKED_UP_FILE_ROOTS.length).toBeGreaterThan(0);
    const home = homeWithAFileInEveryRoot();

    const walked = walkBackedUpFiles({ home, protection: NO_PROTECTION });

    expect(walked.isOk()).toBe(true);
    expect(unwrap(walked).files.map((file) => file.relativePath.split(sep).join("/"))).toEqual(
      [...BACKED_UP_FILE_ROOTS].map((root) => `${root}/one.jsonl`).toSorted((left, right) => left.localeCompare(right)),
    );
    expect(unwrap(walked).vanished).toBe(0);
  });

  it("digests each root's own bytes rather than reporting one file twice", () => {
    const home = homeWithAFileInEveryRoot();

    const digests = unwrap(walkBackedUpFiles({ home, protection: NO_PROTECTION })).files.map((file) => file.sha256);

    expect(new Set(digests).size).toBe(BACKED_UP_FILE_ROOTS.length);
  });

  it("skips a root that does not exist, so a fresh install with no attachments still backs up", () => {
    const home = homeWithAFileInEveryRoot();
    rmSync(join(home, "corpus", "attachments"), { force: true, recursive: true });

    const walked = unwrap(walkBackedUpFiles({ home, protection: NO_PROTECTION })).files.map((file) =>
      file.relativePath.split(sep).join("/"),
    );

    expect(walked).not.toContain("corpus/attachments/one.jsonl");
    expect(walked).toContain("corpus/bodies/one.jsonl");
    expect(walked).toHaveLength(BACKED_UP_FILE_ROOTS.length - 1);
  });

  it("walks the atlas media a restored database's artifact pointers would otherwise resolve to nothing", () => {
    const home = homeWithAnAtlas();

    const walked = unwrap(walkBackedUpFiles({ home, protection: NO_PROTECTION })).files.map((file) =>
      file.relativePath.split(sep).join("/"),
    );

    expect(walked).toEqual([
      "atlas/_superseded/vanta/2026-09-05T12-02-41.577Z/controls.jsonl",
      "atlas/vanta/artifacts/docs/policy.pdf",
      "atlas/vanta/artifacts/pages/abc.png",
      "atlas/vanta/artifacts/policy-document/_sensitive/source.pdf",
      "atlas/vanta/controls.jsonl",
      "atlas/vanta/manifest.json",
    ]);
  });

  it("reports the atlas artifact's own length, so the upload's bound is the bytes the digest named", () => {
    const home = homeWithAnAtlas();

    const png = unwrap(walkBackedUpFiles({ home, protection: NO_PROTECTION })).files.find(
      (file) => file.relativePath.split(sep).join("/") === "atlas/vanta/artifacts/pages/abc.png",
    )!;

    expect(png.bytes).toBe(5);
    // printf '\x89\x50\x4e\x47\x0d' | shasum -a 256
    expect(png.sha256).toBe("a8eb710131695aa6b6463346898b51a4d751c1f5771f367f55a0bb52dd9a7e32");
  });

  it("leaves a withheld atlas companion out of the manifest, live and archived alike", () => {
    const home = homeWithAnAtlas();

    const walked = unwrap(walkBackedUpFiles({ home, protection: NO_PROTECTION })).files.map((file) =>
      file.relativePath.split(sep).join("/"),
    );

    expect(walked).not.toContain("atlas/vanta/_sensitive/financial/e1.json");
    expect(walked).not.toContain("atlas/_superseded/vanta/2026-09-05T12-02-41.577Z/_sensitive/financial/e1.json");
  });
});

/*
 * A walk's scratch screenshot, `atlas/trelica/artifacts/pages/<epoch-ms>.png`,
 * was listed by the walk and removed before its digest, and the whole backup failed ENOENT.
 */
describe("a file removed between the listing and its digest", () => {
  const SCRATCH = "atlas/trelica/artifacts/pages/1792080366196.png";

  /** A home with one kept artifact and one scratch screenshot beside it, as the Trelica walk leaves them. */
  function homeWithAScratchScreenshot(): string {
    const home = mkdtempSync(join(tmpdir(), "backup-vanish-"));
    mkdirSync(join(home, "atlas", "trelica", "artifacts", "pages"), { recursive: true });
    writeFileSync(join(home, "atlas", "trelica", "artifacts", "pages", "kept.png"), "kept");
    writeFileSync(join(home, ...SCRATCH.split("/")), "scratch");
    homes.push(home);
    return home;
  }

  it("is omitted and counted, while the file beside it is still carried", () => {
    const home = homeWithAScratchScreenshot();
    // The digest the walk calls removes the scratch file first, exactly as the walk's own `finally` did.
    const racingDigest: typeof digestFile = ({ path }) => {
      if (path.endsWith("1792080366196.png")) {
        rmSync(path);
      }
      return digestFile({ path });
    };

    const walked = unwrap(walkBackedUpFiles({ digest: racingDigest, home, protection: NO_PROTECTION }));

    expect(walked.files.map((file) => file.relativePath.split(sep).join("/"))).toEqual([
      "atlas/trelica/artifacts/pages/kept.png",
    ]);
    expect(walked.vanished).toBe(1);
  });

  it("still fails the walk on any other digest failure", () => {
    const home = homeWithAScratchScreenshot();
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const deniedDigest: typeof digestFile = ({ path }) =>
      err(BackupErrors.artefactDigestFailed({ cause: denied, path }));

    const walked = walkBackedUpFiles({ digest: deniedDigest, home, protection: NO_PROTECTION });

    expect(walked.isErr()).toBe(true);
    expect(walked._unsafeUnwrapErr().code).toBe("ARTEFACT_DIGEST_FAILED");
  });

  it("fails, never skips, a file still in place even when a digest LABELS it vanished", () => {
    const home = homeWithAScratchScreenshot();
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const mislabelling: typeof digestFile = ({ path }) => err(BackupErrors.artefactVanished({ cause: denied, path }));

    const walked = walkBackedUpFiles({ digest: mislabelling, home, protection: NO_PROTECTION });

    expect(walked.isErr()).toBe(true);
    expect(walked._unsafeUnwrapErr().code).toBe("ARTEFACT_VANISHED");
  });

  it("is classified ARTEFACT_VANISHED by the real digest, not only by a fake", () => {
    const home = homeWithAScratchScreenshot();
    const path = join(home, ...SCRATCH.split("/"));
    rmSync(path);

    const digested = digestFile({ path });

    expect(digested.isErr()).toBe(true);
    expect(digested._unsafeUnwrapErr().code).toBe("ARTEFACT_VANISHED");
  });

  it("counts only an exact ENOENT as not-found — never ENOTDIR, a permission error or a message mentioning it", () => {
    expect(isNotFound({ cause: Object.assign(new Error("gone"), { code: "ENOENT" }) })).toBe(true);
    expect(isNotFound({ cause: Object.assign(new Error("ENOENT: not a dir"), { code: "ENOTDIR" }) })).toBe(false);
    expect(isNotFound({ cause: Object.assign(new Error("denied"), { code: "EACCES" }) })).toBe(false);
    expect(isNotFound({ cause: new Error("ENOENT: no such file or directory") })).toBe(false);
    expect(isNotFound({ cause: "ENOENT" })).toBe(false);
    expect(isNotFound({ cause: null })).toBe(false);
  });

  it("calls an ENOENT vanished only when the file it names is really gone", () => {
    const home = homeWithAScratchScreenshot();
    const path = join(home, ...SCRATCH.split("/"));
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

    expect(fileVanished({ cause: enoent, path })).toBe(false);
    rmSync(path);
    expect(fileVanished({ cause: enoent, path })).toBe(true);
  });

  it("never calls a clone's ENOENT vanished when the directory it writes into is gone, even with the source gone too", () => {
    const home = homeWithAScratchScreenshot();
    const path = join(home, ...SCRATCH.split("/"));
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    rmSync(path);

    expect(fileVanished({ cause: enoent, into: home, path })).toBe(true);
    expect(fileVanished({ cause: enoent, into: join(home, "no-such-snapshot"), path })).toBe(false);
  });

  it("never calls a file vanished when it cannot be looked up, only when the lookup says it is not there", () => {
    const home = homeWithAScratchScreenshot();
    const pages = join(home, "atlas", "trelica", "artifacts", "pages");
    const path = join(home, ...SCRATCH.split("/"));
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    // The file is still there; its directory just cannot be searched, which `existsSync` reads as absent.
    chmodSync(pages, 0o000);
    try {
      expect(fileVanished({ cause: enoent, into: home, path })).toBe(false);
    } finally {
      chmodSync(pages, 0o700);
    }
  });
});

describe("which backed-up files may leave the machine", () => {
  it("never carries an atomic write in flight, whose writer may be dead and whose bytes are partial", () => {
    const temp = "corpus/bronze/slack/compact.jsonl.17469.8f6ba4bd-1c2e-4f3a-9b8d-0e1f2a3b4c5d.tmp";
    expect(isBackedUpFileEligible({ relativePath: temp })).toBe(false);
    expect(isBackedUpFileEligible({ relativePath: `knowledge/${temp.split("/").at(-1)!}` })).toBe(false);
  });

  it("carries a file that merely ends in .tmp, or nearly matches the writer's name", () => {
    expect(isBackedUpFileEligible({ relativePath: "corpus/attachments/notes.tmp" })).toBe(true);
    expect(isBackedUpFileEligible({ relativePath: "corpus/bronze/slack/compact.jsonl.17469.tmp" })).toBe(true);
    expect(
      isBackedUpFileEligible({ relativePath: "corpus/bronze/x.jsonl.12.8F6BA4BD-1C2E-4F3A-9B8D-0E1F2A3B4C5D.tmp" }),
    ).toBe(true);
    expect(
      isBackedUpFileEligible({ relativePath: "corpus/bronze/x.jsonl.12.8f6ba4bd-1c2e-4f3a-9b8d-0e1f2a3b4c5d.tmp.bak" }),
    ).toBe(true);
  });

  it("withholds an atlas companion, in a live generation and in an archived one", () => {
    expect(isBackedUpFileEligible({ relativePath: "atlas/vanta/_sensitive/financial/e1.json" })).toBe(false);
    expect(
      isBackedUpFileEligible({
        relativePath: "atlas/_superseded/vanta/2026-09-05T12-02-41.577Z/_sensitive/financial/e1.json",
      }),
    ).toBe(false);
  });

  it("reads the archived companion's depth off `reset.ts`, which renames the platform directory whole", () => {
    // `atlas/kit/reset.ts` does `renameSync(paths.directory, join(paths.superseded, archiveId))`, so the
    // companion lands BELOW the archive id. A rule that put it beside the id instead still withholds every
    // live companion, and a tree with no archives yet — every fresh install — looks identical either way.
    const underTheId = "atlas/_superseded/vanta/2026-09-05T12-02-41.577Z/_sensitive/financial/e1.json";
    const besideTheId = "atlas/_superseded/vanta/_sensitive/financial/e1.json";

    expect(isBackedUpFileEligible({ relativePath: underTheId })).toBe(false);
    expect(isBackedUpFileEligible({ relativePath: besideTheId })).toBe(true);
  });

  it("carries every other atlas file, including near-matches the rule must not swallow", () => {
    expect(isBackedUpFileEligible({ relativePath: "atlas/vanta/artifacts/pages/abc.png" })).toBe(true);
    expect(isBackedUpFileEligible({ relativePath: "atlas/vanta/_sensitive" })).toBe(true);
    expect(isBackedUpFileEligible({ relativePath: "atlas/vanta/artifacts/_sensitive-preview.png" })).toBe(true);
    expect(isBackedUpFileEligible({ relativePath: "atlas/vanta/_sensitively/named/file.json" })).toBe(true);
  });

  it("carries an artifact directory a provider ID named `_sensitive`, which is not the companion at all", () => {
    // `policyDocumentArtifactPaths` encodes the id, and `_` is unreserved — so the name survives whole.
    expect(
      isBackedUpFileEligible({ relativePath: "atlas/vanta/artifacts/policy-document/_sensitive/source.pdf" }),
    ).toBe(true);
    expect(
      isBackedUpFileEligible({
        relativePath: "atlas/_superseded/vanta/2026-09-05T12-02-41.577Z/artifacts/policy-document/_sensitive/body.md",
      }),
    ).toBe(true);
  });

  it("is scoped to atlas, so a same-named directory under another root is still carried", () => {
    expect(isBackedUpFileEligible({ relativePath: "corpus/bronze/_sensitive/window.jsonl" })).toBe(true);
    expect(isBackedUpFileEligible({ relativePath: "knowledge/lessons.jsonl" })).toBe(true);
  });
});
