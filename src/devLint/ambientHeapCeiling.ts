/**
 * The gate that keeps the `NODE_OPTIONS` heap workaround from coming back.
 *
 * ## The rule, and why this is a gate rather than a note
 *
 * The `NODE_OPTIONS` workaround stays permanently off, and the tree prevents it coming back: the gate throws
 * an error saying that anyone trying it has to explain to the owner the memory problem they cannot solve.
 * So the refusal's correction does not say "raise it somewhere else" — it says explain the memory problem to
 * the owner, which is the one act wanted.
 *
 * What it is keeping out is a REAL event, not a hypothetical. `jobs.lint` carried
 * `NODE_OPTIONS: --max-old-space-size=8192` for one gate, and at the runner's default the
 * `named-object-params` gate died on GC timing: builds went red AT RANDOM, none of them touching the gate.
 * The variable was added to make that stop. It did
 * — and it also measured nothing, covered every other process in the job, and hid the next one that
 * started needing headroom. Deleting it left CI passing `lint` at the default ceiling, which is the proof
 * it was never needed at job level.
 *
 * ## The criterion, stated as the shape rather than as a list of files
 *
 * **An AMBIENT heap ceiling is refused; a ceiling on the argv of the process that needs one is not.**
 * `NODE_OPTIONS` is inherited by every Node process started under it, so it cannot name which process
 * needed the headroom — that is the whole defect. `node --max-old-space-size=8192 …/tsc` in a script, and
 * `devLint.ts` spawning its gate with `--expose-gc --max-old-space-size=8192` on the CHILD's argv, declare
 * the requirement where the requirement is. Those are outside the criterion by construction, not excused by
 * an allowlist — this gate never reads an argv.
 *
 * **Every tracked file is read**, and each is read structurally, so a COMMENT about the old variable
 * (ci.yml is full of them, deliberately) can never be mistaken for the variable itself. A file kind buys a
 * PARSER, never an exemption — there is no test a file can fail its way out of the gate with:
 *
 * - every workflow under `.github/workflows/`, parsed as YAML — so its comments are gone before the check
 *   runs — and then walked WHOLE: every string in the document goes to the shell reader, and a
 *   `NODE_OPTIONS` mapping key settles its own bare value;
 * - every tracked `package.json`, root or nested, parsed as JSON and walked by that same function;
 * - every script the TypeScript parser reads, walked as an AST for the shape a `.ts` really sets a ceiling
 *   with — a property or assignment whose TARGET is named `NODE_OPTIONS` (`ambientHeapCeilingScript.ts`);
 * - EVERYTHING ELSE, whatever it is called and whatever is at the top of it, read a logical line at a time
 *   under the shell's own quoting, comment and continuation rules.
 *
 * Each of those is a SHAPE and not a path list, which is the whole point, and every review pass this
 * branch has run found a live hole where it was not one. Earlier drafts anchored on the root manifest, on
 * the two directories that happened to hold shell, on one of V8's two spellings of the flag, on `env:`
 * without `run:`, on an unquoted value, on a naive cut at the first `#`, on the interpreter a shebang
 * names, and on the set of workflow keys somebody had remembered — `defaults.run.shell` was not in it.
 *
 * The shell filter is the one that took four tries, which is why it is now GONE rather than widened again.
 * `bin/slopweaver` — the launcher every verb in this repository runs through, and the largest ambient
 * ceiling in the tree — has no extension, so a `.sh` filter read clean over the very thing this
 * gate is about; a dotted name such as `build.prod` then defeated "`.sh`, or no dot in the basename";
 * `#!/bin/ksh` defeated a shebang test that read the interpreter's name; and an `.envrc`, which `direnv`
 * sources into every shell in the checkout, has neither a `.sh` extension nor a shebang at all. Measured,
 * one holding `export NODE_OPTIONS=--max-old-space-size=128` gave a real `node` child a 320 MiB ceiling
 * against a 4,288 MiB baseline. Reading every tracked file costs 8.9s against 8.0s for the shebang-filtered
 * walk, measured with `slopweaver dev lint --only ambient-heap-ceiling`, and it ends the family rather than
 * the instance: the failure direction is now inverted, so an unrecognised file kind is SCANNED.
 *
 * The second half of that idea is that **anywhere a SHELL string can appear goes through the shell reader**,
 * never the bare matcher — and since nobody can enumerate where that is, EVERY string in a parsed document
 * goes, and a string that assigns nothing reports nothing. Reading a manifest script as a flat string missed
 * a continuation splitting the flag inside it; reading only the keys somebody remembered missed
 * `defaults.run.shell`. A `NODE_OPTIONS` mapping VALUE is the one thing that is not shell, and it is settled
 * by the key it sits under instead.
 *
 * That reader is its own module — `ambientHeapCeilingShell.ts` — because it is its own job, asked about
 * three unrelated kinds of input, and because seven of the eighteen evasions found on this branch were in
 * it rather than in the filter. This file decides WHICH parser each file goes to and what to print.
 *
 * ## The one standing ceiling is DEBT, not an exemption
 *
 * {@link STANDING_CEILING_SITES} names it and carries why it cannot go yet. The distinction that matters:
 * an exemption hides a site, so nothing tells you when it could be removed. A debt entry is reported on
 * every run, nothing may join it, and the gate fails just as loudly if the entry STOPS firing — which is
 * what makes it shrink-only rather than a place to put things.
 *
 * No exemption marker, and no allowlist: per `error-handling.md` a LINT gate is the one refusal with no
 * run-time override, and this one's whole point is that it cannot be waved through.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { parseJson } from "../lib/jsonParse.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { isScript, scriptSites } from "./ambientHeapCeilingScript.js";
import {
  AMBIENT_VAR,
  type CeilingSite,
  HEAP_FLAG,
  namesHeapFlag,
  shellSites,
  siteText,
} from "./ambientHeapCeilingShell.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * Whether one value read out of an `env:` map is an ambient heap ceiling.
 *
 * @param value the mapping's `NODE_OPTIONS` entry, of unknown type because it came from a parsed document
 * @returns true when it is a string naming the heap flag
 */
