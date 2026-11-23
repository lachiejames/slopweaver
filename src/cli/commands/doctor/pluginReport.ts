/**
 * `doctor`'s plugin lines — which build was loaded, how this invocation reached it, and which plugin-owned
 * continuity files sit beneath its root. Split out of `./run.ts` unchanged so that file has room for the
 * environment probes under its size ratchet; every function here is pure or reads only plugin-owned files.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { isRecord } from "#lib/parsers.js";

import type { SupervisorHost, SupervisorSessionDetection } from "../../../supervisor/session.js";
import { isMirrorSlotDir } from "../../../worktree/pluginMirrors.js";

/** The Codex skills that make durable orchestration usable without Claude command files. */
const REQUIRED_CODEX_CONTINUITY_SKILLS = ["handover", "orchestrate", "pickup"] as const;

/** The resolver failures that mean nothing is at the root, rather than that the resolver could not answer. */
const ABSENT_ROOT_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR", "ELOOP"]);

/**
 * The directory the kernel opens for `pluginRoot`. `join` and the JS `realpathSync` both collapse `link/..`
 * lexically, so a root spelled through a symlink then `..` names a different directory than the one a host
 * reads; the native call follows the link first, as `bin/slopweaver`'s own `cd` does.
 * Every probe beneath a root goes through this, so the kind, the version and the surface read ONE directory.
 * `undefined` when the root does not resolve at all — nothing is beneath it to probe.
 *
 * The physical spelling is only PROBED when it names something the lexical one does not. Where the two agree,
 * the root is probed as given, as it was before this function existed: an absolute spelling is longer than a
 * relative one, so under a working directory near PATH_MAX the absolute root, or a manifest or skill path
 * beneath it, can overflow where the relative probe opens (a root under a 1000-byte
 * working directory read `manifestless-root` with every skill false). Only a failure that says nothing is THERE
 * (`ENOENT`, `ENOTDIR`, `ELOOP`) means no root; any other — `ENAMETOOLONG` from the resolver itself, an `EIO` —
 * says only that the resolver could not answer, so the root is probed as given. Pure over
 * its injected seams.
 *
 * @param realpath the physical resolver — `realpathSync.native` in production, a fake in a test
 * @param lexical the lexical absolute resolver — `path.resolve` against the working directory in production
 * @returns the directory to probe beneath, or `undefined` when there is none
 */
export function probeRoot({
  pluginRoot,
  realpath,
  lexical,
}: {
  pluginRoot: string;
  realpath: (path: string) => string;
  lexical: (path: string) => string;
}): string | undefined {
  let physical: string;
  try {
    physical = realpath(pluginRoot);
  } catch (error) {
    const code = isRecord(error) ? error["code"] : undefined;
    if (typeof code === "string" && ABSENT_ROOT_CODES.has(code)) {
      return undefined;
    }
    return pluginRoot;
  }
  return physical === lexical(pluginRoot) ? pluginRoot : physical;
}

/** {@link probeRoot} over the real native resolver. */
function physicalRoot({ pluginRoot }: { pluginRoot: string }): string | undefined {
  return probeRoot({ lexical: (path) => resolve(path), pluginRoot, realpath: (path) => realpathSync.native(path) });
}

/** Whether `path` is a regular file — the mirror's launcher is one, a directory or FIFO of that name is not. */
function isRegularFile({ path }: { path: string }): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Read one manifest version without throwing or leaking its other fields. */
function manifestVersion({ path }: { path: string | URL }): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) && typeof parsed["version"] === "string" ? parsed["version"] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the version of the artifact this host actually loaded.
 *
 * A proven plugin root plus host selects the host manifest's `version` first, so an install that still pins
 * one reports it; the package remains the fallback for a bare CLI invocation. The Codex manifest pins none
 * (a stable `local` cache key, `src/codexPlugin/plan.ts`); what names a Codex build is the
 * commit `withSourceCommit` (`src/codexPlugin/stamp.ts`) appends at the call site.
 *
 * On Claude Code that fallback is now the NORMAL path, not an edge: `.claude-plugin/plugin.json` carries no
 * `version` at all, so that Claude Code keys each install on the source commit instead of a
 * string somebody has to remember to bump (`docs/install-stays-current/routes-and-fixes.md`). The host still knows the exact
 * commit — `installed_plugins.json` records `gitCommitSha` — and this reports the release version beside it.
 *
 * @param pluginRoot the host-provided loaded plugin root
 * @param host the visible supervisor host
 * @returns the exact host-manifest version, package version, or `unknown`
 */
