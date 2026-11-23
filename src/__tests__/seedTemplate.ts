/**
 * A seeded template a test file builds lazily, on the first case that asks, and copies per case.
 *
 * The one rule this holds: a template is PUBLISHED only once its seed has returned. A lazy cache written as
 * `template = mkdtempSync(...); seed({ dir: template });` publishes the directory before seeding it, so a seed
 * that throws part-way — a transient `git commit` failure, a full disk — leaves a half-built template cached, and
 * every later case in a shuffled order copies it and fails for a reason that is not its own. Here a
 * failed seed removes its directory and rethrows, and the caller's cache stays empty, so the next case seeds
 * afresh.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Mint a directory under the per-file temp root, seed it, and return it only once the seed has returned.
 *
 * @param prefix the directory name's prefix, as `mkdtempSync` takes it
 * @param seed what builds the template inside the directory it is given
 * @returns the seeded template's path, for the caller to cache and to remove in its `afterAll`
 */
export function seedTemplate({ prefix, seed }: { prefix: string; seed: (args: { dir: string }) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    seed({ dir });
  } catch (error: unknown) {
    rmSync(dir, { force: true, recursive: true });
    throw error;
  }
  return dir;
}
