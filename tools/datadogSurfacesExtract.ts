/**
 * Extract every operation from the pinned Datadog API client's compiled modules.
 *
 * Split out of `tools/generateDatadogSurfaces.ts` so the generator stays under the file-size cap; the pin
 * check, the regex extraction and its census live here, and the row policy and file writing stay there.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DATADOG_SDK_PIN } from "../src/atlas/datadog/generated/sdkLock.js";
import type { DatadogSpec } from "../src/atlas/datadog/surfaceNaming.js";

export const SPECS: readonly DatadogSpec[] = ["v1", "v2"];
const SDK_ROOT = "node_modules/@datadog/datadog-api-client/dist/packages";

/** The methods a compiled operation can declare. Kept wide because the registry inventories writes too. */
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

/** Where one package's compiled API modules live. */
function apisDirectory({ spec }: { spec: DatadogSpec }): string {
  return join(SDK_ROOT, `datadog-api-client-${spec}`, "apis");
}

/** Every compiled API module in one package, in sorted name order. */
function apiModules({ spec }: { spec: DatadogSpec }): readonly string[] {
  return readdirSync(apisDirectory({ spec }))
    .filter((name) => name.endsWith(".js"))
    .toSorted();
}

/**
 * Hash one package's compiled API modules, name then bytes, in sorted order.
 *
 * @param spec which package to hash
 * @returns the lowercase hex digest
 */
function packageDigest({ spec }: { spec: DatadogSpec }): string {
  const hash = createHash("sha256");
  for (const name of apiModules({ spec })) {
    hash.update(name);
    hash.update(readFileSync(join(apisDirectory({ spec }), name)));
  }
  return hash.digest("hex");
}

/** One operation, exactly as the compiled client declares it. */
export interface Extracted {
  readonly operationKey: string;
  readonly method: Method;
  readonly path: string;
  readonly queryParameters: readonly string[];
  /** Whether the client guards this operation behind `unstableOperations`. */
  readonly unstable: boolean;
}

/** Whether a captured method string is one the SDK is known to emit. */
function isMethod(value: string): value is Method {
  return METHODS.some((method) => method === value);
}

/**
 * Extract every operation from one compiled module.
 *
 * @param text the module's source, verbatim
 * @param file the module's name, used only in the refusal message
 * @returns every operation it declares, in declaration order
 */
function extractModule({ text, file }: { text: string; file: string }): readonly Extracted[] {
  const anchor =
    /\.getServer\("([^"]+)"\)\s*\n?\s*\.makeRequestContext\(localVarPath,\s*http_1\.HttpMethod\.([A-Z]+)\)/g;
  const sites = [...text.matchAll(anchor)];
  const declared = [...text.matchAll(/\.getServer\("/g)].length;
  if (sites.length !== declared) {
    throw new Error(`${file}: matched ${String(sites.length)} operations but the module declares ${String(declared)}`);
  }
  const out: Extracted[] = [];
  for (let index = 0; index < sites.length; index += 1) {
    // `sites` is indexed inside its own length, so the `!` is the honest spelling and a guard here would be
    // dead code the type-aware lint rightly refuses. `previous` at index -1 is the one genuinely absent
    // case and `.at()` is what says so honestly.
    const site = sites[index]!;
    const previous = sites.at(index - 1);
    const start = index === 0 || previous === undefined ? 0 : previous.index + previous[0].length;
    const before = text.slice(start, site.index);
    const paths = [...before.matchAll(/const localVarPath\s*=\s*"([^"]*)"/g)];
    const path = paths.at(-1)?.[1];
    const operationKey = site[1]!;
    const method = site[2]!;
    if (path === undefined || !isMethod(method)) {
      throw new Error(`${file}: operation ${String(index)} is missing a path, key or method`);
    }
    const nextStart = sites[index + 1]?.index ?? text.length;
    const after = text.slice(site.index, nextStart);
    out.push({
      method,
      operationKey,
      path,
      queryParameters: [...after.matchAll(/setQueryParam\("([^"]+)"/g)].map((match) => match[1]!),
      // The guard sits BEFORE the request is built, in the same method body, so it is looked for in the
      // segment leading up to this anchor rather than after it. It is keyed WITHOUT the API class —
      // `v2.createIncident`, not `v2.IncidentsApi.createIncident` — which is why the class segment is
      // dropped here rather than the key being reused verbatim.
      unstable: before.includes(`unstableOperations["${operationKey.replace(/\.[A-Za-z0-9]+Api\./, ".")}"]`),
    });
  }
  return out;
}

/**
 * Every operation the pinned client declares, with the pin verified first.
 *
 * @returns every operation across both packages
 */
export function extractAll(): readonly Extracted[] {
  const out: Extracted[] = [];
  for (const spec of SPECS) {
    const pin = DATADOG_SDK_PIN.packages[spec];
    const modules = apiModules({ spec });
    if (modules.length !== pin.apiModules) {
      throw new Error(`${spec}: ${String(modules.length)} api modules, pinned at ${String(pin.apiModules)}`);
    }
    const digest = packageDigest({ spec });
    if (digest !== pin.sha256) {
      throw new Error(`${spec}: digest moved (${digest}) — review the diff before regenerating`);
    }
    for (const file of modules) {
      out.push(...extractModule({ file, text: readFileSync(join(apisDirectory({ spec }), file), "utf8") }));
    }
  }
  const byMethod = new Map<string, number>();
  for (const operation of out) {
    byMethod.set(operation.method, (byMethod.get(operation.method) ?? 0) + 1);
  }
  if (out.length !== DATADOG_SDK_PIN.census.total) {
    throw new Error(`operation census moved: ${String(out.length)} vs pinned ${String(DATADOG_SDK_PIN.census.total)}`);
  }
  for (const method of METHODS) {
    const seen = byMethod.get(method) ?? 0;
    if (seen !== DATADOG_SDK_PIN.census[method]) {
      throw new Error(`${method} census moved: ${String(seen)} vs pinned ${String(DATADOG_SDK_PIN.census[method])}`);
    }
  }
  const unstable = out.filter((operation) => operation.unstable).length;
  if (unstable !== DATADOG_SDK_PIN.unstableOperations) {
    throw new Error(
      `unstable census moved: ${String(unstable)} vs pinned ${String(DATADOG_SDK_PIN.unstableOperations)}`,
    );
  }
  return out;
}