export function pluginVersion({
  pluginRoot,
  host,
}: {
  pluginRoot: string | undefined;
  host: SupervisorHost | undefined;
}): string {
  let hostManifest: string | undefined;
  if (host === "codex") {
    hostManifest = ".codex-plugin/plugin.json";
  } else if (host === "claude-code") {
    hostManifest = ".claude-plugin/plugin.json";
  }
  // A blank root is no root here too, as it is to `observePluginRoot` and `pluginSurface`.
  let resolved: string | undefined;
  if (pluginRoot !== undefined && pluginRoot.trim().length > 0) {
    resolved = physicalRoot({ pluginRoot });
  }
  if (resolved !== undefined && hostManifest !== undefined) {
    const loaded = manifestVersion({ path: join(resolved, hostManifest) });
    if (loaded !== undefined) {
      return loaded;
    }
  }
  const packaged = manifestVersion({ path: new URL("../../../../package.json", import.meta.url) });
  if (packaged === undefined) {
    return "unknown";
  }
  return packaged;
}

/**
 * What the root `doctor` was handed IS, observed once and shared by every line and the JSON report, so two
 * reads of a tree mid-update can never disagree: `none` (no root), `plugin` (the active host's manifest is
 * there), `hook-mirror` (positively one of `scripts/plugin-mirror-sync.sh`'s slots), or `manifestless` (none of
 * those — an install mid-update or a damaged one reads this way, so nothing about it is diagnosed).
 */
export type PluginRootKind = "none" | "plugin" | "hook-mirror" | "manifestless";

/**
 * Observe what a plugin root is, once.
 *
 * The HOOK MIRROR is why this exists. `scripts/plugin-mirror-sync.sh` copies only the hook-executable surface
 * (`MIRRORED_ENTRIES`: no `skills/`, no manifest) so a frozen hook command survives cache replacement, and
 * `bin/slopweaver` exports its own directory as `PLUGIN_ROOT` when the host set none. No host loads skills from
 * that tree — every session loads them from the host's own plugin root (`src/cmux/pluginDir.ts`) — so asking it
 * for skills answered `MISSING (handover, orchestrate, pickup)` and called it a marketplace install, on every
 * boot. Repro: `env -u PLUGIN_ROOT -u CLAUDE_PLUGIN_ROOT ~/.claude/plugins/data/<plugin>/mirror/current/bin/slopweaver doctor`.
 *
 * A missing manifest alone never names the mirror: `codex plugin add` rewrites its cache
 * in place, so a real Codex root can lack its manifest for a few seconds (`src/codexPlugin/sync.ts`). The mirror
 * is identified by its own layout ({@link isMirrorSlotDir}), and the manifest is the ACTIVE host's — either one
 * only when no host was detected at all. An `ambiguous` detection (both hosts' session ids set) is never guessed
 * into either (`src/supervisor/session.ts`), so no manifest proves a load there.
 *
 * @param pluginRoot the root `doctor` was handed, when any
 * @param host the detected visible host, `ambiguous` when both were, `undefined` when neither was
 * @returns the observed kind
 */
export function observePluginRoot({
  pluginRoot,
  host,
}: {
  pluginRoot: string | undefined;
  host: SupervisorHost | "ambiguous" | undefined;
}): PluginRootKind {
  if (pluginRoot === undefined || pluginRoot.trim().length === 0) {
    return "none";
  }
  const resolved = physicalRoot({ pluginRoot });
  if (resolved === undefined) {
    return "manifestless";
  }
  const claude = join(resolved, ".claude-plugin", "plugin.json");
  const codex = join(resolved, ".codex-plugin", "plugin.json");
  let manifests: readonly string[] = [claude, codex];
  if (host === "codex") {
    manifests = [codex];
  } else if (host === "claude-code") {
    manifests = [claude];
  } else if (host === "ambiguous") {
    manifests = [];
  }
  if (manifests.some((path) => existsSync(path))) {
    return "plugin";
  }
  // The layout AND the mirror's one defining absence: `MIRRORED_ENTRIES` never copies `skills/`, so a tree carrying
  // it is a plugin root that merely sits at a slot-shaped path, and keeps its diagnosis.
  // Nor does it copy either manifest, so one standing there — even one an `ambiguous` host could not take as proof
  // of a load — rules the mirror out too.
  // And one positive fact beside the path's shape: its launcher, the only thing that ever hands `doctor` this root
  // — so a regular file at a slot-shaped path is never the mirror.
  const mirror =
    // The layout is a SHAPE of the absolute spelling; `resolved` may be the relative root it agrees with.
    isMirrorSlotDir({ dir: resolve(resolved) }) &&
    isRegularFile({ path: join(resolved, "bin", "slopweaver") }) &&
    !existsSync(join(resolved, "skills")) &&
    !existsSync(claude) &&
    !existsSync(codex);
  return mirror ? "hook-mirror" : "manifestless";
}

