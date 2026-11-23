# The Drive boundary (`drive`)

Part of [Security & trust](../security.md).

The Drive door is the mail door's twin in shape and its opposite in reach: it holds a credential that can
see every file the owner can open, and it has no verb that changes one. Six things are stated here rather
than left to be inferred.

- **It listens on a socket, once, for the same reason `gmail connect` does.** `drive connect` runs the same
  shared loopback consent flow (`src/live/google/consent.ts` over `src/live/oauth/loopback.ts`), with the same bounds: the loopback interface
  only, an ephemeral port the kernel picks, one request served and then closed, and a deadline that tears it
  down whether or not anything arrives. It cannot outlive the `drive connect` invocation that opened it, and
  nothing outside your machine can reach it.
- **The grant is its OWN file, and that is a security property.**
  `$SLOPWEAVER_HOME/secrets/drive-oauth.json`, mode `0600` under the `0700` `secrets/` directory, separate
  from `gmail-oauth.json`. `drive connect --status` reports only what the Drive door can reach, and the
  wide `drive.readonly` scope never appears on a consent screen the owner opened to read their mail. The
  OAuth CLIENT is shared, because it identifies the application rather than the account — which is why
  revoking, whether by `drive connect --revoke` or at <https://myaccount.google.com/permissions>, withdraws
  the whole grant at Google and takes the mail and calendar doors with it. No token material is ever
  logged, printed, or returned by a status call.
- **The default grant cannot read a file.** `--grant metadata` is `drive.metadata.readonly`: it enumerates
  and describes every file — names, types, sizes, owners, parents, dates — and cannot read one byte of any
  of them. `--grant read` adds `drive.readonly`, which can. `drive list` and `drive drives` need only the
  narrow one, so an install that answers "what is in here and who owns it" never hands this application the
  ability to open the files. The grant records what Google ACTUALLY approved, so a narrowed consent is
  reported on the spot and the verb needing the missing scope refuses by name rather than failing at the API
  with a 403 that names nothing.
- **The grant can carry two write scopes, and no verb spends them.** `--grant write` adds `drive.file` —
  create a file, and read, edit or delete only files this application created or the owner opened with it — and
  `documents`, Google Docs read and write, which has no delete method at all (`src/live/drive/scopes.ts`).
  The owner's ruling: write on the owner's own data, never, in the owner's words, stuff that allows the owner
  and the fleet to wipe company drives — so the full
  `drive` scope, the one that can delete across a shared drive, is not requestable, and
  `actsOnlyAsTheBoundAccount.test.ts` fails if it is added. The write verbs are the named next step.
- **Nothing is written, and nothing enters the corpus.** `drive read` output is
  **UNREDACTED**, exactly as `gmail read` and `slack read-thread` are, and for the same reason: it is what
  the owner asked to see. It is not stored. There is no `refresh --source drive` in this build, so no Drive
  file lands in bronze; the one Drive-adjacent thing that DOES enter the corpus is a meeting transcript,
  which arrives through the mail lane's `documents.readonly` scope and is described under
  [The mail boundary](mail-boundary.md#the-mail-boundary-gmail).
- **A binary file's bytes stay on Google's servers.** `drive read` exports text only from Google-native
  documents (a Doc as plain text, a Sheet as CSV, a deck as plain text). For anything else it reports the
  file's metadata and says in its own residue that nothing in the answer reflects its content — it does not
  download the bytes, and it does not fail either.
