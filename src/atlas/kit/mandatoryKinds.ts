/**
 * Whether a generation may be published at all — the obligation every atlas owes, judged once in the kit.
 *
 * Owner ruling: a change made for one atlas is made so that it applies to all atlases. That is why this is a
 * kit module wired into `store.ts`'s `publishAtlas` rather than a refusal added to the two atlases where the
 * gap was measured — a per-atlas fix here would be the drift the owner objects to.
 *
 * ## The failure this closes
 *
 * Publication itself must be gated. A sync could fail
 * to acquire a surface it claims as its own, publish the generation anyway, and every later reader would
 * serve it with nothing saying a family was missing. MEASURED on a live install: the Vanta
 * atlas published a generation `atlas doctor` graded ANSWERABLE while its `audit`
 * kind — declared `authoritative` in `atlas/vanta/inventory.ts` — had `lastAttempt: null` and had never been
 * acquired at all.
 *
 * ## Why this judges only what the publish is WRITING
 *
 * The obvious rule — every mandatory kind must be present in every publish — deadlocks a fresh home, and two
 * successive designs for scoping it failed before this one. A multi-surface atlas publishes a PARTIAL set by
 * construction: `CROWDSTRIKE_KINDS` has ten entries and `CROWDSTRIKE_API_KINDS` has eight, with
 * `console-page` and `console-request` written by a separate `consoleSurface.ts` run. Under the obvious rule
 * the first API sync on an empty home refuses because the two console kinds have never succeeded, the
 * console run refuses because the eight API kinds have not either, and the atlas can never publish anything.
 * There are **17 second-surface publishers** in this tree, so that is a property of the design rather than a
 * CrowdStrike quirk. Scoping the obligation to a per-kind publish GROUP was tried next and fails the same way
 * one level down: a browser surface that writes `method` and `page`, which the same atlas's API sync also
 * writes, makes a browser-only publish re-trigger the whole API group's obligation.
 *
 * What survives is the rule that judges only kinds the publish is actually WRITING: **a mandatory kind whose
 * file this generation writes, while the atlas has never once acquired it, refuses the publish.** An omitted
 * kind is never judged, so bootstrapping and second surfaces both work; a placeholder written for a surface
 * that has never been read is exactly the "green build that lies" this row was opened for.
 *
 * A kind nobody ever writes at all is therefore NOT judged here — the Vanta `audit` case, an `authoritative`
 * surface with `lastAttempt: null`. That is not an oversight, it is the division of labour the ruling names:
 * the read side (`answerable.ts` and the capability profile) is what must refuse to present such an atlas as
 * complete current truth.
 *
 * ## What this judges, and the two fields it deliberately does NOT read
 *
 * The criterion: **within a group this publish is writing, a mandatory kind that is absent from the publish
 * set and has never succeeded refuses the generation.** It reads `lastSuccessAt` and set membership only.
 *
 * It does not read `lastAttempt`. MEASURED: lifting a `lastAttempt.outcome` check into the kit failed 42 unit tests across five multi-surface atlases,
 * hex, twilio and inngest among them, because those atlases stamp `ok` for a run that COMPLETED while never
 * reading the kind, where CrowdStrike stamps `ok` only for a kind it actually read. The field's meaning is
 * per-platform, which is the same fact `AtlasStoreSpec`'s `gradeNeverSucceeded` already exists to express. A
 * kit-level branch on it would encode one atlas's convention as everyone's.
 *
 * It does not read `digest` either — a null digest against a claimed success is its own refusal, landing
 * separately, and two refusals over one field is how they drift apart.
 *
 * So the case "the kind IS in the publish set but was read incompletely" is NOT closed here and is not meant
 * to be: judging it needs exactly the per-platform attempt semantics above. That stays with each platform's
 * `guardPublish`, and Vanta's and 1Password's own sync verbs already exit non-zero on it. Stated rather than
 * left to be assumed, because a reader who thinks the kit closed the whole class will not write the half
 * that is still theirs.
 *
 * And a kind no group ever publishes is not judged HERE at all — by construction, since no publish writes
 * its group. That is the Vanta `audit` case, and it is why the ruling has a second half: the read side
 * (`answerable.ts` and the capability profile) is what must refuse to present such an atlas as complete
 * current truth.
 */
import type { AtlasKindStatus } from "./kindStatus.js";
import type { AtlasManifestLike } from "./store.js";

