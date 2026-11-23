/*
 * Reading an archived manifest and checking a generation's bytes against it, on real files.
 *
 * The restore round trip that decides on these answers has its own test; this one pins the two answers
 * themselves, exactly, without a rename in the way.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { digestOfKindFile } from "../../../../atlas/atlasFile.js";
import { digestDisagreements, type ManifestHeader, readManifestHeader } from "../../../../atlas/kit/archiveManifest.js";

const UPDATED_AT = "2026-09-10T11:04:02.693Z";
const ENVELOPE_AT = "2026-09-10T00:00:00.000Z";

const ROOTS: string[] = [];

afterEach(() => {
  for (const root of ROOTS.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function mintRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atlas-archive-manifest-"));
  ROOTS.push(root);
  return root;
}

function writeText({ path, text }: { path: string; text: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

/** The envelope line a kind file opens with, then one entity per line. */
function writeKindFile({ path, kind, ids }: { path: string; kind: string; ids: readonly string[] }): void {
  const envelope = JSON.stringify({ entities: [], kind, schemaVersion: 1, updatedAt: ENVELOPE_AT });
  writeText({ path, text: [envelope, ...ids.map((id) => JSON.stringify({ id }))].join("\n") + "\n" });
}

function digestOf({ kind, ids }: { kind: string; ids: readonly string[] }): string {
  return digestOfKindFile({
    entities: ids.map((id) => ({ id })),
    envelope: { entities: [], kind, schemaVersion: 1, updatedAt: ENVELOPE_AT },
  });
}

function headerWith({ kinds }: { kinds: ManifestHeader["kinds"] }): ManifestHeader {
  return { entityCount: 0, kinds, schemaVersion: 1, updatedAt: UPDATED_AT };
}

/** Where a platform's live kinds sit, and the archived generation they rebase onto. */
function layout({ root }: { root: string }): {
  archived: string;
  directory: string;
  kinds: Readonly<Record<string, string>>;
} {
  const directory = join(root, "live");
  return {
    archived: join(root, "archived"),
    directory,
    kinds: { alpha: join(directory, "alpha.jsonl"), beta: join(directory, "nested", "beta.jsonl") },
  };
}

describe("readManifestHeader", () => {
  it("reads the header, totalling entities across every kind", () => {
    const path = join(mintRoot(), "manifest.json");
    writeText({
      path,
      text: JSON.stringify({
        kinds: {
          alpha: { digest: "abc", entityCount: 2, lastAttempt: null },
          beta: { digest: null, entityCount: 0 },
        },
        schemaVersion: 3,
        updatedAt: UPDATED_AT,
      }),
    });

    expect(readManifestHeader({ path })).toEqual({
      entityCount: 2,
      kinds: new Map([
        ["alpha", { digest: "abc", entityCount: 2 }],
        ["beta", { digest: null, entityCount: 0 }],
      ]),
      schemaVersion: 3,
      updatedAt: UPDATED_AT,
    });
  });

  it("answers null when the manifest is absent", () => {
    expect(readManifestHeader({ path: join(mintRoot(), "manifest.json") })).toBe(null);
  });

  it("answers null when the manifest is not JSON", () => {
    const path = join(mintRoot(), "manifest.json");
    writeText({ path, text: "{not json" });

    expect(readManifestHeader({ path })).toBe(null);
  });

  it("refuses a string entity count rather than coercing it to a legitimate zero", () => {
    const path = join(mintRoot(), "manifest.json");
    writeText({
      path,
      text: JSON.stringify({
        kinds: { alpha: { digest: null, entityCount: "0" } },
        schemaVersion: 1,
        updatedAt: UPDATED_AT,
      }),
    });

    expect(readManifestHeader({ path })).toBe(null);
  });

  it("refuses a kind the schema's rebuild would swallow, by counting the raw document's keys", () => {
    const path = join(mintRoot(), "manifest.json");
    const proto = '"__proto__":{"digest":null,"entityCount":1}';
    writeText({ path, text: `{"kinds":{${proto}},"schemaVersion":1,"updatedAt":"${UPDATED_AT}"}` });

    expect(readManifestHeader({ path })).toBe(null);
  });
});

