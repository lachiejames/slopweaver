# 1 · An atlas is the set of all places information can be found in one platform

Part of [What an atlas must be](../atlas-intent.md).

Not a dump of one API. The whole reachable surface, as an expert who used the product every way it can be
used would see it: every bit of data or information reachable in the app — everything an expert asked to
investigate the platform would do, browsing all around its API, all around it in the browser, through its
organisation settings, across every query shape and every combination of URLs one could land on. The set of
all possible places information can be found.

**REACHABLE means reachable UNDER THE OWNER'S OWN PERMISSIONS**, which is the ceiling on that sentence. The
owner drew that line personally between two limitations a session had reported side by side: all reachable
information means all information reachable under the owner's own permissions, so where the owner is not an
admin, the admin and billing settings are expectedly out of sight, and that is part of the atlas working as
intended.

Two things follow and they cut in opposite directions, which is why the ceiling is worth stating rather
than assuming. A surface the owner's own role does not open is **correctly** absent and is not a defect — the same
non-admin bound §6 records for Slack, promoted here from a fact about one platform to a property of the
definition. And a surface the owner's role DOES open is in scope however it is reached, so "the API does not serve
it" is never on its own a reason an atlas may not hold something: §7 sends that case to the browser.
Sourced like claims 6-8 rather than from the recording sweep — this one is a spoken ruling relayed through
the supervisor chat.

**A PERMISSION BOUNDARY IS FIRST-CLASS AND VISIBLE, NEVER A GUESS.** The ceiling above makes a fenced
surface legitimate; this is what the atlas owes in exchange for that licence, and the owner asked for it unprompted
in the same breath as the ruling that opened §"a sync publishes what it read". Information unreachable
because of permissions, rather than for any other reason, must be accounted for in the atlas: it must be
clear that a thing would be reachable with a bumped permission but is not under the current one. That holds
for every atlas and integration, since the owner is not an admin on most things, so it needs first-class,
very visible support — an agent must never have to guess whether coverage is missing because the atlas is
wrong or because of permissions.

Three things follow, and each is the mechanism rather than a note, because a claim in this file that named
no mechanism is what let the property be half-built twice.

- **The fact is a FIELD, not prose.** `kit/permissionBlock.ts`'s `AtlasPermissionBlock` rides a kind's
  manifest status: when it was observed, the platform's own words for the refusal, and `unblockedBy` — the
  named grant that would lift it, **required**, because the ruling asks for what would be reachable with a
  bumped permission, and an entry that cannot name the bump is describing a broken read. It is stamped from a TYPED
  error and never from a message (GitHub's `SCOPE_REFUSED`, JumpCloud's `PERMISSION_REFUSED`, Cloudflare's
  `permission-refused`), and every failure on the kind must be that one classification.
- **The VERDICT is one word, decided once.** "Not a guess" is a statement about the reader, so
  `kit/kindReason.ts` answers "why does this kind hold nothing" for every reader rather than letting each
  one derive it: `permission-boundary` (a grant fills it), `gap` (a fix fills it), `not-attempted` (no run
  has been here), `reached`. The boundary outranks the other arms, which is only safe because the stamping
  side already refused to write one over a mixed failure.
- **It is visible on every surface an agent actually reads**: `atlas doctor` prints a line per atlas naming
  each of the three and never fails on a boundary — a fenced surface is the atlas working, so failing would
  send the fleet chasing a grant as if it were a bug; `turn brief --contracts` carries the three as separate
  clauses on the capability row; and `atlas <platform> page` prints the kind's verdict and the grant beside
  the kind itself. `kit/mandatoryKinds.ts` exempts a kind that carries a block, so the publish gate agrees
  with the page rather than contradicting it.

**REACHABLE also needs a DENOMINATOR.** The owner's ruling, on being told the Vanta policy bodies were not
held: a resync hits every GET endpoint that exists, or at least everything that can change, which is most
things, and the atlas is honest about which API endpoints and which browser URLs exist but were never hit.

The reason this is a claim and not a nicety is the failure that produced it. A coverage fraction whose
denominator is the implementation's own list of what it calls can only ever read 100%: an endpoint nobody
thought of is not a gap, it is an ABSENCE, and absences appear in no coverage report. MEASURED at the time —
the Vanta atlas declared both its surfaces `filled` while calling **24 of the 107 GET operations Vanta's own
published document declares**, and one of the eighty-three it had never been to serves every policy document
this organisation holds; the live pair lives in `atlas/vanta/descriptor.ts`, not here. A session had
established, correctly, that nine guessed routes under
`/v1/policies/{id}` answer HTTP 404, and concluded from that the API had no policy body. It had no
denominator to check that against.

So every surface declares one — `AtlasSurface.denominator` in `kit/contract.ts`, either
`{ known: true, exists, reached, source }` from the provider's own catalogue or `{ known: false, because }`
saying why none exists. `known: false` is legitimate (most providers publish no catalogue) and is not free:
the `atlas-content-coverage` gate ratchets the count of them downward, refuses a stale baseline in either
direction, and refuses outright any surface declared `filled` whose own denominator says it reached nothing.
The all-atlas position is [atlas-content-audit.md](../atlas-content-audit.md).

**A denominator that GROWS is recorded rather than refused** — the owner's ruling, after the Vanta atlas
was found dividing by one of the four API documents Vanta publishes. Increasing the denominator is logical
and serves honesty and maximum coverage, and it will simply happen sometimes: a SaaS adds features and
endpoints, or the owner is granted additional access. So the gate
ratchets the two numbers SEPARATELY: `reached` may never fall, `exists` may never fall either, and a rise in
either is written down in the same change. One composite number could not tell coverage regressing from
discovery improving, and — worse — could be satisfied by SHRINKING the denominator, which is the
self-flattering arithmetic the field exists to end.

The purpose is unknown unknowns, and the owner has said so from the first day the idea appeared: take all
the ground truth data from a platform, store it locally in a deterministic, coherent, provable, falsifiable
form, hook it up to a very smart model, and a lot of **unknown unknowns become known unknowns**.
