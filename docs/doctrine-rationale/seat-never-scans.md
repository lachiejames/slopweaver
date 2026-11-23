# A seat never scans the disk for a path the chair named

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

A docs seat was handed a row whose `summary:` pointed at an image directory as bare prose,
`supervisor-scratch/<handoff>/<images-dir>)`. Nothing in that sentence says what the path is
relative to. It was not in the repository, the seat had no second root to try, and so it went and looked: a
breadth-first scan from `/`, **three cores for eleven minutes**. The chair typed one relative path and the
seat paid for it.

**Both ends are gated, because either one alone leaves the class open.** A writer gate stops the next bad
brief and does nothing about the 446 already on disk; a reader gate stops the scan and lets a chair keep
writing rows nobody can root. So `slopweaver handover register` and `slopweaver cmux spawn` refuse a brief
carrying a bare state-home-relative path (`src/handover/briefPaths.ts`), and the seat-side `disk-scan-guard`
refuses a `find`/`bfs` rooted at `/` or `$HOME` (`src/admit/diskScan.ts`). Both carry a hatch.

**The writer criterion is a two-set DIFFERENCE, so there is no list to drift.** A token is refused when its
first path segment is a top-level entry of the state home and is NOT a top-level entry of the repository.
Both sets are read when the gate runs. The difference is load-bearing rather than tidy — five names sit in
both sets on this install (`.claude`, `.git`, `.gitignore`, `bin`, `eval`) and `bin/slopweaver` is named in
dozens of briefs:

```bash
comm -12 <(ls -A "$SLOPWEAVER_HOME" | sort) <(ls -A . | sort)
```

**Two design calls were measured rather than reasoned, and both reversed the obvious answer.** Modelling the
scanner on `src/cmux/baseFreshness.ts`'s `docReferencedPaths`, which reads only backticked tokens, would
have let the incident straight through: the incident's token is bare prose with a trailing `)`. Over the 2661
docs in `$SLOPWEAVER_HOME/handovers` a backticks-only scanner of the brief finds **6** and the prose-aware
one finds **446**. And scoping it to the whole doc body rather than the BRIEF refuses **148** docs on the
identical scanner, where the extra class is not a defect at all — `live/turn` recurs as a quoted string
FRAGMENT in docs reasoning about a prefix matcher, which is a pattern being discussed and not a file to
open. The brief is what the chair wrote: the front matter plus the section recording the owner's ask. Everything below it
is added by a session standing in a checkout, where a relative path resolves.

**The reader criterion is equality, never containment**, and `-maxdepth ≤ 2` is allowed: the shapes that
hurt are `find /` and `find ~`, not a bounded probe of the top of the tree. `rg` and `fd` are
deliberately outside it because they respect ignore files, and the refusal recommends
`rg --files <folder> -g '*<name>*'` over the one folder a file is likely in. It does not recommend `mdfind`:
Spotlight is off on the owner's machine, where `mdfind` answers nothing rather than refusing.

**A search has its own row**: six of one seat's `grep`
children read a 17.5 GB corpus bronze file with backtracking patterns and held the machine at 0% idle for an
hour. The row refuses a grep-family search or `rg` with any operand INSIDE `$SLOPWEAVER_HOME/corpus` —
containment here, because every file under it is data-sized and `store cite`/`store read --search` is the
read that answers the question — and a RECURSIVE grep-family search over `/`, `$HOME`, `/Users`, `/home` or
the state home, equality again. `rg` is outside the home half because it respects ignore files. A relative
operand resolves against the hook payload's `cwd`, and `grep -r` with no path means that cwd. Its hatch,
`SLOPWEAVER_ALLOW_UNBOUNDED_SEARCH`, opens only that row; the scanner's opens only its own. The machine side is
`machine reap`'s fourth class ([fleet-attribution](../../skills/supervisor/reference/fleet-attribution.md)).

**Residue, stated rather than discovered.** The writer gate's strength is install-dependent: it reads the
state home's own top level, so on a fresh install with an empty state home the set is empty and the gate is
a no-op. That is correct — there is nothing to be relative to — but no test can assert otherwise. It is also
forward-only: the 446 briefs already on disk are untouched.
