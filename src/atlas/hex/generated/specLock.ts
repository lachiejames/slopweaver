/**
 * The published Hex OpenAPI document, pinned by digest. GENERATED — do not edit.
 *
 * Regenerate with `yarn tsx tools/generateHexSpecLock.ts`, and check the committed pin against what is
 * served with `yarn tsx tools/generateHexSpecLock.ts --verify`.
 *
 * 37 paths declaring 52 operations, answering
 * on https://app.hex.tech/api. The address carries no version, so the digest is the only handle on which
 * document was reviewed — the generator's header says why, and `atlas/hex/errors.ts` says why a moved
 * digest is compiled and reported rather than refused.
 */
import type { HexSpecPin } from "../specPin.js";

/**
 * The one address ever fetched. No caller supplies one.
 *
 * @internal
 */
export const HEX_SPEC_URL = "https://static.hex.site/openapi.json";

/** The published document, pinned by digest. One row, because Hex publishes one document. */
export const HEX_SPEC_PINS: readonly HexSpecPin[] = [
  {
    byteLength: 365747,
    hosts: ["https://app.hex.tech/api"],
    id: "hex-public-api",
    operationCount: 52,
    pathCount: 37,
    securitySchemes: ["bearerAuth"],
    sha256: "f67db775ddacb86523d7db1fd55e28f248383632ca0ad8bfb1c1ed9e8903aede",
    title: "Hex API",
    url: HEX_SPEC_URL,
    version: "1.0.0",
  },
];
