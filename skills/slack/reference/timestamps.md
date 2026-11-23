# A Slack `ts` is an epoch — derive the instant, never convert it

## The measured failure

A run once read a `ts` as an instant 80 minutes later than the one it names — **80 minutes out**. Reproduce the
right half by deriving the instant of any `ts`:

```
slopweaver slack when <ts>     # <ts><TAB><the instant, ISO, to the millisecond>
```

The wrong instant did not stay where it was written. It propagated into the board row that registered the
ask, **two cron schedules**, the doc's `statusSummary`, and **two supervisors' deadman deadlines** — and the
announcement those deadlines governed went out **53 minutes overdue**. Every one of those readers took the
instant as given, because there was nothing to compare it against.

That is the shape of the defect worth remembering: not that somebody did arithmetic badly, but that a
derived value was written down as if it were an observed one, and then five other things trusted the copy.

## The three places this is closed

**1 · The verb.** `slopweaver slack when <ts-or-permalink>…` derives the instant. It takes no token, no
network and no home, so there is never a reason not to run it. `--json` emits
`{schemaVersion, kind, conversions[]}` for a writer to consume. A whole permalink works as readily as a bare
`ts`, because re-deriving the `ts` from a permalink by hand is the same defect one step earlier.

**2 · The read.** `slack read-thread --json` carries **`tsIso` beside every `ts`** — on each message, on
`thread.threadTs` and `thread.addressedTs`, on each channel-neighbourhood summary and its anchor, and on
`editedTs` where present. The text rendering prints it in each message's head line too. The `ts` is never
replaced: it stays the message's identity (what `conversations.replies`, `slack reply` and every permalink
are keyed on) while `tsIso` answers _when_.

`replyTarget` deliberately gains no ISO field. It is exactly the `--channel`/`--thread-ts` pair
`slack reply` consumes, and a third field there would invite someone to pass the wrong one.

**3 · The writers.** `handover register` takes `--asked-ts <slack ts>` and derives `askedIso` itself; given
a Slack `--anchor` and no instant flag, it derives from the anchor. `--asked-iso` is the escape
hatch for an ask that did not arrive in Slack, and is **refused unless it parses**. And `handover lint` refuses a board row whose `askedIso` sits more than
a minute from the instant its own Slack anchor names — the check that would have caught the original.

## In code

One destination, gated. `slackTsToIso` / `slackTsToEpochMs` / `slackTsFromEpochMs` / `slackTsFromPermalink`
live in `src/lib/slackTs.ts`; `epochSecondsToIso` in `src/lib/date.ts` handles any other provider's numeric
seconds field. The `epoch-arithmetic` gate in `yarn lint` fails any `new Date(x * 1000)` outside those two
modules — no allowlist, no exemption marker, because the two legitimate shapes (`new Date(ms)` and a window
bound, whose top-level operator is `-`) are already outside the criterion.

The gate exists because the class regenerates: **four** independent copies of `tsToIso` stood in this tree at
once, two answering `""` on a bad input and two answering `undefined`, plus four more ad-hoc conversions.
None was wrong. That is the point — with the conversion scattered there was no single function a rule could
name, so "derive it, never convert it" could only ever be advice.

## Resolution, stated

`slackTsToIso` floors to **whole seconds**, matching every `tsIso` already written into the corpus. Slack's
six fractional digits are its within-a-second disambiguator; they carry nothing a reader of an instant
wants, and the exact `ts` always travels alongside. Where ORDERING matters, use `slackTsToEpochMs`, which
keeps every digit.