describe("digestDisagreements", () => {
  it("finds no disagreement when every kind's bytes match, rebasing a nested kind by its relative path", () => {
    const { archived, directory, kinds } = layout({ root: mintRoot() });
    writeKindFile({ ids: ["a1", "a2"], kind: "alpha", path: join(archived, "alpha.jsonl") });
    writeKindFile({ ids: ["b1"], kind: "beta", path: join(archived, "nested", "beta.jsonl") });
    const header = headerWith({
      kinds: new Map([
        ["alpha", { digest: digestOf({ ids: ["a1", "a2"], kind: "alpha" }), entityCount: 2 }],
        ["beta", { digest: digestOf({ ids: ["b1"], kind: "beta" }), entityCount: 1 }],
      ]),
    });

    expect(digestDisagreements({ directory, header, kinds, root: archived })).toEqual([]);
  });

  it("names both digests when the archived bytes differ from the manifest", () => {
    const { archived, directory, kinds } = layout({ root: mintRoot() });
    writeKindFile({ ids: ["tampered"], kind: "alpha", path: join(archived, "alpha.jsonl") });
    const recorded = digestOf({ ids: ["a1"], kind: "alpha" });
    const measured = digestOf({ ids: ["tampered"], kind: "alpha" });
    const header = headerWith({ kinds: new Map([["alpha", { digest: recorded, entityCount: 1 }]]) });

    expect(digestDisagreements({ directory, header, kinds, root: archived })).toEqual([
      `  alpha: digest ${measured.slice(0, 12)} does not match the manifest's ${recorded.slice(0, 12)}`,
    ]);
  });

  it("refuses a digest vouching for a file the archive does not hold", () => {
    const { archived, directory, kinds } = layout({ root: mintRoot() });
    const header = headerWith({ kinds: new Map([["alpha", { digest: "abc", entityCount: 1 }]]) });

    expect(digestDisagreements({ directory, header, kinds, root: archived })).toEqual([
      "  alpha: the manifest vouches for a file the archive does not hold",
    ]);
  });

  it("refuses a kind this build does not map, including one spelled like a prototype key", () => {
    const { archived, directory, kinds } = layout({ root: mintRoot() });
    const header = headerWith({
      kinds: new Map([
        ["ghost", { digest: null, entityCount: 1 }],
        ["__proto__", { digest: null, entityCount: 1 }],
      ]),
    });

    expect(digestDisagreements({ directory, header, kinds, root: archived })).toEqual([
      "  ghost: the manifest names a kind this build does not map, so its file cannot be located or verified",
      "  __proto__: the manifest names a kind this build does not map, so its file cannot be located or verified",
    ]);
  });

  it("refuses a kind claiming entities with no digest", () => {
    const { archived, directory, kinds } = layout({ root: mintRoot() });
    const header = headerWith({ kinds: new Map([["alpha", { digest: null, entityCount: 2 }]]) });

    expect(digestDisagreements({ directory, header, kinds, root: archived })).toEqual([
      "  alpha: the manifest records no digest and 2 entities, so its bytes cannot be verified",
    ]);
  });

  it("allows an undigested empty kind whose file is absent or holds a real envelope", () => {
    const { archived, directory, kinds } = layout({ root: mintRoot() });
    writeKindFile({ ids: [], kind: "beta", path: join(archived, "nested", "beta.jsonl") });
    const header = headerWith({
      kinds: new Map([
        ["alpha", { digest: null, entityCount: 0 }],
        ["beta", { digest: null, entityCount: 0 }],
      ]),
    });

    expect(digestDisagreements({ directory, header, kinds, root: archived })).toEqual([]);
  });

  it("refuses an undigested empty kind whose file holds entities", () => {
    const { archived, directory, kinds } = layout({ root: mintRoot() });
    writeKindFile({ ids: ["a1"], kind: "alpha", path: join(archived, "alpha.jsonl") });
    const header = headerWith({ kinds: new Map([["alpha", { digest: null, entityCount: 0 }]]) });

    expect(digestDisagreements({ directory, header, kinds, root: archived })).toEqual([
      "  alpha: the manifest records it empty and carries no digest, but its file holds 1 entities",
    ]);
  });

  it("refuses an undigested empty kind whose first record is no envelope", () => {
    const { archived, directory, kinds } = layout({ root: mintRoot() });
    writeText({ path: join(archived, "alpha.jsonl"), text: '{"garbage":true}\n' });
    const header = headerWith({ kinds: new Map([["alpha", { digest: null, entityCount: 0 }]]) });

    expect(digestDisagreements({ directory, header, kinds, root: archived })).toEqual([
      "  alpha: the manifest records it empty and carries no digest, and its file holds no readable envelope",
    ]);
  });
});
