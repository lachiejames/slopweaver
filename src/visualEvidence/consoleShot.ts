/**
 * The pure half of `browser console-shot`: the observation its capture spec leaves, the receipt built from it, and the
 * one value it takes from the installation, the maintenance connection its throwaway store is created through.
 *
 * ## What reaches the installation, and what never does
 *
 * The console is served by the console lane's own fixtures (`src/__tests__/e2e/fixtures/`): a fresh database
 * `desktop_e2e_<random>` created on the local Postgres server, migrated, seeded with the synthetic organisation, served
 * from a throwaway `$SLOPWEAVER_HOME` and `$HOME`, and dropped afterwards. The ONE thing read from the installation is
 * which local server to create that database on: the selected store's connection string with its database swapped for
 * the server's `postgres` maintenance database ({@link consoleMaintenanceUrl}). It is refused when the store is not on
 * this machine, and refused when the store itself lives in `postgres`, since the maintenance connection would then
 * open the installation's own store. Nothing the console or the capture reads is the installation's state home.
 *
 * ## Frame text
 *
 * The spec walks the page's visible text immediately before and after the shutter with `browser shot`'s own walker
 * (`../browser/evidenceCaptureSnippet.ts`'s `PAGE_TEXT_SOURCE`). The receipt's frame text is the walk inside the cut
 * region; a page whose text changed across the shutter is `incomplete`, because the picture may show either.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { databaseNameOf } from "../store/lifecycleCore.js";
import { isLocalStoreUrl } from "../store/localStoreUrl.js";
import type { CaptureReceipt } from "./captureRecord.js";
import { type ConsoleShotError, ConsoleShotErrors } from "./consoleShotErrors.js";
import type { ConsoleWalk } from "./consoleWalks.js";
import { type FrameText, pageFrameText } from "./frameText.js";
import { wholeFrameProblem } from "./imageChecks.js";
import type { PixelRect } from "./types.js";

/** The maintenance database every Postgres server carries, which a `create database` is issued from. */
const MAINTENANCE_DATABASE = "postgres";

/** The variable naming the directory the capture spec writes into; only the verb sets it. */
export const CONSOLE_SHOT_DIR_ENV = "SLOPWEAVER_CONSOLE_SHOT_DIR";

/** The file the capture spec writes its observation to, inside the capture directory it was handed. */
export const CONSOLE_OBSERVATION_FILE = "observation.json";

/** The file the capture spec writes the cut region's raw PNG to, inside the same directory. */
export const CONSOLE_RAW_SHOT_FILE = "shot.png";

/** A cut region: never empty. */
const cssRectSchema = z
  .object({ height: z.number().positive(), width: z.number().positive(), x: z.number(), y: z.number() })
  .strict();

/** A box the page walk reported, exactly as `getBoundingClientRect` gave it. */
const walkBoxSchema = z.object({ height: z.number(), width: z.number(), x: z.number(), y: z.number() }).strict();

/** The page walk's report, the shape `PAGE_TEXT_SOURCE` returns. */
const pageTextWalkSchema = z
  .object({
    nodes: z.array(z.object({ rect: walkBoxSchema, text: z.string() }).strict()),
    opaque: z.array(walkBoxSchema),
    truncated: z.boolean(),
  })
  .strict();

/** What the capture spec leaves beside the raw PNG: the walk it ran and what the page showed around the shutter. */
const consoleObservationSchema = z
  .object({
    /** The page's visible text immediately after the shutter. */
    after: pageTextWalkSchema,
    /** The page's visible text immediately before the shutter. */
    before: pageTextWalkSchema,
    finalPath: z.string().startsWith("/"),
    initialPath: z.string().startsWith("/"),
    /** The union of the walk's region selectors, in viewport CSS pixels, as cut. */
    regionCss: cssRectSchema,
    schemaVersion: z.literal(1),
    viewport: z
      .object({
        deviceScaleFactor: z.number().positive(),
        heightPx: z.number().int().positive(),
        widthPx: z.number().int().positive(),
      })
      .strict(),
    walk: z.string().min(1),
    /** The witnesses the spec saw visible before the shutter. */
    witnessesSeen: z.array(z.string().min(1)),
  })
  .strict();

/** One observation, as parsed. */
export type ConsoleObservation = z.infer<typeof consoleObservationSchema>;

/**
 * The maintenance connection a console shot's throwaway database is created through: the selected store's server,
 * credentials and options, naming the server's `postgres` database instead.
 *
 * @param storeUrl the store connection string the installation selects
 * @returns the maintenance connection, or why it cannot be used safely
 */
export function consoleMaintenanceUrl({ storeUrl }: { storeUrl: string }): Result<string, ConsoleShotError> {
  if (!isLocalStoreUrl({ url: storeUrl })) {
    return err(ConsoleShotErrors.storeUnavailable({ detail: "the selected store is not on this machine" }));
  }
  const database = databaseNameOf({ url: storeUrl });
  if (database === undefined) {
    // A client resolves a pathless URL's database from its own defaults (the user name, `PGDATABASE`), so which
    // database the store lives in is not something this URL states, and it may be the maintenance one.
    return err(
      ConsoleShotErrors.storeUnavailable({
        detail:
          "the selected store's connection names no database, so it cannot be told apart from the server's " +
          "`postgres` database a maintenance connection opens; name the store's database in its URL",
      }),
    );
  }
  if (database === MAINTENANCE_DATABASE) {
    return err(
      ConsoleShotErrors.storeUnavailable({
        detail:
          "the selected store lives in the server's `postgres` database, so a maintenance connection would open " +
          "the installation's own store; move the store to a database of its own",
      }),
    );
  }
  const url = new URL(storeUrl);
  url.pathname = `/${MAINTENANCE_DATABASE}`;
  return ok(url.toString());
}

