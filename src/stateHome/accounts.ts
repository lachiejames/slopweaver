/**
 * The model accounts area of the state-home contract: the plan register, the Claude and Codex quota, sign-in,
 * reset and burn records, and the auto-memory mirror.
 *
 * Part of the one `$SLOPWEAVER_HOME` contract tree, composed by `../stateHome.ts`, which is the only module that
 * imports it. A new path here is a field on {@link AccountsStateHomePaths} and a line in its resolver.
 */

import { join } from "node:path";

/** The accounts area's fields of {@link ../stateHome.StateHomePaths}. */
export interface AccountsStateHomePaths {
  /**
   * `$home/codex-quota.json` — a cap attributed to no destination, which nothing reads.
   *
   * It is one machine-wide record from before a cap was a fact about an ACCOUNT, and an install that hit a
   * limit then still holds it. Declared here so every plan register read can report it as
   * `UNKEYED_QUOTA_UNATTRIBUTED` rather than let a real piece of evidence go quiet: every quota read is
   * {@link codexQuotaDir} now. The path is never written, and a read reports it instead of deleting it —
   * a read that removed state would destroy the only copy of whatever it was reporting.
   */
  readonly codexQuotaJson: string;
  /**
   * `$home/codex-quota/` — one `<alias>.json` per REGISTERED Codex destination, and the ONLY quota cache
   * any reader consults.
   *
   * A record here says a destination is refusing to spend, so `cmux spawn --driver codex` can fast-fail
   * before booting a workspace it already knows cannot respond. A backstop, not the primary source:
   * `codex/quotaLog.ts` reads that destination's OWN rollout log for a fresher signal every time and the
   * fresher evidence wins (`codex/quotaGate.ts`). Written by the post-boot check in `cmux/pickupDelivery.ts`,
   * cleared by `slopweaver codex quota clear --plan <alias>` or a one-off `--force` bypass.
   *
   * Alias-scoped because one file per machine cannot say WHICH destination was capped: with two homes
   * registered, a cap detected on one would refuse a spawn routed to the other, and clearing the cap on the
   * second would erase the first's evidence. The cache is addressed by the register's alias rather than by
   * the store path, so a path holding a separator or a space cannot produce a filename nobody intended.
   */
  readonly codexQuotaDir: string;
  /**
   * `$home/codex-signin/` — the retired import directory of the Codex sign-in observations: one `<alias>.json`
   * per registered Codex destination, written before the store's `codex_sign_in_observation` rows held them.
   *
   * Never written. `codex/signInRecordStore.ts` reads an alias's file ONCE, when the store holds no row for that
   * alias, and imports it; after that the row is the authority and the file is never read again. The rows are
   * filed by `codex/fleetRead.ts` after its live batch and read by the `codex-plan-signed-out` monitor
   * (`monitor/codexSource.ts`). Alias-scoped for the same reason as {@link codexQuotaDir}.
   */
  readonly codexSignInDir: string;
  /**
   * `$home/codex-reset/claims.jsonl` — every `codex reset` attempt's idempotency key, journalled before the
   * consume exchange, and the outcome the provider answered it with. Written and read by
   * `codex/resetJournalStore.ts`, so a retry settles the SAME attempt rather than spending a second reset.
   */
  readonly codexResetClaimsJsonl: string;
  /**
   * `$home/codex-pass-extensions/extensions.jsonl` — every review pass past the two-pass cap the pinned supervisor
   * approved, one row per extra pass, naming the run, branch, lane and reason. Written by `codex extend` and read
   * by the review-pass cap (`codex/passExtensionStore.ts`), so a seat's third pass needs no owner card.
   */
  readonly codexPassExtensionsJsonl: string;
  /**
   * `$home/claude-reset/claims.jsonl` — every `claude reset` claim's request id, journalled before the claim is
   * sent, and the answer or close that settled it. Written and read by `claude/resetJournalStore.ts`.
   */
  readonly claudeResetClaimsJsonl: string;
  /**
   * `$home/claude-memory` — one `<project-dir>/` per Claude Code auto-memory corpus, mirrored from
   * `~/.claude/projects/<project-dir>/memory/` so the authored class carries it. `store/fleet/claudeMemoryMirror.ts`.
   */
  readonly claudeMemory: string;
  /**
   * `$home/plans.json` — every destination a session can be seated on, Claude and Codex alike, as a
   * PROJECTION of the store's `plan_register` row, which is the authority (`src/plans/storePort.ts`). A read
   * finding no row imports this file ONCE; from then on it is regenerated from the committed row, as is
   * `claude-accounts/accounts.json` from its Claude rows (`src/plans/projection.ts`).
   *
   * Absent with no row means nothing has been adopted, which is a legitimate install rather than a failure: the
   * reader DERIVES the same picture from the Claude accounts file alone — the plans the user signed in to, never a
   * login found in `$CODEX_HOME` — and says it did.
   */
  readonly plansJson: string;
  /**
   * `$home/claude-accounts/accounts.json` — the Claude rows of {@link plansJson}, GENERATED from it.
   *
   * It stays a bare array in exactly the shape `parseClaudeAccounts` already reads, so a seat running an
   * older checkout keeps working; `src/plans/projection.ts` says why, and why a read reports divergence
   * rather than healing it. Never hand-edit it — change the register with the `plans` verbs.
   */
  readonly claudeAccountsJson: string;
  /**
   * `$home/claude-accounts/drawdown.jsonl` — every plan-limit reading the watch has taken, and every
   * investigation it opened off one. The detector's baseline IS this history: a gauge probe answers what the
   * utilization is now, and until this journal existed nothing remembered the answer, so there was no way to
   * ask whether the current pace is unusual (`claude/drawdownAnomaly.ts`).
   */
  readonly drawdownJsonl: string;
  /**
   * `$home/codex-burn/drawdown.jsonl` — every Codex rate-limit reading the burn watch has taken, and every
   * investigation it opened off one. The Codex twin of {@link drawdownJsonl}, and a SEPARATE journal rather
   * than a source field on that one: the two carry different scales (Codex's 0..100 against Claude's 0..1)
   * and different series identities, so one file would mean every reader of either had to filter first
   * (`codex/drawdownAnomaly.ts`).
   */
  readonly codexBurnJsonl: string;
  /**
   * `$home/codex-burn/claims/` — one file per episode the burn watch has claimed, created with
   * `O_CREAT | O_EXCL`.
   *
   * A DIRECTORY rather than a file, and that is the mechanism rather than a layout choice: the atomicity
   * this depends on is an exclusive create on ONE path, so two foreground watches deciding to investigate in
   * the same instant are settled by the kernel. A shared list file would need a lock around every append,
   * which is the read-then-append race being avoided (`codex/drawdownJournalStore.ts`).
   */
  readonly codexBurnClaims: string;
  /**
   * `$home/codex-supersessions.jsonl` — IMPORT SOURCE ONLY: the supersession register's old file, read once
   * into the store's `codex_supersession` table and never written again (`src/codex/supersessionPort.ts`).
   */
  readonly codexSupersessionsJsonl: string;
  /**
   * `$home/codex-fallback` — the LEGACY source of `store import-fleet --only codex-fallback`, and read by
   * nothing else: one directory per Claude fallback review or plan, written before the store became their
   * authority (`codex/fallbackPort.ts`). Once imported it may be removed.
   */
  readonly codexFallback: string;
  /**
   * `$home/codex-accounts/` — one `<alias>/` Codex store per plan Settings → Models' Connect signed in, each `0700`
   * and created exclusively by the Connect that reserved it (`plans/connectPlan.ts`, `plans/connectCodexStore.ts`).
   * The credential inside is Codex's own `auth.json`, which nothing in Slopweaver reads.
   */
  readonly codexAccountsDir: string;
}

