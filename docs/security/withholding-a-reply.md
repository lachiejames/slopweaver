# Withholding a reply

Part of [Security & trust](../security.md).

One gate exists for the bot's own answers (`src/admit/withhold.ts`). Before a composed reply is posted, it is
offered to an injected **judgement** — send, or withhold and say why. A withheld reply is not sent: the finding
is a `warn`, so `throughDoor` performs nothing and the ledger records the non-send with its reason, the draft
is filed in a durable queue under `$SLOPWEAVER_HOME/queue/withheld.jsonl`, and the thread gets a notice saying
it was held rather than going silent. `slopweaver queue list/show` read it; `slopweaver queue release <id>` is
the break-glass, and it posts through the door with the withhold recorded as **overridden** rather than as an
ordinary send.

Three things this is deliberately not. It is **not data partitioning** — the bot keeps access to everything it
can read, and the control is on what it SAYS. The bot-reply judgement is **not prose scanning**: it makes
only a policy decision about the reply's situation. Prose is scanned elsewhere: the [voice-profile gate](slack-admit-door.md)
described above runs on bot replies too, at the door, over the exact rules that bind the bot.

And it is **not a tact or harm filter**, which is a standing owner ruling rather than a gap. A judgement here never withholds a reply because the answer ranks, compares or names colleagues,
because it reads as unkind, or because the question should not have been asked in the room it was asked in.
Take "who has been slowest to close out their assigned tickets", asked in a public channel. Declining it because
it ranks people or could put them down is the wrong behaviour: the onus is on the human asking a ranking question
in public, not on the bot, whose job is the most accurate, citation-backed answer to the question asked. What a judgement may legitimately decide is the reply's
SITUATION — whether this asker is permitted to receive an answer at all — which is the whole of what the
shipped one does, and a private repository supplying a finer-grained one is bound by the same line. The rule
binds the two paths that could reduce the same functionality without ever touching this gate: `turn brief`
and `turn resume` print it to every session (`standingAnswerScopeLines`, `src/live/turn/briefGuidance.ts`),
and the reviewer packet forbids a `broken` verdict for what an answer is ABOUT (`src/live/turn/review.ts` § 9,
which feeds the answer-quality gate above). Verbatim anchor and reasoning:
[doctrine-rationale/accurate-answer.md](../doctrine-rationale/accurate-answer.md) § "The bot answers any question accurately".

The shipped judgement replies **only to whoever is on `responders.json`** — the same list, read the same way,
that decides who may address the bot at all. There is no owner carve-out and no environment variable that
changes the policy itself (the journalled `responder-allow-open` grant is the one break-glass, and it opens BOTH gates
identically, by design — one list, one override). An absent, unreadable, or empty list withholds every
reply, including the owner's own, exactly as it already refuses every address. `responders.json` is the
single source of truth for both questions, so a listed non-owner admitted to ask is never left without an
answer by a second, owner-only judgement. A finer-grained judgement — what the owner would sign off on beyond "is this
asker on the list" — could still be supplied by a private repository through the seam, but nothing here
needs to know whether it is.

**What this gate does not decide is who may SEE each fact in the reply.** Its `ReplyContext` carries the
asker, the channel and the draft's first line — never the channel's readers, the evidence's provenance or what
each reader can already reach — so it cannot. That judgement is the owner's standing rule,
applied by the composing session and its reviewer: share only what the owner, compliance in mind, would show every
reader; a fact some reader cannot already reach waits on the owner through `turn block --need risky-approval`; a
private one is answered around as if unknown. `turn brief` and `turn resume` print it
(`src/live/turn/replyDisclosure.ts`), the reviewer packet makes a breach `broken` (`src/live/turn/review.ts`
§ 9), and it is bounded by the no-tact-filter rule above: it governs who sees a fact, never what an answer is about. The cases:
[what-the-reply-may-share](../../skills/loop-bot/reference/what-the-reply-may-share.md).
