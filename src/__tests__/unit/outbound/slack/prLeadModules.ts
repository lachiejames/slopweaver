/*
 * The module graph behind `prLeadSeams/producers.test.ts`'s caller count. A caller of a judged producer is found by the file its
 * imports LOAD, resolved by the compiler under this repository's own `tsconfig.json` — a relative path under any
 * extension, the package's `#` imports map, an `export … from`, a literal `import()`, `require()` or a `createRequire`
 * loader alike, under both NodeNext resolution modes, and a path literal in any letter case, since a Mac folds case —
 * never by how the specifier is spelled. A specifier computed at run time is what it cannot resolve.
 */
import { basename, dirname, extname, relative, resolve } from "node:path";

import { unwrap } from "#lib/result.js";
import { type ResolutionMode, type TsModuleResolver, withTsModuleResolver } from "#lib/tsProject.js";
import {
  forEachChild,
  isStringLiteralLikeNode,
  type LentAnswer,
  moduleSpecifiers,
  type NodeVisitor,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";

/** The repository root, read once at import as the module-scope resolver this replaced read it, whatever cwd is later. */
const REPO_ROOT = process.cwd();

/**
 * Lend `use` the compiler's resolver under the repository's own `tsconfig.json`, so resolution is the compiler's own.
 * One walk shares one resolver and its cache; the resolver is released when `use` returns.
 *
 * @param use resolves what it needs and answers plain data
 * @returns what `use` returned
 */
export function withRepoResolver<R>({
  use,
}: {
  use: (resolver: TsModuleResolver) => LentAnswer<R, TsModuleResolver>;
}): LentAnswer<R, TsModuleResolver> {
  return unwrap(
    withTsModuleResolver({ configFileName: resolve(REPO_ROOT, "tsconfig.json"), currentDirectory: REPO_ROOT, use }),
  );
}

/** Whether a specifier can name a file in this repository: a relative or absolute path, or a `#` import. */
function isLocal({ specifier }: { specifier: string }): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#");
}

/** Both modes NodeNext resolves a load in: `import` (static, dynamic) and `require` (any loader a `require` returns). */
const MODES: readonly ResolutionMode[] = ["import", "require"];

/**
 * Every repository-relative file the compiler may load for `specifier` written in `from`, under EITHER resolution
 * mode: which one applies depends on the load's own syntax as well as the file's format, and a conditional `imports`
 * entry can send the two to different files, so both count.
 *
 * @param resolver lent by {@link withRepoResolver}
 * @returns the distinct files it resolves to, empty when the compiler resolves it to nothing in either mode
 */
export function resolutionsOf({
  from,
  resolver,
  specifier,
}: {
  from: string;
  resolver: TsModuleResolver;
  specifier: string;
}): readonly string[] {
  const files = MODES.flatMap((mode) => {
    const resolved = resolver.resolve({ fromFile: resolve(from), mode, specifier });
    return resolved === undefined ? [] : [relative(process.cwd(), resolved)];
  });
  return [...new Set(files)];
}

/**
 * Every local module `text` loads by a module-syntax specifier — import, `export … from`, `import()`, `require()` —
 * each with the files it resolves to.
 *
 * @param resolver lent by {@link withRepoResolver}
 * @returns one entry per local specifier, `resolved` empty where the compiler finds no file
 */
export function importsOf({
  path,
  resolver,
  text,
}: {
  path: string;
  resolver: TsModuleResolver;
  text: string;
}): readonly { specifier: string; resolved: readonly string[] }[] {
  return moduleSpecifiers({ fileName: path, text })
    .filter((specifier) => isLocal({ specifier }))
    .map((specifier) => ({ resolved: resolutionsOf({ from: path, resolver, specifier }), specifier }));
}

/**
 * Every local module-syntax specifier in `text` the compiler places in NO file under EITHER mode — what
 * {@link importsOf} answers with `resolved` empty, at half the cost. Being placed needs only one mode to find a file,
 * so `require` is asked only where `import` found none, and each lookup is one synchronous round trip to the Go
 * server that load stretches. MEASURED on one loaded seat, back to back, production's 19,177 distinct
 * directory-and-specifier pairs: 14.0s asking both modes through the resolver's memo, 9.8s asking this way (20.8s
 * with neither). Repro: `yarn vitest run --config config/vitest/unit.ts
 * src/__tests__/unit/outbound/slack/prLeadSeams/producers.test.ts --reporter=verbose -t "every local import"`.
 *
 * @param resolver lent by {@link withRepoResolver}
 * @returns each specifier resolving to nothing in both modes, in source order
 */
