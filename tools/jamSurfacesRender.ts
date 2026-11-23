/**
 * The two generated modules' text and where they are written, for `tools/generateJamSurfaces.ts`. Split out
 * so the generator stays under the file-size cap; the only effect here is the final write of each module.
 */
import { writeFileSync } from "node:fs";

import type {
  JamIntegrationRow,
  JamOperationRow,
  JamRouteRow,
  JamScopeRow,
  JamSpecPin,
} from "../src/atlas/jam/surfaceRow.js";

import { isRecord } from "./jamSurfacesExtract.js";

/** Where the two generated modules are written. */
export const SPEC_LOCK_OUTPUT = "src/atlas/jam/generated/specLock.ts";
export const SURFACES_OUTPUT = "src/atlas/jam/generated/surfaces.ts";

/** Render one value as a TypeScript literal, sorted keys, two-space indent. */
function literal({ value, indent }: { value: unknown; indent: string }): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const inner = value.map((entry) => `${indent}  ${literal({ indent: `${indent}  `, value: entry })},`).join("\n");
    return `[\n${inner}\n${indent}]`;
  }
  if (isRecord(value)) {
    const inner = Object.keys(value)
      .toSorted((left, right) => left.localeCompare(right))
      .map((key) => `${indent}  ${key}: ${literal({ indent: `${indent}  `, value: value[key] })},`)
      .join("\n");
    return `{\n${inner}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** Write `generated/specLock.ts` to {@link SPEC_LOCK_OUTPUT}. */
export function writeSpecLock({ pins, census }: { pins: readonly JamSpecPin[]; census: Record<string, number> }): void {
  const body = `/**
 * GENERATED — do not hand-edit. Regenerate with \`yarn tsx tools/generateJamSurfaces.ts\` and review the
 * diff.
 *
 * The documents this atlas compiles, pinned by digest, and the census the generator asserts on every run.
 * A digest that has moved is a FINDING rather than a failure — \`errors.ts\` carries why.
 */
import type { JamSpecPin } from "../surfaceRow.js";

/** Every document this atlas compiles, pinned. */
export const JAM_SPEC_PINS: readonly JamSpecPin[] = ${literal({ indent: "", value: pins })};

/** The reviewed census. \`--verify\` refuses when any of these moves. */
export const JAM_CENSUS = ${literal({ indent: "", value: census })} as const;
`;
  writeFileSync(SPEC_LOCK_OUTPUT, body);
}

/** Write `generated/surfaces.ts` to {@link SURFACES_OUTPUT}. */
export function writeSurfaces({
  operations,
  scopes,
  routes,
  integrations,
}: {
  operations: readonly JamOperationRow[];
  scopes: readonly JamScopeRow[];
  routes: readonly JamRouteRow[];
  integrations: readonly JamIntegrationRow[];
}): void {
  const body = `/**
 * GENERATED — do not hand-edit. Regenerate with \`yarn tsx tools/generateJamSurfaces.ts\` and review the
 * diff.
 *
 * The four compiled tables this atlas publishes with no credential and no request: what Jam's own
 * description declares, what its authorization server grants, what its two hosts actually serve, and which
 * integrations it publishes a page for.
 */
import type { JamIntegrationRow, JamOperationRow, JamRouteRow, JamScopeRow } from "../surfaceRow.js";

/** Every operation the pinned description declares. */
export const JAM_OPERATIONS: readonly JamOperationRow[] = ${literal({ indent: "", value: operations })};

/** Every scope the authorization server declares, and who claims it. */
export const JAM_SCOPES: readonly JamScopeRow[] = ${literal({ indent: "", value: scopes })};

/** Every route the credential-free probe asked about, and what the server answered. */
export const JAM_ROUTES: readonly JamRouteRow[] = ${literal({ indent: "", value: routes })};

/** Every integration Jam publishes a page for. */
export const JAM_INTEGRATIONS: readonly JamIntegrationRow[] = ${literal({ indent: "", value: integrations })};
`;
  writeFileSync(SURFACES_OUTPUT, body);
}
