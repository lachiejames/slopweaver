/**
 * The closed domain vocabulary of the knowledge register, as committed data. The lookups that join it to the
 * atlas platforms and this install's own domains are `./domainVocabulary.ts`.
 *
 * ## Why the vocabulary is closed
 *
 * The vocabulary is closed because the open one had grown to 428 domains, 212 of them used once, and `ci` / `slopweaver-ci` / `github-ci` /
 * `github-actions` are one domain. A validated-but-open slug let every session coin its own spelling of one
 * system, so a `--domain ci` recall missed three quarters of the CI lessons and the id — a hash of the domain
 * and the claim (`./row.ts`) — split one lesson into four series. Measured on the live table, after a hygiene
 * pass had pruned it: 1484 recordings across 347 domains, 188 of them used once. Reproduce with
 * `slopweaver knowledge export --out <file>` then
 * `jq -rs 'group_by(.domain) | map(length) | "\(length) \(map(select(. == 1)) | length)"' <file>`.
 *
 * ## Why a new platform is still recordable without editing this file
 *
 * The one argument for an open set was that it must not refuse the first lesson about the next platform. The
 * vocabulary is therefore {@link KNOWLEDGE_DOMAINS} PLUS every atlas platform `../atlas/registry.ts`
 * registers: adding an atlas adds its domain, and a generic platform with no atlas is one line below. Anything
 * else is refused with the list, never guessed at.
 *
 * ## Why an organisation's own systems are not in this file
 *
 * This repository is generic to any checkout (AGENTS.md § no organisation names), so a domain naming one
 * installation's own repository, and every alias folding into it, is STATE: it lives in
 * the installation's store, written by `slopweaver knowledge domains add` and read through `./domainPort.ts`. Every judgement in `./domainVocabulary.ts` takes that install vocabulary as a required
 * field and joins it to the committed one; an install alias may fold into a committed domain as well as into its
 * own.
 *
 * ## Why an alias is refused rather than rewritten
 *
 * {@link KNOWLEDGE_DOMAIN_ALIASES} maps every retired spelling to the domain it folded into. A writer who types
 * one is REFUSED, naming the domain to use, rather than silently rewritten: the house rule is no silent
 * fallback (`.claude/rules/typescript-patterns.md`), and a writer who learns the canonical name once does not
 * type the alias again. The same map is the migration plan `knowledge domains --migrate` applies to rows
 * written before the vocabulary closed.
 *
 * A restore deliberately does NOT consult this file: a backup restores what was, and the migration then
 * canonicalises it. The table carries no CHECK constraint on `domain` for the same reason, and because the
 * vocabulary grows by a code edit where a CHECK would need a migration per new domain.
 *
 * ## Where the rows live
 *
 * The domain rows are below, alphabetical by slug. The retired spellings live in two alphabetical ranges,
 * `./domainAliasesAtoP.ts` and `./domainAliasesQtoZ.ts`, which this file spreads in range order into the one
 * {@link KNOWLEDGE_DOMAIN_ALIASES}. A new domain is one more row below; a new alias goes in the range file its
 * key begins in. A file nearing 300 code lines splits again.
 */
import { KNOWLEDGE_DOMAIN_ALIASES_A_TO_P } from "./domainAliasesAtoP.js";
import { KNOWLEDGE_DOMAIN_ALIASES_Q_TO_Z } from "./domainAliasesQtoZ.js";

/** One named domain, and what belongs in it. */
export interface KnowledgeDomainEntry {
  /** The slug a writer passes as `--domain`. */
  readonly slug: string;
  /** What a lesson filed here is about — what a writer reads to choose. */
  readonly holds: string;
}

/**
 * Every named domain, alphabetical. Atlas platforms join these through `./domainVocabulary.ts`.
 *
 * A plain `readonly KnowledgeDomainEntry[]` rather than an `as const` tuple, for the reason
 * `./memory.ts`'s `MEMORY_PLACEMENTS` gives.
 */
