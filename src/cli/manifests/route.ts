/** Lazy manifest for host-neutral source planning. */
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const routeManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "capabilities-merge": lazy({
    load: () => import("../commands/route/capabilitiesMerge.js").then((module) => module.routeCapabilitiesMergeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver route capabilities-merge --from .agents/slopweaver-capabilities.json --json",
      parseRejectIsIoFree: true,
      summary: "Merge a private capability-profile source file into the installed overlay, additively",
      usage: "usage: slopweaver route capabilities-merge --from <capabilities.json> [--home <dir>] [--dry-run] --json",
    },
  }),
  evaluate: lazy({
    load: () => import("../commands/route/evaluate.js").then((module) => module.routeEvaluateCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver route evaluate --cases eval/routing.cases.json --decisions decisions.json --json",
      parseRejectIsIoFree: true,
      summary: "Validate and score a visible session's routing decisions against the frozen eval cases",
      usage:
        "usage: slopweaver route evaluate --cases <cases.json> --decisions <decisions.json> [--judged-by <text>] [--out <baseline.json>] --json",
    },
  }),
  plan: lazy({
    load: () => import("../commands/route/run.js").then((module) => module.routePlanCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: 'slopweaver route plan --question "what are my open pull requests?" --json',
      parseRejectIsIoFree: true,
      summary: "Plan every current and historical source a visible host should consult, without calling any source",
      usage: "usage: slopweaver route plan --question <text> [--profile <capabilities.json>] --json",
    },
  }),
  "profile-answer": lazy({
    load: () => import("../commands/route/profileAnswer.js").then((module) => module.routeProfileAnswerCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver route profile-answer --answer profile-draft.json --json",
      parseRejectIsIoFree: true,
      summary: "Validate a drafted judgement/voice profile against the pinned brief and write it privately",
      usage: "usage: slopweaver route profile-answer --answer <answer.json> [--home <dir>] --json",
    },
  }),
  "profile-brief": lazy({
    load: () => import("../commands/route/profileBrief.js").then((module) => module.routeProfileBriefCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver route profile-brief --sources sources.json --held-out cases.json --json",
      parseRejectIsIoFree: true,
      summary: "Scan named private sources into a bounded, hashed judgement-mining brief",
      usage:
        "usage: slopweaver route profile-brief --sources <manifest.json> [--held-out <cases.json>] [--home <dir>] --json",
    },
  }),
};
