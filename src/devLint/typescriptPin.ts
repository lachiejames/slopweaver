/**
 * The TypeScript pin invariant — one compiler version, named once, resolved everywhere.
 *
 * The owner's ruling for the TypeScript 7.1 move is "pinned exactly, no TS6 anywhere and no dual toolchain".
 * This is the mechanical half of that sentence: every tracked manifest that names `typescript` pins exactly
 * {@link TYPESCRIPT_PIN}, and every tracked lockfile resolves `typescript` to exactly that version and nothing
 * else. It also refuses the shapes a dual toolchain arrives in other than as a second direct pin — the
 * `@typescript/typescript6` compatibility package, an `npm:` alias under another name, a range, and a lock
 * entry resolving an older compiler for some transitive dependant.
 *
 * **A lockfile is judged by its `resolution` fields alone** — what was installed. A descriptor key or a peer
 * range says what somebody ASKED for: `site/yarn.lock` carries a Twoslash peer range naming TypeScript 5 and
 * 6 that installs nothing, and reading it would fail the 7.1 policy over a package that never arrives.
 *
 * **The subject set is part of the rule.** A scan that objects to nothing because it found nothing is the
 * false proof this repository's gates refuse, so the TypeScript-bearing manifests and the lockfiles must be
 * EXACTLY the declared paths: a missing one and a fourth one are both findings.
 *
 * Pure: the caller supplies each subject's text (`typescriptPinRun.ts` reads the tracked tree), and
 * `typescriptPin.test.ts` drives it on inline fixtures.
 */

import { parse as parseYaml } from "yaml";

import { isRecord } from "#lib/parsers.js";

/** The one TypeScript version every manifest pins and every lockfile resolves. */
export const TYPESCRIPT_PIN = "7.1.0-beta";

/** The tracked manifests that name TypeScript — exactly these, sorted. */
export const TYPESCRIPT_PIN_MANIFESTS: readonly string[] = [
  "desktop/package.json",
  "package.json",
  "site/package.json",
];

/** The tracked lockfiles — exactly these, sorted. */
export const TYPESCRIPT_PIN_LOCKFILES: readonly string[] = ["desktop/yarn.lock", "site/yarn.lock", "yarn.lock"];

/** The compatibility package a dual toolchain installs beside the native compiler. */
const TYPESCRIPT6_PACKAGE = "@typescript/typescript6";

/**
 * The manifest fields that can make Yarn install a compiler. `peerDependencies` is deliberately absent: a peer
 * range installs nothing, so `typescript: "^5.5 || ^6"` there is a compatibility claim, never a second toolchain.
 */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "resolutions"] as const;

/** Yarn's own builtin compatibility patch for `typescript`, applied by Yarn to whatever version is pinned. */
const BUILTIN_COMPAT_PATCH = "optional!builtin<compat/typescript>";

/** One tracked file's repo-relative path and text. */
export interface TrackedText {
  readonly path: string;
  readonly text: string;
}

/** One way the tree breaks the pin. `invalid-input` is a file the gate could not judge, never a refusal. */
export interface TypescriptPinFinding {
  readonly kind:
    | "invalid-input"
    | "direct-pin-mismatch"
    | "forbidden-typescript6-package"
    | "forbidden-typescript-alias"
    | "lock-resolution-mismatch"
    | "manifest-set-mismatch"
    | "lockfile-set-mismatch"
    | "foreign-lockfile"
    | "vendored-typescript";
  readonly path: string;
  readonly message: string;
}

/**
 * Every other package manager's lockfile, by file name. This tree resolves only through `yarn.lock`, so any of
 * these tracked is a second resolver the scan never parses (a `package-lock.json`
 * resolving 5.9.3 would leave the gate clean), and it is refused by its presence rather than its content.
 */
export const FOREIGN_LOCKFILE_NAMES: readonly string[] = [
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
];

/**
 * Every way a set of manifests and lockfiles breaks the TypeScript pin, sorted by path then message.
 *
 * @param manifests every tracked `package.json`, whether or not it names TypeScript
 * @param lockfiles every tracked `yarn.lock`
 * @param foreignLockfiles the path of every tracked file named in {@link FOREIGN_LOCKFILE_NAMES}
 * @param expected the exact version every pin and resolution must equal
 * @param expectedManifests the exact sorted set of manifests that may name TypeScript
 * @param expectedLockfiles the exact sorted set of lockfiles that must be supplied
 * @returns each finding, empty when the tree holds the pin
 */