/**
 * What one kind is worth to a publish.
 *
 * `optional` carries its reason, because an exemption a reader cannot interrogate is indistinguishable from
 * an oversight, and this whole row exists because a gap was invisible.
 */
export type AtlasKindObligation = { readonly rule: "mandatory" } | { readonly rule: "optional"; readonly why: string };

/**
 * What a whole atlas owes, as a default plus the exceptions to it.
 *
 * A flat `Record<TKind, AtlasKindObligation>` was the first shape and does not survive this tree: the Datadog
 * atlas declares about 100 kinds and googleAdmin about 85, so a per-kind literal would be thousands of lines
 * of ceremony in which a wrong entry is invisible. Worse, the ceremony would be borne by exactly the atlases
 * whose kind lists are generated, where a hand-written parallel list is guaranteed to drift.
 *
 * So the default is MANDATORY in a named group and an exception has to be written down. Fail-closed stays
 * the default — a kind nobody has thought about is owed, not exempt — while the thing a reader has to audit
 * is a short list of deliberate decisions rather than a long list of defaults.
 */
export interface AtlasKindObligations<TKind extends string> {
  /** The kinds this atlas may publish a never-acquired placeholder for, each with its reason. */
  readonly exceptions: Readonly<Partial<Record<TKind, AtlasKindObligation>>>;
}

/**
 * What one kind is worth, resolving the default when no exception names it.
 *
 * @param kind the kind to resolve
 * @param obligations the atlas's declaration
 * @returns the obligation that governs this kind
 */
export function obligationFor<TKind extends string>({
  kind,
  obligations,
}: {
  kind: TKind;
  obligations: AtlasKindObligations<TKind>;
}): AtlasKindObligation {
  const exception = obligations.exceptions[kind];
  if (exception == null) {
    return { rule: "mandatory" };
  }
  return exception;
}

/**
 * Whether one kind's stored status shows it has ever been acquired.
 *
 * `lastSuccessAt` is the only field that answers this the same way on every atlas — it is written when a
 * read actually produced a generation's worth of entities, and no platform stamps it for a run that did not.
 *
 * @param status the kind's manifest status, or `null` when the manifest carries no row for it
 * @returns whether the atlas has ever successfully read this kind
 */
export function kindEverAcquired({ status }: { status: AtlasKindStatus | null }): boolean {
  return status?.lastSuccessAt != null;
}

/**
 * Whether a kind's stored status declares this credential is not permitted to read the surface.
 *
 * @param status the kind's manifest status, or `null` when the manifest carries no row for it
 * @returns whether the atlas has recorded a permission boundary for it
 * @internal
 */
export function permissionBlocked({ status }: { status: AtlasKindStatus | null }): boolean {
  return status?.permissionBlocked != null;
}

/**
 * Whether a kind's stored status declares the provider answered that this organisation has no such product.
 *
 * @param status the kind's manifest status, or `null` or `undefined` when the manifest carries no row for it
 * @returns whether the atlas has recorded a product absence for it
 * @internal
 */
export function productAbsent({ status }: { status: AtlasKindStatus | null | undefined }): boolean {
  return status?.productAbsent != null;
}

