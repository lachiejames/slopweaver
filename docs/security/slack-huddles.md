# Huddles (`slack read-file`, and the corpus `huddle` kind)

Part of [Security & trust](../security.md).

A huddle is a recorded call, and it is the most private thing this product reads out of Slack. Two mechanisms
bound it, and both are stated here rather than left to be inferred from the code.

- **A `huddle` record is private by KIND, not by stamp.** `src/corpus/visibility.ts` carries a set of
  always-private KINDS beside its always-private SOURCES, and `huddle` is its only member. A huddle record
  therefore reads back private with or without its field, and can never be served to a non-owner — the same
  treatment mail gets, for a related reason: mail's counterparties never joined this workspace, and a
  huddle's participants agreed to talk to each other rather than to publish. It cannot come from the source
  (Slack plainly has a public lane) and it must not come from the containing channel, because a 1:1 huddle's
  notes are discovered through a workspace-wide `files.list` and filed into DMs — so a lane-derived stamp
  would be deciding a call's privacy from where its notes happened to land.
- **The corpus holds the WORDS, not only the pointer.** `files.info` returns a transcript inline when asked
  for `include_transcription=true`, so `refresh` stores what was said, chunked, on `huddle` records that are
  private by kind. **A store read can therefore quote a call, not only say it happened.** Everything below
  bounds who can ever see that — the kind stamp, the owner-only corpus, and the no-egress default — and
  `slopweaver atlas slack` reports the words count separately from the pointer count so it is visible how
  much of this the corpus holds.

**`slack read-file` output is UNREDACTED**, exactly as `slack read-thread` and `gmail read` are, and for the
same reason: redacting a document you asked to read makes it useless. It downloads bytes under
`$SLOPWEAVER_HOME/live/slack/file-reads/`, mode 0600, and it can only ever read — there is no write verb in
this family.

**What Slack will actually give a token, measured on the owner's own account.** `files.info`
resolves any file's metadata, huddle fields included. Bytes resolve for ordinary uploads. They do NOT resolve
for a canvas or a `huddle_transcript` file: `files-pri` answers 302 to the workspace root with `files:read`
granted and `file_access: visible`, so those two are served to a browser session and not to a bearer token.
The verb reports that in its residue rather than presenting an empty read as a successful one.

A transcript's WORDS are a separate question from its bytes, and they DO resolve to a token. Slack's web
client fetches them with `files.info file=<transcript id> include_transcription=true`, an argument
`@slack/web-api` does not declare, and the same call answers our USER token (`xoxp`, `files:read`) with no
cookie, no session and no browser. The BOT token answers `file_not_found` for a huddle held in a DM it is not
in — membership, not scope. So no browser lane was built and none is needed; nothing in this product reads a
session cookie.
