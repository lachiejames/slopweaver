# Reading the register back — recall first, list second

The full behaviour of the two read verbs [the knowledge skill](../SKILL.md) names. Read it when a search
comes back thin, when a filter is refused, or before proposing that a repeated lesson become a rule.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge recall "<the words the task mentions>" \
  [--domain <slug>] [--kind lesson|preference] [--learner <who>] [--limit <n>] [--offset <n>] [--json]
```

`recall` is full-text search over the **memories table** in the local Supabase, and it is what the owner's
steer asks for by name: a session doing a task about Datadog queries the memories table in the local Supabase
for the word Datadog or similar and reads everything that comes up, early in the work. Retrieval is
thinking back, so run it at the START of a task, on the nouns the task actually names.

It ranks claims, not recordings: a claim's LATEST recording is selected before the search runs, so a newer
`refuted` row can never be hidden by an older `confirmed` one that scored better. Search **stems** and has
no synonyms — a thin page means ask again in the words the row would have used, never that nothing was
learned. An unreachable store is a non-zero exit, never an empty page.

**A retired claim is never on the page.** A claim is retired when a recording naming it in `supersedes` is
later, by `(recorded_at, seq)`, than the claim's own latest recording; `recall`, `list` and the quiz all
hide it, and the replacement's page shows `retires: <id>`. `list` drops it BEFORE its facet filters, so a
`--domain` narrower than the replacement's cannot bring it back.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge list [--domain <slug>] [--tier 1|2|3|4] \
  [--verdict <v>] [--surface <s>] [--run <slug>] [--repeats] [--json]
```

`list` is the facet and repeat view over the same table. `--learner owner` is the owner's side and
`--learner fleet` is the fleet's; unfiltered shows both, each row labelled.

**Read the register BEFORE investigating a system, not after.** That is the whole point: the second ask
should be smaller than the first. Start with `--domain <slug> --tier 1` and work down.

**A filter typed outside its vocabulary REFUSES.** `--verdict confimed` names the whole vocabulary and exits
usage rather than quietly reading the register unfiltered: a filter that silently does not filter is a check
that cannot fail.

`--repeats` is the consolidation view, and it is the owner's own trigger: when several agents
have the same lesson, it is time to turn that lesson into a standing rule or make the mistake structurally
impossible, so a future agent never repeats it. It ranks by DISTINCT RUNS rather than raw count, because two recordings from one run
is a session writing twice while two runs is two sessions having independently learned the same thing. When
a row shows several runs, propose promoting it — to a gate in the repo where one is possible, to a rule where
it is not — rather than leaving it to be learned a fourth time.

## What `--learner` changes about reading back

Three consequences of the learner facet, each mechanical rather than a convention:

- **The owner's row and the fleet's for one claim share an id**, because `learner` is not hashed into it. That
  is deliberate and load-bearing: a second recording of the same claim is the same belief at a later date, and
  the verdict moving between them is the series the owner asked to be able to look at.
- **So `--repeats` defaults to `--learner fleet`.** Counting both sides together would report a lesson two
  runs learned independently when exactly one fleet session ever learned it. An explicit `--learner` wins,
  including `--learner owner --repeats`, which asks which of the owner's own beliefs the owner has stated twice.
- **A row of the owner's does NOT answer the run-closing question.** The settle gate asks whether the RUN
  learned anything; writing down something the owner said is not that, and counting it would be the filler that gate
  refuses.
