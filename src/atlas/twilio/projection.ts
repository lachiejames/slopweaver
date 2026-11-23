/**
 * Turning what each channel saw into `api`, `method` and `page` entities.
 *
 * Pure. The two callers — `sync.ts` for the API channel and `walk.ts` for the browser one — each project
 * only their own channel and leave the other slot `null`, which is what makes `merge.ts`'s channel-scoped
 * fold correct: an entity arriving with one channel filled can never blank the other.
 *
 * ## The provider id is `<METHOD> <path>`, byte-exact
 *
 * That exactness IS the disagreement detector. A normalising match would fold `/v1/Services` on
 * `messaging.twilio.com` and the console's own `/console/sms/services` into one entity and manufacture an
 * agreement that was never observed — hiding precisely the undocumented surface the both-surfaces ruling is
 * about. A path seen on one channel and not the other is therefore a RECORD, never a match failure.
 *
 * ## Why the id does NOT include the host, even though the host is stored
 *
 * Twilio answers from thirty-eight origins, so a host is a real fact and `TwilioMethodApiDetail.host`
 * carries it. It is deliberately not part of the identity: the console reaches the same operation through
 * its own origin, and folding the host into the key would make every corroboration a mismatch by
 * construction, which is the opposite of what the two-surface design is for.
 */

import { absentAsNull } from "#lib/absent.js";
import { type ChannelView, compiledOperationView, pinnedDocumentView } from "../kit/channelEntity.js";
import { twilioEntityId } from "./identity.js";
import type {
  TwilioApiDetail,
  TwilioAtlasChannel,
  TwilioAtlasEntity,
  TwilioAtlasKind,
  TwilioMethodApiDetail,
} from "./model.js";
import type { TwilioSpecPin } from "./specPin.js";
import { type TwilioSpecSurface, twilioMethodProviderId } from "./specSurface.js";

/** One entity carrying exactly one filled channel — the kit owns the assembly. */
function entityWith({
  kind,
  providerId,
  channel,
  filled,
}: {
  kind: TwilioAtlasKind;
  providerId: string;
  channel: TwilioAtlasChannel;
  filled: ChannelView<TwilioAtlasChannel>;
}): TwilioAtlasEntity {
  return {
    // Spelled out rather than assembled: the two slots are literal keys here, so no type assertion is
    // needed to keep them exact and REQUIRED — see `kit/channelSchemas.ts` on why that requiredness is the
    // property rather than a detail.
    channels: { api: channel === "api" ? filled : null, browser: channel === "browser" ? filled : null },
    id: twilioEntityId({ kind, providerId }),
    kind,
    providerId,
  };
}

/**
 * Project every pinned definition into an `api` entity on the `api` channel.
 *
 * @param pins the reviewed lock
 * @param at this run's ISO timestamp
 * @returns one entity per published document, each carrying its hosts, its credential and its census
 */
export function projectTwilioApis({
  pins,
  at,
}: {
  pins: readonly TwilioSpecPin[];
  at: string;
}): readonly TwilioAtlasEntity[] {
  return pins.map((pin) => {
    const detail: TwilioApiDetail = {
      byteLength: pin.byteLength,
      hosts: [...pin.hosts],
      operationCount: pin.operationCount,
      pathCount: pin.pathCount,
      product: pin.product,
      securitySchemes: [...pin.securitySchemes],
      sha256: pin.sha256,
      title: pin.title,
      version: pin.version,
    };
    return entityWith({
      channel: "api",
      filled: pinnedDocumentView({ at, channel: "api", detail, url: pin.url }),
      kind: "api",
      providerId: pin.id,
    });
  });
}

/**
 * What every declaring document, folded together, knows about one operation.
 *
 * @internal
 */
export interface FoldedOperation {
  /** The pinned document to cite — the first declaring one, which is the one to read first. */
  readonly citeUrl: string | null;
  readonly disposition: TwilioMethodApiDetail["disposition"];
  readonly excludedBecause: string | null;
  readonly host: string | null;
  readonly mountName: string | null;
  readonly parameters: Set<string>;
  readonly parent: string | null;
  readonly pathType: string | null;
  /** The declaring document's product, or `null` when no pin claims that document. */
  readonly product: string | null;
  readonly responseFields: Set<string>;
  readonly securitySchemes: Set<string>;
  readonly specs: Set<string>;
}

