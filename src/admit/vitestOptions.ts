/**
 * How `vitest` reads an option word, for `./vitestInvocation.ts`. Vitest parses its argv with cac over mri, and
 * mri hands the next word to EVERY option that is not declared boolean — an option it has never heard of
 * included, and one written `--coverage.provider v8` too, which read as valueless made the whole unit lane look
 * narrowed to a file called `v8`. So the list kept here is the valueless one, exactly as
 * the tsc boolean-options list is for `tsc`: a missing entry swallows the filter after it, which costs a false
 * refusal the hatch covers, never a bypass. `unit/admit/vitestInvocation.test.ts` asks the installed vitest's own
 * `parseCLI` about every entry, which is how `--expect` and `--expect.poll` were found declared boolean yet
 * still taking the next word, so they are left out. Regenerate from vitest 4.1.11 itself, never by hand, then
 * drop whatever that test refuses:
 *
 *   yarn tsx -e 'const d = "node_modules/vitest/dist/chunks/"; const f = require("fs").readdirSync(d).find((n) => n.startsWith("cac."));
 *     import("./" + d + f).then(({ c }) => console.log(c().globalCommand.options.filter((o) => o.isBoolean).flatMap((o) => o.names)))'
 */

/** Every option vitest reads with no value, by the camelCase name cac reads either spelling as. */
export const VITEST_BOOLEAN_OPTIONS: ReadonlySet<string> = new Set([
  "v",
  "version",
  "w",
  "watch",
  "ui",
  "open",
  "api.strictPort",
  "api.allowExec",
  "api.allowWrite",
  "hideSkippedTests",
  "coverage",
  "coverage.enabled",
  "coverage.clean",
  "coverage.cleanOnRerun",
  "coverage.reportOnFailure",
  "coverage.allowExternal",
  "coverage.skipFull",
  "coverage.thresholds.100",
  "coverage.thresholds.perFile",
  "coverage.excludeAfterRemap",
  "isolate",
  "globals",
  "dom",
  "browser.enabled",
  "browser.headless",
  "browser.api.strictPort",
  "browser.api.allowExec",
  "browser.api.allowWrite",
  "browser.isolate",
  "browser.ui",
  "browser.fileParallelism",
  "browser.trackUnhandledErrors",
  "browser.locators.exact",
  "fileParallelism",
  "passWithNoTests",
  "logHeapUsage",
  "detectAsyncLeaks",
  "allowOnly",
  "dangerouslyIgnoreUnhandledErrors",
  "sequence.shuffle",
  "sequence.shuffle.files",
  "sequence.shuffle.tests",
  "sequence.concurrent",
  "diff.expand",
  "diff.includeChangeCounts",
  "diff.omitAnnotationLines",
  "diff.printBasicPrototype",
  "expandSnapshotDiff",
  "disableConsoleIntercept",
  "typecheck",
  "typecheck.enabled",
  "typecheck.only",
  "typecheck.allowJs",
  "typecheck.ignoreSourceErrors",
  "cache",
  "expect.requireAssertions",
  "printConsoleTrace",
  "includeTaskLocation",
  "run",
  "color",
  "clearScreen",
  "standalone",
  "clearCache",
  "strictTags",
  "experimental.fsModuleCache",
  "experimental.importDurations",
  "experimental.importDurations.failOnDanger",
  "experimental.importDurations.thresholds",
  "experimental.viteModuleRunner",
  "experimental.nodeLoader",
  "experimental.preParse",
  "h",
  "help",
]);

/**
 * An option word's name as cac reads it: dashes and any `=value` dropped, kebab-case folded to camelCase.
 *
 * @param word an option as written, `--list-tags=json`
 * @returns its name, `listTags`
 */
export function optionName({ word }: { word: string }): string {
  const [name = ""] = word.replace(/^-+/u, "").split("=");
  return name.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

/** The two words mri hands a boolean option as its value when they follow it: `--coverage.enabled false`. */
const BOOLEAN_WORDS: ReadonlySet<string> = new Set(["true", "false"]);

/**
 * How many following words an option consumes as its value, the way mri decides it: none when the value is
 * attached with `=`, when the option is a `--no-` negation, or when the next word is itself an option; for a
 * declared boolean, the next word only when it is `true` or `false`; otherwise the
 * next word.
 *
 * @param word the option as written
 * @param next the word after it
 * @returns 1 when `next` is the option's value, else 0
 */
export function optionValueWords({ word, next }: { word: string; next: string | undefined }): number {
  if (word.includes("=") || word.startsWith("--no-") || next === undefined || next.startsWith("-")) {
    return 0;
  }
  if (VITEST_BOOLEAN_OPTIONS.has(optionName({ word }))) {
    return BOOLEAN_WORDS.has(next) ? 1 : 0;
  }
  return 1;
}

/**
 * Whether an option is switched OFF where it is written: `--standalone=false` or `--standalone false` is the
 * same run as no `--standalone` at all, while a string option's `false` is just its value.
 *
 * @param word the option as written
 * @param next the word after it
 * @returns true when a declared boolean is handed `false`
 */
export function switchedOff({ word, next }: { word: string; next: string | undefined }): boolean {
  if (!VITEST_BOOLEAN_OPTIONS.has(optionName({ word }))) {
    return false;
  }
  const attached = word.split("=")[1];
  return attached === undefined ? next === "false" : attached === "false";
}
