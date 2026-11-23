---
name: spend
description: Track the company AI card's spend from a card page the owner pasted — store the export, then read monthly headroom, the reset day, what the page proves about a declined charge, and what each merchant the install registers was charged; and read the card page live, read-only, in the owner's own signed-in Chrome; and turn an Airwallex task reminder into one upload act per charge with its invoice pulled from the owner's mail, and draft (never send) a forward of each matched receipt to Airwallex's receipts address. Use when the owner pastes an Airwallex card page, or asks what is left on the AI card, why a Claude or ChatGPT/Codex plan charge was declined, what the AI subscriptions cost, or which receipts Airwallex is waiting on, or to register which card merchants group together and where their receipts come from. Phrases like "here is my airwallex", "how much is left on the card", "why did the plan purchase decline", "what are we spending on AI", "update the airwallex tracking", "upload the receipts to airwallex", "airwallex tasks".
argument-hint: "import <path> --as-of <YYYY-MM-DD> | read [--card <last4>] [--by merchant|month] [--json] | capture --url <card page> (--discover | --store --last4 <nnnn>) | tasks [--json] | forward [--dry-run] [--json] | merchants show|set [--form <path|->] [--json]"
---

**The card the fleet's plans bill to is tracked from what the owner pastes, and read live only through the
owner's own signed-in Chrome.** Every Claude and ChatGPT/Codex plan bills to one Airwallex company card. A snapshot
enters Slopweaver as a card page the owner copies out of the owner's own console; the register holds each paste as it was.
A live read of the card page (§ The live read) stores the same snapshot, plus Airwallex's own reason for
each decline.

## When the owner pastes a card page

Save it verbatim under `$SLOPWEAVER_HOME/airwallex/` (it is the organisation's own spend, so state, never
git), then store it, naming the day the page was captured:

```bash
slopweaver spend import ~/.slopweaver/airwallex/<file>.md --as-of <YYYY-MM-DD>
```

It writes `$SLOPWEAVER_HOME/spend/cards/airwallex-<last4>/<as-of>.json` and prints any merchant the
register (§ The merchant register) does not hold, kept under its own name. Re-importing the same card and day replaces that snapshot; a new day
adds one. `--as-of` has no default on purpose: the page says "resets <day month>" with no year, and a date
guessed from a file's timestamp would put the reset in the wrong month.

A refusal names the line it is about (`EXPORT_LINE_MISSING`, `AMOUNT_UNPARSEABLE`, `ROW_COUNT_MISMATCH`, …) —
usually a partial paste. The table must be one unbroken run under its `|---|` row ending at a blank line,
with nothing row-like above it or after it, match the `(N rows …)` heading directly above it, and hold
nothing dated after `--as-of`, because a silently dropped decline would read as "none on the page". An
`--as-of` more than a day after the page's reset, or more than a month before it, is `CAPTURE_OUTSIDE_PERIOD`:
the page could not have been copied then. Ask for the whole page rather than hand-editing the file.

## Answering from it

```bash
slopweaver spend read                  # every card, its newest snapshot
slopweaver spend read --card <last4>   # one card
slopweaver spend read --by month       # per month and merchant, instead of per merchant
slopweaver spend read --json           # one document
```

Exit 3 means nothing is imported (or not that card) — say so, never "no spend".

## The merchant register — the install's, never the code's

