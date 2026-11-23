# Annotating a picture you already have

A first message in a channel leads with a screenshot carrying a box over what the reader should look at, and its
note ([receipts](../../slack/reference/receipts.md#a-first-message-in-a-channel-leads-with-an-annotated-screenshot-and-its-link)).
`browser shot` frames the one chart it crops itself; a `browser act` or `browser read` capture, a Vanta page or any
other PNG arrives with no box. Draw them with:

```bash
slopweaver browser annotate --form ./annotate.json
```

The form names the `source` and `out` paths, one to four `annotations: [{ rect, note }]` in the source's own pixels,
and what you saw in the source (`observedContent`, `observerSession`, `targetState`, `contextRetained`,
`obstruction: "none"`, and an `already-framed` crop with its reason). It is strict: an unknown key, a `captureId`, a
`cropped` crop or a failed-verdict field is refused, because a capture with a `captureId` is recorded through
`browser shot`'s own readback instead.

What it draws:

- a red frame just OUTSIDE each box, so no pixel inside any box changes and a second box's frame never covers the
  first;
- a numbered badge beside each box when there are several, refused with the box named when no badge fits without
  covering a box or leaving the picture — capture with more margin;
- the notes in a caption band appended below (`1. note`, `2. note`, or the bare note for one box), so every box's
  rectangle is the same in the output as in the source. A note comes back as the font printed it.

**It records nothing.** An image record attests that a session LOOKED at the final bytes, and
annotate has not looked. It writes the PNG and a pre-filled `<out>.image-record.json` whose `expectDigest` is the
output's exact digest, and prints the next step:

```bash
slopweaver browser image-record --form <out>.image-record.json
```

Open the output, check every box and note against what you meant, then run it. Edit the form first if what you see
differs from what you wrote.

**A picture recorded unfit is never annotated.** A source, or an output, whose digest carries ANY failed record is
refused with no hatch: a capture a pop-up covers is retaken, never worked around. Exit codes:
`2` for a form that is wrong (bad JSON, a refused field, a box off the picture, `out` naming the source, a source
that is not an 8-bit PNG, since drawing would round its pixels), `1` for a
file that cannot be read or written or bytes already recorded unfit.