/**
 * Resolve the accounts area under one home. Pure: no I/O.
 *
 * @param home the resolved Slopweaver home
 * @returns the accounts area's fields, rooted at `home`
 */
export function accountsStateHomePaths({ home }: { home: string }): AccountsStateHomePaths {
  return {
    claudeAccountsJson: join(home, "claude-accounts", "accounts.json"),
    codexQuotaDir: join(home, "codex-quota"),
    codexQuotaJson: join(home, "codex-quota.json"),
    codexSignInDir: join(home, "codex-signin"),
    codexResetClaimsJsonl: join(home, "codex-reset", "claims.jsonl"),
    codexPassExtensionsJsonl: join(home, "codex-pass-extensions", "extensions.jsonl"),
    claudeResetClaimsJsonl: join(home, "claude-reset", "claims.jsonl"),
    claudeMemory: join(home, "claude-memory"),
    plansJson: join(home, "plans.json"),
    codexSupersessionsJsonl: join(home, "codex-supersessions.jsonl"),
    codexFallback: join(home, "codex-fallback"),
    codexAccountsDir: join(home, "codex-accounts"),
    drawdownJsonl: join(home, "claude-accounts", "drawdown.jsonl"),
    codexBurnJsonl: join(home, "codex-burn", "drawdown.jsonl"),
    codexBurnClaims: join(home, "codex-burn", "claims"),
  };
}
