# Every seat boots on a setup token, so a sign-in cannot replace a plan

Bundled reference for [plan-routing.md](plan-routing.md), which settles WHICH plan a spawn spends. This page
settles how the seat AUTHENTICATES on that plan.

Every seat boots on a per-plan `claude setup-token`, giving up what an inference-only token cannot do (Claude in Chrome, Remote
Control, claude.ai-hosted MCP connectors, plugin-marketplace sync, Claude Design, claude.ai projects).

## The mechanism

Routing chooses a PLAN from live gauges. When that plan's store directory holds a `setup-token` file, the
pre-spawn gate boots the seat on it instead of on the store:
`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 CLAUDE_SECURESTORAGE_CONFIG_DIR=<unbound> 3<<token file> claude …`.
The token reaches Claude Code on a descriptor, so it is in no argv, `ps` or scrollback — only its path is. A
plan with no token file boots on its store.

## The invariant: no seat's store is a store routing reads

A token seat's store is `claude-accounts/unbound/<seat>`, named by no plan. That matters twice, both read from
the 2.1.272 binary: a `/login` inside the seat writes there and mutates nothing routing depends on; and on a
`401` over an fd token Claude Code ADOPTS whatever unexpired credential the store holds, which from an unbound
store is nothing. A token itself carries no refresh token, so it is never written back and never rotated
([seatToken.ts](../../../src/claude/seatToken.ts)).

## Which plan a seat is on: its descriptor, never `userEmail`

An EMPTY unbound store is the design, and a `claude auth status` run inside a seat answers `loggedIn: false` —
the descriptor is not inherited by a tool's shell. Claude Code's own `userEmail` context comes from
`~/.claude.json`'s `oauthAccount`, which every seat on the machine shares, so it names the last hand `/login` and
never the plan a seat spends. MEASURED: a chair read that address as plan-three and filed a
fall-through while its descriptor 3 was open on plan-five's token and plan-five's Fable week was the one climbing.
Ask `slopweaver claude gauge` (its `*` and `chair:` line), or `lsof -a -p <pid> -d 3 -Fn` for one process.

The telemetry's `organization.id` comes from that same block. Once the default store is signed out (the seat
gate's own remedy) the block is gone and NO request names an organisation, so the chair's metered check prints
UNMEASURED device-wide rather than refusing ([meteredSpend.ts](../../../src/claude/meteredSpend.ts)). That is
the designed state for a token-only fleet. Never `/login` by hand to bring the field back.

## Handing a plan its token

`slopweaver claude token --plan <alias>` takes a token minted elsewhere. It reads the paste from a no-echo prompt
or a pipe, never argv, spends one Fable probe over it, and writes `<store>/setup-token` at `0600` ONLY when the
response carried the plan-wide windows, the Fable week and the account ENROLLED for that alias; any refusal
writes nothing. That is the owner's criterion: the first minted token proves the rate windows and plan identity survive.
`slopweaver claude token --status` says which plans are on a token.

## Minting one: the seat does everything but the owner's code

The seat pre-fills the plan's OWN address, from the enrollment and never guessed, and presses
"Continue with email"; the owner only fetches the verification code from that mailbox and enters it. So the owner never holds
the email-to-plan mapping. The seat runs, in order:

1. `slopweaver claude mint --plan <alias>` in the BACKGROUND. It refuses before starting anything when the plan
   has no enrolled address. It runs `setup-token` in a pty with `BROWSER` pointed at a capture script, so no tab
   opens, and prints the CLI's own authorize URL with `login_hint=<enrolled address>` appended. A URL that
   is not https, not on the authorize path, or not calling back to `localhost` is refused outright. One on a
   host other than `claude.com` is refused too, unless `SLOPWEAVER_ALLOW_CLAUDE_MINT_AUTHORIZE_HOST=1`
   (the vendor moved its host).
2. `slopweaver browser open --url '<that url>'`, then `browser read`: `open`'s first snapshot can be taken
   before claude.ai renders the form. The Email field is already filled from the hint. A Chrome already signed
   in to claude.ai as ANOTHER plan lands on that account's consent page instead: break-glass it and click
   "Switch account" (it signs that account out of claude.ai web only), then re-open the hinted URL.
3. `slopweaver browser break-glass --page '<exact login url from the read>' --reason …`, then
   `browser act --do click` on "Continue with email". claude.ai is unregistered, so every write there is refused
   without that per-page grant. MEASURED: that click timed out on Playwright's stability wait three
   times running, and a `fill` blanked the tab — when it does, the note asks the owner to press Continue too.
4. A [hand](../../hand/SKILL.md) note naming the mailbox: _enter the code sent to <address>, then Authorize_.
5. **Authorize is the owner's press**: claude.ai puts a captcha between Authorize and the callback, and the seat's tab
   reads it `[disabled]`. The captured URL's `redirect_uri` is the CLI's own
   `localhost` callback, so the code goes to the login and nothing is pasted — MEASURED live on
   plan-two: the owner's press reached the callback and the login printed its token.
