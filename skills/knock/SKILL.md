---
name: knock
description: Read Knock, the notification layer, live for an investigation — which notifications went to a user or matched a status, each one's event trail, and what its provider answered — never a recipient, payload or body, stored nowhere. Use when a question is whether a reminder or alert was ever triggered, sent or delivered, why a notification did not go out, or what Twilio answered Knock. Phrases like "did Knock send it", "check NOC for that customer", "was the notification triggered", "which reminders went undelivered", "what did Twilio answer for that message".
argument-hint: "user-messages --user-id <id> | messages --status <status> --inserted-after <iso> | message --id <id> | message-events --id <id> | delivery-logs --id <id> | verify"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knock $ARGUMENTS` and report the result.

## The one rule this skill exists to hold

**Knock is READ, for an investigation, and nothing read is kept.** The owner wants
read-only doors for investigations. These verbs print delivery facts to your
session and write nothing under `$SLOPWEAVER_HOME`; the corpus never sees them.

**What it never prints**: the recipient, the actors, the message's data or metadata, the recipient snapshot,
an engagement time, or any delivery request or response body or header — those carry the customer and the
text. That is a property of the projection (`src/live/knock/projection.ts`), so quoting a verb's output is
safe. A user id you pass is sent and never printed.

**And it cannot write.** Knock mints no read-only key, so the stored key could trigger a workflow; what
stops it is `src/live/knock/transport.ts`, which admits `GET` alone, to `api.knock.app`, on five message
read routes — a trigger, a status write or a content read is not expressible.

## The ladder — from a person to what the provider answered

```bash
slopweaver knock user-messages --user-id <app-user-id> --inserted-after <UTC instant ending in Z>
slopweaver knock messages --status undelivered --status bounced --inserted-after <UTC instant ending in Z>
slopweaver knock message --id <message-id>            # one message re-read live
slopweaver knock message-events --id <message-id>     # queued → sent → delivered/undelivered, each timed
slopweaver knock delivery-logs --id <message-id>      # the provider call: service and the HTTP status it answered
slopweaver knock verify                               # does the key read, and does a real message still parse?
```

The list filters are `--status` (repeatable), `--channel-id`, `--source <workflow-key>`, `--tenant`,
`--workflow-run-id`, `--workflow-recipient-run-id`, and `--inserted-after`/`--inserted-before` as UTC
instants. Every verb takes `--json`. A list cut by `--limit` says so on its last line; one needing more than
twenty pages is refused rather than truncated — narrow it.

## Reading the answer honestly

- **Knock's `sent` is Knock handing it to the provider**, not arrival. `delivered` and `undelivered` come
  from the provider's receipt. The delivery log's status is the provider's HTTP answer to Knock: a `201` from
  Twilio is accepted, a `400` refused — follow an accepted SMS into `/slopweaver:twilio` for the carrier's
  verdict.
- **No message for a user** usually means the workflow never ran for them, or ran under a different user
  id. Say which id and window you searched.
- **The environment is the key's**: the production key reads production only.

## Exit codes

| code | what it means                                          | what you do                                |
| ---- | ------------------------------------------------------ | ------------------------------------------ |
| `0`  | Knock answered — an empty list included                | report it, with the filters used           |
| `2`  | a bad flag                                             | fix the invocation                         |
| `3`  | **no Knock key in this install**                       | route the mint — see below                 |
| `1`  | Knock refused, was unreachable, or answered unreadably | read the message; it says what to conclude |

A refused body (`RESPONSE_REFUSED`) is a fault, never an empty result: the boundary is pinned to Knock's
OpenAPI document (`src/live/knock/boundaries.ts` carries the digest and the re-check command),
and a refusal names the field Knock added.

**`verify` reads one real message, and says so.** A key check alone once passed while every live list
body was refused for two fields Knock had added, so `verify` makes two one-message reads: a far-future window
that proves the key and is designed to fetch nothing, then the first message an unfiltered list returns, parsed
through the strict boundary and dropped — that record is held in memory, never printed or stored. Its line (and
`--json`'s `messageShape`) says whether a message shape was tested at all: an environment with no messages
proves the key only.

## When there is no key

The mint is **the owner's hand, never a session's** — the owner provisions API keys, the fleet never clicks in a provider
dashboard. A seat sends the supervisor one line, and the chair puts up the single floating note. The steps
the `3` exit prints are the ones to relay:

1. dashboard.knock.app → your Knock account → Developers → API keys → copy the **production** secret key (`sk_…`).
2. `slopweaver secrets set knock-api-key` (no-echo).
3. `slopweaver knock verify`.

## What this skill does NOT own

The SURFACE MAP: `slopweaver atlas knock` answers _what can be asked of Knock_ from its published spec and
stores no message; these verbs answer _what Knock sent_.

## Running this from Codex

In Claude Code `${CLAUDE_PLUGIN_ROOT}` is substituted for you. In Codex it is not: resolve this `SKILL.md` on
disk, take the plugin root two directories above it, and invoke `<plugin-root>/bin/slopweaver` by absolute
path. Never run bare `slopweaver` on either host — an ambient `PATH` may point at another checkout.