export function isCeilingValue({ value }: { value: unknown }): boolean {
  return typeof value === "string" && namesHeapFlag({ text: value });
}

/**
 * Whether one `env:` mapping declares an ambient heap ceiling.
 *
 * @param env the mapping, of unknown type because it came from a parsed document
 * @returns true when its `NODE_OPTIONS` names the heap flag
 */
export function envNamesCeiling({ env }: { env: unknown }): boolean {
  if (!isRecord(env)) {
    return false;
  }
  return isCeilingValue({ value: env[AMBIENT_VAR] });
}

/** One site inside a parsed document, before its file is known. */
type DocumentSite = { readonly where: string; readonly text: string };

/** Whether one string in a parsed document assigns a ceiling when read as shell. */
function stringSites({ text, where }: { text: string; where: string }): readonly DocumentSite[] {
  return shellSites({ content: text, file: where }).map((site) => ({ text: site.text, where }));
}

/** Every site under one mapping, with the `NODE_OPTIONS` KEY handled before its value is walked. */
function recordSites({ node, where }: { node: Record<string, unknown>; where: string }): readonly DocumentSite[] {
  return Object.entries(node).flatMap(([key, value]): readonly DocumentSite[] => {
    const here = where === "" ? key : `${where}.${key}`;
    // An `env:` value is NOT shell — `NODE_OPTIONS: --max-old-space-size=8192` is a bare mapping value, so
    // it is settled by the key it sits under rather than by the shell reader, which would see no assignment.
    if (key === AMBIENT_VAR && isCeilingValue({ value })) {
      return [{ text: siteText({ raw: `${AMBIENT_VAR}=${String(value)}` }), where: here }];
    }
    return documentSites({ node: value, where: here });
  });
}

