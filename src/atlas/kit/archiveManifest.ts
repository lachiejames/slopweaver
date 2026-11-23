/**
 * Reading an archived generation's manifest, and checking the generation's bytes against what it vouches for.
 *
 * The read half of a restore: `./archive.ts` lists the archives and performs the renames, and asks this module
 * whether one may be installed. It never moves anything, and it needs no platform's schema — why that is
 * deliberate is in that module's header.
 */
import { join, relative } from "node:path";

import { z } from "zod";

import { safeJsonParse } from "../../lib/safeJson.js";
import { digestOfKindFile, readFileIfPresent, readKindFileIfPresent } from "../atlasFile.js";

/**
 * The manifest shape every atlas carries, as a STRICT schema rather than field-by-field reads.
 *
 * Platform-neutral on purpose — these are the fields `AtlasManifestLike` guarantees of all 36, and nothing
 * below the kind status is inspected, so this stays generic without loading any platform's model.
 *
 * It is a schema because the alternative was measured failing three times. Reading fields one at a time and
 * coercing what did not fit turned every malformed manifest into some VALID-looking shape: a null digest
 * became "nothing to check", a `__proto__` key became no key at all, and a string entity count became a
 * legitimate zero. Codex found all three separately, and they are one class — a hand-written manifest
 * steering the verifier by being wrong in a shape the verifier normalises. A strict parse has no such
 * behaviour: input that is not this shape is not read, it is refused.
 */
const archiveManifestSchema = z
  .object({
    kinds: z.record(
      z.string(),
      z.object({ digest: z.string().nullable(), entityCount: z.number().int().nonnegative() }).loose(),
    ),
    schemaVersion: z.number(),
    updatedAt: z.string(),
  })
  .loose();

/** What one archived manifest says about itself, once it has parsed. */
export interface ManifestHeader {
  readonly schemaVersion: number;
  readonly updatedAt: string;
  /**
   * Per kind, what the manifest vouches for.
   *
   * A `Map` rather than an object, because these keys come off a manifest on disk. `bag["__proto__"] = x` on
   * an object literal sets the PROTOTYPE and creates no own property, so such a kind would vanish from every
   * check below — Codex built exactly that manifest and watched an unverifiable kind pass both renames.
   */
  readonly kinds: ReadonlyMap<string, { digest: string | null; entityCount: number }>;
  readonly entityCount: number;
}

/**
 * How many kinds the manifest's own bytes declare, counted before any parser rebuilds them.
 *
 * @param parsed the manifest as `JSON.parse` produced it, where every declared key is still an own property
 * @returns the number of kind keys the document itself carries, or -1 when it carries no kinds object
 */
function declaredKindCount({ parsed }: { parsed: unknown }): number {
  if (typeof parsed !== "object" || parsed === null || !("kinds" in parsed)) {
    return -1;
  }
  const kinds = parsed.kinds;
  if (typeof kinds !== "object" || kinds === null) {
    return -1;
  }
  return Object.getOwnPropertyNames(kinds).length;
}

/**
 * Read a manifest's platform-free header, refusing anything that is not exactly that shape.
 *
 * @param path the manifest to read
 * @returns the header, or `null` when the file is absent, unreadable, or does not match the schema
 */
export function readManifestHeader({ path }: { path: string }): ManifestHeader | null {
  const contents = readFileIfPresent({ path });
  if (contents.isErr() || contents.value === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: path, text: contents.value });
  } catch {
    return null;
  }
  const shaped = archiveManifestSchema.safeParse(parsed);
  if (!shaped.success) {
    return null;
  }
  // Count the kinds the RAW document declares against the ones that survived the parse, and refuse when they
  // differ. A schema is not enough on its own here: `z.record` rebuilds its output as a plain object, so a
  // key named `__proto__` is swallowed by the rebuild exactly as it would be by any other assignment, and a
  // manifest declaring one kind arrives declaring none. That is the Codex `__proto__` counterexample
  // surviving the strict parse that was supposed to end it. Comparing the two counts closes it for any key
  // with that behaviour rather than for one spelling of it.
  const declared = declaredKindCount({ parsed });
  if (declared !== Object.keys(shaped.data.kinds).length) {
    return null;
  }
  const perKind = new Map<string, { digest: string | null; entityCount: number }>();
  let entities = 0;
  for (const [kind, status] of Object.entries(shaped.data.kinds)) {
    perKind.set(kind, { digest: status.digest, entityCount: status.entityCount });
    entities += status.entityCount;
  }
  return {
    entityCount: entities,
    kinds: perKind,
    schemaVersion: shaped.data.schemaVersion,
    updatedAt: shaped.data.updatedAt,
  };
}

/**
 * Every kind file the archived manifest vouches for, re-digested from the archived bytes.
 *
 * The archived tree is the live tree renamed, so a kind's path inside it is its live path taken RELATIVE to
 * the live directory and rebased — never its basename. One atlas nests a kind a directory deeper
 * (`nested/beta.jsonl` in the kit's own atomicity fixture), and a basename would silently look in the wrong
 * place and report the file missing.
 *
 * @param root the archived generation's directory
 * @param header the archived manifest's own digests
 * @param kinds the platform's live kind paths, which this rebases
 * @param directory the live generation's directory, which the live kind paths hang off
 * @returns one line per kind whose archived bytes disagree with the manifest, or none when all agree
 */
