# Mid-investigation: an honest state, pushed unless silence risks nothing and the owner has not asked

Bundled reference for the [hand](../SKILL.md) skill. The doctrine it implements is
[the hunt's § Surface early when it stalls](../../automation/reference/organisation-hunt.md#surface-early-when-it-stalls)
and [stuck chats](../../supervisor/reference/stuck-chats.md); this page is the verb and the criterion.

## What the owner asked for

Surface early when work is neither done nor blocked. A seat that has followed the docs, debugged, investigated and
cross-checked with Codex, and still sees reality not lining up with the documented behaviour, says so: an honest
"I don't know why" is fine, and so is "maybe the vendor's end, maybe we read the docs wrong". Offer a hedge in
parallel, such as chasing support, for the case that the fleet cannot solve it alone. And a fact behind a permission
wall (at Acme the fleet has admin on the slopweaver repository and read on the rest) surfaces as the access to ask
for and from whom: ask the holder to temporarily bump access, or to take a screenshot of that page.

## The criterion is risk, not "a human could help"

The criterion is settled by examples:

| The owner's example                                                               | `--urgency`    | Reaches the owner              |
| --------------------------------------------------------------------------------- | -------------- | ------------------------------ |
| A subscription nobody can say is still used, no deadline                          | `none`         | Queue card                     |
| The same subscription renewing tomorrow for $12k, cancellation today              | `breaking`     | Queue card and a floating note |
| A GitHub Actions runner outage, the team blocked, an access ask                   | `breaking`     | Queue card and a floating note |
| A send the owner approved, low priority, stopped on a sign-in only the owner does | `blocked-send` | Queue card and a floating note |
| Every seat waiting on one decision of the owner's, no deadline                    | `fleet-idle`   | Queue card and a floating note |
| One seat needing a design pick it could leave for other work                      | `none`         | Queue card; the seat parks     |
| The orb and desktop designs the owner is keen to see                              | `keen`         | Queue card and a floating note |
| Payment failures rising sharply, customer impact not yet known                    | `close-call`   | Queue card and a floating note |
| A steer of the owner's the fleet cannot act on                                    | `close-call`   | Queue card and a floating note |
| A new steer of the owner's while every seat is busy                               | not a report   | the usual priorities, no pause |

The tie-breaker is what could go wrong either way. Not telling the owner risks something really bad, and the owner
asking why the fleet did not say; telling the owner risks only a get-that-out-of-the-way, far less of a problem. The
risk-based approach: when the two are close, surface: `close-call` names what silence risks (`--if-silent`). `none` is
the claim that silence risks nothing bad and the owner has not asked to see it. A send blocked on something only the
owner can do is told to the owner early even when low priority, and a sign-in is fine as a floating note:
`blocked-send` (`--send`).

The floor: run the verb only for what is worth the owner's knowing and attention — a struggle a seat can still push
through alone is not a report yet. The pain point is a steer the owner gave sitting undone for days until the owner
asks; so a steer the fleet cannot act on is itself worth investigating, and its report is a `close-call` whose
`--if-silent` is exactly that.

The reason for each note: something might be about to break while the owner and the fleet still have the chance to fix
it; it should be pushed to the owner, not pulled from the owner (the runner outage, where the whole software
development lifecycle is at a pause); the owner's fleet capacity is maxed at all times; and excitement is not the same
as urgency, but the owner wants to see those floating notes. `keen` is the OWNER's stated keenness, never a seat's
guess. A seat with no steer parks and is closed, and a session with a steer takes its slot; pausing other work for
a new steer needs the owner's explicit word.

## The verb

```bash
slopweaver hand surface --row actions-runner-outage --ask-slug actions-runner-outage-access \
  --tried "re-ran the failed jobs" --tried "checked the runner labels" --doc <docs url> \
  --documented "a queued job is picked up by a matching runner" --observed "jobs sit queued, no runner assigned" \
  --codex "Codex read the same docs and agrees" --why "I do not know why" \
  --hedge "email GitHub support now while we keep pulling" \
  --access "read on the org's Actions runner settings" --holder Rosa --would-settle "whether the pool is empty" \
  --urgency breaking --breaks "every merge to main" --by now --note-what "Ask Rosa for read on the runner settings" \
  --question … --problem … --options … --lean … --risk … --blast-radius … --still-real … \
  --evidence <permalink> --observed-by workspace:77 --context work
```

It runs nothing. It prints:

1. **The report**, in the owner's order: tried, docs followed, what they say, what happens instead, the Codex cross-check,
   the why verbatim, the hedge, the access and its holder, the route. Write it to the investigation's page.
2. **A `handover register --finding` line, every route.** Run it yourself: a shaped finding row is a Queue card with
   no run behind it ([registered-ask-queue](../../handover/reference/registered-ask-queue.md)), so the
   investigation keeps running. `--ask-slug` is that NEW row and is refused when it equals `--row`; `handover ask`
   would pause the run instead.
3. **A `hand post` line, note routes only**, already put through `buildHandStep` and `postingRefusal`, opening the
   Queue row and owned by it, so the owner's note leaves when that row settles. Only the pinned supervisor posts
   (`src/hand/seatPost.ts`): send it THAT one line with SendMessage, never the whole report.

`--note-what` is a step the owner's hands take: an access ask names the holder and the access, never "the investigation is
struggling" — the register refuses a sentence naming the fleet as its actor. The criterion lives in
`src/hand/midState.ts` (`midStateRoute`), its examples in `src/__tests__/unit/hand/midState.test.ts`.
