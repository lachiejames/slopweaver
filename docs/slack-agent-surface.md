# The Slack agent surface

**The bot answers when it is addressed, inside a visible agent session the owner is running.** You
`@`-mention it in a channel or in a 1:1 DM, and — if a session is running the turn (`/slopweaver:loop`, the
Codex `loop` skill, or one manual turn via `/slopweaver:loop-bot`) — it works in the thread, investigates with
every tool that session has, and replies with a cited answer that states what it could not read. The local
world model is one source it reads, never the author of the answer. Nothing in this plugin may start a model
to answer on its own (`AGENTS.md` rule 2, "No HEADLESS model, anywhere"), so **a tag arriving while no session
is running it gets no answer, by design** rather than by omission. It watches nothing, infers nothing from
ambient conversation, and never speaks unprompted.

This note is the reference for that surface: how a tag becomes an answer, which manifest provisions it, and —
in the measured sections — the captured API responses the renderer is written against. Everything below is
either a captured response or a citation. Where something is unproven, it says so.

- [How a tag becomes an answer](./slack-agent-surface/tag-to-answer.md)
  - [A tag on both surfaces, plus a reply under the bot's own post](./slack-agent-surface/tag-to-answer.md#a-tag-on-both-surfaces-plus-a-reply-under-the-bots-own-post)
  - [What it does not do](./slack-agent-surface/tag-to-answer.md#what-it-does-not-do)
- [Measured](./slack-agent-surface/measured-rendering-and-identities.md)
  - [1. The reference UI is `rich_text`. It is not mrkdwn.](./slack-agent-surface/measured-rendering-and-identities.md#1-the-reference-ui-is-rich_text-it-is-not-mrkdwn)
  - [2. The reference agent does not RENDER through the agent surface](./slack-agent-surface/measured-rendering-and-identities.md#2-the-reference-agent-does-not-render-through-the-agent-surface)
  - [3. Two identities, and which one does what](./slack-agent-surface/measured-rendering-and-identities.md#3-two-identities-and-which-one-does-what)
  - [4. What needs the manifest change](./slack-agent-surface/measured-rendering-and-identities.md#4-what-needs-the-manifest-change)
- [5. The native todo primitive exists, and it is not free](./slack-agent-surface/todo-primitive-and-contract-facts.md)
  - [5.1 Why three older checklists cannot be repaired](./slack-agent-surface/todo-primitive-and-contract-facts.md#51-why-three-older-checklists-cannot-be-repaired)
  - [6. Other contract facts worth not re-deriving](./slack-agent-surface/todo-primitive-and-contract-facts.md#6-other-contract-facts-worth-not-re-deriving)
  - [7. What is NOT proven here](./slack-agent-surface/todo-primitive-and-contract-facts.md#7-what-is-not-proven-here)
- [The manifests](./slack-agent-surface/manifests-and-layout.md)
  - [Two things to do before pasting one](./slack-agent-surface/manifests-and-layout.md#two-things-to-do-before-pasting-one)
  - [What the Agents feature costs, and what it buys](./slack-agent-surface/manifests-and-layout.md#what-the-agents-feature-costs-and-what-it-buys)
  - [Where the pieces live](./slack-agent-surface/manifests-and-layout.md#where-the-pieces-live)
