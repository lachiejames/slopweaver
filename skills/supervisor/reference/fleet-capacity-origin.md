# Fleet capacity's origin — the measurement that sized the fill rule

The evidence behind [fleet-capacity.md](fleet-capacity.md) and [SKILL.md § 7a](../SKILL.md#7a-fill-to-measured-capacity--the-last-step-of-every-tick).
Read it before arguing that the daytime throughput drop was the defect, or that § 7a should cover more than a
quiet fleet with a ready queue.

## The measurement

The fleet sat at 8 workspaces on load 3 while the spawn queue held 8+ ready docs, and moved through about five of
the roughly 50 pull requests it could have moved through that day. The numbers below are what the repository says,
so the rule is sized to evidence rather than to an impression.

### The friction-first list, and what it cost

The ranked list is not a file — it is the `SPAWN QUEUE` line the supervisor rewrites into
`supervisor-state-21aug.md` each tick. Every distinct handover slug named across those lines from the ranking
onward is the list: **51 slugs**.

Reproduce it — the shell below scans every `SPAWN QUEUE` line the doc has ever carried and yields **52**,
one more than the ranked list because a bot-dogfood run was queued before the ranking and is not part of it:

```bash
grep 'SPAWN QUEUE' ~/.slopweaver/handovers/supervisor-state-21aug.md \
  | grep -o '[a-z0-9-]\{12,\}' | sort -u \
  | while read -r s; do [ -f ~/.slopweaver/handovers/"$s".md ] && echo "$s"; done
```

Landing, measured on the evening of the third day — a doc counts as landed only when a PR number it names is also a
squash-merge subject on its repo's base branch, so the anchor is a merged SHA and never the doc's own status:

| Outcome                                               | Count |
| ----------------------------------------------------- | ----- |
| Landed, merged SHA anchor on the base branch          | 29    |
| `done` with no merged anchor (proposal/research docs) | 7     |
| Still `ready`                                         | 15    |

29 docs landed through 28 distinct pull requests — one pull request closed two of them.

### Throughput, by time of day

Squash merges on the slopweaver `origin/main`, counted from commit subjects carrying `(#N)`:

```bash
git log origin/main --since='<day> 09:00:00' --until='<day> 20:00:00' \
  --pretty='%s' | grep -cE '\(#[0-9]+\)'
```

| Day   | 00–09 | 09–20 | 20–24 | day |
| ----- | ----- | ----- | ----- | --- |
| Day 1 | 15    | 12    | 5     | 32  |
| Day 2 | 15    | 20    | 7     | 42  |
| Day 3 | 17    | 8     | 0     | 25  |

**Overnight throughput is stable (15–17) and daytime is where the variance lives.** On day 3 the fleet did
not go idle in the daytime — it went ELSEWHERE: `acme/acme-admin` `origin/staging` took 10 fleet-authored
merges between 09:00 and 20:00, against 0 on days 1 and 2.

```bash
git -C ~/dev/acme-admin log origin/staging --author="$(git -C ~/dev/acme-admin config user.email)" \
  --since='<day> 09:00:00' --until='<day> 20:00:00' --pretty='%s' | grep -cE '\(#[0-9]+\)'
```

The author is the checkout's own configured identity — the fleet commits as the owner — so no doc names it.

Daytime total was 18 (8 slopweaver + 10 acme-admin) against 20 the day before. So the daytime drop is a
REDIRECTION toward live team-facing work, which the owner then called the right call — not the defect. The
defect is narrower, and § 7a is scoped to it: quiet fleet, ready queue, nobody spawning.
