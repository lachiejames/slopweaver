# Searching a Drive — the `q` expression, folders, and the shared-drive trap

`drive list` passes `--query` to Google's own search grammar untouched, and adds two bounds of its own
before it goes: trashed files are excluded unless `--trashed` is given, and `--folder <id>` becomes Drive's
own `'<id>' in parents` clause so the restriction is applied AT the provider rather than by filtering
afterwards. That matters because a bound applied afterwards would make the page size mean something
different from what it says.

## The expressions worth knowing

| what you want                | `--query`                                           |
| ---------------------------- | --------------------------------------------------- |
| a name fragment              | `name contains 'budget'`                            |
| an exact name                | `name = 'Board pack Q3'`                            |
| only Google Docs             | `mimeType = 'application/vnd.google-apps.document'` |
| only folders                 | `mimeType = 'application/vnd.google-apps.folder'`   |
| changed since a date         | `modifiedTime > '2001-01-01T00:00:00'`              |
| owned by a person            | `'someone@example.test' in owners`                  |
| shared with the account      | `sharedWithMe = true`                               |
| full-text, including content | `fullText contains 'runbook'`                       |

Google's grammar quotes string literals with SINGLE quotes, so a shell needs the whole expression in double
quotes: `--query "name contains 'budget'"`. Clauses combine with `and` / `or`, and the door wraps whatever
you pass in parentheses so an `or` inside it cannot escape the bounds around it.

## The shared-drive trap, which is the one that actually bites

A Drive looks like one thing in the browser and is not. `drive list` with no `--drive` searches **My Drive
and what is shared into it**. A file that lives in a shared drive is in a different corpus and does not
appear, with no error and nothing in the result hinting at it — which is why the listing's own residue says
so on every such read.

So: before reporting that a file does not exist, run `drive drives`, and search the drive it would plausibly
be in. `drive drives` prints the id and the name; `--drive <id>` searches that one instead.

My Drive is not a shared drive and has no id. It is simply what `list` searches when `--drive` is absent.

## Folders

A folder is a FILE in Drive's model, with the type `application/vnd.google-apps.folder`. So:

- `drive list --folder <id>` lists a folder's **direct children only** — it does not recurse, and a
  subfolder appears as one row rather than as its contents.
- `drive read <folder-id>` reads the folder's own metadata (who owns it, when it changed) and says in its
  residue that the contents were not listed. That is the read to reach for when the question is about the
  folder; `--folder` is the one for what is in it.
- A file can sit in more than one parent, so `parents` is a list rather than a path. There is no verb that
  renders a full path, because building one costs a call per level and Drive has no single answer for a
  file with two parents.
