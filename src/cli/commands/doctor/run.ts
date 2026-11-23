/**
 * `slopweaver doctor` — the environment preflight, and onboarding's first step calls it. Two halves:
 *
 * - **Can this machine run Slopweaver** — the environment probes (`src/environment/`): every binary the code,
 *   hooks and launcher run by name, the Node version against the pin, the Node manager, Docker (the local
 *   store runs in it), and the developer health the owner named (zsh profile, the Datadog agent). Free by
 *   default; `--deep` adds
 *   the three that cost a subprocess or a socket (`src/environment/gather.ts` has the table).
 * - **What state is it in** — the plugin version and load route (`./pluginReport.ts`), the resolved state home
 *   and the presence/emptiness of each part of it, Codex auth/config paths, and main-checkout freshness.
 *
 * Read-only: it reports status, it never scaffolds (that is `slopweaver init`) and it never prints
 * identity/profile CONTENTS — only whether they parse, and for the store's identity roster under `--deep` its
 * revision and record count, through a peek that imports nothing. All paths come from `stateHomePaths`.
 *
 * A FATAL environment probe exits `EXIT_EXPECTED_EMPTY` (3): a prerequisite is absent, which is a signal and
 * not a fault of this verb. Onboarding reads that exit as a finding to explain, never as a wall. Under `--deep` a
 * store that cannot answer for the identity roster exits 3 too: reported, never read as an empty roster.
 *
 * No hook runs `doctor` today, but every caller reaches for it as the cheap look at a machine, so the default
 * run stays boot-safe by design: no fetch, no subprocess, no socket. Anything costlier is behind `--deep`.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mainCheckoutCleanliness } from "../../../admit/mainCheckoutCleanliness.js";
import { cachePaths, slopweaverCacheRoot } from "../../../cacheHome.js";
import {
  type CheckoutFreshness,
  checkoutFreshnessJson,
  renderCheckoutFreshness,
} from "../../../checkouts/freshness.js";
import { inspectCheckout, productionInspectDeps } from "../../../checkouts/inspect.js";
import { withSourceCommit } from "../../../codexPlugin/stamp.js";
import type { EnvironmentProbe } from "../../../environment/facts.js";
import { gatherEnvironmentFacts } from "../../../environment/gather.js";
import { environmentProbes, probeTally } from "../../../environment/probes.js";
import { environmentSection, verdictLine } from "../../../environment/render.js";
import { appendAll } from "../../../lib/arrays.js";
import { readJsonFile } from "../../../lib/jsonFile.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import {
  pendingSelfReviewReservations,
  type SelfReviewPendingReservation,
} from "../../../outbound/github/selfReviewLedger.js";
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { stateHomePaths } from "../../../stateHome.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { type ExecStores, execInodeLine } from "./execInodeReport.js";
import {
  codexAuthLine,
  codexConfigLine,
  dirStatus,
  homeVersionLine,
  identityLines,
  type PeekedIdentityRoster,
  profileLine,
  rosterStoreAbsent,
} from "./homeLines.js";
import { doctorJsonPaths, doctorJsonStatuses, environmentJson } from "./jsonSections.js";
import {
  classifyPluginLoad,
  measurePluginLoad,
  type PluginLoadEvidence,
  type PluginSurface,
  pluginLoadLine,
  pluginSurface,
  pluginSurfaceLine,
  pluginVersion,
} from "./pluginReport.js";
import { DOCTOR_USAGE } from "./usage.js";

/**
 * How long a self-review reservation may sit held before `doctor` calls it a finding.
 *
 * A live round confirms within seconds of the composite mutation returning, so anything still held past this
 * many minutes is a stranded reservation — orphaned by a failed submit with no cleanup, per `self-review
 * release`'s own header — not a round still in flight.
 */
const SELF_REVIEW_STALE_RESERVATION_MINUTES = 15;

