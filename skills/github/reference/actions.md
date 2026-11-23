# Hosted Actions: read it, and switch it off

`slopweaver github actions` reads whether hosted GitHub Actions runs on one repository, and switches it OFF through
the door. It is the verb for a repository whose CI runs on this machine instead (`github lap`,
[local-lap.md](local-lap.md)), so hosted runs stop spending minutes or failing at a runner floor on every push.

```bash
slopweaver github actions --repo <owner/name>                    # read: enabled, and which actions may run
slopweaver github actions --repo <owner/name> --disable          # preview: before and after, writes nothing
slopweaver github actions --repo <owner/name> --disable --apply  # switch off through the door, then read back
```

## This verb only switches off

`github actions` has no switch ON, and no flag that becomes one; `--apply` without `--disable` is a usage error.
Turning Actions on spends runner minutes on every push, so it is a different verb with a different bar:
`github repo --enable-actions`, which applies a stated policy and sends only on the preview's approved digest
([repository.md](repository.md)). A session never approves that digest itself; the owner's own yes does.

## How an outcome is judged

The write is GitHub's `PUT /repos/{owner}/{repo}/actions/permissions` with `enabled: false`, sent once (no retry).
GitHub answers a bare 204 with no state, so the verb always reads the switch back, even after a failed write: a
dropped connection or a 5xx does not prove the write did not land.

| Write      | Read-back       | Outcome                   | Exit |
| ---------- | --------------- | ------------------------- | ---- |
| (not sent) | read was off    | `already off`             | 0    |
| ok         | `enabled=false` | `disabled`                | 0    |
| failed     | `enabled=false` | `off despite write error` | 0    |
| ok         | `enabled=true`  | `NOT confirmed`           | 1    |
| failed     | `enabled=true`  | `unchanged`               | 1    |
| either     | read failed     | state UNKNOWN             | 1    |

A first read that fails (a 403 or 404, say) opens no door and sends nothing: the state was never established.
A read-back with no boolean `enabled` is a failed read, never "off". `allowed-actions` says which actions may run
while Actions is on, and GitHub stops reporting it once Actions is off, so the preview's after line says `not
reported`; it never explains an organisation or enterprise policy, which this endpoint does not report. The token needs the repository's Administration permission: read for
the read, write for the switch-off.

`--json` prints one document: `{ outcome, repo, state }` for a read, `{ outcome, repo, before, after }` otherwise, an
absent `allowedActions` as `null`.
