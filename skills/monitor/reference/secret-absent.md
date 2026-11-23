# `secret-absent`: a row nobody set

A register split can add a required row that no command ever asks the owner for. The Google consent split
added `google-admin-client-id` and `google-admin-client-secret` beside the user-data pair already stored, and the
Admin door stayed shut until an answer needed it. `secrets status` hides an `absent` row by default, because an
unconnected source is not news, and nobody runs it unasked. This monitor says so unasked. The other monitors:
[the monitors](the-monitors.md).

- **The criterion** (`src/monitor/secretAbsent.ts`). A register row is a subject when it is `live` and `settable`,
  it is not stored, it is not marked `optional`, and at least one OTHER live row in its group IS stored, in any
  state. Its group is every row with the identical `platform` string, plus any row it names in
  `absentMattersWith`. A platform with nothing stored stays silent: that is an unconnected source, not a gap.
- **Two register fields steer it** (`CredentialSpec`, `src/secrets/credentials/spec.ts`), and neither touches the gate-checked doc table.
  `optional: true` says an absent file is a supported configuration (`jumpcloud-org-id`). `absentMattersWith`
  links a row platform prose cannot group: `backup-passphrase` (the backup master password) names
  `store-backup-directory`, because a stored destination with no master password is a nightly backup recorded
  `secrets: null` with its key NOT wrapped, succeeding without its credentials leg and openable only on this
  Mac. The card's paste puts back the password already saved; with none, the fleet runs
  `slopweaver store backup --create-master-password` itself, never a hand step. The link is one-way.
- **Grants are never folded onto a base platform.** `Google (mail door)` and its siblings are matched exactly;
  folding them onto `Google` would card every door the owner never connected, and a grant's remedy is a `connect` flow,
  not a paste. A retired row is not evidence a platform is in use, and a stray file is not a row.
- **The card.** _Store the `<name>` secret on this machine — it is missing beside ones already stored_, one per
  file (`perSubject`), `work` context, with the row's `writtenBy` (`slopweaver secrets set <name>`, pinned for
  every live settable row by `unit/secrets/registry.test.ts`) on the owner's pasteboard. That command prompts without
  echoing. `unblocks` names the verbs that read it and the stored rows beside it. No `floats`: no ruling of the owner's
  asks for a note here, so it reaches the owner through the queue and `--push`'s one banner.
- **Names only.** The source lists `secrets/` file names (`src/secrets/listing.ts`) and opens nothing. A missing
  directory is an empty store; any other listing failure — a `secrets` link whose target is gone included — is
  `unmeasurable`, never clear.
- **Residue.** A split onto a brand-new platform string with nothing stored stays silent until a row declares
  `absentMattersWith`. A partial Slack install, or a Google one that connected only the admin or only the
  user-data doors, fires on a row it may never use; `optional` is the remedy. A token supplied only through an
  environment variable is carded as missing: this reads the store, never the environment. The card arrives on the next pass, under the same next-pass limitation as every
  monitor.
