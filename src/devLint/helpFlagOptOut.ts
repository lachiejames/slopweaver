/**
 * The gate that stops a verb hiding an accepted flag behind a free-text exemption.
 *
 * ## The hole this closes, exactly
 *
 * `src/__tests__/unit/cli/helpTruth.test.ts` is the whole-CLI ratchet that compares what a verb ADVERTISES
 * in `meta.usage` against what its parser ACCEPTS, in both directions and through the real parser. It works.
 * What it could not check was its own escape hatch: a verb absent from its `GUARDED` map may be named in
 * `UNGUARDED` with a PROSE reason, and nothing ever read that reason.
 *
 * Measured: `slack edit` sat in `UNGUARDED` with the reason "hand-rolled parser; no exported
 * flag spec yet" while its parser was `parseFlagTail({ rest, spec: EDIT_FLAGS })` — a declarative literal
 * naming nine flags. Its help advertised four. So `--as me` and `--body`, the two flags that let the owner
 * edit a Slack message under the owner's own name, were real, shipped, and invisible: a session read that
 * help twice, concluded no as-me edit path existed, and started building one. The rule: `--help` is
 * mechanically enforced to align with every command and option, making this kind of drift impossible.
 *
 * The reason was not merely stale for that one verb. Measured across the whole `UNGUARDED` list on the same
 * commit, 43 of 50 entries claimed "no exported flag spec yet" while their parser DID read a declarative
 * spec. A prose reason nobody checks is a comment, and this repository already knows what comments are
 * worth against a gate.
 *
 * ## What it proves, and what it does not
 *
 * ONE thing: a verb may not opt out of the help/flag ratchet when its flag set is mechanically readable.
 * It does not compare flags to help — `helpTruth` does that, better, through the real parser — and it does
 * not prove a verb it passes is correct. It removes the way OUT of the check that does.
 *
 * The readability test is deliberately coarse: a verb is readable when the loader module the manifest names,
 * or any module reachable from it by relative RUN-TIME import inside `src/cli/commands/`, calls `parseFlagTail`,
 * `parseFlags` or `tokenizeFlags` with an options object. A whole-statement `import type`/`export type` edge is
 * not followed — erased at compile time, it can carry no parser, and `dev lint` was once reported readable
 * through a chain of types alone — while a mixed `import { type X, y }` still is. That over-reports rather
 * than under-reports, and
 * that is the safe direction: the remedy for a hit is always "guard the verb", which is never wrong. The
 * direction it CANNOT see is a genuinely hand-rolled parser — nothing can enumerate what one accepts — which
 * is why `helpTruth`'s own residual note stands unchanged.
 *
 * ## Why a baseline rather than a hot failure
 *
 * 43 offenders on the day this landed. Guarding one verb means exporting its flag names, making its usage
 * truthful, and stating a valid invocation for every flag it accepts — real work per verb, and 43 of them in
 * one change would be the mechanical rewrite this repo has already been burned by. So the shape is
 * `file-size-ratchet`'s: {@link BASELINE_FILE} names today's offenders, a NEW one fails immediately on any
 * noun, and an entry that stops offending must be PRUNED rather than left to rot. The list only shrinks.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { appendAll } from "../lib/arrays.js";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { BASELINE_FILE, HELP_TRUTH_TEST, optOutsIn, parseBaselineJson } from "./helpFlagOptOutInputs.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";

/** Shrink the committed list to the verbs still offending. Never widens it — see {@link prune}. */
const PRUNE_FLAG = "--prune";

/** Where the noun manifests live — one file per noun, the filename being the noun. */
const MANIFEST_DIR = "src/cli/manifests";

/** The tree a loader module must sit in for its imports to be followed. */
const COMMANDS_TREE = "src/cli/commands/";

/**
 * A parser call whose flag set is a declarative spec rather than a hand-rolled `indexOf('--x')` loop.
 *
 * Matched by NAME plus an opening options object, because the three helpers are the only way a spec reaches
 * a parse in this repo and any of them makes the flag names readable in the source.
 */
