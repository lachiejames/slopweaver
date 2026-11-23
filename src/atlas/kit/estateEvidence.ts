/**
 * Which kinds answer about the PLATFORM and never about this organisation's own estate.
 *
 * ## The defect this closes, measured
 *
 * MEASURED twice, by the same question asked in two dogfood turns: the Datadog
 * atlas's `monitor` kind holds 29 SDK OPERATIONS compiled from `@datadog/datadog-api-client`
 * (`v2-monitors-update-monitor-config-policy`, `PATCH /api/v2/monitor/policy/{policy_id}`, …) and not one of
 * the monitors this organisation actually runs, while `slopweaver atlas doctor` graded the whole atlas
 * ANSWERABLE. Both turns abandoned the atlas and went live through `slopweaver datadog raw`, because the monitor
 * kind holds 29 API operations from the compiled catalogue, not 29 monitors. Reproduce with
 * `slopweaver atlas datadog read --kind monitor` beside `slopweaver atlas doctor`.
 *
 * ## The criterion was already declared in source, and nothing read it
 *
 * `contract.ts` has carried `ATLAS_EVIDENCE_ROLES` since the kit existed. It documents `authoritative` as
 * _"this surface is the source of record for the fact"_, `corroborating` as _"it independently agrees, and
 * may never satisfy an authoritative obligation alone"_, and `discovery` as _"it can reveal that something
 * exists without establishing anything about its contents"_. Datadog's descriptor declares its
 * `compiled-catalogue` surface `role: "discovery"` and has done since it landed. So the atlas was ALREADY
 * saying, in a field it publishes, that this kind establishes nothing about the estate — and no reader
 * consulted the field, which is why a declared boundary and a confident grade stood side by side without the
 * contradiction being detectable by anything except a human reading both.
 *
 * ## The criterion, stated so it can be argued with
 *
 * > A RECORD is this organisation's own when an `authoritative` surface observed it and no `discovery`
 * > surface ever did. A kind's ESTATE is not established when it holds at least one stored record and not
 * > one of them is that.
 *
 * **The unit is the RECORD, and two earlier drafts that made it the KIND both let the founding case
 * through.** Draft one asked whether every observation in the kind was `discovery`; MEASURED on one
 * generation, the console walk had sighted one of Datadog's compiled monitor operations
 * while its pages rendered, so that lone `corroborating` sighting hid every record that settles nothing. Draft
 * two asked whether ANY authoritative surface had seen anything in the kind — and that one is the sharper
 * lesson, because it passed every test written for it and still failed the exact generation the finding was
 * measured on: the live pass filled the `api` channel of all 29 OPERATION entities, and `api` is
 * declared authoritative, so the kind cleared while holding no monitor at all. An authoritative surface
 * annotating a record a declaration already carried says nothing about the estate; only a record that
 * surface REVEALED does.
 *
 * Four further properties follow, and each is why this is a rule rather than a Datadog special case:
 *
 * - **It is generic.** Nothing here knows what a compiled catalogue is. Any atlas that ships a declaration
 *   surface before a live pass earns the same line, which is the shape the next atlas will have.
 * - **It SELF-CLEARS.** One record an authoritative surface revealed takes the kind out of this set, so
 *   filling the estate removes the line rather than needing a second edit to remove it.
 * - **An atlas with no discovery surface at all is unaffected.** Every record an authoritative surface saw
 *   is then an estate record by construction, which is the right answer for an atlas like Vanta's whose one
 *   surface is the provider's own API.
 * - **An EMPTY kind is deliberately not in this set.** A kind with no records at all is already reported by
 *   `kindReason.ts`'s three classes — fenced, attempted-and-never-acquired, or never attempted — and a
 *   fourth voice saying the same silence differently is how a report starts contradicting itself.
 *
 * A surface name the descriptor does not declare counts as NOT authoritative and NOT discovery. That fails
 * closed on both halves on purpose: an undeclared surface cannot discharge an authoritative obligation,
 * because nothing states that it carries one. A record carrying NO observation is in this set for the same
 * reason — nothing revealed it — rather than being waved through as a shape no adapter produces today.
 */
import type { AtlasDescriptor, AtlasEvidenceRole } from "./contract.js";
import type { AtlasEntityView, AtlasKindView } from "./read.js";

/** What one kind's records amount to, counted once so the verdict and the sentence cannot disagree. */
interface EstateTally {
  /** Records an authoritative surface REVEALED — seen by one, and by no discovery surface. */
  readonly revealed: number;
  /** Records an authoritative surface merely annotated — seen by one, and by a discovery surface too. */
  readonly annotated: number;
  /** Every surface that has observed anything in this kind, in first-seen order. */
  readonly surfaces: readonly string[];
}

/**
 * The names of every surface this descriptor declares with one role.
 *
 * @param descriptor the atlas's own declaration
 * @param role the evidence role being collected
 * @returns the surface names, empty when this atlas declares none in that role
 */
function surfacesInRole({
  descriptor,
  role,
}: {
  descriptor: AtlasDescriptor;
  role: AtlasEvidenceRole;
}): ReadonlySet<string> {
  return new Set(descriptor.surfaces.filter((one) => one.role === role).map((one) => one.name));
}

