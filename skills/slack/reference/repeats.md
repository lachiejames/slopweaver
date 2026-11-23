# Never the same message twice

A finding once reached a channel twice under the owner's name. A stale seat hand-composed an older cut of it into
a fresh `slack post --as me` two hours after the first landed; the content-hash reservation saw different bytes
and passed it, and nothing read the channel. The repeat is now structurally impossible.

## The guard at the wire

`src/corpus/slack/writeGuardRepeat.ts` wraps every live write transport (`makeSlackWriteTransport`), both
identities. Before a card, a no-fold message, an as-me drip, a poll, a recipe response or an assistant ANSWER
goes out, it reads the place: the channel's last 7 days for a top-level post, the whole thread for a reply. It
refuses when this identity already said:

- **the same words** (normalised: entities, markup, case, whitespace), or
- **the same first line**, when that line is at least 40 normalised characters long.

The refusal names the existing message's permalink and says to `slopweaver slack edit` it. It fires before the
wire, so the send's reservation is released rather than held as unconfirmed.

**It fails closed.** A place that cannot be read (`not_in_channel`, a page ceiling) refuses too, because "could
not check" is not "checked and clear". The way past either refusal is the journalled hatch:
`slopweaver hatch open repeat-send --reason "<why>"`. Named exceptions: a deliberate re-post after deleting the
first, while history still lags; a recurring message whose first line is fixed by design.

A byte-identical resend meets the send's content-hash reservation first. One that LANDED needs the override
token its error names, after checking with the operator.

Not guarded, on purpose: a live turn frame (keyed by its turn, edited in place), a stream, a held or failure
NOTICE (fixed words), an `automation-prompt` (a recipe's standing question, asked verbatim every firing and
only ever in the private prompt DM; its form kind, never its text, sets `recurrence` on the send), and every
edit. Without that last one, a daily recipe row was refused on its second day.

The residue: two sends with different bytes racing into one place within the same seconds both read before
either lands, so both pass. A byte-identical race meets the reservation. The incident was two hours apart.

## The audit: `slack repeats`

`slopweaver slack repeats [--days 7] [--as me|bot|both] [--json]` reads every place each identity posted in
the window and groups repeats with the same matcher, using a 1-day window for the first-line rule. It keeps the
earliest copy with the most files. A later copy is `delete`, with the exact `slack delete` command, or `review`
when someone else replied under it. `wouldRefuse` lists what the guard would have stopped. It reads and never
deletes. It exits 1 whenever a place could not be read: a partial audit is never an all-clear.

## Drafts

A parked draft is spent by its OTHER rows too (`src/outbound/slack/draftSpent.ts`):

- `slack draft record --supersedes <sd-id>[,<sd-id>…]` refuses unless every row it names is still held, then
  drops each once the new row parks, with a `superseded by` note the console follows to the live cut.
- A reply into a thread already holding one under the same identity refuses unless `--supersedes` names every
  held reply there, so one thread is one card (`src/outbound/slack/draftSameThread.ts`).
- A release journals its permalink, then drops every other held cut the register records as the same message: the
  same author, place and words, or a `--supersedes` lineage. A held cut that only shares the counted first line is
  kept and named, since it may carry the owner's yes; the wire refuses it if it repeats (`releaseSpendsCuts`).
- A release whose digest a released row already carries is refused, naming where that one landed.