export function digestDisagreements({
  root,
  header,
  kinds,
  directory,
}: {
  root: string;
  header: ManifestHeader;
  kinds: Readonly<Record<string, string>>;
  directory: string;
}): readonly string[] {
  return [...header.kinds].flatMap(([kind, status]): readonly string[] => {
    // `hasOwnProperty` rather than an `=== undefined` test, for the same reason the bag above has no
    // prototype: `kinds["__proto__"]` on a normal object answers `Object.prototype`, which is not undefined
    // and is not a path, so an undefined-test would send a non-string into `relative()`.
    const livePath = Object.prototype.hasOwnProperty.call(kinds, kind) ? kinds[kind] : undefined;
    if (typeof livePath !== "string") {
      // A kind this build does not map is one whose file cannot be located, let alone digested. Skipping it
      // as "not ours" is how an archive gets installed with a kind nothing verified: a Codex review pass
      // added a `ghost` kind carrying `{"digest":null,"entityCount":1}` to an otherwise valid archive and
      // watched it replace a healthy live generation. An archive naming a kind this build has never heard of
      // was written by a different build, which is the same class the schema check exists for and is not
      // always caught by it, since two builds can share a schema version and differ in their kind list.
      return [
        `  ${kind}: the manifest names a kind this build does not map, so its file cannot be located or verified`,
      ];
    }
    return kindDisagreement({ kind, path: join(root, relative(directory, livePath)), status });
  });
}

/**
 * Whether a record looks like an envelope this store wrote, in the only terms every atlas shares.
 *
 * `AtlasKindFileLike` guarantees a kind file carries `schemaVersion` and `updatedAt`; a platform's own schema
 * carries more, and this module deliberately has none. So this is the floor rather than a validation: it
 * separates an envelope from an arbitrary JSON object, which is the distinction the empty-kind arm needs.
 *
 * @param envelope the first record of an archived kind file
 * @returns whether it carries the two fields every atlas's envelope has
 */
function envelopeIsStorable({ envelope }: { envelope: unknown }): boolean {
  if (typeof envelope !== "object" || envelope === null) {
    return false;
  }
  const record: Record<string, unknown> = { ...envelope };
  return typeof record["schemaVersion"] === "number" && typeof record["updatedAt"] === "string";
}

/**
 * Whether an archived kind carrying NO digest may be installed.
 *
 * The manifest vouches for nothing here, so the file itself has to. Two shapes are refused and one is
 * allowed, and each of the refusals was a Codex counterexample rather than a precaution: a kind claiming
 * entities with no digest is the incoherent state `./store.ts` refuses at publish; a kind claiming to be
 * empty is only believed once its file is READ, because an exemption that never looks is a promise taken
 * from the document being checked; and the file's first record has to look like an envelope, because
 * `readKindFileIfPresent` returns the first valid-JSON record as one without validating it, so a file
 * holding `{"garbage":true}` reads as an envelope with zero entities.
 *
 * @param kind the kind being checked, named in any disagreement
 * @param path the archived kind file
 * @param status what the archived manifest recorded for it, whose digest is known to be null
 * @returns one line when the kind may not be installed, or none when it may
 */
function undigestedDisagreement({
  kind,
  path,
  status,
}: {
  kind: string;
  path: string;
  status: { digest: string | null; entityCount: number };
}): readonly string[] {
  if (status.entityCount > 0) {
    return [
      `  ${kind}: the manifest records no digest and ${String(status.entityCount)} entities, so its bytes cannot be verified`,
    ];
  }
  const empty = readKindFileIfPresent({ path });
  if (empty.isErr()) {
    return [`  ${kind}: ${empty.error.join("; ")}`];
  }
  if (empty.value === null) {
    return [];
  }
  if (empty.value.entities.length > 0) {
    return [
      `  ${kind}: the manifest records it empty and carries no digest, but its file holds ${String(empty.value.entities.length)} entities`,
    ];
  }
  return envelopeIsStorable({ envelope: empty.value.envelope })
    ? []
    : [`  ${kind}: the manifest records it empty and carries no digest, and its file holds no readable envelope`];
}

/**
 * Whether one archived kind's bytes agree with what the manifest recorded for it.
 *
 * A kind claiming entities while recording NO digest is the incoherent state `./store.ts` refuses at publish
 * time, and skipping it here as "nothing to check" is how an unverified archive got installed: a Codex review
 * pass built exactly that archive — `{"digest":null,"entityCount":1}` beside corrupted bytes — and watched it
 * replace a good live generation. Zero entities and no digest is a legitimately empty kind and stays exempt.
 *
 * @param kind the kind being checked, named in any disagreement
 * @param path the archived kind file to re-digest
 * @param status what the archived manifest recorded for it
 * @returns one line when the kind disagrees with its manifest, or none when it agrees
 */
function kindDisagreement({
  kind,
  path,
  status,
}: {
  kind: string;
  path: string;
  status: { digest: string | null; entityCount: number };
}): readonly string[] {
  if (status.digest === null) {
    return undigestedDisagreement({ kind, path, status });
  }
  const file = readKindFileIfPresent({ path });
  if (file.isErr()) {
    return [`  ${kind}: ${file.error.join("; ")}`];
  }
  if (file.value === null) {
    return [`  ${kind}: the manifest vouches for a file the archive does not hold`];
  }
  const measured = digestOfKindFile({ entities: file.value.entities, envelope: file.value.envelope });
  return measured === status.digest
    ? []
    : [`  ${kind}: digest ${measured.slice(0, 12)} does not match the manifest's ${status.digest.slice(0, 12)}`];
}
