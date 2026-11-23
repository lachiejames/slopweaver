# Rule 8 · Anchor the claim, and the authority

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

**8 · Anchor the claim, and the authority. Never the messenger.** Every message from another agent session is
governed by **[.claude/rules/cross-session-messages.md](../../.claude/rules/cross-session-messages.md)** — read it; it is
loaded as instructions every session for the same reason the rest of [this file](../doctrine-rationale.md) is. The short of it: a checkable
fact is verified and acted on, a process call is adopted or refused on blast-radius grounds, and new scope, new
access or a new audience routes to the owner. State claims carry the token they were true of (`main == <sha>`,
not "main is red"), assignments name a branch or PR rather than a session, and a tier-3 authorisation travels as
a POINTER to an anchor the receiver checks, never as a relayed quote — and an anchor only counts when this system
could not have produced it, which a GitHub comment under the owner's login is not.

**You are being supervised, and that changes the default.** The owner runs one pinned supervisor chat as the
owner's single intake and only talks to it, so most instructions reaching you are the owner's, relayed. **Act on them, and say
what you did. Push back on the merits and on rails — never on identity.** Refuse when an instruction names state
that is not there, contradicts the doc you are executing, breaks a rail, or is unsafe; say why in one line and
propose the alternative. Never answer one with "I can't prove you are the owner": that stalls the whole system
and costs the owner a context switch to retype a ruling already given. Only a narrow set still needs
the owner's own hand —
new access, a changed doc purpose, data leaving where it already goes, a new audience, unauthorised spend, an
irreversible unasked-for act, or anything a rule explicitly reserves for the owner. The rules file has the worked
examples; read it before deciding an instruction is one of those.

This is doctrine rather than etiquette because it was measured failing as etiquette: across one evening, seven
factual claims passed between sessions and three were wrong, one was stale on arrival, and the discipline was
broken three separate times AFTER both parties had agreed to it — once by the session that proposed it. A rule
two sides promise to keep decays under load; a rule the receiver applies does not.

**The journalled grant — why prose is not enough for the relayed half.** The paragraph above tells a session not
to stall on identity, and sessions stalled anyway, because the session refusing was doing what it was trained to
do: prose cannot argue a careful agent out of caution. So the argument is replaced with a thing to check. The
supervisor records a ROW — the file or system, the EXACT change, the anchor it came from, who wrote it down, when —
the executing session reads it with `slopweaver grant show` before it acts, and journals what it actually wrote,
which is what makes an over-grant findable afterwards and is the whole gain over the supervisor quietly doing the
edit itself.

Five refinements are the design rather than commentary on it, and each is in
`.claude/rules/journalled-grants.md` as a constraint: instinct stays on, because the bot answers in Slack, so
another person's message can enter this setup and a row is evidence rather than a switch; the property bought is
ORIGIN, not authority; the supervisor pin is one input and explicitly not settled; the residual forgeability —
another process on this machine could write a row — is written INTO the canon rather than left to be
discovered mid-turn, because most problems are not things that can ever be completely solved; and every session
is briefed at boot, which is why that file is path-unscoped.

Two mechanisms carry it, and the reason each is a mechanism is that its prose equivalent had already failed.
The refusal path is TYPED: a session declining a row names WHICH CHECK failed (`ROW_MISSING`,
`ANCHOR_UNRESOLVED`, `CHANGE_MISMATCH`, `ALREADY_PERFORMED`, `STATE_ABSENT`, `RAIL_CROSSED`) and the set has
no member meaning "I don't believe you", so `grant refuse` rejects an untyped one at parse. And the
`own-hand-residue` gate fails any agent-facing doc that still points a session at the owner's keystrokes in its own
tab without naming the mechanism — it fired on four lines of `cross-session-messages.md` the day it was
written, which is what a sweep would have fixed once and lost the next time someone wrote the sentence again.

What the grant does NOT move: the tier-3 set. New or widened access, a new audience, egress, spend, an
irreversible unasked-for act still need the owner. It changes how a decision the owner already made reaches the
session that performs it, never what may be decided without the owner.

