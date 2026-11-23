# The pull-request form — what runs, what you may edit, and what CI will reject

You fill a typed form and code emits the bytes. This page carries the pipeline each verb runs, the partial-edit
contract, the two overrideable policy locks, and the constraints the renderer enforces so CI cannot reject you.
The rule — never hand-write a body, never resend a whole form to change one field — is in [SKILL.md](../SKILL.md).

## What actually happens when you run it

**push** — `parse → inspect local branch → read remote default + target SHA → plan → [dry-run stops here] →
door → git push → read remote target SHA → confirm`.

**stack adopt** — `parse → read git + live PR facts → authorise → plan → [dry-run stops here] →
[operation lock] → door → re-confirm freshness → rebase → push → register (local ledger, then native) →
warn on lower unregistered entries → report`.

**stack adopt --register-only** — `parse → read the repo slug + remote default → read the child → resolve the
parent → authorise → plan → [dry-run stops here] → [operation lock] → door → re-read + replan → native write
→ read back and CONFIRM → local ledger → report`. No symbolic HEAD, no `git status`, no commit count, no
rebase and no push: the mode dispatches BEFORE those reads, and native registration comes BEFORE the ledger
so the only possible partial outcome is the recoverable one.

**create** (the half of `stack push` that opens the pull request) — `parse → validate (retired fields refused by
name) → render + gate → [--dry-run stops here] → token → write preflight → door → reserve → create → read back →
confirm → kind labels → report`.

**update** — `parse → token → address → identity → authorship → recover the form (or take the whole one) →
merge → render + gate → re-append any third-party block → replacement preview → [--dry-run stops here] →
door → RE-READ → PATCH → read back → kind labels → record`.

**No byte depends on the day it is written**: the door adds no stamp, so a round trip is a no-op. The day is read only
to refuse a problem marked seen after it (`stampForWrite`, `stamp.ts`).

