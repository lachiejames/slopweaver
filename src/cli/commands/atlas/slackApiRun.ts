/**
 * `slopweaver atlas slack-api` — the effectful shell.
 *
 * Thin by design: every decision is pure ({@link ../../../atlas/slackApi/build} and {@link ./slackApiCore}),
 * and this file only reads the installed `@slack/web-api` declaration files. It makes **no network call**.
 *
 * ## Why this atlas is built on demand rather than synced to a generation
 *
 * Vanta and Cloudflare sync because their subject is a live account whose contents change under them, so a
 * stored generation with a timestamp is the only honest way to say "this is what was there at 09:00". This
 * atlas's subject is the installed SDK, which changes only when `yarn.lock` does. Building it on demand
 * makes it impossible for the map and the client this repo actually calls to disagree — a stored generation
 * would go stale silently on the next dependency bump, and a stale API map is worse than none, because it
 * names methods with the confidence of something that was measured.
 *
 * Data to STDOUT, diagnostics to STDERR, so `--json` stays pristine for `… | jq`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { BROWSER_OBSERVED_METHODS } from "../../../atlas/slackApi/browser.js";
import { buildSlackApiAtlas, findMethods, findResponseField } from "../../../atlas/slackApi/build.js";
import { type CapturedCall, observationsFromCalls } from "../../../atlas/slackApi/harObservations.js";
import { SLACK_API_METHODS } from "../../../atlas/slackApi/methods.js";
import type { SdkMethod, SlackApiAtlas } from "../../../atlas/slackApi/model.js";
import { renderBrowserModule } from "../../../atlas/slackApi/renderTable.js";
import { extractSdkMethods } from "../../../atlas/slackApi/sdkTypings.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type AtlasCommandError, AtlasCommandErrors, atlasCommandErrorLines } from "./errors.js";
import { type AtlasSlackApiOptions, parseAtlasSlackApiArgs, renderAtlasSlackApi } from "./slackApiCore.js";
import { ATLAS_SLACK_API_USAGE } from "./slackUsage.js";

/** The argv index the `atlas <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The declaration text the pure extractor needs, plus the version it came from. */
export interface SdkTypingsSource {
  readonly version: string;
  readonly methodsText: string;
  readonly requestText: string;
  readonly responseTexts: ReadonlyMap<string, string>;
}

/** The injected edges, so the shell is testable with plain fakes and no `node_modules`. */
export interface AtlasSlackApiDeps {
  readonly readTypings: () => Result<SdkTypingsSource, AtlasCommandError>;
  readonly readHar: (args: { path: string }) => Result<readonly CapturedCall[], AtlasCommandError>;
  readonly nowIso: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Every `.d.ts` under a directory, recursively, as one concatenated string. Concatenated rather than kept
 * per file because the SDK's request types inherit across family files, so resolving one in isolation
 * silently loses the shared pagination and token members.
 *
 * @param root the directory to walk
 * @returns the concatenated declaration text
 */
function concatDeclarations({ root }: { root: string }): string {
  const parts: string[] = [];
  const walk = ({ directory }: { directory: string }): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk({ directory: path });
      } else if (entry.name.endsWith(".d.ts")) {
        parts.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk({ directory: root });
  return parts.join("\n");
}

/**
 * Locate and read the installed `@slack/web-api` declaration files.
 *
 * Resolved through `createRequire` rather than a hard-coded `node_modules` path, because a worktree here
 * reaches its dependencies through a symlink and a Yarn install may hoist the package anywhere above it.
 *
 * @returns the declaration text and the installed version, or the reason it could not be read
 */
export function readInstalledTypings(): Result<SdkTypingsSource, AtlasCommandError> {
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve("@slack/web-api/package.json");
    const root = dirname(packagePath);
    const manifest: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
    const version =
      typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string"
        ? manifest.version
        : "unknown";
    const responseDirectory = join(root, "dist/types/response");
    const responseTexts = new Map<string, string>();
    for (const file of readdirSync(responseDirectory).filter((name) => name.endsWith(".d.ts"))) {
      responseTexts.set(file.replace(/\.d\.ts$/, ""), readFileSync(join(responseDirectory, file), "utf8"));
    }
    return ok({
      methodsText: readFileSync(join(root, "dist/methods.d.ts"), "utf8"),
      requestText: concatDeclarations({ root: join(root, "dist/types/request") }),
      responseTexts,
      version,
    });
  } catch (error: unknown) {
    return err(AtlasCommandErrors.sdkTypingsUnreadable({ cause: error }));
  }
}

/** The `/api/<method>` segment of a captured request URL. */
const API_PATH = /\/api\/([A-Za-z0-9._]+)/;

/**
 * One HAR entry, reduced to a captured call. Values are never read past the point of finding keys — see
 * `harObservations.ts`, which owns the redaction this feeds.
 *
 * @param entry one `log.entries[]` element, shape unverified
 * @returns the captured call, or `undefined` when the entry is not a Web API request
 */
function capturedCall({ entry }: { entry: unknown }): CapturedCall | undefined {
  if (!isRecord(entry) || !isRecord(entry["request"])) {
    return undefined;
  }
  const request = entry["request"];
  const url = typeof request["url"] === "string" ? request["url"] : "";
  const matched = API_PATH.exec(url);
  if (matched?.[1] === undefined) {
    return undefined;
  }
  const named = ({ list }: { list: unknown }): readonly string[] =>
    Array.isArray(list)
      ? list.flatMap((item) => (isRecord(item) && typeof item["name"] === "string" ? [item["name"]] : []))
      : [];
  const postData = isRecord(request["postData"]) ? request["postData"] : undefined;
  const response = isRecord(entry["response"]) ? entry["response"] : undefined;
  const content = response !== undefined && isRecord(response["content"]) ? response["content"] : undefined;
  const text = content !== undefined && typeof content["text"] === "string" ? content["text"] : "";
  let body: unknown;
  try {
    body = text.startsWith("{") ? JSON.parse(text) : undefined;
  } catch {
    // A truncated or binary body has no keys to read. Not a failure worth reporting.
    body = undefined;
  }
  return {
    body,
    name: matched[1],
    paramNames: [...named({ list: request["queryString"] }), ...named({ list: postData?.["params"] })],
  };
}