/**
 * Count one kind's records by what kind of evidence stands behind each of them.
 *
 * @param authoritative every surface name this atlas declares as the source of record
 * @param discovery every surface name this atlas declares as revealing existence only
 * @param kind the kind view being judged
 * @returns the two counts and the surfaces that produced them
 */
function tally({
  authoritative,
  discovery,
  kind,
}: {
  authoritative: ReadonlySet<string>;
  discovery: ReadonlySet<string>;
  kind: AtlasKindView;
}): EstateTally {
  const surfaces = new Set<string>();
  let revealed = 0;
  let annotated = 0;
  for (const entity of kind.entities) {
    const seen = entitySurfaces({ entity });
    seen.forEach((name) => surfaces.add(name));
    const byAuthoritative = [...seen].some((name) => authoritative.has(name));
    const byDiscovery = [...seen].some((name) => discovery.has(name));
    if (byAuthoritative && byDiscovery) {
      annotated += 1;
      continue;
    }
    if (byAuthoritative) {
      revealed += 1;
    }
  }
  return { annotated, revealed, surfaces: [...surfaces] };
}

/**
 * The distinct surfaces that have observed one record.
 *
 * @param entity the stored record
 * @returns each surface name once
 */
function entitySurfaces({ entity }: { entity: AtlasEntityView }): ReadonlySet<string> {
  return new Set(entity.observations.map((observation) => observation.surface));
}

/**
 * The sentence for a kind whose records an authoritative surface has only ever annotated.
 *
 * Kept apart from the no-authoritative-evidence case because it is a different fact and a reader who is
 * about to quote a count needs the sharper one: the organisation's own API DID answer here, and what it
 * answered about was a list of declarations rather than a list of things.
 *
 * @param annotated how many records an authoritative surface saw that a discovery surface had declared
 * @param platform the atlas's platform name
 * @param records how many records the kind holds in total
 * @returns the line a reader is owed
 */
function annotatedReason({
  annotated,
  platform,
  records,
}: {
  annotated: number;
  platform: string;
  records: number;
}): string {
  return (
    `none of the ${String(records)} stored record(s) here is one of this organisation's own: ${platform} has` +
    ` read ${String(annotated)} of them on an authoritative surface, and every one of those was ALREADY` +
    " declared by a discovery surface — which reveals that something exists without establishing anything" +
    " about its contents. An authoritative surface has never revealed a record here that a declaration did" +
    " not already carry, so these records describe the platform and not what this organisation holds"
  );
}

/**
 * The sentence for a kind no authoritative surface has seen at all.
 *
 * @param platform the atlas's platform name
 * @param records how many records the kind holds
 * @param surfaces every surface that has observed one of them
 * @returns the line a reader is owed
 */
function unseenReason({
  platform,
  records,
  surfaces,
}: {
  platform: string;
  records: number;
  surfaces: readonly string[];
}): string {
  return (
    `all ${String(records)} stored record(s) here were observed on ${surfaces.join(", ")}, and` +
    ` ${platform} declares no authoritative role for any of them: discovery evidence reveals that` +
    " something exists without establishing anything about its contents, and corroborating evidence may" +
    " never satisfy an authoritative obligation alone. These records describe the platform, never what this" +
    " organisation holds"
  );
}

/**
 * Why one kind's records cannot establish what this organisation holds, or `null` when they can.
 *
 * @param descriptor the atlas's own declaration, which is where a surface's evidence role lives
 * @param kind the kind view being judged
 * @returns the sentence a reader is owed, or `null` when an authoritative surface revealed a record here
 */
export function estateNotEstablishedReason({
  descriptor,
  kind,
}: {
  descriptor: AtlasDescriptor;
  kind: AtlasKindView;
}): string | null {
  const records = kind.entities.length;
  if (records === 0) {
    return null;
  }
  const counted = tally({
    authoritative: surfacesInRole({ descriptor, role: "authoritative" }),
    discovery: surfacesInRole({ descriptor, role: "discovery" }),
    kind,
  });
  if (counted.revealed > 0) {
    return null;
  }
  if (counted.surfaces.length === 0) {
    // Records carrying no observation at all. Unreachable through every adapter in this tree today — each
    // builds an observation per non-null channel and a stored entity has at least one — and it is a
    // REASON rather than a `null` precisely because of that: a state nothing produces is a state nothing
    // tests, so the lean has to be the one that cannot overclaim. Nothing revealed these records.
    return (
      `the ${String(records)} stored record(s) here carry no observation at all, so nothing states which` +
      ` surface established them and ${descriptor.platform} cannot answer from them about what this` +
      " organisation holds"
    );
  }
  if (counted.annotated > 0) {
    return annotatedReason({ annotated: counted.annotated, platform: descriptor.platform, records });
  }
  return unseenReason({ platform: descriptor.platform, records, surfaces: counted.surfaces });
}

/**
 * Every kind of one atlas that answers about the platform and not about the estate, sorted.
 *
 * @param descriptor the atlas's own declaration
 * @param kinds every kind the snapshot projected
 * @returns the kind names, sorted, empty when every non-empty kind holds a record an authoritative surface revealed
 */
export function estateNotEstablishedKinds({
  descriptor,
  kinds,
}: {
  descriptor: AtlasDescriptor;
  kinds: readonly AtlasKindView[];
}): readonly string[] {
  return kinds
    .filter((kind) => estateNotEstablishedReason({ descriptor, kind }) !== null)
    .map((kind) => kind.kind)
    .toSorted();
}
