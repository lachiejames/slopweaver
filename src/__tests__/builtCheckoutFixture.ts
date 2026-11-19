/**
 * A throwaway checkout whose `dist-cli` manifest is stamped from its one tracked source file, as `dev build` leaves
 * it — shared by the unit read of a serving checkout and the subprocess run of the dev console's start check.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanSourceStamps } from "../builtCli/sourceScan.js";
import { BUILD_MANIFEST_FILE } from "../builtCli/staleness.js";
import { gitInTemp } from "./tempGitRepo.js";

/**
 * Build the checkout under the temp root; the caller removes it.
 *
 * @param prefix the temp directory's name prefix
 * @returns the checkout's root, whose `src/a.ts` is 20 bytes at build time
 */
export function builtCheckoutFixture({ prefix }: { prefix: string }): string {
  const at = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(at, "src"), { recursive: true });
  writeFileSync(join(at, "src/a.ts"), "export const a = 1;\n");
  gitInTemp({ args: ["init", "-q"], cwd: at });
  gitInTemp({ args: ["add", "-A"], cwd: at });
  mkdirSync(join(at, "dist-cli"));
  writeFileSync(
    join(at, "dist-cli", BUILD_MANIFEST_FILE),
    JSON.stringify({ builtAtIso: new Date(0).toISOString(), root: at, stamps: scanSourceStamps({ root: at }) }),
  );
  return at;
}
