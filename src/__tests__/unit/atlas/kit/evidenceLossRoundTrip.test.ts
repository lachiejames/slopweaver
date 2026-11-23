/**
 * The end-to-end witness for the evidence-loss ruling: a publish through the REAL kit cannot empty a kind the
 * store already holds, and the bytes it refused to replace are still there afterwards.
 *
 * A filesystem round trip rather than a call to `refuseEvidenceLoss` alone, because the property the owner
 * ruled on is about the STORE — *"should not really be even capable of wiping all of your Vanta stuff
 * locally"* — and a pure refusal that some caller forgot to wire would satisfy a unit test while leaving the
 * store wipeable. This publishes, reads back, tries to empty, and reads back again.
 *
 * The witness is checked in both directions: the same publish with the hatch open DOES empty the kind, so
 * the refusal is the thing under test rather than a publish that never worked.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { publishAtlas } from "../../../../atlas/kit/publish.js";
import { resetAtlas } from "../../../../atlas/kit/reset.js";
import { type AtlasStorePaths, type AtlasStoreSpec, readAtlas, readManifest } from "../../../../atlas/kit/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-10T00:00:00.000Z";
const KINDS = ["alpha"] as const;
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
  .object({ kinds: z.record(z.enum(KINDS), statusSchema), schemaVersion: z.literal(1), updatedAt: z.iso.datetime() })
  .strict();
type File = z.infer<typeof fileSchema>;
type Manifest = z.infer<typeof manifestSchema>;

const SPEC: AtlasStoreSpec<Kind, File, Manifest> = {
  kindObligations: {
    exceptions: { alpha: { rule: "optional", why: "probe" } },
  },
  kindVolumes: { verdicts: [] },
  kinds: KINDS,
  parseKindFile: ({ json }) => fileSchema.safeParse(json),
  parseManifest: ({ json }) => manifestSchema.safeParse(json),
  platform: "example",
  schemaVersion: 1,
  supersedeRemedy: "run: slopweaver atlas example reset",
};

/**
 * The generation the store holds right now, as a publish's derivation basis.
 *
 * `publishAtlas` compare-and-swaps against this, so a test that publishes a second time has to say what the
 * second candidate was built ON — which is exactly what a real caller does by reading before it writes.
 * Passing a literal `null` instead would assert the store was empty, and the publish would rightly refuse.
 */
function live({ paths: resolved }: { paths: AtlasStorePaths<Kind> }): Manifest | null {
  return unwrap(readManifest({ paths: resolved, spec: SPEC }));
}

function paths({ root }: { root: string }): AtlasStorePaths<Kind> {
  const directory = join(root, "example");
  return {
    directory,
    home: root,
    kinds: { alpha: join(directory, "alpha.jsonl") },
    manifest: join(directory, "manifest.json"),
    superseded: join(root, "_superseded", "example"),
  };
}
function file({ ids }: { ids: readonly string[] }): File {
  return { entities: ids.map((id) => ({ id })), kind: "alpha", schemaVersion: 1, updatedAt: AT };
}
function manifestOf(): Manifest {
  return manifestSchema.parse({
    kinds: { alpha: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: AT } },
    schemaVersion: 1,
    updatedAt: AT,
  });
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("publishAtlas cannot empty a kind the store already holds", () => {
  it("refuses a complete-looking publish that would take 500 entities to zero, and leaves the bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "zero-wipe-"));
    roots.push(root);
    const resolved = paths({ root });

    const ids = Array.from({ length: 500 }, (_, index) => `entity-${String(index)}`);
    unwrap(
      publishAtlas({
        files: { alpha: file({ ids }) },
        manifest: manifestOf(),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    const before = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect(before.files.alpha?.entities.length).toBe(500);

    const bytesBefore = readFileSync(resolved.kinds.alpha, "utf8");

    const wiped = publishAtlas({
      files: { alpha: file({ ids: [] }) },
      manifest: manifestOf(),
      paths: resolved,
      derivedFrom: live({ paths: resolved }),
      spec: SPEC,
    });

    expect(wiped.isErr()).toBe(true);
    expect(unwrapErr(wiped)[0]).toBe(
      "this example publish would empty a kind the store already holds, so it is refused:",
    );
    expect(unwrapErr(wiped)[1]).toBe("  alpha (emptied): 0 entities / 0 artifact(s), replacing 500 / 0");
    expect(unwrapErr(wiped)[3]).toBe(
      "slopweaver atlas <platform> sync blocked because the publish would empty a kind the atlas already" +
        " holds, or a FAILED run would publish less evidence than the store has — a sync reconciles local" +
        " state with remote, it does not erase it.",
    );
    expect(unwrapErr(wiped)[5]).toContain("SLOPWEAVER_ALLOW_ATLAS_EVIDENCE_LOSS=1");

    const after = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect(after.files.alpha?.entities.length).toBe(500);
    expect(readFileSync(resolved.kinds.alpha, "utf8")).toBe(bytesBefore);
  });

  it("empties the kind when the operator opens the hatch, so the refusal is what the first case measures", () => {
    const root = mkdtempSync(join(tmpdir(), "zero-wipe-"));
    roots.push(root);
    const resolved = paths({ root });
    const previous = process.env["SLOPWEAVER_ALLOW_ATLAS_EVIDENCE_LOSS"];

    unwrap(
      publishAtlas({
        files: { alpha: file({ ids: ["one", "two"] }) },
        manifest: manifestOf(),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );

    process.env["SLOPWEAVER_ALLOW_ATLAS_EVIDENCE_LOSS"] = "1";
    try {
      const emptied = publishAtlas({
        files: { alpha: file({ ids: [] }) },
        manifest: manifestOf(),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      });
      expect(emptied.isOk()).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env["SLOPWEAVER_ALLOW_ATLAS_EVIDENCE_LOSS"];
      } else {
        process.env["SLOPWEAVER_ALLOW_ATLAS_EVIDENCE_LOSS"] = previous;
      }
    }

    expect(unwrap(readAtlas({ paths: resolved, spec: SPEC })).files.alpha?.entities.length).toBe(0);
  });

  it("does not break reset, which installs an empty generation over a full one", () => {
    const root = mkdtempSync(join(tmpdir(), "zero-wipe-"));
    roots.push(root);
    const resolved = paths({ root });

    unwrap(
      publishAtlas({
        files: { alpha: file({ ids: ["a", "b", "c"] }) },
        manifest: manifestOf(),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );

    // The load-bearing ORDER: `resetAtlas` renames the live directory into the archive BEFORE it publishes,
    // so by the time the emptied rule looks for what it would replace there is nothing there. A refactor
    // that published first would be refused by the guard rather than silently wiping — which is the right
    // failure, but it would also break reset, so this pins the ordering rather than trusting it.
    const wasReset = unwrap(
      resetAtlas({
        at: "2026-09-11T00:00:00.000Z",
        emptyFiles: { alpha: file({ ids: [] }) },
        emptyManifest: manifestOf(),
        paths: resolved,
        spec: SPEC,
      }),
    );

    expect(wasReset.archiveId).toBe("2026-09-11T00-00-00.000Z");
    expect(unwrap(readAtlas({ paths: resolved, spec: SPEC })).files.alpha?.entities.length).toBe(0);
  });
});
