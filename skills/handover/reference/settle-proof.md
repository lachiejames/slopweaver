# Settling `answered` on a bare pull request URL

`handover settle <slug> --as answered --witness <url>` checks the witness against the owner's words when the witness is a
bare pull request URL and nothing else. Measured: acme-admin-17564 was settled on its bare URL while the proof the owner
asked for was absent, and every later step trusted that settlement.

## When it reads

The row's held quotes (its own and each steer) are split into clauses. A clause asks for proof only when it carries
a request word ("expected", "please add", "proof") and no negation or removal word ("no", "don't", "remove"). The
items it can ask for are screenshots, GitHub run links and a Datadog view. "Before and after" doubles the first two.
A row whose words ask for nothing is never read, and neither is any other witness shape: a comment permalink, a doc
slug, prose around the URL.

The witness is parsed as a URL, so a host in any case, `www.`, `:443`, `http:`, a query string or one of the PR's own
tabs all name the same pull request.

## What it does

The body is read live, after the card plan and closing gates and before the caller's precondition, so nothing is
awaited between that precondition and the write.

- **Body unreadable**: refused as a fact (whether the proof is there is unknown). The hatch never waives it.
- **Body lacks an item**: refused naming each item, how many were found and how many are needed. The hatch is
  `SLOPWEAVER_ALLOW_UNPROVEN_ANSWER=1`, for a proof the owner has since waived on record or one that lives somewhere the
  body links but this check does not count.
- **Body carries each item**: the settle goes ahead and its receipt names every attachment, run and Datadog link.

It is a PRESENCE check. A passing run that shows nothing still counts, which is why the receipt names each run for a
reader to judge. The code is `src/handover/proofAsk.ts` and `src/cli/commands/handover/proofWitnessGate.ts`.

## A page witness is a different gate

A witness naming a page (`page:<slug>`, its `file:` URL under this home, or `/api/page/<slug>/`) is checked for
REACH, not proof: the closing gates refuse it — and any witness on a row whose run published a page — until the
page reached the owner's Queue
([running a run](running-a-run.md)). Code: `src/cli/commands/handover/uncardedPageGate.ts`, hatch
`SLOPWEAVER_ALLOW_UNCARDED_PAGE=1`.
