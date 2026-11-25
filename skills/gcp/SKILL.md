---
name: gcp
description: Read and change Google Cloud through the door instead of raw `gcloud` — describe a Cloud Run service and who may invoke it, deploy a new service or a new revision, read a Secret Manager secret's versions and grants, check a payload by length and sha256, create a secret, add or disable a version, grant one IAM member on a secret, create a service account, enable an API and create an Artifact Registry repository. Every write previews first and is sent only with the digest that preview printed; a write that changes something already there also needs `--edit-existing "<why>"`. Use when a seat would reach for `gcloud run deploy`, `gcloud secrets versions add|disable|access`, `gcloud iam service-accounts create`, `gcloud services enable` or `gcloud secrets add-iam-policy-binding`. Phrases like "deploy this image to Cloud Run", "rotate that secret", "is that service public", "add a secret version", "create a service account for it", "enable the API".
argument-hint: "run describe|deploy | secret describe|access|create|add-version|disable-version|add-iam-policy-binding | service-account describe|create | services describe|enable | artifacts describe|create — then --project P and the action's flags"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" gcp $ARGUMENTS` and report the result.

## The one rule this skill exists to hold

**The door is additive by default.** Existing
resources in GCP are not edited, since that is where the main risk lies; the work is almost entirely additive.
So every planned step is classified, and the class is printed beside it:

- **additive** — a new service, secret, service account or repository; a first secret version; enabling an
  API; one IAM member on top of a policy whose every other grant is kept.
- **edit-existing** — a new revision on a service that already runs; a version added beside an ENABLED one
  (so `latest` moves); disabling a version; a PUBLIC member (`allUsers`, `allAuthenticatedUsers`) on a
  resource that already existed.

An edit-existing step is refused with the four-line hatch refusal until the call carries
`--edit-existing "<why>"`. The reason rides every step's door row as the `gcp-edit-existing`
acknowledgement, so an edit is findable in the ledger afterwards. Never put a reason there the owner did not
give; a rollout or a rotation the owner asked for is the case it exists for.

Raw `gcloud` is refused by the admit hook. A `gcloud` call this door performs is pointed here by name
(`src/admit/rawGcloudRoute.ts`); anything else keeps the generic cloud break-glass.

## Preview, then approve

```bash
slopweaver gcp secret disable-version --project acme-security --secret acme_desktop_vanta_client_id --version 2
#   gcp secret disable-version on projects/123456789012/secrets/acme_desktop_vanta_client_id/versions/2 — PREVIEW, nothing was sent
#     1. [edit-existing] disable projects/123456789012/secrets/acme_desktop_vanta_client_id/versions/2 — anything still reading it stops working
#   digest: gcp-99037432b56098f0
#   to send exactly this: slopweaver gcp secret disable-version ... --approve gcp-99037432b56098f0 --edit-existing "<why>"
```

Without `--approve` a write only READS and prints the plan. With it, the verb re-reads everything, re-plans,
and sends only if the fresh plan's digest equals the one given — the digest covers every resource as read,
its etag included, and every request body. A stale digest is a door HOLD (`gcp.write-unapproved`), with no
override: run the preview again and approve what it shows now.

| Exit | Means                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------- |
| 0    | read printed, preview printed, or every step sent                                                     |
| 2    | the invocation is not one (`INPUT_INVALID`) — a flag the action does not take, a bad name shape       |
| 3    | `NO_CHANGE` (already there), `NOT_FOUND`, the edit-existing refusal, or a door hold                   |
| 4    | a long-running operation still running after five minutes (`OPERATION_DEFERRED`) — re-run the preview |
| 1    | Google refused or the call failed; `PARTIAL_WRITE` names the steps that DID land before it            |

## The reads

```bash
slopweaver gcp run describe --project P --region R --service S          # image, SA, env NAMES, URL, ready revision, IAM
slopweaver gcp secret describe --project P --secret S                   # every version's state, and its IAM
slopweaver gcp secret access --project P --secret S [--version N]       # length, sha256, newline — never the bytes
slopweaver gcp secret access --project P --secret S --to-file PATH      # the bytes, into a NEW 0600 file
slopweaver gcp service-account describe --project P --email EMAIL
slopweaver gcp services describe --project P --service run.googleapis.com
slopweaver gcp artifacts describe --project P --region R --repository REPO
```

Every action takes `--json`. A Cloud Run env var is printed by NAME only, in text and in `--json`; a value
never reaches stdout.

## The writes

```bash
slopweaver gcp run deploy --project P --region R --service S --image IMG [--service-account EMAIL] [--remove-env K1,K2] [--allow-unauthenticated]
slopweaver gcp secret create --project P --secret S [--data-file PATH]
slopweaver gcp secret add-version --project P --secret S --data-file PATH
slopweaver gcp secret disable-version --project P --secret S --version N
slopweaver gcp secret add-iam-policy-binding --project P --secret S --role ROLE --member MEMBER
slopweaver gcp service-account create --project P --account-id ID [--display-name N] [--description D]
slopweaver gcp services enable --project P --service API
slopweaver gcp artifacts create --project P --region R --repository REPO [--description D]
```

- **A payload comes from `--data-file` only**, never argv. Its exact bytes are sent, a trailing newline
  included, with a CRC32C Google checks. The preview names its length and sha256 so you can confirm it is the
  file you meant; the digest covers that sha256, never the bytes.
- **A deploy carries every other template key over unchanged** — env, secrets, scaling, probes, volumes. It
  changes the image, the service account if given, and drops each `--remove-env` key (each must exist). A
  service with more than one container is refused.
- **An IAM grant re-reads the policy at send time** and refuses unless the etag is the one the preview read and
  the new policy is the old one plus exactly one member.

## What it does NOT cover, said rather than discovered

Semantics, residue and every boundary are in [the gcp door](../../docs/security/gcp-door.md). The short list: no delete, no
project-level IAM, no `logging read`, no list of secrets, no IAM REMOVAL; the door ledger records each step's
admission, and the verb's output is what says it landed.

## Ending

Report the classes, the digest and, for a sent write, each step's outcome line. A run that changed something
existing names the reason it gave.
