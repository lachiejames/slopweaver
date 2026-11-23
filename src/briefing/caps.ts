/**
 * The hard caps the briefing gate refuses on, and the measurement each one came from.
 *
 * Owner ruling: a react-now card whose `what` runs to roughly six hundred words is a wall of text that is
 * difficult to react to, and a decision made without being informed drifts what is built away from what the
 * owner would be happy with. The problem recurs, so enforcement is mechanical. These are numbers a gate
 * refuses on, not guidance a composer may weigh.
 *
 * ## Every number below was measured, not chosen
 *
 * Reproduce the measurement over any saved copy of the briefing artifact:
 *
 * ```
 * slopweaver briefing check <html>
 * ```
 *
 * On the measured artifact, which a shape-only check passes clean, that file measured:
 * one react-now card at 182 words above the fold, its `what` 72 words above the fold and 496 with the fold
 * opened; the whole page 12,970 words above the fold, of which 12,351 sat in ONE section holding 129
 * unfolded blocks. Every other section on that page totalled 327 words above the fold. The caps are sized
 * against the disciplined part of that page, never against the runaway part.
 *
 * The one-index caps at the bottom of this file were measured a different way, because the sections they
 * govern are fed mechanically rather than composed. Reproduce theirs over the owner's real list:
 *
 * ```
 * slopweaver session-start --json --no-record
 * ```
 */
import { LESSON_CLAIM_MAX } from "../knowledge/types.js";
import { PROPOSAL_CLAIM_MAX } from "../knowledge/voice/types.js";
import { DEFAULT_TOP } from "../sessionStart/render.js";

/**
 * The longest a react-now question may run, in words.
 *
 * Thirty, which is `ABOVE_FOLD_SENTENCE_MAX_WORDS` in `../outbound/voice/aboveFold.ts` rather than a second
 * opinion about the same thing: a question is already required to be exactly one sentence, so its word cap
 * IS the repository's existing one-breath sentence cap. The measured card's question was 24 words.
 *
 * It restates that cap here on purpose rather than leaning on the voice pass, which the shared break-glass
 * can lift. A cap must not be liftable by an override aimed at the operator's private word list.
 */
export const QUESTION_MAX_WORDS = 30;

/**
 * The longest a `what` may run above the fold, in words.
 *
 * Sixty, twice the 30-word one-breath sentence cap, because `what` is the only field required to carry at
 * least two sentences of background. The measured card was 72 words above the fold AFTER the session had
 * rewritten it, and 496 before — so this cap refuses both the wall and the
 * first-pass correction of it, which is the point.
 */
export const WHAT_MAX_WORDS = 60;

/**
 * The most sentences a `what` may carry above the fold.
 *
 * Four. The existing contract's floor of two stays; this is the ceiling that was missing. The measured card
 * had 3 above the fold and 15 with the fold opened.
 */
export const WHAT_MAX_SENTENCES = 4;

/**
 * The longest `why you`, `lean` or `if silent` may run above the fold, in words.
 *
 * Thirty, the one-breath sentence cap again, because none of these three is background — each is a single
 * claim. Measured on the same card: 20, 1 and 3 words.
 */
export const SHORT_FIELD_MAX_WORDS = 30;

/**
 * The most sentences `why you` may carry above the fold.
 *
 * One. Owner ruling, locking the short card shape: `why you` is one sentence. It measured one sentence on
 * the measured card.
 */
export const WHY_YOU_MAX_SENTENCES = 1;

/**
 * The most sentences `lean` or `if silent` may carry above the fold.
 *
 * Two. Both measured one sentence on the measured card, and the locked shape does not fix a count for either,
 * so two leaves room for a claim plus its consequence without leaving room for a paragraph. This is
 * deliberately NOT narrowed to one alongside `why you`: the ruling named that field and not these.
 */
export const SHORT_FIELD_MAX_SENTENCES = 2;

/**
 * The longest one option may run, in words.
 *
 * Twenty-five. The measured card carried four options totalling 54 words, so 13 or 14 words apiece; 25 is
 * nearly double the measured option and still under the one-breath sentence cap.
 */
export const OPTION_MAX_WORDS = 25;

/**
 * The most options one card may offer.
 *
 * Four. Owner ruling, locking the short card shape: options A/B/C/D, one sentence each.
 * The measured card offered exactly four, and the repository's own count of things a reader can hold above the
 * fold on a Slack card (`INDEX_MAX_ITEMS`, nine) is far looser than this needs to be.
 */
