# Protected paths (`slopweaver protect`)

Every install has paths its owner does not want an agent session to touch. Which paths those are is that owner's
business, so **the list lives in the state home and never in the repository**: the codebase carries the mechanism,
and names no path.

## The registry

`$SLOPWEAVER_HOME/protected-paths.json`, written only by `slopweaver protect add|remove`, and parsed, edited and
judged by `src/protectedPaths/` (`registry.ts`, `edit.ts`, `decide.ts`):

```json
{
  "paths": [
    {
      "addedIso": "<ISO 8601 instant, written by protect add>",
      "mode": "read-only",
      "path": "/Users/example/protected-state",
      "why": "a store kept for reference, never written"
    }
  ],
  "schemaVersion": 1
}
```

- `path` is absolute and normalised; `protect add` expands `~` and resolves a relative path before it writes. A
  directory protects everything beneath it. Two entries for one path (case folded) are refused.
- `mode` is `read-only` (read, never written) or `no-access` (never read or written). Where two entries overlap,
  the stricter wins whatever their order.
- `why` is the owner's reason, printed in every refusal.

Absent means nothing is protected, and `protect remove` deletes the file with its last entry, since an empty file
would start the read-side hook's Node process on every `Read` to protect nothing. A file that will not parse is the owner's list in an unknown state:
`protect list` reports it and `protect add|remove` refuse to overwrite it, while the hook fails OPEN on the entries it
cannot read (a guard that failed closed would wedge every `Read` on one bad byte) and still holds the registry file
itself read-only.

Adding a path or tightening one needs nobody's leave. Removing one, or loosening `no-access` to `read-only`, needs
the `protect-remove` hatch (`SLOPWEAVER_ALLOW_PROTECT_REMOVE=1`), whose only legitimate use is the owner's own word.

## What is enforced

Every session runs as the owner's own macOS user, so **nothing here is an operating-system boundary**. What the
code can enforce, it does, in these places:

- **The `PreToolUse` hook** (`protected-path-guard`, `src/admit/protectedPathGuard.ts` and
  `src/admit/protectedPathBash.ts`):

  | tool                                    | `read-only`          | `no-access`                                      |
  | --------------------------------------- | -------------------- | ------------------------------------------------ |
  | `Edit`, `Write`, `NotebookEdit`         | refused at and under | refused at and under                             |
  | `Read`                                  | allowed              | refused at and under                             |
  | `Grep`, `Glob` (root, else the session) | allowed              | refused at, under, and ABOVE (a search reads in) |
  | `Bash`                                  | a detected write     | any word naming it, or a segment running in it   |

  A `Bash` write is what the call-state guard calls destruction (remove, move, copy onto, truncate, in-place edit,
  `find -delete`, git clean or discard), plus every writing redirection (`>>` included), `tee` (`-a` included),
  `touch`/`mkdir`/`chmod`/`chown`, the destination of `cp`/`mv`/`ln`/`install`/`rsync`/`ditto` (its `-t` directory,
  else its last operand — a no-clobber copy included), `dd of=`, and any `git` subcommand that is not a known read, run
  inside the path or at it through `-C`. A redirection is read from where the shell stands; a program's operands from
  where it runs, after a wrapper's own chdir (`env -C`, `sudo -D`); a `git`'s from each `-C <dir>` in turn, read once
  (an attached `-C<dir>` git refuses, so it moves nothing). `Read`, `Grep`, `Glob` and `NotebookEdit` reach the dispatcher only through
  their own `hooks.json` row (`scripts/pretooluse-protected-paths.sh`), which starts no Node process when no registry
  sits in the configured state home, `$HOME`'s default one or the account's own (from the password database, so a
  redirected `$HOME` cannot hide it), runs this one check and no other, and RELEASES on every ending it cannot
  decide — a spent budget, no runtime, an envelope kill. A session reads `hooks.json` once, at boot, so that row
  covers sessions booted after it lands; the `Bash`, `Edit` and `Write` half rides rows every session already holds,
  so it covers a running session as soon as the guard code that session's hooks run carries it.

