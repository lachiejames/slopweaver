/**
 * `dated-addendum`, over the shapes measured on four real corpora — every lead-in below that
 * fires was a real addendum there, and every silent one was a real anchor there, rewritten generically.
 */
import { describe, expect, it } from "vitest";

import { datedAddenda, datedAddendumMessage } from "../../../memory/addendum.js";

const FRONTMATTER = "---\nname: thing\ndescription: a thing\nmetadata:\n  type: feedback\n---\n";

/** A memory whose body is `body`; the body opens on line 8. */
function memory({ body }: { body: string }): string {
  return `${FRONTMATTER}\n${body}`;
}

describe("sound prose the criterion reads as an amendment is reported, which is why no write is refused on it", () => {
  it.each([
    ["a pool's history, not an edit to the memory", "- **Narrowed 9 Sep 2026** back to 15 connections."],
    ["a vendor feature's arrival", "- **Added 12 Sep 2026** in Claude Code 2.1: the payload carries it."],
    ["an adjective opening an incident label", "**Extended outage, 3 Sep 2026:** the pool exhausted."],
    ["an ordinal whose parenthesis opens on the date", "**Second opinion (3 Sep 2026, Codex):** the plan holds."],
    ["a confirmation the owner gave", "**Confirmed by the owner (29 Sep 2026, voice):** asks go to the queue."],
    ["a noun after an amendment adjective", "**Settled invoices (3 Sep 2026):** none are open."],
    ["`Since` opening a present fact", "Since 12 Aug 2026 the repo is private."],
    ["a vendor's dated change", "- **Slack, changed 29 May 2025:** one history call a minute."],
    ["a heading naming a vendor's change", "## GitHub, changed 14 Aug 2026"],
    ["a provenance list item", "- **`staging-pool-exhaustion`, added 12 Sep 2026 by the platform team**"],
    [
      "a shouted status in prose naming a future date",
      "The stage 2 audit is CONFIRMED 14 Oct 2026, booked by the auditor.",
    ],
    ["a shouted status after a dash in a label", "**ISO stage 2 fieldwork — CONFIRMED 14 Oct 2026:** on site."],
    ["a status word opening a label", "**Confirmed 14 Oct 2026:** stage 2 fieldwork."],
  ])("%s", (_label, body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toHaveLength(1);
  });
});