export const MAX_OPTIONS = 4;

/**
 * The longest one concrete example on an ask card may run, in words.
 *
 * Owner rule: every open Queue card carries a scene the owner can picture — what they would be busy doing, and
 * the notification that would pop up, asking whether they would have wanted it — with the
 * question the card is really asking at its end. So the cap is the two caps that scene is made of, summed rather
 * than chosen: a `what`'s background ({@link WHAT_MAX_WORDS}) plus the one-breath question
 * ({@link QUESTION_MAX_WORDS}). The examples sit behind the card's own disclosure, never on the list row.
 */
export const ASK_EXAMPLE_MAX_WORDS = WHAT_MAX_WORDS + QUESTION_MAX_WORDS;

/**
 * The most concrete examples one ask card may carry.
 *
 * Three, the owner's number: related asks fold onto one card as three concrete examples with a request for
 * the owner's reaction. A ruling, like {@link MAX_OPTIONS}, not a measurement.
 */
export const MAX_ASK_EXAMPLES = 3;

/**
 * The longest one whole react-now card may run above the fold, in words.
 *
 * Two hundred. The measured card was 182 with its detail folded, so this refuses nothing that page's
 * best card did and refuses any card that grows past it. It is the backstop rather than the front line:
 * six fields each just inside its own cap would still exceed it, which is the case the per-field caps miss.
 */
export const CARD_ABOVE_FOLD_MAX_WORDS = 200;

/**
 * The most unfolded blocks the page may carry outside the react-now block.
 *
 * Five. Every section below the line is meant to live inside a collapsed `<details>`
 * (`skills/supervisor/reference/fleet-briefing-shape.md`), so the honest cap is near zero; five leaves room
 * for the newest landings to stay visible. The measured page carried 130, of which 129 sat in one section
 * that had been accumulating every sweep since the run began.
 */
export const PAGE_UNFOLDED_BLOCKS_MAX = 5;

/**
 * The most cards the react-now block may carry, across both of its groupings.
 *
 * Fifty. Owner ruling, folding the separate ranked-list artifact into this block and widening
 * its scope to progressing every open pull request: react-now MAY run to about fifty cards when steers are
 * owed, and that is the design working, not a wall — the two groupings and the per-card fold are what keep
 * it walkable. So the number is a ruling rather than a measurement, the same way {@link MAX_OPTIONS} is,
 * and it is a cap rather than no cap because a block nothing bounds is the accumulation
 * {@link PAGE_UNFOLDED_BLOCKS_MAX} was measured against.
 *
 * MEASURED: 36 open pull requests on the work repository, so a card each plus the
 * supervisor's own decisions fits inside this with room and refuses a block that has stopped being a list of
 * things to react to.
 */
export const REACT_NOW_MAX_CARDS = 50;

/**
 * The most words the page may put above the fold OUTSIDE the react-now block.
 *
 * One thousand, which is {@link CARD_ABOVE_FOLD_MAX_WORDS} times {@link PAGE_UNFOLDED_BLOCKS_MAX} —
 * arithmetic kept because the number it produces is the one that was measured, not because the page still
 * holds five cards. Measured against the same page it is generous three times over: every section except
 * the runaway one totalled 327 words above the fold, and the page as a whole totalled 12,970.
 *
 * ## Why the cards are no longer inside it
 *
 * The owner ruled react-now may run to {@link REACT_NOW_MAX_CARDS} cards.
 * A page total that counted them would refuse that design at the eighth card, so the honest split
 * is the one the caps already make everywhere else: what bounds a card is
 * {@link CARD_ABOVE_FOLD_MAX_WORDS}, what bounds the BLOCK is a count of cards, and what bounds everything
 * else on the page is this. A section brings its own budget rather than eating another section's — the same
 * call {@link YOUR_LIST_ABOVE_FOLD_MAX_WORDS} makes.
 *
 * `../briefing/pageBudget.ts` measures it over `reactNowRegion`'s `outside`, which is what the react-now
 * block is already removed from for the unfolded-block count, so both page rules read the same region.
 */
export const PAGE_ABOVE_FOLD_MAX_WORDS = CARD_ABOVE_FOLD_MAX_WORDS * PAGE_UNFOLDED_BLOCKS_MAX;

