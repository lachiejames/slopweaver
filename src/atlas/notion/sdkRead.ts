/**
 * Find and read the installed `@notionhq/client`'s generated endpoint modules — the effectful half of the
 * API surface, whose parsing is the pure `sdkEndpoints.ts`.
 *
 * ## Why the subject is the INSTALLED package rather than a list
 *
 * A hand-written endpoint list is a snapshot of the day somebody typed it, which is the exact failure the
 * atlas doctrine exists to stop. These modules are generated from Notion's own API definitions and ship
 * with the client this repository already calls, so an endpoint here is an endpoint this version can send —
 * and a version bump moves the atlas rather than silently invalidating it.
 *
 * ## The package publishes no `exports` map, and that is what makes this a supported read
 *
 * Verified against `@notionhq/client` 5.23.2: `package.json` declares `main` and no `exports`, so Node's
 * own resolution exposes every file in the package and reading one is not reaching past a boundary the
 * package drew. This reads FILES rather than importing the modules, so nothing in the package executes and
 * the version this build would send is the version this reports.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { appendAll } from "../../lib/arrays.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import { NotionAtlasErrors, notionAtlasErrorLines } from "./errors.js";
import { type NotionSdkEndpoint, parseNotionSdkModule } from "./sdkEndpoints.js";

/** The package whose declarations are this atlas's API-surface denominator. */
export const NOTION_SDK_PACKAGE = "@notionhq/client";

/** Where the generated endpoint modules sit inside the package. */
const ENDPOINTS_SUBPATH = join("build", "src", "api-endpoints");

/** The API root every declared path hangs off, and the reproduction handle a stored row carries. */
export const NOTION_API_BASE_PATH = "v1";

/** What the installed SDK declares, and which version declared it. */
export interface NotionSdkSurface {
  readonly version: string;
  /** Every module read, in directory order, so a report can say what the denominator was drawn from. */
  readonly modules: readonly string[];
  readonly endpoints: readonly NotionSdkEndpoint[];
}

/**
 * The installed package's own root directory.
 *
 * @returns the directory holding the package's `package.json`, or why it could not be resolved
 */
function packageRoot(): Result<string> {
  try {
    return ok(dirname(createRequire(import.meta.url).resolve(`${NOTION_SDK_PACKAGE}/package.json`)));
  } catch (error: unknown) {
    return err(
      notionAtlasErrorLines({
        error: NotionAtlasErrors.sdkUnresolved({ cause: error, packageName: NOTION_SDK_PACKAGE }),
      }),
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
      notionAtlasErrorLines({
        error: NotionAtlasErrors.packageJsonUnreadable({ cause: error, packageName: NOTION_SDK_PACKAGE }),
      }),
    );
  }
  const version = isRecord(parsed) ? parsed["version"] : undefined;
  return typeof version === "string" && version.length > 0
    ? ok(version)
    : err(notionAtlasErrorLines({ error: NotionAtlasErrors.versionUndeclared({ packageName: NOTION_SDK_PACKAGE }) }));
}

/**
 * Read every endpoint the installed SDK declares.
 *
 * @returns the surface, or every reason it could not be read
 */
export function readNotionSdkSurface(): Result<NotionSdkSurface> {
  const root = packageRoot();
  if (root.isErr()) {
    return err(root.error);
  }
  const version = packageVersion({ root: root.value });
  if (version.isErr()) {
    return err(version.error);
  }
  const directory = join(root.value, ENDPOINTS_SUBPATH);
  let files: readonly string[];
  try {
    files = readdirSync(directory)
      .filter((name) => name.endsWith(".js"))
      .toSorted();
  } catch (error: unknown) {
    return err(
      notionAtlasErrorLines({
        error: NotionAtlasErrors.endpointsUnlisted({
          cause: error,
          packageName: NOTION_SDK_PACKAGE,
          subpath: ENDPOINTS_SUBPATH,
        }),
      }),
    );
  }
  const modules: string[] = [];
  const endpoints: NotionSdkEndpoint[] = [];
  for (const file of files) {
    const module = file.slice(0, -".js".length);
    let source: string;
    try {
      source = readFileSync(join(directory, file), "utf8");
    } catch (error: unknown) {
      return err(
        notionAtlasErrorLines({
          error: NotionAtlasErrors.moduleUnreadable({ cause: error, file, packageName: NOTION_SDK_PACKAGE }),
        }),
      );
    }
    modules.push(module);
    appendAll({ from: parseNotionSdkModule({ module, source }), into: endpoints });
  }
  if (endpoints.length === 0) {
    return err(
      notionAtlasErrorLines({
        error: NotionAtlasErrors.noEndpoints({
          moduleCount: modules.length,
          packageName: NOTION_SDK_PACKAGE,
          version: version.value,
        }),
      }),
    );
  }
  return ok({ endpoints, modules, version: version.value });
}
