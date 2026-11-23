/**
 * The witness that publication correctness is MANDATORY, and the lost update is closed.
 *
 * The counterexample this exists to hold down is a Codex review pass's, verbatim, against the zero-evidence-
 * loss guard that landed before it:
 *
 * > With the hatch unset, start from a valid generation whose `page` kind has 0 entities. Writer A publishes
 * > a valid empty walk observation and is descheduled after `refuseEvidenceLoss` admits 0 → 0 but before
 * > `swapGeneration`. Writer B then publishes one page entity and completes. When A resumes, `publishAtlas`
 * > does not re-read the live kind or perform a compare-and-swap, so it installs its already-approved empty
 * > file over B's one-entity file: 1 → 0 while the hatch is closed.
 *
 * So every guard that landed before this is a guarantee about ONE writer. These tests are about two, and
 * they go through the REAL `publishAtlas` against a real temporary directory — the property is about the
 * STORE, and a pure refusal some caller forgot to wire would pass a unit test while leaving the store
 * loseable.
 *
 * The interleave is expressed by DERIVATION BASIS rather than by threads, and that is exact rather than a
 * simplification: `derivedFrom` IS the moment writer A read, so a candidate carrying A's basis after B has
 * published is precisely the descheduled writer resuming. No scheduler can produce a state this does not.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { acquireOperationLock } from "../../../../admit/operationLock.js";
import { atlasMutationLockKey, withAtlasMutationLock } from "../../../../atlas/kit/mutationLock.js";
import { publishAtlas } from "../../../../atlas/kit/publish.js";
import { resetAtlas } from "../../../../atlas/kit/reset.js";
import { type AtlasStorePaths, type AtlasStoreSpec, readKindFile, readManifest } from "../../../../atlas/kit/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-14T00:00:00.000Z";
const KINDS = ["page"] as const;
type Kind = (typeof KINDS)[number];

const statusSchema = z
  .object({
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z.null(),
    lastSuccessAt: z.string().nullable(),
  })
  .strict();
const fileSchema = z
  .object({
    entities: z.array(z.object({ id: z.string().min(1) }).strict()),
    kind: z.enum(KINDS),
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const manifestSchema = z
  .object({
    kinds: z.record(z.enum(KINDS), statusSchema),
    note: z.string(),
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
  })
  .strict();
type File = z.infer<typeof fileSchema>;
type Manifest = z.infer<typeof manifestSchema>;

const PLATFORM = "example";

const SPEC: AtlasStoreSpec<Kind, File, Manifest> = {
  kindObligations: { exceptions: { page: { rule: "optional", why: "probe" } } },
  kindVolumes: { verdicts: [] },
  kinds: KINDS,
  parseKindFile: ({ json }) => fileSchema.safeParse(json),
  parseManifest: ({ json }) => manifestSchema.safeParse(json),
  platform: PLATFORM,
  schemaVersion: 1,
  supersedeRemedy: "run: slopweaver atlas example reset",
};

const roots: string[] = [];

/** A throwaway home, removed after the test that made it. Nothing here writes to the ambient one. */
function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atlas-cas-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function paths({ root }: { root: string }): AtlasStorePaths<Kind> {
  const directory = join(root, PLATFORM);
  return {
    directory,
    home: root,
    kinds: { page: join(directory, "pages.jsonl") },
    manifest: join(directory, "manifest.json"),
    superseded: join(root, "_superseded", PLATFORM),
  };
}

function file({ ids }: { ids: readonly string[] }): File {
  return { entities: ids.map((id) => ({ id })), kind: "page", schemaVersion: 1, updatedAt: AT };
}

/** A manifest whose `note` a test can vary independently of its clock — see the shared-clock case below. */
function manifest({ note = "" }: { note?: string } = {}): Manifest {
  return {
    kinds: { page: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: AT } },
    note,
    schemaVersion: 1,
    updatedAt: AT,
  };
}

/** The generation the store holds right now — what an honest caller passes as its derivation basis. */
function live({ paths: resolved }: { paths: AtlasStorePaths<Kind> }): Manifest | null {
  return unwrap(readManifest({ paths: resolved, spec: SPEC }));
}

