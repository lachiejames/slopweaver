/**
 * A state home copied from one an atlas test seeded ONCE, for a file whose cases each start from the same
 * published generation and then write over it.
 *
 * Publishing a generation is fsync-bound: every kind file is flushed to the device before it is installed,
 * which is the durability the store exists to give and the bulk of what an atlas test spends. MEASURED:
 * `fsync` was 2,952 ms of the 5,060 ms `vanta/browserSurface.test.ts` spent, and its `beforeEach` that
 * re-published the same 44-file empty generation per case was 3,340 ms of that. Reproduce with `yarn vitest run
 * --config config/vitest/unit.ts --coverage=false --execArgv=--cpu-prof --execArgv=--cpu-prof-dir=<dir> <file>`
 * and sum the `fsync` self time in the worker's profile. A copy is the SAME bytes, so the case still starts
 * from a generation the real store published — only the repeated flush of identical bytes is gone.
 *
 * The template is the caller's: mint it in a `beforeAll`, seed it through the real store, remove it in an
 * `afterAll`, and never write into it — each case writes into its own clone, which the caller removes too.
 */
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Copy a seeded home's contents into a home a case already owns, timestamps included — for a file whose
 * `beforeEach` mints the case's home before the case knows which seed it starts from.
 *
 * @param template the seeded home, which this only reads
 * @param into the case's own home, which receives the copy
 */
export function copyHomeInto({ template, into }: { template: string; into: string }): void {
  cpSync(template, into, { preserveTimestamps: true, recursive: true });
}

/**
 * Copy a seeded home into a fresh throwaway directory under the per-file temp root, timestamps included.
 *
 * @param template the seeded home, which this only reads
 * @param prefix the new directory's name prefix, so a leaked one names the file that minted it
 * @returns the new home's path
 */
export function cloneHome({ template, prefix }: { template: string; prefix: string }): string {
  const home = mkdtempSync(join(tmpdir(), prefix));
  copyHomeInto({ into: home, template });
  return home;
}
