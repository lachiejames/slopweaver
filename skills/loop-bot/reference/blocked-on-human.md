# Blocked on the owner — the third ending, and the only resumable one

Bundled reference for the `loop-bot` skill, linked from SKILL.md § Step 4. Read it before you use
`turn block`, and read it in full the first time — two of the rails here will be judged on the rendered surface rather than on the code.

The design: the bot loop never waits on the owner; the listener is
always on and the session can generally run autonomously. **What waits is a STEP.** The worked case is
real and daily — someone asks the bot to deploy a Datadog monitor, the deploy needs a local Google Cloud
sign-in, and only the owner can do that sign-in.

## When it fires — three cases, and they are the whole set

> Signing in and approving something risky are nearly the only cases that arise.

The third arrived with the tag decision tree (`src/live/turn/tagDecisionTree.ts`): an ask no
general ruling of the owner's covers, from an asker not on the trusted tier.

- **`--need sign-in`** — a credential, a session or an account only the owner holds. The Google Cloud sign-in
  is the archetype and the owner does it about once a day.
- **`--need risky-approval`** — the owner's standing principle, added unprompted in the same turn: if it is
  risky, tag the owner first and do not proceed until the owner gives the go-ahead. It is judgement AND a
  guard: a stranger can tag the bot, so a risky step waits on the one person whose go-ahead means anything.
  Tag the owner **before** doing it, never after. A reply that would show a reader data they cannot already
  reach is one: name the narrow disclosure step in `--what`, never fall back to a DM, and the owner's yes
  covers this reply only ([what-the-reply-may-share.md](what-the-reply-may-share.md)).
- **`--need ruling`** — the tree's step (d). The thread reads "the owner hasn't made a general ruling on this yet,
  bringing the owner in to approve this one": a wait, never a refusal and never the act. The owner approves
  free-form, and the approval enters like every fact about the owner (§ Stand down): the owner says so, and a
  session the owner can see runs `turn unblock`. An untagged reply in an asker's thread reaches no session. The
  owner's approval covers THIS ask only — a past approval is never a grant, and ambiguous whether the owner
  would be fine with it means this, not the act.
- **`--need other`** exists because "pretty much" is not "only". Reach for it when neither fits, never to
  avoid choosing.

## Reach the page BEFORE the answer leans on it

An answer that leaned on admin.google.com, which signs out after about an hour, showed the need: anything useful must be reachable for the fleet before it answers, which can mean a
floating note and a high-priority Queue card saying to log into https://admin.google.com/ right now.

```bash
slopweaver turn reach --brief <brief> --url https://admin.google.com/ac/users [--url <another page>]
```

Run it once you know which pages in the owner's work Chrome the answer needs, and before you read them. Every origin
signed in → a reach receipt on the turn, exit 0. One signed out → it enters `turn block --need sign-in
--sign-in-url <that origin>` for you and exits 3: stand down as below. A visit it could not read exits 1 and is
never called signed out; an origin no probe reads exits 3 unchecked — Datadog and GitHub are the fleet's own
sign-ins, never the owner's. `turn answer` refuses (`REACHABILITY_UNCHECKED`) an answer whose evidence cites a probed
origin no receipt names, so **cite every browser read with its URL** — that citation is what it checks.

Entering a sign-in block by hand on a page, pass `--sign-in-url <the page>` beside `--need sign-in`. Only its
origin is kept, and it is what puts the note and the card up (rail 4). A CLI login has no page: leave it off.

**This is not the ending for "I could not work it out".** That one is `could not determine`, and it says what
you tried. This one is for a step that is genuinely the owner's and is genuinely still coming.

## The three verbs

```bash
slopweaver turn block --brief <brief> --need sign-in --what "sign in to Google Cloud locally so the monitor can deploy"
slopweaver turn blocked --json            # what is standing against the owner, and what is owed a resume
slopweaver turn unblock --channel <id> --message-ts <ts> --note "signed in" --brief <brief>
```

`turn block` does four things in one call, in this order and for this reason: it records the ask as **not
done** first (so a crash after it leaves the ask honestly stopped rather than looking like a live dispatch a
sweep will re-run), then puts the hourglass on the card, then tags the owner in the thread, then re-records the
block with the tag's own `ts`.

`turn unblock` lifts the block and prints the exact `turn dispatch` line that resumes the turn over the SAME
brief and the SAME card. It does not dispatch: re-dispatching needs a routing judgement, which is a model act
belonging in a visible session.

## Four rails, and each one is the owner's

**1 · Never a failure look.** A blocked card does not present as a failure: it says nothing about the
request failing, being unable to be handled, or the bot being broken. The card's blocked step wears `⏳`, never `✗`; the step keeps its own text; nothing in the thread
tag says failed, sorry, unable or cannot. Write `--what` in the same voice — it is rendered verbatim on a
card a colleague reads, so no gate names, no file paths and no environment variables.

**2 · No clock, anywhere.** The wait may be short or long. Never state, estimate or imply when the owner will get to it, never chase, and never let a
sweep decide a block has waited long enough. The board and the briefing remember; a countdown does not exist.

**3 · The ask is NOT done.** A blocked ask is never marked done merely to tick it off a list, because that
would misrepresent the work. `blocked-on-human` is non-terminal in the ask-lifecycle log, and `turn answer`
REFUSES to post a final answer over an ask still waiting on the owner. Do not look for a way past that refusal:
`turn unblock` is the only thing that lifts it, and it is the truthful one.

**4 · Surfaced on the fleet briefing, never the bot DM.** The fleet briefing's react-now block is where the owner
looks most; the bot DM holds too much to be read reliably. `turn blocked` posts nowhere at all; the
briefing sweep reads it and `briefing check` refuses a page whose react-now block does not link every waiting
thread. **A sign-in block with a page goes further** (the ask above): the `turn-signed-out`
monitor opens the page in the owner's work Chrome, floats the note and puts a top-tier Queue card up — one per origin, saying
to log in now — at the block itself and on every supervisor tick; `turn unblock` settles it. The note is the
monitor's, posted through the chair's lane, never by your session.

## Stand down — do not sit here holding things

Entering the state ENDS the dispatch. Your session finishes the turn and gives back its lease, its burst slot
and the single bot listener token this machine runs one of. A turn that sat blocked for a week while holding
that token would put every other ask behind a sign-in the owner has not done yet, which is rail 2 turning into
an outage. Nothing polls for the block clearing, either: "the owner did the thing" enters the system the way
every fact about the owner does — the owner says so, and a session the owner can see records it with
`turn unblock`.

## How it ends

When the owner does the thing, the turn resumes from exactly where it stopped, and then the ordinary ending
runs: the progress card is deleted, the final answer posts, the `:eyes:` reaction becomes a tick, and the
local state reads done. The owner calls that, with everyone happy and the local state updated to say it is
done, the ultimate experience here.
