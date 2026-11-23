# Pulling every source, and scanning what Gmail's redaction wrote

How to launch the refreshes, what each streams while it runs, why parallel is safe, and how to read the
hygiene scan afterwards. The rules — background them all at once, and `refresh --all-sources` never includes
the mailbox — are in [SKILL.md](../SKILL.md).

Refresh **per source**, and run them **concurrently** — each source is a different API with its own rate
limit and its own resume file, so there's nothing to gain from doing them one at a time. Only run the
sources the user actually connected in steps 3–6.

Ask the live planner for the exact commands, using the chosen window and only the sources whose preflight
passed (or whose warning the user accepted):

```bash
slopweaver onboard plan --sources github,slack,linear,notion,gmail --backfill 90 \
  --repo <owner/repo> --github-org <owner> --json
```

Launch the bundled `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver"` once per returned `commands[].argv`, passing the
array as the arguments after that executable. This verb is the command authority: do not reconstruct a
combined `refresh --all-sources` call or hand-edit source-specific flags from the examples below.

> **Launch each refresh in the BACKGROUND, ALL AT ONCE — do NOT block, do NOT serialise.** A source crawl
> takes many minutes; running them foreground (or one-after-another) means the user waits N× as long and
> sees nothing but a spinner. Instead start **every** chosen source **backgrounded at the same time** (in
> Claude Code: one Bash tool call per source with `run_in_background: true`), then **poll their outputs every
> ~20–30s and relay the newest heartbeat/preview line from each** until all exit. Total time ≈ the slowest
> single source, not the sum. Each streams to its own background task, so the user can click between them
> (GitHub tab, Slack tab, …) and watch each independently.

```bash
# illustrative shape only — the live planner above emits the commands to run
slopweaver refresh --source github --all-repos --repo <owner/repo> --github-org <owner> --lookback-days 90
slopweaver refresh --source slack  --lookback-days 90
slopweaver refresh --source linear --lookback-days 90
slopweaver refresh --source notion --lookback-days 90
slopweaver refresh --source gmail  --lookback-days 90   # or --all --accept-full-history for the whole mailbox
```

`refresh --all-sources` means the four org-shared surfaces and **never** the mailbox; Gmail is reached by
naming `--source gmail`. A full-history mailbox backfill that hits its page ceiling records how far back it
reached and RESUMES below that on the next `--all` run, so re-running it converges rather than repeating —
the run says which happened in its own notes.

Parallel is SAFE: each source writes only its own bronze files, its own per-source watermark
(`corpus/watermarks/<source>.json`), and (Slack/GitHub) its own thread/repo cursors — so two sources
finishing at the same moment can never clobber each other's resume state. If one source fails, the others
keep the progress they already committed. (Prefer this over `refresh --all-sources`, which runs the sources
sequentially in one process.)

Each run **streams human progress lines to stderr** as it works — relay the latest from each to the user each poll:

- a per-source **heartbeat** — `refresh slack · Reading channel · #<channel> · 63% · ETA 14m · 12,420 messages`
  (monotonic %, EMA-based ETA once there's real data, running counts);
- a **content preview** — a redacted taste of what's being read right now (`↳ #<channel> · "<snippet>"`);
- a `(stalled)` note if a source goes quiet for 60s (a wedged API call, not a crash).

Only the clean human lines stream by default; the machine-readable `slopweaver.progress` JSON lane is **off
unless** `SLOPWEAVER_PROGRESS_JSON=1` is set (for a programmatic consumer) — either way **stdout stays clean
for `--json`**. Every source resumes from its own (and per-repo) watermark, so a re-run only pulls what's new,
and because sources run independently, if one fails the others keep the progress they already committed.

For a day count use `--lookback-days N` (default 90 for Slack/Linear/Notion, 7 for GitHub, which resumes from
a per-repo cursor); for everything use `--all`; for an explicit start use `--since YYYY-MM-DD`. (A quick first
run — e.g. `--lookback-days 7` — is a fine way to watch it work before the full backfill.)

## 8b — If Gmail was pulled, scan the bronze the redaction wrote

`slopweaver audit hygiene --source gmail`. Mail is the most secret-shaped source here and nothing else ever
checks the redaction pass's OUTPUT — the repository gate enumerates `git ls-files` and never looks at
`$SLOPWEAVER_HOME`. Read its three arms correctly and tell the user which they are seeing:

- a **credential** (a token or key shape) is a secret the scrub missed. It exits non-zero. Show the user the
  locations and stop.
- an **identifier** (a raw workspace id, an absolute home path) is not a defect: it says who or where
  something is. Most are the corpus working — a chat notification email carries real channel and user ids
  in its links, and those become the record's cross-references. Reported with its locations, never gates.
- a **private-denylist word** is not a defect either, and must not be reported as one: a world model of
  their own organisation is supposed to contain that organisation's names. Reported, never gates.

It prints locations and never the matched text, because on a mail record the match IS the content. Do not
work around that by opening the record and pasting it back.
