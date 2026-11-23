/**
 * The parts of a `walk` VERB that are the same whichever platform is being walked.
 *
 * `docs/browser-route/proof-and-capture-verbs.md` fixes the shape: with no `--observation` a walk verb prints
 * a BRIEF, and with one it judges the document a visible session handed back. Nothing here opens a browser —
 * nothing this repository starts may (`docs/browser-route.md`). A brief records nothing: the walk it
 * describes runs through the `slopweaver browser` verbs, which judge every action against the live page.
 *
 * Two pieces of that are platform-independent and had been written twice, once by the GraphQL Hive
 * atlas's walk verb and once, by copying it, by the WorkOS atlas's: reading the declared addresses back out
 * of the published `page` kind, and digesting and storing the screenshots a document names. Same family as
 * `kit/projection.ts` and `kit/withheld.ts`, same argument.
 *
 * ## The screenshot is digested from the BYTES, not trusted from the document
 *
 * A document names a local path; the digest is computed from what this process actually read, and the
 * artifact is stored under that digest through the kit's verified writer, which reads it back before the
 * atlas claims to hold it. So the picture the atlas holds is provably the picture on disk rather than one
 * the document asserted — the property a screenshot-as-proof needs to be worth anything.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unsetFieldAsNull } from "#lib/absent.js";
import { type ExtensionBrief, renderBrief } from "../../browser/brief.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../cli/exitCodes.js";
import { flagValue, parseFlagTail, resolveHome, verbTail } from "../../cli/optionParsers.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import { verifiedArtifactWriter } from "./artifactWriter.js";
import { isUnrenderedScreenshot, UNRENDERED_SCREENSHOT_BECAUSE } from "./browserWalk.js";
import { type AtlasCaptureError, AtlasCaptureErrors, atlasCaptureErrorLines } from "./captureErrors.js";
import { type AtlasReadError, AtlasReadErrors, type AtlasReadSnapshot } from "./read.js";
import type { AtlasPageScreenshotRef, AtlasWalkCounts, AtlasWalkedPage } from "./walkSurface.js";

/** One declared page a brief will name. */
export interface AtlasDeclaredPage {
  readonly providerId: string;
  readonly url: string;
  readonly purpose: string;
}

/**
 * Read the declared addresses the API channel published, out of an already-read snapshot's `page` kind.
 *
 * A page with no deep link on any channel is skipped rather than briefed: an address is the ONE thing a
 * walk step cannot do without, and briefing a step with nothing to open would produce a document entry
 * about a page nobody could have visited.
 *
 * A snapshot with no `page` kind at all is REFUSED, never read as zero pages. A walked atlas builds its kinds
 * from its own declared registry, fresh home or not, and that registry declares `page` — so its absence means
 * the registry stopped declaring it, and reading that as "nothing declared yet" would brief nothing and
 * report success.
 *
 * @param snapshot the platform's read snapshot
 * @param fallbackPurpose what to say about a page whose detail carries no purpose of its own
 * @returns every declared page carrying an address, in the order the generation holds them, or the refusal
 *   naming every kind the snapshot does declare when `page` is not among them
 */
export function declaredPagesFrom({
  snapshot,
  fallbackPurpose,
}: {
  snapshot: AtlasReadSnapshot;
  fallbackPurpose: string;
}): Result<readonly AtlasDeclaredPage[], AtlasReadError> {
  const kind = snapshot.kinds.find((declared) => declared.kind === "page");
  if (kind === undefined) {
    return err(
      AtlasReadErrors.kindUnknown({
        kind: "page",
        known: snapshot.kinds.map((declared) => declared.kind),
        platform: snapshot.generation.platform,
      }),
    );
  }
  return ok(
    kind.entities.flatMap((page): readonly AtlasDeclaredPage[] => {
      const linked = page.observations.find((observation) => observation.deepLink !== null);
      const url = unsetFieldAsNull({ key: "deepLink", record: linked });
      if (url === null) {
        return [];
      }
      return [{ providerId: page.providerId, purpose: purposeOf({ detail: page.detail, fallbackPurpose }), url }];
    }),
  );
}

/**
 * One declared page's stated purpose, as the API channel wrote it.
 *
 * Read off the channel's opaque detail rather than a typed field, because the detail shape is the
 * platform's and this module deliberately holds none of them.
 *
 * @param detail the entity view's own detail
 * @param fallbackPurpose what to say when the detail carries no usable purpose
 * @returns the purpose to print in the brief
 *
 * @internal
 */
