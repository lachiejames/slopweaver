/**
 * `slopweaver briefing freeze` — the half of a page that shows where it changed which keeps what the owner read.
 *
 * It writes the exact bytes a publish put in front of the owner into the published-page store, the only place a
 * freeze is kept, where `briefing corrections` (`./correctionsRun.ts`) diffs against it. A store failure fails the
 * freeze and writes nothing anywhere else, so re-running the same freeze completes it. It never publishes; the
 * publishing seat does that, and runs `freeze` again on what it published.
 */
import { existsSync, readFileSync } from "node:fs";

import { sha256Text } from "../../../lib/hash.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { FreezeStoreErrors, type FreezeWriteError } from "../../../outbound/briefing/errors.js";
import { artifactKey, driftDetail } from "../../../outbound/briefing/freezeStore.js";
import { storePublishedPage } from "../../../store/publishedPages/write.js";
import { freezeWrite } from "../../../store/publishedPages/writePlan.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseBriefingFreezeArgs, VERB_ARG_OFFSET } from "./core.js";
import { BRIEFING_FREEZE_USAGE } from "./usage.js";

/**
 * What writes one freeze into the store, refusing a key with no history unless `opensHistory` says so. Injected so a
 * test never opens a store; production binds {@link storeFreeze}.
 */
export type FreezeWriter = (args: {
  home: string;
  key: string;
  html: string;
  frozenAt: Date;
  opensHistory: boolean;
}) => Promise<Result<void, FreezeWriteError>>;

/**
 * Write one freeze into a home's store, naming the held keys next to it when it was refused for opening a history.
 *
 * @param home the home whose store it is written into
 * @param key the freeze key
 * @param html the exact bytes frozen
 * @param frozenAt the freeze's instant
 * @param opensHistory whether `--new` was passed
 * @returns nothing, or why it was not written
 */
const storeFreeze: FreezeWriter = async ({ home, key, html, frozenAt, opensHistory }) => {
  const write = freezeWrite({ document: html, frozenAt, key, opensHistory });
  const written = await storePublishedPage({ home, importedAt: frozenAt, write });
  if (written.isOk()) {
    return ok(undefined);
  }
  for (const failure of written.error) {
    if (failure.code === "PAGES_FREEZE_OPENS_HISTORY") {
      return err(FreezeStoreErrors.newHistoryRefused({ detail: driftDetail(failure), key }));
    }
  }
  return err(FreezeStoreErrors.writeFailed({ key, lines: written.error.map((failure) => failure.message) }));
};

/** The one string flag, or undefined when it was not given. */
function flag({ values, name }: { values: Record<string, unknown>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Run `briefing freeze` against injected output sinks.
 *
 * @param rest the argv tail after `briefing freeze`
 * @param readFile reads the page, or throws — injected so a test never touches real disk
 * @param exists whether a path exists — injected for the same reason
 * @param write writes the freeze into the store, injected so a test never opens one
 * @param nowIso when the freeze is being taken
 * @param writeOut where the run's lines are printed
 * @param writeDiagnostic where a usage or store problem is printed
 * @returns the process exit code
 */
export async function runBriefingFreeze({
  rest,
  readFile,
  exists,
  write,
  nowIso,
  writeOut,
  writeDiagnostic,
}: {
  rest: readonly string[];
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  write: FreezeWriter;
  nowIso: string;
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
}): Promise<number> {
  const resolved = resolveFreeze({ exists, rest });
  if (resolved.isErr()) {
    for (const line of resolved.error.lines) {
      writeDiagnostic(line);
    }
    return resolved.error.code;
  }
  const { allowNew, artifact, home, json, pagePath } = resolved.value;
  const key = artifactKey({ artifact });
  if (key.isErr()) {
    writeDiagnostic(key.error.message);
    return EXIT_ERROR;
  }
  const html = readFile(pagePath);
  const written = await write({ frozenAt: new Date(nowIso), home, html, key: key.value, opensHistory: allowNew });
  if (written.isErr()) {
    writeDiagnostic(written.error.message);
    return EXIT_ERROR;
  }
  const frozen = { frozenIso: nowIso, key: key.value, sha256: sha256Text({ text: html }) };
  if (json) {
    writeOut(safeJsonStringify({ label: "briefing freeze", value: frozen }));
    return EXIT_OK;
  }
  writeOut(`froze ${artifact} at ${frozen.sha256}`);
  writeOut(`kept in the store under ${frozen.key}`);
  return EXIT_OK;
}

/**
 * Read `freeze`'s argv tail into what the run needs, or into what to print and exit with.
 *
 * Separated from the run itself so the verb's body is the freeze it takes rather than its argument
 * handling — and so the file-missing case, an error rather than a usage problem, keeps its own exit code.
 *
 * @param exists whether the page path exists
 * @param rest the argv tail after `briefing freeze`
 * @returns the artifact, the home, the page path, `--new` and whether to print JSON, or the lines and exit code
 */
function resolveFreeze({
  exists,
  rest,
}: {
  exists: (path: string) => boolean;
  rest: readonly string[];
}): Result<
  { allowNew: boolean; artifact: string; home: string; json: boolean; pagePath: string },
  { lines: readonly string[]; code: number }
> {
  const parsed = parseBriefingFreezeArgs({ rest });
  if (parsed.isErr()) {
    return err({ code: EXIT_USAGE, lines: [...parsed.error, BRIEFING_FREEZE_USAGE] });
  }
  const { values } = parsed.value;
  const artifact = flag({ name: "artifact", values });
  const pagePath = flag({ name: "page", values });
  if (artifact === undefined || pagePath === undefined) {
    return err({
      code: EXIT_USAGE,
      lines: ["briefing freeze needs --artifact <url|id> and --page <html>", BRIEFING_FREEZE_USAGE],
    });
  }
  if (!exists(pagePath)) {
    return err({ code: EXIT_ERROR, lines: [`briefing freeze: no such file: ${pagePath}`] });
  }
  return ok({
    // `new` is a reserved word, so it is read off `values` by index rather than destructured.
    allowNew: values["new"] === true,
    artifact,
    home: resolveHome({ named: flag({ name: "home", values }) }),
    json: values["json"] === true,
    pagePath,
  });
}

/** `slopweaver briefing freeze`. */
export const briefingFreezeCommand = defineCommand({
  run: (argv) =>
    runBriefingFreeze({
      exists: existsSync,
      nowIso: new Date().toISOString(),
      readFile: (path) => readFileSync(path, "utf8"),
      rest: argv.slice(VERB_ARG_OFFSET),
      writeDiagnostic: (line) => {
        logger.error({ msg: line });
      },
      writeOut: (line) => {
        logger.out({ line });
      },
      write: storeFreeze,
    }),
});
