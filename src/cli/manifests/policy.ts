/**
 * Lazy manifest for the `policy` noun — policy and evidence documents rendered for review and for Vanta (see
 * `cli/manifest.ts`).
 *
 * `render` turns one markdown file into a verified PDF, and `diff` turns one recorded change into the HTML
 * review page and the team's post. Neither reaches a network, a provider or a browser, which is why they are
 * `local-state` rather than door-routed; the upload to Vanta is `write vanta upload-policy-version`.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Lazy loader for `policy render`. */
const loadPolicy = () => import("../commands/policy/run.js").then((m) => m.policyCommand);

/** Lazy loader for `policy diff`, kept apart so its renderer and atlas reads load only when it runs. */
const loadPolicyDiff = () => import("../commands/policy/diffRun.js").then((m) => m.policyDiffCommand);

/** The `policy` noun's verbs as lazy manifest entries. */
export const policyManifest: Readonly<Record<string, VerbManifestEntry>> = {
  diff: lazy({
    load: loadPolicyDiff,
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver policy diff --record ./scratchpad/evidence-diff.json --out ./scratchpad/evidence-diff",
      parseRejectIsIoFree: true,
      summary:
        "Render an evidence or policy change as a review page: material lines with their reason on hover, formatting folded, every identifier a Vanta link, plus the team's page and post",
      usage: "usage: slopweaver policy diff --record <record.json> --out <dir> [--json] [--home <dir>]",
    },
  }),
  render: lazy({
    load: loadPolicy,
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver policy render --file ./ai-acceptable-use-policy.md --out /tmp/ai.pdf",
      parseRejectIsIoFree: true,
      summary:
        "Render one policy or evidence document to a PDF — tables, quotes, lists, figures and fences — refusing any construct or character it would otherwise drop",
      usage: "usage: slopweaver policy render --file <path.md> --out <path.pdf> [--json]",
    },
  }),
};
