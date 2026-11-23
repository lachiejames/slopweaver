# The hygiene gate (a shipped feature)

Part of [Security & trust](../security.md).

The gate refuses two things in what you commit: **a credential**, always, and **a forbidden identifier** — a
name, id, team key or workspace location of the organisation an installation runs for — wherever its one switch
reads `refuse`. Two scanners carry it.
`scripts/check-hygiene.sh` (backed by `src/hygiene/scan.ts`) scans every working-tree file for generic leak
classes — token shapes, raw workspace-ID patterns, absolute home paths and an opaque 32+-hex id assigned to a
query parameter whose name ends in `id`/`ids`. A file holding a NUL byte reads as binary and is skipped whole, a
credential and a raw workspace id in it alike — a blind spot by construction (`looksBinary`, `src/hygiene/repoScan.ts`). Beside it, `forbidden-identifiers` matches the organisation's
own names (hashed) and workspace locations (generic patterns) against committed rules. Neither names an organisation, and you scope your
own literal secret strings through an optional, uncommitted denylist at `$SLOPWEAVER_HOME/hygiene-denylist.txt`
(one case-insensitive substring per line). So any user, or any fork, is kept from committing their own
credentials, and, wherever the switch reads `refuse`, a real workspace id or a name the committed rules or a
provider-location pattern match. A fork's own names join only when it regenerates those rules.

**What fails, and what only prints.** The seven token/key classes and a denylist word are SECRETS and always
exit non-zero. An IDENTIFIER — a real `raw-workspace-id`, or any kind the forbidden-identifier rules match — is refused
through one switch, `IDENTIFIER_VERDICT` (`src/hygiene/scan.ts`): at `refuse` it fails exactly as a credential
does, and at `report` it prints and passes — a leak-class hit by its location, a forbidden-identifier hit in a
per-kind count (`--list` for every location). The scanner's own headline says which value it ran
under, so no doc restates it. One `isRefusedHit` answers for this gate and for the pull-request description
check, so the two cannot drift; the corpus gate keeps `isSecretHit`, because its subject is the
organisation's own data. `raw-workspace-id` matches the Slack prefixes `C U A W D G T E` followed by eight or
more capitals and digits, at least one of them a digit. A synthetic `…FIXTURE…`, `…0SYN…` or the documentation example channel id that shape matches reports as
`synthetic-workspace-id`, still a hit for a consumer that refuses every hit (`turn freeze`, the cassette
tripwire) and refused by no gate; an all-letter one, such as every prefixed id `turn freeze` mints, is no hit at all. `absolute-home-path` and
`id-query-param` print and never refuse under either value, because each is a configuration defect rather
than a name.