/** What `doctor` knows about how it was reached — measured by `runDoctor`, injected so a fixture can stand in. */
export interface PluginLoadEvidence {
  readonly pluginRoot: string | undefined;
  readonly insideAgentHost: boolean;
  readonly pluginsDir: string;
  /** What `pluginRoot` is, observed once by {@link observePluginRoot}. */
  readonly rootKind: PluginRootKind;
}

/** The bundled continuity surface found beneath a proven plugin root. */
export interface PluginSurface {
  readonly hooks: "present" | "missing" | "unconfirmed";
  readonly skills: Readonly<Record<(typeof REQUIRED_CODEX_CONTINUITY_SKILLS)[number], boolean>>;
}

/**
 * Inspect only plugin-owned filenames; no host-private trust store is read or guessed at.
 *
 * @param pluginRoot the exact plugin root supplied by the host, or undefined when unproven
 * @returns presence for the continuity skills and bundled hook file
 */
export function pluginSurface({ pluginRoot }: { pluginRoot: string | undefined }): PluginSurface {
  const root = pluginRoot !== undefined && pluginRoot.trim().length > 0 ? pluginRoot : undefined;
  const resolved = root === undefined ? undefined : physicalRoot({ pluginRoot: root });
  const entries = REQUIRED_CODEX_CONTINUITY_SKILLS.map((name) => [
    name,
    resolved !== undefined && existsSync(join(resolved, "skills", name, "SKILL.md")),
  ]);
  // `as`: Object.fromEntries widens keys to string; we built it from the exhaustive
  // REQUIRED_CODEX_CONTINUITY_SKILLS, so the narrower type is sound.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const skills = Object.fromEntries(entries) as PluginSurface["skills"];
  let hooks: PluginSurface["hooks"];
  if (root === undefined) {
    hooks = "unconfirmed";
  } else if (resolved !== undefined && existsSync(join(resolved, "hooks", "hooks.json"))) {
    hooks = "present";
  } else {
    hooks = "missing";
  }
  return { hooks, skills };
}

/**
 * Render exact plugin-owned continuity files while stating the trust boundary separately. A `hook-mirror` root
 * reports its skills NOT APPLICABLE; a `manifestless` one is still asked, so a damaged install keeps its warning.
 *
 * @param pluginRoot the exact plugin root supplied by the host, or undefined when unproven
 * @param rootKind what that root is, from the one {@link observePluginRoot} read
 * @returns the `plugin surface:` report line
 */
export function pluginSurfaceLine({
  pluginRoot,
  rootKind,
}: {
  pluginRoot: string | undefined;
  rootKind: PluginRootKind;
}): string {
  const surface = pluginSurface({ pluginRoot });
  const missing = Object.entries(surface.skills)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  let skills: string;
  if (pluginRoot === undefined || rootKind === "none") {
    skills = "UNCONFIRMED (no plugin root)";
  } else if (rootKind === "hook-mirror") {
    skills = "NOT APPLICABLE (the hook mirror carries no skills; a host loads them from its own plugin root)";
  } else if (missing.length === 0) {
    skills = `present (${REQUIRED_CODEX_CONTINUITY_SKILLS.join(", ")})`;
  } else {
    skills = `MISSING (${missing.join(", ")})`;
  }
  return `plugin surface: Codex continuity skills ${skills} · hooks bundle ${surface.hooks} · hook trust host-only`;
}

/**
 * The plugin root the host handed this process: Codex's `$PLUGIN_ROOT` when set, else Claude Code's
 * `$CLAUDE_PLUGIN_ROOT`, else none — a bare invocation proves no plugin load, which
 * {@link classifyPluginLoad} reports as such.
 *
 * @param env the process environment
 * @returns the host-provided plugin root, or `undefined` when neither host set one
 */
export function hostPluginRoot({ env }: { env: Readonly<Record<string, string | undefined>> }): string | undefined {
  const codexRoot = env["PLUGIN_ROOT"];
  if (codexRoot !== undefined) {
    return codexRoot;
  }
  return env["CLAUDE_PLUGIN_ROOT"];
}

/**
 * Measure how `doctor` was reached, once: the plugin line, the surface line and the JSON report all read this
 * one answer, so two reads of a tree mid-update can never disagree. `CLAUDECODE` marks a Claude Code session
 * even when no supervisor id was set, and the plugins dir is the active host's own.
 *
 * @param detection the visible-session detection, read for which host is active and whether any is
 * @param env the process environment the host's plugin root and Claude Code's marker are read from
 * @param userHome the user's home directory both hosts' plugins dirs sit under
 * @returns the evidence {@link classifyPluginLoad} and {@link pluginSurfaceLine} judge
 */
