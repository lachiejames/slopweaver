/**
 * The effectful shell of the `tsc-heap-contract` gate: read the manifests the pinned TypeScript version's
 * policy covers, judge them, print.
 *
 * The judgement itself is pure: `./tscOwnerContract.ts` picks the policy and the manifests, and
 * `./tscHeapContract.ts` carries the V8 criterion, the measurement that produced it and the blind spot.
 *
 * Three non-clean outcomes are kept apart on purpose, because only one of them is a REFUSAL. An unreadable
 * or malformed manifest, a pin no policy covers, and manifests holding no compiler script at all, are FACTS
 * about an input this gate never got to judge — `gateOutcome`'s `incomplete` — and printing four refusal
 * lines over one would claim a rule caught something when nothing was examined.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRootOf } from "#lib/gitRepo.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import {
  assessCompilerContract,
  COMPILER_POLICIES,
  type ManifestScripts,
  policyManifests,
} from "./tscOwnerContract.js";
import { TYPESCRIPT_PIN } from "./typescriptPin.js";

/** A manifest whose text is not JSON. */
export interface ManifestNotJsonError {
  readonly code: "MANIFEST_NOT_JSON";
  readonly message: string;
}

/** A manifest that holds something other than an object, or no `scripts` object. */
export interface ManifestNoScriptsError {
  readonly code: "MANIFEST_NO_SCRIPTS";
  readonly message: string;
}

/** A manifest with a script whose value is not a string command. */
export interface ManifestNonStringScriptError {
  readonly code: "MANIFEST_NON_STRING_SCRIPT";
  readonly message: string;
  readonly script: string;
}

/** A manifest the filesystem would not hand over. */
export interface ManifestUnreadableError {
  readonly code: "MANIFEST_UNREADABLE";
  readonly message: string;
}

/** Why a manifest's scripts map cannot be judged. */
export type ManifestScriptsError =
  ManifestNoScriptsError | ManifestNonStringScriptError | ManifestNotJsonError | ManifestUnreadableError;

/** Builds each {@link ManifestScriptsError}. */
export const ManifestScriptsErrors = {
  unreadable: ({ path, cause }: { path: string; cause: unknown }): ManifestUnreadableError => ({
    code: "MANIFEST_UNREADABLE",
    message: `cannot read ${path}: ${String(cause)}`,
  }),
  noScripts: ({ path, why }: { path: string; why: string }): ManifestNoScriptsError => ({
    code: "MANIFEST_NO_SCRIPTS",
    message: `${path} ${why}`,
  }),
  nonStringScript: ({ path, script }: { path: string; script: string }): ManifestNonStringScriptError => ({
    code: "MANIFEST_NON_STRING_SCRIPT",
    message: `${path}'s script \`${script}\` is not a string command`,
    script,
  }),
  notJson: ({ path, cause }: { path: string; cause: unknown }): ManifestNotJsonError => ({
    code: "MANIFEST_NOT_JSON",
    message: `${path} is not readable JSON: ${String(cause)}`,
  }),
} as const;

/**
 * Read a manifest's `scripts` map out of its text, refusing to drop a value it cannot use.
 *
 * A non-string script value is not filtered away: a map holding one is a file this gate cannot judge, and
 * silently skipping the entry is how a gate reports clean over an input it never read.
 *
 * @param path the manifest, repo-relative, which every error names
 * @param text the file's whole contents
 * @returns the scripts map, or why it could not be read
 */
export function readScripts({
  path,
  text,
}: {
  path: string;
  text: string;
}): Result<Readonly<Record<string, string>>, ManifestScriptsError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return err(ManifestScriptsErrors.notJson({ cause: error, path }));
  }
  if (!isRecord(parsed)) {
    return err(ManifestScriptsErrors.noScripts({ path, why: "does not hold an object" }));
  }
  const scripts = parsed["scripts"];
  if (!isRecord(scripts)) {
    return err(ManifestScriptsErrors.noScripts({ path, why: "declares no `scripts` object" }));
  }
  const entries = Object.entries(scripts);
  const [first] = entries.filter(([, value]) => typeof value !== "string").map(([key]) => key);
  if (first !== undefined) {
    return err(ManifestScriptsErrors.nonStringScript({ path, script: first }));
  }
  return ok(Object.fromEntries(entries.map(([key, value]) => [key, String(value)])));
}

/**
 * Read every manifest one policy covers.
 *
 * @param root the repository root
 * @param paths the manifests, repo-relative
 * @returns each manifest's scripts, or the first line saying why one could not be read
 */
function readManifests({
  root,
  paths,
}: {
  root: string;
  paths: readonly string[];
}): Result<ManifestScripts[], ManifestScriptsError> {
  const read: ManifestScripts[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch (error: unknown) {
      return err(ManifestScriptsErrors.unreadable({ cause: error, path }));
    }
    const scripts = readScripts({ path, text });
    if (scripts.isErr()) {
      return err(scripts.error);
    }
    read.push({ path, scripts: scripts.value });
  }
  return ok(read);
}

/**
 * Fail when a package script runs the TypeScript compiler without the bound the pinned version's policy asks.
 *
 * @returns 0 when every compiler script declares one, else 1
 */
export function runTscHeapContract(): number {
  const policy = COMPILER_POLICIES.get(TYPESCRIPT_PIN);
  if (policy === undefined) {
    // devlint: not-a-refusal -- the pinned version has no policy, so no script was judged at all
    process.stderr.write(`tsc-heap-contract: TypeScript ${TYPESCRIPT_PIN} has no compiler policy to judge by\n`);
    return 1;
  }
  const paths = policyManifests({ policy });
  const manifests = readManifests({ paths, root: repoRootOf({ importMetaUrl: import.meta.url }) });
  if (manifests.isErr()) {
    // devlint: not-a-refusal -- a manifest could not be read or parsed into scripts, so nothing was judged
    process.stderr.write(`tsc-heap-contract: ${manifests.error.message}\n`);
    return 1;
  }
  const { compilerScripts, findings } = assessCompilerContract({ manifests: manifests.value, policy });
  const outcome = gateOutcome({ refused: findings.length, unseen: compilerScripts.length === 0 ? 1 : 0 });
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- no script names the compiler, so this gate examined nothing rather than
    // finding nothing wrong; a clean line here would claim a check that never ran
    process.stderr.write(`tsc-heap-contract: no script in ${paths.join(", ")} names the TypeScript compiler\n`);
    return 1;
  }
  if (outcome === "clean") {
    const named = compilerScripts.join(", ");
    process.stdout.write(
      `tsc-heap-contract: clean (${policy} policy for TypeScript ${TYPESCRIPT_PIN}; ${String(compilerScripts.length)} compiler script(s) bounded: ${named})\n`,
    );
    return 0;
  }
  for (const finding of findings) {
    process.stderr.write(`  ${finding.line}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "tsc-heap-contract" }),
      detail: `${String(findings.length)} compiler script(s) without the ${policy} bound`,
    })}\n`,
  );
  return 1;
}
