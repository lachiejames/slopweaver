# The Queue's one selector, and the tags a link carries

Part of [the Queue](./queue-and-triage.md), in [The console, the board, and the session ledger](../console.md).

**The page opens on one bar** (`components/console/QueueViewBar.tsx`) and then the cards. Nothing above the first
section heading earns its place, and a rich filter is more than the owner wants: one selector at the top that reads
"all", and opens to the views, each with its count in parentheses and each clickable.

The bar holds three things and nothing else:

- **The view selector** — one button naming the view and its count, opening a list of views each with its count
  (`site/lib/queueViews.ts`): Everything, Urgent (`priority=p0|p1`), Blocking a colleague, Blocking the fleet,
  Slack drafts (held replies and posts as you), Reviews under your name, New findings (`origin=finding`) and
  Check-ins. A view is a reading position, not a saved filter: one at a time, in the address as `?view=<name>` so a
  link the supervisor hands the owner opens on it, and absent for everything. A word that is not a view opens on
  everything rather than an empty list. Views overlap on purpose. A view with no card is listed, disabled, so a zero
  is still a count the owner can read.
- **The tag selectors a link carries**, each a removable chip. Only a link sets one now, through `?tag=`; there is no
  picker.
- **The freshness line** (`site/lib/registerFreshness.ts`), quiet when the cards are current ("updated 2m ago", the
  OLDEST reading on screen), a spinner while a read is in flight, and a staleness mark when cards it draws are an
  earlier reading or could not be read, whose hover names each register on a line of its own with its reason and
  the age of what is drawn. What is on screen is implied to be current, and when it is not the page says why; a
  read in progress is shown with a progress indicator, never text.

**A tag-borne view, or a `?tag=` selector, claims only a card whose tags read whole**, and waits on the board: every
card's tags come from it, so until it reads, Urgent and New findings print `–` and a list narrowed by them says it is
reading the board. A card inherits the tags of the board rows it belongs to (`cardTagsOf`, `site/lib/queueCardTags.ts`):

- an ask, its own row;
- a hand step, the ask its link opens, else the row that posted it (its `postedBy`, bare or `run:<slug>`);
- an act, the run of the newest act its card folds; the act's card is on the [Alignment page](./alignment.md);
- a pull request, its board row and every row whose `pr=` names it, done or closed too.

A parked post or held reply states `platform=slack` itself. A card whose inheritance did not wholly read — an unread
board, a row with no `tags` field or marked `tagsIncomplete: true`, a slug two rows share, any slug looked up while a
plan is unreadable, a partial row that may hide a `pr=` edge — is claimed by no tag.

The `?tag=` grammar is `key:value` or `!key` for a key's absence, ANDed across keys and ORed within one; a selector
that does not parse is ignored (`parseTagParams`, `site/lib/queueTags.ts`). The sidebar badge and the voice's
`read_page` count a link's tag selection on the Queue; `read_page` also names the view. An opened card resolves
against the unnarrowed rows, so a card a view hides is never "gone". Opening a card keeps the address (`panelHref`).
