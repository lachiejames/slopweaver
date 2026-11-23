# Dynamic planning — how a turn investigates

The investigation half of [SKILL.md](../SKILL.md) step 2, after the tier is judged. Judging the tier is ONE
decision and it is already agent judgement rather than a term match
([investigating.md](investigating.md)); this page is the part that comes after, and it is not a decision at
all — it is a loop.

**How a turn should answer a question about a named colleague:** there is never a finalised plan. It is all
dynamic, the way experts work — tugging on different threads and knowing when to reject information versus
where to search elsewhere. The turn looks at everything available, plans what it will do, and replans each
time it acts.

## The rule

**There is never a finalised plan.** Survey what is reachable, plan the next move or two, make them, and
**re-plan on what actually came back** — including a move that returned junk, which is itself information
about where the answer is not. A turn that writes a plan up front and then executes it to the end has
already lost the property: the whole value is in changing course on a return.

Two failure shapes this rules out, and both look diligent:

- **Announcing a plan and finishing it.** The returns are then decoration; nothing you found could have
  changed what you did next.
- **One query, then compose.** A single question to the world model is a lead, not an answer — see move 2.

## The six moves

They are an ordering, not a pipeline. Skip one you can justify skipping, and re-enter an earlier one the
moment a return points back at it.

### 1 · Survey, then plan — never finalise

`turn brief` already printed what this context can reach: the available/unavailable capability inventory and
the SKILLS block ranking every skill this build and each declared checkout carries. `slopweaver catalog`
prints the whole verb surface. Read both, then say to yourself where the answer most likely LIVES before
reaching for anything.

The worked example is the calibration: for a colleague's top pain points, the answer lives in the corpus
and the world model — spread across Notion, GitHub, Linear, Gmail, meeting transcripts, maybe Drive — and
**probably not in the atlases, and nothing to do with the supervisor loops.** An atlas maps a vendor's
surface; it holds no colleague's frustration. Reaching for one here is the survey being skipped.

### 2 · Probe the whole store for COUNTS, then fan out detectives on what it found

One question gets one ranked slice, and a ranked slice is what this move stopped being. The world model is reached by an INVESTIGATION — no embeddings, no pgvector, no re-ranking, no
semantic search. The procedure, the diagram naming who spawns what and the measured shape counts are in
[detective-fanout.md](detective-fanout.md); the short version:

1. Derive literal entities, identifiers and aliases from the question and thread, plus oblique vocabulary —
   the words people use while LIVING a problem, rarely the words used to ask about it. Lead-generating
   examples: where is the pain, where are the repeated efforts, where is the money going.
2. `slopweaver store probe <keyword> …` over the WHOLE store — about a second for a count of each of the
   seven shapes per keyword, its source split, and the ids of anything narrow. Read where it COLLAPSES.
3. Fan out one Haiku detective per `(keyword, source)` lead, plus one discovery detective, in process. The
   number is counted rather than chosen — four for three leads, eight for seven, thirty for twenty-nine.

**The store is the first place, not one option among several**, because the atlases and
corpuses live in the local Supabase store rather than in local markdown files. Your own `turn brief`
says whether it can be reached — read the HISTORICAL section, which carries the exact command, what the
store holds right now, and the reason when it cannot be reached. A row marked UNAVAILABLE there is the one
case where move 3 leads.

**`slopweaver store read` and `slopweaver store cite` are the SECOND opinion now, not the first.** They
still pin evidence and they keep the person lens — `--person <name|handle|email>` resolves a human to their
Slack member id, Linear UUID and GitHub login at once and filters on the resolved person rather than on the
string, and a name that reaches nobody is a REFUSAL carrying the closest names the store holds rather than
an empty page. Without it, a name in the question text is just more query terms and the slice comes back
cited and about the wrong people.

**But the ladder is what the person lens cannot give you**, which is why the probe leads. MEASURED:
a colleague's surname reaches a few dozen rows through `exact` and thousands through `wild-both`, because
`to_tsvector` tokenises on punctuation and the name sits inside an address, a mention or a URL. A
`--person` filter narrows a population; it cannot widen the one the index could see. Reproduce all three:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" facts --help   # --person, --source, --since, --until
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store query --person "<name>" --limit 5
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store probe "<name>"   # the shape ladder, which is why it leads
```

### 3 · Search the corpus files yourself — the FALLBACK, and say when you took it

The org world model is not the only way in: the corpus files can be searched directly, because they are just files.

**This move is a fallback now, not a peer of move 2**, and most of what it existed for is move 2's job: the
store holds the same records with an author lens, a container lens, seven search shapes and a thread walk,
and answers in about a second. The corpus lives in Supabase, so a history question goes to
the store first and reaches for the files only when one of these is true — and your answer says WHICH:

- your `turn brief`'s HISTORICAL row reads UNAVAILABLE, and it carries the reason;
- the store is reachable but its coverage names a gap this question sits in (`slopweaver store status` is
  what it holds; `slopweaver store ingest --source <s> --limit 500 --all` is what fills a source);
- the store answered and its returns were junk, judged by move 4 rather than by impatience.

"I searched the files because the store had nothing" is a real and useful sentence. "I searched the files"
with no reason is the failure mode.

The corpus files are plain files. Bronze is line-delimited JSON on disk under
`$SLOPWEAVER_HOME/corpus/bronze/<source>/`, one record per line, each carrying `source`, `author`,
`container`, `tsIso`, `text`, `url` and `refs`. That gives you the lens the world model does not have —
**filter by author, then by vocabulary**:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" identity resolve "<name|handle|email>" --json   # name -> per-source ids
rg -I --no-messages '"author":"<theirSlackId>"' "$SLOPWEAVER_HOME/corpus/bronze/slack/" \
  | rg -i 'blocked|blocker|painful|frustrat|keeps happening'
```

