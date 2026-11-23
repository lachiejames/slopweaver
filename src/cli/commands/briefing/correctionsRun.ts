/**
 * `slopweaver briefing corrections` — the half of a page that shows where it changed which writes the marks.
 *
 * It diffs the next version against the store's newest freeze, which `briefing freeze` (`./freezeRun.ts`) took of
 * what the owner read, and writes the computed marks onto it. It never publishes.
 *
 * ## Why `--previous` exists beside `--artifact`
 *
 * `--artifact` is the ordinary path and resolves the previous bytes from the latest freeze in the published-page
 * store, so a seat never has to remember where it put them; a store that cannot be read refuses, naming the page.
 * `--previous` names a file directly, which is what a test needs, so the whole verb is exercisable without a store.
 *
 * The rules and the compare are pure (`../../../outbound/briefing/corrections.ts`); this file reads two files, writes
 * one, and prints.
 */
import { existsSync, readFileSync } from "node:fs";

import { checkCorrections } from "../../../briefing/corrections.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { type PageCorrections, pageCorrections, stampCorrections } from "../../../outbound/briefing/corrections.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { correctionsWritePath, parseBriefingCorrectionsArgs, VERB_ARG_OFFSET } from "./core.js";
import { type BriefingCommandError, BriefingCommandErrors, briefingCommandErrorLines } from "./errors.js";
import { latestPublishedPage } from "./publishedPageReader.js";
import { BRIEFING_CORRECTIONS_USAGE } from "./usage.js";

/**
 * How many moved spots the human output names before it stops.
 *
 * Rule 7 applied to a terminal. A republish that rewrites a whole section legitimately moves dozens of
 * spots, and the diagnostic is meant to point at them, not reproduce them; `--json` carries every row.
 */
const NAMED_ROWS_MAX = 20;

/** Everything a `corrections` run needs, once the argv and the two files have been resolved. */
interface CorrectionsInvocation {
  readonly previous: string;
  readonly next: string;
  /** Where the stamped page is written: `--out` when given, else over `--page` itself. */
  readonly writePath: string;
  readonly verify: boolean;
  readonly json: boolean;
}

