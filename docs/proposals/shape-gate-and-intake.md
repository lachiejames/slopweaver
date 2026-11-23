# The shape, and why it is a type

Part of [The golden proposal, as a form](../proposals.md).

Five sections, in this order, and they are FIELDS rather than free markdown:

| Section              | What it carries                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------- |
| TL;DR                | The problem and why it matters, at a glance. No figures, no citations — those are below. |
| What the data shows  | The hero shot, then a table where every row links its own source.                        |
| The fix              | The fix in plain terms, with the options folded into a toggle.                           |
| Scope and trade-offs | What this solves, what it does not, and the weakest part of the argument.                |
| Open questions       | Addressed to a named stakeholder.                                                        |

A document that reorders them, drops one, or invents a sixth is **unrepresentable**, not refused. That is
the difference between a shape that holds and a shape that is merely documented. The title and the emoji are
Notion page PROPERTIES rather than body content, so the form carries them separately and the renderer never
emits an H1.

The strawman blockquote at the top and the `<table_of_contents color="gray"/>` block under it are literals
the renderer owns. The strawman's exact wording is the convention: it tells a reader this is a
discussion-opener, that the short version is in Slack, and that the doc is the deeper layer for agents
rather than required reading.

## The gate

`proposal lint` reports two severities, and the line between them is deliberate.

A **blocker** is objectively detectable and objectively wrong. A **warning** is a judgement the detector can
only guess at, which a reviewer settles. Making everything a blocker turns the gate into something people
route around; making everything a warning turns it into decoration.

| Blocks                                                   | Warns                                       |
| -------------------------------------------------------- | ------------------------------------------- |
| a figure with no source within a sentence of it          | no strawman blockquote                      |
| a raw URL in prose, not anchored over its words          | no table-of-contents block                  |
| a `[v1]`-style reference marker                          | nothing invites the reader to push back     |
| a missing or reordered golden section                    | an AI scaffold shape                        |
| no hero shot in the top third of a document with figures | an exclamation mark in a broadcast document |
| every image clustered into a trailing appendix           | a headcount or 10x framing                  |
| a phrase from the operator's own voice-rule list         | a projected figure asserted as measured     |

`proposal draft` runs the same gate and REPORTS rather than refusing, because the findings are about words
the session wrote and it needs the file in order to fix them. `proposal publish` is what refuses.

## Where the voice rules live

Split on one line: **vocabulary is private, pattern is public.**

The operator's actual banned characters, words and phrases live in `$SLOPWEAVER_HOME/profile.json` under
`slackMe.voice.exact`, and are matched through the same seam the Slack as-me lane uses. That includes the em
dash, which is a `literal` rule there — so there is no public em-dash constant, even though it is the rule
most often quoted.

What this repository owns is shapes: negative parallelism, a performative opener, a label-colon opener, a
bucket abstraction, an exclamation in a broadcast, a projection asserted as a measurement. A useful test for
anything added later: could it be written down without naming a word the operator personally dislikes? If
yes it belongs in the repo. If no it belongs in `profile.json`.

An install with no rules configured is simply not gated on vocabulary.

## Question-first intake

`proposal intake` seeds the standing gap questions and gives the proposal its stable local id. Each question
maps to something the form will demand later: the audience and the ask decide the TL;DR, the anchors decide
the evidence table, the claims decide which figures need a frozen link, and the shots decide whether there
is a hero.

`proposal publish --intake <id>` refuses while any of them is unanswered. That refusal is the feature: a
proposal published past a question only the stakeholder can settle is the one that gets rewritten after
somebody reads it, and rewriting it is the expensive part, because the numbers and the shots were already
gathered around the wrong argument.

Re-running `proposal intake` with the same `--id` **merges**. Answers are kept, the brief is updated, a
question the standing set has since added is appended unanswered, and a question the standing set no longer
asks is carried rather than deleted, as is a question you un-blocked by hand. A record that EXISTS but
cannot be parsed is refused rather than replaced. That matters because the verb's own advice is to hand-edit the record, so re-running it is the
ordinary way to re-read the questions, and a blank derivation written over a parse failure would erase every
answer the stakeholder had given.

The intake is also the proposal's **identity**. A destination assigns its own ids, so nothing about the document
can say whether it has been published before. The intake record can: it holds the provider-tagged `address` the
last publish reported, which is why a re-publish keeps its URL.