/**
 * Every ambient heap ceiling anywhere in one parsed document, found by walking the WHOLE document rather
 * than by visiting the keys somebody remembered.
 *
 * Naming the keys is what four earlier cuts did, and each was broken by a key nobody had thought of: `env:`
 * without a step's `run:`; a manifest script read as a flat string instead of as shell; and finally
 * `defaults.run.shell`, a GitHub Actions field whose value REPLACES the command every `run:` body is
 * executed with, so `shell: env NODE_OPTIONS=--max-old-space-size=128 bash {0}` gives every step in the
 * workflow a 320 MiB ceiling — measured against a 4,288 MiB baseline, and `actionlint` passes it.
 *
 * A workflow has more shell-bearing fields than anyone can enumerate (a step's own `shell:`, a job's
 * `defaults`, a container's `options`, a composite action's steps), so the enumeration is abandoned: every
 * STRING in the document goes to the shell reader, and a string that assigns nothing reports nothing.
 *
 * @param node any node of the parsed document — a mapping, a sequence, a scalar
 * @param where the dotted path to this node, `""` at the document root
 * @returns the dotted path and assignment text of every site beneath it, in document order
 */
function documentSites({ node, where }: { node: unknown; where: string }): readonly DocumentSite[] {
  if (typeof node === "string") {
    return stringSites({ text: node, where });
  }
  if (Array.isArray(node)) {
    return node.flatMap((item, index): readonly DocumentSite[] =>
      documentSites({ node: item, where: `${where}[${String(index)}]` }),
    );
  }
  if (isRecord(node)) {
    return recordSites({ node, where });
  }
  return [];
}

/**
 * Every ambient heap ceiling in one parsed document, whichever parser produced it.
 *
 * A workflow and a manifest differ only in how their text becomes a document — YAML or JSON. What is asked
 * of the result is identical, so one walk answers both, and a shell-bearing field added to either format
 * needs no change here.
 *
 * @param document the parsed YAML or JSON document
 * @param file the repo-relative path, carried onto each site
 * @returns one site per declaration, in document order
 */
export function parsedSites({ document, file }: { document: unknown; file: string }): readonly CeilingSite[] {
  return documentSites({ node: document, where: "" }).map((site) => ({ file, text: site.text, where: site.where }));
}

/**
 * A tracked `package.json`, at the root or nested. Nested is not a hypothetical: `site/package.json` builds
 * the docs site and `scripts/docs-site.sh` invokes it, so a ceiling there would be inherited by that build
 * and read by nobody. Anchoring on the root path alone missed it, found by the r1 review pass on this
 * gate's own branch. A dependency's own manifest is never this repository's business, and the runner is fed
 * tracked paths, so the `node_modules` test is belt and braces rather than the thing doing the work.
 */
function isManifest({ path }: { path: string }): boolean {
  if (path.includes("node_modules/")) {
    return false;
  }
  return path === "package.json" || path.endsWith("/package.json");
}

/**
 * Which repo-relative paths this gate reads, and which parser each is handed to.
 *
 * **Every tracked file is read, and the shell bucket is the DEFAULT rather than a filtered set.** Three
 * buckets are recognised by name because their parsers are name-specific — a workflow is YAML under
 * `.github/workflows/`, a manifest is a `package.json`, a script is what the TypeScript parser reads — and
 * a name buys a file a different READER, never an exemption. Anything left, whatever it is called and
 * whatever is at the top of it, is walked whole as shell.
 *
 * That default is the answer to a sequence of holes, each found by a review pass on this branch with the
 * ceiling confirmed to apply at runtime, and each the same defect one level down. `.sh` alone missed
 * `bin/slopweaver`, which has no extension at all and carries the largest ambient ceiling in the tree.
 * `.sh` plus "no dot in the basename" missed a dotted name such as `build.prod`. A shebang test matching
 * the INTERPRETER's name — `sh`, `bash`, `zsh`, `dash` — missed `#!/bin/ksh`, so the interpreter's name
 * stopped being read at all. And "a `.sh` extension or any shebang" missed a tracked `.envrc`, which has
 * neither and which `direnv` sources into every shell in the checkout: measured, one holding
 * `export NODE_OPTIONS=--max-old-space-size=128` gave a real `node` child a 320 MiB ceiling against a
 * 4,288 MiB baseline while the gate read the tree clean.
 *
 * So there is no longer a test a file can fail its way out of the gate with. What a file kind buys is a
 * parser that understands it: dropping the filter with no script bucket reports SEVEN tracked `.ts` files
 * that set nothing, because a `.ts` spells the assignment inside a string literal or a JSDoc fence — a
 * refusal message naming the workaround, a test asserting on that message, a measured comment carrying its
 * own repro command. {@link scriptSites} parses those instead of reading them.
 *
 * @param files every tracked path
 * @returns the workflow, manifest, script and shell paths, each in its own bucket
 */