/**
 * The most sentences one paragraph may carry above the fold, anywhere on the page.
 *
 * Four, the same number as {@link WHAT_MAX_SENTENCES}, so one rule governs every paragraph a reader meets
 * without expanding anything. Owner ruling: run-on sentences are not how the owner talks, so the page does
 * not carry them. Measured on the measured page, 62 of its 207 text blocks
 * carried more than four sentences and the worst carried thirteen in one paragraph.
 */
export const BLOCK_MAX_SENTENCES = 4;

/**
 * The most inline enumerators one paragraph may carry, folded or not.
 *
 * Two, so three refuses. Owner ruling: a numbered set of items is a real list, one item per
 * line, never "1 x. 2 y. 3 z." packed into a paragraph. Measured on the measured page, no block carried more
 * than two, so this refuses nothing that page did and refuses the shape the owner named the moment it appears.
 * It applies inside a fold as well as above it — a packed enumeration is unreadable wherever it sits.
 */
export const BLOCK_MAX_ENUMERATORS = 2;

/**
 * The most raw bytes one embedded image may carry, before base64 encoding.
 *
 * Four mebibytes. The Artifact publishing contract this page is rendered through caps a whole page at 16 MiB,
 * `data:` URIs included, and base64 inflates raw bytes by 4/3 — so one image at this cap embeds as roughly
 * 5.3 MiB of page text. Owner ruling, on a react-now card carrying a drafted Slack post: the
 * screenshots render INSIDE the card, never a file path the owner has to go find, so the cap is sized to hold
 * an ordinary full-resolution screenshot rather than to force a composer to downsample one.
 */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The most bytes one paste block's `text` may carry.
 *
 * Four kibibytes. MEASURED over the card that produced the block kind: a fold asking the owner to
 * paste 25 read-only Google Admin scope URIs into one console box, comma separated, which is **1,725 bytes**
 * on one line. Reproduce over any such list, one URI per line:
 *
 * ```
 * python3 -c "import sys;print(len(','.join(l.strip() for l in sys.stdin if l.strip()).encode()))" < scopes.txt
 * ```
 *
 * Four kibibytes is over twice that, which holds a longer scope list, a shell command or a block of
 * configuration, and refuses a whole file pasted into a card. What bounds how MANY paste blocks a page may
 * carry is {@link PAGE_TEXT_MAX_BYTES}, the same backstop that already bounds every other run of text the
 * supervisor writes, rather than a second count invented here.
 */
export const PASTE_MAX_BYTES = 4 * 1024;

/**
 * The most raw bytes the WHOLE page may embed across every image, summed.
 *
 * Nine mebibytes raw, roughly 12 MiB once base64-encoded, leaving about 4 MiB of the same 16 MiB Artifact
 * ceiling for the page's own HTML, CSS and text. Three screenshots each near {@link IMAGE_MAX_BYTES} would
 * total 12 MiB raw on their own and refuse here — deliberately: three unusually large screenshots on one
 * card is exactly the case this number exists to make a composer resize or drop one, not a case it should
 * silently let through.
 */
export const IMAGE_TOTAL_MAX_BYTES = 9 * 1024 * 1024;

/**
 * The longest the alignment line may run above the fold, in words.
 *
 * Fifty-five. The line is not composed freehand — `../handover/reconcile.ts` generates it — so this cap is
 * sized against what that generator can actually emit rather than against taste. It states ONE number to chase
 * and what it means, in one of seven mutually exclusive sentences; the widest — a gap with no live session
 * free to move — measures **31 words** in one sentence. That number is a bound rather than a sample, because
 * the test enumerates every branch, and it is asserted rather than described:
 *
 * ```
 * yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/handover/reconcile.test.ts
 * ```
 *
 * Fifty-five: the line sets eight counts side by side and measures 50, so this leaves the one-number line room without the two halves of this gate disagreeing, and still refuses a composer who replaces the generated line with a paragraph of their own.
 *
 * ## What this cap deliberately does NOT have to hold
 *
 * The owner-intake sentence. Riding on the same headline, the two halves of the gate would contradict each
 * other outright: MEASURED with the maximal report of each half, the intake sentence
 * runs to 44 words across two when it discloses a coverage gap, so the joined line would run to 94 words and 3
 * sentences — over this cap and over {@link ALIGNMENT_MAX_SENTENCES} at once, while the sweep contract says
 * that same generated line goes into the form VERBATIM. Raising this number to fit was rejected: `../supervisor/chain.ts`'s coverage clause and `Owner turns unread: <why>` are not
 * bounded by anything a cap here could be sized against. So the intake sentence is its own field
 * (`../outbound/briefing/types.ts`'s `BriefingAlignment.intake`), rendered FOLDED, and uncapped for exactly
 * the reason every other fold is.
 */
