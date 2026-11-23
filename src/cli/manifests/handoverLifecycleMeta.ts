/**
 * The `CommandMeta` every run-lifecycle verb shares, as a leaf.
 *
 * A leaf rather than a member of `./handover.ts` because `./handoverAsks.ts` needs it too, and importing it
 * from there would make the two manifests import each other. Nothing else lives here on purpose: a module
 * both siblings depend on is one that must not grow reasons to change.
 */
import type { VerbManifestEntry } from "../manifest.js";

/**
 * The shared metadata of a run-lifecycle verb.
 *
 * Every one is `local-state`: they read the board and append to a journal under `$SLOPWEAVER_HOME/runs`, and
 * none touches a network or an external service — which is why none is door-routed. `diagnostic: true` for all
 * of them because a non-zero exit here REPORTS A FINDING (probes already pass, a run is partial, no run is
 * open) rather than signalling a crash; it says nothing about whether the verb writes.
 *
 * @returns the verb's meta, with only its three own strings varying
 */
export const lifecycleMeta = ({
  summary,
  example,
  usage,
}: {
  summary: string;
  example: string;
  usage: string;
}): VerbManifestEntry["meta"] => ({
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example,
  parseRejectIsIoFree: true,
  summary,
  usage,
});