describe("a paragraph whose lead-in dates an amendment fires", () => {
  it.each([
    ["**Settled 29 Sep 2026:** the rule is final.", "Settled 29 Sep 2026"],
    ["**Corrected 12 Aug 2026:** the flag is the other one.", "Corrected 12 Aug 2026"],
    ["## Addendum, 22 Aug 2026 — a rebase", "Addendum, 22 Aug 2026"],
    ["**WIDENED 6 Sep 2026** — it covers both repos.", "WIDENED 6 Sep 2026"],
    ["**Second bump, 26 Sep 2026.** It moved again.", "Second bump, 26 Sep 2026"],
    ["- **Read-only, added 12 Sep 2026** — a rule.", "Read-only, added 12 Sep 2026"],
    ["**CORRECTED 2026-07-28**: the earlier line was wrong.", "CORRECTED 2026-07-28"],
    ["**SUPERSEDED 7 Sep 2026.** Read the other memory.", "SUPERSEDED 7 Sep 2026"],
    ["## Update 3 Sep", "Update 3 Sep"],
    ["As of 2026-07-27 the list has three entries.", "As of 2026-07-27"],
    ["Since 28 September the step is manual.", "Since 28 September"],
    ["**Tightened 3 Sept 2026:** fewer rows.", "Tightened 3 Sept 2026"],
    ["How to apply — CORRECTED 2026-07-28. Use the other flag.", "How to apply — CORRECTED 2026-07-28"],
    ["**Superseded in part, 25 Aug 2026:** the listener guards it.", "Superseded in part, 25 Aug 2026"],
    ["## Addendum 2, 21 Aug 2026 — which channels", "Addendum 2, 21 Aug 2026"],
    ["**SCOPE CHANGED (2026-07-19, mid-session):** wider.", "SCOPE CHANGED (2026-07-19"],
    ["**CORRECTION, measured 28 Aug 2026:** it is not.", "CORRECTION, measured 28 Aug 2026"],
    ["**Second data point, 20 Aug 2026 — no repro.**", "Second data point, 20 Aug 2026"],
    ["**Third confirmed instance (24 Aug 2026):** again.", "Third confirmed instance (24 Aug 2026"],
    ["**THAT HALF IS SUPERSEDED, 12 Sep 2026.** The owner named it.", "THAT HALF IS SUPERSEDED, 12 Sep 2026"],
    ["**REAFFIRMED AND WIDENED, 1 Aug 2026.**", "REAFFIRMED AND WIDENED, 1 Aug 2026"],
    [
      "**The term is fine — confirmed and corrected 12 Aug 2026.**",
      "The term is fine — confirmed and corrected 12 Aug 2026",
    ],
  ])("%s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `The rule.\n\n${body}\n` }) })).toEqual([{ leadIn, line: 10 }]);
  });

  it.each([
    ["**Superseded by rule-10, 25 Aug 2026:** x", "Superseded by rule-10, 25 Aug 2026"],
    ["**Corrected per owner's ruling, 12 Aug 2026:** x", "Corrected per owner's ruling, 12 Aug 2026"],
    ["**Superseded by Zoë, 25 Aug 2026:** x", "Superseded by Zoë, 25 Aug 2026"],
    ["**Changed in v2.1, 3 Sep 2026:** x", "Changed in v2.1, 3 Sep 2026"],
    ["**Second follow-up, 20 Aug 2026:** x", "Second follow-up, 20 Aug 2026"],
    ["**Pool -- updated 3 Sep 2026:** x", "Pool -- updated 3 Sep 2026"],
    ["**(Since 3 Sep 2026):** x", "(Since 3 Sep 2026"],
    ["**(As of 2026-07-27):** x", "(As of 2026-07-27"],
    ["**(Second data point, 20 Aug 2026):** x", "(Second data point, 20 Aug 2026"],
    [
      "## **One two three four five six seven eight, updated 3 Sep 2026** x",
      "One two three four five six seven eight, updated 3 Sep 2026",
    ],
  ])("a word is what is written between spaces, and a label's marks and length do not hide it: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it("reads a bold span that wraps onto the next line as one label, without the opening marker", () => {
    const body = "**Read-only, added 29 Sep 2026 (option C on\nthe card):** a rule.\n";

    expect(datedAddenda({ text: memory({ body }) })).toEqual([{ leadIn: "Read-only, added 29 Sep 2026", line: 8 }]);
  });

  it("reads a label whose date wraps past its first line", () => {
    const body = "**Read-only for the fleet and the bot, added\n12 Sep 2026:** a rule.\n";

    expect(datedAddenda({ text: memory({ body }) })).toEqual([
      { leadIn: "Read-only for the fleet and the bot, added 12 Sep 2026", line: 8 },
    ]);
  });

  it.each([
    ["How to apply — CORRECTED 28 Jul\n2026. Use the other flag.", "How to apply — CORRECTED 28 Jul 2026"],
    ["**SCOPE CHANGED (29 Sep\n2026) wider now:** yes.", "SCOPE CHANGED (29 Sep 2026"],
    ["Since 28 Sep\n2026. the step is manual.", "Since 28 Sep 2026"],
  ])("keeps the key when a rewrap opens a line on the year: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it.each([
    ["- How to apply — CORRECTED 28 Jul\n  2026. Use the other flag.", "How to apply — CORRECTED 28 Jul 2026"],
    ["- **SCOPE CHANGED (29 Sep\n  2026) wider now:** yes.", "SCOPE CHANGED (29 Sep 2026"],
    ["How to apply\n    - CORRECTED 2026-07-28. Use the other flag.", "How to apply - CORRECTED 2026-07-28"],
  ])("keeps the key when a list item or paragraph wraps onto an indented line: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it.each([
    ["a blockquote", "The rule.\n> **Settled 29 Sep 2026:** final.", 9],
    ["a thematic break", "The rule.\n***\n**Settled 29 Sep 2026:** final.", 10],
  ])("reads an addendum after %s with no blank line above it", (_label, body, line) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn: "Settled 29 Sep 2026", line }]);
  });

  it.each([
    ["a space ending the line before the year", "**Settled 29 Sep \n2026:** the pool is 15."],
    ["a space ending the line before the month", "**Settled 29 \nSep 2026:** the pool is 15."],
    ["a blockquote marker with extra indent", "> **Settled 29\n>  Sep 2026:** the pool is 15."],
    ["a list item in a blockquote, aligned", "> - **Settled 29\n>   Sep 2026:** the pool is 15."],
    ["a strong span spelled with underscores", "__Settled 29 Sep 2026:__ the pool is 15."],
    ["a backslash escape the renderer drops", "**Settled 29 Sep 2026\\:** the pool is 15."],
  ])("keeps the key through %s", (_label, body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn: "Settled 29 Sep 2026", line: 8 }]);
  });

  it.each([
    ["## Addendum, 22 Aug 2026 — a rebase", "Addendum, 22 Aug 2026"],
    ["Addendum, 22 Aug 2026 — a rebase\n---", "Addendum, 22 Aug 2026"],
    ["**Read\\-only, added 12 Sep 2026** — a rule.", "Read-only, added 12 Sep 2026"],
  ])("reads a heading of either kind as a label, and quotes a lead-in as rendered: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it.each([
    ["a backslash hard break", "**Settled\\\n29 Sep 2026:** x", "Settled 29 Sep 2026"],
    ["a two-space hard break", "**Settled  \n29 Sep 2026:** x", "Settled 29 Sep 2026"],
    ["a single-backtick code span", "**`cfg`, updated 29 Sep 2026:** x", "`cfg`, updated 29 Sep 2026"],
    ["a double-backtick code span", "**``cfg``, updated 29 Sep 2026:** x", "`cfg`, updated 29 Sep 2026"],
    ["a padded code span", "**` cfg `, updated 29 Sep 2026:** x", "`cfg`, updated 29 Sep 2026"],
    ["an autolink", "**<https://x.io>, settled 29 Sep 2026:** x", "https://x.io, settled 29 Sep 2026"],
    ["an inline link", "**[https://x.io](https://x.io), settled 29 Sep 2026:** x", "https://x.io, settled 29 Sep 2026"],
    ["a numeric character reference", "**Settled&#32;29 Sep 2026:** x", "Settled 29 Sep 2026"],
    ["a named character reference", "**Settled&nbsp;29 Sep 2026:** x", "Settled 29 Sep 2026"],
  ])("quotes %s as it renders", (_label, body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it.each([
    ["a link title", '**[a](u ", settled 29 Sep 2026")** b'],
    ["a reference definition's title", '**[a][r]** b\n\n[r]: u ", settled 29 Sep 2026"'],
    ["a code span whose backtick runs differ", "**\\`a, ``settled 29 Sep 2026``:** rest"],
    ["a code span between single backticks", "**\\`a, `settled 29 Sep 2026`:** rest"],
  ])("never reads what does not render as text: %s", (_label, body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
  });

  it.each([
    ["a strong span inside an image's alt text", "![**Settled 29 Sep 2026:**](i) x"],
    ["plain alt text", "![Settled 29 Sep 2026:](i) x"],
    ["a code span inside an image's alt text", "![`CORRECTED` 2026-07-28](i) rest"],
  ])("never reads an image's alt text, which renders as an attribute: %s", (_label, body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
  });

  it.each([
    ["inline HTML", "<i>As of 2026-07-27</i> the list."],
    ["escaped angle brackets", "\\<i>As of 2026-07-27\\</i> the list."],
    ["character references", "&lt;i&gt;As of 2026-07-27&lt;/i&gt; the list."],
  ])("reads inline HTML as the text it renders as: %s", (_label, body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
  });

  it.each([
    ["an escaped comment opener on the line", "**Settled 29 Sep 2026:** x \\<!-- y", 8],
    ["a four-backtick fence holding three", "````\n```\n````\n\n**Settled 29 Sep 2026:** x", 12],
    ["a line that only looks like a fence", "```a`b\n\n**Settled 29 Sep 2026:** x", 10],
  ])("lets the parser alone decide what is a code block: %s", (_label, body, line) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn: "Settled 29 Sep 2026", line }]);
  });

  it("still never reads inside a real code block or HTML comment", () => {
    const body = "```\n**Settled 29 Sep 2026:** x\n```\n\n<!--\n**Settled 29 Sep 2026:** y\n-->\n";

    expect(datedAddenda({ text: memory({ body }) })).toEqual([]);
  });

  it.each([
    ["a NUL, which renders as U+FFFD", "**Pool\u0000, settled 29 Sep 2026:** x", "Pool�, settled 29 Sep 2026"],
    ["the U+FFFD a NUL renders as", "**Pool�, settled 29 Sep 2026:** x", "Pool�, settled 29 Sep 2026"],
  ])("reads the body as micromark's preprocess does: %s", (_label, body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it("skips a byte-order mark opening the body straight after the frontmatter, as micromark does", () => {
    expect(datedAddenda({ text: `${FRONTMATTER}﻿**Pool, settled 29 Sep 2026:** x\n` })).toEqual([
      { leadIn: "Pool, settled 29 Sep 2026", line: 7 },
    ]);
  });

  it.each([
    [
      "a lone CR inside the frontmatter",
      "---\nname: thing\rdescription: a thing\n---\nThe rule.\n\n**Settled 29 Sep 2026:** x\n",
    ],
    ["CR-only line endings", "---\rname: thing\rdescription: a thing\r---\rThe rule.\r\r**Settled 29 Sep 2026:** x\r"],
  ])("counts the body from where the frontmatter really ends: %s", (_label, text) => {
    expect(datedAddenda({ text })).toEqual([{ leadIn: "Settled 29 Sep 2026", line: 7 }]);
  });

  it("reads a file with a byte-order mark and no frontmatter from its first line", () => {
    expect(datedAddenda({ text: "﻿**Settled 29 Sep 2026:** x\n" })).toEqual([
      { leadIn: "Settled 29 Sep 2026", line: 1 },
    ]);
  });

  it.each([
    ["**Pool UPDATE CHANGED (3 Sep 2026):** x", "Pool UPDATE CHANGED (3 Sep 2026"],
    ["**Pool UPDATE SUPERSEDED, 12 Sep 2026:** x", "Pool UPDATE SUPERSEDED, 12 Sep 2026"],
    ["**Pool AMENDMENT CORRECTED (2026-07-28):** x", "Pool AMENDMENT CORRECTED (2026-07-28"],
  ])("tries a verb a rejected noun's run swallowed: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it.each([
    ["## **Settled** 29 Sep 2026", "Settled 29 Sep 2026"],
    ["## **Addendum**, 22 Aug 2026 — a rebase", "Addendum, 22 Aug 2026"],
    ["**SCOPE SETTLED and changed, 3 Sep 2026:** wider.", "SCOPE SETTLED and changed, 3 Sep 2026"],
  ])("reads a heading whole, and a joined pair by its first verb: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it.each([
    ["**(Updated 3 Sep 2026):** the pool is 15.", "(Updated 3 Sep 2026"],
    ["**[Updated 3 Sep 2026]** the pool is 15.", "[Updated 3 Sep 2026"],
    ["**Their notes; updated 3 Sep 2026:** x", "Their notes; updated 3 Sep 2026"],
  ])("reads a first word behind an opening bracket, and a verb after a semicolon: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it("reads a code span as the word it renders as, so a separated date after it still fires", () => {
    expect(datedAddenda({ text: memory({ body: "**Updated `foo`, 29 Sep 2026:** x\n" }) })).toEqual([
      { leadIn: "Updated `foo`, 29 Sep 2026", line: 8 },
    ]);
  });

  it("still splits a real ordered list, whose second item opens its own paragraph", () => {
    const body = "1. The rule.\n2. **Corrected 12 Aug 2026:** the other flag.\n";

    expect(datedAddenda({ text: memory({ body }) })).toEqual([{ leadIn: "Corrected 12 Aug 2026", line: 9 }]);
  });

  it("quotes a code span as written, so a rewrap after the date keeps the key", () => {
    const before = datedAddenda({
      text: memory({ body: "**Scope of `slack send`, settled 29 Sep 2026 (option C):** DMs only.\n" }),
    });
    const after = datedAddenda({
      text: memory({ body: "**Scope of `slack send`, settled 29 Sep 2026 (option C on\nthe card):** DMs only.\n" }),
    });

    expect(before).toEqual([{ leadIn: "Scope of `slack send`, settled 29 Sep 2026", line: 8 }]);
    expect(after).toEqual(before);
  });

  it("counts the line from the top of the file, frontmatter included", () => {
    expect(datedAddenda({ text: memory({ body: "**Settled 29 Sep 2026:** final.\n" }) })).toEqual([
      { leadIn: "Settled 29 Sep 2026", line: 8 },
    ]);
  });

  it("stops the quoted date at the month when a count, not a year, follows it", () => {
    expect(datedAddenda({ text: memory({ body: "**Settled 3 Sep, 1200 rows:** final.\n" }) })).toEqual([
      { leadIn: "Settled 3 Sep", line: 8 },
    ]);
  });

  it("quotes the same lead-in whatever follows the date, so an edit there keeps a standing addendum's key", () => {
    const before = datedAddenda({ text: memory({ body: "As of 2026-07-27 the list has three entries.\n" }) });
    const after = datedAddenda({ text: memory({ body: "As of 2026-07-27 the list\nhas four entries.\n" }) });

    expect(after.map((hit) => hit.leadIn)).toEqual(before.map((hit) => hit.leadIn));
  });

  it("names the lead-in and no line number, so a standing addendum keeps one message as lines shift", () => {
    expect(datedAddendumMessage({ leadIn: "Settled 29 Sep 2026:" })).toBe(
      "`Settled 29 Sep 2026:` dates an amendment — rewrite the memory in present tense as if it had always read this way; a date that anchors when the owner said something opens with the owner's words, not an amendment word",
    );
  });
});