/**
 * Every mandatory kind this publish would write while the atlas has never acquired it.
 *
 * Only kinds the publish is WRITING are judged — see this module's header for the two designs that judged
 * omitted kinds and deadlocked. An omitted kind is the platform legitimately leaving a file untouched, and
 * a kind with any prior success is a real generation being refreshed.
 *
 * A generation in which nothing at all has ever been acquired is exempt, and that is load-bearing rather
 * than a softening: `kit/reset.ts` installs a deliberately empty generation through this same function, and
 * a sync on an unconfigured account writes the same honest emptiness. Neither claims anything. What this
 * returns is the MIXED case — some surfaces real, others never read, published as one answer.
 *
 * A kind that HOLDS ENTITIES is exempt too, and that boundary is the one a review would most likely get
 * wrong. A partial read is not a fabricated placeholder: Cloudflare's `firewall-service` can answer 410 on
 * one of six subtypes and still publish five real entities beside an OPEN gap saying which subtype it could
 * not reach. That is honest coverage and refusing it would sink a batch for a failure it already reports —
 * the owner's standing preference is that one failure must not sink the batch, and it does not conflict with
 * failing closed, because what fails closed here is only the EMPTY file for a surface nobody has ever read.
 *
 * A kind whose status carries a {@link AtlasPermissionBlock} is exempt, and that is the SECOND owner ruling
 * on this row rather than a softening of the first. An atlas is to find all reachable
 * information the owner's permissions allow inside a platform, and the owner is not an admin on most
 * platforms, so a surface the owner's credential may not read is the atlas working correctly rather than a
 * generation that lies. What makes the exemption safe is that it is not silence: reaching
 * `permissionBlocked` on a status means the sync CLASSIFIED the refusal from a typed error, and the block names
 * the grant that would lift it — so a reader is told which surfaces are dark for permissions and which are
 * dark because the atlas is wrong, which is the distinction the owner never has to guess at.
 *
 * A kind whose status carries a product absence (`./productAbsence.ts`) is exempt too, and that is the THIRD
 * ruling on this row: a product the organisation does not have is valid to exclude, or else the rule would be
 * nonsensical. No grant
 * and no re-run can acquire a product the organisation never bought, so refusing on it leaves the atlas unable
 * to publish ever. It is safe for the same reason the permission exemption is: the stamp is a CLASSIFICATION
 * of the provider's own answer, and it names the absence rather than going quiet about it.
 *
 * @param kinds every kind the platform declares
 * @param obligations what this atlas owes, as a default plus its declared exceptions
 * @param present the kinds this publish is writing a file for
 * @param manifest the manifest about to be published, whose per-kind rows carry the acquisition history
 * @returns the offending kinds, sorted, so a refusal names them in a stable order
 */
export function unacquiredMandatoryKinds<TKind extends string>({
  kinds,
  obligations,
  present,
  manifest,
}: {
  kinds: readonly TKind[];
  obligations: AtlasKindObligations<TKind>;
  present: readonly TKind[];
  manifest: AtlasManifestLike<TKind>;
}): readonly TKind[] {
  const holdsEntities = ({ kind }: { kind: TKind }): boolean => manifest.kinds[kind].entityCount > 0;
  const writing = new Set<string>(present);
  const written = kinds.filter((kind) => writing.has(kind));
  // A generation in which NOTHING has ever been acquired is a bootstrap, a reset or an unconfigured
  // account — honestly empty, and refusing it would leave `atlas <platform> reset` unable to install the
  // empty generation it exists to install. The lie this gate is for is the MIXED generation: real data for
  // some surfaces beside never-read placeholders for others, which together read as one complete answer.
  if (!written.some((kind) => kindEverAcquired({ status: manifest.kinds[kind] }))) {
    return [];
  }
  const offending = written.filter((kind) => {
    if (obligationFor({ kind, obligations }).rule === "optional" || holdsEntities({ kind })) {
      return false;
    }
    if (permissionBlocked({ status: manifest.kinds[kind] })) {
      return false;
    }
    if (productAbsent({ status: manifest.kinds[kind] })) {
      return false;
    }
    return !kindEverAcquired({ status: manifest.kinds[kind] });
  });
  return offending.toSorted();
}

/**
 * The refusal lines for a generation missing a mandatory surface, or none when it may publish.
 *
 * The remedy names the two honest ways out — acquire the surface, or declare it optional with a reason —
 * because a refusal that leaves an operator with only "make it work" invites the third way, which is
 * weakening the gate.
 *
 * @param platform the atlas's own platform name, so a refusal says which atlas stopped
 * @param unacquired the mandatory kinds this publish owes and would leave unacquired
 * @returns the refusal lines, or an empty list when nothing is owed
 */
export function mandatoryKindRefusal({
  platform,
  unacquired,
}: {
  platform: string;
  unacquired: readonly string[];
}): readonly string[] {
  if (unacquired.length === 0) {
    return [];
  }
  const named = unacquired.join(", ");
  const one = unacquired.length === 1;
  return [
    `the ${platform} atlas would publish ${named} while having never acquired ${one ? "it" : "them"}`,
    `a file written for a surface that has never been read presents as this organisation's answer, which a` +
      " reader cannot tell apart from an organisation that holds none",
    `acquire the missing ${one ? "surface" : "surfaces"}, or declare ${one ? "it" : "them"} optional with a` +
      " reason in this atlas's store spec — an exemption is a decision this atlas should be seen to make",
  ];
}
