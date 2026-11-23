/**
 * How `tsc` reads its own words, for `./wholeTreeCheck.ts`: whether a run prints, checks files it was handed,
 * or checks a whole tsconfig project. `TSC_BOOLEAN_OPTIONS` is every option that takes no value, lowercased,
 * as the installed compiler reads them — a word after any OTHER flag is that flag's value, since
 * `tsc --outDir build.ts` hands `build.ts` to the flag and checks the whole project. A missing entry costs a
 * false refusal, never a bypass. TypeScript 7 keeps its option table in the native binary, so
 * `unit/admit/wholeTreeCheck.test.ts` asks the compiler itself — every word `tsc --help --all` lists, kept when
 * its own `parseCommandLine([word, "probe.ts"])` leaves `probe.ts` a file — and fails the moment the two
 * disagree; its failure diff is the regenerated list.
 */

/** The names `tsc` accepts bare, lowercased: long names first, then the single-letter aliases. */
export const TSC_BOOLEAN_OPTIONS: ReadonlySet<string> = new Set(
  [
    "help",
    "watch",
    "preservewatchoutput",
    "listfiles",
    "explainfiles",
    "listemittedfiles",
    "pretty",
    "traceresolution",
    "diagnostics",
    "extendeddiagnostics",
    "incremental",
    "declaration",
    "declarationmap",
    "emitdeclarationonly",
    "sourcemap",
    "inlinesourcemap",
    "nocheck",
    "noemit",
    "assumechangesonlyaffectdirectdependencies",
    "all",
    "version",
    "init",
    "showconfig",
    "listfilesonly",
    "ignoreconfig",
    "allowjs",
    "checkjs",
    "composite",
    "removecomments",
    "importhelpers",
    "downleveliteration",
    "isolatedmodules",
    "verbatimmodulesyntax",
    "isolateddeclarations",
    "erasablesyntaxonly",
    "libreplacement",
    "strict",
    "noimplicitany",
    "strictnullchecks",
    "strictfunctiontypes",
    "strictbindcallapply",
    "strictpropertyinitialization",
    "strictbuiltiniteratorreturn",
    "stabletypeordering",
    "noimplicitthis",
    "useunknownincatchvariables",
    "alwaysstrict",
    "nounusedlocals",
    "nounusedparameters",
    "exactoptionalpropertytypes",
    "noimplicitreturns",
    "nofallthroughcasesinswitch",
    "nouncheckedindexedaccess",
    "noimplicitoverride",
    "nopropertyaccessfromindexsignature",
    "allowsyntheticdefaultimports",
    "esmoduleinterop",
    "preservesymlinks",
    "allowumdglobalaccess",
    "allowimportingtsextensions",
    "rewriterelativeimportextensions",
    "resolvepackagejsonexports",
    "resolvepackagejsonimports",
    "nouncheckedsideeffectimports",
    "inlinesources",
    "experimentaldecorators",
    "emitdecoratormetadata",
    "resolvejsonmodule",
    "allowarbitraryextensions",
    "skipdefaultlibcheck",
    "emitbom",
    "noerrortruncation",
    "nolib",
    "noresolve",
    "stripinternal",
    "disablesizelimit",
    "disablesourceofprojectreferenceredirect",
    "disablesolutionsearching",
    "disablereferencedprojectload",
    "noemithelpers",
    "noemitonerror",
    "preserveconstenums",
    "skiplibcheck",
    "allowunusedlabels",
    "allowunreachablecode",
    "forceconsistentcasinginfilenames",
    "usedefineforclassfields",
    "deduplicatepackages",
    "quiet",
    "runexternalcode",
    "singlethreaded",
  ].concat(["h", "?", "w", "i", "d", "v", "q"]),
);

/** `tsc` options that print something and check nothing, as `tscOptionName` spells them. */
const TSC_NON_CHECK = new Set(["v", "version", "h", "?", "help", "all", "init", "showconfig"]);

/** `tsc` options that name a project, which a file operand beside them does not narrow. */
const TSC_PROJECT = new Set(["p", "project", "b", "build"]);

/**
 * A path operand that is one source file, rather than a directory, a `*` glob or the tree. `[`, `?` and `{` stay
 * legal: a route file such as `app/[slug]/page.tsx` carries them literally.
 */
export const SOURCE_FILE = /^[^*]*\.(?:[cm]?tsx?|[cm]?jsx?)$/u;

/**
 * What a `tsc` run covers: `prints` for a help, version or config dump, `files` when it was handed source
 * files, every operand one, and no project, and `project` otherwise — the tsconfig it finds, which is the whole tree here.
 *
 * @param args the words after `tsc`
 * @returns the run's scope
 */
export function tscScope({ args }: { args: readonly string[] }): "prints" | "files" | "project" {
  const { flags, operands } = tscWords({ args });
  if (flags.some((name) => TSC_NON_CHECK.has(name))) {
    return "prints";
  }
  const namesProject = flags.some((name) => TSC_PROJECT.has(name));
  // EVERY operand a literal source file: one `.ts` beside `.` or a glob is still the whole tree.
  if (!namesProject && operands.length > 0 && operands.every((word) => SOURCE_FILE.test(word))) {
    return "files";
  }
  return "project";
}

/**
 * Split a `tsc` tail the way `tsc` reads it: a flag not known to be valueless consumes the next word, so
 * `--outDir --showConfig` is one flag and its value, never two flags. `-p` and `-b` are kept whole: either
 * one alone already makes the run a project check. An `@file` response operand stays opaque: this reads no
 * file, so `tsc @files.rsp` is refused and its hatch is the way through.
 *
 * @param args the words after `tsc`
 * @returns the option names `tsc` acts on (see `tscOptionName`), and the file operands it was handed
 */
function tscWords({ args }: { args: readonly string[] }): { flags: readonly string[]; operands: readonly string[] } {
  const flags: string[] = [];
  const operands: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if (!word.startsWith("-")) {
      operands.push(word);
    } else {
      const name = tscOptionName({ word });
      const next = args[index + 1];
      // `tsc --help false` turns the option OFF and checks the project.
      if (!(TSC_BOOLEAN_OPTIONS.has(name) && next === "false")) {
        flags.push(name);
      }
      const takesValue = !TSC_BOOLEAN_OPTIONS.has(name) && !TSC_PROJECT.has(name);
      if (takesValue || next === "true" || next === "false") {
        index += 1;
      }
    }
  }
  return { flags, operands };
}

/**
 * The name `tsc` matches a flag by: leading dashes dropped and case folded, since `tsc -NOEMIT` and
 * `tsc --noEmit` are the same option.
 *
 * @param word a word starting with `-`
 * @returns the lowercased option name
 */
function tscOptionName({ word }: { word: string }): string {
  return word.replace(/^-+/u, "").toLowerCase();
}