const SPEC_PARSE_CALL = /\b(?:parseFlagTail|parseFlags|tokenizeFlags)\s*\(\s*\{/;

/** A relative ESM import specifier, as written — `.js` on disk being `.ts`. */
const RELATIVE_IMPORT = /from\s+"(\.[^"]+)\.js"/g;

/**
 * A WHOLE-STATEMENT type-only import or re-export — `import type … from "…"`, `export type … from "…"`. The
 * compiler erases it, so it can carry no parser call, and following it reported a verb readable through a chain
 * of types alone. A mixed `import { type X, y }` does not start `import type`, so it is still followed.
 */
const TYPE_ONLY_IMPORT = /^[ \t]*(?:import|export)\s+type\s[^;]*?\sfrom\s+"[^"]+"/gm;

/**
 * Where one `lazy({ … })` entry's body ends: where the next entry starts. The manifest's last entry has no
 * next one, so its body runs to the end of the manifest.
 */
function entryBodyEnd({ next, source }: { next: RegExpExecArray | undefined; source: string }): number {
  if (next === undefined) {
    return source.length;
  }
  return next.index;
}

/**
 * Every verb address a noun manifest publishes, mapped to the module its `load` imports. Pure.
 *
 * Each `lazy({ … })` entry's body runs to the next one rather than a fixed window, because a manifest
 * (`cloudflare`) carries a comment long enough that a bounded match silently dropped the verb — and a
 * dropped verb is an opt-out this gate would never look at.
 *
 * @param noun the noun, taken from the manifest's own filename
 * @param source the manifest file's text
 * @returns address → repo-relative loader module path
 */
export function loaderModulesIn({ noun, source }: { noun: string; source: string }): ReadonlyMap<string, string> {
  const named = new Map<string, string>();
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*\(\)\s*=>\s*import\("\.\.\/(commands\/[^"]+)\.js"\)/g)) {
    named.set(match[1]!, `src/cli/${match[2]!}.ts`);
  }
  const starts = [...source.matchAll(/(?:"([^"\n]+)"|\[DEFAULT_VERB\]|([A-Za-z][\w-]*)):\s*lazy\(\{/g)];
  const modules = new Map<string, string>();
  for (const [index, start] of starts.entries()) {
    const body = source.slice(start.index, entryBodyEnd({ next: starts[index + 1], source }));
    const inline = body.match(/import\("\.\.\/(commands\/[^"]+)\.js"\)/);
    const referenced = body.match(/load:\s*(\w+)\s*,/)?.[1];
    let module: string | undefined;
    if (inline) {
      module = `src/cli/${inline[1]!}.ts`;
    } else if (referenced === undefined) {
      module = undefined;
    } else {
      module = named.get(referenced);
    }
    const verb = start[1] ?? start[2];
    if (module !== undefined) {
      modules.set(verb === undefined ? noun : `${noun} ${verb}`, module);
    }
  }
  return modules;
}

/**
 * The repo-relative `.ts` paths a module imports relatively at RUN TIME, kept to the commands tree: a
 * whole-statement type-only import or re-export is skipped ({@link TYPE_ONLY_IMPORT}). Pure.
 *
 * @param path the importing module's repo-relative path
 * @param content its text
 * @returns each imported module inside `src/cli/commands/`
 */
export function localImportsOf({ path, content }: { path: string; content: string }): readonly string[] {
  return [...content.replace(TYPE_ONLY_IMPORT, "").matchAll(RELATIVE_IMPORT)]
    .map((match) => relative(".", resolve(dirname(path), `${match[1]!}.ts`)))
    .filter((imported) => imported.startsWith(COMMANDS_TREE));
}

/**
 * Whether a module's text parses flags from a declarative spec. Pure.
 *
 * @param content the module's text
 * @returns true when a spec-driven parse call appears
 */
export function parsesWithFlagSpec({ content }: { content: string }): boolean {
  return SPEC_PARSE_CALL.test(content);
}

