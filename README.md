# Slopweaver

**Fork it, live in it, and it becomes yours.**

Slopweaver is a local-first agent setup for Claude Code and Codex. You talk to one supervisor chat. It routes each
piece of work to its own session you can watch, spreads those sessions across the Claude and Codex plans you
already pay for, and brings back only what needs you: a Queue of questions only you can answer, and briefing pages
for the bigger calls. Its forty integrations run from chat, code and tickets to security tooling, compliance
platforms and production monitoring. Each is reached only through typed commands, and every write to them goes
through one door that checks and records it before it happens.

<details>
<summary>All forty integrations, by what they're for</summary>

Each is reached only through a `slopweaver` command, never a raw API call. Most security tools are read into a
local map, called an atlas, of what that system holds, so a session looks things up instead of guessing.

- **Where the work happens** (read, store, and write where noted): Slack, GitHub, Linear and Notion (all four
  write), Gmail and Outlook (send after your yes), Google Calendar (books after your yes), Google Drive, Fathom and
  ChatGPT.
- **Security and compliance:** Vanta (writes after your yes), JumpCloud, Google Admin, Google SecOps,
  CrowdStrike, Cloudflare, 1Password, KnowBe4, Trelica, Nightfall and Microsoft 365.
- **Production investigation** (read live): Datadog, Hex, Knock, Twilio, Inngest, GraphQL Hive, Prisma Data
  Platform, Nx Cloud and Jam.
- **The rest of the stack** (mapped): Airtable, Braze, Canva, Clerk, Figma, Gemini AI Studio, Make, WorkOS, Xero
  and Aether.
- **Plus Google Cloud:** Cloud Run, Secret Manager and IAM, with every write previewed and approved first.

Which ones read, write or listen: [atlases](docs/atlases.md) and
[integration coverage](docs/integration-coverage.md).

</details>

It was built by using it. For months it was one engineer's daily setup, and every friction point became a fix in
the code or a ruling in the store. A fork starts from all of that and keeps adjusting to whoever runs it. It's never
finished, because you and your work keep changing.

## What it does for you

- **One intake.** You talk to the supervisor and it opens, resumes and closes sessions for you, each one a tab you
  can watch and interrupt. You never juggle Claude Code or Codex windows by hand.
- **Plan routing.** It knows the Claude and Codex plans you've set up, puts each new session on the one with
  headroom, and moves on when one runs low.
- **Machine awareness.** Before it opens another session it reads memory, swap and load, and when it holds back it
  says why.
- **Automations.** Resyncs, a daily hygiene sweep, dependency-bump fixes and meeting prep run on a schedule. Each
  one runs as a plain command or in a session you can see, never as a background daemon.
- **Adversarial review.** Codex plans each non-trivial change and reviews the diff while Claude writes it. Each
  review pass attacks one named property.
- **Graduated autonomy.** It starts with your own pull requests: fixing red CI, resolving conflicts and review
  threads, and landing them once green, each recorded with why it seemed obvious. A message nobody asked it to
  send, or closing an arguable ticket, waits for your yes. When you've approved one kind of act often enough, it
  asks to take that kind on alone, and your word on any past act can pull a kind back. Access, where data goes,
  spending, new audiences and irreversible acts nobody asked for never widen.
- **Security and compliance work, not just engineering.** Leaver access reviews across JumpCloud, Google Admin,
  1Password and Vanta. Cloudflare Access policies and dangling DNS records audited. ISO 27001 evidence and
  policy acceptance tracked in Vanta.
- **A Queue and briefing pages.** A question arrives as one card, and a bigger call arrives as a page you react to.
  Your answer goes back to the session that asked.
- **A local store of your history.** Slack, GitHub, Linear, Notion, mail and calls, in Postgres on your own disk by
  default, so an answer drawn from them can cite where it came from.
- **Ways in:** the desktop app, a Claude Code session, a voice call, or a tag in Slack. Slack is one way in, not the
  product.

## Install

