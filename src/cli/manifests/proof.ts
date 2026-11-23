/**
 * Lazy manifest for the `proof` noun — golden-proof capture recipes for a PR description. `yarn-why` is
 * a real, unfaked before/after `yarn why <dependency>` terminal capture, recorded with VHS so no window is
 * ever opened at all (see `src/proof/yarnWhy/tape.ts` for what that means and why); `cassette` renders a
 * session's own VHS tape to a scrubbable, fast-typed `.mp4` (`src/proof/cassette/tape.ts`) and files its capture
 * receipt, the recording's transcript as frame text (`src/proof/cassette/receipt.ts`).
 *
 * `effect: "local-state"` mirrors `cmux spawn`: both drive a real local process (here, `vhs`, which serves
 * a pty through `ttyd` on loopback) rather than writing to a Slack/GitHub/Linear provider, so this is not
 * the admit door's concern and does not route through it.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const proofManifest: Readonly<Record<string, VerbManifestEntry>> = {
  cassette: lazy({
    load: () => import("../commands/proof/cassette.js").then((m) => m.proofCassetteCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver proof cassette --tape ~/.slopweaver/proof/<pr>/demo.tape --out ~/.slopweaver/proof/<pr>/demo.mp4",
      parseRejectIsIoFree: true,
      summary:
        "Render a VHS tape to an .mp4 a reader can scrub, typed fast, and file the capture receipt github attach requires",
      usage: "usage: slopweaver proof cassette --tape <path> --out <path.mp4> [--cwd <dir>]",
    },
  }),
  "yarn-why": lazy({
    load: () => import("../commands/proof/run.js").then((m) => m.proofYarnWhyCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver proof yarn-why --dep @datadog/datadog-api-client --before ../staging --after . --out ~/.slopweaver/proof/<pr>/yarn-why.png",
      parseRejectIsIoFree: true,
      summary: "Capture a real before/after `yarn why` terminal comparison across two worktrees, windowlessly",
      usage:
        "usage: slopweaver proof yarn-why --dep <name> --before <path> --after <path> --out <path> " +
        "[--before-label <text>] [--after-label <text>]",
    },
  }),
};
