/**
 * `slopweaver atlas slack-drive` — the effectful shell that fills the first driven-browser surface.
 *
 * Thin by design: the walk plan, the projection, the match, the disagreement comparison and every line of
 * output are pure (`atlas/slackApi/*`), and this file only reads the installed `@slack/web-api` declaration
 * files, reads a walk document, and writes a generation.
 *
 * ## It opens no browser, and that is the ruling rather than a limitation of this file
 *
 * The rule (`docs/browser-route.md`): the owner's real work Chrome is the only browser anything here
 * uses, and no verb launches one. So `plan` prints the BRIEF — which navigation surfaces to walk and what to
 * record on each — the visible session walks them in the owner's own Chrome, and `sync` publishes from the document
 * it hands back. It is a READ walk: every step is a navigation or a capture, through the `slopweaver
 * browser` verbs.
 *
 * ## What `sync` actually does, in order
 *
 * Read the installed SDK typings (the `api` surface) → read the walk document (the `browser` surface) →
 * match the two byte-exactly on the dotted method name → merge onto whatever is already stored → publish
 * one generation and print where they disagree.
 *
 * `report` re-reads the published generation and prints the same comparison, so the finding outlives the
 * session that found it.
 *
 * ## `refresh` is the half a scheduled pass can run, and it is the descriptor's `resyncCommand`
 *
 * A walk document cannot be supplied by `automation run-due` — only a visible session's walk produces one — so
 * a resync row pointed at `sync` failed on every firing. `refresh` is the same
 * two-phase shape `atlas graphql-hive refresh` and `atlas workos refresh` already have: publish what needs no
 * browser (the `api` surface, read from the installed typings, folded onto whatever the last walk left in the
 * `method` kind), which MOVES the generation clock `live/resync/outcome.ts` judges, then print the brief
 * `plan` prints so the seated session knows the walk it still owes. The `page` kind is left untouched — both
 * of its halves are the walk's (`assembleSlackApiGeneration` says why).
 *
 * Data to STDOUT, diagnostics to STDERR, so `--json` stays pristine for `… | jq`.
 */

import { readFileSync } from "node:fs";

import { assembleSlackApiGeneration, type SlackAtlasApiGeneration } from "../../../atlas/slackApi/atlasApiSync.js";
import type { SlackArtifactRef } from "../../../atlas/slackApi/atlasModel.js";
import {
  publishSlackAtlas,
  readSlackAtlas,
  readSlackAtlasKindFile,
  readSlackAtlasManifest,
  type SlackAtlasPaths,
  slackAtlasPaths,
} from "../../../atlas/slackApi/atlasStore.js";
import { assembleSlackGeneration, type SlackAtlasGeneration } from "../../../atlas/slackApi/atlasSync.js";
import {
  compareSurfaces,
  type SurfaceComparison,
  summariseDisagreements,
} from "../../../atlas/slackApi/disagreement.js";
import { type DrivenSession, parseDrivenSession } from "../../../atlas/slackApi/drivenSession.js";
import type { SdkMethod } from "../../../atlas/slackApi/model.js";
import { extractSdkMethods } from "../../../atlas/slackApi/sdkTypings.js";
import {
  SLACK_SURFACE_PAGES,
  type SlackSurfaceRoots,
  workspaceRootsFromStructures,
} from "../../../atlas/slackApi/surfacePages.js";
import { renderBrief } from "../../../browser/brief.js";
import { readStructureRows } from "../../../corpus/structures/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type AtlasCommandError, AtlasCommandErrors, atlasCommandErrorLines } from "./errors.js";
import { readInstalledTypings, type SdkTypingsSource } from "./slackApiRun.js";
import {
  type AtlasSlackDriveOptions,
  parseAtlasSlackDriveArgs,
  renderDeclaredSurfaces,
  renderDriveReport,
  slackWalkBrief,
} from "./slackDriveCore.js";
import { storeSlackScreenshots } from "./slackDriveScreenshots.js";
import { ATLAS_SLACK_DRIVE_USAGE } from "./slackUsage.js";

