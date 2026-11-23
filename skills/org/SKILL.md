---
name: org
description: Write the organisation this install works for — its GitHub owner, Google domain, Slack hosts, Linear and Vanta workspaces, display name, repositories and dependency bots — once, as one row in the store, and read it back. A reader that takes the organisation reads that row and refuses by name when it is absent. Use on a fresh install before anything places work, when a verb refuses with "no organisation is configured in the store", when the organisation gains a repository, a Slack host or a bot, or when someone asks which organisation this install thinks it serves. Phrases like "set up the org", "which org is this", "add a repository to the org", "the org is missing", "write the organisation".
argument-hint: "set --display-name <name> --github-owner <login> (--google-domain <d> | --without-google) (--slack-host <host>… | --without-slack) (--linear-workspace <slug> | --without-linear) (--vanta-workspace <slug> | --without-vanta) --repository <owner/repo>… [--dependency-bot <login>…] | show [--json]"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" org $ARGUMENTS` and report the result.

## Why this exists, in one line

The organisation is written once and used everywhere, with no home-directory file. It used to be a scatter of constants in the code — which named one
installation's organisation in a repository meant to serve any — and a home-dir file was the obvious next shape. It
is neither: it is ONE `organisation` row in this install's own store, the only place it is written.

## The verbs

```bash
slopweaver org set --display-name Acme --github-owner acme --google-domain acme.com \
  --slack-host acme.slack.com --linear-workspace acme --vanta-workspace acme \
  --repository acme/acme-admin --dependency-bot acme-bot     # writes the whole row, every time
slopweaver org show            # every field, an absent provider said as absent
slopweaver org show --json     # the document a reader without the store parses
```

Both take `--home <dir>`. Both are LOCAL: one row in the store, nothing reaches a provider or a person.

## `set` writes the whole organisation, every time

There is no patch shape. A row may never hold a field nobody wrote, so every field is stated on every write and an
omitted one is refused, all of them named at once. A provider the organisation does not use is STATED absent —
`--without-google`, `--without-slack`, `--without-linear`, `--without-vanta` — never left out, and a value beside its
own absence is a contradiction it refuses. Slack is one entry point, never a requirement: `--without-slack` stores
zero hosts, and every reader then places no conversation as the team's. Logins, domains, hosts and repositories are lowercased; a repository is `owner/repo`, never
a URL. To add one repository, run `org show`, then `set` again with the whole list.

## The self repository is derived, never stored

This build's own repository is read off the `origin` of the checkout it runs from, so it is right in every clone and
fork with nothing to configure. `org show` prints it beside the row and says where it came from. A checkout with no
readable `origin` is refused rather than guessed.

## The read is one function, and it refuses

`readOrganisation` (`src/organisation/read.ts`) is the one read. A store that has never had `org set` run answers
`ORG_NOT_CONFIGURED`; a row present and wrong answers `ORG_INVALID`, naming every problem. A verb that needs the
organisation refuses with that message and writes nothing; a verb that only needs it on one path (the briefing's
list, `talk relay --discuss-first`) reads it on that path alone. A write racing another answers `ORG_WRITE_CONFLICT`
and writes nothing. Nothing falls back to a default organisation, because a default IS a constant.

The console reads it once per document (`site/app/(console)/layout.tsx`) and draws only `Organisation required`
until it is written, so a fresh install runs `org set` before it opens the app ([getting started](../../docs/getting-started.md)).
Not every reader takes it yet: the bump selector's bot logins (`src/review/bumpSelection.ts`) are among those still
carrying constants — `docs/store/owner-registers-and-roles.md`.

A reader holding the printed document rather than the store reads it back with `parseOrganisation`
(`src/organisation/core.ts`), the inverse of `org show --json`, and refuses a document that does not parse.

## Where a fresh install meets this

`slopweaver onboard` step 2 asks for the block and runs `org set` with it, then `org show` to read it back
([onboard](../onboard/SKILL.md)). The real values come from the person installing, never from git — every example
here, and every test, names the synthetic Acme.

## Exit codes

`0` written or read · `2` the invocation was wrong, nothing written · `3` (`show`) no organisation has been written
yet · `1` the store or the checkout could not be read.
