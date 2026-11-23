# The Google Cloud door (`slopweaver gcp`)

`slopweaver gcp` is how a seat reads and changes Google Cloud instead of raw `gcloud`, which the admit hook
refuses. It covers the operations seats were reaching for under `SLOPWEAVER_ALLOW_RAW=1 gcloud`: Cloud Run
describe and deploy, Secret Manager reads, creates, version adds, version disables and one-member grants,
service account create, API enable and Artifact Registry repository create. The how-to is
[the gcp skill](../../skills/gcp/SKILL.md); this page is what it may do and what it cannot see.

## What leaves the machine, and as whom

Every call goes to the Google API for its resource (`run`, `secretmanager`, `iam`, `serviceusage`,
`artifactregistry`) as the owner's
**Application Default Credential**, the one `slopweaver google adc` checks. No new credential, no service
account key, nothing under `$SLOPWEAVER_HOME/secrets/`. Every call carries `x-goog-user-project` naming the
project it acts on, so quota and billing land there (`src/gcp/transport.ts`). Redirects are refused and a
write is never retried: a write that timed out is not known to have failed. That includes the auth
library's own re-send of a request answered 401/403: a write takes its auth headers once and goes out through
the client's plain transporter, never the client's `request`, which carries that re-send.

What Google already holds is the only thing sent: a template, a policy, a secret payload you named by file.

## Additive by default

The owner expects GCP work to be almost entirely additive, because editing what already exists there is where
the main risk lies. Every planned step is classified by pure
code (`src/gcp/plan.ts`) from a fresh read:

| Step                                      | Class         | Why                                                            |
| ----------------------------------------- | ------------- | -------------------------------------------------------------- |
| create a service, secret, account or repo | additive      | it did not exist                                               |
| first version of a secret                 | additive      | nothing was reading `latest`                                   |
| enable an API                             | additive      | a disabled API serves nothing                                  |
| one IAM member, non-public                | additive      | the new policy is the old one plus exactly that member         |
| deploy onto an existing service           | edit-existing | traffic moves to the new revision                              |
| a version beside an ENABLED one           | edit-existing | `latest` moves                                                 |
| disable a version                         | edit-existing | whatever reads it stops                                        |
| `allUsers`/`allAuthenticatedUsers`        | edit-existing | on an existing resource it changes who can reach what is there |

An edit-existing step is refused with the `gcp-edit-existing` hatch until `--edit-existing "<why>"` is
given; the reason rides every step's door row as an acknowledgement, attached only when an edit is actually
planned, so a waiver never reads in the ledger where none was needed.

There is **no delete, no IAM removal, no project-level IAM** and no flag that sets a whole policy. A deploy
patches only `template` (`updateMask=template`), carrying every key it does not change verbatim, and refuses a
service with more than one container rather than guessing which to change. A grant against a policy Google
answered without an etag is refused at preview, so every grant on a resource that exists carries one. It re-reads the policy at
send time, refuses an etag that moved since the preview, and refuses unless the new policy is a strict
superset of the old: same version, same audit config, every prior member kept, exactly one added. An
additive version add re-lists the versions at send time and refuses if one was enabled since the preview,
because `:addVersion` takes no precondition and would otherwise move `latest` under an `additive` row. A
public grant on a service the same plan just created goes ahead only while that service reads at generation
1, which narrows — never closes — the window for another writer's deploy to be the revision it publishes.

## The approval