/** The argv index the `atlas <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the shell is testable with plain fakes and no browser. */
export interface AtlasSlackDriveDeps {
  readonly readTypings: () => Result<SdkTypingsSource, AtlasCommandError>;
  readonly readSession: (args: { path: string }) => Result<string, AtlasCommandError>;
  /**
   * The workspace's own origin, read from the local structure store — `null` when nothing has captured it.
   *
   * An edge rather than a constant because it is the organisation's own subdomain, which this repository
   * may not carry: it is resolved from a file under `$SLOPWEAVER_HOME` and never written down here.
   */
  readonly readWorkspaceRoots: (args: {
    home: string;
  }) => { readonly workspaceOrigin: string; readonly teamId: string } | null;
  readonly nowIso: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The methods the installed SDK declares, extracted from its declaration text.
 *
 * @param source the declaration text and the version it came from
 * @returns the method rows
 */
function methodsFrom({ source }: { source: SdkTypingsSource }): readonly SdkMethod[] {
  return extractSdkMethods({
    methodsText: source.methodsText,
    requestText: source.requestText,
    responseTexts: source.responseTexts,
  });
}

/**
 * Assemble and publish one generation from a completed walk.
 *
 * @param paths the resolved atlas paths
 * @param methods every method the installed SDK declares
 * @param session what the driven browser saw
 * @param sdkVersion the installed `@slack/web-api` version
 * @param at this run's ISO timestamp
 * @param dryRun whether to compare without writing anything
 * @returns the generation, or every reason it could not be assembled or published
 */
function publishGeneration({
  paths,
  methods,
  session,
  screenshots,
  roots,
  sdkVersion,
  at,
  dryRun,
}: {
  paths: SlackAtlasPaths;
  methods: readonly SdkMethod[];
  session: DrivenSession;
  screenshots: ReadonlyMap<string, SlackArtifactRef>;
  roots: SlackSurfaceRoots;
  sdkVersion: string;
  at: string;
  dryRun: boolean;
}): Result<SlackAtlasGeneration> {
  const snapshot = readSlackAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const generation = assembleSlackGeneration({
    at,
    methods,
    roots,
    screenshots,
    sdkVersion,
    session,
    stored: snapshot.value.files,
  });
  if (generation.isErr()) {
    return err(generation.error);
  }
  if (dryRun) {
    return ok(generation.value);
  }
  const prior = readSlackAtlasManifest({ paths });
  if (prior.isErr()) {
    return err(prior.error);
  }
  const published = publishSlackAtlas({
    files: generation.value.files,
    manifest: generation.value.manifest,
    derivedFrom: prior.value,
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok(generation.value);
}

/**
 * Emit whichever view the flags asked for.
 *
 * @param comparisons what both surfaces said about each method
 * @param options the resolved invocation
 * @param write where to send the document
 */
function emit({
  comparisons,
  options,
  write,
}: {
  comparisons: readonly SurfaceComparison[];
  options: AtlasSlackDriveOptions;
  write: (line: string) => void;
}): void {
  const summary = summariseDisagreements({ comparisons });
  if (options.json) {
    write(JSON.stringify({ comparisons, summary }, null, 2));
    return;
  }
  write(renderDriveReport({ comparisons, summary }));
}

/**
 * Read the published generation and report the comparison, touching no browser.
 *
 * @param paths the resolved atlas paths
 * @param options the resolved invocation
 * @param deps the injected edges
 * @returns the process exit code
 */
function runReport({
  paths,
  options,
  deps,
}: {
  paths: SlackAtlasPaths;
  options: AtlasSlackDriveOptions;
  deps: AtlasSlackDriveDeps;
}): number {
  const snapshot = readSlackAtlas({ paths });
  if (snapshot.isErr()) {
    for (const problem of snapshot.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const method = snapshot.value.files.method;
  if (method === null || method.entities.length === 0) {
    deps.writeDiagnostic("no Slack atlas generation is published yet — run `slopweaver atlas slack-drive plan` first");
    return EXIT_ERROR;
  }
  emit({ comparisons: compareSurfaces({ entities: method.entities }), options, write: deps.writeOut });
  return EXIT_OK;
}

/**
 * Run the verb against injected dependencies.
 *
 * @param rest the argv tail after `atlas slack-drive`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runAtlasSlackDrive({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AtlasSlackDriveDeps;
}): Promise<number> {
  const parsed = parseAtlasSlackDriveArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of atlasCommandErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(ATLAS_SLACK_DRIVE_USAGE);
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  const paths = slackAtlasPaths({ home });
  if (options.verb === "plan") {
    return runPlan({ deps, home });
  }
  if (options.verb === "report") {
    return runReport({ deps, options, paths });
  }
  if (options.verb === "refresh") {
    return runRefresh({ deps, home, options, paths });
  }
  return runSync({ deps, home, options, paths });
}

/**
 * Print the brief.
 *
 * It records nothing: a READ walk needs no permission of its own, because the `slopweaver browser` verbs
 * that carry it out judge every action against the live page.
 *
 * @param deps the injected edges
 * @param home the state home the workspace roots are resolved from
 * @returns `EXIT_OK` — saying what to walk IS this sub-verb's whole job
 */
function runPlan({ deps, home }: { deps: AtlasSlackDriveDeps; home: string }): number {
  const roots = deps.readWorkspaceRoots({ home });
  const workspaceOrigin = roots === null ? null : roots.workspaceOrigin;
  for (const line of renderBrief({ brief: slackWalkBrief({ workspaceOrigin }) })) {
    deps.writeOut(line);
  }
  for (const line of renderDeclaredSurfaces({ pages: SLACK_SURFACE_PAGES })) {
    deps.writeOut(line);
  }
  deps.writeOut("this is a READ walk — every step above is a navigation or a capture");
  deps.writeOut(
    "Slack is read-before-write, so a click or a keystroke on a page you have just read would be ALLOWED — do not take one",
  );
  if (workspaceOrigin === null) {
    deps.writeDiagnostic(
      "no Slack `org` structure row carries a workspace URL, so the settings and apps pages are NOT in the" +
        " brief and cannot be walked — run `slopweaver refresh --source slack` first, or they stay declared gaps",
    );
  }
  return EXIT_OK;
}

/**
 * Read the SDK and the walk document, publish the generation and print the comparison.
 *
 * @param paths the resolved atlas paths
 * @param options the resolved invocation
 * @param deps the injected edges
 * @returns the process exit code
 */
function runSync({
  paths,
  options,
  deps,
  home,
}: {
  paths: SlackAtlasPaths;
  options: AtlasSlackDriveOptions;
  deps: AtlasSlackDriveDeps;
  home: string;
}): number {
  const inputs = syncInputs({ deps, home, options, paths });
  if (inputs.isErr()) {
    for (const problem of atlasCommandErrorLines({ error: inputs.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  for (const line of inputs.value.refusals) {
    deps.writeDiagnostic(line);
  }
  const generation = publishGeneration({
    at: deps.nowIso(),
    dryRun: options.dryRun,
    methods: methodsFrom({ source: inputs.value.source }),
    paths,
    roots: inputs.value.roots,
    screenshots: inputs.value.screenshots,
    sdkVersion: inputs.value.source.version,
    session: inputs.value.session,
  });
  if (generation.isErr()) {
    for (const problem of generation.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  deps.writeDiagnostic(
    options.dryRun ? "--dry-run: nothing was written" : `published a generation under ${paths.directory}`,
  );
  emit({ comparisons: generation.value.comparisons, options, write: deps.writeOut });
  return EXIT_OK;
}

/**
 * Assemble and publish the API-only generation — the `method` kind, the `page` kind left as the last walk
 * published it.
 *
 * @param paths the resolved atlas paths
 * @param methods every method the installed SDK declares
 * @param sdkVersion the installed `@slack/web-api` version
 * @param at this run's ISO timestamp
 * @param dryRun whether to compare without writing anything
 * @returns the generation, or every reason it could not be assembled or published
 */
function publishApiGeneration({
  paths,
  methods,
  sdkVersion,
  at,
  dryRun,
}: {
  paths: SlackAtlasPaths;
  methods: readonly SdkMethod[];
  sdkVersion: string;
  at: string;
  dryRun: boolean;
}): Result<SlackAtlasApiGeneration> {
  const stored = readSlackAtlasKindFile({ kind: "method", paths });
  if (stored.isErr()) {
    return err(stored.error);
  }
  const prior = readSlackAtlasManifest({ paths });
  if (prior.isErr()) {
    return err(prior.error);
  }
  const generation = assembleSlackApiGeneration({
    at,
    methods,
    priorManifest: prior.value,
    sdkVersion,
    stored: stored.value,
  });
  if (generation.isErr()) {
    return err(generation.error);
  }
  if (dryRun) {
    return ok(generation.value);
  }
  const published = publishSlackAtlas({
    derivedFrom: prior.value,
    files: generation.value.files,
    manifest: generation.value.manifest,
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok(generation.value);
}

/**
 * Publish the API surface unattended, print the comparison, then brief the walk still owed.
 *
 * The publish comes first and a failure there prints no brief, for the reason `graphqlHiveAtlas/refreshRun.ts`
 * gives: the cheap half failing is worth knowing before anyone drives the owner's browser. The brief and its
 * brief is exactly `plan`'s — one function, so the two cannot drift.
 *
 * @param paths the resolved atlas paths
 * @param options the resolved invocation
 * @param deps the injected edges
 * @param home the state home the workspace roots are resolved from
 * @returns the process exit code
 */
function runRefresh({
  paths,
  options,
  deps,
  home,
}: {
  paths: SlackAtlasPaths;
  options: AtlasSlackDriveOptions;
  deps: AtlasSlackDriveDeps;
  home: string;
}): number {
  const source = deps.readTypings();
  if (source.isErr()) {
    for (const problem of atlasCommandErrorLines({ error: source.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic("run `yarn install` — the API surface is read from the installed SDK, never a stored list");
    deps.writeDiagnostic("the API surface could not be published, so no walk was briefed");
    return EXIT_ERROR;
  }
  const generation = publishApiGeneration({
    at: deps.nowIso(),
    dryRun: options.dryRun,
    methods: methodsFrom({ source: source.value }),
    paths,
    sdkVersion: source.value.version,
  });
  if (generation.isErr()) {
    for (const problem of generation.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic("the API surface could not be published, so no walk was briefed");
    return EXIT_ERROR;
  }
  deps.writeDiagnostic(
    options.dryRun
      ? "--dry-run: nothing was written"
      : `published the API surface under ${paths.directory}; the page kind stands as the last walk left it`,
  );
  emit({ comparisons: generation.value.comparisons, options, write: deps.writeOut });
  return runPlan({ deps, home });
}

/** Everything `sync` needs before it may assemble anything, gathered in one fallible step. */
interface SyncInputs {
  readonly source: SdkTypingsSource;
  readonly session: DrivenSession;
  readonly roots: SlackSurfaceRoots;
  readonly screenshots: ReadonlyMap<string, SlackArtifactRef>;
  /** Pictures the walk took that the surface map or the render check refused — reported, never swallowed. */
  readonly refusals: readonly string[];
}

/**
 * Read the SDK, the walk document and the workspace roots, and store what the walk photographed.
 *
 * Four reads that must all succeed before a generation may be assembled, so they are gathered here and the
 * verb above stays a straight line. Each failure carries its own remedy rather than a bare code.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @param paths the resolved atlas paths, whose directory the artifacts are written under
 * @param home the state home the workspace roots are resolved from
 * @returns everything the assembly needs, or every reason it cannot proceed
 */
function syncInputs({
  deps,
  options,
  paths,
  home,
}: {
  deps: AtlasSlackDriveDeps;
  options: AtlasSlackDriveOptions;
  paths: SlackAtlasPaths;
  home: string;
}): Result<SyncInputs, AtlasCommandError> {
  const source = deps.readTypings();
  if (source.isErr()) {
    return err(AtlasCommandErrors.sdkTypingsUnavailable({ problems: atlasCommandErrorLines({ error: source.error }) }));
  }
  // `sync` needs the walk document it publishes from; the parser refuses `sync` without `--session`, and this
  // read refuses it again rather than reading stdin in its place.
  if (options.session === undefined) {
    return err(AtlasCommandErrors.slackDriveSessionMisused());
  }
  const driven = readWalkDocument({ deps, path: options.session });
  if (driven.isErr()) {
    return err(AtlasCommandErrors.walkDocumentInvalid({ problems: driven.error }));
  }
  const workspace = deps.readWorkspaceRoots({ home });
  if (workspace === null) {
    return err(AtlasCommandErrors.slackWorkspaceUndeclared());
  }
  const screenshots = storeSlackScreenshots({ directory: paths.directory, session: driven.value });
  if (screenshots.isErr()) {
    return err(screenshots.error);
  }
  return ok({
    refusals: screenshots.value.refusals,
    roots: { ...workspace, clientWorkspaceId: driven.value.workspaceId },
    screenshots: screenshots.value.stored,
    session: driven.value,
    source: source.value,
  });
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionAtlasSlackDriveDeps(): AtlasSlackDriveDeps {
  return {
    nowIso: () => new Date().toISOString(),
    readSession: ({ path }) => {
      try {
        return ok(readFileSync(path === "-" ? 0 : path, "utf8"));
      } catch (cause: unknown) {
        return err(AtlasCommandErrors.walkDocumentUnreadable({ cause, path }));
      }
    },
    readTypings: readInstalledTypings,
    readWorkspaceRoots: ({ home }) =>
      workspaceRootsFromStructures({ rows: readStructureRows({ home, source: "slack" }).rows }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Read and validate the walk document.
 *
 * @param path the document, or `-` for stdin
 * @param deps the injected edges
 * @returns the session, or every reason it is not one
 */
function readWalkDocument({ path, deps }: { path: string; deps: AtlasSlackDriveDeps }): Result<DrivenSession> {
  const text = deps.readSession({ path });
  if (text.isErr()) {
    return err(atlasCommandErrorLines({ error: text.error }));
  }
  return parseDrivenSession({ json: text.value, source: path });
}

/** `slopweaver atlas slack-drive` — the driven-browser surface, and where it disagrees with the API. */
export const atlasSlackDriveCommand = defineCommand({
  run: (argv) => runAtlasSlackDrive({ deps: productionAtlasSlackDriveDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
