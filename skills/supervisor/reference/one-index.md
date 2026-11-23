# The briefing is the ONE INDEX — the owner's list, the artifacts, and the anchors between them

Bundled reference for the `supervisor` skill. Loaded when § Fleet briefing links here, not on every turn. The
form's other fields and their caps are in [fleet-briefing-shape.md](fleet-briefing-shape.md).

## The ruling, and what it does NOT mean

The owner's design ruling, from the owner's own thinking-out-loud, in the owner's words: ideally the owner only has to look one place
generally. Maybe a couple different artifacts is okay, but the fleet briefing should definitely be directing
the owner to those artifacts and saying react now when there's something to be done on another artifact.

The answer is **ONE VIEW over the existing registers, never one merged register.** `slopweaver session-start`
is the OWNER's action queue across the team surfaces; the handover board is the FLEET's queue, with unanswered Slack
tags ranked into it ([one-board](../../handover/reference/one-board.md)). Merging the two would conflate two
actors' queues, and the drift surface the owner was worried about is exactly that. So the briefing PROJECTS the
first, states the second in its alignment line, and links out to everything else.

The owner also asked, plainly, whether this is a dumb idea. It is not, on one condition: the page stays an index. A
one-index page that grows its own depth becomes the wall rule 7 bans, which is why every section below
arrives with its own budget rather than spending the page's.

## `your list` — projected, never composed

```
slopweaver session-start --json --no-record > run.json
slopweaver briefing render --form - --your-list run.json --top 10 --out <html> < form.json
```

**The form may not write `yourList` itself; the verb refuses a form that does.** A section a composer could
retype is a section that can disagree with the verb, and a page disagreeing with the owner's own queue is worse than
one that omits it. `--your-list` is the only way to fill it, and omitting the flag is a real state — a sweep
before that verb has run renders a page with no list rather than an invented one.

Each row carries the verb's own fields: the shortened headline (cut at a word boundary by session-start's own
`headline`, never with an ellipsis), on a Slack review ask the owner's code-owner share of its one pull request with
each path as `<code>` (strict, arithmetic-checked, charged against the fold), the subject's title beside it, and a fold holding what the thing IS, who
asked, where it lives, the whole recorded question and **the exact `session-start lock-in` command** that
records the owner's one-word answer. The question keeps the shape `handover ask` recorded: each prose line is its own
paragraph and `- ` or `1. ` lines become a real list, and no two lines are ever joined, so its steps never weld
into one paragraph the packed-enumeration rule refuses. A `propose-close` row is marked `CLOSE` before its headline, because the action
on it is to close something rather than to do it.

**`background` opens the fold rather than sitting above it, and that is not settled.** The terminal list
prints it inline and a terminal has no fold; this page does, and two or three sentences across ten rows would
spend the whole above-the-fold budget. The session-start run's own recorded question asks exactly this, above
the fold against in it, and the owner has answered it for the terminal and not yet for the page. When the owner rules
on the page, change it here.

**It states what it is not showing.** The owner's list ran to 66 ranked rows and the page shows ten, so
the section prints the remaining count. A page that said nothing would read as "this is everything".

**Bare references link where the row itself can resolve them.** An `owner/repo#<n>` always links; a bare
`#<n>` links when the row's own permalink names a repository. Anything left is judged by the page-wide
bare-reference scan exactly as every other cell is — a projection cannot guess a repository, and a link to the
wrong pull request is worse than a refusal naming the row. The page-wide scan applies a second test on top of
the sole-repo one: a bare number with more digits than the largest number the page's own links prove exists in
that repository is a cross-repo citation, and is refused rather than pointed at an unrelated object.

## Each ranked line states its AGE, and its ask is framed like a card's question

A line once printed only its landing stamp, so the one
thing the owner wanted from the band — how long this page has been sitting there — was a subtraction against the
eyebrow. So it prints `landed 6 days ago` beside that stamp, computed by the renderer from the page's own
instants, never typed. The `ask` cell is the card question's twin, so it carries the same two refusals: no
asking permission for what doctrine already settles, and no asking the owner to choose between implementations
([card-framing](card-framing.md)). The band's own contract line and every `ask` are read for unglossed fleet
words; a page's `label` and a supersession's `by` are not, because somebody else named those.

## `awaiting` — required, and renders nothing

`awaiting` renders **nothing**. The owner reads only react-now and treats every other
section as stale, so everything the owner reacts to belongs in it, and everything else is rewritten into the
react-now section in some way.

MEASURED on the owner's live page, which is the strongest form of the complaint: all three entries
duplicated rows of the ranked index, all three were `pending`, and once every open page became a card the
three pages the owner was being pointed at appeared **2, 4 and 5 times each** on one page. Reproduce over any
rendered page with `grep -c` on the page's own label.