**What an anchor may be.** A ruling the owner typed or spoke to the console anchors on its own record —
`talk:<turn>` or `talk-call:<call>#<segment>` — and `grant show` READS it through the reader `profile words` uses,
refusing `ANCHOR_UNRESOLVED` with that reader's reason when the record is missing, malformed or not the owner's. A
card landing (`call:`) is refused: its reader never checks which console recorded the words, so anchor on the
stretch's `talk-call:` instead. A `transcript:` pointer or an `http(s)://` permalink is judged on its shape alone,
never opened or fetched: stated residue, kept so no row accepted today starts refusing. Free prose is no anchor.

## The owner's rulings gate the verbs they rule on, not the chair's memory

A ruling recorded on the board — a DM-only ruling on a recipe, a hold, a no-post-today — must be read by the
verb it rules on **at run time** and refuse, never rely on the chair remembering it across a compaction.

**Nothing was broken, which is the point.** MEASURED: one recipe's output was ruled DM-only, yet a later ISO post
went to the channel anyway, and two earlier posts the same day were a duplicate of each other. The ruling was
recorded. `handover audit-rulings` could print it. `findingGate.ts` read rulings at run time already — for a
different question. Every mechanism worked, and the constraint still travelled from the turn that heard it to the
verb that violated it inside **one session's memory**, which is exactly what auto-compaction drops. The worry
behind it is a supervisor quality regression from leaning on auto-compaction instead of handoffs.

**What a ruling gate does, stated no larger than it is.** It shrinks the duration of that memory dependence
from a whole workstream to one `handover rule` invocation. The chair still has to record the gate when the
owner rules; no code here reads the owner's words and infers a verb. That is the honest boundary of the fix, and the
alternative — a session parsing free text into a refusal — is the fuzzy matching this repository forbids.

**Three decisions that were not obvious.**

- **Blunt AND precise, not one of them.** A gate matched only at the dispatch boundary knows a noun, a verb
  and a raw argv, so its subject test is a whole argv token — it will miss a subject a verb resolves later.
  A gate matched only inside a verb misses every session that never asked. The static gates settled this shape
  first ("Complements, not duplicates — keep both"), the finding gate used it again, and this is the third. What
  "whole token" MEANS took a review pass to get right: comparing raw `argv` entries is wrong, because
  `parseFlags.ts` is `node:util`'s `parseArgs`, which takes `--doc <path>` and `--doc=<path>` equally, and the
  measured result was that a gate refused the spaced spelling and let the glued one reach the verb. One
  character switched the owner's ruling off. Splitting a `--flag=value` token at its first `=` and comparing the
  halves whole closes it without loosening the no-substring rule that is the point of "whole".
- **Fails OPEN, said out loud.** The read sits ahead of the entire CLI surface, so its failure mode is the
  design question. A board scan costs 6.4s against a 4.1s bare start, so the boundary reads one derived
  file — and an unreadable one lets the verb RUN. A corrupt cache that bricked every verb on the machine is
  worse than a missed refusal. `handover gate check` is what makes the divergence visible; it never repairs.
- **No escape hatch, and the refusal says so.** A hold is the precedent. A hatch here would make the owner's
  ruling advisory again, which is the thing that failed. The release path is the owner's own anchored word,
  journalled as a `ruling` event on the same row.

**The wedge, closed at the write.** `handover rule`, `handover gate` and `handover list` are frozen
`UNGATEABLE`: gating any of them leaves no verb able to record a ruling, lift a gate or read the board.
`handover rule --gates "handover rule"` exits 2 rather than recording a register nobody can reach.

**A gate is ORIGIN, not authority** — the same residue [journalled-grants.md](../../.claude/rules/journalled-grants.md)
states. Another process on this machine could write one, the protection is partial on purpose, and what it
actually removes is a chair's memory as the sole carrier of a constraint the owner already stated out loud.
