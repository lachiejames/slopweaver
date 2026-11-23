# API keys are not a second set of plans

Scoping answer for the ask _"hold API keys from each account in the secrets store and auto-switch to the
next key when one is exhausted"_. Everything below was measured against Claude Code **v2.1.261** on this machine, and every claim carries the command that reproduces it.

The short version: **Claude Code fully supports API-key auth, and using it would take the fleet OFF the three
Max plans rather than rotate between them.** The rotation this repository ships (`slopweaver claude gauge` /
`route` / `seat`, one credential store per plan chosen through `CLAUDE_SECURESTORAGE_CONFIG_DIR`) is the
mechanism the idea was reaching for, and it works on the credential that actually carries a plan budget. What
the idea DOES surface is a real, silent foot-gun, closed by
[`src/claude/ambientCredential.ts`](../src/claude/ambientCredential.ts).

## 1 · What Claude Code supports

It supports every shape the ask names. Reproduce with:

```bash
strings -a ~/.local/share/claude/versions/2.1.261 | grep -n "from the saved claude.ai login"
```

and read the ten lines above the hit. They are the CLI's own credential-source labels, in its own order:

| #   | Source                                 | Configured by                                            |
| --- | -------------------------------------- | -------------------------------------------------------- |
| 1   | `ANTHROPIC_API_KEY`                    | an environment variable — **the per-launch env var**     |
| 2   | `apiKeyHelper`                         | a command in Claude Code's `settings.json`, on a TTL     |
| 3   | the saved `/login` API key             | `claude` itself                                          |
| 4   | `ANTHROPIC_AUTH_TOKEN`                 | an environment variable                                  |
| 5   | `CLAUDE_CODE_OAUTH_TOKEN`              | an environment variable — a SUBSCRIPTION credential      |
| 6   | the OAuth token file descriptor / file | `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`                    |
| 7   | **the saved claude.ai login**          | a credential store — **what this repo's rotation moves** |

The CLI groups the three configurable non-OAuth ones itself, in its managed-policy refusal: _"an
Anthropic-issued credential (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `apiKeyHelper`) is configured.
A non-OAuth Anthropic credential cannot satisfy the org pin."_ So the mechanism exists, it is stable, and a
wrapper around the launcher is not even needed — an env var on the `cmux spawn` is enough.

**`claude auth status` is not an oracle for any of this.** Measured: with a fake `ANTHROPIC_API_KEY` exported
it still reports `authMethod: "claude.ai"`, `subscriptionType: "max"`, because it reads the STORE and not the
credential a request would present. That is the same display cache that
[`ambientCredential.ts`](../src/claude/ambientCredential.ts) already classifies, and which selecting a store
cannot change.

## 2 · Why it is not a second set of plans

**An API key is a Console ORGANISATION credential, billed per token. A Max plan's budget rides the OAuth
credential and nothing else.** So three keys minted from three Max accounts are three metered API bills, not
three plan budgets — there is no 5-hour or 7-day window on a key to exhaust, and therefore nothing for an
auto-switch to switch ON.

The premise the idea rests on is that keys and plans are the same budget reached two ways. They are not, and
the wire says so: an OAuth credential goes on `Authorization: Bearer` with the OAuth flag in
`anthropic-beta` (the exact value is `OAUTH_BETA`, `src/claude/resetStatus.ts`), an API key on `x-api-key`. Converting between them is a different request, not a different
key.

## 3 · The detection signal disappears — on BOTH lanes

This is the part that makes an API-key fleet unrunnable rather than merely differently-billed.

**The proactive lane goes blind.** [`usage.ts`](../src/claude/usage.ts) reads the
`anthropic-ratelimit-unified-{5h,7d}-*` family, which is the SUBSCRIPTION window. An API-key response carries
the classic per-minute families instead. Measured against the CLI's own bundle:

```bash
V=~/.local/share/claude/versions/2.1.261
strings -a $V | grep -c anthropic-ratelimit-unified        # 68
strings -a $V | grep -c anthropic-ratelimit-requests       # 0
strings -a $V | grep -c anthropic-ratelimit-input-tokens   # 0
strings -a $V | grep -c anthropic-ratelimit-tokens         # 0
```

Claude Code does not know the API-key families exist. Neither does this repository, and `usage.ts` fails
closed on an unrecognised shape by design — so under a key the gauge reports `USAGE_SHAPE_CHANGED`, which
reads like a provider change and is not one.

