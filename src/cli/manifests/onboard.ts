/**
 * Lazy manifest for the `onboard` noun — the first-time Slack setup, as a verb.
 *
 * `onboard` (the bare default) and `onboard run` both resolve to the one handler, the convention `init`,
 * `refresh` and `listen` already follow.
 *
 * The meta says `effect: "none"` and it is meant literally: this verb reads no state home, holds no token,
 * touches no network and writes no file. It asks two questions and prints a rendered manifest. That is why
 * it is `dryParseSafe` and needs no door — there is no effect to route. `onboard workstreams` is the one verb that
 * reads the home (the bronze sizes and the candidates document), so it is `local-state`; it writes nothing.
 */

import {
  ONBOARD_EVAL_USAGE,
  ONBOARD_PLAN_USAGE,
  ONBOARD_USAGE,
  ONBOARD_WORKSTREAMS_USAGE,
} from "../commands/onboard/usage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const onboardMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver onboard --tier agent",
  parseRejectIsIoFree: true,
  summary: "Render the Slack app manifest to paste — the full agent tier by default, named as the least secure",
  usage: ONBOARD_USAGE,
} as const;

const loadOnboard = () => import("../commands/onboard/run.js").then((m) => m.onboardCommand);
const loadPlan = () => import("../commands/onboard/planRun.js").then((m) => m.onboardPlanCommand);
const loadEval = () => import("../commands/onboard/evalRun.js").then((m) => m.onboardEvalCommand);
const loadWorkstreams = () => import("../commands/onboard/workstreamsRun.js").then((m) => m.onboardWorkstreamsCommand);

export const onboardManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadOnboard, meta: onboardMeta }),
  eval: lazy({
    load: loadEval,
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver onboard eval --run /tmp/onboard-eval-run.json --file-findings 3",
      parseRejectIsIoFree: true,
      summary: "Score one onboarding self-evaluation run, diff it against the last, and file the worst findings",
      usage: ONBOARD_EVAL_USAGE,
    },
  }),
  plan: lazy({
    load: loadPlan,
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example:
        "slopweaver onboard plan --sources github,slack,linear,notion --backfill 90 --repo owner/repo --github-org owner",
      parseRejectIsIoFree: true,
      summary: "Render one independently resumable refresh command per connected source for concurrent launch",
      usage: ONBOARD_PLAN_USAGE,
    },
  }),
  run: lazy({ load: loadOnboard, meta: onboardMeta }),
  workstreams: lazy({
    load: loadWorkstreams,
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver onboard workstreams --json",
      parseRejectIsIoFree: true,
      summary: "Say where onboarding's workstreams step stands — pull, mine, react or answered — and what to do next",
      usage: ONBOARD_WORKSTREAMS_USAGE,
    },
  }),
};
