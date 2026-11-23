# A capability row READS the generation instead of declaring what it holds

Part of [Atlases](../atlases.md).

The other half of the same ruling — a capability profile that reads answerability — and it closes a gap every
publish-side fix leaves standing. MEASURED on the live install: `capability-profile.json` held
**29 rows with `sourceClass: atlas`, every one `truthMode: current`, `availability: available`**, while
nothing in `src/route/` read a manifest, a coverage cell or `kit/answerable.ts`. Whatever a sync acquired,
every row kept advertising itself as current, available truth. The live instance was `atlas doctor` reporting
`vanta ANSWERABLE 4419 entities` while its `audit` kind — `authoritative`, in `atlas/vanta/inventory.ts` —
had `lastAttempt: null` and had never been acquired at all. Count the rows on any install:

```bash
python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.slopweaver/capability-profile.json')));print(sum(1 for c in d['capabilities'] if c['sourceClass']=='atlas'))"
```

`src/route/atlasReading.ts` decides what a row should advertise and touches no disk;
`src/route/atlasReadings.ts` performs the reads and grades them, opening only the platforms a row actually
names. `route plan` and `turn brief` both grade before they plan.

**Every registered platform has a row**, so "the platforms a row names" is the whole
registry: `src/route/atlasCapability.ts` derives one row per `atlasPlatforms()` entry rather than waiting for
somebody to hand-author one, suppressed only where an existing row already reads that platform. The grading
above is unchanged and is still what decides what each row advertises. MEASURED, the gap it
closes: 24 of 37 registered atlases had no row at all. Reproduce the class on any install by comparing the
two lists:

```bash
slopweaver atlas doctor --json            # every registered platform, and how each grades
slopweaver route plan --question "what does this build hold" --json | grep '"id"'
```

- An `unpublished` or `dark` atlas becomes `availability: unavailable` and its command is CLEARED — the
  capability schema refuses an unavailable row that still carries a runnable command, so a plan cannot invoke
  what it has just called unreachable.
- An `answerable` atlas keeps its declared coverage unless the generation has a gap, and a gap is reported in
  two SEPARATE clauses: surfaces the credential is not permitted to read ("reachable if the permissions are
  widened, not missing") and surfaces never acquired for any recorded reason. That separation is the ruling
  above, at the routing layer.
- **`truthMode` is left exactly as declared.** An atlas is a current-truth source by kind, and a mostly-empty
  one is a current-truth source that cannot answer much. Rewriting it to `history` would make an empty atlas
  outrank the world model on a history question — a second, worse dishonesty.

## A capability row also has to be able to RUN its own command

The same class one layer down, and it survived the grading above because that grading only ever asked what a
row's atlas held. MEASURED on the live install: the `telemetry` row declared itself `available`
and named `yarn work-console datadog reach --about {question} --json`, while its own `freshness.detail`
advertised a `--drill` flag as "a separate live metered act". There is no `work-console` script in this
repository's `package.json`, no `work-console` executable on the host, and `slopweaver datadog` has never
carried a `reach` verb or a `--drill` flag. `turn brief` prints the winning row's argv into the brief as the
way to reach that source, so two of the owner's own asks were dispatched that day telling a worker to spend a
`--drill` that does not exist; both workers corrected it themselves and reached Datadog through the
`slopweaver` verbs. Reproduce the class on any install:

```bash
slopweaver turn brief --contracts --text "datadog log retention" | grep -B4 'yarn work-console'
```

`src/route/commandReading.ts` decides what a row should advertise and touches no disk;
`src/route/commandReadings.ts` performs the lookups, one per DISTINCT KEY the table depends on. `route plan`
and `turn brief` both grade before they plan, and before the atlas grading — a row that cannot run is refused
whatever its generation published.

- **The grading is three-way, and that is the design rather than caution.** A refusal is only safe where the
  namespace searched COMPLETELY answers the question. `yarn <token>` is resolved against all three things Yarn
  itself would try, in Yarn's own order — the `scripts` block, `node_modules/.bin`, then Yarn's own commands —
  and the filesystem completely answers an ABSOLUTE path, so a miss in either is `missing`. `PATH` is not the
  whole of what a bare name resolves to in the host's shell, and a RELATIVE path resolves against the cwd of
  whoever runs the row rather than this process's, so a miss in either of those is `unprovable`. Checking only
  `scripts` was the first draft and it would have refused working `yarn dlx …` and `yarn node …` rows.
- **`unprovable` is measured, not hypothetical.** On this install `rg` is on none of the 25 `PATH` entries and
  no ripgrep binary exists anywhere, because Claude Code defines `rg` as a shell FUNCTION — and the profile's
  `claude-artifact-index` row runs `rg …` successfully every time a session runs it. Refusing it would have
  deleted a working history leg to close a hole it was not in. An `unprovable` row stays runnable and carries
  the doubt in its own `coverage.detail`, where a reader sees it.
- **A `missing` row becomes `availability: unavailable` and its command is CLEARED**, for the same reason the
  atlas downgrade clears one — and because the cleared argv is precisely what stopped being printable into a
  worker's brief.
- **A row is graded on EVERY key it depends on, including inside a `bash -c` string.** A `["bash", "-c", "…"]`
  row graded on `bash` alone hides what it runs: this install's `github-vulnerability-evidence` wrapped two
  `yarn work-console` calls that way and planned as `available` for live vulnerability questions while being
  unable to run a line of itself. A shell head's `-c` argument is read for
  `yarn <token>` pairs and each is graded by the rule already written for that shape, which buys no new
  namespace and needs no shell parser: `yarn <token>` is one of the two shapes above that a `missing` verdict
  is already licensed on. One row therefore yields several keys and the WORST verdict among them decides it,
  with every key holding that verdict named in the sentence the row carries.
- **What is still outside it, stated rather than discovered**: a `-c` script that changes directory or
  carries a heredoc, which yields NO keys at all and grades on its head alone — a `cd` moves the tree the
  `yarn` after it resolves against and a heredoc body is data rather than commands, so in both the
  completeness a `missing` verdict rests on is false and the refusal would be too; anything in the shell
  string that is not `yarn <token>` (that row also piped through `python3`, and a bare name is
  `unprovable` even at the head, so reading it would add doubt rather than evidence); a `yarn` token carrying
  a shell expansion, which names something only the run knows; and a verb or flag the resolvable executable
  does not accept — an argv headed by `slopweaver` resolves on the launcher alone, so the nonexistent verb
  and flag in the row above would have been invisible here had the row named that launcher rather than a
  script nothing declares.
