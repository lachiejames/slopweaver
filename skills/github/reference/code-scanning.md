# Code-scanning default setup — read it, and switch it on or off where a repository admin can

CodeQL on a repository with no CodeQL workflow file is GitHub's code-scanning **default setup**: a repository
switch, not a file, so no change to `ci.yml` reaches it. `github code-scanning` is the door for that switch.
Alerts it raised are a different object — [`github alert`](pr-operations.md#code-scanning-alerts).

```bash
slopweaver github code-scanning show --repo owner/name
slopweaver github code-scanning enable --repo owner/name                           # preview + digest
slopweaver github code-scanning enable --repo owner/name --approve ghrepo-<16 hex> # send once
slopweaver github code-scanning disable --repo owner/name --dry-run
slopweaver github code-scanning disable --repo owner/name
```

- **`show` is a pure read** of two things: default setup (state, languages, suite, schedule) and the org or
  enterprise **security configuration** attached to the repository, which is what can enforce default setup
  from above. It prints `enforced from above` instead of `read` when either enforcement signal says so — the
  attachment's own `status` or the configuration's `enforcement`.
- **`none attached` means GitHub answered 204, nothing else.** A 403/404 on the configuration read prints
  `UNKNOWN — could not read it`: a token that cannot see the attachment has not shown there is none.
- **`disable` re-reads both first**, then: already `not-configured` → an honest no-op; an ENFORCED
  configuration → refused locally, naming it, with nothing sent; an absent state → refused as unknown;
  otherwise one PATCH to `not-configured` through the door, never retried.
- **`disabled` is only ever printed off a read-back.** GitHub documents that an enforced configuration can make
  the PATCH look successful while changing nothing, so the PATCH's own 200/202 is kept as an acknowledgement
  beside the before and after states (`--json`), never as proof. A 202 with the state unchanged exits 4
  (deferred); a 200 with it unchanged exits 1.
- **A 422 is the org-level block, and a repository admin cannot clear it.** GitHub answers
  _"Code scanning default setup cannot be modified. This setting is controlled by organization
  administrators."_ and the verb names it: an organisation admin must detach the enforcing configuration
  or set its default setup to `not_set`. After ANY failed PATCH — a 422, a 5xx, a dropped socket — the verb reads
  the state back and prints what it is (`unchanged`, or `disabled despite the error`), because only the 422 has
  a known meaning; if that read fails too it says the outcome is unknown.

## `enable` — previewed, sent only on a fresh digest

`enable` is the stricter write, because turning a scanner on is the one this verb is asked to do unattended.

- **No flag previews.** It reads default setup and the configuration, decides, and only when the repository is
  eligible reads its identity (`GET /repos/{owner}/{repo}`), then prints the exact body
  `{"state":"configured"}`, a digest and the `--approve` line. Nothing is sent and no door row is written.
  There is no `--dry-run`: the preview IS the dry run, and the parser refuses the flag.
- **The digest binds everything the write depends on**: the repository's immutable id, full name and archive
  state; default setup as read (state, sorted languages, suite, schedule, `updated_at`); the attached
  configuration's id, name, target, attachment status, enforcement and default-setup setting (never its URL);
  the body; and the address typed. `--approve` repeats every read, recomputes it and sends once only when it
  matches — a renamed, transferred or re-created repository, or setup touched since the preview, is a door
  HOLD with nothing sent, and no override token waives it. A malformed `--approve` is refused unechoed.
- **The body is the state alone.** No `query_suite`, no language list: GitHub picks the languages it detects.
- **Refused, nothing sent**: an ENFORCED configuration (it can silently undo a repository-level enable, so a
  read-back could not be trusted); a configuration read that 403s or 404s — stricter than `disable`, because an
  enforced one cannot be ruled out; an absent state. Already `configured` is a no-op, exit 0, no identity read.
- **Only a read-back of `configured` is `enabled`.** The read-back is default setup alone. 202 still
  `not-configured` → `accepted, not yet applied`, exit 4; 200 still `not-configured` → `NOT confirmed`, exit 1; a
  failed PATCH → `enabled despite the error` or `unchanged` off the read-back; a failed read-back → unknown, exit 1.
- **A private repository on a free plan answers 403** on the very first read (_"Code scanning is not enabled
  for this repository. Please enable code scanning in the repository settings."_). The verb prints GitHub's
  line, reads nothing further and exits 1 — measured live with a preview against `lachiejames/slopweaver`. So
  `enable` is proven by unit tests, the local-wire transport test and a recorded cassette of that 403, and its
  first live write is on a public repository.

## `lachiejames/slopweaver`

CodeQL is wanted gone from this repository: it has never once failed here, so it is a check with
no value. When an organisation controls default setup, GitHub
answers a repository admin who is not an organisation admin with **HTTP 422, org-controlled** on `disable` —
nothing applied, the re-read still `configured` — and the configuration read can 404 to that admin's token.

So CodeQL keeps running here until an organisation admin lifts that setting; then
`github code-scanning disable --repo lachiejames/slopweaver` is the whole job. It is **not a required check**
on `main` (`github required-contexts`), so it has never blocked a merge — its cost is wall time for a session
watching `github checks --wait` ([ci-timings](ci-timings.md)).
