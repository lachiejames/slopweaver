# The GCP audit-log read

`google audit-log` reads Cloud Audit Logs across a GCP organisation into a local generation under
`$SLOPWEAVER_HOME/atlas/gcp-audit/<generation>/`, and answers who called what from it. It is the evidence
behind any least-privilege change to a GCP principal: what was actually exercised, and what a plan removes.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" google audit-log pull --org <n> --quota-project <project> \
  --since <rfc3339> (--principal <email>... | --all-principals) [--role <role>...]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" google audit-log summary [--generation <id>] [--plan <plan.json>] [--json]
```

## Read-only by construction, not by credential

It rides the owner's Application Default Credential, whose `cloud-platform` scope cannot be narrowed for a user
login, so the read-only property lives in `src/gcpAudit/transport.ts`: a closed union of read operations,
each mapped to one method and path. The two POSTs are Google's own POST reads (`entries:list`,
`getIamPolicy`), and `src/__tests__/unit/gcpAudit/transport.test.ts` pins that list. Never reach GCP with raw
`gcloud` or `curl` for this; the hook refuses it, and this verb is the door.

## The claim boundary a summary carries

Every number is a count of DISTINCT stored events (`logName|timestamp|insertId`), dated by the window it
prints. Carry these with it, because each is a way "ever" stops being true:

- **Retention.** The summary prints every bucket's retention it saw. An entry older than the longest
  bucket that holds its stream is gone, and a bucket a sink fills holds only what arrived after the sink
  existed. The first-seen instant per stream is the honest "since".
- **Data-access logs are partial twice over.** Most services record them only where an audit config turns
  them on, and reading them needs `logging.privateLogEntries.list`, which `roles/viewer` lacks. Read the
  data-access stream's origins against where the reader holds that permission before calling a zero real.
- **Copies outside Logging.** A sink to Pub/Sub, Cloud Storage or BigQuery is a gap the manifest names by
  destination; a sink into a bucket of a searched container is read, since `entries:list` reads every
  bucket a container holds.
- **Refusals.** A container that refuses its logs is isolated by bisection and named; the pull still
  publishes, and exits 3 with `coverage partial`.

## Reading a plan against it

`--plan` takes a JSON plan (`src/gcpAudit/assess.ts` holds the schema): per principal, per organisation or
project scope, the roles kept, loose permissions kept, permissions denied, and its `basis`: `effective` when
the set is everything the principal will hold there, `direct-bindings` when a group or folder grant may add
more. A deny is a DEFINITE break either way, because a deny on the principal overrides every allow; a
permission merely absent from a `direct-bindings` scope breaks "unless another grant covers it", and the
summary says which. Only GRANTED uses are assessed (proto3 JSON omits a `false`, so a check with no `granted`
key is a refusal). A deny or a loose kept permission settles a use on its own; otherwise a kept role missing
from the generation's cache makes the use UNASSESSABLE, never a finding. Pull with `--role` for every role a
plan keeps.

Estate facts — which org, which buckets, what retention, which principals — are state: they live in the
generation and the knowledge register, never in this file.
