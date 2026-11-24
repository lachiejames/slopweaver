# `github pr update`'s policy locks, and the refusal no key releases

The parent is [pr-forms](pr-forms.md); this page is what `pr update` refuses on POLICY rather than on fact.

## Two policy locks, each with a key

Both are single-run, both print why, and both log loudly when used — the same shape as
`SLOPWEAVER_ALLOW_UNREVIEWED`. If you use one, say so in the pull request.

**The author is not you** → `SLOPWEAVER_ALLOW_FOREIGN_PR=1`. The check compares immutable numeric user ids
between the pull request and `users.getAuthenticated`. Editing other people's descriptions is not what this
verb is for, but it is possible. An identity that could not be READ — an installation token, a 401 — fails
closed rather than being guessed either way, and the override does not lift that.

**`--form` would replace the whole description** → `--edit` when only some fields change, which keeps the rest
and the refusal names it; `SLOPWEAVER_ALLOW_PR_REPLACE=1` for a deliberate whole replacement. A complete form works on
any pull request you authored, cached or not, house-format or not — that is the point of it. What it does not
do is act silently: anything in the live description a form cannot carry is discarded, GitHub keeps no history
of it, so the diff is printed to stderr first and the key is required. A replacement that changes nothing does
not ask for the key.

## Neither key releases evidence the owner asked for

A write on ANY mode — `--edit`, `--form` or `--file` — that drops a screenshot, or a GitHub Actions or Datadog
CI run link, from a pull request a settled ask of the owner's names is refused, naming the row and every lost URL. The
row counts when it is an `ask` settled `answered` or `filed`, the owner's words are held, and its witness or the
owner's words
carry the pull request's URL, under any repository name, since a renamed repository's old URL still opens it;
the anchor alone never does. A screenshot redrawn as a link counts as lost; an
attachment the live body only ever linked is kept by the same URL anywhere.

`--dry-run` prints the refusal as a finding and exits 0. The one way past is the journalled
`slopweaver hatch open pr-evidence-loss --reason "<why>"`, which names the session and expires. A board row that
will not read refuses a write that drops evidence, because whose evidence it is cannot be established; a write
that drops none never reads the board.

Measured: a rollout replaced a body under `SLOPWEAVER_ALLOW_PR_REPLACE=1`, and
five screenshots the owner's row asked for became links. The criterion is
`src/cli/commands/github/settledEvidenceCore.ts`; the order against the replacement key is
`src/cli/commands/github/updateConsent.ts`. A local log link is not covered.

## A refusal that is NOT a lock

Its remedy is a flag rather than a variable.

**`a partial --edit needs the description's current form to merge into, and neither source has one`** — the
ledger has no exact cached form and the live description cannot be read back into one. Send the whole thing
with `--form` or `--file` instead. This is what you will hit on a description a human wrote by hand and on a
retired table body (`RETIRED_SHAPE`, converted as in the parent): neither is the exact render of any form, so
no partial edit can be safe on it.

The two keyed locks are the only ones a variable overrides, not the only refusals: bad or undeclared edit JSON,
a failed read, an invalid merged form, a gate rejection, an ambiguous address, a missing token and a door
refusal all still refuse.
