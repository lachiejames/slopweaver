# `/slopweaver:onboard` conduct findings — first real trial

One real run against a fresh `$SLOPWEAVER_HOME` sandbox, the owner's own already-authenticated GitHub
credential (via `gh auth login`, no token capture needed), and a genuinely blind roleplay persona (a
separately-spawned agent with no knowledge of this repository, playing "a competent product engineer who has
never used Slopweaver") consulted turn-by-turn as the stand-in for a first-time user. Scoped to GitHub only —
Slack/Linear/Notion require the owner's own live no-echo `secrets set` action, which this pass did not block
on. Each finding below cites the exact step in `skills/onboard/SKILL.md` it relates to, per the handover doc's own
bar for done.

## What's confirmed working

- **Step 1** (`skills/onboard/SKILL.md:23-27`) — `init` scaffolds a fresh home correctly and idempotently; `doctor
--json` reports `initialised: true` with every path/status accurately reflecting the fresh state. Read, not
  guessed.
- **Step 2** (`:29-33`) — repo/org resolution and confirmation read plainly enough that the persona confirmed
  it without hesitation.
- **Step 3** (`:35-53`) — the tier trade-off is presented clearly enough that the persona, given the
  irreversibility framing, **chose `standard` over the recommended `agent`** — the doc's own stated goal
  ("recommend the most capable, name the cost, take whatever they answer without arguing a second time")
  working as intended on a plausible risk-averse first-timer.
- **Steps 9–10** (`:184-216`) — proven for free via `slopweaver seed --demo` → `derive` → `distil status` →
  `store read` (against a loaded store), end to end, zero credentials, in a separate fresh home. This proves the
  mechanics on synthetic data; it does not prove wording/conduct against a real corpus.
- GitHub's "usually unnecessary" token doctrine (`:98-99`) works exactly as documented — the fresh home's
  preflight authenticated via the machine's existing `gh auth login`, no capture step needed.

## Real gaps found

1. **BLOCK — step 6's remediation guidance only covers "auth missing," not "auth present, scope insufficient"**
   (`skills/onboard/SKILL.md:101-116`, `:98-99`). The live preflight against `slopweaver/slopweaver` returned a
   real hard gap: `scope:read:org: missing` (`src/connect/github.ts`'s `readOrgCapability`) — auth reached the
   org fine, but the token lacks `read:org`. Step 5's GitHub guidance says only "capture [a token] if `connect
github --check` reports GitHub auth **missing**" — it has no instruction for the scope-present-but-
   insufficient case, which is exactly what happened. An agent following the doc literally has no scripted
   remediation path here and must improvise.

2. **SHOULD-FIX — the doc never equips the agent with a plain-English gloss of what a requested scope
   actually grants** (`:101-116`). Asked to fix the gap, the persona's very first, entirely plausible question
   was "what exactly does read:org let it see?" — before agreeing to expand any token's scope. The doc's own
   persona-appropriate caution (never let a token touch the chat, name every cost plainly) doesn't extend to
   explaining what a _scope_ actually exposes; the agent had to improvise a correct answer (org/team
   membership, not repo contents) rather than working from anything in the onboard skill.

3. **SHOULD-FIX — a real severity mismatch between the preflight gate and the actual runtime cost**
   (`:101-116` vs. `src/cli/commands/refresh/hydration.ts`). `connect --check` classifies a missing
   `scope:read:org` as `missing`, which `finaliseReport` (`src/connect/types.ts`) flips to `ok:false` — and
   step 6 says plainly: "a capability with `status:missing` is a hard gap — STOP." But the actual downstream
   consequence of that same gap, once `refresh` runs, is that structural/member hydration failure is
   **warning-only** and does not affect `refresh`'s own exit code (per P1's own citation of
   `src/cli/commands/refresh/hydration.ts:44-130`). A first-timer is told to stop everything and go generate a
   new token for a gap whose real runtime cost, if skipped, is a soft warning — not necessarily wrong (gating
   before ingest may be the deliberate, safer choice), but the tension between the two severities is unstated
   and worth a deliberate design answer rather than an implicit one.

4. **SHOULD-FIX — step 3 answers the upgrade cost for `restricted`, not for `standard` → `agent`** (`:48-53`).
   The persona's second question, entirely plausible for someone choosing the safer tier, was "can I start with
   standard and upgrade later?" The onboard skill states plainly that `restricted`'s upgrade "means a new app or
   re-auth" but says nothing about what upgrading `standard` to `agent` costs. In fact it's cheap — re-running
   `slopweaver onboard --tier agent` and editing the **existing** app's manifest (per step 4's "if they already
   run a Slack app... edit that") — but the doc doesn't say so, so an agent again has to improvise rather than
   state a known fact.

5. **NOTE — steps 4–5 and steps 7–8 were not exercised live this pass** (`:55-99`, `:118-182`). Steps 4–5
   (Slack app creation, no-echo token capture) need the owner's own live action and were deliberately deferred,
   not silently skipped. Steps 7–8 (backfill choice, live parallel refresh) were not reached because the run
   stopped for real at step 6's hard gap — fixing it would mean generating a new elevated GitHub token against
   a real account, which this pass declined to do without the owner's explicit, deliberate action. Step 11
   (wrap-up) is consequently also untested live this pass.

6. **NOTE — the "small repo bounds the crawl" premise remains false, reconfirmed** (`src/onboard/plan.ts:73-97`,
   already found by the P1 comprehension pass). `slopweaver/slopweaver` was chosen deliberately as a small,
   low-risk personal org _because of_ this — `onboard plan` always emits `--all-repos` for the resolved org
   regardless of the anchor repo named, so the same trial against a large company org would not have been
   narrow. This mechanism has no dedicated scope cap; treat that as a real, separate risk for any future run
   against a bigger org.

## What this trial deliberately did not test

- Slack, Linear, Notion (need the owner's own live no-echo secret capture).
- Real Slack app creation (step 4) — out of scope per the handover doc's own instruction, a deliberate
  no-API-path design choice, not a gap to close.
- Live parallel refresh / backfill conduct (steps 7–8) against real data.
- The final wrap-up (step 11).
- Genuine first-timer usability signal — the persona is a roleplay, not a real novice; see the checkpoint
  artifact's stated limitation on this point.

## The connect fixture harness

A fixture selector wired into the shipped `connect` binary (`src/connect/fixture.ts`,
`ConnectRuntimeDeps`/`runConnectWithRuntime` in `src/cli/commands/connect/run.ts`), gated behind BOTH
`SLOPWEAVER_ONBOARD_HARNESS=1` and a valid `SLOPWEAVER_CONNECT_FIXTURE` scenario so a stray env var alone can
never divert a real preflight onto a synthetic answer. Every fixture report reuses the real, already-tested
per-source classifiers against a synthetic probe, so it can never drift from what a live preflight would
actually say for the same outcome, and carries an additive `fixture` marker so it can never be mistaken for a
live result. Proven at both the unit level (`src/__tests__/unit/connect/fixture.test.ts`) and against the real
shipped binary (`src/__tests__/subprocess/cli/commands/connect/fixture.test.ts`).