export const ALIGNMENT_MAX_WORDS = 55;

/**
 * The longest the page's LEDE may run above the fold, in words.
 *
 * {@link WHAT_MAX_WORDS}, reused rather than a fresh number, because the lede is the same kind of cell a
 * card's `what` is: the two or three sentences of background a reader meets before anything asks the owner for
 * something, with no fold under them to escape into. The owner ruled the briefing is aligned with the
 * card-quality gate's way of writing, which is much easier to read, and this is the one LENGTH that follows
 * from it, because it is the one composed cell above the fold that would otherwise have no word cap at all.
 *
 * MEASURED over the 156 forms this install has rendered
 * (`yarn tsx src/measurement/briefingSectionQuality.entry.ts --forms '~/.slopweaver/supervisor-scratch/handoff-*\/form.json'`):
 * the lede's median is 64 words and its longest 155, against a `what` median of 52 under the same cap — so
 * 79 of 156 ledes, 51%, are over it, and the cell the cap is borrowed from sits inside it with room.
 *
 * Its sentence cap is {@link BLOCK_MAX_SENTENCES} and did not move: the lede already carried one.
 */
export const LEDE_MAX_WORDS = WHAT_MAX_WORDS;

/**
 * The most sentences the alignment line may carry above the fold.
 *
 * Two. The generated line is exactly one; two leaves room for a composer to add the single consequence
 * sentence a reader would otherwise have to open the fold for, and no room at all for a paragraph. It is the
 * same number {@link SHORT_FIELD_MAX_SENTENCES} carries, for the same reason.
 */
export const ALIGNMENT_MAX_SENTENCES = 2;

/**
 * The most rows of the owner's own list the page shows above the fold.
 *
 * `DEFAULT_TOP` from `../sessionStart/render.ts` rather than a second opinion about the same thing: the list
 * is fed mechanically by that verb, so the page shows what a `slopweaver session-start` run shows and the two
 * cannot drift. MEASURED over the owner's real list (`slopweaver session-start --json --no-record`): 66
 * rows ranked, and the top ten headlines totalled 153 words above the fold — a sixth of
 * {@link PAGE_ABOVE_FOLD_MAX_WORDS}, which is what makes the owner's whole queue affordable on the same page as the
 * cards. The rows past this cap are never dropped silently: the section states how many it is not showing.
 */
export const YOUR_LIST_MAX_ROWS = DEFAULT_TOP;

/**
 * The longest one of the owner's rows may run above the fold, in words.
 *
 * Thirty, the one-breath sentence cap again, and the same number {@link QUESTION_MAX_WORDS} carries — a row
 * on the owner's list is a question answered in one word, exactly like a card's. MEASURED on the same real list:
 * the longest of 66 headlines ran to 24 words, the ninetieth percentile to 21 and the median to 15, so this
 * refuses nothing the list produces and refuses a headline that grows past one breath. The whole
 * recorded question is never cut to fit — it sits in the row's own fold, and `../sessionStart/render.ts`'s
 * `headline` is what shortens the line, at a word boundary and never with an ellipsis.
 *
 * It measures the HEADLINE, not the whole row: the rank number is the renderer's and the `title` beside it is
 * the source's, and neither is prose to hold to a breath. {@link YOUR_LIST_ABOVE_FOLD_MAX_WORDS} is what
 * bounds those.
 */
export const YOUR_LIST_HEADLINE_MAX_WORDS = 30;

/**
 * The most words the owner's whole list may put above the fold.
 *
 * {@link YOUR_LIST_MAX_ROWS} times {@link YOUR_LIST_HEADLINE_MAX_WORDS} — ten maximal rows and nothing else,
 * the same arithmetic {@link PAGE_ABOVE_FOLD_MAX_WORDS} uses over cards.
 *
 * It is the backstop the per-row cap cannot see, and it has a second job the card caps do not: a row's own
 * `title` is a fact its source supplies rather than prose a composer wrote, so it carries no cap of its own —
 * capping it would refuse a real pull-request title — and this total is what bounds it. MEASURED:
 * the top ten rows totalled 224 words above the fold with every rank number and title counted, the longest
 * single row 29.
 */
export const YOUR_LIST_ABOVE_FOLD_MAX_WORDS = YOUR_LIST_MAX_ROWS * YOUR_LIST_HEADLINE_MAX_WORDS;

