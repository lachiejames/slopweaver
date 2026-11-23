/**
 * GENERATED — do not hand-edit. Regenerate with `yarn tsx tools/generateJamSurfaces.ts` and review the
 * diff.
 *
 * The documents this atlas compiles, pinned by digest, and the census the generator asserts on every run.
 * A digest that has moved is a FINDING rather than a failure — `errors.ts` carries why.
 */
import type { JamSpecPin } from "../surfaceRow.js";

/** Every document this atlas compiles, pinned. */
export const JAM_SPEC_PINS: readonly JamSpecPin[] = [
  {
    byteLength: 20571,
    documentTitle: "Jam Public API",
    id: "openapi",
    operationCount: 14,
    pathCount: 11,
    securitySchemes: [
      "BearerAuth",
    ],
    serverUrl: "https://api.jam.dev",
    sha256: "b628e9368a59feb783c9ae0970f209cd376949fb71d7d75f8052403d1c0a3d8f",
    url: "https://api.jam.dev/openapi.json",
    version: "1.0.0",
  },
  {
    byteLength: 608,
    documentTitle: "OAuth 2.0 Authorization Server Metadata",
    id: "authorization-server",
    operationCount: 0,
    pathCount: 0,
    securitySchemes: [],
    serverUrl: "",
    sha256: "81fdadb8193d417cbae173e7f96c89d718365ee06483b2e7612cc38c265ac6d6",
    url: "https://api.jam.dev/.well-known/oauth-authorization-server",
    version: "unversioned",
  },
  {
    byteLength: 187,
    documentTitle: "OAuth 2.0 Protected Resource Metadata (api.jam.dev)",
    id: "api-protected-resource",
    operationCount: 0,
    pathCount: 0,
    securitySchemes: [],
    serverUrl: "",
    sha256: "fb74e33830dd1657f7baf7b24acc1ff2cb6b6f9669e8f1ff3fab8ffad0753aa2",
    url: "https://api.jam.dev/.well-known/oauth-protected-resource",
    version: "unversioned",
  },
  {
    byteLength: 235,
    documentTitle: "OAuth 2.0 Protected Resource Metadata (mcp.jam.dev)",
    id: "mcp-protected-resource",
    operationCount: 0,
    pathCount: 0,
    securitySchemes: [],
    serverUrl: "",
    sha256: "3835717c447775a1e1f4033c2a8c72a9e29cb9c3706c915dee8219869941f07a",
    url: "https://mcp.jam.dev/.well-known/oauth-protected-resource",
    version: "unversioned",
  },
];

/** The reviewed census. `--verify` refuses when any of these moves. */
export const JAM_CENSUS = {
  integrations: 9,
  operations: 14,
  routesAnswered: 10,
  routesNotRouted: 9,
  routesProbed: 23,
  routesRoutedNoLeaf: 4,
  scopes: 4,
  scopesNamedByNoOperation: 4,
} as const;
