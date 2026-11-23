# Turning a thread into an SOP

Bundled reference for the `sop` skill, and the procedure a bot turn follows when a tag asks for one. Loaded
when the body links here, not on every use.

## The shape of the turn

**Read the thread → check the SOP does not already exist → fill the form from what people said → draft →
lint → publish private → verify in a browser → reply with the link and what you could not confirm.**

## 1. Read the thread, and read it wide enough

`/slopweaver:slack-read-thread`, with judgment about depth. An SOP written from the last four messages of a
thread documents the fix, not the procedure. What you are looking for is different from what an answer needs:

- **the trigger** — what someone was doing when they hit this;
- **who actually did each step**, in their own words, not who you would expect to;
- **the exception somebody mentioned in passing** ("except for contractors", "unless it's after 5") — those
  are the rows that make the page answer the next question instead of raising it;
- **what nobody in the thread knew.** That is a real finding and it belongs in the reply, not silently
  smoothed into a step you invented.

## 2. Check it does not already exist — before you write a second one

An ask to write an SOP ASSUMES there is no SOP. That is a present-state claim, it is the first thing your
whole page rests on, and it is one search away:

```bash
slopweaver store cite "<the procedure, in the words the org would use>"
```

A second page covering the same ground is worse than no page: the next reader finds one of them and cannot
tell which is current. If one exists, say so with its link and ask whether to update it instead — `sop
publish --page <id>` replaces a page in place, keeping its URL.

## 3. Fill the form from what people SAID

`slopweaver sop draft --form-example` prints a valid one. Two rules while filling it:

- **Never invent a step to make the procedure look complete.** If the thread does not say who approves
  something, that gap goes in `exceptions` or `escalation` as the open question it is. A confidently written
  wrong step is the worst thing this capability can produce.
- **`owner` is a real person who has agreed, or the person the thread already treats as owning it.** Do not
  appoint somebody. If nobody owns it, say so in your reply and name that as the thing to settle.

## 4. Publish private, verify, reply

```bash
slopweaver sop publish sop.md --parent <page-url> --dry-run   # read back the exact bytes
slopweaver sop publish sop.md --parent <page-url>
slopweaver notion verify <page-url>                            # 0 clean · 3 findings · 1 could not check
```

Then reply in the thread with the link, the one-line summary, and — this part is not optional — **what you
could not confirm**: the step nobody stated, the owner nobody named, the exception you inferred. The page
carries the unreviewed-draft notice for the same reason; do not tell the thread it is approved.

## What the turn must NOT do

- **Do not tag anybody.** Not the named owner, not the person whose process it is.
- **Do not share it anywhere else, or move it.** One private page under the parent you were given.
- **Do not announce it.** Telling the team a procedure now exists is the owner's act, under the owner's own name.
- **Do not create a new Notion location** — a database, a parent, an "SOP repository" — because it would be
  tidier. That is the owner's word, every time.
