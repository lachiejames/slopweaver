---
name: compact
description: Compact bronze — merge each source's overlapping window files into one deduped canonical file, and heal Notion attachment and body refs redact's digit pass carved up. Use when the user asks about corpus size or disk use, or after many overlapping refreshes have left duplicate window files behind. Phrases like "compact the corpus", "the corpus is huge", "how much disk is this using", "dedupe the windows".
argument-hint: "[--source github|slack|linear|notion] [--older-than <N|Nd>] [--json]"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" compact $ARGUMENTS` and report the before→after record count, file count, and on-disk size, plus how many cross-window duplicates were collapsed. It is lossless by default for every well-formed record: only records the corpus writer's own fingerprint says are duplicates are dropped, and watermarks/thread cursors are never touched, so the next `/slopweaver:refresh` still resumes from exactly where it would have.

It also RE-KEYS a Notion row whose `sourceId` spells its page id undashed (`page:<32hex>`) onto the dashed id the API writes, so the two spellings of one page become one identity and a re-pull supersedes it. Content, timestamps and every version survive; if the notion line reports a `re-keyed` count, say it.

If the user passed `--older-than`, say plainly how many records were AGE-PRUNED — that mode deletes records past the horizon. If any row was REJECTED (well-formed JSON that fails the required-field gate — e.g. a CODEOWNERS row with no natural timestamp, or a genuinely empty page), say the count and, if asked, point at `rejectedSamples` in `--json` output for the exact `path:line`; it is dropped rather than sinking the whole source. If any source FAILED, name it and say it was left UNFINISHED — never partially lost. A source fails either before rewriting anything (a line that isn't valid JSON at all aborts it, since that makes the whole FILE suspect) or after the canonical file landed but a superseded file could not be removed. Re-running completes it.

If a source was SKIPPED because a refresh or compaction of it was already running, name it: it was left untouched, never rewritten under a live writer, and running this again after that writer finishes compacts it. When every source was skipped the verb exits 4 (not yet); otherwise it reports the sources it did compact. The `compact-corpus-daily` standing row already runs this losslessly every night at 02:30, so a hand run is only for right now.

A run killed mid-write (a signal runs no cleanup) leaves its staged `compact.jsonl.<pid>.<uuid>.tmp` behind —
two such leftovers once held 20.4 GB. Each run first unlinks every staged file of its canonical file whose writer
pid no longer runs, under the source's slot, and leaves a live pid's alone. If the report names staged files
swept, say how many bytes came back; they held no record, so they sit outside the before→after figures.

Suggest running `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" audit` before and after to see the reduction.

## `compact heal-refs` — Notion refs the digit pass carved up

Once, redact's `\d{9,}` pass rewrote digit runs inside a 64-hex digest to `[number]`, so some Notion
records name an attachment or body by a digest no file has (`attachment: sha256:<hex>[number]<hex>… (515573
bytes)`). The bytes were stored under the real digest, so `compact heal-refs` reads them back: exactly one stored
name matching the pattern, re-hashing to itself, and the recorded byte count, or the ref is refused and left
alone. It heals only the latest version of each record, calls no provider, and runs dry unless `--apply`, which
takes the census under Notion's refresh slot (so a sync cannot supersede a target mid-heal), appends the healed
rows through the bronze writer and re-runs the census, exiting 1 if anything is still damaged. Report the census
line, each healed record, and every refusal by its code.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
