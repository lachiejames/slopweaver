/**
 * The archive/restore round trip, against a real filesystem.
 *
 * A temp-directory round trip rather than a seam, because every property here IS a filesystem one: that a
 * restore moves directories and deletes neither, that a rollback puts the displaced generation back, and
 * that an archive whose bytes disagree with its own manifest is refused before anything moves.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AtlasArchivePaths, listAtlasArchives, restoreAtlasArchive } from "../../../../atlas/kit/archive.js";
import { atlasGenerationErrorLines } from "../../../../atlas/kit/generationErrors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const ROOTS: string[] = [];

afterEach(() => {
  for (const root of ROOTS.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function mintRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atlas-archive-"));
  ROOTS.push(root);
  return root;
}

function paths({ root }: { root: string }): AtlasArchivePaths {
  const directory = join(root, "example");
  return {
    directory,
    kinds: { alpha: join(directory, "alpha.jsonl"), beta: join(directory, "nested", "beta.jsonl") },
    manifest: join(directory, "manifest.json"),
    superseded: join(root, "_superseded", "example"),
  };
}

/** One entity per line after the envelope, exactly as `writeAtomicKindFile` lays a kind file out. */
function kindFileLines({ kind, ids }: { kind: string; ids: readonly string[] }): string {
  const envelope = `{"entities":[],"kind":"${kind}","schemaVersion":1,"updatedAt":"2026-09-10T00:00:00.000Z"}\n`;
  return envelope + ids.map((id) => `{"id":"${id}"}\n`).join("");
}

/**
 * Write a whole generation under `directory`, and answer the digests its manifest should vouch for.
 *
 * Digests are taken from the kit's own hasher over the same parts the writer emits, so a test never
 * hand-computes one — a hand-computed digest would pass against itself and prove nothing about the store.
 */