**The reactive lane already refuses.** [`transcriptSignal.ts`](../src/claude/transcriptSignal.ts) classifies
exactly two refusals an API key can produce — a spend cap (`hit your individual spend limit`, 26× in this
machine's transcripts) and a per-model cap (`reached your <model> limit`, 9×) — as **`ignored`**, and it is
right to: neither is a plan limit, and rotating on one burns a healthy plan. So an API-key fleet produces no
signal the trigger will act on, by a rule that predates this question.

## 4 · What it costs rule 2, and what it does not

**A per-launch env var costs rule 2 nothing.** `cmux spawn` still opens a visible, interruptible workspace;
the env var changes which credential that visible session presents, not whether the owner can see it. There
is no headless model anywhere in the shape.

**`apiKeyHelper` is the shape to refuse.** It is a command Claude Code executes ITSELF, from inside its own
transport, on a `CLAUDE_CODE_API_KEY_HELPER_TTL_MS` refresh, with no verb, no door and no ledger entry. That
is not a rule-2 violation — no model runs — but it is a rule-3 one: a credential path outside the door.

**The real cost is elsewhere, and it is silent.** `ANTHROPIC_API_KEY` outranks every store. Export it and
every session on the machine keeps working, looks identical, and stops spending the plans the owner pays for,
whichever plan's store a spawn was routed to.

## 5 · What was built

Not the auto-switch — there is nothing to switch. The guard that makes the existing rotation honest:

- **`src/claude/ambientCredential.ts`** — pure: classify an environment as `subscription` or `shadowed`, and
  name the source. Blank counts as unset, because the CLI's own reader is a truthiness test.
- **No credential is ever copied between keychain slots** (`src/claude/keychain.ts` § Why there is no
  writer here): a spawn picks a plan's store (`spawnStore.ts`) and a seat pins one (`seatPinning.ts`). An API
  key outranks whichever store a session boots against, and the way past is to unset the variable, which is
  why there is no flag.
- **`claude gauge` reports the ambient credential**, in the `--json` document and on stderr, so a reader
  cannot take three healthy plan readings for three healthy plans of fleet runway.
- **A session's turn is refused when it is not on a plan** (the owner's ruling: fail loudly, with an escape
  hatch). `slopweaver claude seat`, the `UserPromptSubmit` hook, reads this ambient credential FIRST
  and then what the session booted on (`src/claude/seatBoot.ts`): a key, the default `/login`, or a store no plan
  names blocks the prompt before a request is spent; a setup token never does, being a subscription credential. For a stray default-store login it names
  `env -u CLAUDE_SECURESTORAGE_CONFIG_DIR claude auth logout`; hatch `SLOPWEAVER_ALLOW_UNROUTED_SEAT`. A `/login`
  INSIDE a plan-store seat stays the chair telemetry gate's to see (`src/supervisor/chairMetered.ts`). That
  logout also deletes `~/.claude.json`'s shared `oauthAccount`, the only place Claude Code stamps a request's
  `organization.id` from. After it, no request on the machine names an organisation, so the telemetry gate reads
  a missing one as metered only when the same device named an organisation after the session's absence began, and
  otherwise prints UNMEASURED (`src/claude/meteredSpend.ts` § Absence is read against a baseline). Measured: every plan seat
  read METERED until the baseline existed.

## 6 · The one shape that WOULD be worth building, and why it is not built here

`ClaudeRotationDecision`'s `all-exhausted` is a first-class outcome the fleet waits out. An API-key overflow
tier would turn that stall into metered spend, which is the only thing an API key is genuinely good for here.
The trade is predictable seat capacity against explicitly authorised metered overflow.

It is not built because **spend that is not already authorised is tier 3**
([cross-session-messages.md](../.claude/rules/cross-session-messages.md)), and no ruling on this row covers
it. It needs one sentence from the owner, not a design pass: _should an exhausted fleet fall through to a metered
API key rather than wait for the earliest reset?_ If yes, the secrets-store shape is one name per account
(`anthropic-api-key-<alias>`, alongside the existing allowlist in `src/secrets/names.ts`), the selection
change is a new decision kind beside `all-exhausted`, and the gauge for that lane is a spend read rather than
a window read.
