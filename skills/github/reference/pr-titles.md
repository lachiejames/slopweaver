# Pull-request titles

Bundled reference for the `github` skill, linked from [pull-requests.md](pull-requests.md).

**The title is a conventional commit that says the outcome, on this build's repository and every one the install's
`profile.json` `github.titleShapes` names.** The kind of change comes first, and the ticket identifier sits in round
brackets after it rather than in square brackets at the start. This repository's own titles take the same shape
without a ticket identifier, since a Linear id there reads as nothing at a glance.

- **A `ticketed` repository** (the team's): `kind(TICKET): outcome`, several tickets as `docs(ABC-1071, XYZ-7327): …`.
  Example: `dx(ABC-840): show the integration suite's logs when a test fails`.
- **slopweaver:** `kind: outcome` or `kind(area): outcome`, with no Linear id anywhere in it. Example:
  `feat(pr-body): the risk badge says why it is low`.
- The kind is one of build, chore, ci, docs, dx, feat, fix, perf, refactor, revert, style, test.
- After the colon comes the OUTCOME the change is after, never only the mechanism. `lift the integration suite's
silent logger` names the mechanism. `show the integration suite's logs when a test fails` says what it gets the owner.
- A vulnerability fix names its package and ends with its advisory score: `fix(RRRR-640): clear the joi
date-parsing advisory from local dev startup (CVSS 7.5)`. The flywheel finds its own pull requests by that
  `(CVSS ` mark and the top-up gate finds a package's by its name
  ([vulnerability-fix](../../vulnerability-fix/SKILL.md)).

Which repository is `ticketed` is the install's own, never the code's: `profile.json`'s `github.titleShapes` maps a
lowercase `owner/repo` to its shape, `{ "titleShapes": { "acme/widgets": "ticketed" } }`. A repository it does not
name is not judged, bar this build's own, found off its checkout's `origin`.

The team keys those titles carry are the install's own too: `profile.json`'s `linear.teamKeys` names them,
`{ "github": { "titleShapes": { "acme/widgets": "ticketed" } }, "linear": { "teamKeys": ["ABC"] } }`, and the write
door then lets `ABC-840` through on the installation's repositories instead of refusing it as `forbidden-team-key`.
It is local configuration, needing no Linear token and no ingestion, and it counts only while `slopweaver org show`
names a Linear workspace. This build's own repository forgives no key, stated or not.

The door REFUSES a title that is not in its repository's shape, naming the shape (`src/outbound/github/titleShape.ts`).
It judges the title on every create and on an update that changes it. A body-only update of a pull request whose
older title nobody is touching passes, and so does anything Renovate opens. A policy that cannot be read, a corrupt
`profile.json` or a self repository it cannot resolve, refuses the write rather than judging no title. The words after
the colon are the half no pattern can judge, so they are yours.