The field is **required and validated**, deliberately: dropping it from the schema would refuse every live
form, the flag day [open-page-cards.md](open-page-cards.md) avoids. Write `"awaiting": []`; a form carrying
entries renders unchanged, minus the section. `AWAITING_MAX_ITEMS` bounds what a hand-written page may carry,
which is `briefing check`'s job rather than the renderer's.

## `reactNow.openArtifacts` — the RANKED INDEX of every page open on the owner

Ten to fifteen pages get created and opened in different tabs over a couple of hours, and the owner cannot tell
which to react to first because earlier steering invalidated some of them. Two defects. The pages were **invisible** — three pointers over a
pile of fifteen hid twelve. And they were **unjudged** — nothing marked a page the owner's own later steer had
already settled.

So the react-now block carries a third field beside its two card groupings. Each entry is
`{ "rank": 1, "label": …, "url": …, "ask": [runs], "landedIso": …, "validity": {…} }` — the link, the
session's one-sentence ask, the instant it landed, and the mark. Ranked from 1 with no gaps, one page named
once, at most `OPEN_ARTIFACTS_MAX_ITEMS` (fifty) of them.

**The validity mark is DERIVED, never typed.** `src/briefing/openArtifacts.ts` computes all three from the
LOCK-IN LEDGER — the same ledger `session-start lock-in` writes and `src/sessionStart/standing.ts` already
calls a ruling — so a mark cannot read `valid` on a page the owner's own steer settled:

| Mark           | It comes from                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------- |
| `valid`        | no lock-in row names the page, or the row LAPSED because the page moved after the owner ruled |
| `partly-ruled` | a row still holds; the mark carries its own `ruledIso` and `outcome`                          |
| `superseded`   | a holding `rejected`/`dropped` row whose `note` names another artifact URL; the mark links it |

Record one with `slopweaver session-start lock-in --item <artifact url> …`, which is the URL key the ledger
already accepts for a supervisor holding a link rather than a row. A supersession is READ off that note — two
pages being about similar things never concludes one replaced the other.

**You never write this section, exactly as you never write `yourList`.** A form carrying
`reactNow.openArtifacts` is REFUSED, naming the flag. Fill it by writing the sweep's own document — a JSON
array of `{ "label", "url", "ask", "landedIso", "updatedIso"? }`, every field required except the last —
and passing `--open-artifacts <path|->`:

```bash
slopweaver briefing render --form - --your-list list.json --open-prs \
  --open-artifacts open-pages.json --out ./scratchpad/fleet-briefing.html < form.json
```

The verb reads the ledger out of `--home` and derives every mark. `updatedIso` is when the page last MOVED,
which is what lapses a ruling — a session that republished a page in response to the owner's steer gets its page
back unmarked, without anyone remembering to clear it. Omit it and the page is judged against `landedIso`.

The index renders inside react-now as `p.ranked` lines under an `<h3 id="react-now-artifacts">`, and the
react-now block cannot say "nothing open above the line" while it carries one. Omitting the field entirely
is admitted and defaults to empty — an empty index claims nothing, and a real one is what the owner asked for.

## Anchors — progressive disclosure INSIDE one page

A run may be `{ "kind": "anchor", "target": "<section id>", "text": "…" }`, which renders as an in-page
fragment link. A card above the line can therefore point at its own detail further down the same page rather
than at a second artifact.

Ids the renderer emits: `react-now`, `alignment` and `recent` unconditionally, plus `your-list`,
`react-now-team`, `react-now-me`, `react-now-waiting`, `react-now-artifacts`, `autonomy-ledger`,
`waiting-on-you`, `owner-beliefs` and `quiz` — each of those only when its own section renders, which
`src/outbound/briefing/schemaWalk.ts`'s `anchorTargetsOfForm` computes per form. `#awaiting` is not among
them, so an anchor naming it is refused rather than shipped dead. A collapsed section
mints its own with `"id": "todays-rulings"`, which may not collide with those and may not be used twice.

**Both halves refuse a dead anchor.** The form refuses a target no section on THIS page will carry;
`briefing check` refuses an `href="#…"` naming no element on a page it did not render. A link that scrolls
nowhere reads as a page that ignored the click, and nobody reports it because nothing appears to happen.

## The budgets

| Section          | Cap                                                                       |
| ---------------- | ------------------------------------------------------------------------- |
| a row's headline | 30 words (measured: the owner's longest of 66 ran to 24)                  |
| `your list`      | 10 rows, 300 words above the fold (measured: 224 for the owner's top ten) |
| an index line    | 1 sentence, 30 words                                                      |
| `openArtifacts`  | 50 entries, ranked from 1 with no gaps                                    |

The page's own above-the-fold budget is 1000 words — the owner's real list plus
a card and the alignment line measured 462 words. `src/briefing/caps.ts` carries the
measurement behind each number; reproduce them with `slopweaver session-start --json --no-record`.
