# `github pr standing` — what a person opens GitHub to see

The detail behind [pr-forms](pr-forms.md)'s one line on the verb.

`github pr standing <url> [--json]` reads one pull request's standing: who approved (people apart from bots, so a
CodeRabbit-only `APPROVED` never reads as a person's), who is still asked with code owners flagged, what the base
branch requires across classic protection and rulesets (or that its rules could not be read), whether GitHub calls
that branch protected, CI, CodeRabbit and GitHub's merge status, plus one spoken sentence. Read-only: one GraphQL read
and three REST reads (`src/cli/commands/github/prStandingRun.ts`).

**It says "no approval is needed" only when the branch's own `protected` flag is `false`.** Classic protection
answers a non-admin token 404 exactly as it answers an unprotected branch — measured on a protected `staging` branch — so an empty rule read alone never proves the base asks for nothing. A protected base with no
readable review rule, or a flag that could not be read, gets a sentence claiming nothing about approval.

**It is the console voice's pull-request read** (`src/talk/modelReads.ts`). `github read --json` on a busy pull
request runs past the voice's 20 KiB cut before `reviews`, and its bare `reviewDecision` is exactly the bot-only
approval the voice once spoke as a person's.
