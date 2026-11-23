# The checklist — a step the owner runs through like a script

The owner's ask, on the SecOps note that put two `secrets set` lines in one block: put commands the owner needs to
run in copy blocks, one click to copy with "copied"; separate secret-setting commands, since they have to run one at
a time; show where on the page each field should be retrieved from (for example, for google-secops-client-id, under "Additional
information > Client ID"); and, for things that require a human hand, explain like they are 5, make it like a Playwright
script for them to run through in their head, with instructions they can check off as they go.

So a step with more than one thing for the owner's hands is a `--checklist`: a JSON list of lines, each one plain sentence the owner
ticks, at most ONE command of the owner's, and — for a value the owner fetches — where it sits on the page, outermost label first.

```bash
slopweaver hand post --id secops-desktop-oauth-client --row secops-atlas --blocks \
  --what "Make a Desktop sign-in client for SecOps and store its two values" \
  --checklist '[
    {"action": "Open the Credentials page for the SecOps project", "url": "https://console.cloud.google.com/apis/credentials"},
    {"action": "Click Create credentials, then OAuth client ID"},
    {"action": "Pick Desktop app, name it slopweaver-secops, then click Create"},
    {"action": "Store the Client ID", "command": "slopweaver secrets set google-secops-client-id",
     "find": ["Additional information", "Client ID"]},
    {"action": "Store the Client secret", "command": "slopweaver secrets set google-secops-client-secret",
     "find": ["Client secrets", "Client secret"]}
  ]' \
  --unblocks "the SecOps atlas, which cannot read detections until both values are stored" \
  --witness "slopweaver hand done secops-desktop-oauth-client --did stored"
```

## What the schema refuses, and what it cannot

The shape is the record's, never a reviewer's (rule 7). `src/hand/checklist.ts` refuses, naming the line:

- more than 12 lines; a line of two sentences, or past 160 characters; a key other than `action`, `command`, `find`, `url`;
- a command over two lines, or holding two of the owner's commands (`a && b` counts both) — give each its own line;
- a `secrets set` line with no `find`, and a `find` label carrying its own `>`/`›` — the renderer draws the separator;
- a command the fleet can run itself, and a word that is the fleet's and not the owner's (`slopweaver talk glossary`);
- a `--literal` beside a `--checklist`, and a `--literal` holding two command lines or two of the owner's commands — unless
  every one is a `secrets set`, which the queue card replaces with a paste field per name rather than a copy block
  ([pasting a secret](pasting-a-secret.md)). That literal names no place for its values, so a step whose values sit
  somewhere the owner has to find is still a checklist, its pages and `find` labels on the lines before.

A line's `url` is its page, so a sign-in step whose first line opens the page needs no top-level `--url`. Whether a
sentence reads like the owner is five is the poster's judgement: no pattern can read that, and nothing pretends to.

## On every surface

- **The queue card** draws the lines ABOVE the fold — a numbered list with a checkbox per line (ticks kept per step in
  the browser), `Find it under: A › B`, the page's link, and one copy block per command whose button reads `copied ✓`.
  A `secrets set` line whose name has a paste field keeps its sentence and `Find it under`, and drops its copy block:
  the field under the card stores it (`site/lib/handCardTexts.ts`), so say "Store the …", never "when the terminal asks".
- **The Fleet Briefing** (`briefing render --hand-steps`) draws the same list, a paste block per command.

## On the note

Each line is a row: `☐ 1. <action>` the owner clicks to tick, `Find it under: …`, `Open the page ›` when the line has one,
and the command in mono the owner clicks to copy, captioned `click the command to copy it` until the owner's clipboard holds it,
then `copied ✓` — the same per-poll check the literal's caption runs ([the note](the-note.md)). Every control is a
transparent push-on/push-off overlay read each poll, never an ObjC closure, and a tick IS its overlay's state.
**Nothing is copied at launch**: the commands run one at a time, and copying the first unasked would put a secret's
prompt on the owner's clipboard before the owner has opened the page holding its value. Source: `src/hand/note/checklist.ts`.

## An ask's command is a paragraph of its own

The same ask reached recorded questions: the mds card drew its `sudo` line as prose. `handover ask`, `correct` and
`register` refuse a question naming a command of the owner's inside a sentence (`src/handover/cardAlignment.ts`); a paragraph
whose every line opens on one of the owner's programs (`OWNER_PROGRAMS`, `src/hand/runnableLiteral.ts`) and is not the lead is
lifted into one copy block per line (`src/handover/commandParagraphs.ts`, mirrored by `site/lib/askCommands.ts`).
