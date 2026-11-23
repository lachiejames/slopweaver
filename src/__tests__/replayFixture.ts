/**
 * Materialising a committed REPLAY FIXTURE into a throwaway state home — the read half of
 * `slopweaver turn freeze`.
 *
 * A fixture is checked in as a template: every absolute path inside it was rewritten to
 * `${SLOPWEAVER_HOME}` at freeze time, because a committed absolute home path is a leak class the hygiene
 * gate refuses. This puts a real, temporary home back in its place and writes the tree, so the real verbs
 * can be pointed at it with `--home` and read it through the ordinary stores — no fixture-aware code
 * anywhere in `src/`.
 *
 * Lives beside `./cassetteRedact.ts` rather than under a lane directory for the same reason that one does:
 * it is test SUPPORT, imported by a lane, not a test itself.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { unwrap } from "../lib/result.js";
import {
  FIXTURE_HOME_DIR,
  FIXTURE_MANIFEST_FILE,
  type FixtureManifest,
  parseFixtureManifest,
  substituteHome,
} from "../live/turn/freeze/fixture.js";

/**
 * Where the committed fixtures live, anchored on THIS module rather than on the cwd a lane happens to run in.
 *
 * @internal
 */
export const REPLAY_FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "replay");

/**
 * Unpack one fixture into a directory, resolving every home placeholder as it goes.
 *
 * The destination is `into` rather than `home` because this function DERIVES no layout: it writes exactly
 * the relative paths the manifest lists, and those were produced by `stateHomePaths` at freeze time. What
 * the caller then does with that directory — point `--home` at it — is the caller's decision, and
 * `unit/stateHome.guard.test.ts`'s rule is about a module inventing a home sub-path of its own.
 *
 * @param slug the fixture's directory name under {@link REPLAY_FIXTURE_ROOT}
 * @param into the absolute path of the throwaway directory to unpack into — created if absent
 * @returns the fixture's manifest, already validated
 */
export function materialiseFixture({ slug, into }: { slug: string; into: string }): FixtureManifest {
  const fixtureDir = join(REPLAY_FIXTURE_ROOT, slug);
  const manifest = unwrap(
    parseFixtureManifest({ value: JSON.parse(readFileSync(join(fixtureDir, FIXTURE_MANIFEST_FILE), "utf8")) }),
  );
  for (const file of manifest.files) {
    const target = join(into, file.slice(`${FIXTURE_HOME_DIR}/`.length));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, substituteHome({ home: into, text: readFileSync(join(fixtureDir, file), "utf8") }), "utf8");
  }
  return manifest;
}