`stack push --dry-run` sends nothing, and prints the exact body bytes and CI's `pr-format` verdict on them: the
shape check, the secret scan over title and body with your hygiene denylist, and the publication scan
(`PublicationScan`, the port `renderAndCheck` runs in `src/cli/commands/github/prRenderGate.ts`) with the
installation's private terms. Every live `stack push` and `pr update` refuses on it before the write, so a
credential never reaches GitHub, and refuses outright while the private-terms file is absent or malformed
([private terms](../../../docs/security/hygiene-gate.md#private-terms-on-outbound-writes)).

Off this build's own repository and its source address, the door forgives the installation's OWN identifiers from
`$SLOPWEAVER_HOME` (team keys `linear states --team <KEY>` recorded where Linear reported the organisation's current
workspace, that workspace, the profile's names), so `feat(ABC-12): …` goes through; a foreign one on the line, a
credential, and CI's scan stay refused ([`installationIdentifiers.ts`](../../../src/hygiene/installationIdentifiers.ts)).

`update --dry-run` **resolves a token and performs GETs**, never a PATCH or the door: the number, authorship, the
parse and what a replacement would discard all need a read, and a preview blind to what it previews is worse than none.

The second read, immediately before the PATCH, is not redundant. GitHub offers no conditional update for a body, so
the window is kept to one round trip and re-checked: description, title, author, state and **head commit**, since
a force-push inside it would publish proof gathered on a head that is no longer the one under review.

Outcomes worth recognising, because two of them are the verb working rather than failing:

- **`opened #<n>` / `updated #<n>`** — done, and verified by read-back.
- **`refused: … is already reserved by #<n>`** — the duplicate guard, keyed on the BRANCH LOCUS (repo, base, head),
  never the content, so a retry whose form changed slightly cannot open a second pull request.
- **`UNCONFIRMED: …`** — the reservation is held and this invocation did not retry. **Run it again**, never `rm` the
  ledger record: a create whose POST died records no number, so the settling read goes to the BRANCH PAIR instead.
  Zero releases the reservation, exactly one adopts that number (an open one still guards, a closed one releases on
  the next attempt), two or a failed read leaves it standing — `github pr release-reservation` is the door for that. `github pr summary <url> [--json]` reads a form BACK: one GraphQL read, `parsePrBody` recovers the explainer as Problem, the top risk item's level and check as Risk and its worst case as Blast radius (a pre-C3 body through the frozen `legacy/parse.ts`), beside its number, title, head, fork flag and state, and a description it cannot read is a `declined` form that still exits 0, so the console refuses that card rather than guessing (`site/lib/actPullVerb.ts`). `github pr standing <url> [--json]` reads what a person opens GitHub to see about one pull request, and is the console voice's pull-request read ([pr-standing](pr-standing.md)).

## You fill a form. Code emits the bytes.

Never hand-write a pull-request body. Fill the typed form and let the renderer produce it — that is what
makes the output byte-stable and the malformed cases unrepresentable. `stack push --form-example` and
`--file-example` print a complete valid one, as JSON and as the markdown authoring file.

Cell content is a list of typed RUNS, not a markdown string:

```json
"explainer": [
  { "kind": "text", "text": "Updating a description replaced the whole body, so the " },
  { "kind": "strong", "text": "checks were lost" },
  { "kind": "text", "text": " whenever the caller forgot to resend them, as " },
  { "kind": "link", "text": "this thread", "url": "https://acme.slack.com/archives/C0SYN000000000/p1700000000000000" },
  { "kind": "text", "text": " shows." }
]
```

`text`, `strong`, `em`, `code`, `link` — that is the whole vocabulary. A screenshot lives only in a proof slot:
`{ "kind": "screenshot", "image", "proves", "runBy": "owner"|"agent" }`, rendered as the picture under the one line
it proves, never as a link to it; a slot with none is `{ "kind": "reason", "reason" }`. `visualProof` says whether
anything on screen changes (`screen-change` or `nothing-on-screen`), which the proof badge reads. An image takes an
optional `"width"`, 64 to 2048 pixels, rendered as `<img … width="N">`; in the authoring file it is
`![alt](url){width=600}`. You cannot emit raw HTML, and that is deliberate: it keeps every cell a one-line block.

## Update names ONLY what changes

This is the point of the verb, so do not work around it.

```
github pr update --repo o/r --number 154 --edit '{"appendChecks":[[{"kind":"text","text":"…"}]]}'
```

Everything you do not mention is carried from the live description. **Never resend a whole form to change one field.**

- `appendChecks` / `appendNotChecked` — add items after what is there. The most common edits.
- Any body field by name — `risk`, `problemSeen`, `explainer`, `visualProof`, `problemProof`, `solutionProof`,
  `checks`, `notChecked`, `rerun` — or `title`, REPLACES that field whole; `[]` drops an optional list. A field both
  set and appended to is refused, and so is an unknown key, named.
- **Retired fields are refused by name**, saying where the job went: `review`, `goldAnchor` and `origin` (a
  description publishes no grade, anchor or origin), `reviewers` (no reviewer table), `reviewLeftovers` (a
  `codex-loop-incomplete` finding acknowledged with `--reason`), `writtenOn` (no stamp).

**A partial edit recovers the form from the ledger's cached copy**, else from the live body. A body publishes only
the TOP risk item (through its badge), so an edit recovered from the body alone carries that one item: re-send
`risk` whole when the lower items matter.

**Converting a pre-C3 body** (the owner's OPEN pull requests; merged ones are left as they are): `--pull` and a
partial `--edit` refuse it as `PRE_C3_SHAPE`. `--pull --convert-c3` writes the C3 authoring file and a report of
every blank and every dropped field ([pr-badges](pr-badges.md)); fill the blanks, then replace it whole:
`SLOPWEAVER_ALLOW_PR_REPLACE=1 slopweaver github pr update --repo o/r --number n --file pr-n.md`. A retired TABLE
body has no reader the converter knows, so write it fresh from `--file-example`.

**An ATLAS pull request has a definition of done before it has a grade at all.** An atlas called done that
answers nothing is decorative. Three things, and the third is the one that
makes it a repair rather than a report:

- `slopweaver atlas doctor <platform>` green — no bot, no credential, and it grades through the same door
  `read` goes through, so an atlas holding a generation it cannot read back fails.
- A temporary listener for the bot answered a Slack tag posted as the owner over that atlas, its permalink linked
  from a check. It is visible, runs the BRANCH's code and stands down once the permalink is captured;
  ONE runs on this machine at a time, and you ask the pinned supervisor for the token first.
- Every bug that surfaced while proving it, fixed in the SAME pull request.

The bar, the three grades and what closed it:
[atlases.md § Definition of done](../../../docs/atlases/definition-of-done.md#definition-of-done-an-atlas-is-not-done-until-it-answers).

`draft` and `target` are refused in an edit: REST `PATCH` cannot change draft state, and a new base or head is a
different pull request.

**The authoring file** (`--pull` writes it, `--file` reads it) carries `title`, `target`, `draft`, `problem-seen`,
`visual-proof` and the ranked `risk` items as frontmatter, then the sections in description order: Explainer,
Proof of the problem, Proof of the solution, Checks, Not checked and why, Re-run. A pre-C3 key (`gold-anchor`,
`origin`, `review`, `review-leftovers`, `reviewers`, `written-on`) is refused by name.

## Content a bot appended is kept, and a partial edit still works over it

A bot- or human-appended description reads (`src/outbound/github/parse.ts`) as the rendered one PLUS an
opaque trailing region, which `--edit` re-appends byte for byte, saying how many bytes slopweaver did not
write. Only `--edit` keeps it; `--file` drops it. A trailing region carrying markup
either renderer emits, the retired table's included, is refused, naming `trailing`.

**A C3 body is exact bytes, so nothing pasted INSIDE it survives a read.** Media a human pastes after the rendered
body is the trailing region above; a block pasted between its sections makes it unreadable as C3, and the edit is
refused. Put a screenshot in a proof slot instead.

## Policy locks, and the refusal no key releases

Not your pull request → `SLOPWEAVER_ALLOW_FOREIGN_PR=1`; a `--form` replacing the whole description →
`SLOPWEAVER_ALLOW_PR_REPLACE=1`. **Neither releases evidence the owner asked for**: a write on any mode dropping a
screenshot or CI run link a settled ask of the owner's named the pull request for is refused, past only the journalled
`pr-evidence-loss` grant. Read [pr-update-locks](pr-update-locks.md) before using either key.

## Constraints the form enforces so CI cannot reject you

One list of rules (`src/outbound/github/formRules.ts`) is read by every write door and by CI, so a form the door
accepts renders a body CI accepts. Each refusal carries a code and the form path to fix.

- **Word caps** (`WORD_CAP`, `WORD_CAPS` in `formRules.ts`), counted by `src/prformat`'s own `countWords` over the
  RENDERED cell — a bare URL is ONE word, a link contributes its text: the explainer ≤70; a proof line or reason,
  and a check, ≤25; a Not-checked item ≤15 and its why ≤30; a Re-run note ≤50; a risk item's `worst` ≤20, and its
  check, its why and the problem's seen line ≤25 each, since a badge hover carries them.
- **Badges**: every hover ≤200 characters (`BADGE`), so a long enough reason is refused there before its own cap.
- **Risk items**: at least one, each naming its `worstKind` (`kind:` in an authoring file), listed so the level it
  implies never rises (`RISK_UNRANKED`); the top one sets the level ([pr-badges](pr-badges.md)).
- **Check groups** (`checkGroups`): at most 4, each a label of ≤6 words over 1 to 8 checks, written after the base
  `checks`.
- **The words** of a layout-2 body meet the owner's content rules (`src/outbound/github/descriptionWords.ts`):
  `PROOF_IS_TEST_SENTENCE`, `REASON_REPEATED`, `TEAMMATE_WORDS`, `CI_WORK`, `CODE_UNFORMATTED`,
  `BOLD_NOT_A_FIGURE`, `COMMIT_UNLINKED`, `AUDIENCE_UNNAMED` ([composing a body](composing-a-body.md)).
- **A problem marked seen** names the day, what was seen and who ran it (`owner`, `agent` or `unrecorded`), and is
  refused when seen after today (`SEEN_DAY`). Not seen yet carries a one-line `why`.
- `visualProof: nothing-on-screen` beside a screenshot contradicts itself (`VISUAL_PROOF`); a Not-checked item is
  one phrase with no full stop (`UNCHECKED_SPLIT`), since it renders as `<check>. <why>`; a proof reason is at most
  two sentences, why there is no screenshot and then where the proof is (`PROOF_REASON_SENTENCES`).
- **Every cell is a one-line HTML block**: no run carries a newline, and a backtick lives only in a `code` run.
  Every authored cell outside Re-run also goes through the **above-the-fold gate**, which REFUSES
  rather than trims — see [the reference](pull-requests.md). No first person in prose.
- **Media is evidence, so it is never folded**: an image lives only in a proof slot. It is a
  `user-attachments/assets` upload (`IMAGE_NOT_USER_ATTACHMENT`), and an evidence link to a release download,
  a comment or a committed media file is `EVIDENCE_RELEASE_DOWNLOAD`, `EVIDENCE_COMMENT_LINK` or
  `EVIDENCE_COMMITTED_MEDIA` ([attachments](attachments.md)).
- **No badge is authored**: the form has no badge field, and all three are derived ([pr-badges](pr-badges.md)).
- Every write is paced: content-creating requests cap at 500/hour vs 5,000 for reads — writes ~9s apart.
- **Never a bare PR number or ticket key** — `#<n>`/`SEC-<n>` auto-link; an unresolved one is REFUSED.
- **A bare `#<n>` from ANOTHER repository is refused, not auto-linked into this one.** A pull request once
  shipped three of the work repository's five-digit numbers as links to unrelated objects here. The
  door weighs MAGNITUDE over every numbered `github.com/<owner>/<repo>/(pull|issues|discussions)/<n>` URL in the
  form, plus on `update` the pull request's own number: a bare number longer than the largest known is refused,
  and a form linking nothing numbered refuses nothing. Write `owner/repo#<n>`; `slopweaver hatch open bare-refs --reason "<why>"` is
  the break-glass.
