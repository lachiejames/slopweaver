/**
 * Which root `node_modules` belongs to which project — the test a tree passes before it enters the recycle pool
 * (`./recyclePool.ts`) and again before a claim takes it out.
 *
 * Yarn's node-modules linker records the project it installed for in the `.yarn-state.yml` it writes into the
 * tree, under the key `<root package name>@workspace:.`. A tree whose state names another root workspace was
 * installed for another project, and must never be offered to this one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { safeJsonParse } from "#lib/safeJson.js";

/** The marker yarn's node-modules linker writes into a root `node_modules`, and diffs its next install against. */
export const YARN_STATE_FILE = ".yarn-state.yml";

/** Whether a tree may be deposited, decided while the worktree it was installed in still exists. */
export type RecycleIdentity =
  | { readonly kind: "eligible"; readonly packageName: string }
  | { readonly kind: "ineligible"; readonly detail: string };

/**
 * The `name` a `package.json` declares.
 *
 * @param manifestText the manifest's text, or `undefined` when it could not be read
 * @returns the name, or `undefined` when the manifest is absent, malformed or nameless
 */
export function packageNameOf({ manifestText }: { manifestText: string | undefined }): string | undefined {
  if (manifestText === undefined) {
    return undefined;
  }
  try {
    const name: unknown = Reflect.get(Object(safeJsonParse({ label: "package.json", text: manifestText })), "name");
    return typeof name === "string" && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a `.yarn-state.yml` was installed for a project whose root package is `packageName` — whether its
 * top-level mapping owns the exact key `<packageName>@workspace:.` yarn writes for the project itself. Parsed,
 * not pattern-matched, so a quoting difference or a name that is a prefix of another cannot pass.
 *
 * @param yarnStateText the file's contents
 * @param packageName the root `package.json`'s name
 * @returns whether the state names that root workspace
 */
export function stateNamesWorkspace({
  yarnStateText,
  packageName,
}: {
  yarnStateText: string;
  packageName: string;
}): boolean {
  try {
    const parsed: unknown = parse(yarnStateText);
    return typeof parsed === "object" && parsed !== null && Object.hasOwn(parsed, `${packageName}@workspace:.`);
  } catch {
    return false;
  }
}

/**
 * Whether a root `node_modules` may be deposited: its `.yarn-state.yml` must name the root workspace of the
 * manifest it was installed beside. Without that file yarn treats every entry as unknown, which is the install a
 * recycled tree exists to avoid, and a tree installed for another project must never be offered to this one.
 *
 * @param manifestText the worktree's root `package.json`, or `undefined` when unreadable
 * @param yarnStateText its `node_modules/.yarn-state.yml`, or `undefined` when unreadable
 * @returns eligible with the package name, or why not
 */
export function recycleIdentity({
  manifestText,
  yarnStateText,
}: {
  manifestText: string | undefined;
  yarnStateText: string | undefined;
}): RecycleIdentity {
  const packageName = packageNameOf({ manifestText });
  if (packageName === undefined) {
    return { detail: "its package.json names no package", kind: "ineligible" };
  }
  if (yarnStateText === undefined) {
    return { detail: `it carries no readable ${YARN_STATE_FILE}`, kind: "ineligible" };
  }
  if (!stateNamesWorkspace({ packageName, yarnStateText })) {
    return { detail: `its ${YARN_STATE_FILE} was not installed for ${packageName}`, kind: "ineligible" };
  }
  return { kind: "eligible", packageName };
}

/**
 * One file's text.
 *
 * @param path the file to read
 * @returns its contents, or `undefined` when it cannot be read
 */
export function textOf({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * {@link recycleIdentity} for a worktree's own root `node_modules`, read off disk. Must be asked while the
 * worktree still exists: once git removes it, its `package.json` is gone.
 *
 * @param worktree the worktree whose root `node_modules` would be deposited
 * @returns eligible with the package name, or why not
 */
export function worktreeRecycleIdentity({ worktree }: { worktree: string }): RecycleIdentity {
  return recycleIdentity({
    manifestText: textOf({ path: join(worktree, "package.json") }),
    yarnStateText: textOf({ path: join(worktree, "node_modules", YARN_STATE_FILE) }),
  });
}