export function purposeOf({ detail, fallbackPurpose }: { detail: unknown; fallbackPurpose: string }): string {
  if (typeof detail !== "object" || detail === null || !("purpose" in detail)) {
    return fallbackPurpose;
  }
  const purpose = detail.purpose;
  return typeof purpose === "string" && purpose.length > 0 ? purpose : fallbackPurpose;
}

/**
 * Copy every screenshot a document names into the generation, addressed by its own digest.
 *
 * ## A named PNG is still graded before it is credited
 *
 * This route does not drive the browser itself — a visible session photographed the page and the document
 * names the file — so there is nothing here to re-take a loading frame with, which is exactly why the grade
 * matters more rather than less. A shot the session took without looking at it reaches this function as a
 * perfectly readable PNG of a spinner, and storing it would publish `photographed` for a page nobody can
 * see. It is skipped and NAMED instead, so the page falls to `reached but not photographed` and the walk's
 * coverage decision (`walkSurface.ts`) refuses to call itself `synced`.
 *
 * @param directory the atlas's own root, which every artifact path is relative to
 * @param pages the walked pages, each possibly naming a local PNG
 * @param artifactPath how this atlas names a page artifact from its digest
 * @returns one artifact per photographed page and the pages whose picture never rendered, or why a file
 *   could not be read or written
 *
 * @internal
 */
export function storeWalkScreenshots({
  directory,
  pages,
  artifactPath,
}: {
  directory: string;
  pages: readonly AtlasWalkedPage[];
  artifactPath: (args: { sha256: string }) => string;
}): Result<{ stored: readonly AtlasPageScreenshotRef[]; unrendered: readonly string[] }, AtlasCaptureError> {
  const stored: AtlasPageScreenshotRef[] = [];
  const unrendered: string[] = [];
  const write = verifiedArtifactWriter({ directory });
  for (const page of pages) {
    if (page.screenshotPath === null) {
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(page.screenshotPath));
    } catch (error: unknown) {
      return err(AtlasCaptureErrors.screenshotUnreadable({ cause: error, providerId: page.providerId }));
    }
    if (isUnrenderedScreenshot({ bytes })) {
      unrendered.push(page.providerId);
      continue;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const relativePath = artifactPath({ sha256 });
    const written = write({ bytes, relativePath, sha256 });
    if (written.isErr()) {
      return err(AtlasCaptureErrors.screenshotWriteRefused({ reasons: written.error }));
    }
    stored.push({
      artifact: { byteLength: bytes.byteLength, kind: "page-png", mediaType: "image/png", relativePath, sha256 },
      providerId: page.providerId,
    });
  }
  return ok({ stored, unrendered });
}

/** What a walk verb's flag tail resolved to. Identical for every platform, so it is parsed once here. *
 * @internal
 */
export interface AtlasWalkOptions {
  readonly home: string;
  readonly json: boolean;
  readonly observation: string | null;
}

/**
 * Parse the flag tail every walk verb accepts.
 *
 * @param rest the argv tail past the verb
 * @returns the resolved options, or every reason the tail is unusable
 *
 * @internal
 */
export function parseAtlasWalkOptions({ rest }: { rest: readonly string[] }): Result<AtlasWalkOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "observation"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
    observation: flagValue({ name: "observation", parsed: parsed.value }),
  });
}

/** Everything a platform contributes to its own walk verb. Nothing here is shaped like a flag. */
export interface AtlasWalkVerbSpec<TDocument> {
  /** Where this platform's verb sits in argv, past the runtime, script, noun and platform. */
  readonly verbIndex: number;
  /** The usage line to print for `--help` and for an unusable tail. */
  readonly usage: string;
  /** Read the declared addresses the API channel published. */
  readonly declaredPages: (args: { home: string }) => Result<readonly AtlasDeclaredPage[]>;
  /** What to say when the generation declares no address at all, naming the sync that would. */
  readonly noPagesMessage: string;
  /** Build the brief a visible session carries out. */
  readonly buildBrief: (args: { pages: readonly AtlasDeclaredPage[]; finish: string }) => ExtensionBrief;
  /** The invocation that judges the document back, printed at the foot of the brief. */
  readonly finishCommand: (args: { home: string }) => string;
  /** Parse and validate the document a session handed back. */
  readonly parseDocument: (args: { json: unknown }) => Result<TDocument>;
  /** The walked pages inside that document. */
  readonly documentPages: (args: { document: TDocument }) => readonly AtlasWalkedPage[];
  /** This atlas's own root, which every artifact path is relative to. */
  readonly atlasDirectory: (args: { home: string }) => string;
  /** How this atlas names a page artifact from its digest. */
  readonly artifactPath: (args: { sha256: string }) => string;
  /** Publish the browser channel from the judged document. */
  readonly publish: (args: {
    home: string;
    document: TDocument;
    screenshots: readonly AtlasPageScreenshotRef[];
    at: string;
  }) => Result<AtlasWalkCounts & { readonly written: readonly string[] }>;
  /** The one line a non-`--json` publish prints. */
  readonly summaryLine: (args: { counts: AtlasWalkCounts }) => string;
}