/**
 * Read a browser capture into captured calls.
 *
 * A capture of a real Slack session runs to nine figures of bytes, so this is one whole-file parse and the
 * caller may need `NODE_OPTIONS=--max-old-space-size=8192`. Streaming would be the alternative; it is not
 * worth the complexity for a command a human runs once per capture.
 *
 * @param path the `.har` file
 * @returns every Web API call in it, or the reason it could not be read
 */
export function readCapturedCalls({ path }: { path: string }): Result<readonly CapturedCall[], AtlasCommandError> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const log = isRecord(parsed) && isRecord(parsed["log"]) ? parsed["log"] : undefined;
    const entries = log !== undefined && Array.isArray(log["entries"]) ? log["entries"] : [];
    return ok(
      entries.flatMap((entry: unknown) => {
        const call = capturedCall({ entry });
        return call === undefined ? [] : [call];
      }),
    );
  } catch (error: unknown) {
    return err(AtlasCommandErrors.captureUnreadable({ cause: error, path }));
  }
}

/**
 * Regenerate the committed browser table from a capture, to stdout. Writes no file: the caller redirects,
 * so the change lands in a diff a human reads rather than in a file a verb silently replaced.
 *
 * @param calls the captured calls
 * @param methods the SDK rows, so `publicSurface` and `undocumentedParams` are measured against them
 * @returns the module source
 */
export function regenerateBrowserTable({
  calls,
  methods,
}: {
  calls: readonly CapturedCall[];
  methods: readonly SdkMethod[];
}): string {
  return renderBrowserModule({
    rows: observationsFromCalls({
      calls,
      sdkMethodNames: new Set(methods.map((method) => method.name)),
      sdkParamsByMethod: new Map(methods.map((method) => [method.name, new Set(method.params.map((p) => p.name))])),
    }),
  });
}

/**
 * Build the atlas from a typings source and the two committed tables.
 *
 * @param source the declaration text
 * @param nowIso when this generation was built
 * @returns the atlas
 */
export function assembleAtlas({ source, nowIso }: { source: SdkTypingsSource; nowIso: string }): SlackApiAtlas {
  return buildSlackApiAtlas({
    browser: BROWSER_OBSERVED_METHODS,
    builtAtIso: nowIso,
    docs: SLACK_API_METHODS,
    methods: extractSdkMethods({
      methodsText: source.methodsText,
      requestText: source.requestText,
      responseTexts: source.responseTexts,
    }),
    sdkVersion: source.version,
  });
}

/**
 * Emit whichever view the flags asked for.
 *
 * @param atlas the built atlas
 * @param options the resolved invocation
 * @param write where to send the document
 */
function emit({
  atlas,
  options,
  write,
}: {
  atlas: SlackApiAtlas;
  options: AtlasSlackApiOptions;
  write: (line: string) => void;
}): void {
  const views = options.method === undefined ? [] : findMethods({ atlas, term: options.method });
  const hits = options.field === undefined ? [] : findResponseField({ atlas, field: options.field });
  if (options.json) {
    write(JSON.stringify({ atlas, hits, views }, null, 2));
    return;
  }
  write(renderAtlasSlackApi({ atlas, hits, options, views }));
}

/**
 * Run the verb against injected dependencies.
 *
 * @param rest the argv tail after `atlas slack-api`
 * @param deps the injected edges
 * @returns the process exit code
 */
export function runAtlasSlackApi({ rest, deps }: { rest: readonly string[]; deps: AtlasSlackApiDeps }): number {
  const options = parseAtlasSlackApiArgs({ rest });
  if (options.isErr()) {
    for (const problem of atlasCommandErrorLines({ error: options.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(ATLAS_SLACK_API_USAGE);
    return EXIT_USAGE;
  }
  const source = deps.readTypings();
  if (source.isErr()) {
    for (const problem of atlasCommandErrorLines({ error: source.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic("run `yarn install` — this atlas is built from the installed SDK, never from a stored list");
    return EXIT_ERROR;
  }
  const atlas = assembleAtlas({ nowIso: deps.nowIso(), source: source.value });
  const { fromHar } = options.value;
  if (fromHar !== undefined) {
    const calls = deps.readHar({ path: fromHar });
    if (calls.isErr()) {
      for (const problem of atlasCommandErrorLines({ error: calls.error })) {
        deps.writeDiagnostic(problem);
      }
      return EXIT_ERROR;
    }
    // The count goes to STDERR so stdout is nothing but the module a caller redirects into the repo.
    deps.writeDiagnostic(`read ${String(calls.value.length)} Web API call(s) from the capture`);
    deps.writeOut(regenerateBrowserTable({ calls: calls.value, methods: atlas.methods }));
    return EXIT_OK;
  }
  emit({ atlas, options: options.value, write: deps.writeOut });
  return EXIT_OK;
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionAtlasSlackApiDeps(): AtlasSlackApiDeps {
  return {
    nowIso: () => new Date().toISOString(),
    readHar: readCapturedCalls,
    readTypings: readInstalledTypings,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver atlas slack-api` — what the Web API can be asked, and what it answers with. */
export const atlasSlackApiCommand = defineCommand({
  run: (argv) => runAtlasSlackApi({ deps: productionAtlasSlackApiDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
