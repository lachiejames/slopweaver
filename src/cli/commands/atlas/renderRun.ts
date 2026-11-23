/**
 * `slopweaver atlas <platform> page` — the effectful shell.
 *
 * Thin by design: the projection is `atlas/kit/pageModel.ts` and the rendering is `atlas/kit/pageHtml.ts`,
 * both pure. What is here is resolving a platform through the registry, reading the screenshot bytes the
 * page embeds, and writing the result — and, deliberately, **no network call at all.** An atlas is what a
 * sync already stored, so a page that could reach a provider would be showing something the atlas does not
 * hold, which is the exact confusion it exists to end.
 *
 * The screenshot budget is spent smallest-first. That is not a display preference: a budget spent
 * largest-first embeds one picture and lists seventeen, while the same bytes spent smallest-first embed
 * most of them — and the page states both figures either way, so the choice bounds the page without ever
 * bounding what it claims.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { renderAtlasPageBody, renderAtlasPageDocument } from "../../../atlas/kit/pageHtml.js";
import { type AtlasPageModel, type AtlasPageScreenshot, atlasPageModel } from "../../../atlas/kit/pageModel.js";
import type { AtlasPageEmbeddedShot } from "../../../atlas/kit/pageScreenshotSection.js";
import type { AtlasReadSnapshot } from "../../../atlas/kit/read.js";
import { atlasPathsFor } from "../../../atlas/platformPaths.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { logger } from "../../../lib/logger.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolvePlatformSnapshot } from "./platformResolve.js";
import { ATLAS_RENDER_USAGE, type AtlasRenderOptions, parseAtlasRenderArgs } from "./renderCore.js";

/** The argv index the platform sits at — past the runtime, the script and the `atlas` noun. */
const PLATFORM_ARG_INDEX = 3;

/** Where the flag tail starts: past the runtime, the script, the noun, the platform and the verb. */
const VERB_ARG_OFFSET = 5;

