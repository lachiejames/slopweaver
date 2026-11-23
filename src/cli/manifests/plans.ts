/**
 * Lazy manifest for the `plans` noun — the ONE register of destinations a session can be seated on, whichever
 * provider serves it.
 *
 * `effect: "local-state"` on every verb but one: every write lands in `$SLOPWEAVER_HOME/plans.json` and its generated
 * `claude-accounts/accounts.json` projection. Nothing here handles a credential — a row names a store directory and
 * the token behind it stays the provider CLI's business. `connect` asks the provider's own CLI to sign a store in
 * (its browser page, its token, its file), the same classification `claude signin` carries. The one `external-read` is
 * `sync-accounts`, which asks each Codex store's own app-server which account it is signed into, the
 * account-usage read `docs/security/data-flow.md` lists, and writes only the answer's address onto the row.
 *
 * `plans validate` is the noun's one `diagnostic: true` verb: its non-zero exit REPORTS a finding (a
 * projection an older checkout's writer edited out from under the register), not a broken tool.
 */

import { plansUsage } from "../commands/plans/plansUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** The `plans` noun's verbs as lazy manifest entries. */
export const plansManifest: Readonly<Record<string, VerbManifestEntry>> = {
  adopt: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansAdoptCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans adopt",
      summary:
        "Write the picture this install already has down as its register — the Claude plans the user signed in " +
        "to, and nothing found on the machine — so every later change has something to change",
      usage: plansUsage({ verb: "adopt" }),
    },
  }),
  add: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansAddCommand),
    meta: {
      ...sharedMeta,
      // The store directory is spelled ABSOLUTE here because the verb refuses anything else: a provider CLI
      // resolves a relative path against its own cwd, so `~/.codex-two` would be a different, empty
      // credential depending on where the verb ran. An example a caller cannot paste is worse than none.
      example:
        "slopweaver plans add --provider codex --plan codex-two --store-dir /Users/you/.codex-two " +
        "--email security@example.com",
      summary:
        "Register one more destination — the provider that serves it, a neutral local alias, the store " +
        "directory its own CLI is signed into, and optionally the usage limit (--percent) bound from the start. " +
        "Prints the sign-in line; never performs one",
      usage: plansUsage({ verb: "add" }),
    },
  }),
  connect: lazy({
    load: () => import("../commands/plans/connectRun.js").then((m) => m.plansConnectCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans connect --provider codex --json",
      summary:
        "Sign one more plan in from the console with no terminal: opens the provider's own sign-in page in the " +
        "browser and returns at once, while a background worker waits for the sign-in and registers the plan. " +
        "Codex today; Claude answers not built yet",
      usage: plansUsage({ verb: "connect" }),
    },
  }),
  "connect-cancel": lazy({
    load: () => import("../commands/plans/connectRun.js").then((m) => m.plansConnectCancelCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans connect-cancel --id 0123abcd4567ef89 --json",
      summary: "Stop a plan sign-in `plans connect` started; one that already ended is answered as it stands",
      usage: plansUsage({ verb: "connect-cancel" }),
    },
  }),
  "connect-worker": lazy({
    load: () => import("../commands/plans/connectRun.js").then((m) => m.plansConnectWorkerCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans connect-worker --id 0123abcd4567ef89",
      summary:
        "The background half of `plans connect`, launched by it and never by hand: holds the sign-in open until " +
        "it ends, then registers the plan",
      usage: plansUsage({ verb: "connect-worker" }),
    },
  }),
  connections: lazy({
    load: () => import("../commands/plans/connectRun.js").then((m) => m.plansConnectionsCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans connections --json",
      summary:
        "Where each provider's last console sign-in stands — starting, waiting on the browser, connected, failed " +
        "and why, or cancelled; one still active past its deadline reads interrupted",
      usage: plansUsage({ verb: "connections" }),
    },
  }),
  lapse: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansLapseCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans lapse --provider claude --plan plan-two --on 2026-11-17T00:00:00Z",
      summary:
        "Record when one destination's paid subscription ends, so every plan reading names its lapse. " +
        "Informational: it never pauses or reroutes the plan",
      usage: plansUsage({ verb: "lapse" }),
    },
  }),
  list: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansListCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans list --provider codex",
      summary:
        "The install's routing and alert thresholds, each marked set or default, then every registered " +
        "destination, its provider, what its account is called, whether it is pinned or paused, and where its store lives, " +
        "then whether each provider's lane fills (two or more plans standing) or runs lean (one)",
      usage: plansUsage({ verb: "list" }),
    },
  }),
  pause: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansPauseCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver plans pause --provider claude --plan plan-two --reason "the subscription lapsed"',
      summary:
        "Take one destination deliberately out of the fleet, with the reason every surface then prints " +
        "instead of the provider refusal it would otherwise show on every read",
      usage: plansUsage({ verb: "pause" }),
    },
  }),
  pin: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansPinCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans pin --provider claude --plan plan-one",
      summary: "Choose which Claude destination a PINNED seat boots against — Codex has no pinned seat and refuses",
      usage: plansUsage({ verb: "pin" }),
    },
  }),
  remove: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansRemoveCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans remove --provider claude --plan plan-two",
      summary:
        "Take one destination off the register entirely — a subscription dropped or an account replaced. Its " +
        "store directory and sign-in stay on disk and a running seat keeps running; its alias may come back only " +
        "at that same store, so a different account takes a new alias",
      usage: plansUsage({ verb: "remove" }),
    },
  }),
  "set-email": lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansSetEmailCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans set-email --provider claude --plan plan-two --email owner@example.com",
      summary:
        "Correct the address one destination's account is called — a display label, never its identity; a " +
        "Codex row's is also written by `plans sync-accounts` from the store's own answer",
      usage: plansUsage({ verb: "set-email" }),
    },
  }),
  "set-store-dir": lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansSetStoreDirCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans set-store-dir --provider claude --plan plan-two --store-dir /Users/owner/.claude-two",
      summary:
        "Re-home one destination at a new store path — the same account moved, after a machine move say — keeping " +
        "its alias and everything keyed on it. The sign-in never follows a path, so sign in again there",
      usage: plansUsage({ verb: "set-store-dir" }),
    },
  }),
  unpin: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansUnpinCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans unpin --provider claude --plan plan-five",
      summary:
        "Take the pin off a Claude destination without moving it, so no plan is pinned — what lets the last " +
        "Claude plan be paused",
      usage: plansUsage({ verb: "unpin" }),
    },
  }),
  "clear-lapse": lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansClearLapseCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans clear-lapse --provider claude --plan plan-two",
      summary: "Forget the lapse recorded on one destination, so it reads `lapse UNRECORDED` again",
      usage: plansUsage({ verb: "clear-lapse" }),
    },
  }),
  resume: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansResumeCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans resume --provider claude --plan plan-two",
      summary: "Put a paused destination back in the fleet",
      usage: plansUsage({ verb: "resume" }),
    },
  }),
  "set-thresholds": lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansSetThresholdsCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans set-thresholds --provider claude --route-at-percent 94 --acceptance-at-percent 89",
      summary:
        "Set or reset the install's own bars for one provider — when routing stops sending a plan work, when a " +
        "card is raised, when a week may be spent out — in one atomic write; --reset <flag> hands a field back " +
        "to its default, and an ordering the gates cannot honour is refused",
      usage: plansUsage({ verb: "set-thresholds" }),
    },
  }),
  "set-usage-limit": lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansSetUsageLimitCommand),
    meta: {
      ...sharedMeta,
      example:
        "slopweaver plans set-usage-limit --provider claude --plan plan-one --percent 40 --allowance weekly-window --from 30",
      summary:
        "Record the share of one plan Slopweaver may take — 10 to 100 percent of its week, or of its monthly " +
        "spend limit — a ceiling every route stops at and no override crosses. A Claude plan's monthly spend is " +
        "judged off its hour-fresh `claude spend` reading; a Codex one is NOT MEASURED and takes no autonomous work",
      usage: plansUsage({ verb: "set-usage-limit" }),
    },
  }),
  "sync-accounts": lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansSyncAccountsCommand),
    meta: {
      ...sharedMeta,
      effect: "external-read",
      example: "slopweaver plans sync-accounts",
      summary:
        "Ask each registered Codex store which account it is ACTUALLY signed into, record that address on its " +
        "row, and print the sign-in line for every store that is not signed in",
      usage: plansUsage({ verb: "sync-accounts" }),
    },
  }),
  usage: lazy({
    load: () => import("../commands/plans/usageRun.js").then((m) => m.plansUsageCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver plans usage",
      summary:
        "Every registered plan's recorded weekly usage, its reset and whether it needs a sign-in, read off this " +
        "machine's own records (the gauge snapshots, the probe records, each Codex store's rollout logs); asks no model host",
      usage: plansUsage({ verb: "usage" }),
    },
  }),
  validate: lazy({
    load: () => import("../commands/plans/run.js").then((m) => m.plansValidateCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      example: "slopweaver plans validate --repair-projection",
      summary:
        "Report what the register says and whether the generated Claude projection still matches it — and " +
        "with --repair-projection, regenerate that copy from the register, which is authoritative",
      usage: plansUsage({ verb: "validate" }),
    },
  }),
};
