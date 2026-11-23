# When a plan reads "no login"

The sign-in half of [plan-routing.md](plan-routing.md): what a plan row's login state means, and the one verb
that walks the owner through fixing it.

**Name the ACCOUNT beside every plan**, **with its trust word**: a bare address came from an ENROLLMENT,
`CACHED` needs `--reenroll`, `UNMAPPED` means fix the row; a sign-in ask spells the [whole address](../../hand/reference/waiting-on-a-sign-in.md#a-plan-sign-in-names-the-plans-email-address).

That step stays the owner's hand. **Point the owner at `slopweaver claude signin`**: it walks each plan needing one, waits for
the right Chrome profile to be FOREGROUND (the login opens in the frontmost), re-probes and names the account that
landed; `--plan <alias>`, `--status`, `--page`. Never silently run the fleet on one plan while others are logged out.

**`--status` is the session's read, and it launches nothing.** A read flag (`--status`, `--json`, `--page`, `--out`)
beside `--plan` or `--enroll` is refused at parse time, and `--out` without `--page` too: a
session's `--status --plan plan-five` once routed to the sign-in and opened a browser tab. A login also refuses to
launch from a process with no terminal on stdin. That narrows, it does not authenticate: a terminal on stdin
proves terminal-shaped input, never a human, so a session still runs `--status` alone and never `--plan`.

**A row is not a boolean, and that is the point of the verb.** MEASURED: two stores held a keychain
item and no login, so a presence check called both green; and `plan-one` was live, spendable and holding a
DIFFERENT account from the one recorded for it, so a liveness check called a broken slot green too. So
`signin` grades eight states, four because a two-state row would have been wrong — `rate-limited` is signed in
(only 401/403 are credential refusals; a 429 still carries the windows), `unverified` it could not read this
pass, `duplicate` is one account in two stores, and `token-only` is live on a `setup-token` over a store
holding no login, so `VERIFIED` means the STORE's own credential carried the reading.

**Completion is four live, four DISTINCT, each enrolled, each on its OWN login** — not four greens, so a
`token-only` plan exits non-zero ([setup-tokens.md](setup-tokens.md)). It is also the precondition for the owner's
acceptance test (90% on Fable and weekly across all four — the register's `acceptanceAtPercent`, 90 by
default), `unmeasurable` until every plan carries a reading.

Identity follows the owner's two-phase ruling: the first run after a sign-in records what landed, every
run after that CHECKS it, and a mismatch reads as changed rather than being silently re-recorded.
`establishAssertion` refuses to overwrite a standing enrollment, so re-running a row is idempotent and a
partial walk can simply be restarted. `--plan`, `--enroll` and the walk NEVER replace one: a mismatch prints the
registered `identity-reenroll` refusal. The one deliberate replacement is `slopweaver claude signin --reenroll
<alias,...>` — it binds the account already live in each named store, launches no login, and judges the whole
set at once, because swapped stores are a permutation no one-at-a-time order clears (measured). It
refuses when a store has no enrollment or two, is unreadable, or would share an account with another alias.
Every path that can write reads the enrollments file strictly first, because a write stores the whole file: one
that is unreadable, malformed, names an unconfigured store or holds a non-ISO instant refuses and writes nothing.

## Proving the mechanism is not proving the week

**One store repaired on demand proves the MECHANISM** (expiry strictly advanced, second probe answered); **the owner's
bar is a week-long acceptance test** — seven days, four plans, no sign-in — that no pull request can satisfy. Observed
`invalid_grant` deaths are unexplained, so a 27-day grant does not guarantee seven days, and no record says
when the owner last signed in (`establishAssertion` only ADDS), so the week is not yet measurable. That record is its own row.
