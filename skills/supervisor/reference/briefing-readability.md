# Readability on the fleet briefing — where the caps stop, and what carries the rest

Bundled reference for the `supervisor` skill, linked from [fleet-briefing-shape.md](fleet-briefing-shape.md).
That file states the CAPS; this one states the four rules that are about how the page READS, each of which
exists because the caps alone produced the opposite of what they were for.

## The finding this file exists to record

The live page was the one artifact with shape enforcement on it and one of the least readable the owner had. The gate
was green on it — reproduce with `slopweaver briefing check <page>` over a render from before these rules and read the
eight all-clear lines.

**The mechanism, stated once.** Every ABOVE-THE-FOLD cap in `src/briefing/caps.ts` is measured with each
`<details>` body removed (`src/briefing/text.ts`'s `unfolded`, and that file's own header says so). That is
the right rule — rule 7 caps what a reader cannot avoid — but it has an consequence nobody wrote down: **the
cheapest way to pass a cap is to move words into a fold, and a fold had almost no shape rules of its own.**
So depth went where the gate could not see it, and what the owner opened was a wall. Three of the four rules below
give the fold the shape rules the region above it has — and § 5 is why its LENGTH stays uncapped.

## 1 · A URL is never plain text

`src/outbound/briefing/render.ts`'s `linkifyText` turns every bare `http(s)://…` in a `text` or `strong` run
into a real anchor as it renders, and `src/briefing/bareRef.ts` refuses a page that still carries one as inert
text — it strips every `<a>` and `<code>` first, so anything it finds is by construction a URL a reader would
have to select and copy.

MEASURED on the live form: **23** bare URLs, 19 of them inside react-now card folds. Each is a link the owner has to
select, copy, open in a new tab and paste into, which is terrible. Reproduce over any page:

```bash
slopweaver briefing check <page.html>          # one `bare reference` line per URL still inert
```

Both halves ship, and that is deliberate rather than belt-and-braces. The renderer fixes every page already
written the moment it re-renders; the check is what stops a hand-written page or an older render reaching the owner
with the same defect. Linkifying a form by hand is no fix — a live form that was hand-fixed still
rendered **3** inert URLs.

## 2 · A set of options is a list, and so is a set of anything else

`renderOptions` emits one `<li>` per option inside `ul.opts`. Options a, b and c that appear as one long run-on
sentence are very difficult to scan.

**The plain text is unchanged on purpose.** `src/briefing/cardVoice.ts` splits the cell back into options
on its `OPTION_MARKER`, and `stripTags` replaces every tag with a space, so the gate parses exactly what it
parsed before. A list that changed the text would have been a change to the gate rather than to the styling.

Inside a fold the same rule already existed as a block kind — use `{ "kind": "list" }`, never numbers packed
into a paragraph. **Its gate has a known blind spot, stated rather than discovered:**
`src/briefing/pageBudget.ts`'s `INLINE_ENUMERATOR` requires a period or paren after the digit, so
`1. Foo 2. Bar 3. Baz` is refused and `1 Foo 2 Bar 3 Baz` is not. The live wall used the second spelling and
carried seven of them. Sharpening it needs a criterion that survives an ordinary day-month date — an ASCENDING
RUN starting at 1 is the shape that actually distinguishes them, and it is not implemented yet.

## 3 · Folds nest

A fold's `blocks` may carry `{ "kind": "fold", "fold": { … } }`, up to `FOLD_NEST_MAX_DEPTH` (2).

Without it, a composer with more depth than one fold holds has exactly one representable shape — a longer
paragraph, which is the whole of how a fifteen-item ranked list became three paragraphs. Two levels rather than open-ended, because
a reader who clicks four times to reach a sentence has met a different unreadable page, not the same one.

## 4 · An old section is folded, and says how old it is

The owner's list and "done since you last looked" render inside a `<details>`; the list's summary states the gap
between the two instants the eyebrow already carries — `read 3 hours 47 minutes before this page was
rendered`. A list stamped with a clock time reads as a while ago, and the owner then stops trusting everything below
the cards.