/**
 * Parse what the capture spec left, and refuse one that is not the walk that was asked for.
 *
 * @param value the decoded observation file
 * @param walk the walk that was asked for
 * @returns the observation, or why it cannot be believed
 */
export function parseConsoleObservation({
  value,
  walk,
}: {
  value: unknown;
  walk: ConsoleWalk;
}): Result<ConsoleObservation, ConsoleShotError> {
  const parsed = consoleObservationSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return err(ConsoleShotErrors.observationInvalid({ detail: issues.join("; ") }));
  }
  const observation = parsed.data;
  if (observation.walk !== walk.name) {
    return err(
      ConsoleShotErrors.observationInvalid({ detail: `it is walk '${observation.walk}', not '${walk.name}'` }),
    );
  }
  const unseen = walk.witnesses.filter((witness) => !observation.witnessesSeen.includes(witness));
  if (unseen.length > 0) {
    return err(ConsoleShotErrors.observationInvalid({ detail: `the walk never saw ${unseen.join(", ")}` }));
  }
  return ok(observation);
}

/**
 * The rectangle a region cut occupies in the raw frame's pixels.
 *
 * @param regionCss the region in viewport CSS pixels
 * @param deviceScaleFactor CSS pixels to image pixels
 * @param picture the cut picture's own pixel size, which the screenshot decided
 * @returns the rectangle
 */
function consoleCropRect({
  regionCss,
  deviceScaleFactor,
  picture,
}: {
  regionCss: ConsoleObservation["regionCss"];
  deviceScaleFactor: number;
  picture: { readonly widthPx: number; readonly heightPx: number };
}): PixelRect {
  return {
    height: picture.heightPx,
    width: picture.widthPx,
    x: Math.floor(regionCss.x * deviceScaleFactor),
    y: Math.floor(regionCss.y * deviceScaleFactor),
  };
}

/**
 * Whether two walks saw the same text in the same places.
 *
 * @param before the walk before the shutter
 * @param after the walk after it
 * @returns true when nothing moved or changed
 */
function walksAgree({
  before,
  after,
}: {
  before: ConsoleObservation["before"];
  after: ConsoleObservation["after"];
}): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

/**
 * The frame text of a console shot: the after-walk inside the crop, `incomplete` when the page changed across the
 * shutter.
 *
 * @param observation what the spec saw
 * @param crop the cut, in raw pixels
 * @returns the frame text
 */
function consoleFrameText({ observation, crop }: { observation: ConsoleObservation; crop: PixelRect }): FrameText {
  const frameText = pageFrameText({
    caption: { bandHeightPx: 0, lines: [] },
    crop,
    scale: observation.viewport.deviceScaleFactor,
    walk: observation.after,
  });
  if (walksAgree({ after: observation.after, before: observation.before })) {
    return frameText;
  }
  const changed = "the page's visible text changed across the shutter, so the picture may show either reading";
  const earlier = frameText.kind === "incomplete" ? frameText.reasons : [];
  return { items: frameText.items, kind: "incomplete", origin: frameText.origin, reasons: [...earlier, changed] };
}

/**
 * The receipt for one console shot, from the observation and the final, metadata-stripped picture.
 *
 * @param observation what the spec saw
 * @param walk the walk asked for
 * @param final the final picture's identity and where it was written
 * @param capturedAtIso when the shot was taken
 * @param captureId the id minted from the final digest
 * @returns the receipt, or the whole-frame refusal
 */
export function consoleShotReceipt({
  observation,
  walk,
  final,
  capturedAtIso,
  captureId,
}: {
  observation: ConsoleObservation;
  walk: ConsoleWalk;
  final: { readonly digest: string; readonly widthPx: number; readonly heightPx: number; readonly path: string };
  capturedAtIso: string;
  captureId: string;
}): Result<CaptureReceipt, ConsoleShotError> {
  const { viewport } = observation;
  const source = {
    heightPx: Math.round(viewport.heightPx * viewport.deviceScaleFactor),
    widthPx: Math.round(viewport.widthPx * viewport.deviceScaleFactor),
  };
  const cropRect = consoleCropRect({
    deviceScaleFactor: viewport.deviceScaleFactor,
    picture: final,
    regionCss: observation.regionCss,
  });
  const whole = wholeFrameProblem({ cropRect, source });
  if (whole !== null) {
    return err(ConsoleShotErrors.wholeFrame({ detail: whole }));
  }
  return ok({
    capturedAtIso,
    captureId,
    cropRect,
    detail: {
      finalPath: observation.finalPath,
      fixture: "acme",
      initialPath: observation.initialPath,
      region: walk.region,
      viewport,
      walk: walk.name,
      witnesses: walk.witnesses,
    },
    final: {
      artifact: { digest: final.digest, heightPx: final.heightPx, widthPx: final.widthPx },
      metadata: "stripped",
      path: final.path,
    },
    frameText: consoleFrameText({ crop: cropRect, observation }),
    schemaVersion: 2,
    source,
    status: "readback-pending",
    verb: "browser console-shot",
  });
}