/**
 * Run a walk verb, in whichever half the flags asked for.
 *
 * The two halves and their exit codes are the same for every platform — a brief with no `--observation`, a
 * judged publish with one — so the whole driver lives here and a platform contributes only its
 * {@link AtlasWalkVerbSpec}. Nothing here opens a browser; nothing this repository starts may.
 *
 * @param argv the whole process argv
 * @param spec everything this platform contributes
 * @returns the process exit code
 */
export function runAtlasWalkVerb<TDocument>({
  argv,
  spec,
}: {
  argv: readonly string[];
  spec: AtlasWalkVerbSpec<TDocument>;
}): number {
  const rest = verbTail({ argv, at: spec.verbIndex, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: spec.usage });
    return EXIT_OK;
  }
  const options = parseAtlasWalkOptions({ rest });
  if (options.isErr()) {
    reportLines({ lines: options.error });
    logger.error({ msg: spec.usage });
    return EXIT_USAGE;
  }
  const { observation } = options.value;
  return observation === null
    ? briefHalf({ options: options.value, spec })
    : publishHalf({ observation, options: options.value, spec });
}

/** Print the brief a visible session carries out. */
function briefHalf<TDocument>({
  options,
  spec,
}: {
  options: AtlasWalkOptions;
  spec: AtlasWalkVerbSpec<TDocument>;
}): number {
  const pages = spec.declaredPages({ home: options.home });
  if (pages.isErr()) {
    reportLines({ lines: pages.error });
    return EXIT_ERROR;
  }
  if (pages.value.length === 0) {
    logger.error({ msg: spec.noPagesMessage });
    return EXIT_EXPECTED_EMPTY;
  }
  const brief = spec.buildBrief({ finish: spec.finishCommand({ home: options.home }), pages: pages.value });
  if (options.json) {
    logger.out({ line: JSON.stringify({ brief }, null, 1) });
    return EXIT_OK;
  }
  renderBrief({ brief }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/** Judge a document the visible session brought back and publish the browser channel. */
function publishHalf<TDocument>({
  options,
  observation,
  spec,
}: {
  options: AtlasWalkOptions;
  observation: string;
  spec: AtlasWalkVerbSpec<TDocument>;
}): number {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(observation === "-" ? 0 : observation, "utf8"));
  } catch (error: unknown) {
    logger.error({ msg: `${observation} could not be read: ${errorMessage({ error })}` });
    return EXIT_USAGE;
  }
  const document = spec.parseDocument({ json: raw });
  if (document.isErr()) {
    reportLines({ lines: document.error });
    return EXIT_USAGE;
  }
  const screenshots = storeWalkScreenshots({
    artifactPath: spec.artifactPath,
    directory: spec.atlasDirectory({ home: options.home }),
    pages: spec.documentPages({ document: document.value }),
  });
  if (screenshots.isErr()) {
    reportLines({ lines: atlasCaptureErrorLines({ error: screenshots.error }) });
    return EXIT_ERROR;
  }
  reportLines({
    lines: screenshots.value.unrendered.map(
      (providerId) => `${providerId}: ${UNRENDERED_SCREENSHOT_BECAUSE}, so it is not published as photographed`,
    ),
  });
  const published = spec.publish({
    at: new Date().toISOString(),
    document: document.value,
    home: options.home,
    screenshots: screenshots.value.stored,
  });
  if (published.isErr()) {
    reportLines({ lines: published.error });
    return EXIT_ERROR;
  }
  const outcome = published.value;
  if (options.json) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
  } else {
    logger.out({ line: spec.summaryLine({ counts: outcome }) });
  }
  return outcome.reachedCount === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** Print every reason a step refused, one line each. */
function reportLines({ lines }: { lines: readonly string[] }): void {
  lines.forEach((line) => {
    logger.error({ msg: line });
  });
}