/**
 * The longest one of the owner's rows' `who` may run, in characters.
 *
 * 120, which is the number `../outbound/briefing/schema.ts` already refused at — named here rather than
 * spelled inline there, so the one place a reader looks for this page's numbers carries it and a producer
 * can be pointed at it. It is EXTRACTED, not re-measured: nothing was measured that chose 120, and the row
 * this cap refused was a defect on the producer's side rather than evidence the number was wrong.
 *
 * MEASURED, which is why the note above matters: a board row built its `who` out of a
 * 110-character run slug, reached 122, and `briefing render` refused the whole page at
 * `yourList.rows.N.who` — a form refusing the owner's own list over an identifier the same row already carried
 * twice. `../sessionStart/boardLeg.ts` names the session's role instead, and this cap is unchanged.
 */
export const YOUR_LIST_WHO_MAX_CHARS = 120;

/**
 * The most artifacts the page may send the owner to from the UNRANKED pointer band.
 *
 * Three. Owner steer, on making the briefing the one place the owner looks: a couple of different
 * artifacts is fine, but the fleet briefing directs the owner to them — so the
 * number is a ruling rather than a measurement, the same way {@link MAX_OPTIONS} is. Three leaves room
 * for the standing daily artifact, one more standing surface and one ad-hoc page, and refuses the link farm
 * a one-index page turns into the moment every surface adds itself.
 *
 * ## What it does not bound
 *
 * It does not bound EVERY artifact the page could name, because that would put the owner's own open pages
 * out of sight. The owner can have ten to fifteen artifacts created and opened in different tabs over a couple
 * of hours, and then not know which one to react to first because earlier steering invalidated some of
 * them. A cap of three over a pile of fifteen does not curate the pile, it hides twelve of it.
 *
 * So the two bands are different things and carry different bounds. THIS one still governs the standing
 * `awaiting` band — a handful of durable surfaces, each a pointer somebody chose to put on the page, and
 * exactly the band a link farm grows out of. The RANKED index of open artifacts inside react-now is bounded
 * by {@link OPEN_ARTIFACTS_MAX_ITEMS} instead, because a ranked, validity-marked list is the opposite of a
 * link farm: its whole job is to be complete.
 */
export const AWAITING_MAX_ITEMS = 3;

/**
 * The most open artifacts the ranked react-now index may carry.
 *
 * {@link REACT_NOW_MAX_CARDS}, reused rather than a fresh number, because it bounds the same thing the
 * fifty-card ruling bounded: the one block the owner scrolls. An index longer than the card list it sits above has
 * stopped being an index of what to react to next.
 *
 * MEASURED against the ask that created it — ten to fifteen
 * artifacts open across the owner's tabs in a couple of hours. Fifty holds a morning like that three times over and
 * still refuses an index nothing bounds.
 */
export const OPEN_ARTIFACTS_MAX_ITEMS = REACT_NOW_MAX_CARDS;

/**
 * The longest one open artifact's ask may run, in words.
 *
 * {@link AWAITING_MAX_WORDS}'s number and its reason, because it is the same kind of cell: one claim, one
 * breath, saying what the session that opened the page wants from the owner. The page it points at carries the
 * depth.
 */
export const OPEN_ARTIFACT_ASK_MAX_WORDS = SHORT_FIELD_MAX_WORDS;

/**
 * The most sentences one open artifact's ask may carry.
 *
 * One. The owner asked for the session's one-sentence ask and this is that sentence — a second one is this page
 * re-briefing the owner about a decision that lives on the page it is pointing at.
 */
export const OPEN_ARTIFACT_ASK_MAX_SENTENCES = WHY_YOU_MAX_SENTENCES;

/**
 * The longest a waiting card's `session` name may run, in characters.
 *
 * {@link SUPERSEDED_BY_MAX_CHARS}'s number and its reason, because it holds the same thing: the name of
 * something the owner could go and look at, as the owner would recognise it. A worktree slug, a handoff number, a cmux
 * workspace title — never a sentence about what it is doing, which is what `event` carries.
 */
export const WAITING_SESSION_MAX_CHARS = 120;

/**
 * The longest a waiting card's `event` may run, in words.
 *
 * {@link SHORT_FIELD_MAX_WORDS}, because it is the same kind of cell a card's `why you` is: one claim, one
 * breath, naming the single thing that has to happen before the card is the owner's. It renders above the fold, so
 * it counts against the card's own 200 exactly as the six fields do.
 */