6. The verb REPLAYS the screen log onto a virtual terminal (`claude/mintScreen.ts`) to read the token, proves
   it exactly as `claude token` does, writes it, and prints neither the token nor the screen. Never strip the
   escapes instead: the login's renderer skips every cell the terminal already holds, so stripping drops the
   token characters that match the previous frame — read that way, that mint's token was refused 401.

MEASURED: the hint alone filled the field, on a Chrome signed in
to claude.ai as another account, which stayed signed in (`from=logout` in the redirect is a label). The URL
`setup-token` PRINTS is the manual one whose callback forces a code paste; the one it hands `BROWSER`
is not. Authorize is enabled per ACCOUNT, and was disabled on `claude-five`; the verb
cannot fix that and times out saying so. Its whole-mint deadline is fifteen minutes, a policy choice for a
code fetched from a mailbox; measured the same day, a plan-two mint whose code was never entered ended at it,
wrote nothing and left no mint directory. A plan must be enrolled first (`claude signin --plan`).

## What changes downstream

The gauge and the routing gate probe a token plan ON its token. A refused token reads `SETUP_TOKEN_REJECTED`,
never `CREDENTIAL_REJECTED`, so the on-demand repair — which refreshes a STORE — cannot fire on it; nothing
repairs a token, and the refusal names the re-mint. A token file that exists and will not read refuses the spawn
rather than booting on the store. `claude watch` touches stores on its own schedule; a token plan does not
depend on it. Residue: each seat's unbound store is a keychain item that stays behind after the seat, and holds
a credential only if someone signed in inside that seat.

## A token cannot read or redeem a free reset

A plan's free usage-limit resets need a `user:profile` sign-in; a setup token is inference-only. `slopweaver
claude reset --plan <alias>` reads them, and `--claim` spends one at a limit (earlier only under
`SLOPWEAVER_ALLOW_EARLY_CLAUDE_RESET=1`), over the plan's OWN store's
sign-in, else the default keychain slot's — each used only once a probe names the plan's enrolled organisation.
MEASURED: the owner's ordinary sign-in as claude-five landed in the default slot and left plan-five's setup
token working (the gauge read it `bound` six minutes later). The default slot holds one plan at a time, so the
lasting route for each plan is `slopweaver claude signin --plan <alias>` in the owner's own terminal — never `/login`
in a seat.

## What `signin --status` proves

MEASURED, both halves inside one minute: the verb printed `5 of 5 live, 5 distinct account(s)` with
`VERIFIED` on every row, while every one of the five plan stores held an emptied credential — access token
length 0, refresh token length 0, `expiresAt` 0. Nothing was wrong with the reading. `probePlan` probes a plan
holding a `setup-token` ON that token and returns before the keychain credential is presented, so the windows
and the accounts were genuinely each plan's, taken over a credential the store does not contain. Reproduce the
credential half with
`security find-generic-password -a "$USER" -w -s "$(the store's service name)" | jq '.claudeAiOauth | {acc: (.accessToken|length), ref: (.refreshToken|length), exp: .expiresAt}'`.

So `VERIFIED` means the STORE's own credential carried the reading, and a live token over a store holding
no login is `TOKEN ONLY` — not complete, so the verb exits non-zero. Two things follow that a reader should
not have to infer. **The plan is fully spendable**: the token is what the fleet spends, so this is not an
outage and the row is `warn`, never red. And **`claude watch`'s keep-alive touches those stores** on
its own schedule, running a refresh command against a credential with no refresh token to present, which can
never do anything; that is the watch's schedule rather than the status verb's business, and it has its own row.

## What `signin --status` says about recency, and what it cannot promise

Every plan takes two lines: the graded row, and a continuation carrying **when this store was last signed
in** and **when the owner is next forced to**. `assertedAtIso` answers neither: it is the ENROLLMENT instant and
`establishAssertion` only ever adds, so an ordinary sign-in into an enrolled store moves nothing (measured: plan-two and plan-three still read their original `assertedAtIso`
a day after the owner signed both in).

- **Recency comes from `claude-accounts/sign-in-log.jsonl`**, appended by `claude signin --plan` and the walk
  the moment the vendor's login exits cleanly, BEFORE anything verifies what landed — a sign-in that then
  failed verification is still a sign-in the owner performed. `--enroll` and `--reenroll` launch no login, so neither
  writes to it. A store with no row reads `no sign-in recorded here yet`, which is a fact about the LOG and
  never a claim about the owner.
- **The deadline is the REFRESH GRANT's expiry, not the eight-hour access expiry.** The access token is a
  cache-miss horizon repairable from a grant with weeks left; the grant expiry is the instant past which no
  refresh works. Absent reads as UNKNOWN, never as "no deadline", and a `token-only` store has no grant of its
  own to expire.
- **It is a deadline a refresh cannot beat, not a promise the credential lives that long** — the caveat is
  printed once under the table. The unexplained `invalid_grant` deaths can force a sign-in sooner.

Two hypotheses were raised and are FALSIFIED, kept so they are not re-raised: the empty-string access-token
guard has not regressed (`credentialHasAccessToken` still gates the store path, and no `Bearer ` goes out), and
the probe is not resolving the DEFAULT keychain slot — `rotation-state.json` recorded five DISTINCT
organisation ids, which one shared slot could not produce.
