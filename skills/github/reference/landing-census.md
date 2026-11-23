# `census` — GitHub's own open count, beside the rows

Bundled reference for the `github` skill, beside [landing.md](landing.md).

Every read that happens (never a skipped `--if-due` tick) also carries `census`: per selected repository,
GitHub's own open list — every author, drafts in, the population `github.com/<repo>/pulls` counts — as
`{ kind: "read", startedAtIso, totalCount, viewer, pullRequests }` or `{ kind: "unread", why }`. It is a separate cheap read
(`src/live/github/openCensus.ts`), never a row: `--author` and the drafts flag still scope the rows, so a
consumer that wants GitHub's number counts the census and names every pull request no row carries. The console
counts the census pull requests the reading's own `--author` matches (`@me` resolved to `viewer`), drafts
included, and counts the other authors' apart — the owner's open count, not the organisation's. A census
whose listed count differs from `totalCount` — the list moved while it was paged — is `unread`, never a partial.

A consumer rechecks what it reads rather than trusting the producer: the console's pull-requests page
(`site/components/live/readLandingCensus.ts`, `site/lib/pullRequestCensus.ts`) reads a recorded repository whose list
and count disagree, or one recorded twice, as `unread`; claims no count when the census and the reading's
`selection.repos` differ in either direction; and withdraws the count once it is past the 30-minute landing
cadence, aged from the earliest `startedAtIso` — the instant before the first page was asked for, which the
reading's own instant comes after.
