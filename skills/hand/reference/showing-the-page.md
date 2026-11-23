# Showing the page: a screenshot with red boxes on the card

Every human-hand step shows a screenshot of the provider page with red
boxes around what to grab, so the owner hardly leaves the UI. A step that asks the owner to mint a token or press a button on a
provider page carries that page's picture, and the queue card draws it with a numbered red box over each thing.

## Posting one

Take the picture through the browser door, never by hand: `slopweaver browser inspect` or `browser open` prints a
PNG of the viewport. Look at it, then post the step with the picture and one `--box` per thing to grab:

```bash
slopweaver hand post --id linear-token --row <slug> --blocks \
  --what "Create a Linear personal API key, then paste it into the field below" \
  --url "https://linear.app/<workspace>/settings/account/security" \
  --literal "slopweaver secrets set linear-token" --where "the fields on this card" \
  --shot ~/.slopweaver/proof/<slug>/linear-api.png \
  --box "40,120,320,36=Personal API keys" --box "1200,40,200,40=New API key" \
  --unblocks "<what waits>" --witness "slopweaver secrets status shows linear-token stored"
```

- **A box is `x,y,width,height=label` in the picture's own pixels**, top-left origin, as the PNG is stored. A
  2x capture is boxed in 2x pixels; the card scales the boxes with the picture.
- **One to nine boxes**, each inside the picture, each with a one-line label of at most 60 characters. The card
  numbers them in the order posted and lists the labels beneath the picture, so the order is the order the owner acts in.
- **`--shot` and `--box` come together**: a picture with no box shows the owner nothing to grab, and a box has nothing
  to sit on without a picture. Either alone is a usage refusal.
- **The picture is a PNG** under 16 MiB, at most 20000 pixels a side (`src/hand/shot.ts`).
- **A picture is attached, never named.** A `.png`/`.jpg`/`.jpeg`/`.webp`/`.gif` file named in the step's prose
  is refused at posting (`src/hand/imageInProse.ts`): the card would draw it as a path the owner cannot see, and
  when there is an image, the owner sees it on the queue card. An ask's card takes its
  picture the same way, with `handover shot` ([card alignment](../../handover/reference/card-alignment.md)).

## The post looks first, and a step with no `--shot` carries what it saw

A check-in once went up whose Open pointed at
`http://localhost:3000/api/page/talk-stage-looks/index.html` while the pull request that made that page was unmerged.
So `hand post` checks before the note goes up, in this order, and records NOTHING on a refusal:

1. **A `--check-in --row <slug>` whose row's pull request is not merged is refused**
   (`src/hand/rowPullRequest.ts`). The row's pull requests are those whose head is its declared `branch:`, the branch
   its journal recorded, or the slug, in its checkout's repository; any merged one passes, none at all passes, and a
   read that could not run refuses. A `--blocks` step is never judged — it unblocks a row that is still open.
   Hatch: `SLOPWEAVER_ALLOW_UNMERGED_CHECK_IN=1`.
2. **A web `--url` is opened in the owner's Chrome through the browser route** (`src/cli/commands/hand/pageLookRun.ts`, the
   sequence `browser inspect` runs) and refused when the page answers HTTP 400 or above, Chrome lands on an error
   page, or it draws no text and no picture (`src/hand/pageLook.ts`); a look that could not run at all refuses too.
   A console viewer address is judged by the document its `src` frames (`lookAddress`), since the viewer's own bar
   draws whatever that holds. Hatch: `SLOPWEAVER_ALLOW_UNSEEN_HAND_URL=1`.

A step posted with no `--shot` carries the look's screenshot as its picture with **zero boxes** — the page as the
post opened it, which the card draws with that caption instead of a box list. Only a hand step admits zero boxes; an
ask's `handover shot` still needs one. An exact retry reuses the picture already recorded for that id, so a second
look's different bytes never read as a conflicting post.

## What happens to the picture

`hand post` reads the PNG and checks every box against its size BEFORE anything is written, so a refused step
leaves no file behind. Once the step is admitted, the bytes are stored once under
`$SLOPWEAVER_HOME/hand-steps/shots/<first two hex>/<sha256>` — `0600` in a `0700` directory, never under a symbolic
link out of the home (`src/hand/shotStore.ts`) — and the register row carries only `{ sha256, width, height,
boxes }`. `hand list --json` publishes that as the step's `shot`.

The console serves the blob from `/api/hand-shot/<sha256>` behind the same guard as a draft's media
(`site/lib/draftMediaServe.ts`): a 64-hex name, inside the store, a regular file — the same store and route an ask's
`handover shot` picture uses. The card draws it above the step's paste fields (`site/components/console/HandShot.tsx`, coordinates from `site/lib/handShot.ts`); a picture
the store no longer holds reads as one line listing the boxes, never a broken image.

## What not to photograph

A provider page often shows the very value the owner is about to paste. **Capture the page BEFORE the token is minted**
— the settings list, the "New key" button — never the dialog that displays it. The picture is stored on the owner's
machine only, but it sits in the store as long as the register keeps the step.
