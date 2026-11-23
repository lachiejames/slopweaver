# Initiatives, and images in a Linear message

Two capabilities of the Linear door. The full write surface, and how it compares to Linear's own
MCP server, is [docs/linear-write-surface.md](../../../docs/linear-write-surface.md).

## `linear initiative <create|update|link>`

An initiative is the layer ABOVE a project: it groups projects toward one outcome, carries its own status and
target date, and reports on its own cadence.

```bash
slopweaver linear initiative create --form - --dry-run <<'JSON'
{"fields":{"name":"Cut onboarding to one day","description":"One line, never markdown.",
           "status":"Planned","targetDate":"2001-12-31"}}
JSON
slopweaver linear initiative update --form - --initiative-id <uuid>
slopweaver linear initiative link --form '{"fields":{"initiativeId":"<uuid>","projectId":"<uuid>"}}'
```

- **`status` is a CLOSED five-value enum** — `Proposed`, `Planned`, `Active`, `Completed`, `Canceled`,
  capitalised because that is Linear's wire format. This is the one place an initiative differs from a
  project in kind rather than in degree: a project's `statusId` is workspace-configurable and therefore
  opaque to this repo, while `InitiativeStatus` is fixed in the schema, so the form refuses a wrong value
  locally instead of letting the provider do it.
- **`link` is a sub-verb rather than a field** because Linear models the attachment as its own object
  (`InitiativeToProject`). Its id is derived from the two endpoints alone, so the same project cannot be
  filed under the same initiative twice. There is no unlink verb.
- **`update` needs `--initiative-id`** and touches only initiatives slopweaver created — the same ownership
  ledger `linear project update` uses, and fail-closed for the same reason: under a personal API key Linear
  attributes every write to the human who owns the key, so the ledger is the only evidence of origin.
- **`content`, the long-form initiative document, is deliberately not exposed**, exactly as a project's is
  not. `description` is the one-line summary a reader scanning a list sees.

## `linear initiative-update create`

The status report posted TO an initiative, and NOT the `initiative update` verb that edits one. Linear's own
API carries the same collision — `initiativeUpdate` is the editor, `initiativeUpdateCreate` is the report —
so renaming either here would put this surface at odds with every provider document you might check. It is
exactly the project-update form with `initiativeId` in place of `projectId`: `health` is required
(`onTrack`/`atRisk`/`offTrack`), `summary` is the whole report above the fold and is capped, `detail` and
`evidence` fold beneath it, and there is no collapsible at all when there is nothing to fold. Create-only,
because everyone watching has already been notified and a correction is a NEW update.

## `linear attach upload`

```bash
slopweaver linear attach upload --file ./shot.png --alt "the failing panel" --json
```

Prints the permanent asset URL and the `media` block to paste into a comment, issue or project-update form.

- **No browser, no cookies.** MEASURED: `mutation.fileUpload` takes the same API key every other
  verb on this noun uses. `github attach` needs the owner's own Chrome because GitHub's upload is a scraped
  page token behind a session cookie; Linear has a first-class API for it, and
  [docs/browser-route.md](../../../docs/browser-route.md) is not on this path.
- **png, jpg, jpeg, gif, webp, pdf, mp4, mov, webm.** SVG is refused BY NAME: Linear renders one as a
  download link, so uploading it produces a broken-looking attachment where you expected a picture.
- **Only `image/*` embeds inline.** A PDF or a video renders as a file link, and `--dry-run` says which one
  you are about to get rather than leaving you to find out after posting.
- **A printed asset URL is proven.** Linear mints it BEFORE the bytes exist and it 404s until the upload
  lands, so the verb prints nothing at all when the PUT is refused. Never reconstruct one by hand.
- **The verb prints a `media` BLOCK, not markdown.** Paste the block into a form's `detail` and let the
  renderer emit the bytes — the same rule that governs every other field here.
- **No size ceiling lives in this repo.** `fileUpload` takes `size` as a required argument and refuses the
  reservation server-side, so the limit is stated on every call before a byte moves.
- **There is no teardown.** An uploaded asset stays uploaded; see the write-surface doc for what is untested
  there.
- **The invented-visual gate applies**, exactly as it does to `github attach`: a shot of a page served from
  this machine, a page or vector handed to an image slot, or a chart a plotting library drew is refused.
  `--acknowledge "<the reason the real surface was unavailable>"` waives it in at least four words, and the
  door records that it was waived.
