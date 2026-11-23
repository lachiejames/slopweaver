/**
 * Emit `src/atlas/jumpcloud/generated/surfaces.ts` from the three pinned JumpCloud specifications.
 *
 * Run with a directory holding `v1.yaml`, `v2.yaml` and `insights.yaml`:
 *
 * ```bash
 * yarn tsx tools/generateJumpcloudSurfaces.ts <spec-dir>
 * ```
 *
 * REFUSES when a digest, byte length or census moves — the pinned table is the read-only boundary, and a
 * table regenerated from whatever the vendor served this morning is a table nobody reviewed.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { jumpcloudExclusionFor } from "../src/atlas/jumpcloud/exclusions.js";
import { JUMPCLOUD_SPEC_PINS } from "../src/atlas/jumpcloud/generated/specLock.js";
import {
  type JumpcloudSpec,
  kindOf,
  normalizedPath,
  paginationOf,
  surfaceName,
} from "../src/atlas/jumpcloud/surfaceNaming.js";

const SPECS: readonly JumpcloudSpec[] = ["v1", "v2", "insights"];
const ORIGIN_OF: Readonly<Record<JumpcloudSpec, "directory" | "insights">> = {
  insights: "insights",
  v1: "directory",
  v2: "directory",
};

/**
 * The POST operations that only ever QUERY, reviewed one at a time.
 *
 * Every other POST in these specifications is refused by omission. The three graph `.../members` POSTs are
 * the reason this is a list rather than a pattern — they are membership writes wearing a traversal-shaped
 * path — and the `/reports/*` POSTs all create something.
 */
const OBSERVATIONAL_POSTS: Readonly<Record<JumpcloudSpec, readonly string[]>> = {
  insights: ["/events", "/events/count", "/events/distinct", "/events/interval"],
  v1: ["/search/organizations", "/search/systems", "/search/systemusers", "/search/commands", "/search/commandresults"],
  v2: [
    "/authn/policy-evaluations/details",
    "/authn/policy-evaluations/options",
    "/authn/policy-evaluations/summary",
    "/providers/{provider_id}/directoryinsights/events/count",
    "/providers/{provider_id}/directoryinsights/events/distinct",
    "/providers/{provider_id}/directoryinsights/events/interval",
  ],
};

interface Row {
  readonly name: string;
  readonly spec: JumpcloudSpec;
  readonly origin: "directory" | "insights";
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly kind: string;
  readonly pagination: string;
  readonly coverage: "reachable" | "excluded";
  readonly excludedBecause: string | null;
}

/** Whether a parsed YAML node is a plain object, so the generator narrows rather than asserts. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsFor({ spec, text }: { spec: JumpcloudSpec; text: string }): readonly Row[] {
  const pin = JUMPCLOUD_SPEC_PINS[spec];
  const sha = createHash("sha256").update(text).digest("hex");
  if (sha !== pin.sha256 || Buffer.byteLength(text) !== pin.byteLength) {
    throw new Error(`${spec}: digest or length moved — review the diff before regenerating`);
  }
  // `parse` is typed `any`, so narrow through a guard rather than asserting the shape we hope for.
  const doc: unknown = parse(text);
  const paths: Record<string, unknown> = isRecord(doc) && isRecord(doc["paths"]) ? doc["paths"] : {};
  const rows: Row[] = [];
  let getCount = 0;
  for (const [pathKey, item] of Object.entries(paths)) {
    if (!isRecord(item)) {
      continue;
    }
    for (const method of ["get", "post"] as const) {
      const op = item[method];
      if (!isRecord(op)) {
        continue;
      }
      const operationId = typeof op["operationId"] === "string" ? op["operationId"] : `${method}${pathKey}`;
      const declared = Array.isArray(op["parameters"]) ? op["parameters"] : [];
      const parameterNames = declared.map((entry) =>
        isRecord(entry) && typeof entry["name"] === "string" ? entry["name"] : "",
      );
      if (method === "get") {
        getCount += 1;
      }
      // Only GETs, plus POSTs on the reviewed observational allowlist. A prefix heuristic is not safe
      // enough here: `POST /systemgroups/{group_id}/members` reads like graph traversal and is documented
      // "Manage the members of a System Group" with a GraphOperation body — a membership WRITE. Admitting
      // it would hand this atlas the ability to add and remove group members.
      const isObservationalPost = method === "post" && OBSERVATIONAL_POSTS[spec].includes(pathKey);
      const upper = method === "get" ? "GET" : "POST";
      const excluded = jumpcloudExclusionFor({ method: upper, pathKey });
      // A refused POST still gets a row. An atlas that omitted it would answer "JumpCloud has no such
      // endpoint", which is false — the inventory is what makes an exclusion a stated decision rather
      // than a silence.
      if (method === "post" && !isObservationalPost && excluded === undefined) {
        continue;
      }
      rows.push({
        coverage: excluded === undefined ? "reachable" : "excluded",
        excludedBecause: excluded?.detail ?? null,
        kind: kindOf({ pathKey }),
        method: upper,
        name: surfaceName({ operationId, spec }),
        origin: ORIGIN_OF[spec],
        pagination: paginationOf({ parameterNames }),
        path: normalizedPath({ pathKey, spec }),
        spec,
      });
    }
  }
  if (getCount !== pin.getCount) {
    throw new Error(`${spec}: GET census moved (${getCount} vs pinned ${pin.getCount})`);
  }
  if (Object.keys(paths).length !== pin.pathCount) {
    throw new Error(`${spec}: path census moved`);
  }
  return rows;
}

// `.at()` rather than `[2]`: indexed access reads as `string` to the lint's type view, which makes the
// guard look dead, while `.at()` is honestly `string | undefined`.
const dir = process.argv.at(2);
if (dir === undefined) {
  throw new Error("usage: generateJumpcloudSurfaces <spec-dir>");
}
const all = SPECS.flatMap((spec) => rowsFor({ spec, text: readFileSync(join(dir, `${spec}.yaml`), "utf8") }));
const sorted = all.toSorted((a, b) => a.name.localeCompare(b.name));
const names = new Set(sorted.map((r) => r.name));
if (names.size !== sorted.length) {
  throw new Error(`surface name collision: ${sorted.length - names.size} duplicate(s)`);
}
const excludedCount = sorted.filter((r) => r.coverage === "excluded").length;
const body = sorted
  .map(
    (r) =>
      `  { coverage: "${r.coverage}", excludedBecause: ${r.excludedBecause === null ? "null" : JSON.stringify(r.excludedBecause)}, kind: ${JSON.stringify(r.kind)}, method: "${r.method}", name: ${JSON.stringify(r.name)}, origin: "${r.origin}", pagination: "${r.pagination}", path: ${JSON.stringify(r.path)}, spec: "${r.spec}" },`,
  )
  .join("\n");
writeFileSync(
  "src/atlas/jumpcloud/generated/surfaces.ts",
  `/**
 * GENERATED by \`tools/generateJumpcloudSurfaces.ts\` from the specifications pinned in \`specLock.ts\`.
 * Do not edit by hand — regenerate, and review the diff.
 *
 * ${sorted.length} rows: ${sorted.length - excludedCount} reachable, ${excludedCount} excluded.
 */
import type { JumpcloudSurfaceRow } from "../surfaceRow.js";

/** Every operation this atlas knows of, callable or refused, sorted by surface name. */
export const JUMPCLOUD_SURFACES: readonly JumpcloudSurfaceRow[] = [
${body}
];
`,
  "utf8",
);
process.stdout.write(`${sorted.length} rows (${excludedCount} excluded)\n`);
