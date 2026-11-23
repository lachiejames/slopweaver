/**
 * Find and read the installed `xero-node`'s generated API and model modules — the effectful half of the API
 * surface, whose parsing is the pure `sdkEndpoints.ts`.
 *
 * ## Why the subject is the INSTALLED package rather than a list or a downloaded spec
 *
 * A hand-written endpoint list is a snapshot of the day somebody typed it, which is the exact failure the
 * atlas doctrine exists to stop. A vendored OpenAPI document is the same thing with more pages, and it is
 * also the acquisition `kit/contract.ts` refuses to name — a surface must not claim `filled` on the strength
 * of a file somebody saved once. These modules are generated from Xero's own OpenAPI definitions and ship
 * with the client, so an operation here is an operation this version can send, and a version bump moves the
 * atlas rather than silently invalidating it.
 *
 * ## The package publishes no `exports` map, and that is what makes this a supported read
 *
 * Verified against `xero-node` 19.1.0: `package.json` declares `main` and `types` and no `exports`, so
 * Node's own resolution exposes every file in the package and reading one is not reaching past a boundary
 * the package drew. This reads FILES rather than importing the modules, so nothing in the package executes,
 * no `axios` instance is constructed, and the version this build would send is the version this reports.
 *
 * ## `knip` cannot see this dependency, and that is recorded rather than worked around
 *
 * Nothing here IMPORTS `xero-node` — it reads the package's files — so the unused-dependency gate reports it
 * as unused, correctly, from what it can see. `knip.json` lists it under `ignoreDependencies` for that reason
 * and no other. A token import added purely to satisfy the gate would execute the package's module graph on
 * every load of this file, which is the thing this module is written to avoid.
 *
 * ## Both halves are read, because half of them is not the surface
 *
 * The API classes carry the operations. The MODEL modules carry the response fields, and the owner's own
 * definition of the API half of an atlas is *"every endpoint, every method, every parameter"* — a surface
 * that could not answer "which call hands me `AmountDue`" would be an index rather than a map. Measured
 * against `xero-node` 19.1.0: 11 API classes, 475 operations, 484 models and 2,686 distinct wire field
 * names. Reproduce with `slopweaver atlas xero sync`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { appendAll } from "../../lib/arrays.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import { XeroAtlasErrors, xeroAtlasErrorLines } from "./errors.js";
import { parseXeroSdkModelFields, parseXeroSdkModule, type XeroSdkOperation } from "./sdkEndpoints.js";

/** The package whose declarations are this atlas's API-surface denominator. */
export const XERO_SDK_PACKAGE = "xero-node";

/** Where the generated API classes sit inside the package. */
const API_SUBPATH = join("dist", "gen", "api");

/** Where the generated model modules sit, one directory per Xero product. */
const MODEL_SUBPATH = join("dist", "gen", "model");

/** The suffix every generated API class file carries. */
const API_FILE_SUFFIX = "Api.js";

/** The barrel each product's model directory ships, which declares no fields of its own. */
const MODEL_BARREL = "models.js";

/** What the installed SDK declares, and which version declared it. */
export interface XeroSdkSurface {
  readonly version: string;
  /** Every API class read, sorted, so a report can say what the denominator was drawn from. */
  readonly modules: readonly string[];
  readonly operations: readonly XeroSdkOperation[];
  /** Every model's declared wire field names, keyed by model name. */
  readonly modelFields: Readonly<Record<string, readonly string[]>>;
}

/**
 * The installed package's own root directory.
 *
 * @returns the directory holding the package's `package.json`, or why it could not be resolved
 */
function packageRoot(): Result<string> {
  try {
    return ok(dirname(createRequire(import.meta.url).resolve(`${XERO_SDK_PACKAGE}/package.json`)));
  } catch (error: unknown) {
    return err(
      xeroAtlasErrorLines({ error: XeroAtlasErrors.sdkUnresolved({ cause: error, packageName: XERO_SDK_PACKAGE }) }),
    );
  }
}

/**
 * The installed package's declared version.
 *
 * @param root the package's own root directory
 * @returns the version string, or why it could not be read
 *
 * @internal
 */
export function packageVersion({ root }: { root: string }): Result<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch (error: unknown) {
    return err(
      xeroAtlasErrorLines({
        error: XeroAtlasErrors.packageJsonUnreadable({ cause: error, packageName: XERO_SDK_PACKAGE }),
      }),
    );
  }
  const version = isRecord(parsed) ? parsed["version"] : undefined;
  return typeof version === "string" && version.length > 0
    ? ok(version)
    : err(xeroAtlasErrorLines({ error: XeroAtlasErrors.versionUndeclared({ packageName: XERO_SDK_PACKAGE }) }));
}

/**
 * Read every operation the installed SDK's API classes declare.
 *
 * @param root the package's own root directory
 * @returns the modules read and the operations they declare, or why they could not be
 *
 * @internal
 */
