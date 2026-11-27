# The lap seat — `github lap-seat`, one session laps in the chair's order

Bundled reference for the `github` skill, beside [the local lap](local-lap.md).

While a chair runs a rota, ONE handover run laps and every other seat sends its pull request number and head SHA
to the chair. The rota is a file the verb reads, never a message a seat might miss: a wake once reseated a seat
whose brief had lost the chair's "never lap yourself", and it took the machine's one lap lock ahead of the ready
priority batch for a whole lap.

```bash
slopweaver github lap-seat set <slug>   # the chair designates an OPEN run; refuses one never started or closed
slopweaver github lap-seat show         # the designation (exit 3 when none stands), then the lap holding the machine
slopweaver github lap-seat clear        # no rota; any session may lap
```

While a seat stands at `$SLOPWEAVER_HOME/laps/seat.json`, `github lap` refuses (single, batch, `--land`,
`--land-only`; never `--dry-run`) before the token or any read, unless the session holds that run — the run
whose journal names it as writer, found by branch, directory name or its one open run. A reseated lap seat runs
`handover claim <slug>` first. A designated run that has CLOSED refuses every lap too, never lapsing the rota:
a seat settling its run is routine, and only the chair ends a rota, by `clear` or a new `set`. A seat file that
will not decode, or a designated journal that is missing, empty or holds a line this checkout cannot decode,
refuses every lap until `set` or `clear`. The hatch for a lap off the seat, or past a closed one, is
`SLOPWEAVER_ALLOW_OFF_SEAT_LAP=1`; it never opens a designation that will not read.

**Before asking for a lap, a seat runs `slopweaver dev targeted-tests` in its own checkout**, once and never
beside a lap. It runs the unit tests the diff reaches (changed tests, direct importers, the mirrored unit
directory, a fixed registry sweep) and each touched nested project's `tsc --noEmit`, in about a minute where a lap
meets the same red twelve or more minutes in. It precedes the lap and never replaces it: the root typecheck, lint,
coverage and the other lanes stay the lap's, and the verb prints that list on every run.

`show` prints a second line whether or not a seat stands: the live lap holding the machine's lock (subject,
pid, since) and its phase, `still in its preflight, before its lanes` or `running its lanes or landing`, else
`no lap holds the machine`. A seat standing empty is not a free machine: a lap takes the lock before its
preflight ([the local lap](local-lap.md)), so read this line before starting one.