`$SLOPWEAVER_HOME/sync-author-denylist.txt` is off-repo for the same reason, and is not a hygiene file: it
names who no ingest and no index may admit, and where (`docs/constraints/refusals.md` § "What the corpus may refuse
to hold"). An entry is a Slack author, bot or app id, optionally scoped to one channel, and every one of
those names one workspace's own accounts — per-install state, wrong as a committed constant for every other
install — so the mechanism ships and the ids do not.

`$SLOPWEAVER_HOME/identity-exclusion.txt` is its sibling and is off-repo for the same reason: it names, one
whole name per line, who no indexed answer may present as a PERSON. It has the shape the author denylist already had: a
named exclusion mechanism for identities, such as phantom attendees, and not heavy-handed heuristics, because
what it excludes is specific names known to be low value. So `src/corpus/identityExclusion.ts` holds no rule that INFERS a
non-person. There is no composite detector and no similarity score, only a whole-string comparison against
names somebody judged.

Two properties are load-bearing rather than incidental. The match is **exact and whole-string**, because the
defect that produced this install's list stored `"Ada Lovelace, Alan Turing"` as one attendee beside both
of the real people it had joined — a substring match would delete two colleagues to remove one phantom, and
say nothing. And the scrub runs at **index time only**: bronze keeps every name exactly as the provider sent
it, so the list is reversible by re-ingesting without it. It deliberately does not run at decode time, where
`compact.ts` would rewrite the operator's own capture on its next pass.

**Why both halves matter.** `AGENTS.md` § "no secrets, ever; no organisation names in what you commit"
states the rule; this is the mechanics behind it. The tree crosses machines that are not all trusted with the
same things — the plugin marketplace mirror, cassette fixtures, and every install's own copy of this repo. A
credential baked into a comment or a fixture travels with all of them and grants something to whoever finds
it, so it always fails. A name grants nothing but ties every copy to one organisation, which is what a
checkout generic to any installation cannot carry, so its verdict is its own.

## The forbidden-identifier scan

`forbidden-identifiers` (`src/hygiene/identifierScanRun.ts`, a `dev lint` gate CI runs) scans every
working-tree file against `src/hygiene/forbiddenIdentifiers.ts`. Person, organisation and product tokens are
stored as SHA-256 digests and matched by hashing candidates out of the text — substring, word,
embedded-uppercase, exact-id and team-key modes (`src/hygiene/identifierScan.ts`) — so the list never re-adds
the names it matches. Provider workspace locations are generic patterns (`src/hygiene/providerLocations.ts`)
matching every label but a synthetic or provider-owned one. What a match costs is the switch's to say. Output is counts, and locations under `--list`, never matched text
out of a file's content: a per-kind summary and `N of M tracked files carry a forbidden identifier`, with
`--list` for every (file, kind). A path prints as git lists it, and a name inside a path is not scanned. Reproduce: `yarn slopweaver dev lint --only forbidden-identifiers`.

The hashed rules come from plaintext held outside every repository: an existing digest is never hand-edited, and a
new token joins its set as one more digest whose reproduction command `src/hygiene/forbiddenIdentifiers.ts` states. A
synthetic label a location rule does not allow yet joins that rule's `allowed` list. A test plants a hit by
assembling it at runtime, so the test file never carries the hit it plants. The pull-request description
check runs the same scanners over the title and body: at `refuse` an identifier hit is an error naming its kind
and line — a forbidden-identifier hit asks for a synthetic stand-in, a real `raw-workspace-id` for its removal; at
`report` the forbidden-identifier hits fold into one redacted note on its verdict and a `raw-workspace-id` shape prints nothing.
The identifier half does not count ONE string there: the pull request's own `owner/repo`, from the CI event
(`$PR_REPOSITORY`) or the write door's own target, never committed (a body cannot do
its work without its own repository's address when the organisation's name is in the owner). The text is scanned
as written; each line then gives up, per whole-token occurrence of the address (or one straight after a token-start
`github.com/` host), exactly the hits its bare OWNER produces alone, so the repository name and a multi-word
name ending in the owner still count. The owner alone, another repository under it and a longer path merely ending in the address (`other/owner/repo`) still hit (`identifierHitsBesideOwnRepository`, `src/hygiene/ownRepository.ts`).

The same two scanners, credential classes and private denylist included, run as the hygiene half of the
publication scan (`src/outbound/publicationScan.ts`) over every other text a write publishes: each commit
message `github push`, `github stack push` and `github stack submit` would send, read before anything is sent
(`src/admit/pushCommitMessageGate.ts`), and every inline self-review comment. A hit refuses with its kind and
line, never its text. `github push` and `stack push` forgive the target repository's own address and an
installation's own identifiers exactly as the description check does; `stack submit` forgives only the
address and self-review nothing, so on those surfaces the scan can only refuse more.

