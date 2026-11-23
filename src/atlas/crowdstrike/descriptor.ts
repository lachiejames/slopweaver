/**
 * What the CrowdStrike Falcon atlas declares about itself — including the two things it cannot do.
 *
 * ## The browser surface is FILLED, and what that does and does not claim
 *
 * The owner's ruling is that both surfaces are mandatory and that the browser half must cover the WHOLE
 * console — "I will NOT accept a subset". `slopweaver crowdstrike walk` visits every page the console's own
 * published sitemap declares, in the owner's own Chrome, and photographs each, recording per walk the
 * declared routes attempted, the pages that rendered, the distinct first-party endpoints seen and the
 * screenshots kept.
 *
 * `filled` says the surface has been POPULATED, never that every page answered. The pages that redirected
 * or 404'd — a tenant licenses only some of Falcon's modules — each carry their own row and outcome,
 * and the shortfall is an open `console-page-unreachable` gap the coverage table states. That is the
 * distinction the field exists for, and it is the opposite of the sibling failure it was written against: a
 * walk that saw all but one of its navigation surfaces redirect, and read as filled on the strength of
 * that one. Here the denominator is the console's own, so "rendered of attempted" is a ratio a reader can
 * check against the walk's own rows.
 *
 * ## `visibilityScope` is a claim boundary, not a disclaimer
 *
 * It states what "complete" can ever mean for this credential. Two things bound it permanently. The API
 * client holds Read on every scope and Write on none, so nothing this atlas records was obtained by
 * changing anything — and nothing it cannot read can be blamed on a missing write. And the console's own
 * `/api2/*` surface reaches data the scoped client cannot, guarded by a bearer the page holds in memory;
 * that traffic is recorded as evidence of what Falcon HOLDS and never as something this installation can
 * ask for.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { CROWDSTRIKE_KINDS, CROWDSTRIKE_PLATFORM } from "./model.js";

/** What "complete" can ever mean for this account's access. */
export const CROWDSTRIKE_VISIBILITY_SCOPE =
  "one Falcon tenant on the us-2 cloud, through an OAuth2 API client holding Read on every grantable scope and Write on none, plus the console pages the owner's own signed-in browser session can open";

/** CrowdStrike Falcon's atlas, as it declares itself. */
export const CROWDSTRIKE_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every write operation, on both surfaces — no containment or lift-containment, no Real Time Response session, no policy, host-group or exclusion edit, no IOC write, no sensor-update action. The credential holds no write scope at all, so this is a property of the token rather than a promise about the code",
      ground: "never-acted",
    },
    {
      because:
        "NGSIEM log data wholesale: the volume makes indexing it absurd, and the owner ruled it out. A sampling plan that captures the SHAPE of each log kind is the intended treatment and ranks last",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "NGSIEM holds ingested log data — machine-emitted events identified by an instant, growing with every endpoint on the estate",
        wouldBeMeasuredBy: "an NGSIEM search over a fixed window returning a row count and a bytes-ingested figure",
      },
    },
    {
      because:
        "the bearer the Falcon console holds in memory for its own /api2 surface. Lifting it would reach data the scoped API client cannot, and the browser transport is built so it cannot be read",
      ground: "secret-material",
    },
    {
      because:
        "response VALUES from the console's own traffic. What is stored is the method, the path shape and the field NAMES a response carried — enough to say what the console asks for, never a copy of what it was told",
      ground: "names-not-values",
    },
    {
      because:
        "command lines, file paths and network locators from detections and host records — incident content the console holds and this atlas has no question for",
      ground: "names-not-values",
    },
  ],
  kinds: [...CROWDSTRIKE_KINDS],
  platform: CROWDSTRIKE_PLATFORM,
  question:
    "which endpoints exist, which are actually protected and by what policy, what has been detected on them, and who holds each machine",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver crowdstrike sync",
  surfaces: [
    {
      denominator: {
        because:
          "CrowdStrike publishes no catalogue of its `falcon-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "falcon-api",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "CrowdStrike publishes no catalogue of its `falcon-console` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "falcon-console",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
  ],
  visibilityScope: CROWDSTRIKE_VISIBILITY_SCOPE,
};
