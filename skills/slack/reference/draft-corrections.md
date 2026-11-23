# What the owner changed on a draft: `slack draft corrections`

`slack draft corrections [--json]` reads the draft register ([draft-review](draft-review.md)), the owner's voice
rules and the words relayed on a draft's card, and lists every correction the owner made to a draft as the owner,
one kind at a time (voice rule, who it tags, what it attaches, where it goes, shorter, reworded, withheld), each at
its own instant. Every release the owner gave is listed too, as `reviewed`: the Alignment page draws those as the faint bars under its
Slack-steers chart, so a quiet week reads as fewer drafts rather than as fewer corrections. The chart's lines are
the owner's own words, read per turn (`profile steers`, [the profile skill](../../profile/SKILL.md)), never this list.

A voice-rule list or relay ledger that does not read prints nothing and exits 1: a report missing one of its inputs
would draw a zero it never measured. The fold is `src/outbound/slack/draftCorrections.ts`, the shell
`src/cli/commands/slack/draftCorrectionsRun.ts`.
