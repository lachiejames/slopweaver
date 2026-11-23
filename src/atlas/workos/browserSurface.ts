/**
 * The BROWSER surface: the brief a visible session carries out in the owner's own Chrome, and the publish
 * that judges what it brought back.
 *
 * ## Nothing here opens a browser, and that is mechanical rather than editorial
 *
 * Owner ruling (`docs/browser-route.md`): the owner's real work Chrome is the only browser anything
 * here uses, and no process this repository starts may launch one, attach to one, or keep a profile
 * directory. So this module does what every other browser lane does — it prints a BRIEF naming the exact
 * addresses and what to hand back, the visible session drives them, and the verb grades the document. The
 * judgement stays here, where it is pure and impossible to skip.
 *
 * ## This walk carries a precondition no other atlas's does, and it is the first step of the brief
 *
 * MEASURED: `slopweaver browser cookies --origin https://dashboard.workos.com` can report only
 * `wos_sso_csrf_token`, which is a CSRF token rather than a session. That signal is WEAK in a known
 * direction — a cookie probe reads names and cannot see a session held in localStorage, which is why other
 * atlases' origins can read as no-session to it while plainly being signed in — so it is a reason to CHECK
 * rather than a reason to conclude. What it rules out is trusting a walk that did not check: an unsigned
 * one would land on `/signin` at every address and report every declared page unreachable, which is a
 * false finding about WorkOS rather than a true one about this session. The brief
 * therefore opens by asking the session to confirm it is signed in and to STOP if it is not — this atlas
 * never signs anyone in, and a walk that cannot start is a recorded gap rather than a page map full of
 * wrong answers.
 *
 * ## A page is `reached` or it is a recorded gap; there is no third state
 *
 * A declared route that answers a redirect to somewhere else, or a permission wall, is published with
 * `unreachableBecause` set. That is the honesty this surface exists for: the Slack atlas's own walk once
 * reported its destinations while reaching only part of them, and a page map that silently drops what it could not open
 * would repeat exactly that.
 *
 * ## A screenshot is OPTIONAL, and its absence has a stated cause
 *
 * A walk runs through the `slopweaver browser` verbs (`docs/browser-route/brief-profile-and-walks.md`), and a
 * page can be reached while its capture fails, so a page carrying no screenshot is
 * `reached but not photographed` rather than a failure — which is why coverage grades `synced` only when
 * every reached page was also photographed, and `deferred` otherwise.
 */
import { z } from "zod";

import type { ExtensionBrief } from "../../browser/brief.js";
import { err, ok, type Result } from "../../lib/result.js";

import {
  type AtlasPageScreenshotRef,
  type AtlasWalkCounts,
  type AtlasWalkedPage,
  atlasWalkCoverageDecision,
  atlasWalkedPageSchema,
  projectAtlasWalkedPages,
  publishWalkedPageKind,
} from "../kit/walkSurface.js";

import { succeededWorkosCoverageCell } from "./coverage.js";
import { WORKOS_DASHBOARD_ORIGIN } from "./dashboardPages.js";
import { openWorkosGap } from "./gaps.js";
import { workosEntityId } from "./identity.js";
import { mergeWorkosChannel } from "./merge.js";
import {
  emptyWorkosKindFile,
  initialWorkosManifest,
  type WorkosAtlasEntity,
  type WorkosAtlasKindFile,
  type WorkosAtlasManifest,
} from "./model.js";
import { publishWorkosAtlas, readWorkosAtlas, type WorkosAtlasPaths, withWorkosPublishLock } from "./store.js";

/**
 * The surface name the dashboard walk's coverage is reported under.
 *
 * @internal
 */
export const WORKOS_DASHBOARD_SURFACE = "dashboard-walk";

/** The lane name a brief is issued under. */
const WORKOS_DASHBOARD_LANE = "atlas workos walk";

/** One page the visible session actually visited. Kit-owned, so two atlases' documents stay comparable. */
const walkedPageSchema = atlasWalkedPageSchema;

/** The whole document a walk hands back. */
const workosWalkDocumentSchema = z
  .object({
    pages: z.array(walkedPageSchema).min(1),
    /**
     * Whether the session confirmed a signed-in dashboard before walking anything.
     *
     * Required rather than optional, and refused when false: see this file's header on why an unprepared
     * walk produces a confident wrong answer for every declared page.
     */
    signedIn: z.boolean(),
    walkedAt: z.iso.datetime(),
  })
  .strict();