export function typescriptPinFindings({
  manifests,
  lockfiles,
  foreignLockfiles,
  expected,
  expectedManifests,
  expectedLockfiles,
}: {
  manifests: readonly TrackedText[];
  lockfiles: readonly TrackedText[];
  foreignLockfiles: readonly string[];
  expected: string;
  expectedManifests: readonly string[];
  expectedLockfiles: readonly string[];
}): readonly TypescriptPinFinding[] {
  const findings: TypescriptPinFinding[] = foreignLockfiles.map((path) => ({
    kind: "foreign-lockfile",
    message: `${path}: another package manager's lockfile, a second resolver this scan never reads — only yarn.lock resolves here`,
    path,
  }));
  const bearing: string[] = [];
  for (const manifest of manifests) {
    const read = manifestFindings({ expected, manifest });
    findings.push(...read.findings);
    if (read.namesTypescript) {
      bearing.push(manifest.path);
    }
  }
  for (const lockfile of lockfiles) {
    findings.push(...lockfileFindings({ expected, lockfile }));
  }
  findings.push(
    ...setFindings({ actual: bearing, expected: expectedManifests, kind: "manifest-set-mismatch" }),
    ...setFindings({
      actual: lockfiles.map(({ path }) => path),
      expected: expectedLockfiles,
      kind: "lockfile-set-mismatch",
    }),
  );
  return findings.toSorted((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
}

/**
 * One manifest's findings, and whether it carries any TypeScript identity — a `typescript` or
 * `@typescript/typescript6` key, or an `npm:` alias to either.
 *
 * @param manifest the `package.json` subject
 * @param expected the exact version a direct pin must equal
 * @returns the findings and whether the manifest names TypeScript
 */
function manifestFindings({ manifest, expected }: { manifest: TrackedText; expected: string }): {
  findings: readonly TypescriptPinFinding[];
  namesTypescript: boolean;
} {
  const { path } = manifest;
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest.text);
  } catch {
    return { findings: [{ kind: "invalid-input", message: `${path}: not valid JSON`, path }], namesTypescript: false };
  }
  if (!isRecord(parsed)) {
    const message = `${path}: a manifest must be a JSON object`;
    return { findings: [{ kind: "invalid-input", message, path }], namesTypescript: false };
  }
  // A tracked copy of the compiler, reached by a `portal:` or `file:` alias whose specifier
  // names no package, installed 5.9.3 beside the pin. The copy's own manifest is what names it.
  const vendored: Judgement[] = [];
  const ownName = parsed["name"];
  if (ownName === "typescript" || ownName === TYPESCRIPT6_PACKAGE) {
    const message = `${path} is package "${ownName}": a tracked copy of a compiler, installable beside the pin`;
    vendored.push({ finding: { kind: "vendored-typescript", message, path }, namesTypescript: false });
  }
  const declared = declaredDependencies({ manifest: parsed }).map(({ field, key, name, specifier }): Judgement => {
    const location = `${path} ${field}.${key}`;
    if (name === undefined) {
      const message = `${location}: a resolutions selector this gate cannot read, so it cannot say what it resolves`;
      return { finding: { kind: "invalid-input", message, path }, namesTypescript: false };
    }
    return dependencyFinding({ expected, location, name, path, specifier });
  });
  const judged = [...vendored, ...declared];
  const findings = judged.flatMap(({ finding }) => (finding === undefined ? [] : [finding]));
  const namesTypescript = judged.some((judgement) => judgement.namesTypescript);
  return { findings, namesTypescript };
}

/**
 * Every string-valued dependency a manifest declares, across the fields a dependency can live in. A
 * `resolutions` key is a selector, so its package is the one {@link resolutionTarget} reads out of it.
 *
 * @param manifest the parsed `package.json` object
 * @returns each declaration's field, key, package name (undefined for an unreadable selector) and specifier
 */
function declaredDependencies({
  manifest,
}: {
  manifest: Record<string, unknown>;
}): readonly { field: string; key: string; name: string | undefined; specifier: string }[] {
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const block = manifest[field];
    if (!isRecord(block)) {
      return [];
    }
    return Object.entries(block).flatMap(([key, specifier]) => {
      if (typeof specifier !== "string") {
        return [];
      }
      const name = field === "resolutions" ? resolutionTarget({ selector: key }) : key;
      return [{ field, key, name, specifier }];
    });
  });
}

/**
 * Yarn's resolution selector: an optional parent descriptor and a slash, then the target descriptor, each a
 * possibly scoped name with an optional `@range`. The parent's range holds no slash; the target's may.
 */
const RESOLUTION_SELECTOR = /^(?:(?:@[^/@]+\/)?[^/@]+(?:@[^/]*)?\/)?((?:@[^/@]+\/)?[^/@]+)(?:@.*)?$/;

