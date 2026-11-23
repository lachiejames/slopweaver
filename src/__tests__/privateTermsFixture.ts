/**
 * Seed a throwaway home's private-terms file (`../hygiene/privateTerms.ts`). The file is fail-closed, so a test whose
 * subject is a guarded write's SUCCESS path declares it — header only for "none", or synthetic rows — and a test of
 * the refusal leaves it absent. Never seeded globally: global seeding would hide a caller that forgot to load it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateTermsRefusal } from "../hygiene/privateTerms.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

/** The exact header line. */
const HEADER = "class\tflags\tpattern\tsource";

/**
 * Write the private-terms file under a home, mode 0600.
 *
 * @param home the throwaway state home
 * @param rows whole rows, each `class<TAB>flags<TAB>pattern<TAB>source`; none declares the explicit "none"
 * @returns the file's path
 */
export function writePrivateTerms({ home, rows = [] }: { home: string; rows?: readonly string[] }): string {
  const path = stateHomePaths({ home }).privateTerms;
  writeFileAtomic({ contents: [HEADER, ...rows, ""].join("\n"), exactMode: true, fileMode: 0o600, path });
  return path;
}

/**
 * The refusal every guarded write prints for a home holding no private-terms file at all — the fail-closed case.
 *
 * @param home the throwaway state home that was never seeded
 * @returns the loader's sentence for an absent file at that home's path
 */
export function absentPrivateTermsRefusal({ home }: { home: string }): string {
  return privateTermsRefusal({ load: { kind: "absent", path: stateHomePaths({ home }).privateTerms } });
}

/**
 * A fresh throwaway home whose private-terms file declares none: the home a guarded write's success path runs in.
 *
 * @param prefix the temp directory's name prefix, naming the test that made it
 * @returns the home's path; the caller removes it as it would any other `mkdtempSync` home
 */
export function homeDeclaringNoPrivateTerms({ prefix }: { prefix: string }): string {
  const home = mkdtempSync(join(tmpdir(), prefix));
  writePrivateTerms({ home });
  return home;
}