/** How many entities the `page` kind holds on disk, which is what the lost update destroys. */
function storedPageCount({ paths: resolved }: { paths: AtlasStorePaths<Kind> }): number {
  return unwrap(readKindFile({ kind: "page", paths: resolved, spec: SPEC }))!.entities.length;
}

describe("two writers derived from the same generation", () => {
  it("lands the first and REFUSES the second, so the first writer's rows survive", () => {
    const resolved = paths({ root: scratchRoot() });
    unwrap(
      publishAtlas({
        derivedFrom: null,
        files: { page: file({ ids: [] }) },
        manifest: manifest(),
        paths: resolved,
        spec: SPEC,
      }),
    );
    // Both writers read generation A. This is the descheduling: A's basis is captured and then B completes.
    const readByBoth = live({ paths: resolved });

    const b = publishAtlas({
      derivedFrom: readByBoth,
      files: { page: file({ ids: ["p1"] }) },
      manifest: manifest(),
      paths: resolved,
      spec: SPEC,
    });
    const a = publishAtlas({
      derivedFrom: readByBoth,
      files: { page: file({ ids: [] }) },
      manifest: manifest(),
      paths: resolved,
      spec: SPEC,
    });

    expect(b.isOk()).toBe(true);
    expect(unwrapErr(a).join(" ")).toContain(`another writer published a ${PLATFORM} generation`);
    expect(storedPageCount({ paths: resolved })).toBe(1);
  });

  it("says nothing was written, so the loser cannot read its refusal as a partial publish", () => {
    const resolved = paths({ root: scratchRoot() });
    unwrap(
      publishAtlas({
        derivedFrom: null,
        files: { page: file({ ids: [] }) },
        manifest: manifest(),
        paths: resolved,
        spec: SPEC,
      }),
    );
    const readByBoth = live({ paths: resolved });
    unwrap(
      publishAtlas({
        derivedFrom: readByBoth,
        files: { page: file({ ids: ["p1"] }) },
        manifest: manifest(),
        paths: resolved,
        spec: SPEC,
      }),
    );

    const refused = unwrapErr(
      publishAtlas({
        derivedFrom: readByBoth,
        files: { page: file({ ids: [] }) },
        manifest: manifest(),
        paths: resolved,
        spec: SPEC,
      }),
    );

    expect(refused.at(-1)).toContain("nothing was written");
  });

  // `updatedAt` is DERIVED from the kind files a generation vouches for, so two candidates built in the same
  // second legitimately carry the same one. A compare-and-swap on the clock alone would admit the loser.
  it("detects a replacement whose clock is IDENTICAL and whose content differs", () => {
    const resolved = paths({ root: scratchRoot() });
    unwrap(
      publishAtlas({
        derivedFrom: null,
        files: { page: file({ ids: [] }) },
        manifest: manifest({ note: "first" }),
        paths: resolved,
        spec: SPEC,
      }),
    );
    const readByBoth = live({ paths: resolved });
    unwrap(
      publishAtlas({
        derivedFrom: readByBoth,
        files: { page: file({ ids: [] }) },
        manifest: manifest({ note: "second" }),
        paths: resolved,
        spec: SPEC,
      }),
    );
    const nowOnDisk = live({ paths: resolved })!;

    expect(nowOnDisk.updatedAt).toBe(readByBoth!.updatedAt);
    expect(
      unwrapErr(
        publishAtlas({
          derivedFrom: readByBoth,
          files: { page: file({ ids: [] }) },
          manifest: manifest({ note: "third" }),
          paths: resolved,
          spec: SPEC,
        }),
      ).join(" "),
    ).toContain("another writer published");
  });
});

