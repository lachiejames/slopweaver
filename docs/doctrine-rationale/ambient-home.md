# The ambient-home leak

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The measurement behind `testing.md` § Never write to the ambient `$SLOPWEAVER_HOME`, moved here so the
always-on rule carries the rule and this carries the evidence.

MEASURED: `~/.slopweaver/ledgers/door.jsonl` held **2,238** `verb:github.pr retarget`
external-write records written in millisecond pairs, one pair per `yarn test:unit` lap, plus **63**
`verb:slack.post`/`slack.reply` records per lap. So door-ledger verb counts were not a usable measure of what
this install had actually done — a test suite's traffic and the fleet's real outbound acts were the same
rows. Every one of those tests had been asked, in prose, to pass an explicit `home`, which is why the sandbox
is a `setupFiles` guard that fails the individual test rather than a convention.
