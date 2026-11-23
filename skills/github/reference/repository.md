# Repository writes: description, rename, transfer, archive, create, publish, Actions

Part of the [github skill](../SKILL.md). Every one of these is `slopweaver github repo`, one write per invocation,
through the door, and confirmed by a read-back rather than by GitHub's response.

## The description

```bash
slopweaver github repo --repo <owner/name> --description "<text>" --dry-run   # read it, print the change
slopweaver github repo --repo <owner/name> --description "<text>"             # send once, read back
```

It reads the live description, sends `repos.update` once through the door (skipped as a no-op when it already
matches) and reads it back: `set` means the read-back matched byte for byte, `already set` is an honest no-op.
`--description ""` clears it.

## Rename, transfer, archive — preview, then approve the digest

These three are irreversible from this side: there is no unarchive here, and a repository transferred to an owner
the token cannot administer cannot be transferred back by it. So each previews by default and sends nothing:

```bash
slopweaver github repo --repo acme/widgets --rename-to gadgets
# preview: rename acme/widgets (id 4242, not archived) -> acme/gadgets
#   digest ghrepo-5e75dcc9d49c5d58
#   apply:  slopweaver github repo --repo acme/widgets --rename-to gadgets --approve ghrepo-5e75dcc9d49c5d58
```

The digest binds the repository's immutable id, its live owner, name and archive state, and the exact change. The
apply run reads the repository again and recomputes it; an approval that no longer matches is a door `hold`
(`github.repo-write-unapproved`) with no override, and nothing is sent. A rename and a transfer are two
invocations with two approvals, never one. `--json` prints the same plan view with `outcome` and `sent`, plus
`digest` on a preview or a confirmed write (an `already done` has none, because nothing is left to approve).

| Write                   | Sent                               | Confirmed when the read-back shows                                  |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `--rename-to <name>`    | `repos.update({ name })`           | the same id at `<owner>/<name>`                                     |
| `--transfer-to <owner>` | `repos.transfer({ new_owner })`    | the same id at `<owner>/<name>`, polled ten times two seconds apart |
| `--archive`             | `repos.update({ archived: true })` | the same id with `archived: true`                                   |

A repository already where the write would put it — the same name, the same owner, already archived — is
`already done`, previewed and sent nothing, whatever `--approve` says.

## A transfer is asynchronous

GitHub answers a transfer `202 Accepted` and finishes the move later, so the response is never read as the
outcome. The verb polls the destination; a `404` there means not yet, anything else stops the poll. A transfer to
an account the token's owner controls lands within seconds; one waiting on another owner to accept it will not,
and the verb reports **accepted but unconfirmed** (`WRITE_UNCONFIRMED`, exit 1). That is not a failure to retry:
read the destination later, and never send the transfer again.

## Create, push a fresh cut, publish, apply settings, turn Actions on — the same preview and digest

Five more writes share the contract above (preview by default, `--approve` the `ghrepo-` digest of a fresh
read, a door `hold` on any drift, a read-back as the outcome). A session previews them; the approved run is the
owner's yes, never a seat's own.

| Write              | Digest binds                                                                | Confirmed when the read-back shows                            |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `--create`         | owner id and kind, the address answering 404, `{ name, private }`           | the id the create answered, at that address, privacy as asked |
| `--push-fresh-cut` | the cut's record, root, tree and directory, the repository's state, no refs | `refs/heads/main` at the root, and no other ref               |
| `--set-public`     | the repository's id, visibility, privacy and archive state                  | the same id, `visibility: public`                             |
| `--apply-manifest` | the artifact, every live field a step changes, visibility, the steps        | each step's own read-back, in order                           |
| `--enable-actions` | the switch, mode, allowed actions, token, fork approval, runners, the steps | every policy property, Actions on, zero runners               |

- **`--create`** is PRIVATE unless `--public` is also given. The owner is the token's own account (its
  endpoint) or an organisation (the organisation's); any other personal account is refused. An address that
  already holds a repository is refused, and a create GitHub refuses is reported once, never retried.
- **`--push-fresh-cut <record-id>`** pushes a fresh cut's root as `main` of a private repository holding no
  ref: [repository-recut.md](repository-recut.md) § Pushing the root.
- **`--set-public`** prints what an approval also accepts: the history becomes readable, private forks detach,
  Actions history and logs become public, push rulesets are disabled, and activity is published. On a
  repository the push-root register binds, it refuses unless the latest `fresh-cut verify` of that root reads
  clear.
- **`--apply-manifest <path>`** applies a settings APPLY artifact, never the evidence manifest the settings
  review writes: a strict schema (`src/cli/commands/github/repoManifestSchema.ts`) refuses an unknown field, an
  unresolved owner call and a placeholder in a text field, and the artifact must name the `--repo` typed. It is
  read and validated before any credential is resolved, so a bad one never reaches GitHub. It sets the
  description, topics, features, merge settings, Dependabot alerts and labels; labels are CREATE-ONLY, and a
  same-named label that differs refuses the whole apply. Protection on `main`, secret scanning and private
  vulnerability reporting exist only on a public free-plan repository, so while it is private they are never
  read or sent and the preview lists them as waiting; preview the same artifact again after `--set-public`. When
  one of those reads fails, the repository is read again: the same repository made private meanwhile, they wait;
  still public, replaced at the address or unreadable, the preview exits on GitHub's refusal, since a 403 alone
  is not taken as private. Each
  step is sent once and confirmed by its own read before the next; a stop names what landed and rolls nothing
  back. Visibility, Actions, webhooks, keys, secrets and Pages are not in the artifact at all.
- **The switch order** for a new public repository: `--create` (private), `--push-fresh-cut`, `--apply-manifest`,
  `--set-public`, `--apply-manifest` again, `--enable-actions`, then read each back.
- **`--enable-actions`** establishes the stated policy: GitHub-hosted runners only, GitHub-owned actions only
  (no verified publisher, no pattern), every outside contributor's fork pull request waits for approval, the
  workflow token read-only and unable to approve a pull request. The allowed-actions mode is set to `selected`
  while Actions is still off, and the switch on sends `selected` again. "Hosted only" has no switch; it is a fact read, so an organisation's repository (whose runner groups a
  repository read cannot see) and one with a self-hosted runner registered are refused. So is a repository that is
  not public: the fork approval setting is GitHub's public-repository one, and reading it on a private repository
  answers 422, so the route is `--set-public` first. Steps go in order: a
  running repository is switched OFF first, each step is confirmed by its own read, the whole policy is read
  again, and Actions goes ON last. No policy setting is rolled back, but a final read-back that does not hold
  switches Actions OFF again; a stop names which steps landed and whether Actions is on, and the next act is a
  fresh preview.

## What the digest does not cover

It binds the destination login exactly as typed, not that account's id, so a typo previewed and approved is a
typo sent — read the preview's target before approving. Nothing between the apply run's read and GitHub's write
is atomic: GitHub's update and transfer endpoints take no version precondition. And an approval is a second
deliberate step over exact content, not proof a human typed it (`src/admit/approval.ts`).
