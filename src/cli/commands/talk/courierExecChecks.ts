/**
 * The two checks the courier's in-place re-exec (`./courierReexec.ts`) runs before `process.execve`, each a way the new
 * image would die before reaching the follow loop. On Node 24 a failed exec aborts the process rather than throwing,
 * so what can be known ahead of the call is asked here rather than discovered by losing the courier.
 */
import { accessSync, closeSync, constants, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

import { guardBuiltTree, hatchIsOpen, STALE_BUILD_ENV } from "../../../builtCli/guard.js";
import { BUILD_MANIFEST_FILE } from "../../../builtCli/staleness.js";

/**
 * Why main's launcher, started with `env`, would run a built CLI that refuses as stale before any verb — mirroring
 * `bin/slopweaver`'s own choice, which runs a build only when both its manifest and its entry exist, then asking the
 * guard that entry reaches first, with the stale-build hatch read from the environment the exec passes on.
 *
 * @param mainRoot the main checkout the exec would run
 * @param env the environment the new image would start with
 * @returns the guard's first refusal line, or `undefined` when main would run its source or a current build
 */
export function mainBuiltCliRefusal({
  mainRoot,
  env,
}: {
  mainRoot: string;
  env: NodeJS.ProcessEnv;
}): string | undefined {
  const builtRoot = join(mainRoot, "dist-cli");
  if (!existsSync(join(builtRoot, BUILD_MANIFEST_FILE)) || !existsSync(join(builtRoot, "cli", "index.js"))) {
    return undefined;
  }
  let guarded: ReturnType<typeof guardBuiltTree>;
  try {
    guarded = guardBuiltTree({ builtRoot, hatchOpen: hatchIsOpen({ value: env[STALE_BUILD_ENV] }) });
  } catch (cause) {
    // A manifest the guard cannot read, or a source scan that fails, throws inside it, and would throw the same way in
    // the new image. A manifest that is not JSON does not: the guard refuses it as no build manifest.
    return `its build could not be judged: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  if (!guarded.refuse) {
    return undefined;
  }
  const [first] = guarded.lines;
  if (first === undefined) {
    return "its staleness guard refused";
  }
  return first;
}

/**
 * Throw unless this Node can exec and the launcher is a regular `#!` script this process may execute — the shape
 * `bin/slopweaver` ships in. `X_OK` alone passes a searchable directory, and a script with no `#!` line runs from a
 * shell but fails a direct exec with ENOEXEC; an exec aborts on either. Whether the
 * interpreter the line names exists is past what is checked here — a MAIN no boot could start (`./courierReexec.ts`).
 *
 * @param file the launcher the exec would run
 */
export function launcherExecutable({ file }: { file: string }): void {
  if (process.execve === undefined) {
    throw new Error(`this Node (${process.version}) has no process.execve`);
  }
  if (!statSync(file).isFile()) {
    throw new Error("it is not a regular file");
  }
  accessSync(file, constants.X_OK);
  const head = Buffer.alloc(2);
  const fd = openSync(file, "r");
  try {
    readSync(fd, head, 0, 2, 0);
  } finally {
    closeSync(fd);
  }
  if (head.toString("latin1") !== "#!") {
    throw new Error("it has no #! line, which a direct exec needs");
  }
}