export const KNOWLEDGE_DOMAINS: readonly KnowledgeDomainEntry[] = [
  { holds: "Airwallex, read through the owner's Chrome", slug: "airwallex" },
  {
    holds: "the atlas kit itself — walks, descriptors, coverage; a platform's own lesson goes under the platform",
    slug: "atlas",
  },
  { holds: "automations — recipes, the scheduler and resyncs", slug: "automations" },
  {
    holds: "the fleet briefing and the pages the owner reads — decision pages, proposals, artifacts, reported counts",
    slug: "briefing",
  },
  { holds: "the browser verbs — Playwright, screenshots, visual evidence", slug: "browser" },
  {
    holds: "CI on any repository — GitHub Actions workflows, required checks, the merge queue's run, dev-gate",
    slug: "ci",
  },
  { holds: "the Claude Code host — plugin, hooks config, transcripts, sessions, keep-alive", slug: "claude-code" },
  { holds: "cmux workspaces, spawns and the sidebar", slug: "cmux" },
  { holds: "Codex passes, the fallback and review", slug: "codex" },
  { holds: "CodeRabbit reviews", slug: "coderabbit" },
  { holds: "the local console app and its voice (talk)", slug: "console" },
  { holds: "the corpus — refresh, ingest, compaction, derive, the world model", slug: "corpus" },
  { holds: "dependency bumps, Renovate, Dependabot and vulnerability fixes", slug: "dependencies" },
  { holds: "the `yarn lint` gates, oxlint and ratchets", slug: "devlint" },
  { holds: "Docker and Docker Hub", slug: "docker" },
  { holds: "how the fleet works — AGENTS.md rules, canon, skills, agent instructions", slug: "doctrine" },
  { holds: "Fathom recordings", slug: "fathom" },
  { holds: "Google Cloud — GCS, IAM, Pulumi", slug: "gcp" },
  { holds: "git itself — worktrees, rebases, local stacks", slug: "git" },
  { holds: "Google Workspace APIs — Gmail, Calendar, Drive, Meet, OAuth", slug: "google" },
  { holds: "floating notes and hand steps", slug: "hand" },
  { holds: "the board — runs, asks, handover docs and their journals", slug: "handover" },
  { holds: "HiBob", slug: "hibob" },
  { holds: "the PreToolUse gates — raw bash, the poll gate, admit, the main-checkout guard", slug: "hooks" },
  { holds: "people and access — who someone is, sign-in, account access", slug: "identity" },
  { holds: "the knowledge register and Claude memory hygiene", slug: "knowledge" },
  { holds: "the bot — Slack turns, the listener, answers, dispatch, replay", slug: "loop" },
  { holds: "this Mac — macOS, processes, disk, the home directory, the shell, filesystem locks", slug: "machine" },
  { holds: "how to measure, verify and reason — evidence, counts, refutations", slug: "method" },
  { holds: "OpenAI and ChatGPT — the realtime voice, the live API", slug: "openai" },
  { holds: "outbound forms and doors — what a send may carry and where it goes", slug: "outbound" },
  { holds: "model plans — accounts, caps, credentials, routing and spend across Claude and Codex", slug: "plans" },
  { holds: "review asks, reviewer choice and review findings", slug: "review" },
  { holds: "the route planner", slug: "routing" },
  { holds: "credentials under the home's secrets directory, and the hygiene scan", slug: "secrets" },
  { holds: "the docs site", slug: "site" },
  { holds: "the Slopweaver CLI and repository as a whole, when no narrower domain fits", slug: "slopweaver" },
  { holds: "the local Postgres store — schema, migrations, backups, restore", slug: "store" },
  {
    holds: "a store detective's own lessons (skills/knowledge/reference/detective-lessons.md)",
    slug: "store-detective",
  },
  { holds: "the supervisor chair, seats, sweeps, monitors and the fleet", slug: "supervisor" },
  { holds: "the vitest lanes, cassettes, fixtures and replay", slug: "testing" },
  { holds: "TypeScript, Node, Yarn and build tooling", slug: "toolchain" },
];

/**
 * Every retired spelling, and the domain it folded into.
 *
 * The A-through-P range (`./domainAliasesAtoP.ts`) then the Q-through-Z range (`./domainAliasesQtoZ.ts`), spread
 * in that order so the keys stay alphabetical. A key is never itself a domain — `domains.test.ts` holds that,
 * and that every value is one.
 */
export const KNOWLEDGE_DOMAIN_ALIASES: Readonly<Record<string, string>> = {
  ...KNOWLEDGE_DOMAIN_ALIASES_A_TO_P,
  ...KNOWLEDGE_DOMAIN_ALIASES_Q_TO_Z,
};
