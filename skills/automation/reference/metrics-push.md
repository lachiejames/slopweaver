# A `metrics-push` row — push an install's own metrics to Datadog, a day at a time

The kind is generic on purpose: pushing custom metrics to Datadog on a schedule, with
backfill, is useful whatever the metrics are; which metrics an organisation pushes is its own business and stays
out of this repository. So the code runs a **metrics producer** the install declares and computes nothing itself.

## Declaring a producer — `profile.json`, never the row

```json
{
  "datadog": {
    "metricsProducers": {
      "daily-delivery": {
        "checkout": "/Users/me/dev/acme-metrics",
        "command": ["node", "produce.js"],
        "secrets": { "GITHUB_TOKEN": "github-token" }
      }
    }
  }
}
```

- `checkout` is an absolute path the command runs in; `command` is an argv, never a shell string.
- `secrets` maps an environment variable to a `$SLOPWEAVER_HOME/secrets/<name>` file, each a name the credential
  register declares (`slopweaver secrets status` lists them), so `secrets set` can write it. Those are the ONLY
  credentials the child gets: its environment is `PATH`, `HOME`, `TMPDIR`, `SLOPWEAVER_HOME` and these.
- The profile is an executable trust root: whatever it names runs as you. A row cannot name a command.

## The contract a producer keeps

It is launched as `command` plus `--day YYYY-MM-DD`, blocking, killed after ten minutes. Its LAST non-empty stdout
line is one `{ "series": [...] }` document in the shape `datadog submit` reads (gauges, and counts with an
`interval`); progress may precede it. Every point must fall inside the UTC day it was asked for, or the run is
refused and nothing is submitted, because the firing stamps that day as pushed. The `now`-stamped registration point
Datadog needs before it accepts backdated ones is a one-off `datadog submit`, never part of a daily run.

## The row

```json
{ "kind": "metrics-push", "params": { "producer": "daily-delivery" }, "effect": "read-write", "onMissed": "backfill" }
```

`params` is exactly `{ producer }`. A firing runs `datadog produce --producer <name> --day <slot day>` then
`datadog submit --series <file> --allow-late`; the file is kept under `$SLOPWEAVER_HOME/live/recipe/metrics-push/`.
`perSlot: true`, so a hole walks one day per tick ([exactly once](exactly-once.md)). Turn Historical Metrics
Ingestion on first with `slopweaver datadog hmi --metric <names> --enable`, or every backdated point is dropped.

## By hand

```bash
slopweaver datadog produce --producer daily-delivery --day 2001-01-01 --out ./day.json
slopweaver datadog submit --series ./day.json --allow-late --dry-run
```

An undeclared producer or an unstored secret exits `3` before anything launches; a failed run, bad output or an
unreadable profile exits `1`.