describe("an anchor to when the owner said something stays silent", () => {
  it.each([
    ["their words", "**Their words, 7 Aug 2026:** _never again_."],
    ["a parenthesised date after the words", "**The bar, in their words (23 Aug 2026, voice):** keep it short."],
    ["a Why paragraph mentioning `since` after its bold span", "**Why always-loaded:** true since 28 Sep 2026."],
  ])("%s", (_label, body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
  });

  it.each([
    ["a count whose noun starts like a month", "Since 3 separate runs failed, the gate is manual."],
    ["a name that starts like a month", "**Added 2 Mary Chen as a reviewer:** both approved."],
    ["a street that starts like a month", "**Updated 3 Jane Street rows:** all of them."],
    ["a store that starts like a month", "Since 2 Mart stores closed, the list is short."],
    ["a count of decisions", "- Added 2 decisions to the register."],
    ["an ordinal opening a count", "Second, 2 decisions stand."],
    ["`now` opening a count", "Now 5 augmented checks run."],
    ["`since` mid-sentence, stating a fact", "The gate has run since 3 Sep 2026 on every push."],
    ["a past-tense fact about an outside event", "The Datadog monitor was added on 12 Sep 2026 by the platform team."],
    ["a person changing something", "Ari changed the retry cap on 3 Mar, and it has held since."],
    ["a list item reporting a landing", "- Dependabot updates landed 3 Sep 2026 in both repos."],
    ["an instruction with a deadline", "Update the lockfile before 3 Mar, or CI fails."],
    ["a path in a code span", "The report file is `reports/added-2026-09-30.md` for that run."],
    ["`since` opening an event rather than a date", "Since the 12 May outage, retries are capped."],
    ["a hyphenated ordinal", "**Second-order effects appeared after 3 Mar.**"],
    [
      "a bold rule sentence dating an outside event",
      "**The monitor was added on 12 Sep 2026 and it pages\nthe on-call.**",
    ],
    ["a bold instruction naming when", "**Never revert the pool size changed on 3 Sep 2026.** It fixed it."],
    ["an incident heading", "## What changed on 3 Sep 2026"],
    ["an ordinal naming provenance", "**Second opinion (Codex, 3 Sep 2026):** the plan holds."],
    ["a SQL statement in prose", "A bulk UPDATE on 3 Sep 2026 rewrote 12k rows."],
    ["their correction, as a noun", "**Their correction, 5 Aug 2026:** _never card it_."],
    ["a vendor's update", "**Slack's rate-limit update, 29 May 2025:** one request a minute."],
    ["a release's update", "**The Node 22 update (3 Sep 2026):** breaks the build."],
    ["a platform update in a list", "- **macOS 26 update, 15 Sep 2026** breaks the socket path."],
    ["a bot's updates in a list", "- **Dependabot updates, 3 Sep 2026** — grouped by ecosystem."],
    ["an incident heading naming its date", "## What changed (3 Sep 2026 outage)"],
    ["a shouted SQL word inside a label", "**A bulk UPDATE (3 Sep 2026) rewrote 12k rows.**"],
  ])("%s: each was read as an amendment", (_label, body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
  });

  it("a wrapped sentence that happens to start a line with `correction`", () => {
    expect(
      datedAddenda({ text: memory({ body: "They stated it in their own\ncorrection, 5 Aug 2026, plainly.\n" }) }),
    ).toEqual([]);
  });

  it("the same lead-in inside a fenced block", () => {
    expect(datedAddenda({ text: memory({ body: "```\n**Settled 29 Sep 2026:** example\n```\n" }) })).toEqual([]);
  });

  it("a dated amendment word in the frontmatter description", () => {
    const text = "---\nname: thing\ndescription: added 12 Sep 2026\n---\n\nThe rule.\n";

    expect(datedAddenda({ text })).toEqual([]);
  });
});