/**
 * Every module reachable from a loader by relative import inside the commands tree, the loader included.
 *
 * IO edge: reads each module. A module that cannot be read stops that branch of the walk and is reported by
 * the caller rather than silently treated as spec-free.
 *
 * @param entry the loader module's repo-relative path
 * @param readText reads a repo-relative path, throwing when it cannot
 * @returns the reachable paths, and the ones that could not be read
 */
export function reachableModules({
  entry,
  readText,
}: {
  entry: string;
  readText: (args: { path: string }) => string;
}): { readonly paths: readonly string[]; readonly unreadable: readonly string[] } {
  const seen = new Set<string>();
  const unreadable: string[] = [];
  const stack = [entry];
  while (stack.length > 0) {
    const path = stack.pop()!;
    if (seen.has(path) || !path.startsWith(COMMANDS_TREE)) {
      continue;
    }
    seen.add(path);
    try {
      for (const imported of localImportsOf({ content: readText({ path }), path })) {
        stack.push(imported);
      }
    } catch {
      unreadable.push(path);
    }
  }
  return { paths: [...seen].toSorted(), unreadable: unreadable.toSorted() };
}

/**
 * An opt-out whose parser turned out to be readable after all.
 *
 * @internal
 */
export interface FalseOptOut {
  readonly address: string;
  readonly reason: string;
  /** The module whose spec-driven parse call proves the flag set is readable. */
  readonly evidence: string;
}

/**
 * How the current offender set compares to the committed one. Pure.
 *
 * @param offenders every address that opts out while its flag set is readable
 * @param baseline the committed offender addresses
 * @returns the offenders absent from the baseline, and the baseline entries no longer offending
 */
export function ratchetOf({
  offenders,
  baseline,
}: {
  offenders: readonly FalseOptOut[];
  baseline: readonly string[];
}): { readonly unbaselined: readonly FalseOptOut[]; readonly stale: readonly string[] } {
  const committed = new Set(baseline);
  const live = new Set(offenders.map((offender) => offender.address));
  return {
    stale: baseline.filter((address) => !live.has(address)).toSorted(),
    unbaselined: offenders.filter((offender) => !committed.has(offender.address)),
  };
}

/**
 * The NOUN a manifest file publishes under, which is not always its own filename.
 *
 * A noun's manifest is split when it outgrows the file-size ratchet, and the convention the repository
 * already uses is a sibling named `<noun><Whatever>.ts` whose export the noun's own file spreads —
 * `atlasSlack.ts` and `atlasEstate.ts` both feed `atlas.ts`. Deriving the noun from the filename
 * alone published those rows under `atlasSlack …` and `atlasEstate …`, addresses no reader or
 * test ever names, so the gate simply did not check them.
 *
 * That went unnoticed because the three Slack rows are GUARDED, and a guarded verb reaches this gate through
 * its flag names rather than through its address. The next split landed an UNGUARDED row and the miss
 * surfaced immediately, as a verb the gate reported nothing publishes.
 *
 * The rule is the convention itself: the longest filename PREFIX that is also a manifest file here is the
 * noun. `atlasEstate` resolves to `atlas`; `slack` has no shorter prefix and stays `slack`.
 *
 * @param file the manifest's filename, without its extension
 * @param manifestFiles every manifest filename in the directory, without extensions
 * @returns the noun its addresses belong under
 */
export function nounForManifestFile({
  file,
  manifestFiles,
}: {
  file: string;
  manifestFiles: readonly string[];
}): string {
  const prefixes = manifestFiles.filter((candidate) => candidate !== file && file.startsWith(candidate));
  const longest = prefixes.toSorted((left, right) => right.length - left.length)[0];
  // No other manifest's name prefixes this one, so it is no split sibling: it publishes under its own name.
  if (longest === undefined) {
    return file;
  }
  return longest;
}

