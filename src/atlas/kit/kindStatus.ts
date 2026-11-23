/**
 * What a manifest records about ONE kind: the type every atlas passes around, and the schema it parses with.
 *
 * Split out of `./store.ts` because that file crossed the 600-code-line ratchet, and this is
 * where the seam actually is: everything here answers "what happened to one kind", while `store.ts` answers
 * "what may be written to disk". The eight modules that import a kind status import only this now.
 *
 * `foldedKind` stays in `store.ts` deliberately — it joins a status to an assembled FILE, which is a
 * store-shaped question, and moving it would have pulled the file types back in behind it.
 */
import { z } from "zod";

import { type AtlasPermissionBlock, atlasPermissionBlockSchema } from "./permissionBlock.js";
import { type AtlasProductAbsence, atlasProductAbsenceSchema } from "./productAbsence.js";

/** What is known about one kind's synchronisation history. Identical in both pre-kit atlases. */
export interface AtlasKindStatus {
  /** A digest of the bytes published, so a later half-write is detectable rather than silent. */
  readonly digest: string | null;
  readonly entityCount: number;
  readonly lastAttempt: {
    readonly at: string;
    readonly outcome: "ok" | "failed";
    readonly reasons: readonly string[];
  } | null;
  readonly lastSuccessAt: string | null;
  /**
   * Set only when this credential is not permitted to read the surface. See {@link AtlasPermissionBlock}.
   *
   * OPTIONAL rather than required, which is the opposite of `AtlasStoreSpec.kindObligations` one file over
   * and is deliberate. Required would be safe — absent still means "no boundary declared", so the gate in
   * `./mandatoryKinds.ts` fails closed either way — but it would buy nothing and cost about ninety edits:
   * roughly that many sites across this tree build a kind status as a LITERAL rather than through
   * {@link succeededKindStatus}/{@link failedKindStatus}, so a required field would be filled in with
   * `permissionBlocked: null` ninety times by whoever chased the compiler, which is ceremony rather than a
   * decision. The decision this field records is made per READ, at the point a sync classifies a refusal
   * and stamps a block from a typed error — not once per atlas at declaration time.
   */
  readonly permissionBlocked?: AtlasPermissionBlock | null | undefined;
  /**
   * Set only when the provider answered that this organisation has no such product. See
   * {@link AtlasProductAbsence}. Optional for the same reason as `permissionBlocked` above: it is decided per
   * read, where a sync classifies the provider's answer, never once per atlas.
   */
  readonly productAbsent?: AtlasProductAbsence | null | undefined;
}

/**
 * The manifest status a SUCCESSFUL kind read earns.
 *
 * `digest` is always `null` here: the digest is computed by {@link publishAtlas} from the bytes it actually
 * writes, so a caller filling one in would be describing a file it has not written — which is exactly the
 * incoherence each atlas's own publish guard refuses.
 *
 * @param at this run's ISO timestamp, used as both the attempt and the success time
 * @param entityCount how many entities the merged kind file holds
 * @param reasons anything worth recording about a run that still succeeded, such as records it could not
 *   project
 * @returns the status to stamp into the manifest
 */
export function succeededKindStatus({
  at,
  entityCount,
  reasons,
}: {
  at: string;
  entityCount: number;
  reasons: readonly string[];
}): AtlasKindStatus {
  return {
    digest: null,
    entityCount,
    lastAttempt: { at, outcome: "ok", reasons: [...reasons] },
    lastSuccessAt: at,
    permissionBlocked: null,
  };
}

/**
 * The manifest status a FAILED kind read earns.
 *
 * The prior success time is carried forward rather than cleared, which is the whole difference between "this
 * has never worked" and "this worked and is no longer current". Losing it would make every failed kind
 * indistinguishable from one nobody has ever reached.
 *
 * @param at this run's ISO timestamp
 * @param entityCount how many entities the kind still holds — a failed read keeps them, it does not empty
 *   the file
 * @param reasons why the read failed
 * @param lastSuccessAt the success time the kind already carried, or `null` when it has never succeeded
 * @returns the status to stamp into the manifest
 */
export function failedKindStatus({
  at,
  entityCount,
  reasons,
  lastSuccessAt,
}: {
  at: string;
  entityCount: number;
  reasons: readonly string[];
  lastSuccessAt: string | null;
}): AtlasKindStatus {
  return {
    digest: null,
    entityCount,
    lastAttempt: { at, outcome: "failed", reasons: [...reasons] },
    lastSuccessAt,
    permissionBlocked: null,
  };
}

/**
 * One kind's status in a manifest, as a SCHEMA rather than only as a type.
 *
 * {@link AtlasKindStatus} above is what the kit's own code passes around; this is what a platform's manifest
 * parses with. The two describe the same document, and keeping the schema here rather than in each atlas is
 * what stops them drifting — two atlases' manifests had declared it identically, which is the
 * regeneration the clone ratchet exists to catch.
 *
 * A platform still owns its OWN manifest: which kinds key the record, and the schema version literal. Only
 * the per-kind cell is shared, because only the per-kind cell is the same question on every platform.
 */
export const atlasKindStatusSchema = z
  .object({
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({
        at: z.iso.datetime(),
        outcome: z.enum(["ok", "failed"]),
        reasons: z.array(z.string()),
      })
      .strict()
      .nullable(),
    lastSuccessAt: z.iso.datetime().nullable(),
    // Defaulted rather than required, because every older manifest predates the field
    // and a required one would refuse to parse every generation on this install. `.strict()` still refuses
    // an unknown key, so the default widens nothing else.
    permissionBlocked: atlasPermissionBlockSchema.nullish(),
    // Absent on every manifest written before the field existed — see `kit/productAbsence.ts`.
    productAbsent: atlasProductAbsenceSchema.nullish(),
  })
  .strict();
