# The three badges a C3 pull-request description opens with

Bundled reference for the `github` skill, linked from [pull-requests.md](pull-requests.md). All three are DERIVED,
never authored (`src/outbound/github/derive.ts`, `tooltips.ts`); each carries a plain hover of at most
`HOVER_MAX` (200) characters, and a form whose hover would run longer is refused as `BADGE` before anything renders.

- **`risk`** is the TOP-ranked risk item's level, and the author picks the KIND of worst case, never the level:
  `loses-leaks-or-changes-off-machine` (data lost or leaked, or a change off this machine) is `high` red,
  `something-working-breaks` is `medium` amber, `only-tests-docs-or-dev-tooling` is `low` green. Items are listed
  high first and the level never rises down the list (`RISK_UNRANKED`). An unchecked top item turns a non-high
  badge amber `<level>, unchecked`. The hover: `Worst case <worst>. <check>.`, or `… Not checked: <why>.`. Only the
  level is published, so a read-back recovers the top item with the one kind its level implies.
- **`problem`** is `seen <day>` green when the problem was seen on a real run, or `not seen yet` grey. The hover:
  `Seen <day>: <what>. <who ran it>.`, where who is the owner, an agent, or unrecorded; or the one-line reason it
  has not been seen. A problem nobody can reproduce on demand (a prod incident, a provider's transient failure) is
  still `seen` on the day it was observed. A day after the write is refused (`SEEN_DAY`).
- **`proof`** is computed from the two proof slots, never picked and never red: `problem and solution` and
  `solution only` green, `problem only` and `not run yet` amber, `tests only` grey (nothing on screen changes,
  `visualProof: nothing-on-screen`). The hover names who ran each screenshot, or quotes the slot's reason; a
  `tests only` hover is `No screenshots. <reason>`, claiming nothing about the screen the reason does not say.

## What each derived phrase claims

The description review reads this file as a rule (`DESCRIPTION_RULE_FILES`), because a badge's words are the
renderer's and the claim is the typed field behind them. Judge the field; derivation is not immunity.

- **`Seen <day>`** claims `problemSeen.on`: the problem was seen on a real run that day. A fleet finding's packet
  carries the day it was registered (`evidence/01-fleet-finding.json`), which bounds the seen day: one on or
  before it is consistent, one after it is unsupported. The record never proves the exact day by itself.
- **`An agent ran it.`** claims `problemSeen.by: agent`, supported by that record or by `change/`. **`The owner ran
it.`** needs a record in `evidence/`, as every act credited to the owner does.
- **`Who ran it isn't recorded.`** is `by: unrecorded`, the honest answer when nothing records who ran it. It credits
  nobody, so it never breaks the attribution rule in [composing a body](composing-a-body.md#attribution).
- **`No screenshots, since nothing on screen changes.`** claims `visualProof: nothing-on-screen`: no page, window,
  card, image or line of terminal output a reader sees is changed by the diff. A changed terminal line is a screen
  change, so this phrase over one is false.
- **`Not run for real yet:`** is `screen-change` with no screenshot in either slot: no picture of a real run is
  attached. Its words say no real run happened, so a check beside it reporting a real run of the changed surface
  contradicts it and is a violation; a check naming what did run (unit cases, a dry run) does not.

**No grade, gold anchor, origin or reviewer table is published.** The landing verbs keep their own record of
proof; a form or authoring file carrying one of those fields is refused by name, saying where its job went.

**A pre-C3 body does not parse as C3.** `--pull` and `--edit` refuse it as `PRE_C3_SHAPE`, printing the convert
command: `slopweaver github pr update --repo <owner/repo> --number <n> --pull --convert-c3` writes `pr-<n>.md` and
`pr-<n>.md.report.txt`, the report naming every blank to write and every retired field it dropped, and sends
nothing. Fill the blanks, then send the file back whole: `SLOPWEAVER_ALLOW_PR_REPLACE=1 … --file pr-<n>.md`.
