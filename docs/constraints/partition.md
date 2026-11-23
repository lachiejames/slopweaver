# The partition

Part of [Design constraints](../constraints.md).

Two permanent homes, not one:

- **This plugin owns SHAPE** — schemas, renderers, gates, and the world model itself: ingest, tier, retrieve.
- **The private work repository owns CONTENT** — voice, work-specific verbs, and judgement — on its own
  long-lived branch.

**Completeness is not judged by a fresh-machine rebuild of this repo alone; do not cite that test.**
Judgement lives permanently in the content half, so this repo cannot and should not try to be whole on its own.

**The partition is about OWNERSHIP, not secrecy.** It is never the reason a name stays out of
this repo — that is the [hygiene gate's identifier rule](../security/hygiene-gate.md), which binds this half on its own.
What the partition decides is which half OWNS a thing and therefore which half a change belongs in — shape
here, voice and judgement there — and, separately, that a per-install VALUE resolves at runtime from
`$SLOPWEAVER_HOME` rather than living in a committed constant, because a constant is wrong for every other
install, not because the value is a secret. A doc or comment citing the partition to justify a placeholder is
right about the mechanism and wrong about the reason; fix the reason when you are next in the file, never by
a sweep.

**Planning consequence:** the belief layer and learned voice are **not this repo's critical path**. The
content half keeps the judgement layer, so a plan that treats either as the thing standing between this repo
and completeness is arguing from the wrong goal.

**Each install is independently owned**, on the owner's ruling for a team adopting it: rooted in its own `$SLOPWEAVER_HOME` under its own credentials — no shared or service account, and no
multi-tenant identity WITHIN one install.

The live listener refuses only THIS install's own app (`selfAuthoredCheck` in `src/live/listen/mention.ts`);
any other identity — human or bot — reaches the ordinary per-install responder whitelist (`responders.json`)
and is weighed identically once admitted. That whitelist decides WHO MAY TAG, for humans and bots alike; a
whitelisted bot is not a weaker tier layered on top of it. What an admitted ask then gets is decided by the
ASK, never the identity: the tag decision tree (`src/live/turn/tagDecisionTree.ts`) acts on a general ruling
of the owner's (`general-rulings.json`, per install like every other judgement here), investigates for an asker on the trusted tier (`trusted-askers.json`), and otherwise waits on
the owner in the thread. Widening who is on that list — more
people, a peer bot for cross-bot ("clank-to-clank") interaction — is deliberate per-install operational work,
not a source change: run `responders add --user <id> --reason "…"`.

This is deliberately narrow. It does not establish Slack workspace/tenant identity, a loop bound beyond the
self-authored refusal, or a formal cross-bot protocol — those remain open design questions, not
settled constraints.