Which card merchants group together, and which mail domains their receipts come from, are this install's
accounts, so they live in the store's `spend_merchant` table and no merchant is named in code. The vendor's
behaviour (Airwallex's export, reminder senders, receipts address) stays in the integration.

```bash
slopweaver spend merchants show                     # the register; --json is the exact stored document
slopweaver spend merchants set --form merchants.json # replaces the whole register, '-' reads stdin
```

The form is `{"schemaVersion":1,"merchants":[{"slug":"acme","prefixes":["acme"],"receiptDomains":["acme.example"]}]}`.
A charge whose merchant opens with a registered prefix, at a word boundary, groups under that slug; every
other charge stays under its own string, and `tasks`/`forward` search no receipt for it. Two overlapping
prefixes are refused (exit 2). With no store selected, every verb runs on an empty register and says so once
on stderr; an unreachable store refuses rather than reading as empty.

## What the page proves, and what it never does

- **Headroom is as of the capture day**: limit minus used, on the day the owner copied the page. It says nothing
  about a later day.
- **A pasted page gives no decline reason; a live read does.** `read` prints Airwallex's reason on each
  decline a live snapshot holds. Either way it sets the latest declines against today's headroom AND a floor
  on the headroom they had then — today's headroom plus every charge that went through on a LATER day, minus
  any cancelled or verification hold from before them. Only when every decline is in the limit's currency,
  after the previous reset however the page's "resets <day month>" is read (a month earlier, or month end), and
  under that floor does `read` say the monthly limit was NOT what declined them;
  otherwise it says "possible, not proven" and names each condition that failed. On a paste the remaining causes (the Borderless Cash balance, an issuer or 3DS decline) stay open; never pick one — on a live snapshot, quote Airwallex's reason instead.
  The shape it guards against: a run of declines followed the next day by a larger charge that went through
  means the obvious story — "the card's cap declined it" — is false for those declines, even when the cap is
  nearly spent by the time anyone looks. Repro: `slopweaver spend read`.
- **Currencies are never converted or mixed.** A USD charge counts against the AUD limit at a rate the page
  does not show, so the AUD rows alone never add up to "used". Totals are per currency.
- **A row's date is taken as the day it went through.** The page prints one date per row; if it is a
  posting date lagging the authorisation, "charged on a later day" is off by that lag.
- **Only charged rows total.** Declined, cancelled and card-verification rows do not; a blank status is a
  charge whose settlement the page does not show.

The same knowledge lives in the retrieved register: `slopweaver knowledge recall "airwallex"`.

## The live read — the owner's signed-in Chrome, read-only

**The owner's ruling (option C, read-only):** Airwallex is read through the owner's own signed-in work Chrome,
never its API, never an API key, never a write. `spend capture` is that door:

```bash
slopweaver spend capture --url '<the card page the owner opens>' --discover              # the backend's SHAPE; writes nothing
slopweaver spend capture --url '<the card page the owner opens>' --store --last4 <nnnn>  # the card, as a snapshot
```

It rides the browser relay every atlas walk rides — navigate and observe the page's own JSON, no click, no
typed text, no request replay, no header or cookie read — takes no screenshot, and prints method, path,
status and each body's field paths with their TYPES, never a value. A redirect to `/app/login` exits 1
saying Airwallex is signed out in the owner's work Chrome: that is the owner's one step (a sign-in), never an empty report.

**`--store` is calibrated, never assumed.** It reads `GetCardLimits`, `GetExpandedCardDetails` and
`TransactionSearchByCardId` off the page and refuses unless they agree with the snapshot already stored for
`--last4`: the card is the one carrying that snapshot's nickname, the amounts' unit is whichever makes the
monthly limit the stored one, and the live rows must share a day with a stored row and match its amount. So
a card is `spend import`ed from a paste in the same month before its first live read. The card number is never
read; `--last4` is the owner's. A status code or window type the mapper does not know refuses by NAME
(`LIVE_UNCALIBRATED`, every problem in one pass) — add a status to `src/spend/liveRows.ts` or a window type to
`src/spend/liveCapture.ts`, and run again inside the same sign-in, since the console signs itself out after
about twenty minutes idle. The live control carries merchant brand ids, not names, so a live snapshot names
no allowed merchants. Never drive `browser` verbs at the console, and never lift a token off the page to call
the backend directly.

## The owner's Airwallex task reminders — one upload act each, invoice pulled

Airwallex mails the owner a daily "You have <n> task(s) to complete" reminder, from `support@info.airwallex.com` or
`no-reply@info.airwallex.com`, for every card charge still missing a receipt, and each one restates the whole
open set, so only the newest counts (`REMINDER_QUERY`, `src/spend/tasks/read.ts`, matches both senders and both subjects). `spend tasks` reads it through the Gmail door
and prints one line per charge: **upload this into Airwallex now**, beside the PDF it pulled out of the
receipt mail from the charge's registered receipt domains that NAMES that amount (owner-only, under
`live/gmail/attachments/`), or why there is none — no registered merchant, no receipt mail in the window, or
receipts that name another amount (listed, never pulled).
The reminder's Gmail address heads it, for the card's citation chip. Exit 3: no reminder in the inbox.

```bash
slopweaver spend tasks          # the act per charge, and the reminder's Gmail address
slopweaver spend tasks --json   # the whole reading
```

It reads mail only: the upload is the owner's, in Airwallex (the owner's ruling). **The grant is ONE mailbox, the owner's
work one, and the plans bill to other sign-up addresses** (`slopweaver plans list`). The fleet has no grant on
those and never will, so **a receipt reaches this mailbox only when the owner forwards it from a plan mailbox**; until
the owner does, a charge reads "no matching invoice mail" — say that, never "no invoice exists". The owner's forward is found
by a registered receipt domain in its forwarded header, and judged on the receipt's own `Date:` line, not the day the owner
forwarded it. The inbox-triage seat cards it
([inbox-triage](../automation/reference/inbox-triage.md#spend-task-reminders)).

## Forwarding a matched receipt to Airwallex — a draft, never a send

`spend forward` reads the same way, then writes a forward of each matched receipt to
`receipts@expenses.airwallex.com` **into the owner's own Gmail Drafts** — PDF kept, subject unchanged, through the door
like `gmail draft`. Option C: **the fleet never sends it**; mailing Airwallex is the owner's yes once per
send, and the owner presses Send in Gmail. It holds the `compose` grant, never `send`.

```bash
slopweaver spend forward --dry-run   # what it would draft, storing nothing
slopweaver spend forward             # one draft per matched receipt, each named with its Gmail link
```

One draft per receipt, ever: a claim under `$SLOPWEAVER_HOME/spend/forwards/` makes a later run name the
earlier draft instead. A Gmail failure keeps the claim, since the draft may exist; the next run reports it
abandoned and drafts nothing until someone checks Drafts and removes that file. Mail already addressed to
Airwallex, drafts and sent copies are never read as receipts, so a forward is never forwarded. Exit 3: no
reminder, or no charge with a receipt to forward.

**Owed, not proven:** whether Airwallex matches a receipt mailed from the owner's work address. If it refuses because
the sender must be the cardholder's registered Airwallex email, that is a Queue finding for the owner, never a
workaround.

Code: `src/spend/` (parser, live mapper, report, store, `merchants/`, `tasks/`) and `src/cli/commands/spend/`.