/** One held self-review reservation's finding line, minutes rather than raw milliseconds. */
function selfReviewReservationLine({ reservation }: { reservation: SelfReviewPendingReservation }): string {
  const minutes = Math.floor(reservation.ageMs / 60_000);
  return `  ${reservation.locus} — held ${String(minutes)}min for head ${reservation.headSha} (reserved ${reservation.reservedIso}); release with \`slopweaver github self-review release\` once you've confirmed via \`github read\` what actually landed`;
}

/** The self-review reservation section: silent when clean, one line per stranded hold otherwise. */
function selfReviewReservationSection({
  reservations,
}: {
  reservations: readonly SelfReviewPendingReservation[];
}): readonly string[] {
  if (reservations.length === 0) {
    return [];
  }
  return [
    `self-review: ${String(reservations.length)} reservation(s) held past ${String(SELF_REVIEW_STALE_RESERVATION_MINUTES)}min — likely stranded`,
    ...reservations.map((reservation) => selfReviewReservationLine({ reservation })),
  ];
}

/**
 * Everything `doctor` can say about the directory it is standing in: the two lines that read `cwd`.
 *
 * Both are skipped for a `cwd` that has nothing to report — outside a repository, or in a main worktree with
 * no `node_modules` — so an ordinary run elsewhere never asserts anything about an unrelated checkout.
 *
 * @param cwd the directory `doctor` is running in, or undefined when the caller has none
 * @param stores the cache root's exec store and the home's pre-move one
 * @returns the lines that apply, in display order
 */
function cwdSection({ cwd, stores }: { cwd: string | undefined; stores: ExecStores }): readonly string[] {
  return [mainCheckoutLine({ cwd }), execInodeLine({ cwd, ...stores })].filter(
    (line): line is string => line !== undefined,
  );
}

/**
 * The main-checkout cleanliness line — present only when `cwd` resolves to a repository's own main worktree
 * (never for a linked worktree, or a directory outside any repository), so an ordinary `doctor` run outside
 * this repository never asserts anything about an unrelated checkout. This is the loud, early surfacing half
 * of the cross-tool coverage `src/admit/mainCheckoutCommitGuard.ts`'s header describes: an interactive
 * Codex session's raw file edit is invisible to every `PreToolUse`/git-hook guard until someone looks — this
 * is that look, taken every time `doctor` runs.
 *
 * @param cwd the directory `doctor` is running in, or undefined when the caller has none to report against
 * @returns the report line, or undefined when there is nothing to say
 */
function mainCheckoutLine({ cwd }: { cwd: string | undefined }): string | undefined {
  if (cwd === undefined) {
    return undefined;
  }
  const cleanliness = mainCheckoutCleanliness({ cwd });
  if (cleanliness === undefined) {
    return undefined;
  }
  return cleanliness.dirty
    ? `main checkout: DIRTY (${String(cleanliness.entries)} change(s) at ${cwd}) — commit belongs in a dedicated worktree, not here`
    : "main checkout: clean";
}

/**
 * The main-checkout section: one block per declared checkout, or one line saying none are declared.
 *
 * Declared-none prints a line rather than nothing, because an empty section and a healthy one look identical
 * and only one of them means anything was checked. The measurements arrive already taken (see
 * {@link runDoctor}) so this stays a pure renderer, and they are taken WITHOUT fetching — the default run
 * stays boot-safe (see the header). `slopweaver checkout status --fetch` is the networked one.
 *
 * @param checkouts the already-measured declared checkouts
 * @param nowMs the current wall-clock in milliseconds, for the fetch-age lines
 * @returns the section's lines
 */
function mainCheckoutSection({
  checkouts,
  nowMs,
}: {
  checkouts: readonly CheckoutFreshness[];
  nowMs: number;
}): readonly string[] {
  if (checkouts.length === 0) {
    return ["main checkouts: none declared — add `mainCheckouts` to profile.json (see docs/main-checkouts.md)"];
  }
  return [
    "main checkouts (refs as last fetched; `slopweaver checkout status --fetch` refreshes them):",
    ...checkouts.flatMap((freshness) => renderCheckoutFreshness({ freshness, nowMs })),
  ];
}

