# Codex's draft beside yours, and the owner's pick

The owner's ruling: every NEW as-me Queue draft card shows a Codex draft beside the session's own, as an A-or-B the
owner picks. The design and the states are
[the console page](../../../docs/console/draft-comparison.md); this is what a session does.

## Recording

Nothing changes in how you record. `slack draft record` parks your row, then runs one sealed Codex pass blind to
your words, and journals the outcome on the row. Its progress goes to stderr; stdout stays the one receipt and the
exit is the park's. A row with the owner's approval already on it, with media, or composed in a Codex session gets no pass.
Write `--why` as the purpose, never your draft's words: one quoting six of them in a row refuses B.

If the pass found no Codex seat (`unavailable`) or the record was killed mid-pass (`pending`), run it again:

```bash
slopweaver slack draft compare <id>
```

A `ready` or `refused` comparison is final. Never re-record a row to get a second Codex draft. A retry drops
messages added since the recording read; one that finds the conversation edited since journals a final `refused`,
and the card keeps your draft alone, free to send. One that cannot read the conversation journals `unavailable`.

## The owner's pick

While B is ready and unpicked, the card asks which draft the owner wants and nothing sends. The owner's answer is
judged
on the row exactly as a yes is ([pre-approved](pre-approved.md)):

```bash
slopweaver slack draft pick <id> --variant original|codex --anchor <where the owner chose>
slopweaver slack draft approve <id> --variant original|codex --anchor <where the owner said it>   # pick and yes together
```

`approve` without `--variant`, and every release, refuse with `DRAFT_PICK_OWED` until the owner picks, and while B is
still `pending` too: finish it with `slack draft compare <id>` and the card asks the owner. A `codex` pick makes
B the row's words and digest, so take the release command from `approve`'s receipt or `slack draft show <id>`
after the pick, never before. A pick is recorded once, and never on a row already approved. If `approve
--variant` fails after its pick landed and says the pick stands, run the same command again: the same pick records
nothing new. If it says the row moved, a release sent it meanwhile, so there is nothing left to approve.

**B that drops A's receipt is not pickable.** When A brings links and B's words carry none, the list document marks
the item `codexDropsReceipts`, the card warns beside B and offers it only as a re-cut, and `pick --variant codex`
(and `approve --variant codex`) refuse with no hatch. If the owner wants B's wording, re-cut it with A's link in it via
`--supersedes <id>`. B's own links become its receipts on a pick ([receipts](receipts.md)).

**B that raises a finding A's row cannot prove is never B.** A pick keeps the row's media and `--impact`, so B whose
form declares a possible problem without them is refused at admission, lists as refused if it was admitted earlier,
and `pick --variant codex` refuses it (`src/outbound/slack/candidateFindingProof.ts`).

## What you never do

- Read the owner which draft is better, or lean either way: the counts in `slack draft list --json`'s `picks` are
  the owner's preference, never a score.
- Pick for the owner. A pick off anything but the owner's words is a send the owner did not choose.
- Edit B in place. A fix after the owner's pick is a re-cut like any other (`--supersedes`).
