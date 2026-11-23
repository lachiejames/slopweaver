# Where a row already stands — ruled, in flight, or untouched

Bundled reference for the `session-start` skill, linked from § standing. Loaded when a row's `standing`
needs explaining, not on every turn.

## The incident

The owner's words, on the fleet briefing's ranked list: the first few items the owner sees on there are things
the owner already answered in the previous supervisor. Rows 2–5 of the `run.json` behind one such render
were four acme-admin pull requests reading _get the codeowner approvals … still owes_,
every one already ruled on. The list ranked on live GitHub state and nothing else, so a ruling given to one
supervisor never cleared the row for the next. The same night `briefing render --open-prs` projected a card
per open pull request from the same document, and seven of the eight cards the owner ruled on in a row were things
already ruled or deferred, or stack members. The stopgap was a scratchpad script hard-coding thirty-six
pull-request numbers. `src/sessionStart/standing.ts` is the class fix.

## The three registers it reads — never a fourth one authored for the purpose

- **The lock-in ledger.** A ruling the owner gave, recorded by `<source:nativeId>` OR by the row's anchor URL
  (`lock-in --item <url>`), holding until the item moves (`--against`). **A ruling about a page is keyed by
  the page, not its URL alone**: a local page as `page:<slug>`, a `claude.ai` artifact as `artifact:<uuid>`
  AND as the eight-character `artifact:<first-8>` — the ledger carries both artifact spellings, and nine
  pages once held rulings under both, which can disagree (one read `edited` under its UUID
  and `approved-as-proposed` under its short key). A reader joining a page to the owner's rulings tries EVERY key
  as an exact lookup (`ledgerKeys`, `src/briefing/openArtifacts.ts`); a URL-only or one-spelling lookup reports a
  ruled page as unruled, with no error.
- **The board's open runs, and the live session ledger.** An open or waiting board run, or an open session,
  is joined to a row on the run's branch (a pull request's head branch, recorded by `handover start` or
  `cmux spawn`) or on the row's URL or `owner/repo#N` named in the doc or the session's latest note. A run
  whose holder is dead does not count — nobody is inside it.
  **A STACKED pull request is not a standing at all**, and looking for one here is the wrong place.
  `src/review/stack.ts` places every open pull request in its chain and `askRecommendation` answers `stacked`
  for one whose base is not the repository's DEFAULT BRANCH, so the leg suppresses the row by its own rule-zero
  decision before standings are judged. That test is strictly stronger than a sibling-head one: it also catches
  a stack member whose base pull request is not in this read at all.

## The three standings, and what each does to a row

| `standing.kind` | Means                                                        | On the ranked list                                                                                      | In `--open-prs` |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------- |
| `untouched`     | nothing on record touches it                                 | ranks as before                                                                                         | carded          |
| `ruled`         | a lock-in ruling still holds (`atIso`, `outcome`, `reason?`) | `dropped`/`rejected`/`deferred` stay off; the rest stay on, DEMOTED below every untouched row, labelled | held back       |
| `in-flight`     | a session is inside it (`slug`, `joinedBy`, `sessionKey?`)   | held back; the drop reason names the session                                                            | held back       |

Priority when both apply: the owner's own ruling, then a session inside the work — the owner's word outranks a
session's.
`standingTally` on the document counts each.

## Why demote rather than hide an approval

The owner agreeing to do something is not the source confirming the owner did it, and absence is never done —
the lock-in ledger's own rule. So an `approved-as-proposed` row stays on the list where the owner can see it has
not moved,
but at the tail, with `you already answered this: ruled <date> (<outcome>)` on the row. When a session
picks the work up, the row becomes `in-flight` and leaves the list on that evidence instead.

## What the supervisor owes this

Every ruling the owner gives on a card or a row is recorded **the same tick**, twice: through
`slopweaver session-start lock-in --item <url|source:nativeId> --against <whenIso> …`, which is what the next
list and the next render read; and as a URL-anchored row under the state doc's `### RULINGS`, which
`state-check` refuses as prose ([state-doc.md](../../supervisor/reference/state-doc.md)).