/** What both report builders read — measured by {@link runDoctor}, injected so a fixture can stand in. */
export interface DoctorInput {
  readonly home: string;
  readonly envHome: string | undefined;
  /** The cache root the exec store sits under — outside the home, so reported beside it rather than in it. */
  readonly cacheRoot?: string;
  readonly version: string;
  readonly plugin: PluginLoadEvidence;
  readonly codex: { authPath: string; configPath: string };
  readonly cwd?: string;
  readonly checkouts?: readonly CheckoutFreshness[];
  readonly nowMs?: number;
  readonly environment?: readonly EnvironmentProbe[];
  readonly deep?: boolean;
  /** The store roster's row as peeked under `--deep`; absent on the default run, which reaches no store. */
  readonly identityRoster?: PeekedIdentityRoster;
}

/**
 * Build the doctor report lines for a specific home. Does read-only fs probes against `home` (no writes),
 * so it is exercised by a fixture round-trip test without any mock.
 *
 * @param home the state home to report on
 * @param envHome the raw `$SLOPWEAVER_HOME` (for the "unset — using default" line), or undefined
 * @param cacheRoot the cache root holding the exec store, this process's own when omitted
 * @param version the plugin version string
 * @param plugin the plugin-load evidence (`$CLAUDE_PLUGIN_ROOT`, `$CLAUDECODE`, the plugins dir)
 * @param codex where the Codex auth and config files would be — reported as paths and presence only
 * @param cwd the directory `doctor` is running in, for the main-checkout cleanliness line — omitted (and
 *   the line skipped) when undefined
 * @param checkouts the already-measured declared main checkouts, for the freshness section — defaulted so a
 *   caller with nothing to report (and every existing fixture test) renders the "none declared" line
 * @param nowMs the current wall-clock in milliseconds, for that section's fetch-age lines
 * @param environment the graded environment probes, already run (see {@link runDoctor}) so this stays a
 *   fixture-testable renderer — defaulted to none, which renders no section and leaves the verdict `ok`
 * @param deep whether the costed probes ran, for the section header
 * @param identityRoster the store roster's row as `--deep` peeked it; absent on the default run
 * @returns the report lines, in display order
 */
export function doctorReport({
  home,
  envHome,
  cacheRoot = slopweaverCacheRoot(),
  version,
  plugin,
  codex,
  cwd,
  checkouts = [],
  nowMs = 0,
  environment = [],
  deep = false,
  identityRoster,
}: DoctorInput): readonly string[] {
  const paths = stateHomePaths({ home });
  const cache = cachePaths({ root: cacheRoot });
  const lines = [
    `slopweaver v${version}`,
    ...environmentSection({ deep, probes: environment }),
    pluginLoadLine({ pluginRoot: plugin.pluginRoot, route: classifyPluginLoad(plugin) }),
    pluginSurfaceLine({ pluginRoot: plugin.pluginRoot, rootKind: plugin.rootKind }),
    `SLOPWEAVER_HOME: ${envHome !== undefined && envHome.length > 0 ? envHome : `unset — using default ${paths.root}`}`,
    homeVersionLine({ path: paths.homeVersion }),
    `cache (rebuildable, outside the home): ${cache.root}`,
    `corpus: bronze ${dirStatus({ path: paths.corpus.bronze })} · silver ${dirStatus({ path: paths.corpus.silver })} · gold ${dirStatus({ path: paths.corpus.gold })} · history ${dirStatus({ path: paths.corpus.history })}`,
    `knowledge: ${dirStatus({ path: paths.knowledge })}`,
    `ledgers: ${dirStatus({ path: paths.ledgers })}`,
    ...identityLines({ path: paths.identityJson, stored: identityRoster }),
    profileLine({ path: paths.profileJson }),
    `hygiene-denylist.txt: ${existsSync(paths.hygieneDenylist) ? "present" : "missing (no private denylist)"}`,
    codexAuthLine({ path: codex.authPath }),
    codexConfigLine({ path: codex.configPath }),
  ];
  // A pre-rename home has an orphaned `warehouse/`; the medallion root is `corpus/` now. Heads-up, not a fault.
  if (existsSync(join(paths.root, "warehouse"))) {
    lines.push(
      "note: a legacy `warehouse/` dir is present — the corpus root is now `corpus/`; re-run refresh/derive/distil to repopulate it.",
    );
  }
  const stores = { execStore: cache.execStore, homeExecStore: paths.homeExecStore };
  appendAll({ from: cwdSection({ cwd, stores }), into: lines });
  appendAll({ from: mainCheckoutSection({ checkouts, nowMs }), into: lines });
  appendAll({
    from: selfReviewReservationSection({
      reservations: pendingSelfReviewReservations({
        home,
        nowMs,
        olderThanMs: SELF_REVIEW_STALE_RESERVATION_MINUTES * 60_000,
      }),
    }),
    into: lines,
  });
  lines.push(verdictLine({ probes: environment }));
  return lines;
}

