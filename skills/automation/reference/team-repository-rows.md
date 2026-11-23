# Team repository rows — declared by registration, never compiled in

Which repositories an installation works in is one installation's fact, so it resolves from `$SLOPWEAVER_HOME`,
never from this tree. The generic rows every install carries are [declared rows](declared-rows.md). Register one:

```bash
slopweaver automation register-standing --repo acme/acme-admin --dry-run
```

That adds the registration to `live/recipe/team-repositories.json` (strict schema, sorted, lower-cased) and then
writes the rows exactly as the generic ones are written. `teamStandingRows` (`src/live/automation/teamStandingRows.ts`)
is the template; `declaredStandingRows` resolves generic plus registered rows from a home. A registry an earlier
build wrote, whose entries also carried the logins its top-ups raised pull requests as, still reads: each entry
projects to its repository, and the next write lands the current schema.

## The rows

Every id is keyed on the repository's name, so `acme/acme-admin` declares:

| Row                               | Cadence        | Note                                                                    |
| --------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `bump-drive-acme-admin`           | `30 */4 * * *` | `github bump-drive --repo acme/acme-admin`                              |
| `error-tracking-batch-acme-admin` | `0 9 * * 1`    | declared HELD, seated ([error-tracking batch](error-tracking-batch.md)) |

**No vulnerability-fix top-up is declared here.** Its cadence, cap, merge hold, title convention, post and
evidence are all the installation's own policy, so an installation writes its own `verb-run` row under
`live/recipe/definitions/` carrying them as flags ([the flywheel](../../vulnerability-fix/reference/the-flywheel.md)).

**The error-tracking batch is declared HELD.** Its argv is the `datadog errors` blast-radius worklist (`--from 7d
--state for-review --order count`), Monday 09:00 install-local. Its declaration carries a hold only the owner's
anchored yes on the #monitoring proposal lifts, because the batch parks posts for team channels — so
`automation due` renders it held, never due. It names no `--repo`: `datadog errors` takes none.

## What is refused, and what stays loud

- A repeat is a no-op. Two repositories sharing a name, or one whose name takes a
  generic row's id, is refused with nothing written: every row id is keyed on the name, so the second would
  overwrite the first's rows.
- A registered repository whose row is deleted stays loud in `automation due`, because the registry still
  declares it. On a home with no registry, `automation due` says `no team repositories configured on this install`.
- A registry that will not read is never read as none: `automation due` leads with `!! team repositories ·
<why>` and compares nothing, and `register-standing` exits 1.
