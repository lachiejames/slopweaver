# Own-repository rows — a repository's address is an install's fact

`bump-drive-slopweaver` and `bump-fix-slopweaver` (`src/live/automation/standingOwnRepositoryRows.ts`) name the one
declared main checkout whose `origin` repository is named `slopweaver`, whatever its owner, read wherever the process
stands (`src/live/automation/ownRepository.ts`). The value is derived, never compiled in: a slug GitHub cannot resolve
reads as zero open pull requests rather than failing, so the worklist reports nothing to do while real bumps sit open.
Four things hold that shut:

- **No fallback.** A home resolving none, or two, declares neither row: `automation due` opens on
  `OWN REPOSITORY UNRESOLVED` and `register-standing` writes every other row and exits non-zero. A copy already in the
  store still fires as written, since the store is what runs and a declaration only compares against it, so that
  line is the one warning a stale copy is still reading its old repository. Both verbs say it even when another
  registry refuses the pass.
- **A pass writing either row records its address** in `$SLOPWEAVER_HOME/live/recipe/own-repositories.json`,
  append-only, so a later origin move reads what it wrote as `SUPERSEDED` and brings it forward. A row it merely found
  gets no record, so that move reads it as drift. A record means a pass meant to write there: it is per address, not
  per row, and written before the rows so a crash stays recognisable, so an exact copy placed by hand on a recorded
  address reads as the pass's. An unreadable history refuses, since read as empty it would leave
  a moved row looking like somebody's edit.
- **A row on any other address is `REPOSITORY DRIFT`**, reported and never written over by a pass: no build wrote that
  shape, so it is somebody's edit. The tally gains `· N REPOSITORY DRIFT`. It is corrected by
  `slopweaver automation repoint <recipeId>` (`--dry-run` to preview), never removed: the usual edit is
  `enabled: false`, and a removed row is written back as declared, turned ON. Repoint moves the one `--repo` value and carries
  every other key over as JSON in the file's own order (formatting is not kept), under the definition hold lock with
  no takeover from a live holder (and it stops, unwritten, if a pass took the lock from it), and records the new address first, as a pass does — so the earlier slug is never
  recorded, and a later move reads an untouched enabled row as `SUPERSEDED`. A disabled row stays somebody's edit, so a
  later move reads it as drift again. Refused for a row not reported as drift (a case-only difference is not), one
  standing in more than one file or under another name, one naming `--repo` twice or not at all, and a canonical file
  that is not a regular file.
- **`SOURCE_REPOSITORY` stays the hygiene gate's identity** (`src/hygiene/ownRepository.ts`). Here it is only the
  earlier shape an install written before this derivation holds.