export function subjectsOf({ files }: { files: readonly string[] }): {
  readonly workflows: readonly string[];
  readonly manifests: readonly string[];
  readonly scripts: readonly string[];
  readonly shells: readonly string[];
} {
  const manifests = files.filter((path) => isManifest({ path }));
  const workflows = files.filter((path) => path.startsWith(".github/workflows/") && /\.ya?ml$/.test(path));
  const scripts = files.filter((path) => isScript({ path }));
  const parsed = new Set([...manifests, ...workflows, ...scripts]);
  return { manifests, scripts, shells: files.filter((path) => !parsed.has(path)), workflows };
}

/** The one failure this walk has: a manifest that is not JSON, named with the path it was read from. */
function parseFailure({ file, problem }: { file: string; problem: string }): readonly string[] {
  return [`cannot read ${file}: ${problem}`];
}

/** How each bucket below reaches one repo-relative path's contents. */
type ReadPath = ({ path }: { path: string }) => string;

/**
 * One file's text with a leading byte-order mark removed, because a BOM is DECODING and not content.
 *
 * The nineteenth hole a review pass found here was a tracked `probe.env` whose first three bytes are
 * `EF BB BF`. Measured: `dotenv.parse` of exactly those bytes answers
 * `{"NODE_OPTIONS":"--max-old-space-size=128"}` and a real `node` child spawned with it reports a 320 MiB
 * heap limit against a 4,288 MiB baseline — so the ceiling is live while every reader below saw a first
 * word of `﻿NODE_OPTIONS=…`, which is equal to nothing. Repro:
 * `printf '\xEF\xBB\xBFNODE_OPTIONS=--max-old-space-size=128\n' > /tmp/bom.env` and parse it.
 *
 * It is stripped ONCE, here, rather than in each of the four readers: every real decoder discards it, and
 * a per-reader strip is the same shape of list this gate's whole history is about. The manifest bucket
 * gains the most — `JSON.parse` throws outright on a BOM, so a BOM'd `package.json` used to stop the walk
 * with a parse failure instead of being read. bash is the one consumer that does NOT discard it, and it
 * needs no special case in either direction: it reads such a line as a COMMAND, so it sets nothing at all.
 *
 * @param text one file's decoded contents
 * @returns the same text without a leading `﻿`
 */
export function withoutBom({ text }: { text: string }): string {
  if (text.startsWith("﻿")) {
    return text.slice(1);
  }
  return text;
}

/** Every ceiling in the workflow bucket, each file parsed as YAML before it is walked. */
function workflowBucket({ files, read }: { files: readonly string[]; read: ReadPath }): readonly CeilingSite[] {
  return files.flatMap((file) => parsedSites({ document: parse(read({ path: file })), file }));
}

/** Every ceiling in the manifest bucket, or the first path whose JSON would not parse. */
function manifestBucket({ files, read }: { files: readonly string[]; read: ReadPath }): Result<readonly CeilingSite[]> {
  const sites: CeilingSite[] = [];
  for (const file of files) {
    const parsed = parseJson({ text: read({ path: file }) });
    if (parsed.isErr()) {
      return err(parseFailure({ file, problem: parsed.error.message }));
    }
    parsedSites({ document: parsed.value, file }).forEach((site) => sites.push(site));
  }
  return ok(sites);
}

