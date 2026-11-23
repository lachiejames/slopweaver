# The Vanta policy write loop

**Status: BUILT.** Every leg below has a verb, and the write half was shaped by MEASUREMENT rather than by a
decision.

## What the owner wants

The owner tags the bot in the programme channel and asks it to review a policy, say the AI policy, and recommend
what to change so it matches reality (for example, it does not list a provider the organisation actually uses).
The bot opens a change against the policy repository and replies in Slack with it. On the owner's go-ahead the
change merges and the policy is pushed up to Vanta as a draft, never published, because publishing would cause a
bunch of controls to fail.

The reason for a draft rather than a publish: every publish marks everyone as not having approved the policy, which
is a pain, so a draft is the right push.

Publishing a version that asks employees to re-accept it puts every person's acceptance of that policy back to
outstanding, so the policy's acceptance test fails until they have all accepted again, and whether to ask is
chosen at approval, the owner's choice. A draft
reaches neither, so it changes nothing anyone has accepted.

## The order, and the one reply it waits on

The loop closes this way: the owner and the fleet fix the policy, upload it, then put an artifact in front of the
team saying the owner just pushed these changes after reviewing them personally, and to say so if anyone disagrees.
So the loop is **fix → the owner's
review of the diff → upload as a draft → the team post**, and the only reply any step waits on is the owner's.
The team post is in the owner's voice, carries the three key changes as dot points, links the team page and
invites disagreement; it goes out on the owner's yes to its exact text. A teammate reading it is the
witness, for knowledge sharing, and never a gate. The four steps and the verbs:
[reaching the owner](../skills/compliance/reference/reaching-the-owner.md#a-policy-change-ships-on-the-owners-review-then-the-team-witnesses-it).

The review is a briefing and an HTML page, never a pull request: nobody reviews these policies in GitHub, and the
owner and the fleet use briefings and HTML files for all of this policy work.

## The legs, and the verb that drives each

| Leg                                           | Verb                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| markdown becomes a PDF                        | `slopweaver policy render --file <md> --out <pdf>`                       |
| the change is reviewed, then told to the team | `slopweaver policy diff --record <json> --out <dir>`                     |
| the renewal screen is described, read-only    | `slopweaver atlas vanta policy-versions --policy <id>`                   |
| the PDF becomes a DRAFT version in Vanta      | `slopweaver write vanta upload-policy-version --policy <id> --file <md>` |

`policy diff` writes the owner's review page, the team's page and the team post from one record, and `page publish`
gives a page a linkable URL. There is no integration between any repository and Vanta in either direction, by
the owner's instruction. The bot is the bridge.

## Three measurements that changed the design

### 1. The knowledge-base upload is the WRONG surface

`POST /v1/knowledge-base/resources/documents/{id}/upload` looks like the route, and its own description is _"Replace the underlying file on a document (FILE-type) resource with a new multipart
upload."_ No version is created and nothing enters a pending state. That is an in-place replacement of a
compliance document, which is the opposite of what the owner asked for, and **no verb here reaches it.**

`/v1/policies` is read-only: Vanta's published document declares exactly `GET /policies` and
`GET /policies/{policyId}` and no write of any kind. So the policy-VERSION workflow is reachable only
through the web client, which is what `write vanta upload-policy-version` drives, in the owner's own Chrome, through
the same Playwright relay every other browser leg uses.

### 2. A policy loaded as a file cannot be edited in Vanta's text editor

MEASURED read-only, on a policy whose approved version reads **"Via file upload (.docx)"**: navigating to `…/policies/<id>/edit` bounces straight back to the policy page with a
red toast reading **"Policy draft is not editable"**. Reproduce with

```bash
slopweaver browser shot --url "https://app.vanta.com/c/<tenant>/policies/<policy-id>/edit" --out /tmp/x.png
```

So `write vanta edit-policy-draft`, which types one exact substitution into that editor, **cannot touch a
policy whose body arrived as a file**; that policy takes `upload-policy-version`. Which verb applies is a
property of the policy, and the page says which: a policy written in Vanta's own editor reads **"Created in
Vanta"** and takes the editor, while one whose body arrived as a .docx or .pdf reads "Via file upload". Reproduce with
`slopweaver atlas vanta policy-versions --policy <id>`, whose screenshot shows the source line under the
approved version.

### 3. The renewal control is not in the `…` menu

Also measured the same day, and it cost a wrong guess first. The policy page's `Policy actions` menu holds
exactly `Download acceptance history`, `Copy policy permalink` and `Delete policy`. The version workflow is
in the page's own collapsed `Renew before <date>` card, which offers **`Renew and make updates`** and
`Renew without updates`. Reproduce with `slopweaver atlas vanta policy-versions --policy <id>`, which opens
the menu, expands the cards, reports every control and clicks none of them.

## The screen sequence, and where the write actually is

Five steps, and the boundary is the third. Every one of them was learned from a photograph of the page
rather than from the code.

1. `Renew and make updates` opens a **Create a new version** modal. **Nothing is written.**
2. `Import an existing policy` reveals two cards, `Upload a file from computer` (_"Supported formats: .pdf,
   .docx"_) and `Sync a file`. Choosing the first ticks it and enables the confirm. **Nothing is written.**
3. `Import policy` creates the **Draft version** row, before any file is chosen. **This is the write.**
4. That draft's own `Upload` control opens an `Upload a file` modal carrying the file and the question
   _"Complete approval in Vanta?"_, defaulting to `Yes, needs approval`.
5. Its `Upload` attaches the file. The draft then reads **Via file upload (.pdf)** with **Approval not
   started** beneath it, and the approved version is untouched.

Three consequences, each the rule rather than a note:

- **`--dry-run` touches no browser at all.** It renders the PDF, hashes it and prints the digest.
- **A run that stops between 3 and 5 has left an EMPTY draft behind**, and the report says exactly that and
  tells the operator to upload by hand or delete it. A re-run completes that draft rather than creating a
  second one, which is the only irreversible mess this arm could make by being careless.
- **The approval digest covers the PDF's own BYTES**, the approved markdown, the policy, the page and the
  `draft-only` disposition. Re-render the markdown and the digest moves, so an approval cannot be
  transplanted onto a document that changed after it was given. This is also why the render pins its own
  metadata dates: `pdf-lib` stamps the clock by default, the dry run and the real run then disagreed, and
  the hold refused an approval that could never have been satisfied. The live run re-reads the PDF it
  staged and refuses before any browser opens if it no longer hashes to the approved value, because the
  browser attaches a path rather than the bytes that were hashed.

**The other option on step 4 is never chosen.** `No, already approved` would _"Record the latest approval
details"_ for a version nobody approved, and the snippet refuses outright if it is the one selected.

## Nothing here can publish

There is no publish arm, no submit arm and no approve arm, and `draft-only` is the only value the upload
plan's disposition can take, so there is nothing for a future caller to set. The snippet additionally
refuses outright if the only controls the renewal screen offers it are ones that would submit or approve a
version, and it never touches `Assign approver and submit`. Publishing a policy version is the owner's act, in
the owner's browser, by the owner's hand.

Proven once on a live policy: it afterwards reads `Draft version / Via file upload (.pdf) /
Approval not started`, above its unchanged `Approved version: <date>`, with the policy's own status still `OK`.

## What the render costs, measured

The render is checked rather than assumed. `policy render` reads its own PDF back and compares
the character sequence with the markdown's, ignoring whitespace and the structural markers the renderer lays
out rather than draws as text (`markdownWords` in `src/policy/render/verify.ts` names them): on the measured
policy, **the two sequences matched, in the same order.** A render that dropped a line would otherwise report
success and look right in the upload screenshot.

The same verb renders an **evidence document** (a procedure written as markdown, uploaded beside a policy). A
table is set as stacked rows — the header once in bold, each row's first cell bold, the rest indented — since
a column layout cannot wrap a long cell; a block quote and a numbered or nested list (to six levels) keep their shape; a
figure alone on its line (`![caption](path.png)`, PNG or JPEG, resolved beside the markdown, never a URL) is
embedded and scaled to the column; a fenced block is set monospaced and never wrapped, so its size shrinks
until the widest line fits, down to 5pt; a line too wide even then is refused by line. The standard PDF fonts draw WinAnsi only, so a character outside it — a
box-drawing diagram, say — is refused by line and code point before layout, never as an uncaught
encoding error, because a tenant's existing policies can carry such a character.
