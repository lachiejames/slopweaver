/**
 * The effectful shell of the `typescript-pin` gate: list the tracked manifests and lockfiles, read them,
 * judge them, print.
 *
 * The judgement is pure and lives in `./typescriptPin.ts`. Two non-clean outcomes are kept apart on purpose:
 * a file that could not be listed, read or parsed is a FACT about an input the gate never judged —
 * `gateOutcome`'s `incomplete` — and printing the refusal over it would claim a rule caught something.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { repoRootOf, trackedTreeFilesOf } from "#lib/gitRepo.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import {
  FOREIGN_LOCKFILE_NAMES,
  type TrackedText,
  TYPESCRIPT_PIN,
  TYPESCRIPT_PIN_LOCKFILES,
  TYPESCRIPT_PIN_MANIFESTS,
  type TypescriptPinFinding,
  typescriptPinFindings,
} from "./typescriptPin.js";

/**
 * What the gate prints and exits with for a set of findings — clean, unjudged input, or a refusal.
 *
 * @param findings the scanner's findings over the tracked tree
 * @param version the pinned version, named in the clean line and the refusal
 * @returns the exit code and the stdout and stderr text
 */
export function typescriptPinReport({
  findings,
  version,
}: {
  findings: readonly TypescriptPinFinding[];
  version: string;
}): { exitCode: number; stdout: string; stderr: string } {
  const unseen = findings.filter(({ kind }) => kind === "invalid-input");
  const refused = findings.filter(({ kind }) => kind !== "invalid-input");
  const listed = findings.map(({ message }) => `  ${message}\n`).join("");
  const outcome = gateOutcome({ refused: refused.length, unseen: unseen.length });
  if (outcome === "clean") {
    const stdout =
      `typescript-pin: clean (${String(TYPESCRIPT_PIN_MANIFESTS.length)} TypeScript manifests, ` +
      `${String(TYPESCRIPT_PIN_LOCKFILES.length)} lockfiles; expected ${version})\n`;
    return { exitCode: 0, stderr: "", stdout };
  }
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- a tracked manifest or lockfile could not be parsed, so the pin was not judged
    return {
      exitCode: 1,
      stderr: `${listed}typescript-pin: ${String(unseen.length)} file(s) could not be parsed\n`,
      stdout: "",
    };
  }
  const refusal = lintGateRefusal({
    declaration: lintDeclarationFor({ id: "typescript-pin" }),
    detail: `${String(refused.length)} place(s) a TypeScript other than ${version} is named or resolved`,
  });
  return { exitCode: 1, stderr: `${listed}${refusal}\n`, stdout: "" };
}

/**
 * Fail when a tracked manifest or lockfile names a TypeScript other than the one pin.
 *
 * @returns 0 when the tree holds the pin, else 1
 */
export function runTypescriptPin(): number {
  let manifests: readonly TrackedText[];
  let lockfiles: readonly TrackedText[];
  let foreignLockfiles: readonly string[];
  try {
    const root = repoRootOf({ importMetaUrl: import.meta.url });
    const tracked = trackedTreeFilesOf({ root });
    const named = ({ names }: { names: readonly string[] }): readonly string[] =>
      tracked.filter((path) => names.includes(basename(path)));
    const read = ({ name }: { name: string }): readonly TrackedText[] =>
      named({ names: [name] }).map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));
    manifests = read({ name: "package.json" });
    lockfiles = read({ name: "yarn.lock" });
    foreignLockfiles = named({ names: FOREIGN_LOCKFILE_NAMES });
  } catch (error: unknown) {
    // devlint: not-a-refusal -- the tracked tree could not be listed or a file in it read, so nothing was judged
    process.stderr.write(`typescript-pin: cannot read the tracked manifests and lockfiles: ${String(error)}\n`);
    return 1;
  }
  const findings = typescriptPinFindings({
    expected: TYPESCRIPT_PIN,
    expectedLockfiles: TYPESCRIPT_PIN_LOCKFILES,
    expectedManifests: TYPESCRIPT_PIN_MANIFESTS,
    foreignLockfiles,
    lockfiles,
    manifests,
  });
  const report = typescriptPinReport({ findings, version: TYPESCRIPT_PIN });
  process.stdout.write(report.stdout);
  // devlint: not-a-refusal -- per-finding diagnostics, then the refusal typescriptPinReport rendered with lintGateRefusal
  process.stderr.write(report.stderr);
  return report.exitCode;
}