A write without `--approve` reads and prints its plan and a digest, and sends nothing. The digest is a
sha256 over the plan's VIEW — every resource as read, its etag included, and every request body — with two
substitutions: a secret payload becomes its sha256, and a Cloud Run env var's literal value becomes its
sha256. **An IAM grant is the one step digested as an action, not a body**: the resource, the one member, the
one role and the policy's etag as read. At send time it re-reads the policy, refuses if that etag moved, adds
exactly that member and role, and refuses a body that is not a strict superset of the policy it read
(`src/gcp/executeGrant.ts`). So the body sent is the approved policy plus the approved binding, never more. A
public grant on a service the same plan creates has no policy to read at preview, so its etag is absent and
nothing pins the generation-1 policy it extends (§ Residue). With `--approve`, the verb re-reads, re-plans and sends only if the digests match
(`src/gcp/approval.ts`); a mismatch is a door HOLD with no override. Each step then goes through its own
door request, so each is one ledger row.

## Secrets never reach a transcript

- A payload enters only through `--data-file`, opened without following a symlink and capped at 64 KiB
  (`src/gcp/secretFile.ts`). It is never in argv, never in the plan view, never in an error: transport error
  text has the payload replaced before it is returned (`redactedDetail`), and so has every literal env value
  a deploy carries forward, since Google may quote the body back. Every failure planning a payload write is cut
  against the payload read off its file, and a drifted answer that itself carries a payload or env values (an
  access, a service, a Cloud Run operation) has its validation detail withheld, since that detail names the
  answer's own keys (`callGcp`).
- `secret access` checks Google's CRC32C and prints length, sha256 and whether it ends in a newline. Its
  `--to-file` writes a NEW `0600` file and refuses an existing path, so it cannot overwrite a credential.
- `run describe` prints env vars by NAME, in text and in `--json`, and cuts their values out of Google's free
  text too, every condition message included (`src/gcp/redact.ts`). A deploy's plan carries those values,
  never digested, and every preview line and its `--json` document is cut against them, since nothing stops one
  being byte-equal to the image asked for. An `--approve` that is not digest-shaped is refused without being echoed.
  Everything a send hands back, each outcome and each failure, is cut against the same values, and so is a
  policy read's failure that follows a service read, and every line of a door hold on an approved write
  (`heldLines`). **The residue, stated**: the cut closes data flow, not coincidence. A value byte-equal to an
  identifier the door prints by design (its own env name, a role, a member, a resource name, a digest) or to
  argv validated before any read survives, because cutting those would mangle what a reader needs
  (`src/gcp/redact.ts` header). So does a door gate's own summary in the ledger row the shared door writes
  before the hold reaches this code, a profile-load reason say: no read value flows into it.
  **The sha256 is a confirmation oracle, bounded.** Printing a payload's sha256 lets a reader who already has a
  candidate value confirm it. That is the purpose — confirming the file is the one you meant — and it is only
  as strong as the payload is unguessable: a short, low-entropy value (a PIN, a dictionary word) is
  recoverable from its hash, so do not print one for a secret like that; a long random token is not.

## Residue, stated rather than discovered

- **The ledger records admission, not success.** Each step's door row is written before the call; the
  verb's own output (and `PARTIAL_WRITE`, naming the steps that landed) is what says it worked.
- **A version add still races** another writer in the gap between its send-time re-list and the send itself.
  The re-list narrows the window; nothing Google offers closes it.
- **A public grant on a service the plan just created races the same way**: another writer's deploy landing
  between the generation-1 read and the policy set is published by it, since `setIamPolicy` takes no
  generation precondition and a deploy does not move the policy's etag. Its `setIamPolicy` body is never in
  the digest, which binds only the one member and role it adds, since that policy cannot be read at preview.
- **A long-running operation** is polled for five minutes; past that the verb exits 4 with the operation
  name, and the change may still complete. Re-run the preview to see where it landed.
- **A template carrying an explicit `revision` name** would collide on patch; no service here sets one, and
  it is untested.
- **A patched template keeps `client: "gcloud"`** and the other client fields verbatim, so a deploy through
  the door still reads in the console as gcloud's.
- **Not covered:** `logging read`, listing secrets, project IAM, deletes. Each keeps the raw route, which the
  hook refuses with the generic cloud hint; `src/admit/rawGcloudRoute.ts` is the exact cover table.
