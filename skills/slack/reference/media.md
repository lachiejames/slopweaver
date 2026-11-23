# `--media` — what this door attaches, and the one class it refuses

`--media a.png,b.pdf` uploads each file privately and then attaches it to the card itself, never as a
second message. Every lane takes the flag: `post` and `reply`, `--as bot` and `--as me`. The kind of each
file is decided from its BYTES, never its extension — a PNG renamed `.pdf` is still a picture.

## Three arms

**A PICTURE is admitted against the visual-evidence store first.** It needs a read-back — `slopweaver
browser image-record` — or the send is refused. That is the visual-evidence gate: an artifact somebody
looked at and wrote down as unfit has no way out at all, and one nobody has looked at rides the
`unread-image` hatch (`slopweaver hatch open unread-image --reason "<why>"`) or does not go.

**A DELIVERABLE is uploaded with nothing asked of it.** A PDF, an office file (`.docx`, `.xlsx`, `.pptx`,
and the legacy `.doc`/`.xls`/`.ppt`), a gzip, an RTF, or a text file — markdown, CSV, a log. None of them
carries a visual claim a reader could check, so there is nothing for the record store to be asked about.
`src/visualEvidence/attachmentKind.ts` is the allowlist.

**A VIDEO rides the deliverable arm, and claims exactly as little.** An MP4, M4V or QuickTime file is
identified from its opening ISO-BMFF `ftyp` box: the major or any compatible brand must be a known video
brand (`isom`, `mp41`, `mp42`, `avc1`, `qt  `, `M4V `, `iso2`–`iso6`, `dash`). A still-image
brand anywhere in that box — `heic`, `heix`, `hevc`, `heim`, `heis`, `mif1`, `msf1`, `avif`,
`avis` — REFUSES it even beside `isom`, because an AVIF or HEIC shares the container and is a picture this
build cannot decode. A video is not a read-back of anything: it uploads with no image-evidence record and
no claim that anybody watched it. A WebM (Matroska) is not identified yet and is refused like any unknown.

**Anything else is REFUSED**, and this is the arm worth knowing before you compose. The build decodes
pictures with `jimp`, which reads PNG, JPEG, GIF, BMP and TIFF and nothing else. A WebP, an AVIF, a HEIC or
an SVG is a picture Slack renders and this build cannot decode, so it is neither admitted nor identified —
and waving it through on "the decoder could not read it" would be a route around the record store for
exactly the files most likely to be a screenshot. Convert or re-capture as a PNG; the refusal names the
file and says what could not be read.

## A Datadog citation carries its screenshot

Whenever Datadog is the subject, the screenshot goes with it. A message, card or parked draft
whose form links a Datadog CONSOLE page anywhere (a link run, a bare URL, a citation, a `primaryLink`) is
refused unless at least one attachment's bytes decode as a picture. A PDF or a video is not one, and a docs host
is not a console page. It runs on every as-me form, a composed bot `update` or `no-fold` card, both lanes of
`slack draft record`, a release, an answer, a held answer's release and an answer edit, before a dry run
branches. A `no-fold` message carries no media, so a Datadog one is an `update` card. A scheduled or derived
card is exempt: no session is there to take the picture. One deliberate exception opens the journalled
`unshown-graphs` hatch. `src/outbound/artifact/datadogCitation.ts` holds the criterion.

## A parked draft keeps the BYTES, not the path

`slack draft record --media a.mp4` admits the batch exactly as a send would, then stores the admitted bytes
in `$SLOPWEAVER_HOME/queue/slack-draft-media/<sha[0:2]>/<sha256>` (owner-only) and binds each file's name,
size and SHA-256 into the digest the owner approves. The release re-verifies every blob before preparing and
sends those verified bytes; `--media` beside `--draft` stays refused. The rest is
[draft-review.md](draft-review.md#a-draft-with-an-attachment).

## The answer form is different: it has TWO arrays

`turn answer`'s form carries `images` and `documents` separately, and the composer says which a file is
rather than the door inferring it. A deliverable left in `images` is refused by name before anything is
posted — move it to `documents`. Images upload first, so the order a reader sees is the order the answer
composed.
