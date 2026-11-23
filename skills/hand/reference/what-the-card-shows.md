# What a hand card shows the owner, and what it folds away

Bundled reference for the `hand` skill.

An unblocks line makes the owner parse it to get meaning: what matters is not what unblocks what, but what happens
if the owner does nothing and what the owner might not like about it. An active incident read stalling is a card the
owner signs in on now; routine twice-daily freshness is one the owner can leave. So the card leads on that cost.

## Above the fold

- **go to** — the call-to-action chip (`site/lib/handCard.ts`'s `stepDestination`).
- **if you do nothing** — `--if-ignored`, the cost of leaving it. A step that carries none still draws **unblocks**
  here, so write `--if-ignored` on every `--blocks` step.
- The paste or the checklist, `still here because`, `kept because`, another link, `no address`.
- **where** — only when no chip draws, or when the step has the owner paste something (where says where it goes).

## Behind "how it settles"

The settling command (`done when`), the cites, the `unblocks` line a do-nothing line replaced, and a `where` the chip
already answers. **Posted by** is not drawn at all: provenance the owner never acts on. Every folded row is still one of the
card's `rows`, marked `behind`, so the template check, the voice and the chip resolver read it
(`site/lib/stepRowFold.ts`).

## Writing the line

Say what the owner would not like, concretely: _"the NZ incident read stays stalled"_, _"the Datadog monitor deploy stays
unshipped, so its alerts stay off"_, _"Trelica's read stays as of the last walk — routine freshness"_. Never the
mechanism (`each row stays paused on its failure finding`). The same posting rules read it as read `--unblocks`: no
command of the owner's in it, a `#N` needs `--cites`, a named `sd-` draft counts.

The note draws it as its footer, led `If you do nothing:` (`src/hand/note/footer.ts`); `hand list` prints it as
its own `if … does nothing:` line; the console voice reads it as the card's `ifSilent`.

## A monitor's line

A monitor declares `ifIgnored({ subject })` from its subject's data (`src/monitor/registry.ts`). `resync-signed-out`
names the stalest last success among the rows the page stopped, or `never synced`, and that a schedule raised the
card rather than a run (`src/monitor/resyncSignedOutDefinition.ts`). It cannot see a run waiting on the same
sign-in, so an incident read is not on its line. A monitor that declares none still draws `unblocks`.
