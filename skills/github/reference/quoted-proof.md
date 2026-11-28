# Quoted proof — text output as a proof slot

A CI job's failing lines or a command's output is proved by those lines, not by a screenshot of a terminal. A
proof slot carries them as its third shape, beside a screenshot and a reason ([pr-forms](pr-forms.md)); when to
reach for it is in [composing a body](composing-a-body.md#the-proof-slots-and-checks).

## The shape

```json
"solutionProof": {
  "kind": "quote",
  "proves": [{ "kind": "text", "text": "On this branch, the build job's required jobs all succeed." }],
  "lang": "text",
  "text": "lint: success\nunit: success",
  "source": { "kind": "link", "text": "the build job's log", "url": "https://github.com/acme/widgets/actions/runs/1/job/2" },
  "runBy": "agent"
}
```

- `text` is the output **verbatim**: paste the real lines, never a retyping. `lang` is a bare fence word, or `""`.
- `source` is ONE `link` run (the job log) or ONE `code` run (the command that prints it), nothing else; a code
  source carries no backtick, which the authoring file could not read back.
- It renders as the proves line and `Source: …` above the fold, then a `Quoted output` `<details>` holding the
  fenced block, so a reader sees the claim and where to read it again, and expands for the lines (`AGENTS.md`
  rule 7). The fence is lengthened past any backtick run in the output.

In the authoring file the section is the proves line, the output in a fence, then two lines, with no blank line
between them:

````text
On this branch, the build job's required jobs all succeed.
```text
lint: success
unit: success
```
source: [the build job's log](https://github.com/acme/widgets/actions/runs/1/job/2)
run by: agent
````

## What is refused, never trimmed

- More than 20 lines, or a line over 200 characters (`QUOTE_LINES`, `QUOTE_CAPS` in
  `src/outbound/github/quoteRules.ts`): quote only the lines that prove it; the source points at the rest.
- An email or IP address (`QUOTE_PII`): a pull request publishes it as is, so write the line without it or put a
  placeholder such as `[ip]` and say so in the proves line. It is the outbound PII pass's own class
  (`src/outbound/slack/piiRedaction.ts`), a quoted local part such as `"a b"@example.com` included, so an
  address that pass reads only in part, a percent-encoded `mailto:` target such as `%22a%20b%22@example.com`, is
  yours to catch.
- A blank line, a carriage return or a NUL in `text`, which would not read back.
- A quote in a layout-1 body, which has nowhere to put one.

## The badge

A quote counts as shown, like a screenshot: two quotes are `problem and solution`. The hover names the medium, `Quoted
output of …`, and carries `Nothing on screen changes.` exactly when `visualProof` is `nothing-on-screen`, which is
how that claim reads back ([pr-badges](pr-badges.md)). Beside a screenshot the hover never carries it, because a
screenshot reads back as `screen-change`.
