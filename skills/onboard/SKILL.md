---
name: onboard
description: One guided cold-start — connect GitHub/Slack/Linear/Notion/Gmail, plus the live Outlook and Datadog connectors (create the Slack app, make the Google OAuth client, capture keys safely), pick the backfill, build the whole corpus, land a first grounded answer, mine their history into candidate workstreams to react to, and end on the Alignment page. Use on a fresh install, when no corpus exists yet, or when the user asks how to set Slopweaver up or connect a source. Phrases like "set this up", "get started", "connect Slack", "I have no corpus", "onboard me".
argument-hint: "[owner/repo]"
---

Guide the user through **one** cold-start setup of their local world model: pick the tools, connect each, capture
every key **safely**, choose the backfill depth, then pull GitHub + Slack + Linear + Notion + Gmail, build silver +
gold, and land a first grounded answer.

**Five sources, not four.** Gmail is a peer of the other four — same connect step, preflight, backfill choice and
first answer — bar three things, each stated where it bites: a Google OAuth client whose **secret is shown once**; a
browser, once, for Google's consent; and `refresh --all-sources` skips it (`--source gmail`). **Outlook** (a personal
Microsoft mailbox) is a LIVE connector beside them: never crawled, no backfill, an Entra registration's client id then
ONE consent. What the verb prints comes from `src/onboard/sources.ts`; run it rather than restating it here.

**The chat is the wizard — you drive it.** No Slopweaver command ever blocks the terminal on input.

**Never let a token touch this chat.** Do not ask the user to paste a token into the conversation, and never
echo one. Tokens are pasted into a secure field on the console's queue card and written `0600` under
`$SLOPWEAVER_HOME/secrets/` — they never reach the transcript, an argv, or the repo, and the user never has to work
out which command to run.

The bundled CLI is `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver"`. The flow is **idempotent + resumable**: a re-run skips
what is done and resumes each crawl from its watermarks.

## 1 — Environment first, then scaffold the home

Run `slopweaver doctor --deep --json` BEFORE choosing sources; exit 3 (a `fatal` probe) is a finding, **never a wall**.
Per `environment.probes` entry not `ok`: say `says`, offer its `fix` now (recommended) or continuing at the cost
`withoutFix` names. **Docker is REQUIRED**: absent → Docker Desktop, and recommend local-only port binding before step 9
makes containers; `supabase-cli`'s fix is `yarn install`. Then `slopweaver init`. [Per probe, and pins](reference/environment.md).

## 2 — Resolve the repo + org

Use `$ARGUMENTS`' `owner/repo`, else `origin`; confirm it, then ask for the whole **organisation block** in one
message and write it with `slopweaver org set`, each absent provider stated none ([org](../org/SKILL.md)).

## 3 — Access level: recommend AGENT, name its risk, offer the safer rungs in the same breath

This is a **capability-versus-risk trade the user makes** — never one you make for them, and never one you
force. Present all three, recommend the most capable, and state the cost of the recommendation in the same
message. We do not force the risky thing, and we do not quietly withhold the capable thing.

- **`agent`** (recommended) — everything: read + write, a bot that answers a channel tag **and** a direct
  message, posting as the bot and **as you**, plus Slack's Agents panel. **Say plainly that this is the least
  secure of the three**: it grants write scopes on the user's own token, so a message slopweaver sends is
  indistinguishable from one they typed. **And say, at the point they choose, that enabling the Agents panel
  CANNOT BE UNDONE** — workspace guests lose access to the app, and there is no setting that reverts it.
- **`standard`** — the same bot, the same posting, **without** the Agents panel, so every part of it can be
  undone by editing the app. The right answer for someone who wants the assistant but not a one-way door.
- **`restricted`** (the smallest grant) — ingest only. This whole flow, plus `derive`, `distil` and the
  `store` read verbs, works identically on it; it gives up posting and being tagged, and since the app has
  no bot user at all, moving up later means a new app or a re-auth.

Ask which they want. Recommend `agent`, state its cost in the same message, and take whatever they answer
without arguing for the safer rung a second time.

## 4 — Create the Slack app, and (Gmail only) the Google OAuth client