/**
 * The package a `resolutions` selector redirects: `typescript` for `typescript`, `typescript@npm:6.0.3`,
 * `**\/typescript` and `parent@1/typescript@^6` alike. A selector carrying a range could name
 * no package the scanner knew, so `"typescript@npm:6.0.3": "npm:5.9.3"` passed while Yarn installed 5.9.3.
 *
 * @param selector the `resolutions` key
 * @returns the target package name, or undefined when the key is no selector Yarn's grammar reads
 */
function resolutionTarget({ selector }: { selector: string }): string | undefined {
  return RESOLUTION_SELECTOR.exec(selector)?.[1];
}

/** One declaration's verdict: its finding, if any, and whether it names TypeScript at all. */
interface Judgement {
  readonly finding: TypescriptPinFinding | undefined;
  readonly namesTypescript: boolean;
}

/**
 * The finding, if any, for one declared dependency, and whether it names TypeScript at all.
 *
 * @param name the dependency's package name
 * @param specifier what the manifest asks for
 * @param expected the exact version a direct pin must equal
 * @param path the manifest's repo-relative path
 * @param location the manifest, field and name, for the message
 * @returns the finding (undefined when the dependency is fine) and whether it names TypeScript
 */
function dependencyFinding({
  name,
  specifier,
  expected,
  path,
  location,
}: {
  name: string;
  specifier: string;
  expected: string;
  path: string;
  location: string;
}): Judgement {
  if (name === TYPESCRIPT6_PACKAGE || namesTypescript6({ text: specifier })) {
    const message = `${location} is "${specifier}": ${TYPESCRIPT6_PACKAGE} is a second compiler beside the pin`;
    return { finding: { kind: "forbidden-typescript6-package", message, path }, namesTypescript: true };
  }
  if (name === "typescript") {
    if (specifier === expected) {
      return { finding: undefined, namesTypescript: true };
    }
    const message = `${location} is "${specifier}": every pin is exactly "${expected}", never a range, alias or patch`;
    return { finding: { kind: "direct-pin-mismatch", message, path }, namesTypescript: true };
  }
  if (namesTypescriptDescriptor({ text: specifier })) {
    const message = `${location} is "${specifier}": an alias installs a second compiler under another name`;
    return { finding: { kind: "forbidden-typescript-alias", message, path }, namesTypescript: true };
  }
  return { finding: undefined, namesTypescript: false };
}

/**
 * A `typescript@` descriptor anywhere a protocol can nest one — at the start, or after any `:` — once Yarn's
 * `%3A` is decoded. `npm:typescript@6`, `patch:typescript@npm%3A5.9.3#…` and `tsold@patch:typescript@…` all
 * match; `@acme/typescript@1` (another scope's package) does not. A prefix test on
 * `npm:typescript@` alone would let a `patch:` alias install 5.9.3 beside the pin.
 */
const TYPESCRIPT_DESCRIPTOR = /(?:^|:)typescript@/;

/** The compatibility package's descriptor, wherever it sits in a specifier or a resolution. */
const TYPESCRIPT6_DESCRIPTOR = /(?:^|:)@typescript\/typescript6@/;

/**
 * Whether a specifier or resolution nests a `typescript@` descriptor.
 *
 * @param text a manifest specifier or a lock entry's `resolution`
 * @returns true when it names the `typescript` package under any protocol
 */
function namesTypescriptDescriptor({ text }: { text: string }): boolean {
  return TYPESCRIPT_DESCRIPTOR.test(text.replaceAll("%3A", ":"));
}

/**
 * Whether a specifier or resolution nests the `@typescript/typescript6` descriptor.
 *
 * @param text a manifest specifier or a lock entry's `resolution`
 * @returns true when it names the compatibility package under any protocol
 */
function namesTypescript6({ text }: { text: string }): boolean {
  return TYPESCRIPT6_DESCRIPTOR.test(text.replaceAll("%3A", ":"));
}

/** The binaries only a TypeScript compiler ships: an entry exposing one installs a compiler, whatever its name. */
const COMPILER_BINS: ReadonlySet<string> = new Set(["tsc", "tsserver"]);

/**
 * A bin TARGET whose file is named `tsc` or `tsserver` under any extension — `bin/tsc`, `./bin/tsserver.js`,
 * `bin/tsc.sh` — under whatever command name. What this text scan cannot see is a compiler whose package name,
 * command and script names were ALL changed, or one inside a tracked archive: the installed-tree check at the
 * flip reads what Yarn actually installed, and covers those.
 */
const COMPILER_BIN_TARGET = /(?:^|\/)(?:tsc|tsserver)(?:\.[^/]*)?$/;