export function unresolvedImportsOf({
  path,
  resolver,
  text,
}: {
  path: string;
  resolver: TsModuleResolver;
  text: string;
}): readonly string[] {
  return moduleSpecifiers({ fileName: path, text }).filter(
    (specifier) =>
      isLocal({ specifier }) &&
      MODES.every((mode) => resolver.resolve({ fromFile: resolve(path), mode, specifier }) === undefined),
  );
}

/**
 * Every string literal and substitution-free template in `text`, read off its syntax tree and decoded — so a `$`, a
 * quote of the other kind or an escape sequence inside one is its value, and two literals are never paired by mistake.
 */
function literalTexts({ path, text }: { path: string; text: string }): readonly string[] {
  const texts: string[] = [];
  const visit: NodeVisitor = (node) => {
    if (isStringLiteralLikeNode(node)) {
      texts.push(node.text);
    }
    forEachChild({ node, visit });
  };
  withSourceFile({ fileName: path, text, use: visit });
  return texts;
}

/**
 * A literal whose last segment is `.` or `..` (`"."`, `"../.."`), which `mayLoad` passes without a stem because the
 * compiler can resolve one through a `package.json` `main` to a target the text never names.
 */
const DIRECTORY_LITERAL = /["'`/]\.{1,2}\/*["'`]/u;

/** What ends a `"` or `'` literal the parser recovers unterminated: a line terminator, as its scanner reads one. */
const LINE_TERMINATOR = /[\n\r\p{Zl}\p{Zp}]/u;

/**
 * Every run of `text` from a quote and `#` to where the parser may end that literal, terminated or recovered: the
 * next same quote, else the end of the text — a `"` or `'` run also cut at its first line terminator, where a string
 * the parser recovers unterminated ends (a JSX attribute's does not), and a backtick's run also with its line endings
 * normalised, as a template's value has them. In a file with no backslash, where nothing else makes a value differ
 * from its source text, that parses without error, a superset of the values of its `#` literals, read without a
 * parse. Every file this is asked about compiles, so the bound costs nothing; text the parser has to recover from
 * beyond one unterminated string can end a literal somewhere no run here does.
 */
function aliasCandidates({ text }: { text: string }): readonly string[] {
  const found: string[] = [];
  for (let at = text.indexOf("#"); at !== -1; at = text.indexOf("#", at + 1)) {
    const quote = text[at - 1];
    if (quote === '"' || quote === "'" || quote === "`") {
      const closed = text.indexOf(quote, at);
      const run = text.slice(at, closed === -1 ? text.length : closed);
      if (quote === "`") {
        found.push(run, run.replaceAll(/\r\n?/gu, "\n"));
      } else {
        found.push(run, run.split(LINE_TERMINATOR)[0]!);
      }
    }
  }
  return found;
}

/**
 * The names a specifier must end in to load `file`: its stem (`cardSend` for `cardSend.ts`), and its directory's name
 * when it is an `index` a directory specifier loads.
 *
 * @returns the stems a path-spelled specifier for `file` can end in
 */
export function stemsOf({ file }: { file: string }): readonly string[] {
  const stem = basename(file, extname(file));
  return stem === "index" ? [stem, basename(dirname(file))] : [stem];
}

/** A module file's extension, which a specifier may spell differently from the file (`.js` for `.ts`) or omit. */
const MODULE_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/iu;

/**
 * A path as a case-folding filesystem tells files apart: absolute, extension dropped, lower-cased. A Mac folds case,
 * so `./CardSend.js` loads `cardSend.ts` there while CI's Linux resolves it to nothing — which is why a path literal is
 * matched by this key, on any filesystem, rather than only by what this one resolves.
 */
function foldedKey({ file }: { file: string }): string {
  return resolve(file).replace(MODULE_EXTENSION, "").toLowerCase();
}

/**
 * Whether a path specifier could load a file named by `stems` (lower-cased): its last segment without its extension
 * is one of them, in any case (`CardSend` for `cardSend.ts`), or it is `.` or `..`, which load a directory's `index`.
 */
function mayLoad({ specifier, stems }: { specifier: string; stems: ReadonlySet<string> }): boolean {
  const last = basename(specifier);
  return last === "." || last === ".." || stems.has(basename(last, extname(last)).toLowerCase());
}

/**
 * Which of `targets` `text` could load by ANY literal local specifier, whatever loads it: module syntax, a loader
 * `createRequire` returns, a string handed to a helper. Deliberately over-reaching, because a caller missed is the one
 * failure that matters. A path literal loads a target when the two name one file to a case-folding filesystem —
 * matched by path, so it holds on any filesystem — or when the compiler resolves it there; a `#` alias is always
 * resolved, since the imports map can send it anywhere, and its result compared with case folded too.
 *
 * The answer is always the syntax tree's, but most files never need one. A file that could hold a path literal
 * loading a target is parsed: one naming a target's stem in any case, or holding a backslash (an escape makes a
 * literal's value differ from its source text), or a `.` or `..` literal (which a `main` can send anywhere), or any
 * file at all when a target is an `index` (which `.` loads unnamed). Any other file is parsed only when a run its text holds that could be a `#` literal loads a target, since
 * in a file that compiles those runs are a superset of its `#` literals' values. MEASURED: parsing every production file timed
 * `PR_LEAD_PRODUCERS`' caller count out at 60s on every CI unit shard 2 (run 39893655440); on a seat, with
 * coverage, the prefilter takes it from 18.06s to 8.71s. Repro: `yarn vitest run --config config/vitest/unit.ts --coverage
 * src/__tests__/unit/outbound/slack/prLeadSeams/producers.test.ts -t "counts every call"`.
 *
 * @param resolver lent by {@link withRepoResolver}
 * @returns the targets, as given, that some literal in `text` may load
 */
export function loadsOf({
  path,
  resolver,
  targets,
  text,
}: {
  path: string;
  resolver: TsModuleResolver;
  targets: readonly string[];
  text: string;
}): ReadonlySet<string> {
  const stems = new Set(targets.flatMap((file) => stemsOf({ file }).map((stem) => stem.toLowerCase())));
  const keyed = targets.map((target) => ({ key: foldedKey({ file: target }), target }));
  const lower = text.toLowerCase();
  const parse =
    stems.has("index") ||
    text.includes("\\") ||
    DIRECTORY_LITERAL.test(text) ||
    [...stems].some((stem) => lower.includes(stem));
  if (!parse && loadedBy({ keyed, literals: aliasCandidates({ text }), path, resolver, stems }).size === 0) {
    return new Set();
  }
  return loadedBy({ keyed, literals: literalTexts({ path, text }), path, resolver, stems });
}

/** Which of the `keyed` targets some local specifier among `literals`, written in `path`, may load. */
function loadedBy({
  keyed,
  literals,
  path,
  resolver,
  stems,
}: {
  keyed: readonly { key: string; target: string }[];
  literals: readonly string[];
  path: string;
  resolver: TsModuleResolver;
  stems: ReadonlySet<string>;
}): ReadonlySet<string> {
  const loaded = new Set<string>();
  for (const specifier of new Set(literals.filter((literal) => isLocal({ specifier: literal })))) {
    const isPath = !specifier.startsWith("#");
    if (isPath && !mayLoad({ specifier, stems })) {
      continue;
    }
    const keys = new Set(resolutionsOf({ from: path, resolver, specifier }).map((file) => foldedKey({ file })));
    if (isPath) {
      const named = foldedKey({ file: resolve(dirname(path), specifier) });
      keys.add(named).add(`${named}/index`);
    }
    for (const { key, target } of keyed) {
      if (keys.has(key)) {
        loaded.add(target);
      }
    }
  }
  return loaded;
}

/**
 * The specifier of every `export … from` in `text`, star or named, read from its syntax tree so comments between the
 * tokens change nothing.
 *
 * @returns each re-export's specifier, in source order
 */
export function reexportsIn({ path, text }: { path: string; text: string }): readonly string[] {
  return withSourceFile({
    fileName: path,
    text,
    use: (source): readonly string[] =>
      source.statements.flatMap((statement) =>
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? [statement.moduleSpecifier.text]
          : [],
      ),
  });
}
