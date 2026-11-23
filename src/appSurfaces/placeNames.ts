/**
 * Where a module sits, in the words a reviewer uses: the app it belongs to, the URL a route answers on, and
 * the name to search for. Split from the classifier so the classifier holds only the decisions.
 */
import { posix } from "node:path";

import { ROOT_ROUTE } from "./moduleFacts.js";

/** A module an app starts from: `main`, `index`, `server` or `app`, at the workspace root or its `src`. */
export const ENTRY = /^(?:src\/)?(?:main|index|server|app)\.[cm]?[jt]sx?$/;

/** A path under a test directory or named as a test — walked for cover, never a surface. */
export const TEST_PATH = /(?:^|\/)(?:__tests__|__mocks__)\/|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;

/**
 * The workspace directory a module belongs to — the nearest directory with a tracked `package.json`.
 *
 * @returns the workspace directory, or `.` for the repository root
 */
export function workspaceOf({ path, tracked }: { path: string; tracked: ReadonlySet<string> }): string {
  let dir = posix.dirname(path);
  while (dir !== "." && !tracked.has(`${dir}/package.json`)) {
    dir = posix.dirname(dir);
  }
  return dir;
}

/**
 * A workspace directory in plain words: `apps/billing/web` reads `billing web`.
 *
 * @returns the app's name as a reviewer would say it
 */
export function appLabel({ workspace }: { workspace: string }): string {
  if (workspace === ".") {
    return "the repository root";
  }
  return workspace.replace(/^apps\//, "").replaceAll("/", " ");
}

/** A route segment that never appears in a URL: a pathless `_layout` or a `(group)`. */
function isPathless({ segment }: { segment: string }): boolean {
  return segment.startsWith("_") || /^\(.*\)$/.test(segment);
}

/**
 * A TanStack route path in the words a reviewer types into the address bar: pathless `_layout` and `(group)`
 * segments dropped and a non-nesting `plans_` read as `plans`, because none of those appear in a URL. A
 * LAYOUT route — one whose own segment is pathless — renders around every page beneath it, so it reads as
 * every page in that layout, named, rather than as the one page its path alone would name; the root route is
 * every page. An INDEX route is spelled with a trailing slash (`/_authed/`) and is the one page at its path,
 * never the layout it sits in.
 *
 * @param routePath the path as `createFileRoute` spells it, or the root-route marker
 * @returns the path as a URL shows it, or the pages a layout wraps
 */
export function publicRoutePath({ routePath }: { routePath: string }): string {
  if (routePath === ROOT_ROUTE) {
    return "every page";
  }
  const segments = routePath.split("/").filter((segment) => segment.length > 0);
  const kept = segments.filter((segment) => !isPathless({ segment })).map((segment) => segment.replace(/_$/, ""));
  const path = `/${kept.join("/")}`;
  const last = segments.at(-1);
  const isIndex = routePath.endsWith("/");
  const isLayout = !isIndex && last !== undefined && isPathless({ segment: last });
  return isLayout ? `every page in the ${last} layout, under ${path}` : path;
}

/**
 * A module's name as a reviewer would search for it: its file name, or its directory's for an `index` file.
 *
 * @returns the name to search the codebase for
 */
export function moduleName({ path }: { path: string }): string {
  const base = posix.basename(path).replace(/\.[^.]+$/, "");
  return base === "index" ? posix.basename(posix.dirname(path)) : base;
}