/** The one string flag, or undefined when it was not given. */
function flag({ values, name }: { values: Record<string, unknown>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Read the argv tail and the two pages, or say what to print and exit with.
 *
 * @param rest the argv tail after `briefing corrections`
 * @param readFile reads a file, or throws — injected so a test never touches real disk
 * @param exists whether a path exists — injected for the same reason
 * @param readFrozen the newest frozen version of an artifact, injected for the same reason
 * @returns what the run needs, or the lines to print and the code to exit with
 */
async function resolveCorrections({
  rest,
  readFile,
  exists,
  readFrozen,
}: {
  rest: readonly string[];
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  readFrozen: (args: { artifact: string; home: string }) => Promise<Result<string>>;
}): Promise<Result<CorrectionsInvocation, { lines: readonly string[]; code: number }>> {
  const parsed = parseBriefingCorrectionsArgs({ rest });
  if (parsed.isErr()) {
    return err({ code: EXIT_USAGE, lines: [...parsed.error, BRIEFING_CORRECTIONS_USAGE] });
  }
  const { values } = parsed.value;
  const pagePath = flag({ name: "page", values });
  if (pagePath === undefined) {
    return err({ code: EXIT_USAGE, lines: ["briefing corrections needs --page <html>", BRIEFING_CORRECTIONS_USAGE] });
  }
  if (!exists(pagePath)) {
    return err({ code: EXIT_ERROR, lines: [`briefing corrections: no such file: ${pagePath}`] });
  }
  const previous = await resolvePrevious({ exists, readFile, readFrozen, values });
  if (previous.isErr()) {
    return err({ code: EXIT_ERROR, lines: briefingCommandErrorLines({ error: previous.error }) });
  }
  return ok({
    json: values["json"] === true,
    next: readFile(pagePath),
    previous: previous.value,
    verify: values["verify"] === true,
    writePath: correctionsWritePath({ pagePath, parsed: parsed.value }),
  });
}

/** The bytes the owner already read: a named file, or the newest freeze of the named artifact in the store. */
async function resolvePrevious({
  exists,
  readFile,
  readFrozen,
  values,
}: {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  readFrozen: (args: { artifact: string; home: string }) => Promise<Result<string>>;
  values: Record<string, unknown>;
}): Promise<Result<string, BriefingCommandError>> {
  const path = flag({ name: "previous", values });
  if (path !== undefined) {
    if (!exists(path)) {
      return err(BriefingCommandErrors.fileNotFound({ path }));
    }
    return ok(readFile(path));
  }
  const artifact = flag({ name: "artifact", values });
  if (artifact === undefined) {
    return err(BriefingCommandErrors.previousVersionMissing({ usage: BRIEFING_CORRECTIONS_USAGE }));
  }
  const frozen = await readFrozen({ artifact, home: resolveHome({ named: flag({ name: "home", values }) }) });
  return frozen.mapErr((reasons) => BriefingCommandErrors.upstreamRefused({ reasons }));
}

/** The human lines one compare prints. */
function correctionLines({ result }: { result: PageCorrections }): readonly string[] {
  const head =
    `${String(result.marked)} marked spot(s) across ${String(result.spotsCompared)} on the page: ` +
    `${String(result.changed)} changed, ${String(result.added)} new, ${String(result.gone)} gone`;
  const moved = result.corrections.filter((row) => row.mark !== "unchanged");
  const named = moved.slice(0, NAMED_ROWS_MAX).map((row) => `  ${row.mark}: ${row.label}`);
  const rest = moved.length - named.length;
  const more = rest > 0 ? [`  …and ${String(rest)} more (\`--json\` prints every row)`] : [];
  return [head, `compared against ${result.against}`, ...named, ...more];
}

/**
 * Run `briefing corrections` against injected output sinks.
 *
 * `--verify` re-runs the compare over a page that is ALREADY stamped and refuses when the page's own claims
 * disagree with what the compare found. That is the leg that closes the row's finding: a hand-edited strip
 * passes every look and fails this.
 *
 * @param rest the argv tail after `briefing corrections`
 * @param readFile reads a file, or throws — injected so a test never touches real disk
 * @param exists whether a path exists — injected for the same reason
 * @param readFrozen the newest frozen version of an artifact, injected for the same reason
 * @param writeFile writes the stamped page — injected for the same reason
 * @param writeOut where the run's lines are printed
 * @param writeDiagnostic where a usage or resolution problem is printed
 * @returns the process exit code
 */
export async function runBriefingCorrections({
  rest,
  readFile,
  exists,
  readFrozen,
  writeFile,
  writeOut,
  writeDiagnostic,
}: {
  rest: readonly string[];
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  readFrozen: (args: { artifact: string; home: string }) => Promise<Result<string>>;
  writeFile: (args: { path: string; contents: string }) => void;
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
}): Promise<number> {
  const invocation = await resolveCorrections({ exists, readFile, readFrozen, rest });
  if (invocation.isErr()) {
    for (const line of invocation.error.lines) {
      writeDiagnostic(line);
    }
    return invocation.error.code;
  }
  const { json, next, previous, verify, writePath } = invocation.value;
  if (verify) {
    return verifyStamped({ json, next, previous, writeDiagnostic, writeOut });
  }
  const stamped = stampCorrections({ next, previous });
  writeFile({ contents: stamped.html, path: writePath });
  if (json) {
    writeOut(safeJsonStringify({ label: "briefing corrections", value: stamped.result }));
    return EXIT_OK;
  }
  for (const line of correctionLines({ result: stamped.result })) {
    writeOut(line);
  }
  writeOut(`wrote ${writePath}`);
  return EXIT_OK;
}

/**
 * The `--verify` leg: recompute the marks and compare them to what the page claims.
 *
 * Two different failures, reported apart because they are fixed differently. The page's own claims may not
 * add up — a hand-edited strip, a mark deleted by hand — which `checkCorrections` sees from the file alone.
 * Or the claims may be internally consistent and simply not be what the diff says, which only a recompute
 * can see, and which is the exact shape a hand-authored mark set takes.
 */
function verifyStamped({
  json,
  next,
  previous,
  writeDiagnostic,
  writeOut,
}: {
  json: boolean;
  next: string;
  previous: string;
  writeDiagnostic: (line: string) => void;
  writeOut: (line: string) => void;
}): number {
  const recomputed = pageCorrections({ next, previous });
  const onPage = checkCorrections({ html: next });
  const defects = onPage.defects.map((defect) => `corrections (${defect.rule}): ${defect.reason}`);
  const mismatched: readonly string[] =
    onPage.marks === recomputed.marked
      ? []
      : [
          `corrections (recompute-mismatch): the page carries ${String(onPage.marks)} mark(s) and the diff ` +
            `against the version the owner read says ${String(recomputed.marked)}. Re-stamp it — a mark set that ` +
            "does not match the diff is exactly the hand-authored failure this verb replaces.",
        ];
  const all = [...defects, ...mismatched];
  if (json) {
    writeOut(
      safeJsonStringify({ label: "briefing corrections --verify", value: { defects: all, onPage, recomputed } }),
    );
    return all.length === 0 ? EXIT_OK : EXIT_ERROR;
  }
  for (const line of correctionLines({ result: recomputed })) {
    writeOut(line);
  }
  for (const line of all) {
    writeDiagnostic(line);
  }
  writeOut(all.length === 0 ? "the page's marks match the diff" : `${String(all.length)} defect(s)`);
  return all.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/** `slopweaver briefing corrections`. */
export const briefingCorrectionsCommand = defineCommand({
  run: (argv) =>
    runBriefingCorrections({
      exists: existsSync,
      readFile: (path) => readFileSync(path, "utf8"),
      readFrozen: async ({ artifact, home }) =>
        (await latestPublishedPage({ artifact, home })).mapErr((failure) => [failure.message]),
      rest: argv.slice(VERB_ARG_OFFSET),
      writeDiagnostic: (line) => {
        logger.error({ msg: line });
      },
      writeFile: ({ contents, path }) => {
        writeFileAtomic({ contents, path });
      },
      writeOut: (line) => {
        logger.out({ line });
      },
    }),
});