export const WAITING_EVENT_MAX_WORDS = SHORT_FIELD_MAX_WORDS;

/**
 * The most sentences a waiting card's `event` may carry.
 *
 * One. {@link OPEN_ARTIFACT_ASK_MAX_SENTENCES}'s number and its reason: a second sentence here is the card
 * explaining the work instead of naming the moment the wait ends, and the `what` already carries the work.
 */
export const WAITING_EVENT_MAX_SENTENCES = WHY_YOU_MAX_SENTENCES;

/**
 * The longest a supersession's `by` label may run, in characters.
 *
 * The same bound {@link AWAITING_MAX_ITEMS}'s own band puts on an artifact `label`, because it holds the
 * same thing: the name of a page, as the owner would recognise it.
 */
export const SUPERSEDED_BY_MAX_CHARS = 120;

/**
 * The longest one artifact's "what is waiting for you there" may run above the fold, in words.
 *
 * {@link SHORT_FIELD_MAX_WORDS}, because it is the same kind of cell a card's `why you` is — one claim, one
 * breath — rather than a second number about the same thing. It is a redirect, not a briefing in miniature:
 * the page it points at carries the depth.
 */
export const AWAITING_MAX_WORDS = SHORT_FIELD_MAX_WORDS;

/**
 * The most sentences one artifact's line may carry above the fold.
 *
 * One. {@link WHY_YOU_MAX_SENTENCES}'s number and its reason: a second sentence here is the beginning of
 * re-briefing the owner on this page about a decision that lives on another one.
 */
export const AWAITING_MAX_SENTENCES = WHY_YOU_MAX_SENTENCES;

/**
 * The most notes one collapsed section (`earlierToday`, or one `history` entry) may hold.
 *
 * Thirty. MEASURED (`~/.slopweaver/evidence/token-usage-audit-03sep.md`): a live briefing form's
 * `earlierToday.notes` grew to 489 notes — 681 KB of a 690 KB page, with no image on it — because
 * `pageAboveFoldWords` counts nothing that is folded and nothing else bounded the folds. A page that size
 * costs every fresh supervisor a 25-line-chunk read of the whole file before its first publish (the Artifact
 * contract's read-before-publish), measured at 643k tokens on one Sonnet subagent, and 255 such chunk reads
 * in one day fleet-wide. Thirty notes at the measured ~1.4 KB each is about 40 KB, which one read covers.
 * The overflow is not lost: `slopweaver briefing archive` moves it out of the form into an archive file.
 */
export const SECTION_MAX_NOTES = 30;

/**
 * The most `history` sections a page may carry. Four, so with {@link SECTION_MAX_NOTES} the folded part of
 * the page is bounded at 150 notes whatever a run's age; older sections leave the page through
 * `slopweaver briefing archive` exactly as notes do.
 */
export const HISTORY_MAX_SECTIONS = 4;

/**
 * The most bytes the rendered page may weigh with every `data:` URI stripped out — its HTML, CSS and text.
 *
 * 256 KiB. The backstop behind {@link SECTION_MAX_NOTES}: the note caps bound the count, this bounds the
 * size, so a form whose thirty notes each carry a long fold still cannot rebuild the 690 KB page. Sized so a
 * whole page is one Read for the session that must read it before publishing; images are bounded
 * separately by {@link IMAGE_TOTAL_MAX_BYTES} and are excluded here for the same reason `pageBudget.ts`
 * excludes `<style>` and `<script>` — they are not what the supervisor wrote.
 */
export const PAGE_TEXT_MAX_BYTES = 256 * 1024;

/**
 * How deep a fold may nest inside another fold.
 *
 * Two. Folds may nest, bounded rather than left open, because the reason the depth exists is that a reader
 * chooses each level and a reader who has to click four times to reach a sentence has met a different
 * unreadable page rather than the same one. Two levels is a card's fold holding a section, and that section
 * holding its own detail, which is the shape a fifteen-item ranked fold needs.
 *
 * MEASURED, and it is why the number is not one: a live form put fifteen ranked items with their links into
 * three `para` blocks of one fold, because no second level existed to put them in. Reproduce the shape with
 * `python3 -c "import json;f=json.load(open('form.json'));print(len(f['reactNow']['meFacing'][0]['detail']['blocks']))"`.
 */
export const FOLD_NEST_MAX_DEPTH = 2;