/** Every noun manifest's address → loader module map, folded into one. IO edge. */
function loaderModules({ root, listing }: { root: string; listing: readonly string[] }): ReadonlyMap<string, string> {
  const modules = new Map<string, string>();
  const manifestPaths = listing.filter(
    (path) => path.startsWith(`${MANIFEST_DIR}/`) && path.endsWith(".ts") && !path.endsWith("/index.ts"),
  );
  const manifestFiles = manifestPaths.map((path) => path.slice(`${MANIFEST_DIR}/`.length, -".ts".length));
  for (const path of manifestPaths) {
    const file = path.slice(`${MANIFEST_DIR}/`.length, -".ts".length);
    const noun = nounForManifestFile({ file, manifestFiles });
    for (const [address, module] of loaderModulesIn({ noun, source: readFileSync(join(root, path), "utf8") })) {
      modules.set(address, module);
    }
  }
  return modules;
}

/** The evidence module for one opt-out, or `undefined` when nothing in its closure reads a spec. IO edge. */
function evidenceFor({
  entry,
  root,
  unreadable,
}: {
  entry: string;
  root: string;
  unreadable: string[];
}): string | undefined {
  const readText = ({ path }: { path: string }): string => readFileSync(join(root, path), "utf8");
  const walk = reachableModules({ entry, readText });
  appendAll({ from: walk.unreadable, into: unreadable });
  return walk.paths.find((path) => {
    try {
      return parsesWithFlagSpec({ content: readText({ path }) });
    } catch {
      unreadable.push(path);
      return false;
    }
  });
}

/**
 * `--prune` — drop the baseline entries that have stopped offending, and NOTHING else.
 *
 * Deliberately not `file-size-ratchet`'s `--rebaseline`, which may widen a baseline with a brand-new
 * offender. Widening is the entire failure this gate exists to prevent: an agent that can add its verb to
 * the exemption list with one command has the free-text opt-out back, spelled differently. So this mode can
 * only remove, and a new offender is refused here exactly as it is in the compare path.
 */