On an Apple silicon Mac, with Node at the `.nvmrc` version, Claude Code signed in,
[Docker Desktop](https://www.docker.com/products/docker-desktop) running (its Port binding behavior set to local
only before the store first starts: [why](docs/security/local-store-hardening.md)) and [cmux](https://cmux.dev)
open, from a clone of your fork:

```bash
corepack enable && yarn install && yarn lefthook install
claude plugin marketplace add "$PWD"
claude plugin install slopweaver@slopweaver-dev
bin/slopweaver init
```

Then run `bin/slopweaver desktop install` to build and open the app, and `/slopweaver:onboard` in a new Claude Code
session. Onboarding checks the machine, walks you through starting the store and writing your organisation, and
connects your sources. Every step, and what each one needs, is in [getting started](docs/getting-started.md).

**cmux is required for now.** The supervisor opens each session as a cmux tab. Without cmux, the commands and the
single-session skills still work in one Claude Code session, but nothing opens sessions for you, and
`bin/slopweaver doctor` reports cmux as missing. The desktop app is meant to take over that job.

## Forks, issues and pull requests

Fork it and make it yours. What you do with your fork is up to you. This repository is maintained by one person.
Issues are welcome: a bug, something that broke, a question. Pull requests aren't taken, because a change that
suits one fork may not suit how this one is used.

## Roadmap

- **Off cmux.** Its own session harness, so the fleet runs wherever you do.
- **The desktop app as the whole surface.** Setup, connecting integrations and everyday use, without touching a
  terminal.
- **Model-agnostic.** Everything Claude does, Codex does too, and other models where that's feasible.
- **Any mix of plans.** Several personal plans or one enterprise plan, with usage caps the fleet respects.
- **Onboarding that asks.** Your consent and your constraints, such as computer control off by default, set up front
  with sensible defaults.
- **Instructions as data.** What you tell it becomes the instructions its automations run on, with no code to
  write.
- **Free CI a fork can run.** The batch lap on GitHub's runners, so every fork gets a merge queue's benefit.
- **More backup destinations** than Google Cloud.

Not planned: a hosted edition. The local version is the one that gets lived in.

<details>
<summary>Is it safe?</summary>

Slopweaver has no security certification and hasn't been audited, so discount any claim in it accordingly.

It's built by [Lachie James](https://www.linkedin.com/in/lachiejames/): about seven years of production software,
including the DevSecOps Lead role at a fintech SaaS that took the company through SOC 2 Type 2 and ISO 27001:2022
end to end. That role rolled out
Zero Trust (Cloudflare Access, CrowdStrike on every machine and CI runner, enforced MDM encryption), was the sole
contact for external penetration tests for three years, and contained a third-party supply-chain compromise within
minutes. ISO 27001 readiness work followed. In the author's words: "I think the security work and the agent work
are the same skill. Agents you can trust need audit trails, least privilege,
prompt-injection defence, and a human who can see and interrupt them."

Every place your data leaves your machine is listed in [the security doc](docs/security.md), and drawn in
[trust boundaries](docs/architecture/trust-boundaries.md). How the pieces fit together is in
[architecture](docs/architecture.md). If you find a claim stronger than the code behind it, that's a bug: open a
private security advisory.

</details>

<details>
<summary>Where it came from</summary>

The first Slopweaver, in late 2025, was a hosted SaaS: 17 integrations, an approval queue and an audit trail. People
signed up, nobody paid, and its author wasn't using it either. In the author's words, "a lot of it was theoretical
value about what theoretical people might theoretically want". It's archived at
[slopweaver-archive](https://github.com/slopweaver/slopweaver-archive). This version was rebuilt local-first with
your own keys, and lived in for months: "there was nothing theoretical about it".

</details>

## Read next

- [What Slopweaver is](docs/what-slopweaver-is.md): the longer pitch, and how a fork grows.
- [Architecture](docs/architecture.md) and its diagrams.
- [Every doc](docs/README.md), indexed.
- [AGENTS.md](AGENTS.md): the rules every session in this repo works under.

MIT licence, see [LICENSE](LICENSE).