- **The verbs that read an arbitrary local path for a model**: `slopweaver talk file read|list` refuses a
  `no-access` path, on the path as asked and the path it resolves to, as `owner-protected` — checked before the
  credential rules, so the credential hatch never lifts it. A listing of a parent leaves a `no-access` child out,
  and out of its total, so it never says the path exists.

- **The bronze writer** (`src/corpus/bronzeProtection.ts`, called by `createBronzeCommitter`, which every refresh,
  resync, `seed` and heal append goes through): before a source's dedup index is built it judges the source
  directory as a search, every entry the walk meets and each `.jsonl` it would open, and the window file it would
  append to as a write, so a `read-only` entry stops the append too. It is the one walker that REFUSES a covered
  entry rather than skipping it, since a dedup index missing a file re-appends that file's records. It reads BOTH registries, the home in
  use and the account's own default (`src/protectedPaths/ownerEntries.ts`), and fails CLOSED: a registry that will
  not parse, cannot be read or is a dangling symlink refuses every write. A path is judged under its spelling and
  its real path through the nearest existing ancestor, and an entry recorded through a symlink covers its real path
  too, so a symlink into a protected tree is refused before anything under it is listed or read. A refused source writes nothing, keeps
  its watermark, and fails its own `refresh` leg; the other sources in the run carry on.

- **`slopweaver store backup`**, which reads whole trees for a session: it prunes a `no-access` source before
  listing it and names it as `NOT backed up`. It refuses a destination at or under any protected path, or holding
  a `no-access` one, as `HELD`. A protected staging root or `secrets/` holds the whole run. It reads the same two
  registries `talk file` does and fails CLOSED on one it cannot read, where the hook fails open
  ([the backup](../store/backup.md)). Restore and rehearse are not wired to the registry yet.

- **The corpus readers**, through the same judge and its two choke points: `listBronzeFiles` (`src/corpus/bronzeStorage.ts`)
  and the walk every directory reader shares (`scanJsonlProtected`, `scanCorpusRoot` in `src/corpus/corpusStore.ts`).
  A shared walk's root is judged as a `list` before it is even statted and REFUSED when an entry covers it; below
  it, every entry is judged as a `list` before it is statted or followed and each `.jsonl` as a read before it is
  opened, and a covered one is SKIPPED and named, never listed or opened, so one `no-access` entry under the corpus
  never refuses every reader of the rest. A `list` is refused only at or under a `no-access` entry, and only a walk
  judging every child may ask one; the hook's search above still refuses an ancestor. That covers `readCorpusDir`
  and its tally, the census, corpus resolution, derive, `audit`, `slice verify`, `dev manifest`, `distil plan`, the
  hygiene scan, `identity`, `linear query`, the voice measure, Notion's ref heal content stores. The census, the
  tally and corpus resolution carry a `NOT READ` warning per skip, and every walk caller says it: `linear query`,
  `identity`, `dev slice-shape`, `dev heap-curve` and `profile voice measure` print each on stderr, and the
  refresh voice leg counts them; `audit` names each protected source as `NOT AUDITED`; the hygiene
  scan and its `corpus-hygiene` gate print `NOT CHECKED, protected by the owner's list` on every run, and the gate
  passes that arm alone. `listBronzeFiles` refuses a SOURCE holding a covered entry instead, since `compact`
  rewrites its file set: that covers the cycle reads, Notion's seen index and ref heal, Slack member hydration,
  Gmail's meeting proof, and the listings `compact` and `fathom share` read before they rewrite. A refusal is an
  `Err` naming the entry, never the empty corpus it would otherwise read as, so a refused read fails its verb;
  member hydration alone skips its supplementary recovery with the refusal as its warning.

- **The corpus rewriters**, through one preflight (`preflightCorpusAccesses`, `src/corpus/corpusAccessGuard.ts`):
  each lists every path it will read, list, write or `tree-write` (a write that may land anywhere beneath a root,
  refused when an entry covers the root or lies under it) and has the whole set judged before its first effect, so
  a writer REFUSES and is never a partial one. That covers `compact` (the canonical file and every window it
  unlinks, judged as writes, so a `read-only` window survives; its orphan sweep keeps a covered temp file and names
  it), `fathom share`'s supersede rewrite, `subset` (every tree it copies as a search, the destination home as a
  tree-write, each sink as a write), the ChatGPT take-in (the archive as a search, the export store as a tree-write)
  with its receipt write and receipt sweep, the live snapshot hold, Notion's capture-coverage file, and the member
  and structure stores. They read the same two registries the bronze writer does and fail CLOSED; a refusal is an
  `Err` naming the entry, and nothing was written.