/**
 * Whether a lock entry exposes a compiler binary — the content-based half of the scan, for an entry installed by
 * a URL, git, file or portal protocol whose resolution names no package at all. A command name or a target
 * counts: a portal to a vendored compiler can have a shorthand `bin` Yarn locks as
 * `typescript: bin/tsc`, naming neither `tsc` nor `tsserver`.
 *
 * @param entry the lock entry's mapping
 * @returns true when its `bin` names `tsc` or `tsserver`, or points at a script of either name
 */
function exposesCompiler({ entry }: { entry: Record<string, unknown> }): boolean {
  const bin = entry["bin"];
  if (!isRecord(bin)) {
    return false;
  }
  return Object.entries(bin).some(
    ([name, target]) => COMPILER_BINS.has(name) || (typeof target === "string" && COMPILER_BIN_TARGET.test(target)),
  );
}

/**
 * One lockfile's findings: every entry whose `resolution` installs a TypeScript other than the pin.
 *
 * @param lockfile the `yarn.lock` subject
 * @param expected the exact version a `typescript` resolution must equal
 * @returns the findings
 */
function lockfileFindings({ lockfile, expected }: { lockfile: TrackedText; expected: string }): TypescriptPinFinding[] {
  const { path } = lockfile;
  let parsed: unknown;
  try {
    parsed = parseYaml(lockfile.text);
  } catch {
    return [{ kind: "invalid-input", message: `${path}: not a readable Yarn lockfile`, path }];
  }
  if (!isRecord(parsed)) {
    return [{ kind: "invalid-input", message: `${path}: a lockfile must be a mapping of entries`, path }];
  }
  const findings: TypescriptPinFinding[] = [];
  for (const [key, entry] of Object.entries(parsed)) {
    if (key === "__metadata") {
      continue;
    }
    // Skipping an entry with no resolution skipped its `tsc` bin too. Yarn writes one on
    // every entry, so its absence is input this scan cannot judge, never a clean entry.
    if (!isRecord(entry) || typeof entry["resolution"] !== "string") {
      const message = `${path}: entry ${key} has no resolution, so what it installs cannot be judged`;
      findings.push({ kind: "invalid-input", message, path });
      continue;
    }
    const resolution = entry["resolution"];
    if (namesTypescript6({ text: resolution })) {
      const message = `${path}: resolves ${resolution}, a second compiler beside the pin`;
      findings.push({ kind: "forbidden-typescript6-package", message, path });
      continue;
    }
    const installsTypescript = namesTypescriptDescriptor({ text: resolution }) || exposesCompiler({ entry });
    if (installsTypescript && !isPinnedResolution({ expected, resolution })) {
      const message = `${path}: resolves ${resolution}; only typescript ${expected} may resolve`;
      findings.push({ kind: "lock-resolution-mismatch", message, path });
    }
  }
  return findings;
}

/**
 * Whether a `typescript@…` resolution installs exactly the pinned version: the registry package itself, or
 * Yarn's builtin compat patch of it with BOTH its encoded underlying version and its `::version=` equal to
 * the pin. Any other patch, protocol or version is not the pinned compiler.
 *
 * @param resolution a lock entry's `resolution` value
 * @param expected the pinned version
 * @returns true when the resolution is the pinned compiler
 */
function isPinnedResolution({ resolution, expected }: { resolution: string; expected: string }): boolean {
  if (resolution === `typescript@npm:${expected}`) {
    return true;
  }
  const patched = /^typescript@patch:typescript@npm%3A([^#]+)#([^:]+)::version=([^&]+)&hash=[0-9a-f]+$/.exec(
    resolution,
  );
  if (patched === null) {
    return false;
  }
  const [, encoded, patch, metadata] = patched;
  return encoded === expected && patch === BUILTIN_COMPAT_PATCH && metadata === expected;
}

/**
 * One finding when a subject set is not exactly the expected one.
 *
 * @param actual the paths found
 * @param expected the exact sorted paths required
 * @param kind which set this is
 * @returns one finding naming both sets, or none when they match
 */
function setFindings({
  actual,
  expected,
  kind,
}: {
  actual: readonly string[];
  expected: readonly string[];
  kind: "manifest-set-mismatch" | "lockfile-set-mismatch";
}): readonly TypescriptPinFinding[] {
  const sorted = actual.toSorted();
  if (sorted.length === expected.length && sorted.every((path, index) => path === expected[index])) {
    return [];
  }
  const subject = kind === "manifest-set-mismatch" ? "TypeScript-bearing manifests" : "lockfiles";
  const message = `the ${subject} are [${sorted.join(", ")}], expected exactly [${expected.join(", ")}]`;
  return [{ kind, message, path: "(tracked tree)" }];
}