That reading is right, which is the point: the section WAS that old. The fix is not a fresher number, it is the page
saying so where the owner meets it, and folding it so an old section never competes with a current card. An ELAPSED
measurement, never an estimate.

The alignment heading reads **`what the fleet is working on`** (the older "what we are actually working" did not parse as a sentence). `src/briefing/alignment.ts` matches both spellings,
because it also reads pages already published.

## 5 · A fold body has a SHAPE rule and no length rule

The text below the fold of a react-now card read as hard to read, unreadable, a wall of text — fixed PERMANENTLY.

MEASURED on the live form (`~/.slopweaver/supervisor-scratch/handoff-<n>/form.json`): **117**
paragraphs inside composed folds, **60** past sixty words, the worst **376 words in one paragraph** and
**51** past four sentences; **52** of **91** list items carried more than one sentence; **6** of **47** folds
carried more than four blocks, the worst twelve. Over the last ten published renders the same shape measured
1,689 fold paragraphs with 729 past sixty words — the steady state, not one bad sweep. Reproduce over any
form:

```bash
jq '[.. | objects | select(has("blocks") and has("summary")) | .blocks[]
     | select(.kind == "para")
     | ([.content[].text] | join("") | [splits("\\s+")] | map(select(length > 0)) | length)]
    | {paragraphs: length, over60: (map(select(. > 60)) | length), max: max}' <form.json>
```

**No per-cell word or sentence cap inside a fold** — keep every cap above the line; inside a fold, blocks are
counted and prose is left alone. Measured across ten Fable seats with per-cell caps on: the author–check–trim tax was **5.8% of the shift**, and **148 of one
dry render's 169 refusals — 88% — were in `earlierToday` and `history`**, the folded archive nobody reads
unfolded. The caps ABOVE the line refuse what the owner complained about; a per-cell fold cap is paid on a log.

The principle is general rather than a fold exception: **a per-cell cap optimises for a
counter, not for a reader.** A cap firing well below the wall threshold buys a gate pass with the readable
default a model writes unprompted.

**So what holds a fold is arrangement.** At most four blocks per fold at every level of nesting, depth
going DOWN into a nested fold rather than sideways, images after text, and the packed-enumeration and
ellipsis rules every run carries wherever it sits. Behind them `SECTION_MAX_NOTES` (30) and
`PAGE_TEXT_MAX_BYTES` (256 KiB) bound how many folds a page carries and what they weigh together, so the
folded half of the page still cannot grow into the 690 KB form those two were measured against. The shape
and the numbers are in [fleet-briefing-shape.md](fleet-briefing-shape.md) § "Fold first, then write";
`src/briefing/caps.ts` carries both measurements so neither is re-derived.

**Why the SCHEMA carries a fold's rules alone, and `briefing check` does not.** The check reads rendered
HTML, where a fold a seat composed and a fold projecting the owner's own recorded question are the same `<details>`
element. A page-side rule could not tell them apart, so it would reach the owner's own words — the same reasoning
that already scopes the bare-key-link rule to composed folds. The form knows which schema built each fold.
This is the one place the two halves of the gate deliberately differ, and `src/briefing/text.ts`'s header
says so where somebody would go to change it.

## What is still open

- The packed-enumeration criterion in § 2, which passes the exact wall the owner screenshotted.

## The fold's shape rule, in full

Compose every card as the short version plus a `<details>` inside the field that needs the depth — every
above-the-fold cap is measured with each `<details>` body removed, so it is the default arrangement.

Inside a fold the only thing counted is BLOCKS: four, at every level of nesting, so depth goes DOWN into a
nested fold (one block) rather than sideways. A fold is a fold: blocks are counted and prose is left alone, so no paragraph or list item in a fold carries a word or sentence cap.
**Write short labelled lines or one-sentence bullets anyway** — house shape, not a gate. The owner's own list is
exempt even from the block count. Why there is no per-cell cap: § 5 above.
