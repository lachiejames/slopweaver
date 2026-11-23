# Joining and leaving a Linear team

`slopweaver linear team-membership join|leave --team <key>` changes the team membership of **the token's own
user**, and nobody else's. There is no user argument: a membership is addressed by the team key alone, and the
user is whoever `viewer` names for the configured token. It is the one Linear write whose target is the owner rather
than a ticket, which is why it is shaped the way it is.

```bash
slopweaver linear team-membership join --team ENG             # read and preview; sends nothing
slopweaver linear team-membership join --team ENG --apply     # send it, through the door
slopweaver linear team-membership leave --team ENG --apply \
  --unasked --why "<for the next session>" --said "<for the owner>" --by-session <session>
```

## Preview by default

Without `--apply` the verb reads where the user stands — the team by key, the viewer, the viewer's membership
on that team — prints it, and sends nothing. A join of a team the user is already on, or a leave of one they
are not on, sends nothing even under `--apply` and exits `3`; the pre-write read is the idempotence, so there
is no reservation to clean up.

## Which teams is the owner's word

Which teams the owner is on is the owner's decision. Run `--apply` on a team the owner named. The verb exists so
that the write the owner asks for goes through the door rather than the owner's own clicks in Linear, not so that
the fleet manages the owner's memberships.

`--unasked` exists for the narrow case rule 10 already covers — an act a session that knows the owner would call
obvious — and it journals the act exactly as an unasked `linear issue` write is journalled: the three accounts,
a kind of `linear-team-join` or `linear-team-leave` (`-unconfirmed` when the read-back could not confirm it),
the owner's own Linear profile as the subject, and a witness naming the team, the act and the rollback.

## The rollback is the opposite verb

A membership has no activity history to restore from the way an issue has, so the rollback the row names is
the exact command that undoes it: `slopweaver linear team-membership leave --team ENG --apply` for a join, and
the join for a leave.

## Confirmed by reading back, never by the payload

Linear's membership payload echoes only an id. So every write is judged by reading the viewer's memberships
again:

| Mutation | Read-back            | Outcome         | Exit |
| -------- | -------------------- | --------------- | ---- |
| ok       | shows the change     | `written`       | 0    |
| ok       | unchanged, or failed | `unconfirmed`   | 3    |
| error    | shows the change     | `landed`        | 0    |
| error    | unchanged            | `failed`        | 1    |
| error    | failed               | `indeterminate` | 3    |

The membership page is read 250 at a time, and a page that says it has more is refused rather than read as
complete, because "not a member" is only provable over the whole list.