function prune({
  baselinePath,
  offenders,
  ratchet,
  unreadable,
  unresolved,
}: {
  baselinePath: string;
  offenders: readonly FalseOptOut[];
  ratchet: { readonly unbaselined: readonly FalseOptOut[]; readonly stale: readonly string[] };
  unreadable: readonly string[];
  unresolved: readonly string[];
}): number {
  if (unreadable.length > 0 || unresolved.length > 0) {
    // devlint: not-a-refusal -- a prune REMOVES entries, and neither state below leaves a basis to remove
    // one: an entry whose evidence module went unread looks stale though nobody opened the file, and an
    // address the register names that no manifest publishes has to be settled before anything is deleted
    process.stderr.write(
      `help-flag-opt-out: refusing to prune — ${String(unreadable.length)} source(s) went unread, and ` +
        `${String(unresolved.length)} registered address(es) are published by no manifest. Either makes an ` +
        `entry read as stale, and a prune would delete it.\n`,
    );
    for (const line of [...unreadable, ...unresolved]) {
      // devlint: not-a-refusal -- the paths themselves, so the operator knows what to restore
      process.stderr.write(`  ${line}\n`);
    }
    return 1;
  }
  if (ratchet.unbaselined.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "help-flag-opt-out-prune" }),
        detail: `${String(ratchet.unbaselined.length)} verb(s) are new offenders`,
      })}\n`,
    );
    for (const offender of ratchet.unbaselined) {
      process.stderr.write(`  ${offender.address}  (${offender.evidence})\n`);
    }
    return 1;
  }
  const remaining = offenders.map((offender) => offender.address).toSorted();
  writeFileSync(baselinePath, `${JSON.stringify({ offenders: remaining }, null, 2)}\n`);
  process.stdout.write(
    `help-flag-opt-out: pruned ${String(ratchet.stale.length)} entr(y/ies); ` +
      `${String(remaining.length)} false opt-out(s) remain\n`,
  );
  return 0;
}

/** Print the outcome and return the exit code. */
function report({
  offenders,
  ratchet,
  unresolved,
  unreadable,
}: {
  offenders: readonly FalseOptOut[];
  ratchet: { readonly unbaselined: readonly FalseOptOut[]; readonly stale: readonly string[] };
  unresolved: readonly string[];
  unreadable: readonly string[];
}): number {
  for (const offender of ratchet.unbaselined) {
    process.stderr.write(
      `  ${offender.address}  opts out as "${offender.reason}" — but ${offender.evidence} parses from a spec\n`,
    );
  }
  for (const address of ratchet.stale) {
    process.stderr.write(`  ${address}  is baselined as a false opt-out but no longer is — prune it\n`);
  }
  for (const address of unresolved) {
    // NOT "unchecked": `loaderModules` reads every manifest with an UNCAUGHT `readFileSync`, so an
    // unreadable manifest throws rather than quietly leaving addresses unresolved. An address that survives
    // to here is one the register names and no manifest publishes — the register disagreeing with the tree,
    // which is a POLICY finding somebody must fix on one side or the other, exactly like a stale entry.
    process.stderr.write(
      `  ${address}  named in UNGUARDED but no manifest publishes it — the register names a verb that is not there\n`,
    );
  }
  for (const path of [...new Set(unreadable)].toSorted()) {
    process.stderr.write(`  ${path}  (unreadable — not checked)\n`);
  }
  const refused = ratchet.unbaselined.length + ratchet.stale.length + unresolved.length;
  const outcome = gateOutcome({ refused, unseen: unreadable.length });
  if (outcome === "clean") {
    process.stdout.write(
      `help-flag-opt-out: clean (${String(offenders.length)} baselined false opt-out(s) remaining)\n`,
    );
    return 0;
  }
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- a source that could not be read was not checked, so this reports
    // the gap rather than a policy verdict over it
    process.stderr.write(
      `help-flag-opt-out: ${String(unreadable.length)} source(s) could not be read, so this scan is incomplete, not clean.\n`,
    );
    return 1;
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "help-flag-opt-out" }),
      detail: `${String(refused)} unguarded, stale or unresolved opt-out(s)`,
    })}
`,
  );
  return 1;
}

/**
 * IO edge: audit every opt-out in `helpTruth`'s register against the committed baseline.
 *
 * @returns 0 when the ratchet holds, 1 on a new offender, a stale baseline entry, or a scan that could not
 *   be completed
 */
export function runHelpFlagOptOut(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    listing = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("help-flag-opt-out: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const optOuts = optOutsIn({ source: readFileSync(join(root, HELP_TRUTH_TEST), "utf8") });
  if (optOuts.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    process.stderr.write(`help-flag-opt-out: ${optOuts.error.message}\n`);
    return 1;
  }
  const baseline = parseBaselineJson({ text: readFileSync(join(root, BASELINE_FILE), "utf8") });
  if (baseline.isErr()) {
    // devlint: not-a-refusal -- an input could not be read or parsed, so the gate reports the failure rather than a verdict
    process.stderr.write(`help-flag-opt-out: ${baseline.error.message}\n`);
    return 1;
  }
  const modules = loaderModules({ root, listing });
  const unreadable: string[] = [];
  const unresolved: string[] = [];
  const offenders: FalseOptOut[] = [];
  for (const optOut of optOuts.value) {
    const entry = modules.get(optOut.address);
    if (entry === undefined) {
      unresolved.push(optOut.address);
      continue;
    }
    const evidence = evidenceFor({ entry, root, unreadable });
    if (evidence !== undefined) {
      offenders.push({ address: optOut.address, evidence, reason: optOut.reason });
    }
  }
  const ratchet = ratchetOf({ baseline: baseline.value, offenders });
  if (process.argv.includes(PRUNE_FLAG)) {
    return prune({ baselinePath: join(root, BASELINE_FILE), offenders, ratchet, unreadable, unresolved });
  }
  return report({ offenders, ratchet, unreadable, unresolved });
}
