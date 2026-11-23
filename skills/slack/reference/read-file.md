# Reading one file, and a huddle's transcript

What `slack read-file` resolves, what it does not, and the privacy rule a huddle transcript carries.

It posts nothing. Give it a Slack file id or any
Slack file/canvas/`/docs/` link and it reports the file, downloads its bytes under
`$SLOPWEAVER_HOME/live/slack/file-reads/`, and prints the text for a filetype that has any:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" slack read-file F0SYN123ABCD
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" slack read-file https://example.slack.com/docs/T01/F0SYN123ABCD --json
```

**A PDF's words come back, not just its path.** The bytes decide, not the mimetype the uploader's client
sent: any attachment whose first five bytes are `%PDF-` is extracted, up to 50 pages, and the text is
printed under a heading carrying the page count. A `slack read-thread` carrying one inlines the same text
beside the message that posted it, so a session answering a tag can use the document rather than being told
where it is. **This is not OCR** — a scanned or image-only PDF has no text layer, and both verbs say
`no extractable text` rather than printing an empty body. `slopweaver pdf read <path>` is the same
extractor over a file you already have.

A **huddle** is why this verb exists. Slack stores one as two objects: the notes CANVAS a person can edit,
and an auto-generated TRANSCRIPT the canvas names in `huddle_transcript_file_id`. `read-file` follows that
link for you — `--no-transcript` reads the notes alone — prints the transcript as `[mm:ss] speaker: words`,
and reports the huddle's start and end times, and the AI-summary id it deliberately does **not** read (a
summary is Slack's paraphrase; this verb is for what was said).

**Treat the output the way `docs/security/slack-huddles.md` treats a huddle, the same as mail.** A huddle transcript is one conversation between
named people who agreed to talk to each other, not to publish — never paste it anywhere its participants are
not. The corpus enforces the same thing without being asked: a `huddle` record is stamped private by its
KIND, so it can never be served to a non-owner.

**What it will and will not get you, measured on one workspace.** Metadata always resolves.
Bytes resolve for ordinary uploads. They do NOT resolve for a canvas or a `huddle_transcript` file: Slack
serves those to a browser session and not to a bearer token — `files-pri` answers 302 to the workspace root
with `files:read` granted and `file_access: visible`. The verb says so in its residue rather than pretending.

**A transcript's words are not its bytes, and they come back to a token.** `files.info` returns them inline
under Slack's undeclared `include_transcription=true`, which is what the web client sends; the same call
answers the USER token (`xoxp`, `files:read`) with no cookie and no browser. So `read-file` prints a huddle
transcript today. It needs the user token: the BOT token gets `file_not_found` for a huddle held in a DM it
is not in, which is membership rather than a missing scope.

Find huddles rather than guessing at ids: `slopweaver atlas slack` counts every huddle in the corpus, how
many name a transcript, and how many have their WORDS in the corpus — and once the words are there,
`slopweaver store read` and `slopweaver store cite` search them like anything else. A huddle whose words are NOT stored
carries the exact `read-file` command in its record text.
