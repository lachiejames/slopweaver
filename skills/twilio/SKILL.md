---
name: twilio
description: Read Twilio's SMS delivery records live for an investigation — which messages went to a number in a window, each one's status, carrier error code and send time — never a body, numbers masked, stored nowhere. Use when a question is whether a customer's text actually arrived, why one did not, or when proof of SMS delivery is needed for a follow-up. Phrases like "did the SMS get delivered", "was the text sent to this number", "what does error 30003 mean for this message", "SMS delivery proof", "check Twilio for that customer's reminder".
argument-hint: "messages --to <+E.164> --sent-after <day> --sent-before <day> | message --sid <SM…> | verify"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" twilio $ARGUMENTS` and report the result.

## The one rule this skill exists to hold

**Twilio is READ, for an investigation, and nothing read is kept.** The owner wants
read-only doors for investigations, SMS delivery records first. These verbs print delivery facts to your
session and write nothing under `$SLOPWEAVER_HOME`; the corpus never sees them.

**What it never prints**: a message body, a full phone number (masked to its last three digits), an address
that is not a phone number (printed as `withheld`; only a sending side keeps its brand sender id), Twilio's
free-text error message (the code and its Twilio docs page print instead), a price or a media URL. That is a property of the projection (`src/live/twilio/projection.ts`), not of care at the call
site, so quoting a verb's output is safe. Say in your answer that a number was masked.

**And it cannot write.** `src/live/twilio/transport.ts` admits `GET` alone, to `api.twilio.com`, on the
account's Messages list and single-message paths and nothing else — so a send, a redaction or a delete is not
expressible, whatever the key could do.

## The reads

```bash
slopweaver twilio verify                                              # does the stored key read Messages? fetches none
slopweaver twilio messages --to +61400000000 --sent-after 2001-01-01 --sent-before 2001-01-02
slopweaver twilio messages --from <sender-id> --sent-after 2001-01-01 --limit 200
slopweaver twilio message --sid SM0123456789abcdef0123456789abcdef    # one message re-read live
```

Every verb takes `--json` and `--home <dir>`. A list is newest first; when more match than `--limit` it says
so on its last line — raise the limit or narrow the window rather than reporting the cut list as complete.

## Reading a status honestly

- **`delivered`** is the carrier's receipt. **`sent`** means Twilio handed it to the carrier and no receipt
  came back — not proof of arrival. **`undelivered`/`failed`** carry an error code: 30003 is an unreachable
  handset, 30005 an unknown or inactive number, 30006 a landline. Quote the code; Twilio's own docs name it.
- **A window is in UTC days.** A customer's local evening may sit in the next UTC day, so widen by one when
  the window is tight.
- **No match is an answer**, exit 0 and "0 message(s)" — but say which number and window you searched, since
  a wrong sender or a day off is the usual cause.

## Exit codes

| code | what it means                                           | what you do                                |
| ---- | ------------------------------------------------------- | ------------------------------------------ |
| `0`  | Twilio answered — an empty list included                | report it, with the window searched        |
| `2`  | a bad flag                                              | fix the invocation                         |
| `3`  | **no Twilio key in this install**                       | route the mint — see below                 |
| `1`  | Twilio refused, was unreachable, or answered unreadably | read the message; it says what to conclude |

A refused body (`RESPONSE_REFUSED`) is a fault, never an empty result: Twilio added or retyped a field the
strict boundary did not expect.

## When there is no key

The mint is **the owner's hand, never a session's** — the owner provisions API keys, the fleet never clicks in a provider
console. A seat does not post the step itself: it sends the supervisor one line, and the chair puts up the
single floating note. The steps the `3` exit prints are the ones to relay:

1. console.twilio.com → Account → API keys & tokens → create a **restricted** key granting only
   Messaging → Messages → Read.
2. `slopweaver secrets set twilio-account-sid`, `twilio-api-key-sid`, `twilio-api-key-secret` (no-echo).
3. `slopweaver twilio verify`.

`verify` proves the key reads Messages; it cannot prove the key is restricted, which only the owner's Twilio console shows.
The GET-only transport is the wall either way.

## What this skill does NOT own

The SURFACE MAP: `slopweaver atlas twilio` answers _what can be asked of Twilio_ from the published spec;
these verbs answer _what was sent_. Knock decides what to send and when; for "did Knock even try", start at
`/slopweaver:knock`.

## Running this from Codex

In Claude Code `${CLAUDE_PLUGIN_ROOT}` is substituted for you. In Codex it is not: resolve this `SKILL.md` on
disk, take the plugin root two directories above it, and invoke `<plugin-root>/bin/slopweaver` by absolute
path. Never run bare `slopweaver` on either host — an ambient `PATH` may point at another checkout.
