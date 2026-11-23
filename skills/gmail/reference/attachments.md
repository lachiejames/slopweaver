# Fetching an attachment — one part, saved owner-only

How `gmail attachment` names the part, where the bytes land, and what it refuses. The rule — a read reports
attachments and downloads none, so open the saved file before claiming its contents — is in
[SKILL.md](../SKILL.md).

```bash
slopweaver gmail read <message-id>                          # lists each attachment: filename, type, size
slopweaver gmail attachment <message-id> --name "notes.txt"   # saves that one and prints READ THIS: <path>
```

It needs only the `read` grant (`gmail.readonly`). Nothing in the mailbox changes.

## Naming the part

- `--name <filename>` is the exact filename `gmail read` printed, quoted as a whole shell argument.
- `--part <partId>` is Gmail's address for the part inside the message (`1`, `2.1`). Two attachments often share
  a filename (`image.png`, `invite.ics`), and then `--name` alone is refused with every match listed by part id,
  mime type and size. Re-run with `--part` from that list.
- Give at least one. Given both, both must match.

## Where the bytes land

`$SLOPWEAVER_HOME/live/gmail/attachments/<message-id>/<partId>-<safe name>`, the file `0600` and the directory
`0700`, written atomically. The safe name is the filename with every character outside `[A-Za-z0-9._-]` turned
into `_`, the stem capped at 100 characters, and a short extension kept. The sender picks the filename, so it
never decides the path: the result is checked to sit directly inside the message's directory, the message id
comes from Gmail's own response and must be alphanumeric, and a symlinked directory is refused.

The file is **UNREDACTED**, as a `gmail read` body is. Reading it brings the content into this session, and it
leaves the machine with the session. **Never commit it, and never copy it into a fixture.**

## What it refuses, and what each refusal means

| code                          | what happened                                                            | what to do                            |
| ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `ATTACHMENT_SELECTOR_MISSING` | neither `--name` nor `--part` was given                                  | name the part                         |
| `ATTACHMENT_NOT_FOUND`        | nothing matched; the message lists what it does carry                    | pick one from that list               |
| `ATTACHMENT_AMBIGUOUS`        | several parts matched                                                    | add `--part` from the list            |
| `ATTACHMENT_TOO_LARGE`        | over `--max-file-mb` (default 25), refused **before** any bytes arrived  | raise the ceiling if it is wanted     |
| `ATTACHMENT_SIZE_MISMATCH`    | the decoded bytes are not the length Gmail reported; **nothing written** | re-run once; if it repeats, report it |
| `DESTINATION_UNUSABLE`        | the directory is a symlink, unwritable, or the path would escape it      | fix the home, never the check         |

The 25 MB default is Google's own per-message limit, so it rarely applies. A fetch holds about twice the file
in memory, because the bytes arrive base64url-encoded inside JSON.

## What `--json` carries

The shared provider-read document, with `target.kind: "attachment"` and `data` holding the account, message id,
part id, filename, mime type, decoded byte count and `localPath`. It does not contain the bytes or Gmail's
attachment token. Gmail issues a new token on every read, so nothing keeps it.
