# The verb map — four nouns reach compliance, and no single atlas covers the job

This is why [the skill](../SKILL.md) is named for the job. A control question crosses all four of these, and
a session that knows only the first one answers half of it. Enumerate the live truth rather than trusting
this page: `slopweaver catalog | grep -A20 '^policy'`, and the same for `access-review`, `write` and
`atlas vanta`.

## `atlas vanta` — what Vanta holds, and the evidence behind one control

Read-only by construction. `read` and `coverage` make no network call at all.

| verb                                         | what it is for                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `read --kind <k> --query <words>`            | resolve a control, policy, test, evidence row or integration out of the stored generation    |
| `coverage`                                   | what this atlas knows it does NOT know — which surfaces are filled, and what would fill one  |
| `control-evidence --control <providerId>`    | **the spine**: one control's tests, their failures, remediations and a failing-entity sample |
| `controls-evidence`                          | the filtered-count document across controls, rather than one control in full                 |
| `policy-versions --policy <id>`              | the version history behind one policy document                                               |
| `vulnerabilities [--severity …] [--fixable]` | Vanta's own view of host findings — NOT a dependency alert                                   |
| `test-entities --status DEACTIVATED`         | every resource a test has had deactivated, with its reason; `--test <id>` narrows to one     |
| `shot --control <id>`                        | photograph ONE control at its own address, when a picture is the deliverable                 |
| `walk`                                       | fill the browser surface; the only thing that makes a screenshot available                   |
| `sync`                                       | re-walk the Manage API when `atlas freshness` says this atlas is behind                      |
| `render`                                     | one self-contained HTML page of what is already stored, capped and screenshot-able           |
| `reset` / `restore`                          | archive a generation, or put an archived one back                                            |

The KINDS a control question reaches are `control`, `library-control`, `test`, `policy`, `policy-document`,
`evidence`, `integration`, `framework` and `risk`; `user`, `person`, `group` and `monitored-computer` are the
population a test fails over. `coverage` prints each kind's own state — never assume one is filled.

**`policy-document` carries the body, and a `textState` saying why it does not when it does not.** The
file is stored whole beside its extracted words, so `read --query contractor` reaches the text rather than
a pointer to it. A `text` of `null` is never the whole answer: `textState` is `extracted`,
`no-text-layer` (a scan — the file is there, nobody has OCR'd it), `not-a-document` (the bytes are not a
PDF at all, stored as `source.bin` and left unparsed), `too-large` (stored whole, past what this machine
will hold in memory to read), `unreadable` or `not-fetched`. Only the last two make the kind incomplete; a spreadsheet uploaded beside the policies is a fact about that
resource, not a failed run.

## `policy` — a policy change, rendered and reviewed as HTML

| verb                                      | what it is for                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `policy render --file <md> --out <pdf>`   | render a policy or evidence doc to a PDF, refusing any construct or character it would drop          |
| `policy diff --record <json> --out <dir>` | the owner's review page of a document change, the team's page and the team post, all from one record |

`diff` reads like a good pull request: material changes in document order under their reason, a hover on the after
side saying what the line is and what the owner is asked about it — never what it said before, which folds under the
reason — formatting folded by convention, marks as colour with a hover note and stated to stay off the document,
every control, Linear key, PR, policy, evidence slot and bare public web address a link, one tab per document. Formatting means the same
words, where every character but soft punctuation (`.,;:`, quotes, dashes) and emphasis markers is a word, a sign,
a dot inside a word and a separator between digits included; AND the same headings at the same levels with every
line at the same depth (a paragraph split into a flat list where it stood is fine, one that also nests is not); AND,
word for word, the same link under
each word (links only added or only removed), the same images, and every character of every code span, fence and
front matter at the same words, marked or not — its whitespace included, bar the end of a line, and no character
moved across its edge. A re-pointed, swapped or moved link, a diagram added, removed or swapped, a flipped `<` or
minus, an edited code span, a changed front-matter value, a line re-nested or a heading re-levelled, and a moved line
are material. A change names its rows by `match` substrings, or by a whole `line` for a row whose text starts longer
ones. The team post escapes Slack's `&`, `<` and `>`, so the record writes no link or mention of its own. It REFUSES a material line no change in the record explains, a change or mark matching nothing, a
match string empty as plain text, an identifier it cannot link, any link scheme but https, http or mailto (a control
character counts as a scheme), an address at no public host or single mailbox (a relative path, a `#fragment`,
`localhost`, an IP, a single label, a special-use or private-network name such as `.local`, `.internal`, `.corp` or
`.test`, a mailto with a query), the same in a bare address in the record's own text (a URL, a mailbox or a host
name a client would link), and an image this run did not read. Links are read by one pattern everywhere, the team
post included, so a link with a space or title in its address is bare text, and checked as such. Publish
`owner.html` with `page publish`; `team-post.txt` is parked with `slack draft record` and says the documents were
pushed, so it waits for the upload (`"uploaded": false` puts that warning on the owner's page).

Nobody reviews a policy in GitHub: policy work uses briefings and HTML files. A policy change never opens a pull request ([reaching the owner](reaching-the-owner.md)).

## `access-review` — who can reach what, and who left but still can

The ISO access review, off the atlases that store a per-user level (JumpCloud, Cloudflare Access,
1Password), joined against the Vanta person roster. Local reads only; the code is `src/accessReview/`.

| verb                                       | what it is for                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `slopweaver access-review platform <name>` | one row per person, every level the platform stores printed verbatim                                                             |
| `slopweaver access-review former`          | former staff split into CONFIRMED, UNMEASURED and CLEAN; a rehire is not a finding, nor a deleted account the atlas still stores |
| `slopweaver access-review privileged`      | every console administrator against employment — the ISO A.8.2 table, whole                                                      |

CONFIRMED means the platform's own read stamp is at or after the person's last day. A confirmed row marks
any other platform on it that was read before they left. CLEAN needs every platform read after they left;
a read from before makes them UNMEASURED. A rehire is matched by address, so one rehired under a NEW
address leaves the old address in its bucket. A refused platform makes CONFIRMED and every other count read off the
platforms a lower bound, makes UNMEASURED provisional either way (its read could confirm anyone there), and withholds
CLEAN. Every count is of records STORED; re-sync the atlas (`atlas freshness`) before treating one as the provider's
population.

## `write vanta` — the only way state changes at Vanta

Eight verbs, in [the write side](the-write-side.md). Kept out of the atlas deliberately, because an atlas
only ever reads. `group-people` is the one a proposal usually needs: it moves people into and out of ONE
group, which is what Vanta hangs policy-acceptance obligations off.

## What is NOT here, and where it lives instead

- **the honesty contract for reading any atlas** — [atlas](../../atlas/SKILL.md);
- **which sources an investigation should span** — [route](../../route/SKILL.md);
- **every estate fact, gotcha and caveat** — the knowledge register, never this
  repository: `slopweaver knowledge list --domain vanta`;
- **a dependency vulnerability and its fix PR** — [vulnerability-fix](../../vulnerability-fix/SKILL.md).
