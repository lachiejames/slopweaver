/**
 * The install, machine and dev-loop nouns of the noun barrel: scaffolding and preflight (`doctor`, `init`,
 * `onboard`, `connect`, `secrets`, `protect`), the machine and its checkouts (`home`, `machine`, `desktop`, `console`, `checkout`,
 * `worktree`, `wait`), the repository's own development verbs (`dev`, `catalog`, `proof`), and the plans, models
 * and routing a session is seated on (`plans`, `claude`, `codex`, `perf`, `velocity`, `route`).
 *
 * `./index.ts` spreads this array into `MANIFEST_MODULES`. A new noun of this family appends ONE row here; a
 * family file nearing the 300-code-line cap splits again rather than growing past it.
 */

import type { NounManifestModule } from "../manifest.js";
import { catalogManifest } from "./catalog.js";
import { checkoutManifest } from "./checkout.js";
import { claudeManifest } from "./claude.js";
import { codexManifest } from "./codex.js";
import { connectManifest } from "./connect.js";
import { consoleManifest } from "./console.js";
import { desktopManifest } from "./desktop.js";
import { devManifest } from "./dev.js";
import { doctorManifest } from "./doctor.js";
import { freshCutManifest } from "./freshCut.js";
import { homeManifest } from "./home.js";
import { initManifest } from "./init.js";
import { machineManifest } from "./machine.js";
import { onboardManifest } from "./onboard.js";
import { perfManifest } from "./perf.js";
import { plansManifest } from "./plans.js";
import { proofManifest } from "./proof.js";
import { protectManifest } from "./protect.js";
import { routeManifest } from "./route.js";
import { secretsManifest } from "./secrets.js";
import { velocityManifest } from "./velocity.js";
import { waitManifest } from "./wait.js";
import { worktreeManifest } from "./worktree.js";

/** The install, machine and dev-loop nouns, each one `{ noun, summary, verbs }` row. */
export const SETUP_MANIFEST_MODULES: readonly NounManifestModule[] = [
  {
    noun: "doctor",
    summary: "Env preflight: plugin version + the resolved state home and its layout",
    verbs: doctorManifest,
  },
  {
    noun: "init",
    summary: "Scaffold $SLOPWEAVER_HOME (idempotent): corpus/knowledge/ledgers dirs + seed files",
    verbs: initManifest,
  },
  {
    noun: "onboard",
    summary: "Render the Slack app manifest and the concurrent per-source refresh plan for a guided cold start",
    verbs: onboardManifest,
  },
  {
    noun: "connect",
    summary: "Preflight a source or live connector: reachability + the exact scopes it needs (`connect --help`)",
    verbs: connectManifest,
  },
  {
    noun: "secrets",
    summary:
      "Persist connector tokens under $SLOPWEAVER_HOME/secrets (0600) — no-echo prompt or piped stdin, never argv",
    verbs: secretsManifest,
  },
  {
    noun: "protect",
    summary:
      "Keep the owner's protected paths in $SLOPWEAVER_HOME/protected-paths.json — read-only or no-access to every session",
    verbs: protectManifest,
  },
  {
    noun: "dev",
    summary: "Repo-development verbs (the PR gate)",
    verbs: devManifest,
  },
  {
    noun: "catalog",
    summary: "List the command surface (human, --json, or --capabilities) from the registry",
    verbs: catalogManifest,
  },
  {
    noun: "route",
    summary: "Plan the current, historical and unavailable sources a visible host should consult",
    verbs: routeManifest,
  },
  {
    noun: "claude",
    summary: "Which of the owner's Claude Max plans the fleet is on, and how much of each budget is left",
    verbs: claudeManifest,
  },
  {
    noun: "codex",
    summary: "Use Codex as a second brain: bounded planning and one-property diff review, streamed and killable",
    verbs: codexManifest,
  },
  {
    noun: "checkout",
    summary: "Keep the main checkouts this install builds on current and correctly installed",
    verbs: checkoutManifest,
  },
  {
    noun: "console",
    summary: "The machinery the local console reads through: several read verbs in one process (`console batch`)",
    verbs: consoleManifest,
  },
  {
    noun: "desktop",
    summary: "The macOS desktop app: install it as /Applications/Slopweaver.app, one copy, open on the main checkout",
    verbs: desktopManifest,
  },
  {
    noun: "perf",
    summary:
      "What the FLEET is costing, with progressive disclosure — one summary line, then a drill-down per seat and per hook",
    verbs: perfManifest,
  },
  {
    noun: "plans",
    summary:
      "ONE register of the destinations a session can be seated on — a row per provider store, which account " +
      "it is called after, and which one a pinned Claude seat boots against",
    verbs: plansManifest,
  },
  {
    noun: "home",
    summary:
      "What sits in $SLOPWEAVER_HOME that no longer earns its keep: the obviously-junk bytes, taken by what a file IS rather than by how old it is, and the ledger of every run that took some",
    verbs: homeManifest,
  },
  {
    noun: "proof",
    summary: "Golden-proof capture recipes for a PR description — real terminal evidence, never a mock-up",
    verbs: proofManifest,
  },
  {
    noun: "worktree",
    summary: "Create, inspect and retire a worktree — its own installed node_modules, never a shared symlink",
    verbs: worktreeManifest,
  },
  {
    noun: "machine",
    summary:
      "Gauges of the machine Slopweaver runs on — top memory footprints, swap and load — and its owner-approved upkeep: reaping orphaned shells and freeing disk",
    verbs: machineManifest,
  },
  {
    noun: "wait",
    summary:
      "One call that waits on a process or a file — the poll loop the poll gate refuses, as a verb on the one wait contract",
    verbs: waitManifest,
  },
  {
    noun: "velocity",
    summary:
      "Trailing-window pace read from git + the local ledgers: merges/day, docs landed/day, doc latency, turns/ask",
    verbs: velocityManifest,
  },
  {
    noun: "fresh-cut",
    summary:
      "One parentless commit over a main commit's tree in a new local repository, then re-derive it and scan every file",
    verbs: freshCutManifest,
  },
];
