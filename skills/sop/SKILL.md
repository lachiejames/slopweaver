---
name: sop
description: Turn a thread, an incident or a piece of undocumented practice into a standard operating procedure with the house shape — a typed form in, a lint-gated Notion page out, published to one private place and announced to nobody. Use when someone asks to write up a process, capture how something is done, fill an SOP gap, or turn "this keeps getting asked" into a page. Phrases like "write an SOP for this", "document this process", "we have no SOP for that", "turn this thread into a runbook", "capture how we do this".
argument-hint: draft --form <json|-> [--out <path.md>] | lint <path.md> | publish <path.md> --parent <page>
---

# Writing an SOP

**A typed form in, a page out.** You compose the FORM; pure code renders the markdown, a gate refuses a
procedure a reader could not follow, and `notion page` publishes it. No model runs inside the CLI, so the
house shape is a property of the schema rather than something a reviewer chases.

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" sop $ARGUMENTS`.

## Run `--form-example` first

```bash
slopweaver sop draft --form-example        # a complete, already-valid form
slopweaver sop draft --form - --out sop.md < filled.json
slopweaver sop lint sop.md
slopweaver sop publish sop.md --parent <page-url> --dry-run
```

The form is **strict**: an unknown field is REFUSED, not dropped, and the refusal names the nearest real
field. Do not guess at field names — print the example and fill it.

## The shape is the org's own, not an invention

The twelve sections came from reading the standard operating procedures this organisation has already
written — purpose, scope, before you start, steps, exceptions, escalation, related, ownership and review.
`src/outbound/sop/types.ts` records the measurement. Do not add a section by putting a heading in a prose
field: the schema refuses one, because the sections are FIELDS and a thirteenth is unrepresentable.

## What the gate refuses, and why you should not route around it

- **an unfilled `TODO` / `TBD` / `TBC` / `FIXME` anywhere.** A page found, read, and still unactionable is
  the measured failure this closes. Fill it or cut the row.
- **a step naming nobody.** Every step carries `who`. "Who does this" is the question that sends a request
  round three teams.
- **a scope that never says what it EXCLUDES.** `doesNotCover` is required and non-empty. The reader asking
  "does this reach my case" cannot answer it from a list of what is included.
- **no openable source link.** `source` is the thread, ticket or page this was distilled out of, so a reader
  can check the procedure against what actually happened.
- **the unreviewed-draft notice deleted.** It is what stops a machine-drafted procedure reading as one its
  named owner signed off. The owner removes it, by reviewing the page.

## Two things this verb will not do, and both are the owner's

**It publishes to ONE place and tells NOBODY.** There is no teaser, no channel flag and no send. Announcing
that a procedure now exists is the owner's act, under the owner's own name, through `slack post --as me`.

**A new Notion location is the owner's word too.** Publish under a parent the owner has already named. Do not pick a
workspace, create a parent, or move an SOP repository because it would tidy things up.

## A page is NOT done until `notion verify` has run

`sop publish` prints the exact command. Run it. A write that reported success has told you Notion ACCEPTED
your markdown and nothing about what a reader sees — Notion's own converter decides that, and `notion read`
shows the blocks it built, not how they render. Read the exit code: `0` clean, `3` it checked and found problems, **`1` it could
not check at all — never report that as a pass.** `/slopweaver:notion` has the rest.

## Answering a tag with an SOP

When a Slack tag asks for one, the turn is [reference/from-a-thread.md](reference/from-a-thread.md): read
the thread, check whether the SOP already exists before writing a second one, fill the form from what people
actually said, publish private, verify, and reply with the link and what you could not confirm.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you; in Codex
it is not, so resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path. Never run bare `slopweaver` on either host — an ambient
`PATH` may point at another checkout.
