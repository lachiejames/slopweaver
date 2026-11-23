# Who reviews what — the reviewer rows a review ask is built from

A reviewer asked to review another team's hundred-file pull request wants to be taken to the one or two files they
are actually on the hook for. GitHub's CODEOWNERS view says who must approve. It never says which files are whose.
`github pr reviewers` says that, in the terminal. **A C3 description publishes no reviewer table**: the form refuses
a `reviewers` field by name, and `--apply`, which once wrote one, is refused before any read. Ask the people the
rows name with `github pr request-review` ([pr-operations](pr-operations.md#requesting-review)).

## Derive it, never type it

```bash
slopweaver github pr reviewers <pr-url> [--pick @team=@person]... [--json]
```

The verb reads the pull request's WHOLE file list and the CODEOWNERS on its BASE branch, the file GitHub applies,
and prints one line per row (who, and which files) plus any file no reviewer owns. It writes nothing. Code:
`src/outbound/github/reviewerTable.ts` derives, `src/cli/commands/github/prReviewersReads.ts` reads,
`src/cli/commands/github/prReviewersRun.ts` runs the steps.

- **A file belongs to its LAST matching rule's owners**, so a rule with no owners leaves it unowned, as GitHub does.
- **The author is never on a row.** Their login is taken off every rule, and a pick naming them is refused.
- **The catch-all rule (`*`) is Everything else, named once**, with no count, so it stays true as a push adds files.
  A file nobody owns (a removal rule, or only the author) is on no row and is printed. While one exists, the
  catch-all's row lists its own files by name, because Everything else would claim that file too.
- **Rows with the same final reviewers merge.** Files rows come fewest files first, and Everything else is last.
- **No table** when one reviewer covers every file, because GitHub already says that.
- **A partial file list is refused**, never derived: a narrow owner's file would land in Everything else.
- **A file decided by a line GitHub reports an error on is refused**, naming the file and line. The verb reads
  `GET /repos/{owner}/{repo}/codeowners/errors` at the base, which lists every line GitHub partly or wholly
  ignores (an unknown owner, one without write access, a pattern it cannot read), rather than re-deriving
  GitHub's access rules. An unreadable error list is refused too, never treated as none.
- **An owner CODEOWNERS names by email is refused**, naming the file: GitHub resolves it to an account, a row can
  tag only an `@` token, and reading it as no owner would leave that reviewer's file on no row.
- **A pull request that moved mid-command is refused**: up to 300 files the list is read from the compare of the
  base and head commits the pull request first reported, so it is pinned to them. The verb reads the pull request
  again after every read and prints nothing if the head or base commit changed. Run it again. Past 300 files compare
  stops, so the pull request's own list (up to 3000) is read unpinned, and two force-pushes inside the verb's reads
  that end on the first head (A, B, A) are not seen there.

## Picks: the people the thread names

`--pick @org/platform=@quinn` puts a person in place of a team token on its row. The row then reads "@quinn (for
@org/platform): <files>". The person must resolve through the roster (the
same exact-match lookup `request-review` uses). A pick whose token owns no changed file, or a token picked twice, is
refused. That catches a typo, which would otherwise be a no-op that looked like it succeeded. **A team tag notifies
every member of the team**, so on another team's pull request pick a person for it.

Re-run the verb after a push that adds files or a CODEOWNERS change on the base: the rows are derived at the
moment it runs and stored nowhere.