/** The injected edges, so the shell is testable with plain fakes and no filesystem. */
export interface AtlasRenderDeps {
  readonly platforms: typeof atlasPlatforms;
  readonly find: typeof findAtlasPlatform;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** Reads one stored artifact's bytes, or `null` when they cannot be read. */
  readonly readArtifact: (input: { path: string }) => Uint8Array | null;
  /** Writes the page. Injected so a test proves the bytes without owning a directory. */
  readonly writePage: (input: { path: string; contents: string }) => boolean;
  readonly now: () => string;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, reading and writing the machine's own filesystem
 * @internal
 */
export function productionAtlasRenderDeps(): AtlasRenderDeps {
  return {
    find: findAtlasPlatform,
    now: () => new Date().toISOString(),
    platforms: atlasPlatforms,
    readArtifact: ({ path }) => {
      try {
        return new Uint8Array(readFileSync(path));
      } catch {
        return null;
      }
    },
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
    writePage: ({ path, contents }) => {
      try {
        writeFileAtomic({ contents, path });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Resolve one artifact's stored relative path, refusing anything that escapes the generation directory.
 *
 * `atlasArtifactRefSchema` constrains `relativePath` to a non-empty string and nothing else, so a corrupt
 * or hostile generation could name `../../secrets.json` and have its bytes base64-embedded into a page that
 * is then published for somebody else to open. A pre-mortem named it. The check is on
 * the RESOLVED path rather than on the string, so `a/../../b` is refused too.
 *
 * @param directory the atlas's own generation directory
 * @param relativePath the path the stored artifact reference carries
 * @returns the absolute path to read, or `null` when it would leave the directory
 */
export function confinedArtifactPath({
  directory,
  relativePath,
}: {
  directory: string;
  relativePath: string;
}): string | null {
  if (isAbsolute(relativePath)) {
    return null;
  }
  const root = resolve(directory);
  const candidate = resolve(join(root, relativePath));
  const inside = relative(root, candidate);
  if (inside === "" || inside.startsWith("..")) {
    return null;
  }
  return candidate;
}

/**
 * Read as many screenshots as the byte budget allows, smallest first, verifying each against its own digest.
 *
 * Three things are checked before a picture reaches the page, and each was a way the page could have lied.
 * The path must stay inside the generation directory. The bytes must be the length the reference claims.
 * And their SHA-256 must be the digest the reference carries — the whole value of a stored proof screenshot
 * is that a reader can trust the bytes are the ones that were seen, so embedding a file that has since
 * changed, under its old digest, would be worse than embedding nothing.
 *
 * A shot that fails any of the three is REPORTED rather than skipped, because "held on disk" and "gone" are
 * different facts and the page must not print the first when the second is true. That was a Codex
 * pre-mortem finding, and the first cut of this function did exactly that.
 *
 * @param screenshots every screenshot the atlas holds, already ordered smallest first by the model
 * @param directory the atlas's own generation directory, which every relative path hangs off
 * @param budgetBytes how many bytes of encoded text the embeds may cost
 * @param readArtifact reads one file's bytes
 * @returns one outcome per screenshot, in the order they were considered
 */
export function readEmbeddedShots({
  screenshots,
  directory,
  budgetBytes,
  readArtifact,
}: {
  screenshots: readonly AtlasPageScreenshot[];
  directory: string | null;
  budgetBytes: number;
  readArtifact: AtlasRenderDeps["readArtifact"];
}): readonly AtlasPageEmbeddedShot[] {
  const outcomes: AtlasPageEmbeddedShot[] = [];
  let spent = 0;
  let overBudget = false;
  for (const shot of screenshots) {
    const outcome = readOneShot({ budgetBytes, directory, overBudget, readArtifact, shot, spent });
    outcomes.push(outcome.embed);
    spent += outcome.cost;
    overBudget = overBudget || outcome.overBudget;
  }
  return outcomes;
}

/**
 * Read one screenshot, and say what it cost.
 *
 * `overBudget` latches rather than being retested per shot: the model orders screenshots smallest first and
 * base64 length is monotonic in byte length, so once one verified shot does not fit, no later one can.
 *
 * @param shot the screenshot to consider
 * @param directory the atlas's generation directory, or `null` when it could not be resolved
 * @param budgetBytes the whole embed budget
 * @param spent how much of it earlier shots have already taken
 * @param overBudget whether a previous shot has already exhausted it
 * @param readArtifact reads one file's bytes
 * @returns the outcome to render, what it cost, and whether the budget is now exhausted
 */
function readOneShot({
  shot,
  directory,
  budgetBytes,
  spent,
  overBudget,
  readArtifact,
}: {
  shot: AtlasPageScreenshot;
  directory: string | null;
  budgetBytes: number;
  spent: number;
  overBudget: boolean;
  readArtifact: AtlasRenderDeps["readArtifact"];
}): { readonly embed: AtlasPageEmbeddedShot; readonly cost: number; readonly overBudget: boolean } {
  const held = { cost: 0, embed: { dataUri: null, sha256: shot.sha256, status: "budget-held" as const }, overBudget };
  if (directory === null || budgetBytes === 0 || overBudget) {
    return held;
  }
  const path = confinedArtifactPath({ directory, relativePath: shot.relativePath });
  if (path === null) {
    return { cost: 0, embed: { dataUri: null, sha256: shot.sha256, status: "path-refused" }, overBudget };
  }
  const bytes = readArtifact({ path });
  if (bytes === null) {
    return { cost: 0, embed: { dataUri: null, sha256: shot.sha256, status: "unreadable" }, overBudget };
  }
  const buffer = Buffer.from(bytes);
  const digest = createHash("sha256").update(buffer).digest("hex");
  if (buffer.byteLength !== shot.byteLength || digest !== shot.sha256) {
    return { cost: 0, embed: { dataUri: null, sha256: shot.sha256, status: "integrity-failed" }, overBudget };
  }
  const encoded = buffer.toString("base64");
  if (spent + encoded.length > budgetBytes) {
    return { ...held, overBudget: true };
  }
  return {
    cost: encoded.length,
    embed: { dataUri: `data:${shot.mediaType};base64,${encoded}`, sha256: shot.sha256, status: "embedded" },
    overBudget,
  };
}

/**
 * Render the page in whichever form the invocation asked for.
 *
 * @param model the projection
 * @param embedded the screenshots that fitted the budget
 * @param options the parsed invocation, whose `fragment` decides the form
 * @param renderedAt when this render happened
 * @returns the page text
 */
function renderFor({
  model,
  embedded,
  options,
  renderedAt,
}: {
  model: AtlasPageModel;
  embedded: readonly AtlasPageEmbeddedShot[];
  options: AtlasRenderOptions;
  renderedAt: string;
}): string {
  if (options.fragment) {
    return renderAtlasPageBody({ embedded, model, renderedAt });
  }
  return renderAtlasPageDocument({ embedded, model, renderedAt });
}

/**
 * Emit the page, to a file when one was named and to stdout when it was not.
 *
 * @param page the rendered page text
 * @param options the parsed invocation
 * @param deps the injected edges
 * @returns the process exit code
 */
function emit({ page, options, deps }: { page: string; options: AtlasRenderOptions; deps: AtlasRenderDeps }): number {
  const out = options.out;
  if (out === undefined) {
    deps.writeOut(page);
    return EXIT_OK;
  }
  if (!deps.writePage({ contents: page, path: out })) {
    deps.writeDiagnostic(`could not write the page to ${out}`);
    return EXIT_ERROR;
  }
  deps.writeDiagnostic(`wrote ${String(page.length)} bytes to ${out}`);
  return EXIT_OK;
}

/**
 * Run the verb.
 *
 * @param deps the injected edges
 * @param platform the atlas being rendered, bound from argv rather than parsed as a flag
 * @param rest the argv tail after `atlas <platform> render`
 * @returns the process exit code
 *
 * @internal
 */
export async function runAtlasRender({
  deps,
  platform,
  rest,
}: {
  deps: AtlasRenderDeps;
  platform: string | undefined;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(ATLAS_RENDER_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAtlasRenderArgs({ rest });
  if (parsed.isErr()) {
    for (const line of parsed.error) {
      deps.writeDiagnostic(line);
    }
    deps.writeDiagnostic(ATLAS_RENDER_USAGE);
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const resolved = await resolvePlatformSnapshot({
    find: deps.find,
    home: options.home,
    platform,
    platforms: deps.platforms,
  });
  if (resolved.isErr()) {
    deps.writeDiagnostic(resolved.error.error.message);
    return resolved.error.exitCode;
  }
  const model = atlasPageModel({
    neverHitCap: options.neverHitCap,
    rowCap: options.maxRows,
    snapshot: resolved.value,
  });
  if (options.json) {
    deps.writeOut(JSON.stringify(model));
    return EXIT_OK;
  }
  const paths = atlasPathsFor({ home: options.home, platform: model.platform });
  const directory = paths === null ? null : paths.root;
  const page = renderWithinBudget({
    deps,
    directory,
    options,
    renderedAt: deps.now(),
    snapshot: resolved.value,
  });
  if (page.shedTo !== null) {
    deps.writeDiagnostic(
      `the page did not fit ${String(options.maxPageBytes)} bytes at ${String(options.maxRows)} rows per kind, ` +
        `so it was rendered at ${String(page.shedTo)} — the page says so, and every count on it is still whole`,
    );
  }
  return emit({ deps, options, page: page.text });
}

/** How many times the row cap may be halved before the render gives up shedding. */
const SHED_ATTEMPTS = 6;

/**
 * Render the page, shedding printed ROWS until the whole thing fits the byte ceiling.
 *
 * The ceiling exists because a page that renders at 20 MB cannot be published as an artifact at all, and the
 * screenshot budget alone is not an output budget — a pre-mortem named exactly that.
 * Screenshots are spent from whatever the text leaves rather than from a fixed figure, and when even the
 * text does not fit, EVERY printed list is halved and the model rebuilt — rows, gaps and never-hit rows
 * alike. Halving only the rows was not enough: MEASURED, one generation held tens of thousands of
 * open gaps, over 10 MB of them, so a page shed to three rows a kind still came back near 10 MB.
 *
 * **Only printed rows are ever shed. Every COUNT on the page is the whole figure**, and each table already
 * states "showing X of Y", so a shed page under-prints and never under-claims.
 *
 * @param snapshot the atlas as the registry read it
 * @param directory the atlas's generation directory, for the screenshots
 * @param options the parsed invocation, carrying every cap
 * @param deps the injected edges
 * @param renderedAt when this render happened
 * @returns the page text, and the row cap it settled on when it had to shed
 */
function renderWithinBudget({
  snapshot,
  directory,
  options,
  deps,
  renderedAt,
}: {
  snapshot: AtlasReadSnapshot;
  directory: string | null;
  options: AtlasRenderOptions;
  deps: AtlasRenderDeps;
  renderedAt: string;
}): { readonly text: string; readonly shedTo: number | null } {
  let rowCap = options.maxRows;
  let gapCap = options.maxRows * 2;
  let neverHitCap = options.neverHitCap;
  let text = "";
  for (let attempt = 0; attempt < SHED_ATTEMPTS; attempt += 1) {
    const model = atlasPageModel({ gapCap, neverHitCap, rowCap, snapshot });
    const textOnly = renderFor({ embedded: [], model, options, renderedAt });
    const spare = options.maxPageBytes - Buffer.byteLength(textOnly, "utf8");
    const embedded = readEmbeddedShots({
      budgetBytes: Math.max(0, Math.min(options.screenshotBudgetBytes, spare)),
      directory,
      readArtifact: deps.readArtifact,
      screenshots: model.screenshots,
    });
    text = renderFor({ embedded, model, options, renderedAt });
    if (Buffer.byteLength(text, "utf8") <= options.maxPageBytes || rowCap === 0) {
      return { shedTo: rowCap === options.maxRows ? null : rowCap, text };
    }
    rowCap = Math.floor(rowCap / 2);
    gapCap = Math.floor(gapCap / 2);
    neverHitCap = Math.floor(neverHitCap / 2);
  }
  return { shedTo: rowCap, text };
}

export const atlasRenderCommand = defineCommand({
  run: (argv) =>
    runAtlasRender({
      deps: productionAtlasRenderDeps(),
      platform: argv[PLATFORM_ARG_INDEX],
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
