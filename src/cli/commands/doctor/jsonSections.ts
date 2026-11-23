/**
 * The sections of `doctor --json` that `doctorJsonReport` (`./run.ts`) assembles: the stable public paths, the
 * parse/presence statuses, and the environment block. Value-free by construction — paths and statuses only,
 * never a secret, identity or profile CONTENT.
 */
import { existsSync } from "node:fs";
import { mainCheckoutCleanliness } from "../../../admit/mainCheckoutCleanliness.js";
import type { EnvironmentProbe } from "../../../environment/facts.js";
import { probeTally } from "../../../environment/probes.js";
import { parseProfile } from "../../../profile.js";
import type { StateHomePaths } from "../../../stateHome.js";
import { execInodeStatus } from "./execInodeReport.js";
import { dirStatus, identityStatus, type PeekedIdentityRoster, seedStatus } from "./homeLines.js";
import { classifyPluginLoad, type PluginLoadEvidence, type PluginSurface } from "./pluginReport.js";

/**
 * Stable public paths in the JSON report, excluding private contents.
 *
 * @returns the report's `paths` record, keyed by part of the home
 */
export function doctorJsonPaths({ paths }: { paths: StateHomePaths }): Readonly<Record<string, string>> {
  return {
    bronze: paths.corpus.bronze,
    gold: paths.corpus.gold,
    history: paths.corpus.history,
    identity: paths.identityJson,
    members: paths.corpus.members,
    profile: paths.profileJson,
    root: paths.root,
    secrets: paths.secrets,
    silver: paths.corpus.silver,
    structures: paths.corpus.structures,
  };
}

/** `mainCheckout` status for the JSON report — "unknown" whenever `cwd` isn't a repository's own main worktree. */
function mainCheckoutStatus({ cwd }: { cwd: string | undefined }): string {
  if (cwd === undefined) {
    return "unknown";
  }
  const cleanliness = mainCheckoutCleanliness({ cwd });
  if (cleanliness === undefined) {
    return "unknown";
  }
  return cleanliness.dirty ? "dirty" : "clean";
}

/**
 * Parse/presence statuses in the JSON report; never secret or profile values.
 *
 * @returns the report's `statuses` record, one presence or parse word per key
 */
export function doctorJsonStatuses({
  codex,
  paths,
  execStore,
  plugin,
  surface,
  cwd,
  identityRoster,
}: {
  codex: { authPath: string; configPath: string };
  paths: StateHomePaths;
  execStore: string;
  plugin: PluginLoadEvidence;
  surface: PluginSurface;
  cwd: string | undefined;
  identityRoster: PeekedIdentityRoster;
}): Readonly<Record<string, string>> {
  return {
    bronze: dirStatus({ path: paths.corpus.bronze }),
    execInodes: execInodeStatus({ cwd, execStore, homeExecStore: paths.homeExecStore }),
    codexAuth: existsSync(codex.authPath) ? "present" : "missing",
    codexConfig: existsSync(codex.configPath) ? "present" : "none",
    denylist: existsSync(paths.hygieneDenylist) ? "present" : "missing",
    gold: dirStatus({ path: paths.corpus.gold }),
    history: dirStatus({ path: paths.corpus.history }),
    identity: identityStatus({ path: paths.identityJson, stored: identityRoster }),
    mainCheckout: mainCheckoutStatus({ cwd }),
    members: dirStatus({ path: paths.corpus.members }),
    pluginHooks: surface.hooks,
    pluginHookTrust: "host-only-unverified",
    pluginLoad: classifyPluginLoad(plugin),
    pluginRootKind: plugin.rootKind,
    profile: seedStatus({ path: paths.profileJson, valid: (v) => parseProfile({ value: v }).isOk() }),
    secrets: dirStatus({ path: paths.secrets }),
    silver: dirStatus({ path: paths.corpus.silver }),
    structures: dirStatus({ path: paths.corpus.structures }),
  };
}

/**
 * The `environment` block of the JSON report: every probe, and the counts an exit code is decided on.
 *
 * @returns the probes with their fatal, warning and unchecked tallies, and whether the costed ones ran
 */
export function environmentJson({ probes, deep }: { probes: readonly EnvironmentProbe[]; deep: boolean }): {
  readonly deep: boolean;
  readonly fatal: number;
  readonly warnings: number;
  readonly unchecked: number;
  readonly probes: readonly EnvironmentProbe[];
} {
  return { deep, ...probeTally({ probes }), probes };
}
