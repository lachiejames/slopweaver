# Proof is captured, never made

Bundled reference for the `github` skill, linked from [pull-requests.md](pull-requests.md)'s grades. It applies to
a pull request body in either repository and to any claim that a change works.

- **Proof is a real captured artifact.** Never self-generated, drawn or mocked up. A metric table a model wrote is
  not evidence: a Datadog-rendered screenshot is, and its header and image both link back to Datadog through a
  frozen citation carrying the exact window.
- **Captured means a capture verb wrote it, and its receipt says so.** Screenshots and recordings are both proof
  and go through the same door: `github attach upload` sends only a file whose bytes a capture receipt names
  (`browser shot`, `browser terminal-shot`, `browser console-shot`, `browser redact`, `proof cassette`), with its frame text scanned, its
  image checks passed and the upload fetched back, then prints the upload receipt (`upl-<uuid>`) a description
  cites ([attachments.md](attachments.md#only-a-file-a-capture-verb-wrote-is-sent)).
- **Gold shows the mechanism itself working** — a real CI run, a cache hit and its restore, a `yarn why` diff.
  Local timing and "the tests pass" are bronze at most. A slow or expensive pipeline is a problem worth fixing,
  never a reason for weaker evidence.
- **"Proven", "fixes prod" and "verified" each carry two things in the same response**: the absolute Datadog
  window and the same-seed evidence. With either missing, the claim says "evidence suggests" and names exactly
  what is absent, so the owner can act on it rather than re-check it.
- **How to take it without proving `main` by accident** — the launcher's plugin root, why a live run and a
  review pass are both owed, a self-addressed send venue, an invisible recording: [proof-gathering.md](proof-gathering.md).