export function readOperations({ root }: { root: string }): Result<{
  modules: readonly string[];
  operations: readonly XeroSdkOperation[];
}> {
  const directory = join(root, API_SUBPATH);
  let files: readonly string[];
  try {
    files = readdirSync(directory)
      .filter((name) => name.endsWith(API_FILE_SUFFIX))
      .toSorted();
  } catch (error: unknown) {
    return err(
      xeroAtlasErrorLines({
        error: XeroAtlasErrors.apiClassesUnlisted({
          cause: error,
          packageName: XERO_SDK_PACKAGE,
          subpath: API_SUBPATH,
        }),
      }),
    );
  }
  const modules: string[] = [];
  const operations: XeroSdkOperation[] = [];
  for (const file of files) {
    const module = file.slice(0, -".js".length);
    let source: string;
    try {
      source = readFileSync(join(directory, file), "utf8");
    } catch (error: unknown) {
      return err(
        xeroAtlasErrorLines({
          error: XeroAtlasErrors.apiClassUnreadable({ cause: error, file, packageName: XERO_SDK_PACKAGE }),
        }),
      );
    }
    modules.push(module);
    appendAll({ from: parseXeroSdkModule({ module, source }), into: operations });
  }
  return ok({ modules, operations });
}

/**
 * Read every model's declared wire field names.
 *
 * A model that cannot be read is skipped rather than failing the sync: the operations are the surface's
 * spine and the fields are its detail, so losing one model's fields costs a reader that model's answer while
 * losing the whole surface costs them every answer. What is NOT tolerated is losing all of them silently —
 * {@link readXeroSdkSurface} refuses a surface with no fields at all.
 *
 * @param root the package's own root directory
 * @returns every model's field names keyed by model name, or why the model tree could not be listed
 *
 * @internal
 */
export function readModelFields({ root }: { root: string }): Result<Readonly<Record<string, readonly string[]>>> {
  const modelRoot = join(root, MODEL_SUBPATH);
  let products: readonly string[];
  try {
    products = readdirSync(modelRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch (error: unknown) {
    return err(
      xeroAtlasErrorLines({
        error: XeroAtlasErrors.modelsUnlisted({ cause: error, packageName: XERO_SDK_PACKAGE, subpath: MODEL_SUBPATH }),
      }),
    );
  }
  const fields: Record<string, readonly string[]> = {};
  for (const product of products) {
    for (const file of modelFilesIn({ directory: join(modelRoot, product) })) {
      const source = readTextOrNull({ path: join(modelRoot, product, file) });
      if (source === null) {
        continue;
      }
      const declared = parseXeroSdkModelFields({ source });
      if (declared.length > 0) {
        fields[modelNameOf({ file })] = declared.toSorted();
      }
    }
  }
  return ok(fields);
}

/** Every generated model file in one product directory, barrel excluded. */
function modelFilesIn({ directory }: { directory: string }): readonly string[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".js") && name !== MODEL_BARREL)
      .toSorted();
  } catch {
    return [];
  }
}

/** One model file's contents, or `null` when it cannot be read — see {@link readModelFields}. */
function readTextOrNull({ path }: { path: string }): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * The model NAME a generated file declares, from its file name.
 *
 * The package writes `invoice.js` for `Invoice` and `bankTransaction.js` for `BankTransaction`, so the
 * name is the stem with its first character upper-cased. That is the spelling an operation's
 * `deserialize(response.data, "Invoices")` uses, which is what the two have to be joined on.
 *
 * @param file the model file's name
 * @returns the model name
 *
 * @internal
 */
export function modelNameOf({ file }: { file: string }): string {
  const stem = file.slice(0, -".js".length);
  return `${stem.charAt(0).toUpperCase()}${stem.slice(1)}`;
}

/**
 * Read every operation and model field the installed SDK declares.
 *
 * @returns the surface, or every reason it could not be read
 */
export function readXeroSdkSurface(): Result<XeroSdkSurface> {
  const root = packageRoot();
  if (root.isErr()) {
    return err(root.error);
  }
  const version = packageVersion({ root: root.value });
  if (version.isErr()) {
    return err(version.error);
  }
  const api = readOperations({ root: root.value });
  if (api.isErr()) {
    return err(api.error);
  }
  const fields = readModelFields({ root: root.value });
  if (fields.isErr()) {
    return err(fields.error);
  }
  if (api.value.operations.length === 0) {
    return err(
      xeroAtlasErrorLines({
        error: XeroAtlasErrors.noOperations({
          moduleCount: api.value.modules.length,
          packageName: XERO_SDK_PACKAGE,
          version: version.value,
        }),
      }),
    );
  }
  if (Object.keys(fields.value).length === 0) {
    return err(
      xeroAtlasErrorLines({
        error: XeroAtlasErrors.noModelFields({ packageName: XERO_SDK_PACKAGE, version: version.value }),
      }),
    );
  }
  return ok({
    modelFields: fields.value,
    modules: api.value.modules,
    operations: api.value.operations,
    version: version.value,
  });
}
