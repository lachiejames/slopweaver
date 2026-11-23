/**
 * Which `orchestration/` entries the `codex` leg of `store import-fleet` projects, and reading a pass's
 * optional artifact.
 *
 * Split out of `./importFleetRun.ts`, which the `file-size-ratchet` holds at its measured size: the
 * `owner-turns` leg's dispatch arm was paid for by moving these two filesystem helpers here, where they sit
 * beside nothing but each other.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The pass directories under `orchestration/`, with the scratch siblings and the half-written ones gone.
 *
 * Split out of `runCodexLeg` so the loop there is about projecting rather than about which entries
 * count; together they put one function over the `cognitive-complexity` ceiling. A `.scratch` sibling is
 * skipped by NAME, which is what keeps the 16 GB out — see `./importFleetRun.ts`'s header. A directory with no
 * `record.json` is a pass killed before it recorded anything, and there is nothing to import from one.
 *
 * @param orchestrationDir where the pass directories live
 * @returns each importable pass directory's absolute path, in name order
 */
export function codexPassDirs({ orchestrationDir }: { orchestrationDir: string }): readonly string[] {
  return readdirSync(orchestrationDir)
    .toSorted()
    .filter((name) => !name.endsWith(".scratch"))
    .map((name) => join(orchestrationDir, name))
    .filter((dir) => statSync(dir).isDirectory())
    .filter((dir) => existsSync(join(dir, "record.json")));
}

/**
 * A file's text when it is there.
 *
 * A named function rather than a ternary, because `prefer-nullish-coalescing` rewrites the ternary into a
 * `??` that `no-silent-fallback` then refuses — see `../../../store/fleet/codexPass.ts`'s `orNull` for the
 * same pair of gates.
 *
 * @param path the file to read
 * @returns its contents, or `undefined` when it does not exist
 */
export function readIfPresent({ path }: { path: string }): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, "utf8");
}