**The account's own default home is not movable from a command line.** It comes from the password database
(`accountDefaultHome`, `src/homeDir.ts`), and no flag or environment variable relocates it, so a verb pointed at a
throwaway `--home` still reads the owner's live registry. Under test, `src/__tests__/setup-ambient-home.ts` puts a
per-file sandbox in a process-only slot instead, so an in-process test never reads the operator's registry, and
carries it into every spawned child as a test-only `NODE_OPTIONS` preload (`src/__tests__/accountHomeSandboxPreload.ts`)
whose own import URL names the sandbox — no variable production reads. A spawn that builds a minimal environment
spreads `accountSandboxChildEnv()` in; a launcher probe that clears `NODE_OPTIONS` on purpose runs no Slopweaver code.

The way past a hook or `talk file` refusal is the `protected-path` hatch (`SLOPWEAVER_ALLOW_PROTECTED_PATH=1`), for
one call, on the owner's own relayed word. The bronze writer and `store backup` open for no hatch: the entry itself
is what changes.

## What stays a tripwire

The guard reads a command's words; it does not run them. Not judged:

- a reader recursing from an ancestor (`grep -r x ~`, `find ~`), an interpreter or nested shell (`python -c`,
  `sh -c`), `xargs`, an alias or function, a variable or command substitution it cannot expand;
- a symlink or hard link reaching the path by another name when the link is in a `Bash` word (the file tools and
  `talk file` resolve an existing symlink; a link created after the check is not seen). A `..` is collapsed
  lexically, so `git -C link/..` or `cd link/..` through a symlinked parent is judged where the spelling points, not
  where the kernel's physical `chdir` lands;
- `git --git-dir`/`--work-tree`;
- Codex, which reads files through its own sandbox outside these hooks, and any native process run as the owner;
- the other verbs that read a local file to upload it (Slack, Linear and Notion attachments, Vanta evidence,
  browser uploads and image inputs, provider body files) — none is wired to the registry yet;
- the ChatGPT writers beside the take-in: the certified and live as-of stamps (`exportAsOf.ts`'s
  `writeCertifiedAsOf`, `liveAsOf.ts`'s `writeLiveAsOf`), `live-sync`'s listing carry (`liveSyncCarry.ts`'s
  `readListingCarry` and `writeListingCarry`, beside the live as-of stamp), the archive index (`archiveIndex.ts`'s `remember`, which
  `takeInArchive` calls after a judged take-in), the held-export verification (`heldVerification.ts`'s
  `rememberVerified`), and `locateExport`'s read of `--from` (`src/cli/commands/chatgpt/exportLocation.ts`), which
  lists a folder before the take-in judges it. Beside them, derive's per-source freshness witness
  (a one-level stat, `src/silver/derive/stamp.ts`) and the writer's own dedup-index seam for a caller that hands it
  no judge. So `refresh` as a whole is not a no-access fence; only its bronze append, the rewriters and the reads
  above are;
- what a SPAWNED test reads: a verb resolves the home's registry and the account's own default unless a resolver
  is injected. In process the account default is the per-file sandbox above, but a subprocess-lane child resolves
  the real one, so a spawned verb with no seam reads the owner's real list. `loadCorpus` (and `dev heap-curve`
  over it), `subset`'s verb shell, `seed`, `fathom`'s verb deps and the refresh legs (the Notion coverage record,
  the bronze committer they flush through) take no resolver yet, so an in-process test of those is judged by the
  sandbox's registry and a spawned one by the account's (`src/__tests__/noProtection.ts` is the seam the others
  pass);
- a path swapped for a symlink between a judgment and its open, in the bronze writer or a judged reader's walk. The registries themselves are
  read again for every source a commit writes, so an entry added mid-run over that source refuses its next append.

A refusal confirms a session was reaching a protected path; the guard's silence proves nothing.