/*
 * ## Why there are no per-cell fold caps
 *
 * A per-cell cap on a fold's paragraphs (60 words, 4 sentences) and list items (1 sentence) is deliberately
 * absent. The measurement that argued for one is still true: over a live form, 117 paragraphs inside composed
 * folds, 60 past sixty words and the worst 376, 51 past four sentences, and 52 of 91 list items past one
 * sentence. A session meeting a wall complaint again will otherwise re-derive exactly these three caps.
 *
 * The rule is: keep every cap above the line, and hold what is INSIDE a fold to a shape rule — a fold is a
 * fold, blocks still counted, prose left alone.
 *
 * MEASURED over ten supervisor seats' own recorded `usage`: the whole author-check-trim tax was 5.8% of the
 * shift, and **148 of one dry render's 169 refusals — 88% — landed in `earlierToday` and `history`**, the
 * folded log nobody reads unfolded; 4 were on a card and 1 on the alignment line. The caps ABOVE the line
 * already refuse the wall; per-cell caps would be paid on an archive.
 *
 * The reasoning is general rather than a fold exception: a per-cell cap
 * optimises for a counter, not for a reader, and one that fires well below the wall threshold buys a gate
 * pass with the readable default a model writes unprompted. What holds a fold now is SHAPE —
 * {@link FOLD_MAX_BLOCKS}, {@link FOLD_NEST_MAX_DEPTH}, {@link BLOCK_MAX_ENUMERATORS} and the text-then-images
 * order — over {@link SECTION_MAX_NOTES} and {@link PAGE_TEXT_MAX_BYTES}, so a fold still cannot grow into
 * the 690 KB page those two were measured against however long one paragraph inside it runs.
 *
 * Nothing above the line moved. {@link CARD_ABOVE_FOLD_MAX_WORDS}, {@link WHY_YOU_MAX_SENTENCES},
 * {@link PAGE_UNFOLDED_BLOCKS_MAX} and {@link REACT_NOW_MAX_CARDS} are the rules that stop a wall reaching
 * the owner unopened, and they stay where they are.
 */

/**
 * The most blocks one COMPOSED fold may carry, at every level of nesting.
 *
 * Four: a fold is about four blocks. MEASURED on a live form: **47** composed
 * folds, median 2 blocks and p90 5, of which **6** carry more than four and the worst carries **12** — so
 * this refuses the tail without touching the shape almost every fold already has. Reproduce over any form:
 *
 * ```
 * jq '[.. | objects | select(has("blocks") and has("summary")) | (.blocks | length)]
 *     | {folds: length, over4: (map(select(. > 4)) | length), max: max}' <form.json>
 * ```
 *
 * ## It is the whole per-fold rule now, and that is deliberate
 *
 * It counts blocks with nothing counting the prose inside them, because the per-cell caps above are gone. That
 * is the shape rule: four
 * blocks is what a reader meets at a glance, and depth that does not fit goes DOWN a level rather than
 * sideways — a nested fold is one block, and {@link FOLD_NEST_MAX_DEPTH} is why that is expressible. What
 * bounds the WORDS is no longer here at all: {@link SECTION_MAX_NOTES} bounds how many folds a section
 * carries and {@link PAGE_TEXT_MAX_BYTES} bounds what they weigh together, which is the backstop the
 * 12,351-word section {@link PAGE_UNFOLDED_BLOCKS_MAX} was measured against needed.
 *
 * It holds a COMPOSED fold only — a quoted fold projects the owner's own recorded question and
 * `../outbound/briefing/vocabulary.ts`'s `rowFold` caller already emits five blocks of it, so counting them
 * here would refuse the owner's own words.
 */
export const FOLD_MAX_BLOCKS = 4;

/**
 * The most acts the autonomy ledger's section may show on one page.
 *
 * An IMPLEMENTATION DEFAULT rather than a number the owner named, so this file does not pretend otherwise. Ten
 * is what fits the shape the section has: simpler than the react-now cards, one line each, something to glance
 * at now and then. The register keeps everything; {@link BriefingAutonomy.notShown} states how many acts this
 * page is not showing, exactly as the owner's own list already does, so the cap can never read as "that was
 * all of it".
 *
 * MEASURED against a register's first morning: six acts by three sessions in the twelve minutes after the
 * first one landed — reproduce with `slopweaver autonomy list --json | wc -l`. Ten holds that pace
 * without the section becoming the longest thing on the page.
 */
export const AUTONOMY_MAX_ROWS = 10;

