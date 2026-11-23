# Mentioning a person, and the relation verb

How `@{key}` resolves, what the refusal prints, when `--mention-id` is the right escape, and the one edge a
relation asserts. The rules — exact match only, and hand-written `@[name](id)` is REFUSED — are in
[SKILL.md](../SKILL.md).

Write **`@{key}`** in any prose field — a comment's `summary` or `detail`, an issue's `problem`, `solution`,
`acceptance`, `aiPrompt`, a `details` fold's title or blocks, or a freeform `body`, including inside a list
item. The door resolves it against the
same roster an assignee resolves against and emits **Linear's own markup, `@[handle](<linear-user-id>)`**,
which is what notifies the person. A `code` block is left alone: its content is literal and Linear renders no
mention inside a fence. Linear resolves the display name from the id and discards the label the markup
carries, so a mention shows the person's real name however the key was written.

`key` is a roster key — a canonical person id, a Linear user id, a Linear handle, `@handle`, or the email on
their Linear identity — **or a NAME the member index resolves**. The member layer is Linear's own member
list rather than an inference, so it takes a first name or a full name, and it answers only when exactly one
live colleague at your own email domain matches at the strongest tier it reached. It refuses, naming who it
saw, when two colleagues answer to the token, when the only match is at another company's domain, or when
nothing places a match either way — see the `slack` skill's "Who you can mention" for the same ladder in
full. A token that ladder names nobody for follows a `heardAs` pin in the identity roster when one record claims
it, and resolves to that person's Linear id. A key that resolves nowhere REFUSES the whole write and the refusal NAMES the candidates it might have
meant, with their Linear user ids, so you can pick one:

```
cannot mention "chi": no exact match among the <n> addressable keys …
  2 person(s) answer to "chi":
    chi — linear:3f2504e0-…  [p-chi-1]
    chi — linear:9c858901-…  [p-chi-2]
  pick one with `--mention-id chi=<linear-user-id>`, once you have opened their Linear profile and confirmed it is them.
```

**`--mention-id key=<linear-user-id>,…`** is the escape, and only for an id you verified live — open the
person's Linear profile and read it, or take it from `linear states --team <key>`, which prints one per
member. A verified id wins over the roster and passes a stale-roster refusal, because it did not come from
the roster. It must be a Linear user UUID; anything else is refused rather than written into a mention.

It is an ESCAPE and should be rare. It became the routine path for a while only because the derived roster
could not be rebuilt; a mention the member index resolves now passes a stale-roster refusal on its own, for
the same reason a verified id does — its id came from Linear's own member list.

**Hand-written `@[name](id)` is REFUSED by the form**, everywhere prose is checked. An id is unreadable, so a
transposed one notifies the wrong colleague and looks perfect in review — the door owns that markup the same
way it owns the `+++` delimiter.

`--dry-run` prints a `notifies:` line and the exact bytes with every mention already substituted, and reports
an unresolvable key without performing anything.

**`linear relation create --form <json|->`** asserts one edge: `blocks`, `duplicate` or `related`. `blocks` is
DIRECTED — `issueId` blocks `relatedIssueId` — so dry-run it and read the `reads as:` line before you send.
Linear's fourth type, `similar`, is deliberately not exposed: it is what Linear's own engine produces, not
something a caller asserts.

Neither verb has an update arm, and that is a decision. Editing a comment silently rewrites what a colleague
has already been notified about; a relation has nothing to update, since its identity IS its two endpoints and
its type.
