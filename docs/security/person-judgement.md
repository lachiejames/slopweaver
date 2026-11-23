# What the bot may read about a person (`person.judgement`)

Part of [Security & trust](../security.md).

An owner ruling put per-person judgement on a column of the identity register. That column
is **bot-readable**, and this section exists because that is a disclosure decision rather than an accident of
where the data landed.

`content` carries a `visibility` column and the bot's policy denies it every private row — a private channel,
a DM, the mailbox, the diary. `person` carries no such lane, and a row-level policy cannot hide one FIELD
while leaving the bot's identity lookup working. So there is no shape in which the bot resolves a person and
is denied their judgement, and pretending otherwise would be a guarantee nothing enforces.

What follows is the rule rather than a note: **writing a statement into `person.judgement` is a deliberate
decision to let the Slack-facing bot use it.** That is what the column is for — the outbound composer and the
reviewer suggestion are its consumers. Raw private material stays in the corpus, where the private lane
applies and the bot is actually denied. `skills/profile/SKILL.md` states the same rule at the point of
curation, because that is where somebody is about to paste.