export function measurePluginLoad({
  detection,
  env,
  userHome,
}: {
  detection: SupervisorSessionDetection;
  env: Readonly<Record<string, string | undefined>>;
  userHome: string;
}): PluginLoadEvidence {
  const claudeCode = env["CLAUDECODE"];
  const pluginRoot = hostPluginRoot({ env });
  const active = detection.kind === "active" ? detection.session.host : undefined;
  return {
    insideAgentHost: detection.kind !== "missing" || (claudeCode !== undefined && claudeCode.length > 0),
    pluginRoot,
    pluginsDir: join(userHome, active === "codex" ? ".codex" : ".claude", "plugins"),
    rootKind: observePluginRoot({ host: detection.kind === "ambiguous" ? "ambiguous" : active, pluginRoot }),
  };
}

/** How this invocation of the CLI was reached, as far as the runtime can actually prove. */
export type PluginLoadRoute =
  "plugin-dir" | "marketplace" | "hook-mirror" | "manifestless-root" | "unconfirmed" | "outside-agent-host";

/**
 * Classify how the CLI was reached. Agent hosts set `PLUGIN_ROOT` (or the Claude-compatible alias) when the
 * process was launched through the plugin's own wiring, so its presence is real proof of a loaded plugin.
 *
 * Deliberately reports `unconfirmed` rather than "not loaded" when the var is absent but Claude Code is:
 * running `slopweaver` from a bare shell inside a session proves nothing either way, and claiming "not
 * loaded" there would be its own false statement — the very defect class this PR closes. Pure.
 *
 * Only a root carrying the active host's manifest is `marketplace` or `plugin-dir`: the hook mirror lives under
 * the plugins dir's `data/` tree, so the prefix test alone called a mirror launcher a marketplace install
 * ({@link observePluginRoot} carries the repro).
 *
 * @param pluginRoot `$PLUGIN_ROOT` or `$CLAUDE_PLUGIN_ROOT`, when set
 * @param insideAgentHost whether a supported host marks the current visible session
 * @param pluginsDir the active host's plugins directory a marketplace install lives under
 * @param rootKind what that root is, from the one {@link observePluginRoot} read
 * @returns the proven route
 */
export function classifyPluginLoad({
  pluginRoot,
  insideAgentHost,
  pluginsDir,
  rootKind,
}: PluginLoadEvidence): PluginLoadRoute {
  if (!insideAgentHost) {
    return "outside-agent-host";
  }
  if (pluginRoot === undefined || rootKind === "none") {
    return "unconfirmed";
  }
  if (rootKind === "hook-mirror") {
    return "hook-mirror";
  }
  if (rootKind === "manifestless") {
    return "manifestless-root";
  }
  return pluginRoot.startsWith(pluginsDir) ? "marketplace" : "plugin-dir";
}

/**
 * The `plugin:` report line. This exists because the plugin silently failed to load for weeks: `doctor`
 * reported the state home in detail and said nothing about its own presence, so "loaded" and "not loaded"
 * looked identical until something else broke. The fix for a silent failure is a detector.
 *
 * @param route the classified load route
 * @param pluginRoot the resolved plugin root, when one was proven
 * @returns the report line
 */
export function pluginLoadLine({
  route,
  pluginRoot,
}: {
  route: PluginLoadRoute;
  pluginRoot: string | undefined;
}): string {
  let root = "unknown root";
  if (pluginRoot !== undefined) {
    root = pluginRoot;
  }
  if (route === "marketplace") {
    return `plugin: loaded — marketplace install (${root})`;
  }
  if (route === "plugin-dir") {
    return `plugin: loaded — --plugin-dir dev checkout (${root})`;
  }
  if (route === "hook-mirror") {
    return `plugin: load route UNCONFIRMED — ${root} is the hook mirror, a copy of the hook surface only, so no host loaded Slopweaver from it. Check the host's plugin list to confirm Slopweaver is loaded.`;
  }
  if (route === "manifestless-root") {
    return `plugin: load route UNCONFIRMED — ${root} carries no plugin manifest for this host, so it proves no plugin load (an install mid-update or a damaged one reads this way). Check the host's plugin list to confirm Slopweaver is loaded.`;
  }
  if (route === "unconfirmed") {
    return "plugin: load route UNCONFIRMED — PLUGIN_ROOT is unset, so this invocation did not come through the plugin's skills, commands or hooks. Check the host's plugin list to confirm Slopweaver is loaded.";
  }
  return "plugin: not applicable — running outside a supported agent host (no plugin context)";
}