/** What one pinned document contributes about itself, looked up once rather than per operation. */
interface SpecFacts {
  readonly product: string;
  readonly url: string;
}

/** The record already held for an operation, or a fresh one seeded from the first document that declares it. */
function recordFor({
  held,
  operation,
  facts,
}: {
  held: FoldedOperation | undefined;
  operation: TwilioSpecSurface["operations"][number];
  facts: SpecFacts | undefined;
}): FoldedOperation {
  if (held == null) {
    return {
      citeUrl: absentAsNull({ value: facts?.url }),
      disposition: operation.disposition,
      excludedBecause: operation.excludedBecause,
      host: operation.host,
      mountName: operation.mountName,
      parameters: new Set<string>(),
      parent: operation.parent,
      pathType: operation.pathType,
      product: absentAsNull({ value: facts?.product }),
      responseFields: new Set<string>(),
      securitySchemes: new Set<string>(),
      specs: new Set<string>(),
    };
  }
  return held;
}

/** Fold one operation's names into the record already held for it, or start one. */
function absorbOperation({
  held,
  operation,
  facts,
  specId,
}: {
  held: FoldedOperation | undefined;
  operation: TwilioSpecSurface["operations"][number];
  facts: SpecFacts | undefined;
  specId: string;
}): FoldedOperation {
  const record = recordFor({ facts, held, operation });
  for (const parameter of operation.parameters) {
    record.parameters.add(parameter);
  }
  for (const field of operation.responseFields) {
    record.responseFields.add(field);
  }
  for (const scheme of operation.securitySchemes) {
    record.securitySchemes.add(scheme);
  }
  record.specs.add(specId);
  return record;
}

/**
 * Fold every compiled definition into one record per distinct operation.
 *
 * @param surfaces the compiled definitions, one per pinned document
 * @param pins the reviewed lock, so an operation can cite the document a reader should open and name the
 *   product that declares it
 * @returns one folded record per `<METHOD> <path>`, keyed by that provider id
 */
export function foldTwilioOperations({
  surfaces,
  pins,
}: {
  surfaces: readonly TwilioSpecSurface[];
  pins: readonly TwilioSpecPin[];
}): ReadonlyMap<string, FoldedOperation> {
  const factsById = new Map<string, SpecFacts>(pins.map((pin) => [pin.id, { product: pin.product, url: pin.url }]));
  const folded = new Map<string, FoldedOperation>();
  for (const surface of surfaces) {
    const facts = factsById.get(surface.specId);
    for (const operation of surface.operations) {
      const providerId = twilioMethodProviderId({ method: operation.method, path: operation.path });
      folded.set(
        providerId,
        absorbOperation({ facts, held: folded.get(providerId), operation, specId: surface.specId }),
      );
    }
  }
  return folded;
}

/**
 * Project the folded operations into `method` entities on the `api` channel.
 *
 * @param folded every operation, folded across the documents declaring it
 * @param at this run's ISO timestamp
 * @returns one entity per distinct operation, sorted by provider id
 */
export function projectTwilioMethods({
  folded,
  at,
}: {
  folded: ReadonlyMap<string, FoldedOperation>;
  at: string;
}): readonly TwilioAtlasEntity[] {
  return [...folded.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([providerId, record]) => {
      const detail: TwilioMethodApiDetail = {
        disposition: record.disposition,
        excludedBecause: record.excludedBecause,
        host: record.host,
        mountName: record.mountName,
        observational: record.excludedBecause === null,
        parameters: [...record.parameters].toSorted(),
        parent: record.parent,
        pathType: record.pathType,
        product: record.product,
        responseFields: [...record.responseFields].toSorted(),
        securitySchemes: [...record.securitySchemes].toSorted(),
        specs: [...record.specs].toSorted(),
      };
      return entityWith({
        channel: "api",
        filled: compiledOperationView({ at, channel: "api", citeUrl: record.citeUrl, detail, providerId }),
        kind: "method",
        providerId,
      });
    });
}
