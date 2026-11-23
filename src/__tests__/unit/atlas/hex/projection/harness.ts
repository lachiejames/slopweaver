/*
 * The pure fixtures the Hex projection test files share: the observation instant, the Hex origin, the one-channel
 * `api` entity every projection assembles, and two tagged spec pins. Nothing here touches disk. It moved here when
 * `projection.test.ts` was split by behaviour.
 */
import { hexEntityId } from "../../../../../atlas/hex/identity.js";
import type { HexApiDetail, HexAtlasEntity, HexAtlasKind, HexMethodApiDetail } from "../../../../../atlas/hex/model.js";
import type { HexSpecPin } from "../../../../../atlas/hex/specPin.js";

export const AT = "2026-10-01T00:00:00.000Z";
export const ORIGIN = "https://app.hex.tech";

/**
 * An entity carrying exactly one filled `api` channel, the way every projection here assembles one.
 *
 * @returns the entity, observed at `AT` with no artifacts and no browser channel
 */
export function apiEntity({
  kind,
  providerId,
  detail,
  deepLink,
  deepLinkStatus,
  endpoint,
}: {
  kind: HexAtlasKind;
  providerId: string;
  detail: HexApiDetail | HexMethodApiDetail;
  deepLink: string | null;
  deepLinkStatus: "provider-provided" | "unavailable";
  endpoint: string;
}): HexAtlasEntity {
  return {
    channels: {
      api: {
        channel: "api",
        detail,
        firstSeenAt: AT,
        lastSeenAt: AT,
        source: { artifacts: [], channel: "api", deepLink, deepLinkStatus, endpoint, observedAt: AT },
        state: "observed",
      },
      browser: null,
    },
    id: hexEntityId({ kind, providerId }),
    kind,
    providerId,
  };
}

/** A pin whose every field carries a value tagged with `tag`, so a read of the wrong pin or field fails. */
function pin({ tag, ordinal }: { tag: string; ordinal: number }): HexSpecPin {
  return {
    byteLength: 1000 + ordinal,
    hosts: [`https://${tag}.example.test`, `https://${tag}-alt.example.test`],
    id: `spec-${tag}`,
    operationCount: 10 + ordinal,
    pathCount: 20 + ordinal,
    securitySchemes: [`${tag}Auth`, `${tag}Token`],
    sha256: String(ordinal).repeat(64),
    title: `Title ${tag}`,
    url: `https://${tag}.example.test/openapi.json`,
    version: `v${ordinal}.${ordinal}`,
  };
}

export const PIN_ONE = pin({ ordinal: 1, tag: "alpha" });
export const PIN_TWO = pin({ ordinal: 2, tag: "bravo" });