describe("the stated blind spots stay blind, so the residue is witnessed rather than claimed", () => {
  it.each([
    ["**`rate-limit` update, 29 May 2025:** x"],
    ["**`node@22` update (3 Sep 2026):** x"],
    ["**`gh` correction, 5 Aug 2026:** x"],
    ["## `pnpm` added 12 Sep 2026"],
    ["`cfg` Since 3 Sep 2026 the step is manual."],
    ["**`cfg` As of 2026-07-27, the list:** x"],
  ])("a code span opening a lead-in is its first word, never blank: %s", (body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
  });

  it.each([
    ["**Settled `pool.max` 29 Sep 2026:** x"],
    ["## Changed `retry` 3 Sep 2026 incident"],
    ["The CONFIRMED `x` 14 Oct 2026 date."],
    ["As of `x` 2026-07-27 the list has three."],
    ["Since `v2` 28 Sep the step is manual."],
    ["Set `a` `b` `c` `d` `e` `f` `g` `h` `i` then CORRECTED 2026-07-28."],
    ["Run `slopweaver memory gate --accept --dir /x/y/z --json --quiet` once the list is CONFIRMED 14 Oct 2026."],
    ["**Superseded a b c `d` (25 Aug 2026):** x"],
  ])("a code span is one word, never a gap: %s", (body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
  });

  it.each([
    ["**Retry cap--updated 3 Sep 2026:** it is 5.", "Retry cap--updated 3 Sep 2026"],
    ["## Retry cap-- updated 3 Sep 2026", "Retry cap-- updated 3 Sep 2026"],
    ["**Updated: 3 Sep 2026** it is 5.", "Updated: 3 Sep 2026"],
    ["## Update: 3 Sep 2026", "Update: 3 Sep 2026"],
    ["**Updated — 3 Sep 2026:** it is 5.", "Updated — 3 Sep 2026"],
  ])("a glued dash opens a phrase, and a colon or dash may hang the date off the verb: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it.each([["**Self-updated 3 Sep 2026:** x"], ["**Their words: 7 Aug 2026:** x"]])(
    "a hyphen inside a word is not a dash, and a colon hangs a date only off a verb: %s",
    (body) => {
      expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
    },
  );

  it.each([
    ["**OPTION C CONFIRMED: 29 Sep 2026.** Asks go to the queue.", "OPTION C CONFIRMED: 29 Sep 2026"],
    ["**TIER 3 WIDENED — 12 Sep 2026.** x", "TIER 3 WIDENED — 12 Sep 2026"],
    ["**ISO 27001 CONFIRMED (14 Oct 2026):** x", "ISO 27001 CONFIRMED (14 Oct 2026"],
    ["**RULE-10 AMENDED, 26 Sep 2026:** x", "RULE-10 AMENDED, 26 Sep 2026"],
    ["How to apply: CORRECTED: 2026-07-28. Use the other flag.", "How to apply: CORRECTED: 2026-07-28"],
  ])("a shouted phrase is its capitalised words, a letter or a number among them: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it.each([
    ["- **AUTO-UPDATED 3 Sep 2026** by Dependabot; the lockfile pins 4.2."],
    ["**SELF-CORRECTED, 3 Sep 2026:** the pool recovered without a restart."],
    ["## AUTO-UPDATED 3 Sep 2026"],
    ["**CI-UPDATED 3 Sep 2026:** x"],
  ])("a shouted hyphenated word is one word, whose verb continues no phrase: %s", (body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
  });

  it.each([
    ["**OPTION C (CONFIRMED 29 Sep 2026):** asks go to the queue.", "OPTION C (CONFIRMED 29 Sep 2026"],
    ["**SCOPE (CHANGED 3 Sep 2026):** wider.", "SCOPE (CHANGED 3 Sep 2026"],
    ["**DECISION (REVERSED 12 Sep 2026):** the pool stays at 15.", "DECISION (REVERSED 12 Sep 2026"],
  ])("a parenthesis opens a new word a shout continues into: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it.each([
    ["How to apply--CORRECTED 2026-07-28. Use the other flag.", "How to apply--CORRECTED 2026-07-28"],
    ["Pool size--SETTLED 29 Sep 2026: it stays at 15.", "Pool size--SETTLED 29 Sep 2026"],
    ["How to apply -CORRECTED 2026-07-28. Use the other flag.", "How to apply -CORRECTED 2026-07-28"],
  ])("a dash glued to a shouted verb starts its word in prose as in a label: %s", (body, leadIn) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([{ leadIn, line: 8 }]);
  });

  it("a shouted verb joined by a slash is one word in prose", () => {
    expect(datedAddenda({ text: memory({ body: "Columns CREATED/UPDATED 2026-09-03 on every row.\n" }) })).toEqual([]);
  });

  it("a verb inside a hyphenated word is quiet in prose too", () => {
    const body = "- AUTO-UPDATED 3 Sep 2026 by Dependabot; the lockfile pins 4.2.\n";

    expect(datedAddenda({ text: memory({ body }) })).toEqual([]);
  });

  it("a shout stops at a parenthesis the way a word does", () => {
    expect(datedAddenda({ text: memory({ body: "**Pool(OPTION C CONFIRMED: 29 Sep 2026)** x\n" }) })).toEqual([
      { leadIn: "Pool(OPTION C CONFIRMED: 29 Sep 2026", line: 8 },
    ]);
  });

  it("a lone capital is no shouted phrase, so a verb after it does not open one", () => {
    expect(datedAddenda({ text: memory({ body: "**What I CHANGED 3 Sep 2026:** x\n" }) })).toEqual([]);
  });

  it("an ordinal past Third, which was never measured", () => {
    expect(datedAddenda({ text: memory({ body: "**Fourth data point, 22 Aug 2026:** again.\n" }) })).toEqual([]);
  });

  it("a raw-HTML line interrupting a tight list item's paragraph", () => {
    expect(datedAddenda({ text: memory({ body: "- a\n  <div>CORRECTED 2026-07-28 x\n" }) })).toEqual([]);
  });

  it("an amendment that does not open its paragraph", () => {
    expect(
      datedAddenda({ text: memory({ body: "The step runs daily.\nSince 28 Sep the step is manual.\n" }) }),
    ).toEqual([]);
  });

  it.each([
    ["a label reaching its date past a clock time", "**CORRECTED same day, ~15:30 27 Aug:** it was wrong."],
    [
      "a `Now` label, the word dropped because `Now 5 checks run` is a count",
      "**Now structural, PR #503 (26 Aug 2026).**",
    ],
    [
      "a possessive before the verb, the price of `Their correction` staying quiet",
      "**The owner's correction (2026-08-11):** x.",
    ],
  ])("%s", (_label, body) => {
    expect(datedAddenda({ text: memory({ body: `${body}\n` }) })).toEqual([]);
  });

  it("a dated lead-in carrying no amendment word", () => {
    expect(datedAddenda({ text: memory({ body: "**Routing, 29 Sep 2026:** asks go to the queue.\n" }) })).toEqual([]);
  });
});