Slack is the only source that needs an app, Gmail the only one that needs an OAuth client. Guide the user
through both — do NOT auto-create either. `slopweaver onboard --tier <agent|standard|restricted>` renders
the Slack manifest from the same scope declarations the code uses, so it cannot drift; **paste it into a NEW
app**, because a manifest applied to an existing one replaces its whole configuration and revokes every
omitted scope. If they already run an app with these scopes, send them to its **App Manifest** editor.

For Gmail, say all of it **before** they open the page, because two of the three cannot be recovered
afterwards — in particular **the client secret is shown ONCE**, in the dialog that appears the moment the
client is created, and the only recovery is to delete the client and make another. Tell them to save the
client ID and secret to their password manager before closing that dialog. Outlook's Entra registration has no
secret, and an existing one admitting personal accounts is reused. All three: [creating-the-apps](reference/creating-the-apps.md).

## 5 — Capture each token (a paste field on the console, never in chat)

Per source, post ONE hand step: `--url` the page its token is minted on, `--literal` its `secrets set <name>` lines.
The card draws a secure paste field per name; they paste, press Set, and it answers `set <name>`, never the value.
`--shot` plus a `--box` per thing to click draws the page above the fields in red. Onboarding has the owner paste
secrets into the console, so they never have to work out which commands to run. **Datadog** is live, not a corpus: set `profile.json`'s `datadog.site` first (no default), then one card for both
keys, whose pages DERIVE from the site. **Say an application key carries its minter's own permissions**, so colleagues
see different data. Per source, and the per-site key pages: [reference/capturing-tokens.md](reference/capturing-tokens.md).

## 6 — Preflight each source (the gate)

Run `slopweaver connect <source> --check --json` per chosen source (Datadog, Outlook too) and branch on the JSON. A capability
with `status:"missing"` is a **hard gap** — STOP, show the user the exact capability and its `detail`, and loop back to
steps 4–5. A `status:"warning"` means reduced breadth: proceed with their ok. Gmail's report is mostly per scope,
because a consented grant can be valid and narrower than asked — say which verbs each declined scope costs. Datadog's
checks the site and both keys live, and its `mint` gap names the key pages for their site. Outlook's names which half is
missing (`registration` or `auth`) and proves the grant with one live `GET /me`.

## 7 — Choose the backfill depth

Ask how far back to pull: recommend **all** — everything reachable, because the workstreams mine (step 10b) reads it
and a half-baked corpus is where trust goes — or **90 days**, **30**, **180**, or a `YYYY-MM-DD`. **For Gmail, price
`all` first**: `slopweaver gmail measure` reports the count, oldest date and bytes in seconds. **The world model holds
the window they pick and nothing older**, extended by every refresh. Datadog has no backfill: it is queried live.
Reports and per-source commands: [reference/preflight-and-backfill.md](reference/preflight-and-backfill.md).

## 8 — Pull every source IN PARALLEL (watch them stream)

Ask the live planner for the exact commands, then launch the bundled CLI once per returned `commands[].argv`:

```bash
slopweaver onboard plan --sources github,slack,linear,notion,gmail --backfill 90 \
  --repo <owner/repo> --github-org <owner> --json
```

**This verb is the command authority** — do not reconstruct a combined `refresh --all-sources` call or
hand-edit source-specific flags.

> **Launch each refresh in the BACKGROUND, ALL AT ONCE — do NOT block, do NOT serialise.** A source crawl
> takes many minutes, so foreground or one-after-another means the user waits N× as long seeing only a
> spinner. Start **every** chosen source backgrounded together, then poll their outputs every ~20–30s and
> relay the newest heartbeat from each until all exit. Total ≈ the slowest source, not the sum.

Parallel is SAFE: each source writes only its own bronze files, watermark and cursors, so two finishing at
once cannot clobber each other's resume state, and if one fails the others keep what they committed.
**`refresh --all-sources` means the four org-shared surfaces and NEVER the mailbox** — Gmail is reached by
naming `--source gmail`. What each run streams, the flags for other windows, and the full-history resume
behaviour: [reference/pulling-sources.md](reference/pulling-sources.md).

## 8b — If Gmail was pulled, scan the bronze the redaction wrote

`slopweaver audit hygiene --source gmail` — nothing else checks the redaction pass's OUTPUT. A **credential** is a
secret the scrub missed and exits non-zero: show the locations and stop. An **identifier** or a **private-denylist
word** is reported and never gates. It prints locations, never the matched text; never paste the record back. The
three arms in full: [reference/pulling-sources.md](reference/pulling-sources.md).

