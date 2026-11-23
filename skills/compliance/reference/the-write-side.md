# Changing something at Vanta — the door, the digest, and what is still the owner's

Vanta is a **doored provider** (AGENTS.md rule 3). Every write goes through `slopweaver write vanta` and
nothing else: not `curl`, not an MCP tool, and never a hand-driven browser — `browserSurface.ts` and
`no-private-browser-profile` are the tripwires, and **a block confirms you were wrong while its absence means
nothing.** The atlas is not an alternative route: it only ever reads, and several atlases declare
`refuse-every-write`.

## The eight verbs

| verb                                               | what changes                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `group-people --group <id> [--add …] [--remove …]` | who is in ONE group — which policies those people must accept       |
| `deactivate --ids <…> --reason <text>`             | stop monitoring findings — an ignore ruling on a compliance posture |
| `reactivate --ids <…>`                             | put deactivated findings back under monitoring                      |
| `create-document --title --description`            | a new evidence document                                             |
| `upload-evidence --document <id> --file`           | attach a file to an evidence document                               |
| `submit-document --document <id>`                  | submit it                                                           |
| `edit-policy-draft --policy <id> --find --replace` | ONE exact substitution in a policy draft, in the owner's own Chrome |
| `upload-policy-version --policy <id> --file`       | upload an edited policy's markdown as a **DRAFT** version           |

Read `--help` for the current flags rather than trusting this table's arguments; it is a map of what exists.

## Moving people between groups, and the one thing that verb cannot do

`group-people` exists because a card telling the owner to open Vanta and click through pages was a
capability gap, not a policy (the owner's ruling: the owner does not do that, the fleet does, and the only
things the owner does are provision API keys and sign in to things). It takes **person ids, never email addresses** — the
mapping happens in the read that composed the proposal (`atlas vanta read --kind person`), where it is
visible, rather than inside a write that would resolve an address differently after the approval was taken.

Three properties are the design rather than notes:

- **Both legs are BATCH calls that answer per person**, so a 200 means the batch was accepted and never that
  everyone in it moved. The verb reconciles the answer against exactly the ids it sent — by id, both ways,
  never by count — and any person refused, unanswered or answered twice exits non-zero.
- **The two legs are not a transaction.** Additions go first; a leg whose outcome cannot be READ stops the
  run and the later leg is reported `NOT ATTEMPTED`, not merged into a failure count. Nothing rolls back or
  re-sends — after a timeout the honest state is "we do not know", and recovery starts with a fresh read.
- **It cannot change which documents a group assigns.** The reviewed Manage API contract has no operation
  that does; `src/atlas/vanta/groupApiSchemas.ts` names the operations examined and how to re-check them.
  That is an absence in this API and says nothing about where else such a change could be made.

## Always `--dry-run` first, then `--approve <digest>`

The dry run prints **the bytes, not a description of them** — that is deliberate, because it is the only thing
standing between a composed batch and a real change to a compliance posture
(`src/atlas/vanta/writePreview.ts`). Proven end to end:

```bash
slopweaver write vanta create-document --title "x" --description "y" --dry-run
# write vanta create-document --dry-run: this request would be sent, nothing was
#   POST /v1/documents … {"cadence":"P1Y","description":"y","isSensitive":false,…}
#   to send exactly this request: --approve <digest>
#   the digest covers the method, the path and every byte of the body above; change any of them
#   and it stops matching
```

The digest is elided above on purpose: it is computed from the request, so a pasted one would go stale the
day a default changed and nothing would say so. Run the dry run and read yours.

So the digest is a **commitment to exact bytes**, not a confirmation prompt. Re-running the dry run after any
edit gives a different digest, and passing a stale one refuses. Never carry a digest between invocations you
have changed. An `upload-evidence` dry run never prints the file's bytes; it prints their count and SHA-256,
which the digest covers, so replacing the file under the same name stops the approval matching
(`shasum -a 256 <path>` checks the line).

**Two destructive operations have no preview anywhere** — `deleteUpload` and `deleteDocument`. That line is
not relaxed for a preview, and it is not relaxed for you either.

## A live write hands back a TOKEN, not the word “sent”

**Two of the three document writes print the id Vanta assigned**, because `sent` on its own cannot be checked
and a session that cannot check a write eventually repeats it. An `upload-evidence` names the upload id, its
stored title and media type, and the document URL; a `create-document` names the new document id.
`submit-document` answers with no object at all, so it prints `sent` alone — and so does any response the
schemas do not accept, because a token assembled from whatever fields an object happens to carry is exactly
the invented confirmation this contract exists to refuse.

```bash
slopweaver write vanta upload-evidence --document <id> --file report.pdf --approve <digest>
# write vanta upload-evidence: sent
#   upload <uploadId> — Manual Evidence (application/pdf)
#   https://app.vanta.com/documents/<id>
#   confirm it independently with `slopweaver atlas vanta sync`, then read the document-upload of that id
```

**The stored atlas is NOT a current answer about a write you just made.** MEASURED: a session
uploaded the pen-test renewal, the door recorded an `external-write` pass, and the atlas still said
the document had no such upload — because its generation, built after the upload, had not re-walked the uploads
sub-collection, last read hours earlier. The write had landed the whole time. A second upload was one step away,
and an evidence document that reads twice is a thing this door cannot take back. Read the token the verb
prints, and where you need independent confirmation run `atlas vanta sync` and check the `document-upload`
whose `providerId` is `<document>:<uploadId>`.

**A sync that did not complete leaves the old records standing, so absence after one is not absence.** The
walk preserves what it already held when a read fails rather than deleting it, which is the right call for a
store and the wrong thing to read as a verdict. Check `atlas vanta coverage --kind document-upload` for when
that sub-collection was last read successfully before concluding anything from a missing row.

## What is still the owner's own hand

`deactivate` is the one to be careful with: an ignore ruling changes what the organisation asserts to an
auditor, and reversing it does not un-assert it. `reactivate` is that reversal, and it is not free either:
the finding counts against its controls again, and deactivating it later records whatever reason and date
that new call carries, not the ones it replaced. Before proposing either, `atlas vanta test-entities --status DEACTIVATED` and `atlas vanta
vulnerabilities --deactivated` list what is already excluded and the reason each carries. Under rule 10 the criterion is whether it is obvious to a
session that knows the owner — a fleet-found, clearly-wrong finding is; a judgement call about what the
organisation is willing to claim is not. When it is not obvious, [card it](../../hand/SKILL.md) or
[page](../../page/SKILL.md) the owner, and either way record what you did with `slopweaver autonomy record`.

An **outbound** hatch is journalled rather than ambient (`slopweaver hatch open <id> --reason "<why>"`), so a
refusal you override on this path leaves a row naming this session.

## The one failure that reads as permanent and is not

A Vanta 401 can be a live race rather than a credential problem, because the Manage API allows one active
token per application. Do not conclude a write is barred from a single 401 — the measured evidence is a
knowledge row: `slopweaver knowledge recall "401" --domain vanta`.