/** Every ceiling in the script bucket, each file parsed by TypeScript before it is walked. */
function scriptBucket({ files, read }: { files: readonly string[]; read: ReadPath }): readonly CeilingSite[] {
  return files.flatMap((file) => scriptSites({ content: read({ path: file }), file }));
}

/** Every ceiling in the shell bucket, which is every file no other bucket claimed, walked whole. */
function shellBucket({ files, read }: { files: readonly string[]; read: ReadPath }): readonly CeilingSite[] {
  return files.flatMap((file) => shellSites({ content: read({ path: file }), file }));
}

/**
 * Every site the four readers find, or the one manifest path that could not be parsed.
 *
 * `read` is a seam rather than a call to `readFileSync`, so the whole walk — which file kind is parsed
 * which way, and in what order the sites come out — is exercised without a filesystem. Every read passes
 * through `withoutBom` on its way to a reader, so the strip is one decode step rather than four.
 *
 * @param read answers one repo-relative path's contents
 * @param subjects the four buckets `subjectsOf` computed
 * @returns every site in document order, or the parse failure that stopped the walk
 */
export function collectSites({
  read,
  subjects,
}: {
  read: ReadPath;
  subjects: ReturnType<typeof subjectsOf>;
}): Result<readonly CeilingSite[]> {
  const decoded: ReadPath = ({ path }) => withoutBom({ text: read({ path }) });
  const manifests = manifestBucket({ files: subjects.manifests, read: decoded });
  if (manifests.isErr()) {
    return err(manifests.error);
  }
  return ok([
    ...workflowBucket({ files: subjects.workflows, read: decoded }),
    ...manifests.value,
    ...scriptBucket({ files: subjects.scripts, read: decoded }),
    ...shellBucket({ files: subjects.shells, read: decoded }),
  ]);
}

/**
 * The one ambient ceiling standing in this tree, carried as DEBT rather than hidden by the filter.
 *
 * `bin/slopweaver` sizes `--max-old-space-size` from the host's RAM and exports it, and that block is the
 * workaround this gate is about. It cannot simply go: `derive` still loads the whole corpus
 * and dies at V8's own default on the owner's bronze — `docs/constraints/7-9.md` carries the measurement. `distil`,
 * `audit`, `pane` and `slice verify` hold one census entry per record instead. Its own header names what
 * retires it, which is `derive` streaming bronze rather than loading it, and that is a separate row.
 *
 * So the debt is one entry and it only ever shrinks. A ceiling anywhere else is refused, and this entry
 * failing to FIRE is equally a failure: it means the clamp went and this list is now a lie about the tree.
 *
 * **An entry names a SITE, not a file**, and that is the whole point of carrying the assignment's text.
 * Written as a filename it exempted the file: a second `export NODE_OPTIONS=--max-old-space-size=128`
 * inserted beside the real one printed "standing debt, 2 site(s)" and exited 0, while the launcher prefix
 * gave a real `node` child a 320 MiB limit against a 4,288 MiB baseline. Matching on text rather than on a
 * line number means an unrelated edit to the launcher does not redden the gate, and changing what the
 * clamp SETS does.
 */
export const STANDING_CEILING_SITES: readonly { readonly file: string; readonly text: string }[] = [
  {
    file: "bin/slopweaver",
    text: 'export NODE_OPTIONS="--max-old-space-size=$heap_mib${NODE_OPTIONS:+ $NODE_OPTIONS}"',
  },
];

/** The files the standing entries sit in, DERIVED from the rows so the two can never disagree. */
const STANDING_FILES = [...new Set(STANDING_CEILING_SITES.map((site) => site.file))].join(", ");

/** What the gate says and what it exits with, decided before anything is written anywhere. */
export interface CeilingReport {
  /** The process exit code. */
  readonly code: number;
  /** What goes to stdout, already newline-terminated, empty when there is nothing to say there. */
  readonly stdout: string;
  /** One line per site found, already newline-terminated, empty when the gate is clean. */
  readonly found: string;
  /** Whether a RULE caught something, so the runner owes a refusal rather than a bare fact. */
  readonly refuse: boolean;
}