## 9 — Build silver, and see what gold would cost

1. `slopweaver derive` — deterministic silver (identity/person graph, directory, structure, opportunities). Report counts.
2. `slopweaver distil status` — free, no model call: the gold batch plan (total/cached/remaining) and what the next
   batch's prompt would discard. Report it.

**Gold has no automatic completion path, and a cold full-window corpus can be thousands of batches — say so rather
than promising a step that finishes.** Under rule 2 `distil` calls no model: it hands this session one batch at a time
(`distil brief` → you compose the digest → `distil answer`). Offer a few as a demonstration; `distil status` shows the rest.

**This does not block the next step.** `store read` and `store cite` read the STORE, not gold: run `slopweaver store load`
once bronze exists, a new store being `yarn store:start` then `slopweaver store push` (`store status` says how if none).

## 9b — Offer to harden the store (optional, once it is up)

Docker stays; say _by the way, to make it more secure_: ports on loopback, the service key `0600`, and Docker access
IS store access. Check each live, say what it removes and leaves: [reference/securing-the-store.md](reference/securing-the-store.md).

## 10 — First grounded answer

`store read` needs no prebuilt index (no vector or locally-built lexical index); it needs
the store from step 9. It never composes an answer itself — only a visible session may, and this is one. Run it here:

1. `slopweaver store read "what has the team shipped recently?"` — selects what Postgres full text matches (newest
   first, nothing ranked) and prints a fan-out plan, one shard per reader; no answer, no model.
2. Dispatch the readers, collect their replies, then `slopweaver store collect --plan <plan> --replies
<replies>` — a finding is kept only when its quote is verbatim in its own shard.
3. Compose the answer from what was kept, citing only the tokens the plan offered; show them it + citations.

## 10b — Mine their history into candidate workstreams, before the reveal

`slopweaver onboard workstreams` says where it stands: `pull`, `mine`, `react` or `answered`, and whether the
console has something real to show. On `mine`, YOU mine every pulled source — one is enough, Notion alone included
— into candidates with dated quotes of their own words, definitions of done with trade-offs, what stalled and who
to loop in, then `workstreams candidates-put`. On `react`, send them to `/workstreams#candidates`. The brief:
[reference/mining-workstreams.md](reference/mining-workstreams.md).

## 11 — The mailbox their NEXT assistant plan signs up on

Optional. A plan should sign up on an address the ORGANISATION owns, the same shape for everybody — pass `--identity
<name> --mailbox-zone <zone>` and the step prints their two addresses. **`onboard` writes none of it.** One zone-wide
`alias catch-all` needs no credential on anybody's laptop and gives every address ONE shared destination; per-person
delivery is `alias provision` per seat and needs `Zone · Email Routing Rules · Edit`, an admin credential. Which to
recommend and what each costs: [reference/the-mailbox.md](reference/the-mailbox.md).

## 12 — Wrap up

Summarise: sources connected, window pulled, written/deduped counts, the derive result, what `distil status` says
remains, the hardening each step reached, the first answer and the candidates mined. Then `/slopweaver:store`, and
re-running `/slopweaver:onboard` to extend the window forward. Everything stays on their machine.

If they took an **`agent`** or **`standard`** Slack app, mention `slopweaver listen`: the bot answers a **tag** or a
**DM**, in-thread, through **their** lens whoever asked, so not in a channel whose members should not see their corpus.
Needs a `slack-app-token` (App-Level Tokens, `connections:write`).

## 13 — Last: align what it knows with them

Everything above is rough knowledge, not yet aligned with them. End on the console's `/alignment` page, which says so;
it asks nothing about their voice, which is learnt from their sent Slack: [reference/alignment.md](reference/alignment.md).

Optional target repo: $ARGUMENTS

## Running this from Codex

In Codex `${CLAUDE_PLUGIN_ROOT}` is not substituted: resolve this `SKILL.md` on disk, take the plugin root two
directories above it, and invoke `<plugin-root>/bin/slopweaver` by absolute path — never bare `slopweaver`, which
an ambient `PATH` may point at another checkout. The visible Codex thread does every reasoning step and never
invokes a headless model; confirm installation with `codex plugin list`; keep secrets out of output and files;
and create or consult no Linear ticket, because this is local personal tooling.

Report each live connector as proven, missing, or failed. Do not call an untested connector ready.
