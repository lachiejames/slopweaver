/**
 * Lazy manifest for the `seed` noun (write the synthetic demo corpus; see `cli/manifest.ts`).
 *
 * The bare-noun and `run` verb resolve to the SAME handler, so both share one loader (one module fetch).
 * Meta rides here so enumeration stays import-free; the command module loads only when dispatched.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

/** Shared meta for the bare-noun + `run` verb; both resolve to the same demo-seed handler. */
const seedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // `runSeed` refuses a bare run, an unknown flag and `--help` before it resolves the home or writes a record.
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver seed --demo",
  parseRejectIsIoFree: true,
  summary: "Seed the local corpus with a synthetic, identifier-free demo dataset (offline fast loop)",
  usage: "usage: slopweaver seed --demo [--home <dir>]",
} as const;

/** Lazy loader for the shared seed handler — one module fetch, reused across the bare-noun + `run` verb. */
const loadSeed = () => import("../commands/seed/run.js").then((m) => m.seedRunCommand);

/** The `seed` noun's verbs as lazy manifest entries. */
export const seedManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadSeed, meta: seedMeta }),
  run: lazy({ load: loadSeed, meta: seedMeta }),
};