describe("a null derivation basis", () => {
  it("lands when the store really is empty", () => {
    const resolved = paths({ root: scratchRoot() });

    const published = publishAtlas({
      derivedFrom: null,
      files: { page: file({ ids: ["p1"] }) },
      manifest: manifest(),
      paths: resolved,
      spec: SPEC,
    });

    expect(published.isOk()).toBe(true);
  });

  // The candidate republishes the SAME rows, so no other guard has anything to object to and the
  // compare-and-swap is the only thing that can refuse it. A candidate emptying `page` instead would be
  // caught by the single-writer evidence-loss guard, and this test would still pass with the swap deleted.
  it("REFUSES once a generation exists, and leaves its bytes exactly as they were", () => {
    const resolved = paths({ root: scratchRoot() });
    unwrap(
      publishAtlas({
        derivedFrom: null,
        files: { page: file({ ids: ["p1"] }) },
        manifest: manifest(),
        paths: resolved,
        spec: SPEC,
      }),
    );
    const before = readFileSync(resolved.kinds.page, "utf8");
    const manifestBefore = readFileSync(resolved.manifest, "utf8");

    const refused = unwrapErr(
      publishAtlas({
        derivedFrom: null,
        files: { page: file({ ids: ["p1"] }) },
        manifest: manifest({ note: "over the top" }),
        paths: resolved,
        spec: SPEC,
      }),
    );

    expect(refused.join(" ")).toContain("nothing was written");
    expect(readFileSync(resolved.kinds.page, "utf8")).toBe(before);
    expect(readFileSync(resolved.manifest, "utf8")).toBe(manifestBefore);
  });
});

describe("the mutation lock publishAtlas takes on every publish", () => {
  it("refuses with an exact busy line while another process holds it", () => {
    const root = scratchRoot();
    const resolved = paths({ root });
    const held = unwrap(
      acquireOperationLock({ home: root, key: atlasMutationLockKey({ platform: PLATFORM }), nowIso: AT }),
    );

    const refused = unwrapErr(
      publishAtlas({
        derivedFrom: null,
        files: { page: file({ ids: ["p1"] }) },
        manifest: manifest(),
        nowIso: AT,
        paths: resolved,
        spec: SPEC,
      }),
    );
    held.release();

    expect(refused[0]).toContain(`another process is publishing the ${PLATFORM} atlas`);
    expect(refused.at(-1)).toContain("nothing was written");
  });

  it("publishes once the holder has released it", () => {
    const root = scratchRoot();
    const resolved = paths({ root });
    unwrap(
      acquireOperationLock({ home: root, key: atlasMutationLockKey({ platform: PLATFORM }), nowIso: AT }),
    ).release();

    const published = publishAtlas({
      derivedFrom: null,
      files: { page: file({ ids: ["p1"] }) },
      manifest: manifest(),
      nowIso: AT,
      paths: resolved,
      spec: SPEC,
    });

    expect(published.isOk()).toBe(true);
  });

  it("lets a caller holding a lease publish from inside its own transaction, rather than deadlocking", () => {
    const root = scratchRoot();
    const resolved = paths({ root });

    const written = withAtlasMutationLock({
      home: root,
      mutate: ({ lease }) =>
        publishAtlas({
          derivedFrom: null,
          files: { page: file({ ids: ["p1"] }) },
          lease,
          manifest: manifest(),
          paths: resolved,
          spec: SPEC,
        }),
      nowIso: AT,
      platform: PLATFORM,
    });

    expect(unwrap(written)).toEqual([resolved.kinds.page, resolved.manifest]);
  });

  it("REFUSES a lease taken for a different atlas, which would wave the publish past the mutex", () => {
    const root = scratchRoot();
    const resolved = paths({ root });

    const refused = unwrapErr(
      withAtlasMutationLock({
        home: root,
        mutate: ({ lease }) =>
          publishAtlas({
            derivedFrom: null,
            files: { page: file({ ids: ["p1"] }) },
            lease,
            manifest: manifest(),
            paths: resolved,
            spec: SPEC,
          }),
        nowIso: AT,
        platform: "another-atlas",
      }),
    );

    expect(refused[0]).toContain("taken for another-atlas");
    expect(refused[0]).toContain("nothing was written");
  });

  it("lets reset archive and republish under one held lock", () => {
    const resolved = paths({ root: scratchRoot() });
    unwrap(
      publishAtlas({
        derivedFrom: null,
        files: { page: file({ ids: ["p1"] }) },
        manifest: manifest(),
        paths: resolved,
        spec: SPEC,
      }),
    );

    const outcome = unwrap(
      resetAtlas({
        at: AT,
        emptyFiles: { page: file({ ids: [] }) },
        emptyManifest: manifest(),
        paths: resolved,
        spec: SPEC,
      }),
    );

    expect(outcome.archivedTo).toContain("_superseded");
    expect(storedPageCount({ paths: resolved })).toBe(0);
  });
});
