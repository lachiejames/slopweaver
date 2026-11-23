/**
 * `handover reconcile`'s scope: the `--dir` and `--home` it scans from, resolved to absolute paths once, and the
 * same two paths as the flags every command it prints carries — so a printed command pasted from another
 * directory still names the board this run read, and the scan and the printed `--dir` are one path
 * even through a symlink.
 */

import { resolve } from "node:path";

/**
 * The `--dir` and `--home` a caller passed, each resolved to an absolute path once, so the board is scanned
 * from the same path every printed command names.
 *
 * @returns each flag's absolute path, or undefined where it was not passed
 */
export function scopePaths({ values }: { values: Readonly<Record<string, unknown>> }): {
  dir: string | undefined;
  home: string | undefined;
} {
  const dir = values["dir"];
  const home = values["home"];
  return {
    dir: typeof dir === "string" ? resolve(dir) : undefined,
    home: typeof home === "string" ? resolve(home) : undefined,
  };
}

/**
 * The `--dir` and `--home` this run was given, as flags every printed command carries.
 *
 * @returns the flags, each name followed by its absolute value
 */
export function scopeFlagsOf({ scope }: { scope: ReturnType<typeof scopePaths> }): readonly string[] {
  return (["dir", "home"] as const).flatMap((name) => {
    const value = scope[name];
    return value === undefined ? [] : [`--${name}`, value];
  });
}