/**
 * Render either the clean line or one line per site found.
 *
 * Rendering is separated from writing so the exact text a reader sees is assertable, which is the half
 * that carries the meaning. The refusal itself is NOT built here: `escape-hatch` requires every gate to end
 * in a `lintGateRefusal` call at the site that writes it, never a summary carried in a variable.
 *
 * @param sites every ambient ceiling found, empty when there is none
 * @param scanned how many files were read, which the clean line reports so silence is falsifiable
 * @returns what each stream gets, and the exit code that goes with them
 */
export function renderCeilingReport({
  sites,
  scanned,
}: {
  sites: readonly CeilingSite[];
  scanned: number;
}): CeilingReport {
  // A row is CONSUMED by the first site it matches, so a second copy of the declared assignment is FRESH.
  // "Nothing may join them" has to mean a duplicate too, or the count the clean line prints stops being
  // the count the list declares — and a debt list that silently grows is the shape this gate exists against.
  const unmatched = [...STANDING_CEILING_SITES];
  const standing: CeilingSite[] = [];
  const fresh: CeilingSite[] = [];
  for (const site of sites) {
    const row = unmatched.findIndex((entry) => entry.file === site.file && entry.text === site.text);
    if (row === -1) {
      fresh.push(site);
    } else {
      unmatched.splice(row, 1);
      standing.push(site);
    }
  }
  if (fresh.length > 0) {
    return {
      code: 1,
      found: fresh
        .map((site) => `  ${site.file}: ${site.where} sets ${AMBIENT_VAR} ${HEAP_FLAG} — ${site.text}\n`)
        .join(""),
      refuse: true,
      stdout: "",
    };
  }
  if (unmatched.length > 0) {
    return {
      code: 1,
      found: unmatched
        .map(
          (row) =>
            `  the standing debt entry ${row.file} no longer sets ${AMBIENT_VAR} ${HEAP_FLAG} as \`${row.text}\` — remove it from STANDING_CEILING_SITES, the list is now a lie about the tree\n`,
        )
        .join(""),
      refuse: false,
      stdout: "",
    };
  }
  return {
    code: 0,
    found: "",
    refuse: false,
    stdout:
      `ambient-heap-ceiling: clean (no new ${AMBIENT_VAR} heap ceiling in ${String(scanned)} scanned file(s))\n` +
      `ambient-heap-ceiling: standing debt, ${String(standing.length)} site(s) in ${STANDING_FILES} — nothing may join them\n`,
  };
}

/**
 * Read the repository and refuse every ambient heap ceiling in it. The effectful edge; every reader above
 * is pure.
 *
 * @returns the process exit code — 0 when none is declared anywhere
 */
export function runAmbientHeapCeiling(): number {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const subjects = subjectsOf({ files: workingTreeFilesOf({ root }) });
  const read = ({ path }: { path: string }): string => readFileSync(join(root, path), "utf8");
  const collected = collectSites({ read, subjects });
  if (collected.isErr()) {
    // devlint: not-a-refusal -- the manifest could not be parsed, so this gate never evaluated it
    process.stderr.write(`ambient-heap-ceiling: ${collected.error.join("; ")}\n`);
    return 1;
  }
  const scanned =
    subjects.workflows.length + subjects.manifests.length + subjects.scripts.length + subjects.shells.length;
  const report = renderCeilingReport({ scanned, sites: collected.value });
  process.stdout.write(report.stdout);
  // devlint: not-a-refusal -- these are the FACTS the gate found, one line per site; the refusal follows
  process.stderr.write(report.found);
  if (!report.refuse) {
    return report.code;
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "ambient-heap-ceiling" }),
      detail: `${String(collected.value.length)} ambient heap ceiling(s)`,
    })}\n`,
  );
  return report.code;
}
