# Reading a manual `listen recover` pass's COVERAGE

**An empty `recoverable` is only good news when `completeness` says `complete`.** A channel the pass could
not open contributes no candidates, so an unread workspace and a clean one produce the same FINDINGS. That
is exactly what went wrong once: a pass that failed to open **most** of its channels printed a
document indistinguishable from a clean pass over the few it did open, and both exited `3`. The skips went to stderr, which
nothing was reading.

Both halves are in the `--json` document, and in the first line of the human one.

## The four coverage fields

| field                                   | what it says                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `completeness`                          | `complete` only when every requested channel was read                              |
| `scannedChannels` / `requestedChannels` | how much of the pass's BREADTH was actually covered                                |
| `excludedChannels`                      | `not-a-member` or `gone` — **a re-run changes nothing**; invite, or fix the list   |
| `failures`                              | a rate limit, a fault, a bad cursor, a failed DISCOVERY — **a re-run may read it** |

`excludedBy` and `recoverable` are unchanged and mean what they always did. Every requested channel lands in
exactly one bucket, so `requestedChannels === scannedChannels + failures.length + excludedChannels.length`
always holds — a channel's scan is atomic, stopping at its first failed read.

**`--discover-channels` WIDENS the breadth, on top of `--channels` rather than instead of it.** The pass
reads every conversation the BOT token is in PLUS every id you typed, so `requestedChannels` counts that
union and a survivor outside the reply gate still comes back `wrong-place`. Both halves are load-bearing:
Slack filters `conversations.list` by the token's own scopes and says nothing about what it filtered, and
a discovery that REPLACED your list would drop an id you had explicitly named and then report `complete`.
Discovery is complete-or-nothing: a truncated membership walk, **and a walk that finishes naming no conversation the bot
may act in**, are both a `discovery`-stage failure over zero requested channels — `partial`, exit `1` —
rather than scanned as if they were the whole workspace. The empty case earns the same treatment because
zero requested channels, zero read and no failures is arithmetically a perfect pass: it would print
`complete` and exit `3`, certifying a workspace nobody opened. Zero is never the true answer here — the bot
always holds DMs — so it means the token answered about the wrong subject.

**A NON-EMPTY walk is not evidence of a complete one, so the token's SCOPES are checked first.** Slack
filters that walk by the scopes the token holds and reports no error for what it left out, so a token
without `groups:read` exhausts both lanes cleanly, returns every public channel and DM, and omits every
private channel — including the one this flag exists to reach. `--discover-channels` therefore asks
`auth.test` before it asks `conversations.list`, and refuses the pass unless the token demonstrably holds
`channels:read`, `groups:read`, `im:read` and `mpim:read`. A scope set that could not be established at all
is refused the same way, because unverified is not the same claim as held. Read this install's own answer
with `slopweaver slack probe --method auth.test --scopes --bot`; the refusal names the missing scope and
the two routes out — re-grant through `slopweaver connect slack`, or drop the flag and name the channels
yourself, which reads exactly what you typed and claims no more. This covers BREADTH only: a `*:history`
scope the token lacks fails one conversation's read, which is already that channel's own coverage failure.

## The exit codes are not interchangeable with the document

| exit | means                                               |
| ---- | --------------------------------------------------- |
| `0`  | complete, and it found survivors — take them        |
| `3`  | complete, and there is genuinely nothing to recover |
| `1`  | **partial** — some requested channel was never read |

**A partial pass still prints its survivors, and still exits `1`. Take the survivors anyway**, then say what
was not covered. So capture the status rather than letting `set -e` or a bare `&&` discard the document:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" listen recover --bot-user <U…> --channels <C…> --since 3d --json > recover.json
status=$?
if [ "$status" -eq 1 ]; then echo "coverage gap — read .excludedChannels and .failures"; fi
```

`|| alert` fires on `3` too, which is the healthy empty case — branch on the status, never on non-zero.

## Why the scheduled sweep answers this differently

Same classifier (`permanentExclusion`), opposite completeness verdicts, and both are right for their own
scope. Scheduled discovery walks the bot's own membership, so `not_in_channel` names a channel that was
never in scope — counting it against completeness pinned `completedThroughTs` for six days.
A manual pass counts every channel it set out to read, typed or discovered, because it has no watermark for
that count to pin: the worst a partial manual pass costs is a re-run, and the thing it buys is that an
operator is never told a workspace is quiet on the strength of channels nobody opened.