export type WorkosWalkDocument = z.infer<typeof workosWalkDocumentSchema>;

/**
 * One page a walk visited, as the document records it.
 *
 * @internal
 */
export type WorkosWalkedPage = AtlasWalkedPage;

/**
 * Parse a walk document, refusing anything this atlas cannot judge.
 *
 * @param json the parsed JSON the session handed back
 * @returns the document, or every reason it is not one
 */
export function parseWorkosWalkDocument({ json }: { json: unknown }): Result<WorkosWalkDocument> {
  const parsed = workosWalkDocumentSchema.safeParse(json);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `walk document: ${issue.path.join(".")} ${issue.message}`));
  }
  if (!parsed.data.signedIn) {
    return err([
      "the walk reports it was not signed in to the dashboard, so every page it visited answered the " +
        "sign-in redirect rather than the page itself. Publishing it would record every declared page " +
        "as unreachable, a fact about WorkOS when it is a fact about this session — sign in to " +
        `${WORKOS_DASHBOARD_ORIGIN} in your own Chrome and walk again`,
    ]);
  }
  return ok(parsed.data);
}

/**
 * Build the brief for a dashboard walk over the declared page rows.
 *
 * @param pages every declared page entity the API channel published, with its exact URL
 * @param finish the verb invocation that judges the document
 * @returns the brief a visible session carries out
 */
export function workosWalkBrief({
  pages,
  finish,
}: {
  pages: readonly { providerId: string; url: string; purpose: string }[];
  finish: string;
}): ExtensionBrief {
  return {
    finish,
    lane: WORKOS_DASHBOARD_LANE,
    steps: [
      {
        tool: "slopweaver browser act",
        what:
          `open ${WORKOS_DASHBOARD_ORIGIN}/get-started and confirm you are SIGNED IN. If it lands on ` +
          "/signin, STOP and report that instead of walking: this atlas never signs anyone in, and an " +
          "unsigned walk records every page below as unreachable, which is a false finding. Set " +
          '"signedIn" on the document to what you actually saw',
      },
      ...pages.map((page) => ({
        tool: "slopweaver browser act" as const,
        what:
          `open ${page.url} (${page.purpose}), record the final URL, HTTP status and document title, and ` +
          `write one entry with providerId "${page.providerId}". Screenshot it where your route can write ` +
          "a file; leave screenshotPath null where it cannot, which records it as reached but not " +
          "photographed",
      })),
    ],
    url: WORKOS_DASHBOARD_ORIGIN,
  };
}

/**
 * One walked page's screenshot, already digested and written into the generation by the caller.
 *
 * @internal
 */
export type WorkosPageScreenshot = AtlasPageScreenshotRef;

/**
 * What publishing a walk did. The CLI grades its exit code from these counts.
 *
 * @internal
 */
export interface WorkosWalkOutcome extends AtlasWalkCounts {
  readonly written: readonly string[];
}

/**
 * Publish a walk onto the `page` kind's browser channel, leaving every API-channel row alone.
 *
 * @param paths the resolved atlas paths
 * @param document what the visible session brought back
 * @param screenshots the artifact written for each photographed page, keyed by provider id
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishWorkosWalk({
  paths,
  document,
  screenshots,
  at,
}: {
  paths: WorkosAtlasPaths;
  document: WorkosWalkDocument;
  screenshots: readonly WorkosPageScreenshot[];
  at: string;
}): Result<WorkosWalkOutcome> {
  return withWorkosPublishLock({
    nowIso: at,
    paths,
    publish: () => publishWalked({ at, document, paths, screenshots }),
  });
}

/** The critical section: read the generation, merge the browser channel onto it, and publish. */
function publishWalked({
  paths,
  document,
  screenshots,
  at,
}: {
  paths: WorkosAtlasPaths;
  document: WorkosWalkDocument;
  screenshots: readonly WorkosPageScreenshot[];
  at: string;
}): Result<WorkosWalkOutcome> {
  return publishWalkedPageKind({
    at,
    coverageFor: ({ counts }) => walkCoverage({ at, counts }),
    emptyFile: () => emptyWorkosKindFile({ kind: "page", updatedAt: at }),
    gapsFor: ({ stored }) => walkGaps({ at, document, stored }),
    manifestFor: ({ manifest, count }) => walkManifest({ at, count, manifest }),
    merge: ({ observed, stored }) => mergeWorkosChannel({ at, channel: "browser", observed, stored }),
    observed: projectWalkedPages({ at, document, screenshots }),
    pages: document.pages,
    photographed: screenshots.length,
    publish: ({ derivedFrom, file, manifest }) =>
      publishWorkosAtlas({ derivedFrom, files: { page: file }, manifest, paths }),
    read: () => readWorkosAtlas({ paths }),
    surface: WORKOS_DASHBOARD_SURFACE,
  });
}

