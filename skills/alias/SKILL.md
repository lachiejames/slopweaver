---
name: alias
description: Provision the organisation-owned mailboxes an assistant plan signs up on — `<identity>-claude-<n>@<zone>` and `<identity>-codex-<n>@<zone>` forwarding rules, and the zone catch-all, written through Cloudflare Email Routing on a zone the work account already holds. Use when a new Claude or Codex plan needs an identity that is not somebody's personal address, when an existing alias has to be read back or retired, when a zone needs its catch-all switched on so no per-seat step is ever needed again, or when someone asks what is already routed on a domain. Phrases like "set up a new claude account", "provision an alias for the next plan", "what addresses are routed on that domain", "turn on the catch-all", "we need a mailbox for codex".
argument-hint: "provision --domain <zone> --identity <name> --provider <claude|codex> --label <name> --destination <mailbox> | list --domain <zone> | catch-all --domain <zone> [--enable --destination <mailbox>] [--disable]"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" alias $ARGUMENTS` and report the result.

## Why this exists, in one line

The plans live on **acme-owned identities** — `<identity>-claude-N@` on an acme zone in the work Cloudflare,
forwarded to a work mailbox — and that is what answers the worry about Claude data sitting on personal devices
and personal accounts. The mailbox is the primitive, because an identity is only organisation-owned if the
mailbox behind it is. The same shape serves ChatGPT/Codex plans, which is why the provider is part of the
address rather than a convention in the label.

## The one thing this verb does NOT do

**It provisions a mailbox. It does not create an account anywhere.** Anthropic's Usage Policy, under _Do Not
Abuse our Platform_, names "Utilize automation in account creation" — so the signup itself stays a
hand-driven step, deliberately, and no verb here drives it. What the terms actually say, in full, and where
the line falls: [terms-and-limits](reference/terms-and-limits.md). Read it before proposing to automate any
further up this path.

## The verbs

```bash
slopweaver alias list --domain acme.com                 # every routing rule on the zone — ours and not
slopweaver alias provision --domain acme.com \
  --identity ada-owner --provider claude --label five \
  --destination ops@acme.com                # one `ada-owner-claude-five@acme.com` forwarding rule
slopweaver alias catch-all --domain acme.com \
  --enable --destination ops@acme.com                  # the one-time write that ends the per-seat step
slopweaver alias catch-all --domain acme.com --disable  # stop catching; the rule drops rather than forwards
```

Every verb takes `--json` and `--home <dir>`. `provision` and `catch-all` are `external-write` and go
through the admit door; `list` only reads.

## Both writes read before they write

`provision` is safe to re-run — an address already routed is **reported, never duplicated**, because two
literal `to` matchers on one address is a zone nobody can reason about afterwards.

`catch-all` gets the same protection for the wider rule, and needs it more: a Cloudflare catch-all update
REPLACES the zone's rule wholesale, so the verb reads the standing one first. If it is already what you
asked for, nothing is written (exit `3`). If it is not, the line it is about to replace is **printed before
the write** — so re-pointing every address on a zone can never happen silently.

A run that opens with `list` still tells you what a half-finished signup left behind, which is the state
this verb is most often reached in.

## Five refusals, and what each one means

Each is a fact about the zone or the account, not a policy block, so each names the fix:

- **`ZONE_NOT_IN_ACCOUNT`** — the configured token's account does not hold that zone, and the refusal lists
  the zones it does hold. `slopweaver.ai` is not one of them; the acme zones are.
- **`ZONE_AMBIGUOUS`** — two zones of that name under one account. A write may not guess between them.
- **`ROUTING_DISABLED`** — Email Routing is off on the zone. Switch it on in the Cloudflare dashboard once,
  per zone; see [cloudflare-setup](reference/cloudflare-setup.md).
- **`DESTINATION_UNVERIFIED`** — Cloudflare has not verified the forwarding mailbox. It mails a code there
  once and the address works the moment that code is followed. Nothing is written until it is.
- **`RULE_ALREADY_EXISTS`** — the address is routed. The line beneath names where it currently forwards, so
  a wrong destination is visible rather than silently re-pointed.

A `403` on a routing endpoint is none of these: it is the token missing **Zone · Email Routing Rules ·
Edit**. The Cloudflare atlas's token is the one this reads (`$SLOPWEAVER_HOME/secrets/cloudflare-token`).

## The address shape is a closed set on purpose

`<identity>-<provider>-<label>@<zone>`, provider one of `claude` or `codex`. **The identity leads**, so the address says who owns it. A bare `claude-one@`
names a seat and nobody, so the only way to answer "whose plan is this, and may we cancel it" is to sign into
the provider and look.

The provider is what separates the two halves when the address is read back, so an identity or a label
carrying one as its own hyphen-delimited segment is refused rather than accepted quietly: `--identity
claude-smith --provider claude --label one` would mint `claude-smith-claude-one@`, whose two `claude`
segments leave no way to say where the identity stops. The whole rule, and the round trip it protects, is
`src/alias/address.ts`.

## Where a fresh install meets this

`slopweaver onboard` step 11 is the mailbox step: it DERIVES both uniform addresses for a person
(`--identity`, `--mailbox-zone`) and prints the command for each delivery shape, writing nothing and holding
no token. So somebody installing the plugin on their own work laptop learns the address exists and what it
would take — [the mailbox](../onboard/reference/the-mailbox.md). Which of `catch-all` and `provision`
answers "anyone can do it themselves", and what each costs, is decided there and in
[cloudflare-setup](reference/cloudflare-setup.md) § 6–7.

## Standing a whole plan up

The mailbox is step two of about eight, and two or three of them are the owner's own hand. The end-to-end
walk — what is automated, what is the owner's, what each Max tier was measured asking for at its checkout, and the enrolment into `claude signin --enroll plan-N` — is
[claude-account-runbook](reference/claude-account-runbook.md).

## Exit codes

`0` provisioned or read · `2` the invocation was wrong · `3` a refusal above fired, and **nothing was
written** · `1` a genuine fault.