**`-I` is not optional, and neither trap it guards announces itself.** Without it `rg` prefixes each hit
with `<file>:`, so every line you then parse as JSON dies on a leading path. And on this machine `rg` is a
**shell function, not a binary** — `command -v rg` prints `rg` while `command rg --version` says _command
not found_ — so a child script, or any invocation that bypasses the interactive shell, returns zero hits in
a fifth of a second and looks like speed. Verify a scan returned something before you believe a zero
(`.claude/rules/testing.md`'s falsifiable-witness rule, applied to your own tooling).

MEASURED on this install (both commands above, `time`d): the author filter alone crosses **several
gigabytes** of Slack bronze in **under a second** and returns over ten thousand records — far too many to
read — and intersecting it with a pain vocabulary narrows that to **a few hundred** in under a second. Re-measure with
`du -sh "$SLOPWEAVER_HOME/corpus/bronze/slack"` and the two `rg` lines. **Speed is not the gap; the LENS
is**, which is why this move comes after the store's: `store query --person` resolves the human
across every platform at once, and `store probe` fans the seven shapes, where the `rg` pair above filters
one source by one id it was handed. Use the store's lenses and come here for reach.

Keep the search **line-oriented, in every language**. A corpus file is read by `rg -I`/`ugrep` over its
lines, or by `readJsonlLines` (`src/corpus/corpusStore.ts`) in code — never loaded whole: not `json.load`,
`f.read()` or `readlines()` in a Python heredoc, not `jq -s`, not `readFileSync`, not `$(cat …)`. The
`whole-file-json` gate refuses the shape in TypeScript (`.claude/rules/typescript-patterns.md`) and sees
nothing you type into a shell. MEASURED: a bot turn's `python3 -` heredoc loaded the
multi-gigabyte Slack `compact.jsonl` whole, reached a footprint of tens of GB with the machine at its 12-swapfile hold — the class
of an earlier kernel panic — and was killed by hand. `slopweaver machine capacity` names the session
that owns such a child; reproduce the file's size with `ls -l "$SLOPWEAVER_HOME/corpus/bronze/slack/"`.

**What this move gains in reach it loses in curation, and that is the trade to state in the answer.** A file
scan has no ranking and no synonymy, and it **re-admits every record the index deliberately drops**:
`$SLOPWEAVER_HOME/sync-author-denylist.txt` stops a listed identity being ingested or indexed — everywhere,
or in one named channel — and never deletes their existing bronze rows (`src/corpus/syncExclusion.ts`), so a
raw scan surfaces exactly the traffic somebody chose to suppress. Read that file before you treat a large hit
count as signal, and note that a denied alert humans replied under is deliberately still there: rule D keeps
the parent of any thread a non-bot spoke in.

### 4 · Judge the returns, and discard junk

When an answer comes back as junk, the turn says it looks like junk and disregards it.

**Rejecting a return is a move, not a failure**, and it is half of expert behaviour. A
ranked slice is ranked by similarity, which is not relevance: a record can be the top hit and still be
somebody else's conversation, a bot's own posting, or the right words in the wrong year. Say in your own
head why each kept record earns its place, and drop the rest without ceremony.

Then **re-plan**. Junk from the direct query while move 3 turned up something real means the corpus is the
richer seam for this question — go back to move 3 and widen it, rather than re-phrasing the corpus
query a fourth time.

### 5 · Follow the links, and read provenance as evidence

Two separate things:

**Follow them.** A record's `refs` field carries the URLs its text linked to, and it is populated — measured:
nearly half of the first 20,000 Notion bronze records carry at least one. A Slack message that links a
Notion page is an instruction to go read that page, and then to see what THAT links to. Read one with
`slopweaver notion` or the corpus record it already has; a Linear or GitHub link goes through `slopweaver
linear` / `slopweaver github` per the one door.

**Read who raised it.** A record's provenance can be the finding on its own.

**A record is more informative the more unusual it is that this person produced it.** Someone who files a ticket every day filing another one says nothing; someone who
has filed two in a year filing a third is a signal worth a sentence in the answer. You can check that
cheaply — count their records of that kind in bronze before you claim it.

Do not traverse everything. Follow a link when the return you already have makes it likely to pay, and stop
when it stops paying — that judgement is the move.

### 6 · End on quotable sources

> each of those can probably link to other things … all these different like bits of information now that are
> essentially quotable in sources and also can be linked to as a citation as all things to back up whichever
> answer it finally gives

Every claim in the answer carries the record it came from, and a direct quote beats a paraphrase wherever
one exists. The outbound form already enforces grounding, so this is not a new gate — it is the reason the
five moves above exist: they are what makes a citable answer possible rather than a fluent one.

Two standing limits from [SKILL.md](../SKILL.md) bind here unchanged and are worth re-reading before you
compose: **never force a connection you cannot prove** — a shared word is not a link between a finding and a
person, a ticket or a release — and **state what you could not prove**, including which threads you pulled
and abandoned. A turn that says "I checked X and Y and found nothing there" is more useful than one that
quietly omits them.