/**
 * The MACHINE-READABLE doctor report — a stable, value-free shape the `/slopweaver:onboard` slash command
 * branches on. It reports paths + presence/parse statuses ONLY: never a secret value, never identity or
 * profile CONTENTS (profile carries only `present-valid`/`present-invalid`/`missing`; identity only
 * `retired-file-present`/`retired-file-absent`, or under `--deep` `store-row`/`store-no-row`/`store-unreadable`).
 * Read-only.
 *
 * @param home the state home to report on
 * @param envHome the raw `$SLOPWEAVER_HOME` (or undefined when unset)
 * @param cacheRoot the cache root holding the exec store, this process's own when omitted
 * @param version the plugin version string
 * @param plugin the plugin-load evidence (`$CLAUDE_PLUGIN_ROOT`, `$CLAUDECODE`, the plugins dir)
 * @param codex where the Codex auth and config files would be — paths and presence only, never contents
 * @param cwd the directory `doctor` is running in, for the `mainCheckout` status — "unknown" when undefined
 * @param checkouts the already-measured declared main checkouts — defaulted to none for the same reason
 *   {@link doctorReport}'s is
 * @param nowMs the current wall-clock in milliseconds, for the self-review reservation ages — defaulted to
 *   0 for the same reason {@link doctorReport}'s is
 * @param environment the graded environment probes, defaulted to none as {@link doctorReport}'s is
 * @param deep whether the costed probes ran
 * @param identityRoster the store roster's row as `--deep` peeked it; absent on the default run
 * @returns the structured report
 */
