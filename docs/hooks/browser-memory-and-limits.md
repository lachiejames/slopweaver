# The browser guard — every Claude-in-Chrome call refused

Part of [Hooks — what runs automatically, and what each one refuses](../hooks.md).

**The `browser-door-guard` check refuses every Claude-in-Chrome call** (`mcp__claude-in-chrome__*`), with no
override: the extension is retired (the owner's ruling, `src/admit/chromeRetirement.ts`), and the refusal
names the `slopweaver browser open`/`read`/`act`/`close` verbs to use instead. **Those verbs are the door**
(doctrine rule 3), and they drive the owner's Chrome through Playwright, so they never reach this matcher. Every other
tool passes through untouched. `docs/security/browser-write-surface.md` § "The browser is a write surface" has
the incident and the measurement; the write-policy register those verbs consult is `src/admit/browserSurface.ts`.

**Nothing waives it.** `slopweaver browser break-glass` and every environment variable are never consulted
here, so a recorded break-glass does not reopen a retired tool. **Every refusal is journalled** as one
`chrome-retired` line in `$SLOPWEAVER_HOME/ledgers/browser-verdicts.jsonl` (`src/admit/browserVerdictJournal.ts`),
naming the session and the tool, and `slopweaver browser verdicts [--blocked] [--limit <n>] [--json]` reads
them back, older allow and waiver rows included.

## The memory hooks — one before the write, one after

**Before.** The `memory-write-guard` check sees every `Write` and `Edit`, and for a payload landing
on an auto-memory LEAF it decides two things from the text alone: is the declared `name` well formed, and does
every `[[wikilink]]` in it name something that could ever resolve. Either defect exits 2 with the reason, so
the model corrects and retries; everything else exits 0, including every non-memory write, which is the
overwhelming majority. It **never repairs** — refusing and explaining is the whole contract. A forward
reference to a well-formed name no memory carries yet is deliberately ALLOWED: Claude Code's own standing
memory instruction says to link liberally, so denying one would fight the tool. Both criteria are properties
of TEXT. Both tools are judged against the file they land on — the result is reconstructed and the defects
the file already had are subtracted. Each half earns its place. Without the reconstruction an `Edit` whose
replacement text carried no `name:` token of its own renamed a memory past the gate; without the subtraction
every rewrite of a memory whose name is already bad is refused, the repair included, and five such defects
stand accepted on this machine. A leaf with no prior text is a new memory, so every defect in it is this
write's. Hatch: `SLOPWEAVER_ALLOW_MEMORY_WRITE=1`.

"Landing on a leaf" is answered by CORPUS rather than by path spelling, because one of the three live corpora
on this machine is a symlink into another repository and every leaf in it has a second, equally real path. The
`~/.claude/projects/<project>/memory/` shape is still decided lexically and for free; a `.md` written into any
other directory named `memory` costs one `existsSync` for a `MEMORY.md` beside it, which is the same mark
`discoverMemoryCorpora` uses. An ordinary source write fails both free tests and reaches no `stat`, which
matters because the matcher is `Edit|Write` and a measured incident showed what a slow hook on a
high-frequency matcher does to this machine.

**After.** The `PostToolUse` hook on `Write` runs `slopweaver memory hook --from-payload`, which **always
exits 0**. It checks a memory that was just written for routing, schema, link and placement defects, and syncs any
explicit current-owner ruling into the judgement overlay (see
[judgement-and-routing.md](../judgement-and-routing.md)). It survives the gate above because it reports on the
whole GRAPH — an orphan, a double-route, a genuinely dangling link — which no single payload can decide.

The same corpus is inspectable by hand, and `gate` is the loud recurring run:

```bash
slopweaver memory check      # routing, schema, name-format, link and placement defects across one corpus
slopweaver memory sweep      # every memory laid out for a keep / adjust / drop pass
slopweaver memory gate       # every corpus on the machine; refuses on a NEW defect only
slopweaver memory gate --install   # wire that run to the state repo's pre-push hook
```

`gate` is the one that cannot be ignored, and the one thing to know about it is what it refuses ON: a finding
not on `$SLOPWEAVER_HOME/memory-gate-baseline.txt`. Standing defects are reported and do not block, the list
only ever shrinks, and `--accept` is the only way onto it. The pre-push hook it installs **gates nothing about
what is being pushed** — the corpus is not in that repository, and the directory it lives in is not a git
repository at all; it rides the repo the fleet pushes often so a defect cannot sit unseen.

`src/memory/` holds the whole subsystem — `parse.ts` and `types.ts` for the leaf format, `store.ts` and
`corpus.ts` for reading it, `check.ts` + `nameFormat.ts` for the defect pass, `addendum.ts`, `placement.ts`,
`indexDrift.ts` and `amendsCanon.ts` for the placement rules ([every id](../../skills/memory/reference/checks.md);
a declared canon row is resolved at the verb edge by `src/cli/commands/memory/judgedCorpus.ts`), `writeGate.ts` for the
write-time decision, `gateBaseline.ts` + `prePushHook.ts` for the recurring run, `sweep.ts` + `sweepRender.ts` for the triage
view, `hookPayload.ts` for the hook's own decoding. **It presents; it does not judge.** There is no verdict,
no score and no model call: a staleness heuristic was tried against a real corpus, produced false positives,
and was ruled out on evidence.

## What hooks do NOT do

- **The raw block covers NAMED tools, never a capability.** `classifyRawCommand` carries a
  reaching-CLI table beside `curl`/`wget` (`cloud-cli`: `gcloud`, `aws`, `az`, `gsutil`, `bq`, `kubectl`;
  `secrets-cli`: `op`; `production-cli`: `twilio`, `stripe`, `vercel`, `heroku`, `supabase`, `fly`,
  `netlify`). A BARE invocation with no argument is allowed — it prints help and touches nothing. The
  `production-cli` class is the ONE category `SLOPWEAVER_ALLOW_RAW` does not waive: it takes a journalled,
  tool-scoped, 30-minute grant (`slopweaver session reach-grant --tool <t> --reason "<why>"`,
  `src/admit/reachGrant.ts`), because an env var is ambient and traceless, which is the wrong shape when the
  rule is "stop" rather than "be careful". General-purpose interpreters (`node`, `npx`, …), local dev tools
  (`docker`, `psql`) and package managers are deliberately ABSENT, each for a measured reason recorded in the
  table's own comment.
- **A browser launched at the wrong DATADOG SITE is a third walk** (`src/admit/datadogSiteCommand.ts`, the
  owner's ruling): an `open`/`xdg-open` segment naming a Datadog console other than `DD_SITE`'s, or a dead derived
  host (any regional site's `app.` host, `app.us3.datadoghq.com` for one), is refused through `SLOPWEAVER_ALLOW_DATADOG_SITE=1`, ambient or per
  segment. The rule is `src/datadog/siteGuard.ts`, which `browser open`, `browser inspect`, `browser shot` and
  `browser act --do navigate` apply too.
- **A session running `gcloud auth application-default login` is a fourth walk** (`src/admit/adcSigninCommand.ts`,
  the owner's word): its redirect listener dies with the seat's shell, so the command goes to the
  owner's terminal
  on a floating note and the seat waits with `slopweaver google adc --wait` (`src/gcloud/`). Only `SLOPWEAVER_ALLOW_ADC_SIGNIN=1`
  opens it; `SLOPWEAVER_ALLOW_RAW` does not. [Waiting on a sign-in](../../skills/hand/reference/waiting-on-a-sign-in.md).
- **A RAW BROWSER LAUNCH is a fifth walk** (`src/admit/browserLaunchCommand.ts`, rule 3; measured when each shape
  exited 0): `open -a`/`-b` naming a browser or `open <http(s) url>`, a Playwright CLI (`@playwright/cli`
  and `@playwright/mcp` at all, `playwright` on any subcommand but `install`, `uninstall`, `merge-reports`, `clear-cache` and their kin, or with `--extension`/`--cdp`, bare or behind
  `npx`/`bunx`/`pnpm dlx`/`yarn dlx`), a browser binary run directly, and `osascript` telling a browser, inline or
  from a heredoc it reads. `commandSegments` keeps a heredoc that only QUOTES one as data. It re-reads the line a
  wrapper runs from a string (`sudo bash -lc`, `env -S`, `su -c`, `watch`, `npx -c`) a `$(…)`/`<(…)` substitution (an unquoted heredoc body's included) and a heredoc a bare `bash`/`sh` reads as its script, sixteen levels deep, and REFUSES one nested
  deeper as `nested-past-reading` rather than allowing it unread, whenever it names anything launch-like or spells a
  character by a shell escape (`$'\x6f'`, `\157`). Only
  `SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1` opens it, ambient or per segment; `SLOPWEAVER_ALLOW_RAW` and
  `SLOPWEAVER_ALLOW_BASH` do not. Not seen: an alias, a function, a script file's text, a heredoc inside `sh -c`, an
  AppleScript target built at run time, a program name computed at run time (`$x$y -a Safari`, a decoder pipeline in
  a substitution), a browser `src/admit/browserApplication.ts` does not name. The `slopweaver browser` verbs launch from code, never
  through Bash, so this walk never sees the door it routes to.
- **PYTHON is refused by a SEPARATE walk, not by that table** (`src/admit/pythonInvocation.ts`, the owner's
  ruling: the work is authored as typed, tested TypeScript exposed through a `slopweaver` verb).
  It refuses any interpreter invocation — `python3 -V` included, since this is about which tool does the work
  rather than about reaching anything — through `SLOPWEAVER_ALLOW_PYTHON=1`, ambient or as a per-segment
  prefix. `SLOPWEAVER_ALLOW_RAW` does not open it and it opens no raw refusal; when a command breaks both
  policies, the hook prints both. It reads what a shell really executes: a `-c` payload, the heredoc stdin
  actually selects, `$(…)`/backticks/`<(…)`, an unquoted heredoc body's own expansions, `eval`, `find -exec`,
  and one level of script through the same reader (a `#!` naming Python, a shell script's lines, or a `.py`
  path it cannot open). It does NOT see an alias or function, a program word in a variable, stdin from a pipe,
  `env -S`, a wrapper option its finite table does not list, a script a script calls, a package script's body,
  a Python-based tool run by its own name (`pytest`, `pip`), or anything run transitively.
- **The ARTIFACT tool is refused by a THIRD walk, asked first** (`src/admit/artifactTool.ts`, the owner's
  ruling: every page the owner reacts to is a local file at `$SLOPWEAVER_HOME/pages/<slug>/index.html`,
  written by `slopweaver page publish`). It judges the payload's `tool_name` rather than a command line, and
  it has to run BEFORE the shell walks: `shellCallOf` answers allow for every tool that is not
  `Bash`/`Monitor`, so a classifier placed after it would never see an `Artifact` payload. Every action is
  refused, a `read` and a `list` as much as a publish, because the rule is about where a page LIVES.
  `SLOPWEAVER_ALLOW_ARTIFACT=1` opens it; neither of the other two hatches does, and it opens neither of
  theirs. It is one of two enforcements and the weaker-looking one is the point: the owner's user-level
  `permissions.deny` refuses the tool in the harness's own words, and this walk is what says WHY and names
  the verb that replaces it. It cannot see a publish made by anything but this tool — a
  browser leg, another host — so a refusal confirms you were about to publish an artifact and its absence
  proves nothing.
- **A hook is not the write door.** Operating-doctrine rule 3 is a discipline you keep. `classifyRawCommand`
  splits a compound command quote-aware and classifies each segment on its own tokens, so a compound prefix
  does not sail through (measured, `doctrine-rationale/rule-3.md`). A SCRIPT the command runs (a
  direct path, a shell given a script file, either behind `nohup`/`exec`) is opened one level deep and judged by its text — any `gh`, `curl`/`wget` or `git push`
  inside it is a reach (`src/admit/scriptWrapper.ts`; the measurement in its header is four
  `gh`-polling watchers armed through exactly that shape, and through the `Monitor` tool, which no matcher
  covered). What it still cannot follow is a variable, a `$(…)` substitution, an alias, a script a script
  calls, or a relative script path after a `cd` in the same command. **Treat a block as confirmation you were about to do something wrong, and the
  absence of one as meaning nothing at all.**
- **No hook enforces the model-process policy.** `classifyRawCommand` has no `claude` branch at all; rule 2
  is held by the `no-headless` gate in `yarn lint`.
- **No hook writes to a provider.** Every one of them is local: a refusal, a local-state check, or a
  console line.
- **`.git/hooks` is a different family.** Those are lefthook's pre-commit and pre-push — see `AGENTS.md`'s
  Toolchain section — and they are shared across every worktree of this repository.