function writeGeneration({
  directory,
  schemaVersion,
  alpha,
  beta,
  digests,
}: {
  directory: string;
  schemaVersion: number;
  alpha: readonly string[];
  beta: readonly string[];
  digests: { alpha: string; beta: string };
}): void {
  mkdirSync(join(directory, "nested"), { recursive: true });
  writeFileSync(join(directory, "alpha.jsonl"), kindFileLines({ ids: alpha, kind: "alpha" }), "utf8");
  writeFileSync(join(directory, "nested", "beta.jsonl"), kindFileLines({ ids: beta, kind: "beta" }), "utf8");
  writeFileSync(
    join(directory, "manifest.json"),
    `${JSON.stringify(
      {
        kinds: {
          alpha: { digest: digests.alpha, entityCount: alpha.length, lastAttempt: null, lastSuccessAt: null },
          beta: { digest: digests.beta, entityCount: beta.length, lastAttempt: null, lastSuccessAt: null },
        },
        schemaVersion,
        updatedAt: "2026-09-10T11:04:02.693Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/** The digest the kit computes for a kind file with these ids — read back through the kit, never guessed. */
async function digestFor({ kind, ids }: { kind: string; ids: readonly string[] }): Promise<string> {
  const { digestOfKindFile } = await import("../../../../atlas/atlasFile.js");
  return digestOfKindFile({
    entities: ids.map((id) => ({ id })),
    envelope: { entities: [], kind, schemaVersion: 1, updatedAt: "2026-09-10T00:00:00.000Z" },
  });
}

async function seedArchive({
  root,
  archiveId,
  schemaVersion = 1,
  alpha = ["a1", "a2", "a3"],
  beta = ["b1"],
}: {
  root: string;
  archiveId: string;
  schemaVersion?: number;
  alpha?: readonly string[];
  beta?: readonly string[];
}): Promise<void> {
  const resolved = paths({ root });
  writeGeneration({
    alpha,
    beta,
    digests: {
      alpha: await digestFor({ ids: alpha, kind: "alpha" }),
      beta: await digestFor({ ids: beta, kind: "beta" }),
    },
    directory: join(resolved.superseded, archiveId),
    schemaVersion,
  });
}

async function seedLive({ root, schemaVersion = 1 }: { root: string; schemaVersion?: number }): Promise<void> {
  const resolved = paths({ root });
  writeGeneration({
    alpha: [],
    beta: [],
    digests: { alpha: await digestFor({ ids: [], kind: "alpha" }), beta: await digestFor({ ids: [], kind: "beta" }) },
    directory: resolved.directory,
    schemaVersion,
  });
}

describe("listAtlasArchives", () => {
  it("answers an empty list when the atlas has archived nothing", () => {
    expect(unwrap(listAtlasArchives({ paths: paths({ root: mintRoot() }) }))).toEqual([]);
  });

  it("reports each archive's schema, clock and total entities, newest first", async () => {
    const root = mintRoot();
    await seedArchive({ archiveId: "2026-09-04T06-12-50.738Z", root });
    await seedArchive({ alpha: ["only"], archiveId: "2026-09-10T12-22-29.229Z", beta: [], root });

    const listed = unwrap(listAtlasArchives({ paths: paths({ root }) }));
    expect(listed).toHaveLength(2);
    expect(listed[0]?.archiveId).toBe("2026-09-10T12-22-29.229Z");
    expect(listed[0]?.entityCount).toBe(1);
    expect(listed[0]?.schemaVersion).toBe(1);
    expect(listed[0]?.updatedAt).toBe("2026-09-10T11:04:02.693Z");
    expect(listed[1]?.archiveId).toBe("2026-09-04T06-12-50.738Z");
    expect(listed[1]?.entityCount).toBe(4);
  });

  it("reports an archive whose manifest cannot be read rather than hiding it", () => {
    const root = mintRoot();
    const resolved = paths({ root });
    mkdirSync(join(resolved.superseded, "2026-09-01T00-00-00.000Z"), { recursive: true });

    const listed = unwrap(listAtlasArchives({ paths: resolved }));
    expect(listed).toHaveLength(1);
    expect(listed[0]?.schemaVersion).toBe(null);
    expect(listed[0]?.entityCount).toBe(null);
  });
});

describe("restoreAtlasArchive", () => {
  it("installs the archive, archives what it replaced, and names the undo", async () => {
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });

    const restored = unwrap(
      restoreAtlasArchive({ archiveId: "2026-09-10T12-22-29.229Z", at: "2026-09-11T00:00:00.000Z", paths: resolved }),
    );

    expect(restored.undoArchiveId).toBe("2026-09-11T00-00-00.000Z");
    expect(restored.archivedCurrentTo).toBe(join(resolved.superseded, "2026-09-11T00-00-00.000Z"));
    expect(readFileSync(resolved.kinds["alpha"]!, "utf8")).toBe(
      kindFileLines({ ids: ["a1", "a2", "a3"], kind: "alpha" }),
    );
    expect(existsSync(join(resolved.superseded, "2026-09-10T12-22-29.229Z"))).toBe(false);
    expect(existsSync(join(resolved.superseded, "2026-09-11T00-00-00.000Z", "manifest.json"))).toBe(true);
  });

  it("round trips: the undo archive puts the emptied generation back", async () => {
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });

    const restored = unwrap(
      restoreAtlasArchive({ archiveId: "2026-09-10T12-22-29.229Z", at: "2026-09-11T00:00:00.000Z", paths: resolved }),
    );
    const undone = unwrap(
      restoreAtlasArchive({ archiveId: restored.undoArchiveId!, at: "2026-09-11T01:00:00.000Z", paths: resolved }),
    );

    expect(undone.restoredFrom).toBe(join(resolved.superseded, "2026-09-11T00-00-00.000Z"));
    expect(readFileSync(resolved.kinds["alpha"]!, "utf8")).toBe(kindFileLines({ ids: [], kind: "alpha" }));
  });

  it("refuses when there is no live manifest to establish the version this build writes", async () => {
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });
    rmSync(resolved.directory, { recursive: true });
    // With no live manifest the version cannot be established, so this is the refusal rather than a guess.
    const refused = restoreAtlasArchive({
      archiveId: "2026-09-10T12-22-29.229Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: resolved,
    });
    expect(refused.isErr()).toBe(true);
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[0]).toContain("no readable live manifest");
    expect(existsSync(join(resolved.superseded, "2026-09-10T12-22-29.229Z"))).toBe(true);
  });

  it("refuses an archive written at a schema version this build does not write, and moves nothing", async () => {
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root, schemaVersion: 6 });
    await seedLive({ root, schemaVersion: 4 });

    const refused = restoreAtlasArchive({
      archiveId: "2026-09-10T12-22-29.229Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: resolved,
    });

    expect(refused.isErr()).toBe(true);
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[0]).toBe(
      "archive 2026-09-10T12-22-29.229Z declares schema version 6; this build writes version 4",
    );
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "nothing was moved — use a Slopweaver build that writes the archive's version to restore it",
    );
    expect(existsSync(join(resolved.superseded, "2026-09-10T12-22-29.229Z"))).toBe(true);
    expect(existsSync(resolved.directory)).toBe(true);
  });

  it("refuses an archive whose bytes disagree with its own manifest digest", async () => {
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });
    writeFileSync(
      join(resolved.superseded, "2026-09-10T12-22-29.229Z", "alpha.jsonl"),
      kindFileLines({ ids: ["tampered"], kind: "alpha" }),
      "utf8",
    );

    const refused = restoreAtlasArchive({
      archiveId: "2026-09-10T12-22-29.229Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: resolved,
    });

    expect(refused.isErr()).toBe(true);
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[0]).toBe(
      "archive 2026-09-10T12-22-29.229Z does not match its own manifest:",
    );
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[1]).toContain("alpha: digest ");
    expect(existsSync(resolved.directory)).toBe(true);
  });

  it("verifies a kind nested a directory deeper, which a basename rebase would report missing", async () => {
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });
    writeFileSync(
      join(resolved.superseded, "2026-09-10T12-22-29.229Z", "nested", "beta.jsonl"),
      kindFileLines({ ids: ["tampered"], kind: "beta" }),
      "utf8",
    );

    const refused = restoreAtlasArchive({
      archiveId: "2026-09-10T12-22-29.229Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: resolved,
    });

    expect(refused.isErr()).toBe(true);
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[1]).toContain("beta: digest ");
  });

  it("refuses an archive whose kind claims entities but records no digest, so its bytes cannot be checked", async () => {
    // A null digest beside a non-zero entityCount was
    // skipped as "nothing to check", so corrupted bytes were installed over a good live generation.
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });
    const archiveDir = join(resolved.superseded, "2026-09-10T12-22-29.229Z");
    writeFileSync(
      join(archiveDir, "manifest.json"),
      `${JSON.stringify({
        kinds: {
          alpha: { digest: null, entityCount: 1, lastAttempt: null, lastSuccessAt: null },
          beta: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null },
        },
        schemaVersion: 1,
        updatedAt: "2026-09-10T11:04:02.693Z",
      })}\n`,
      "utf8",
    );
    writeFileSync(join(archiveDir, "alpha.jsonl"), "corrupted bytes that are not a kind file\n", "utf8");

    const refused = restoreAtlasArchive({
      archiveId: "2026-09-10T12-22-29.229Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: resolved,
    });

    expect(refused.isErr()).toBe(true);
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "  alpha: the manifest records no digest and 1 entities, so its bytes cannot be verified",
    );
    // `beta` claims to be empty and carries no digest, and its file holds one entity — so it is flagged too.
    // The fixture asserted the opposite until Codex pointed out that an exemption which never reads the file
    // is a promise taken from the document under test. Both kinds are now named, hence four lines.
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[2]).toBe(
      "  beta: the manifest records it empty and carries no digest, but its file holds 1 entities",
    );
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })).toHaveLength(4);
    expect(existsSync(resolved.directory)).toBe(true);
    expect(existsSync(archiveDir)).toBe(true);
  });

  it("refuses an archive naming a kind this build does not map, rather than skipping it as not ours", async () => {
    // A `ghost` kind absent from paths.kinds was skipped entirely, so an
    // archive carrying an unverifiable kind was installed over a healthy live generation.
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });
    const archiveDir = join(resolved.superseded, "2026-09-10T12-22-29.229Z");
    const manifestPath = join(archiveDir, "manifest.json");
    const manifest: {
      kinds: Record<string, { digest: string | null; entityCount: number }>;
      schemaVersion: number;
      updatedAt: string;
    } = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.kinds["ghost"] = { digest: null, entityCount: 1 };
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

    const refused = restoreAtlasArchive({
      archiveId: "2026-09-10T12-22-29.229Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: resolved,
    });

    expect(refused.isErr()).toBe(true);
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "  ghost: the manifest names a kind this build does not map, so its file cannot be located or verified",
    );
    expect(existsSync(resolved.directory)).toBe(true);
    expect(existsSync(archiveDir)).toBe(true);
  });

  it("refuses a manifest kind named __proto__, which a normal object would swallow entirely", async () => {
    // Assigning a `__proto__` key into a plain object sets the prototype and
    // creates no own property, so the kind disappears from every check. The manifest is written as raw text
    // rather than through JSON.stringify of an object literal, because building the fixture in JavaScript
    // hits the very swallowing this guards against.
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });
    const archiveDir = join(resolved.superseded, "2026-09-10T12-22-29.229Z");
    writeFileSync(
      join(archiveDir, "manifest.json"),
      '{"kinds":{"__proto__":{"digest":null,"entityCount":1}},"schemaVersion":1,"updatedAt":"2026-09-10T11:04:02.693Z"}\n',
      "utf8",
    );

    const refused = restoreAtlasArchive({
      archiveId: "2026-09-10T12-22-29.229Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: resolved,
    });

    expect(refused.isErr()).toBe(true);
    // The strict header parse refuses the whole manifest, which is stronger than catching the kind later.
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[0]).toBe(
      "archive 2026-09-10T12-22-29.229Z has no readable manifest, so what it holds cannot be established",
    );
    expect(existsSync(resolved.directory)).toBe(true);
    expect(existsSync(archiveDir)).toBe(true);
  });

  it("refuses a kind whose entity count is not a number, rather than reading it as an empty kind", async () => {
    // A string count coerced to 0, which turned a malformed status into the
    // one shape the empty-kind exemption forgives. Absence of a number is not a count of zero.
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });
    const archiveDir = join(resolved.superseded, "2026-09-10T12-22-29.229Z");
    writeFileSync(
      join(archiveDir, "manifest.json"),
      '{"kinds":{"alpha":{"digest":null,"entityCount":"1"}},"schemaVersion":1,"updatedAt":"2026-09-10T11:04:02.693Z"}\n',
      "utf8",
    );

    const refused = restoreAtlasArchive({
      archiveId: "2026-09-10T12-22-29.229Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: resolved,
    });

    expect(refused.isErr()).toBe(true);
    // A string where a count belongs is not a manifest this module reads, so the whole parse refuses.
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[0]).toBe(
      "archive 2026-09-10T12-22-29.229Z has no readable manifest, so what it holds cannot be established",
    );
    expect(existsSync(resolved.directory)).toBe(true);
    expect(existsSync(archiveDir)).toBe(true);
  });

  it("refuses an empty-claiming kind whose file holds no readable envelope", async () => {
    // readKindFileIfPresent returns the first valid-JSON record as the envelope without
    // validating it, so a file holding only `{"garbage":true}` read as an envelope with zero entities and
    // passed the empty-kind arm untouched. Counting entities is not enough; the envelope has to be one.
    const root = mintRoot();
    const resolved = paths({ root });
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });
    await seedLive({ root });
    const archiveDir = join(resolved.superseded, "2026-09-10T12-22-29.229Z");
    writeFileSync(
      join(archiveDir, "manifest.json"),
      '{"kinds":{"alpha":{"digest":null,"entityCount":0}},"schemaVersion":1,"updatedAt":"2026-09-10T11:04:02.693Z"}\n',
      "utf8",
    );
    writeFileSync(join(archiveDir, "alpha.jsonl"), '{"garbage":true}\n', "utf8");

    const refused = restoreAtlasArchive({
      archiveId: "2026-09-10T12-22-29.229Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: resolved,
    });

    expect(refused.isErr()).toBe(true);
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "  alpha: the manifest records it empty and carries no digest, and its file holds no readable envelope",
    );
    expect(existsSync(resolved.directory)).toBe(true);
    expect(existsSync(archiveDir)).toBe(true);
  });

  it("names the archives it does hold when asked for one it does not", async () => {
    const root = mintRoot();
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });

    const refused = restoreAtlasArchive({
      archiveId: "2026-09-09T00-00-00.000Z",
      at: "2026-09-11T00:00:00.000Z",
      paths: paths({ root }),
    });

    expect(refused.isErr()).toBe(true);
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "archives this atlas holds: 2026-09-10T12-22-29.229Z",
    );
  });

  it("refuses an archive id that would climb out of the archive root", async () => {
    const root = mintRoot();
    await seedArchive({ archiveId: "2026-09-10T12-22-29.229Z", root });

    const refused = restoreAtlasArchive({
      archiveId: "../../example",
      at: "2026-09-11T00:00:00.000Z",
      paths: paths({ root }),
    });

    expect(refused.isErr()).toBe(true);
    expect(atlasGenerationErrorLines({ error: unwrapErr(refused) })[0]).toContain("no archive ../../example");
  });
});
