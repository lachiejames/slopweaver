# Rule 5 · Right model for the host

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The rule once ended **"Codex plans and reviews, operates independently in its own visible thread, never invokes
Claude as a hidden executor"**, and the loop skill's Codex page and the pickup skill's Codex-native adapter
said the same thing more strongly — the adapter flatly banned spawning a subagent on that host.

**Why it changed.** That wording had been contradicted by the owner months earlier and nobody had carried the
correction into canon, so two sources of truth stood side by side and each session picked one. A
comprehension pass reported the loop skill forbidding the Codex host from using subagents, `slopweaver codex`
or Claude — which left only the `inline` tier reachable there, since `read-only-subagent` needs a subagent and
`fresh-visible-session` boots a real workspace. That was a fact to correct, not a lean: Codex was never
required to ban subagents; it may use them. And the requirement behind it is outright: if the Claude API is
down, or the owner's weekly limit runs out, switching to Codex must be as if nothing happened, with every
capability the Claude driver has.

The canon still said the opposite, so the owner settled it a second time and generalised it: Codex may use
subagents, and the guiding principle is to give agents maximum capability.

**What the ruling is, precisely.** Codex is a **substitute** host, not a degraded one. Whatever tier the
routing judgement picks — `inline`, `read-only-subagent`, `fresh-visible-session` — the Codex host executes
it the same way the Claude host does. A tier refused on one host is refused on the other, **by mode** and for
the same reason: `read-only-subagent` is refused in `continuous-drain` because a native subagent call blocks
the thread that must keep reading the stream, which is a property of the loop and not of the host.

**What it did NOT change.** [Rule 2](rule-2.md) is untouched and is the only limit here, applying to every
model alike: no hidden executor, nothing headless, nothing detached, nothing resident, nothing invisible.
"Maximum capability" is about which tiers a host may drive, never about whether the owner can see and
interrupt what is running. The `no-headless` gate is unchanged, and it never had a Codex carve-out to remove.

**Why this one is written down at all.** The ruling existed as a stored memory and was lost to the canon for
seventeen days, which is the exact failure [this file](../doctrine-rationale.md) exists to stop: a memory loads
softly and only in the session that holds it, while `AGENTS.md` is re-injected as instructions everywhere. A
rule and a memory that disagree do not average out — every session reads the rule.
