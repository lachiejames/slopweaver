import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { writeAtomic, writeAtomicKindFile } from "../../../../atlas/atlasFile.js";
import { publishAtlas } from "../../../../atlas/kit/publish.js";
import {
  type AtlasStorePaths,
  type AtlasStoreSpec,
  readAtlas,
  readKindFile,
  readManifest,
} from "../../../../atlas/kit/store.js";
import { incoherentKinds, kindDisagreements, validateGeneration } from "../../../../atlas/kit/storeCoherence.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-04T12:30:00.000Z";
const KINDS = ["zone", "dns-record"] as const;
type Kind = (typeof KINDS)[number];

const statusSchema = z
  .object({
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: z.string(), outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: z.string().nullable(),
  })
  .strict();

/**
 * One loose entity shape across both kinds, carrying its own `kind` — the Cloudflare and Vanta shape, and
 * the reason a mis-routed projection parses clean: the schema cannot tell which file it is validating.
 */
const fileSchema = z
  .object({
    entities: z.array(z.object({ id: z.string().min(1), kind: z.enum(KINDS) }).strict()),
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
  // Every kind optional: this fixture exercises manifest/file coherence, not the obligation gate.
  kindObligations: {
    exceptions: Object.fromEntries(
      KINDS.map((kind) => [
        kind,
        { rule: "optional", why: "this fixture exercises manifest/file coherence, not the obligation gate" } as const,
      ]),
    ),
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
  return {
    directory: join(root, "example"),
    home: root,
    kinds: { "dns-record": join(root, "example", "dns-record.jsonl"), zone: join(root, "example", "zone.jsonl") },
    manifest: join(root, "example", "manifest.json"),
    superseded: join(root, "_superseded", "example"),
  };
}

function file({ kind, ids }: { kind: Kind; ids: readonly Kind[] }): File {
  return {
    entities: ids.map((held, index) => ({ id: `${held}-${String(index)}`, kind: held })),
    kind,
    schemaVersion: 1,
    updatedAt: AT,
  };
}

type Status = Manifest["kinds"]["zone"];

const NEVER_SYNCED: Status = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };

function succeeded({ entityCount }: { entityCount: number }): Status {
  return { digest: null, entityCount, lastAttempt: { at: AT, outcome: "ok", reasons: [] }, lastSuccessAt: AT };
}

function manifest({ zone, dnsRecord }: { zone: Status; dnsRecord: Status }): Manifest {
  return { kinds: { "dns-record": dnsRecord, zone }, schemaVersion: 1, updatedAt: AT };
}

describe("a partial publish cannot claim a file it did not write", () => {
  // Falsifier 1 of the gold bar: a manifest claiming `entityCount` for a kind omitted from the partial set.
  // `stampDigests` only stamps the kinds it is handed, so the omitted kind keeps a null digest while its
  // count and success time move forward — and `gradeKind` afterwards digests the untouched file against the
  // untouched digest and answers `agrees`. This has to refuse at publish, which is what is asserted.
  it("refuses a manifest grading entities for a kind whose file was omitted", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-coherence-"));
    const resolved = paths({ root });
    const failure = unwrapErr(
      publishAtlas({
        files: { zone: file({ ids: ["zone"], kind: "zone" }) },
        manifest: manifest({ dnsRecord: succeeded({ entityCount: 161 }), zone: succeeded({ entityCount: 1 }) }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    expect(failure[0]).toBe(
      "dns-record is graded with 161 entities but carries no file digest — the count describes a file this generation never wrote",
    );
    expect(failure[failure.length - 1]).toBe("nothing was written — this generation is not published");
    expect(unwrap(readManifest({ paths: resolved, spec: SPEC }))).toBe(null);
    rmSync(root, { force: true, recursive: true });
  });

  // The same shape with an EMPTY omitted kind: no count to contradict, only a success time. Without this the
  // check above would pass a kind whose file was never written just because it happens to hold nothing.
  it("refuses a manifest recording a success for an omitted kind even when it claims no entities", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-coherence-"));
    const resolved = paths({ root });
    const failure = unwrapErr(
      publishAtlas({
        files: { zone: file({ ids: ["zone"], kind: "zone" }) },
        manifest: manifest({ dnsRecord: succeeded({ entityCount: 0 }), zone: succeeded({ entityCount: 1 }) }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    expect(failure[0]).toBe(
      `dns-record records a success at ${AT} but carries no file digest, so nothing vouches for the bytes on disk`,
    );
    rmSync(root, { force: true, recursive: true });
  });

  // The boundary, asserted rather than left to be rediscovered. A `lastAttempt` of `ok` with no success time
  // IS an incoherence on an atlas whose sync stamps `ok` only for a kind it read — CrowdStrike's own publish
  // guard refuses it — and is the ordinary shape on the five atlases here that stamp `ok` for a run that
  // completed while never reading the kind. So the kit publishes it, and the platform decides.
  it("publishes a kind recording a successful attempt with no success time, which is the platform's to judge", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-coherence-"));
    const resolved = paths({ root });
    const written = unwrap(
      publishAtlas({
        files: { zone: file({ ids: [], kind: "zone" }) },
        manifest: manifest({
          dnsRecord: NEVER_SYNCED,
          zone: {
            digest: null,
            entityCount: 0,
            lastAttempt: { at: AT, outcome: "ok", reasons: [] },
            lastSuccessAt: null,
          },
        }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    expect(written).toEqual([resolved.kinds.zone, resolved.manifest]);
    rmSync(root, { force: true, recursive: true });
  });

  // The witness that the three refusals above can be satisfied rather than being unconditional: the same
  // partial publish, with the omitted kind claiming nothing, writes exactly the one file it was handed.
  it("publishes a partial set when the omitted kind claims nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-coherence-"));
    const resolved = paths({ root });
    const written = unwrap(
      publishAtlas({
        files: { zone: file({ ids: ["zone"], kind: "zone" }) },
        manifest: manifest({ dnsRecord: NEVER_SYNCED, zone: succeeded({ entityCount: 1 }) }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    expect(written).toEqual([resolved.kinds.zone, resolved.manifest]);
    rmSync(root, { force: true, recursive: true });
  });

  // The read half. A generation written before the publish guard existed carries this shape on disk, and
  // `gradeKind` used to return `agrees` outright for it — the file could hold anything and no comparison
  // could say. Published coherently first, then the manifest's digest is dropped, so the FILE is untouched
  // and the only thing that changed is what vouches for it.
  it("grades a kind claiming a success with no digest as mismatched, not as agreeing", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-coherence-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { "dns-record": file({ ids: [], kind: "dns-record" }), zone: file({ ids: ["zone"], kind: "zone" }) },
        manifest: manifest({ dnsRecord: NEVER_SYNCED, zone: succeeded({ entityCount: 1 }) }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    const agreeing = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect([...agreeing.mismatched]).toEqual([]);

    const published = unwrap(readManifest({ paths: resolved, spec: SPEC }))!;
    unwrap(
      writeAtomic({
        path: resolved.manifest,
        value: { ...published, kinds: { ...published.kinds, zone: { ...published.kinds.zone, digest: null } } },
      }),
    );
    const snapshot = unwrap(readAtlas({ paths: resolved, spec: SPEC }));
    expect([...snapshot.mismatched]).toEqual(["zone"]);
    rmSync(root, { force: true, recursive: true });
  });
});

describe("a kind file cannot hold another kind's entity", () => {
  // Falsifier 2 of the gold bar: one kind's entity written into another kind's file. The platform schema
  // above validates both files with the same shape, so this parses clean and publishes — which is exactly
  // how a zone-setting ends up inside `dns-record.jsonl` and is read back forever as a DNS record.
  it("refuses to publish a file holding an entity of another kind", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-coherence-"));
    const resolved = paths({ root });
    const misrouted = file({ ids: ["dns-record", "zone"], kind: "dns-record" });
    expect(fileSchema.safeParse(misrouted).success).toBe(true);

    const failure = unwrapErr(
      publishAtlas({
        files: { "dns-record": misrouted },
        manifest: manifest({ dnsRecord: succeeded({ entityCount: 2 }), zone: NEVER_SYNCED }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    expect(failure[0]).toBe("refusing to write dns-record: zone-1 is a zone");
    expect(unwrap(readManifest({ paths: resolved, spec: SPEC }))).toBe(null);
    rmSync(root, { force: true, recursive: true });
  });

  it("refuses to publish a file whose own declared kind is not the slot it occupies", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-coherence-"));
    const resolved = paths({ root });
    const failure = unwrapErr(
      publishAtlas({
        files: { "dns-record": file({ ids: [], kind: "zone" }) },
        manifest: manifest({ dnsRecord: NEVER_SYNCED, zone: NEVER_SYNCED }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    expect(failure[0]).toBe("refusing to write dns-record: the file declares kind zone");
    rmSync(root, { force: true, recursive: true });
  });

  // The read half, for the generations already on disk: written past the publish guard by hand, the reader
  // refuses rather than handing a zone back as a DNS record.
  it("refuses to read a file holding an entity of another kind", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-coherence-"));
    const resolved = paths({ root });
    unwrap(
      publishAtlas({
        files: { "dns-record": file({ ids: ["dns-record"], kind: "dns-record" }) },
        manifest: manifest({ dnsRecord: succeeded({ entityCount: 1 }), zone: NEVER_SYNCED }),
        paths: resolved,
        derivedFrom: live({ paths: resolved }),
        spec: SPEC,
      }),
    );
    unwrap(
      writeAtomicKindFile({
        entities: [{ id: "zone-0", kind: "zone" }],
        envelope: { entities: [], kind: "dns-record", schemaVersion: 1, updatedAt: AT },
        path: resolved.kinds["dns-record"],
      }),
    );
    const failure = unwrapErr(readKindFile({ kind: "dns-record", paths: resolved, spec: SPEC }));
    expect(failure[0]).toBe(
      `${resolved.kinds["dns-record"]} does not agree with the kind it is filed under (dns-record)`,
    );
    expect(failure[1]).toBe("  zone-0 is a zone");
    rmSync(root, { force: true, recursive: true });
  });

  // The witness that the read refusal is about the MIS-ROUTING and not about reading a hand-written file:
  // the same bytes with the entity's own kind corrected read back cleanly.
  it("reads a hand-written file back when every entity is the file's own kind", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-kit-coherence-"));
    const resolved = paths({ root });
    unwrap(
      writeAtomicKindFile({
        entities: [{ id: "dns-record-0", kind: "dns-record" }],
        envelope: { entities: [], kind: "dns-record", schemaVersion: 1, updatedAt: AT },
        path: resolved.kinds["dns-record"],
      }),
    );
    const held = unwrap(readKindFile({ kind: "dns-record", paths: resolved, spec: SPEC }))!;
    expect(held.entities.map((entity) => entity.id)).toEqual(["dns-record-0"]);
    rmSync(root, { force: true, recursive: true });
  });
});

// The three checks directly, with no store around them: each is pure, so its exact line is asserted on the
// document alone rather than through whatever a publish or a read wraps around it.
describe("kindDisagreements", () => {
  it("names a file whose own declared kind is not its slot", () => {
    expect(kindDisagreements({ document: file({ ids: [], kind: "zone" }), kind: "dns-record" })).toEqual([
      "the file declares kind zone",
    ]);
  });

  it("names each entity of another kind by its id, and one with no id as unidentified", () => {
    const document = { entities: [{ id: "z-1", kind: "zone" }, { kind: "zone" }, { id: "d-1", kind: "dns-record" }] };

    expect(kindDisagreements({ document, kind: "dns-record" })).toEqual([
      "z-1 is a zone",
      "an unidentified entity is a zone",
    ]);
  });

  it("does not judge a document that carries no kind anywhere", () => {
    expect(kindDisagreements({ document: { entities: [{ id: "x" }] }, kind: "zone" })).toEqual([]);
  });

  it("finds nothing in a document that agrees with its slot", () => {
    expect(kindDisagreements({ document: file({ ids: ["zone"], kind: "zone" }), kind: "zone" })).toEqual([]);
  });
});

describe("incoherentKinds", () => {
  it("names a kind counting entities with no digest, and a kind claiming a success with no digest", () => {
    const stamped = manifest({ dnsRecord: succeeded({ entityCount: 0 }), zone: succeeded({ entityCount: 3 }) });

    expect(incoherentKinds({ kinds: KINDS, manifest: stamped })).toEqual([
      "zone is graded with 3 entities but carries no file digest — the count describes a file this generation never wrote",
      `dns-record records a success at ${AT} but carries no file digest, so nothing vouches for the bytes on disk`,
    ]);
  });

  it("finds nothing when every kind with a claim carries a digest", () => {
    const stamped = manifest({
      dnsRecord: NEVER_SYNCED,
      zone: { ...succeeded({ entityCount: 3 }), digest: "abc123" },
    });

    expect(incoherentKinds({ kinds: KINDS, manifest: stamped })).toEqual([]);
  });
});

describe("validateGeneration", () => {
  const good = manifest({ dnsRecord: NEVER_SYNCED, zone: NEVER_SYNCED });

  it("passes a generation whose files and manifest are all storable", () => {
    expect(
      validateGeneration({ files: { zone: file({ ids: ["zone"], kind: "zone" }) }, manifest: good, spec: SPEC }),
    ).toEqual([]);
  });

  it("does not judge a kind the publish is not writing", () => {
    expect(validateGeneration({ files: {}, manifest: good, spec: SPEC })).toEqual([]);
  });

  it("refuses a kind file its platform schema rejects", () => {
    const unparseable = { ...file({ ids: [], kind: "zone" }), schemaVersion: 2 } as unknown as File;

    expect(validateGeneration({ files: { zone: unparseable }, manifest: good, spec: SPEC })).toEqual([
      "refusing to write zone: Invalid input: expected 1",
    ]);
  });

  it("refuses a kind file holding another kind's entity, though its schema accepts it", () => {
    expect(
      validateGeneration({
        files: { "dns-record": file({ ids: ["dns-record", "zone"], kind: "dns-record" }) },
        manifest: good,
        spec: SPEC,
      }),
    ).toEqual(["refusing to write dns-record: zone-1 is a zone"]);
  });

  it("refuses a manifest its platform schema rejects", () => {
    const unparseable = { ...good, schemaVersion: 2 } as unknown as Manifest;

    expect(validateGeneration({ files: {}, manifest: unparseable, spec: SPEC })).toEqual([
      "refusing to write the manifest: Invalid input: expected 1",
    ]);
  });
});