export function doctorJsonReport({
  home,
  envHome,
  cacheRoot = slopweaverCacheRoot(),
  version,
  plugin,
  codex,
  cwd,
  checkouts = [],
  nowMs = 0,
  environment = [],
  deep = false,
  identityRoster,
}: DoctorInput): {
  readonly version: string;
  readonly home: string;
  readonly cacheRoot: string;
  readonly envHome: string | null;
  readonly pluginRoot: string | null;
  readonly codexContinuitySkills: PluginSurface["skills"];
  readonly environment: ReturnType<typeof environmentJson>;
  readonly initialised: boolean;
  readonly mainCheckouts: readonly {
    readonly path: string;
    readonly behind: number | null;
    readonly install: string;
    readonly needsAttention: boolean;
  }[];
  readonly selfReviewStrandedReservations: readonly SelfReviewPendingReservation[];
  readonly paths: Readonly<Record<string, string>>;
  readonly statuses: Readonly<Record<string, string>>;
} {
  const paths = stateHomePaths({ home });
  const cache = cachePaths({ root: cacheRoot });
  const homeVersion = readJsonFile({ path: paths.homeVersion });
  const surface = pluginSurface({ pluginRoot: plugin.pluginRoot });
  return {
    cacheRoot: cache.root,
    codexContinuitySkills: surface.skills,
    envHome: envHome !== undefined && envHome.length > 0 ? envHome : null,
    environment: environmentJson({ deep, probes: environment }),
    home,
    initialised: isRecord(homeVersion) && typeof homeVersion["version"] === "number",
    mainCheckouts: checkouts.map((freshness) => checkoutFreshnessJson({ freshness })),
    paths: doctorJsonPaths({ paths }),
    // `rootKind` decides, so a whitespace root reads `null` here exactly as it reads `none` in the statuses.
    pluginRoot: plugin.pluginRoot === undefined || plugin.rootKind === "none" ? null : plugin.pluginRoot,
    selfReviewStrandedReservations: pendingSelfReviewReservations({
      home,
      nowMs,
      olderThanMs: SELF_REVIEW_STALE_RESERVATION_MINUTES * 60_000,
    }),
    statuses: doctorJsonStatuses({ codex, cwd, execStore: cache.execStore, identityRoster, paths, plugin, surface }),
    version,
  };
}

/**
 * The `doctor` verb: probe the machine, report the install, and exit 3 when an environment probe is fatal.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runDoctor(argv: readonly string[]): Promise<number> {
  const rest = new Set(argv.slice(3));
  if (rest.has("--help") || rest.has("-h")) {
    logger.out({ line: DOCTOR_USAGE });
    return EXIT_OK;
  }
  const deep = rest.has("--deep");
  const envHome = process.env["SLOPWEAVER_HOME"];
  const home = stateHomePaths().root;
  const detection = detectSupervisorSession({ env: process.env });
  const host = detection.kind === "active" ? detection.session.host : undefined;
  const plugin = measurePluginLoad({ detection, env: process.env, userHome: homedir() });
  const { pluginRoot } = plugin;
  const version = withSourceCommit({ pluginRoot, version: pluginVersion({ host, pluginRoot }) });
  // Injected rather than resolved inside the builders, exactly as `pluginsDir` is, so both stay testable
  // against a fixture instead of against whatever this machine happens to have.
  const codex = {
    authPath: join(homedir(), ".codex", "auth.json"),
    configPath: join(homedir(), ".codex", "config.toml"),
  };
  const cwd = process.cwd();
  // The CHEAP rung: the default run may not fetch, read a working tree, or scan references — measured, not
  // preferred: the thorough rung took 90 seconds on a real repository. Everything the cheap rung skipped
  // prints as unchecked, and the section names `checkout status --fetch` as the version that looks.
  const inspectDeps = productionInspectDeps();
  const checkouts = mainCheckoutsFromProfile({ home }).map((config) =>
    inspectCheckout({ config, deps: inspectDeps, depth: "cheap" }),
  );
  const environment = environmentProbes({ facts: await gatherEnvironmentFacts({ deep }) });
  // Only `--deep` reaches the store, and only to PEEK: the default run stays boot-safe, and neither rung imports.
  const report = {
    checkouts,
    codex,
    cwd,
    deep,
    envHome,
    environment,
    home,
    identityRoster: deep ? await identityRosterPort().peek({ home }) : undefined,
    nowMs: Date.now(),
    plugin,
    version,
  };
  const fatal = probeTally({ probes: environment }).fatal > 0 || rosterStoreAbsent({ stored: report.identityRoster });
  if (rest.has("--json")) {
    logger.out({ line: JSON.stringify(doctorJsonReport(report), null, 2) });
    return fatal ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  logger.out({ line: doctorReport(report).join("\n") });
  return fatal ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

export const doctorRunCommand = defineCommand({ run: runDoctor });
