# A possible problem says how many it affects, first

The owner's ruling: a card about a possible problem states at the top how many people it affects, so the owner can
size the owner's response before reading further. The owner had given it repeatedly and review kept catching it after the
fact, so it is the form's job (doctrine rule 7), not a reviewer's.

## The declaration

Every composed form takes a `problem` field, and `slack draft record` REFUSES a draft without one:

```json
"problem": { "kind": "none" }
"problem": { "kind": "possible", "affects": "one" }
```

`affects` is `one`, `a few` or `many`, the owner's three words. No content scan decides whether prose is about a problem: a
hedge, a euphemism or a quoted error title would fool one, so you classify it and the schema holds you to it.

## Where the word goes

When the declaration is `possible`, the form's TOP region carries that word in your own plain text. A code run, a link
label or a quote does not count, because those are not the owner's words:

| form                  | the top region    |
| --------------------- | ----------------- |
| `drip`                | the first message |
| `one-card`            | the first line    |
| `one-list`, `no-fold` | `lead`            |
| `update`              | `tldr`            |

`Checkout is failing for a few members.` passes for `a few`; `Checkout is failing.` is refused. Nothing is added to an
as-me message for you: the words stay yours.

A parked draft declaring `possible` raises a finding, so the reach word is not its proof: it also owes a screenshot, a
link and `--impact` with a count in its first line, or it never parks (a draft that said "many" and nothing more is
refused): [receipts](receipts.md#a-finding-owes-all-three-a-screenshot-a-link-the-impact-in-people).

## What it does not cover

- A `finding` card leads with its own `blastRadius` (`one`, `few`, `some`, `many`, `unknown`), counted because it
  drives the priority matrix. The two vocabularies are deliberately not merged: folding `some` (10–99) into "a few"
  would move a priority boundary nobody asked to move.
- A derived card (a digest, an alert summary) and a raw `--body` have no authored top region and declare nothing.
- The schema proves the message was classified and where the classification sits, never that it is true. Declaring
  `none` on a problem, or writing "many" in a sentence that negates it, is still yours to get right.

The criterion is `src/outbound/artifact/problemReach.ts`; the record-time requirement is
`src/cli/commands/slack/problemDeclared.ts`. A top-level channel post also declares what it is and what it asks, in
the same top region: [channel-opening](channel-opening.md).