/**
 * Project a walk's pages onto the browser channel.
 *
 * @param document what the session brought back
 * @param screenshots the artifact per photographed page
 * @param at this run's ISO timestamp
 * @returns one entity per walked page, sorted by id
 */
export function projectWalkedPages({
  document,
  screenshots,
  at,
}: {
  document: WorkosWalkDocument;
  screenshots: readonly WorkosPageScreenshot[];
  at: string;
}): readonly WorkosAtlasEntity[] {
  return projectAtlasWalkedPages<WorkosAtlasEntity["channels"]>({
    at,
    emptyChannels: { api: null, browser: null },
    entityId: ({ providerId }) => workosEntityId({ kind: "page", providerId }),
    // The route table is the API channel's; a walk reports what it found, never what was expected, so
    // `needsAdmin` is the declared row's to state and this one says only that a browser saw the page.
    extraDetail: { needsAdmin: false },
    pages: document.pages,
    purpose: "witnessed by a dashboard walk",
    screenshots,
    walkedAt: document.walkedAt,
  });
}

/**
 * The walk's own coverage cell.
 *
 * `synced` requires every reached page to have been photographed as well, so a run that landed everywhere
 * and photographed nothing reports `deferred` — the same bar the Notion atlas holds itself to, and for the
 * same reason: a surface that grades itself on pages-walked alone can report complete while holding no
 * proof of anything.
 *
 * @param total how many pages the document carried
 * @param reachedCount how many the session actually landed on
 * @param photographed how many carried a screenshot
 * @param at this run's ISO timestamp
 * @returns the cell to publish
 */
function walkCoverage({
  counts,
  at,
}: {
  counts: AtlasWalkCounts;
  at: string;
}): WorkosAtlasKindFile["coverage"][number] {
  const decision = atlasWalkCoverageDecision({ counts, noun: "dashboard" });
  return succeededWorkosCoverageCell({
    artifacts: [],
    at,
    channel: "browser",
    reason: decision.reason,
    role: "corroborating",
    scope: "dashboard-walk",
    state: decision.complete ? "synced" : "deferred",
    surface: WORKOS_DASHBOARD_SURFACE,
  });
}

/** One gap per page the walk could not open, replacing whatever the last walk raised. */
function walkGaps({
  document,
  stored,
  at,
}: {
  document: WorkosWalkDocument;
  stored: WorkosAtlasKindFile;
  at: string;
}): WorkosAtlasKindFile["gaps"] {
  const kept = stored.gaps.filter((gap) => gap.condition !== "dashboard-page-unwitnessed");
  return [
    ...kept,
    ...document.pages
      .filter((page) => !page.reached)
      .map((page) =>
        openWorkosGap({
          at,
          condition: "dashboard-page-unwitnessed",
          kind: "page",
          reason: unreachedReason({ page }),
          scope: page.providerId,
          surfaces: ["browser"],
        }),
      ),
  ];
}

/**
 * Why the walk did not land on one page. The document's `unreachableBecause` is nullable by the kit's own
 * schema — a session may record a page as not reached without knowing why — so a page carrying no reason
 * gets the sentence that says exactly that much and no more.
 */
function unreachedReason({ page }: { page: AtlasWalkedPage }): string {
  if (page.unreachableBecause === null) {
    return "the walk did not land on this declared dashboard page";
  }
  return page.unreachableBecause;
}

/** Stamp the `page` kind's status and the manifest's own clock from this run's instant. */
function walkManifest({
  manifest,
  count,
  at,
}: {
  manifest: WorkosAtlasManifest | null;
  count: number;
  at: string;
}): WorkosAtlasManifest {
  const base = manifest ?? initialWorkosManifest({ updatedAt: at });
  return {
    ...base,
    kinds: {
      ...base.kinds,
      page: { digest: null, entityCount: count, lastAttempt: { at, outcome: "ok", reasons: [] }, lastSuccessAt: at },
    },
    updatedAt: at,
  };
}
