/**
 * Pure per-kind DTO → atlas entity projection.
 *
 * Every projection here only ever populates the `manage-api` channel; `channels.browser` is always `null`
 * in what this file returns — `merge.ts` is the layer that knows about the previously-stored generation
 * and folds a prior browser channel back in.
 *
 * The privacy-admission decision (`privacy.ts`) is applied here, at the DTO boundary, for the one kind
 * that carries a financial field: a vendor's `contractAmount` never reaches the returned entity's detail.
 */
import type { VantaControlDto, VantaDocumentDto, VantaPolicyDto, VantaVendorDto } from "./apiSchemas.js";
import { vantaEntityId } from "./identity.js";
import type { VantaLibraryControlDto } from "./libraryControlApiSchemas.js";
import type { VantaChannelEntity, VantaEntity, VantaSensitivity, VantaSource } from "./model.js";
import { admitVendorContractAmount, type VantaPendingSensitiveWrite } from "./privacy.js";
import { type VantaRiskScenarioDto } from "./riskApiSchemas.js";

/** One kind's fully-populated `manage-api` channel result, plus any financial value it must not carry. */
export interface VantaProjection {
  readonly entity: VantaEntity;
  readonly pendingWrite: VantaPendingSensitiveWrite | null;
}

/** Build the one `manage-api` source record every projection shares, differing only in deep link. */
function manageApiSource({
  endpoint,
  at,
  deepLink,
}: {
  endpoint: string;
  at: string;
  deepLink: string | null;
}): VantaSource {
  return {
    artifacts: [],
    channel: "manage-api",
    deepLink,
    deepLinkStatus: deepLink === null ? "unavailable" : "provider-provided",
    endpoint,
    observedAt: at,
  };
}

/** Build the entity every projection shares, differing only in kind, providerId, detail and sensitivity. */
function buildEntity({
  kind,
  providerId,
  detail,
  source,
  sensitivity,
  at,
}: {
  kind: VantaEntity["kind"];
  providerId: string;
  detail: unknown;
  source: VantaSource;
  sensitivity: VantaSensitivity | null;
  at: string;
}): { entity: VantaEntity } {
  const channel: VantaChannelEntity = {
    channel: "manage-api",
    detail,
    firstSeenAt: at,
    lastSeenAt: at,
    source,
    state: "observed",
  };
  return {
    entity: {
      channels: { browser: null, "manage-api": channel },
      financialDetail: null,
      id: vantaEntityId({ components: { providerId }, kind }),
      kind,
      providerId,
      sensitivity,
    },
  };
}

/**
 * Project one control.
 *
 * @param dto the control DTO, from `/controls` or the deactivated surface's `DeactivatedControl` row
 * @param at this run's ISO timestamp
 * @returns the projection
 */
export function projectVantaControl({
  dto,
  at,
}: {
  dto: VantaControlDto | VantaLibraryControlDto;
  at: string;
}): VantaProjection {
  const { entity } = buildEntity({
    at,
    detail: dto,
    kind: "control",
    providerId: dto.id,
    sensitivity: null,
    source: manageApiSource({ at, deepLink: null, endpoint: "/controls" }),
  });
  return { entity, pendingWrite: null };
}

/**
 * Project one risk scenario. `isSensitive` is deprecated in Vanta's own schema but still returned, and it
 * is the one signal this kind carries about care-before-quoting — `null` means the provider gave no signal
 * at all, which stays `null` here rather than defaulting to "not sensitive".
 *
 * @param dto the risk scenario DTO
 * @param at this run's ISO timestamp
 * @returns the projection
 */
export function projectVantaRisk({ dto, at }: { dto: VantaRiskScenarioDto; at: string }): VantaProjection {
  const { entity } = buildEntity({
    at,
    detail: dto,
    kind: "risk",
    providerId: dto.riskId,
    sensitivity: dto.isSensitive === null ? null : { handleWithCare: true, providerMarkedSensitive: dto.isSensitive },
    source: manageApiSource({ at, deepLink: null, endpoint: "/risk-scenarios" }),
  });
  return { entity, pendingWrite: null };
}

/**
 * A policy's deep link: its latest approved version's first document. A policy never approved
 * (`latestApprovedVersion` is declared nullable) or approved with no document has none, by design, and
 * `manageApiSource` records that as `unavailable` rather than inventing a link.
 */
function policyDeepLink({ dto }: { dto: VantaPolicyDto }): string | null {
  const first = dto.latestApprovedVersion?.documents[0];
  if (first === undefined) {
    return null;
  }
  return first.url;
}

/**
 * Project one policy. Its latest approved version's first document, if any, is a real provider-supplied
 * deep link — the one Manage API kind with one.
 *
 * @param dto the policy DTO
 * @param at this run's ISO timestamp
 * @returns the projection
 */
export function projectVantaPolicy({ dto, at }: { dto: VantaPolicyDto; at: string }): VantaProjection {
  const deepLink = policyDeepLink({ dto });
  const { entity } = buildEntity({
    at,
    detail: dto,
    kind: "policy",
    providerId: dto.id,
    sensitivity: null,
    source: manageApiSource({ at, deepLink, endpoint: "/policies" }),
  });
  return { entity, pendingWrite: null };
}

/**
 * Project one document (this atlas's "evidence" kind). `isSensitive` is required and non-nullable here,
 * unlike the risk scenario's deprecated flag — Vanta always states a position for a document.
 *
 * @param dto the document DTO
 * @param at this run's ISO timestamp
 * @returns the projection
 */
export function projectVantaEvidence({ dto, at }: { dto: VantaDocumentDto; at: string }): VantaProjection {
  const { entity } = buildEntity({
    at,
    detail: dto,
    kind: "evidence",
    providerId: dto.id,
    sensitivity: { handleWithCare: true, providerMarkedSensitive: dto.isSensitive },
    source: manageApiSource({ at, deepLink: dto.url, endpoint: "/documents" }),
  });
  return { entity, pendingWrite: null };
}

/**
 * Project one vendor. Its `contractAmount` is a financial record, not compliance metadata, and never
 * reaches `entity.channels['manage-api'].detail` — see this file's header and `privacy.ts`.
 *
 * @param dto the vendor DTO
 * @param at this run's ISO timestamp
 * @returns the projection, plus the pending write if this vendor carried a contract amount
 */
export function projectVantaVendor({ dto, at }: { dto: VantaVendorDto; at: string }): VantaProjection {
  const { contractAmount: _withheld, ...detailWithoutFinancials } = dto;
  const { entity } = buildEntity({
    at,
    detail: detailWithoutFinancials,
    kind: "vendor",
    providerId: dto.id,
    sensitivity: null,
    source: manageApiSource({ at, deepLink: null, endpoint: "/vendors" }),
  });
  // The entity's own id is already the stable digest of {kind, providerId} — reused rather than recomputed,
  // so the pointer and the entity it is attached to can never disagree about which id owns it.
  const decision = admitVendorContractAmount({ contractAmount: dto.contractAmount, entityId: entity.id });
  return { entity: { ...entity, financialDetail: decision.financialDetail }, pendingWrite: decision.pendingWrite };
}