Repository content gets the same budget with two fixed exceptions and nothing else
(`repositoryContentIdentifierScanner`, the same file), and both the working-tree gate and the zero-references proof's
archive walk scan through it, bytes and paths alike. **The source repository's own address**, `SOURCE_REPOSITORY`: a
committed constant rather than the checkout's remote, since `AGENTS.md` names it as the repository's identity and a
remote varies by environment. Its edges are the ones source spells it with (a route path, an SSH remote ending
`.git`, a comma-separated list), so the owner alone, `owner/repo-extra`, `owner/repo.v2` and `other.owner/repo` still
hit. **The owner's `@account` on a code-owner rule row** of `.github/CODEOWNERS`, which GitHub reads as a literal
account: a comment mention, the bare owner, or the same row at any other path still hit. The owner's own name forms
are in the hashed rules (the owner's ruling: the codebase stops naming the owner), so anything else that names the
owner refuses.

The same scanner also powers an opt-in redaction of the knowledge register (`knowledge redaction-scan`,
`knowledge redact`, `--redact` on its writers): an install's uncommitted replacement map
(`$SLOPWEAVER_HOME/hygiene-replacements.tsv`) rewrites first, then every span these rules still find is masked.
It reads the committed rules only; the private denylist and the bronze credential scrub stay separate
([redacting the register](../../skills/knowledge/reference/redaction.md)).

## Where the private denylist actually applies

The two halves of this gate do NOT run in the same places, and treating them as one gate is how a green CI
badge gets read as "checked against the local secret strings".

| half                                          | pre-push on the author's machine | CI `lint` | CI `dev-gate` | merge queue | any other machine |
| --------------------------------------------- | -------------------------------- | --------- | ------------- | ----------- | ----------------- |
| public leak CLASSES (`src/hygiene/scan.ts`)   | yes                              | yes       | yes           | yes         | yes               |
| `forbidden-identifiers` (committed rules)     | no                               | yes       | PR text only  | yes         | yes               |
| the private denylist (`hygiene-denylist.txt`) | **yes — and only here**          | no        | no            | no          | no                |

The mechanics, since the table is the conclusion rather than the reason. The denylist lives at
`$SLOPWEAVER_HOME/hygiene-denylist.txt` and is never committed, so a machine that does not already have it
cannot obtain it. CI does not, twice over and in two different ways: the `lint` job — the one that runs `yarn lint`, and so the hygiene gate — sets no
`$SLOPWEAVER_HOME` at all, so the list loads **absent**; the `dev-gate` job sets one and runs `slopweaver
init`, whose denylist seed is comment lines only, so the list loads **empty**. Both then scan leak classes
only. `merge_group` runs every worker, so the queue is the `lint` column. **An empty list is the normal state
even on the author's machine**: the mandate is literal secret strings no pattern can express, and this
install has none.

**Three consequences, each of them a real hole rather than a caveat:**

- `git push --no-verify` skips the hook, which is the ONLY lane that ever applies the words. Nothing
  downstream re-checks.
- A commit reaching `main` through the merge queue was checked against the local words by exactly one thing:
  the machine whose author pushed it.
- A fork, a fresh clone or a teammate's checkout has no denylist and no way to be handed one, so its gate is
  the leak-class half by construction. That is correct for a shipped feature — the scanner must not contain
  the words it guards against — and it is also the limit.

**What holds the line instead.** The gate prints its denylist status on EVERY run, clean ones included
(`denylistStatusLine`, `src/hygiene/scan.ts`), with `NOT PRESENT`, `PRESENT BUT EMPTY`, `LOADED, N word(s)`
and `UNREADABLE` as four distinct lines. So a `clean` verdict cannot be mistaken for a checked one:
CI's own logs say, on every run, that the local half did not run there.

**The one thing that could change it, named rather than left as an unknown:** the words could be put in a
repository secret and written to `$SLOPWEAVER_HOME` at the start of the CI job. That is not done here, and
the reason is a trade rather than an impossibility — under the narrowed mandate the words ARE secrets, so it
moves real credentials into GitHub's own secret store and into the environment of every workflow run, which
is a different exposure rather than none. If that trade is ever taken it belongs in `docs/constraints/relaxed.md` as a relaxation, not in a PR.

## Private terms on outbound writes

The denylist holds secrets. The installation's own **private words** (names, places, topics) are a second
list with the opposite default: `$SLOPWEAVER_HOME/hygiene/private-terms.tsv`, mode `0600`, never committed and
never seeded. `src/hygiene/privateTerms.ts` parses and loads it; the outbound privacy check
(`src/outbound/privacyCheck.ts`) matches it on every text a guarded write publishes: a pull request's title and
description, a commit message `github push`, `stack push` or `stack submit` sends, a self-review comment, an
attachment's caption, frame text and the text its pixels show, and — at the transport — every string a GitHub write sends through the write
Octokit (a comment, a label, a review reply, a ref name, every GraphQL mutation variable), judged before `fetch` by
`src/outbound/github/writePrivacy.ts`, and every string a Slack write sends through either guarded `WebClient`
(message text, every block and metadata leaf, a canvas, a channel name, topic or purpose, a status, an assistant
thread title, an upload's name, comment and text-like bytes), judged before the SDK sends by
`src/outbound/slack/writePrivacy.ts`, and every Linear mutation `sendGraphql` sends (its whole GraphQL document and
every variable leaf, no key skipped) plus a `linear attach upload`'s name and text-like bytes, judged by
`src/outbound/linear/writePrivacy.ts`, every request the Notion write client sends that is not one of its five
reads (a page's markdown, title, icon and move, a block append or delete, an upload's name, type and text-like
bytes), judged in its `fetch` by `src/outbound/notion/writePrivacy.ts`, every Google Calendar insert, patch and
delete (every event-body string bar its door-minted top-level `id`), judged before the provider call by
`src/outbound/calendar/writePrivacy.ts`, and every Gmail request outside its eight reads (a label change, a draft's
decoded MIME, a send judged on the draft Gmail holds) plus a one-click unsubscribe POST, judged in the Gmail auth
client's `fetch` by `src/outbound/gmail/writePrivacy.ts`. A read needs no terms file; every write does, its policy
read afresh each time (`src/outbound/writePrivacyPolicy.ts`) from the home the verb resolved.

- **The audience rule, once for every destination.** A destination that IS the installation's own organisation
  workspace (its Slack, its Linear, its own Notion) is judged under `identifierAudience: "installation-workspace"`,
  which forgives **forbidden-identifier findings only**: its readers expect the organisation's names. One public or
  outside by default (a public GitHub repository, mail, every Gmail write a label change included, a calendar event,
  whose invitees a personal grant cannot place inside the organisation) stays `strict`. Installation state,
  credentials, the denylist and private terms refuse everywhere, the owner's own name and a DM to the owner included.
  Where one provider can be either, the residue is named: a **Slack Connect** channel carries those names outside
  the organisation, and no channel id says which one is; a Linear **guest** or outside-shared surface, and a Notion
  page **shared to the web or a guest**, receive what the workspace audience forgives.
- **Which requests are writes**, per transport, and each one's residues: [write transports](./write-transports.md),
  whose write-family inventory the `outbound-privacy-closure` lint gate holds closed against `checkPrivacy`.
- **Images and binaries pass with their bytes unread.** An upload's bytes are judged only under a text-like
  extension (`.txt`, `.md`, `.json`, `.csv` and the rest of `TEXT_UPLOAD_EXTENSIONS`), as strict UTF-8, a malformed
  one refused. An image, a PDF, an office document, an archive, or a binary under any other extension reaches Slack,
  Linear, Notion or Gmail unjudged apart from its filename (and on Notion its type, on Slack its title and comment,
  on Gmail its type, disposition and description; a Gmail `text/*` part is read whatever its name): there is no
  OCR, EXIF or document parsing on those doors, so text rendered into pixels is not checked there; `github attach` alone reads a PNG's pixel text (below).
- **Grammar.** `#` comments and blank lines are skipped; the first other line is the seven-cell header the verbs write or the older four-cell one ([private terms](./private-terms.md)). The class is one of `owner-name`,
  `owner-handle`, `owner-address`, `person`, `organisation`, `place`, `health`, `money` or `topic`, closed
  because a class name is committed. Flags are `i` or `-`. The pattern is a JavaScript regular expression that
  must compile, must not match the empty string and must not match the fixed wording every finding prints, a
  class name included (`privateTermFindingSentence`), or the withheld-line stand-in (`WITHHELD_REFUSAL_LINE`).
  The source is free text, dropped at parse time. A refusal line any term matches — through its locus
  (`PR title line 3`), a field path or its wording — prints as that stand-in, so no refusal echoes a term. The
  transport judges its refusal as finally printed and withholds the whole of it on a match, but only the message
  is judged: a caller must never add text around a transport refusal (an `Error:` name, a verb's prefix) that a
  term could match.
- **A match on a meant row HOLDS the write** for a fresh review in context, a CLEAN receipt releasing it once; the list is edited only through `slopweaver private-terms`, read back to the owner first ([private terms](./private-terms.md)).
- **Fail-closed.** Absent, unreadable, readable by group or others, a missing header or any malformed row
  refuses every guarded write, naming the file, the line and the class, never a pattern. A header with no
  row is the explicit "none" and passes. The status reads `NOT PRESENT`, `UNREADABLE`, `EMPTY` or `LOADED N`.
- **Findings** name the surface, the line and the class, never the matched text. The one forgiveness is a match
  wholly inside the exact `owner/repo` address of the write's own target repository (`ownAddressRanges`, the
  identifier half's own edges), because the owner's handle is in every link to their repository; the bare handle
  elsewhere and another repository's address still refuse.
- **CI never sees them.** `pr-format`'s `scanPrMetadataLeaks` (`src/devGate/devGate.ts`) is home-free by design,
  so the local write gates are the only place the terms apply, exactly as with the denylist above.
- **ReDoS is a stated residue.** A pattern runs in-process with no timeout, and `redos-check` reads only source
  literals, so a catastrophically backtracking row would stall the write that matches it.
- **A picture's pixels are read on this machine, and what reading cannot see is a stated residue.** macOS Vision (`src/visualEvidence/imageTextRecognition.ts`, no egress, no model call) reads the text a PNG shows before `github attach` sends it; a failed, timed-out or non-macOS read refuses.
  It cannot see a face, a map, a photographed place, a logo or handwriting, nor text too small, blurred, rotated or low-contrast to read, a term split across two lines or a misread one. Those stay the capture rule: no picture shows the owner's real Queue, calls or home. A recording's pixels are not read; its transcript is its text.
- **`fresh-cut verify` runs these same rows over every file of a cut, none narrowed**; an owner-address line a session READ is taken out only by an exact reviewed-residue entry ([fresh-cut residue](fresh-cut-residue.md)).

A fresh installation with no private words declares that once (a first word goes in with `private-terms add`):

```bash
mkdir -p "$SLOPWEAVER_HOME/hygiene" && printf 'id\tclass\tflags\tpattern\tmeaning\tallowed-where\tsource\n' > "$SLOPWEAVER_HOME/hygiene/private-terms.tsv"
chmod 600 "$SLOPWEAVER_HOME/hygiene/private-terms.tsv"
```

## The synthetic organisation

A test, a fixture, an example or a doc that needs an organisation uses **`acme`**: its hosts (`acme.com`,
`acme.slack.com`, `linear.app/acme`) and team keys in the `ABC-1` shape. A party
outside that organisation — another company's repository, an outside sender — is **`othercompany`**, and a
foreign workspace host takes a label its provider's location rule already allows (`other-org.slack.com`), so a
reader never mistakes the outsider for the installation. A provider id is
synthetic by shape: `…FIXTURE…` (what `turn freeze` mints), `…0SYN…` (what a sanitised record is rewritten
to) or the one documentation example channel id. A provider-neutral placeholder a rule's `allowed` list
already carries (`example.slack.com`, say) passes too, where no organisation is meant. An installation's own
names never stand in for these; they resolve from `$SLOPWEAVER_HOME`.

Those `acme` hosts are real addresses on the public internet that somebody else owns. No test reaches them — replay is offline and the integration lane makes no live call — but a reader clicking one in a doc would.

## The zero-references proof

`slopweaver audit references` asks the question the gate's per-file verdicts do not: **handed this repository as
a zip with no `.git`, does anything in it still name the installation?** It runs `git archive` over `main` as this
checkout holds it (no fetch, `--ref` to pick another commit), extracts the zip, and scans every extracted file's
bytes and every file name three ways: the gate's hashed `forbidden-identifiers` rules, its leak classes, and a
**reference map** held off the repository at `$SLOPWEAVER_HOME/hygiene/reference-map.tsv` — one
`class<TAB>flags<TAB>pattern` row per name, host, project, product, team and person. No map, no run: a zero over
the committed rules alone is not the proof. Two leak classes are not counted, because neither names anyone: the
synthetic `0SYN` id and a home-path placeholder.

Each run re-renders the page `zero-references-proof` with a count per class and no names, keeps the one zip it
scanned under `$SLOPWEAVER_HOME/proof/zero-references/`, and exits 0 only when the **acceptance** section reads
zero: every class but the map's `owner`, which holds the owner's personal name and handle and is counted in a
section of its own beside it, never failing the proof. The owner's handle and email at the organisation sit in
`owner-employer`, inside the acceptance (`src/hygiene/referenceSummary.ts` § `OWN_NAME_CLASSES` carries the
ruling). `--list` prints the residue by file and class. It refuses a commit with a submodule, a Git LFS pointer, or an extraction holding a different
number of files than the commit, since any of those would certify a smaller tree than the one handed over.

### Indirect candidates

A zero there still leaves what could tie the tree back **without** a name: a control id, an incident number, an
internal system, a person, a locale, a vendor set. `audit references --indirect` scans the same zip for those and
produces a **candidate list for a person to judge, never a proof**. Two sources feed it:

- the **candidate map**, `$SLOPWEAVER_HOME/hygiene/indirect-reference-map.tsv`, one
  `class<TAB>flags<TAB>disposition<TAB>pattern<TAB>replacement` row each. The class is one of a closed set
  (`src/hygiene/indirectMap.ts` § `INDIRECT_CLASSES`), so a typo cannot open an unreviewed bucket. `remove` is an
  obvious candidate a pull request takes out, `review` one the owner judges place by place, `aggregate` vocabulary
  too common to list by line, reported as totals per term.
- a **dictionary harvest**: a standalone capitalised word the operating system's dictionary does not know, or one
  its proper-names list holds, spanning few files. It finds the name nobody put in the map, and commits none.
  Generated atlas surfaces, the lockfile and recorded cassettes are mapped but not harvested.

Unlike the direct proof, the candidates carry the matched term and its line, because a candidate the owner cannot see is
one the owner cannot judge. So the full report goes to `$SLOPWEAVER_HOME/hygiene/indirect-reference-report.json` (`0600`)
and the page `indirect-reference-scan`, both under the home; stderr prints counts by class only. It exits 0 when no
`remove` candidate remains, and refuses to run without the map or the dictionary, either of which would read clean
for a reason that is not the tree.

## What the gate does not settle

A clean scan says no credential, and no name or location the rules hold, is in the tree. Four things neither verdict settles, named
so a green run is not read as more:

- **Configuration that ties the repository to the setup it runs on.** The CI runner selector in
  `.github/workflows/ci.yml` (it branches on whether an organisation owns the repository), the code-owner entry, the desktop bundle
  id in `desktop/package.json` and the dependency bot's name in `renovate.json` each name the account, runner
  group or app the repository runs as, and changing one changes how the repository runs — CI stops executing,
  the installed app becomes a different app — rather than what it says. The gate scans them like any tracked
  file, bar the code-owner account row above, so a denylisted token there is reported or refused, but whether a value is the right one for the setup
  is no question it can answer; they are the installation's own to keep or change, never a stand-in to rewrite blind.
- **Modules coupled to one installation.** `src/handover/workspace.ts`'s `ORG` and `WORKSPACES` and
  `site/lib/workspacePlacement.ts` hold workspace names, a repository owner, an account domain and Slack hosts
  as routing constants. `forbidden-identifiers` matches each, but a refusing verdict relocates nothing: by
  tools in the codebase, state outside it, each belongs under `$SLOPWEAVER_HOME`, and a second installation
  edits them. The knowledge domain vocabulary is the shape they move to: `src/knowledge/domains.ts` commits
  only the generic domains, and an installation's own live in its store (`knowledge domains add`).
- **Integration suites with no recording.** No recorded provider cassette is committed, so every suite that
  replays one sits in `config/vitest/integration.ts`'s `QUARANTINED_CASSETTE_SUITES` until it is re-recorded
  against a tenant of your own ([the lane](../integration-coverage.md#what-the-lane-runs-recorded-provider-suites-are-quarantined)).
  The compliance suite has no throwaway tenant: re-recording it needs a real one.
- **Prose that narrates an organisation's practice without naming it.** The rules match names, ids and
  locations; a passage describing how one team works, with no matched token in it, passes every rule.