/**
 * The most open hand steps the page puts in front of the owner at once.
 *
 * An IMPLEMENTATION DEFAULT rather than a number the owner named. What sets it apart from every other cap in this
 * file is the register it reads: `slopweaver hand post` REFUSES a step the fleet could take itself, so the
 * open set is bounded by how many things genuinely need the owner's hands — MEASURED on a live register,
 * it held two (reproduce with `slopweaver hand list --json | jq '.steps | length'`). Five is
 * therefore a backstop against a register that went wrong rather than a view over one that is working,
 * which is the opposite of {@link AUTONOMY_MAX_ROWS}'s job.
 *
 * {@link BriefingHandSteps.notShown} states how many are not on the page, so the cap can never read as
 * "this is everything waiting on you" — and on a register holding more than five, the honest thing the page
 * says is that `slopweaver hand list` has the rest.
 */
export const HAND_STEPS_MAX_ROWS = 5;

/**
 * The longest one act's subject label may run, in characters.
 *
 * {@link SUPERSEDED_BY_MAX_CHARS}'s number and its reason: it is a name the owner reads on a line being scanned, and
 * the label is DERIVED (`../autonomy/label.ts`) rather than composed, so this bounds a pathological URL rather
 * than a writer's prose. Nothing ever truncates to fit it — an over-long label is a refusal, because
 * `./pageBudget.ts` already refuses a page carrying an ellipsis.
 */
export const AUTONOMY_SUBJECT_LABEL_MAX_CHARS = SUPERSEDED_BY_MAX_CHARS;

/**
 * The longest one act's session label may run, in characters.
 *
 * {@link WAITING_SESSION_MAX_CHARS}'s number and its reason, because it holds the same thing: the name of a
 * session the owner could go and look at. `../autonomy/label.ts` shortens a full session string to its
 * `workspace:<n>` prefix before it reaches the page, and the full name stays in the fold.
 */
export const AUTONOMY_SESSION_LABEL_MAX_CHARS = WAITING_SESSION_MAX_CHARS;

/**
 * The most proposed beliefs the correction block may put in front of the owner at once.
 *
 * An IMPLEMENTATION DEFAULT rather than a number the owner named, so this file does not pretend otherwise.
 * Three is what the shape supports: each row takes right, wrong or partly in a single click, and a click each
 * is only true while the set is short enough to read in one pass. The queue keeps every open proposal;
 * {@link BriefingOwnerBeliefs.notShown} states how many this page is not showing, exactly as the owner's own
 * list already does, so the cap can never read as "this is everything the fleet thinks you believe".
 *
 * MEASURED on the source this block is fed from: the owner's recorded words fold to 451 distinct units
 * across the tick ledger and both turn-file families — reproduce with
 * `slopweaver knowledge voice --batch 1 --json | jq .watermark`. A queue built over those will out-run any
 * cap, so what this number decides is how much of it the owner meets per sweep rather than whether it is
 * bounded.
 */
export const OWNER_BELIEFS_MAX_ROWS = 3;

/**
 * The longest one proposed claim may run on the visible line, in characters.
 *
 * The proposal queue's own `PROPOSAL_CLAIM_MAX` (`../knowledge/voice/types.ts`), not a tighter number of
 * this page's own. A claim shorter than the queue allows would make a valid, recorded proposal unrenderable
 * — the block would then be silently unable to show the owner a belief the fleet holds about them, which is the
 * one thing it exists to do. What bounds the block's weight is {@link PAGE_MAX_WORDS} above the fold and
 * {@link PAGE_TEXT_MAX_BYTES} in total, the same backstops every other section has.
 */
export const OWNER_BELIEF_CLAIM_MAX_CHARS = PROPOSAL_CLAIM_MAX;

/**
 * The longest the quiz's claim may run on the visible line, in characters.
 *
 * The register's own `LESSON_CLAIM_MAX` (`../knowledge/types.ts`), not a tighter number of this page's own,
 * for the reason {@link OWNER_BELIEF_CLAIM_MAX_CHARS} carries: a claim shorter than `knowledge record`
 * allows would make a recorded lesson unaskable, which is the block silently unable to do the one thing it
 * exists for. What bounds the block's weight is {@link PAGE_MAX_WORDS} above the fold and
 * {@link PAGE_TEXT_MAX_BYTES} in total.
 */
export const QUIZ_CLAIM_MAX_CHARS = LESSON_CLAIM_MAX;
