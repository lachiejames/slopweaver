# When the proof is a picture, attach the picture

Bundled reference for the `loop-bot` skill. Loaded when the body links here, not on every turn.
`src/live/turn/visualEvidenceGuidance.ts` is the code half, and it prints the same default into your own
`turn resume --dispatch <id>` pre-flight, so this file is the reasoning rather than the instruction.

## The measured gap

**In one measured day, 10 answers were posted, 0 carrying a single image, and 8
of them linked at least one surface whose whole content IS a rendered picture** — a metrics or logs
explorer query, a monitor page, a dashboard, a pull-request diff, a CI run — 23 such links across the day.
A picture says a thousand words.
Every claim about a curve, a threshold or a diff was prose plus a reference link, so checking one meant
leaving Slack, signing in and re-running the query. Reproduce it with the pipeline in
`src/live/turn/visualEvidenceGuidance.ts`'s header, which reads the ask records and the posted answers
through the real door rather than off a transcript.

## The default, and where the judgement stays

- **Capture the surface your claim rests on and put the file in `images`, as an absolute path.** Keep the
  reference link too — the image is the evidence, the link is where the reader goes next.
- **Say the window the shot was taken over, in the prose beside it.** An image is evidence of that window
  and no other, and a reader who cannot see the range cannot check the claim against it.
- **The judgement is yours, and stays yours.** A one-line factual answer, a value read off a field,
  evidence that is code or a ticket state — none of those want an image, and attaching one is noise.
- **A picture you GENERATED is not the real thing's own surface.** Some subjects — a monitor above all —
  have a real artifact, and the owner reads only that: the deployed thing's own evaluation panel and a link
  the owner can open. A chart drawn from your own replay can be right about the data and wrong about what the
  monitor would do. Go and get the real one; if you could not, the door refuses the send unless the answer
  carries a `grounding.evidence.substitutedForReal` entry naming what you could not produce **and WHY**.
  Measured: an answer that said the monitors were never deployed and stopped there is the failure
  — naming the gap is not naming its cause. `src/admit/realArtifact.ts` holds the subject table.
- **Nothing else here is a schema refusal but one.** Whether the evidence is visual is found during the
  investigation, so a gate would fire mostly on correct answers. An ask saying "screenshot" and the
  real-artifact subjects above are door refusals ([composing-the-answer.md](composing-the-answer.md)'s table).
  A measured answer linking a Datadog graph owes three screenshots ([rule 7](links-citations-and-shots.md)).
- **A missing screenshot is never grounds for another review round.** The reviewer packet is told that in
  its own section 1b, so raising the composer's default cannot turn into a fail-closed loop. That ceiling
  covers ABSENCE and nothing else.
- **A picture you DO attach is opened by the reviewer, and what it saw is recorded.** Packet section 1c, one
  `imageObservations` entry per attachment in the verdict, bound to the picture's own digest — so the door
  can tell "opened it" from "read the path and moved on", which it could not before. A
  reviewer that records one unreadable, or whose panel had not rendered, marks the verdict `broken` AND the
  door writes a terminal `failed` record against those bytes — never attachable again, by any verb, with no
  hatch. A coverage gap — an attachment with no observation — is a self-correctable warning instead
  (`answer.image-observations:v1`). See [reviewer.md](../../loop/reference/reviewer.md).
- **A failed capture never holds a correct answer.** Send it, and name the shot you could not take in
  `grounding.evidence.couldNotSee`.
- **Doctrine rule 7 is unchanged.** Images ride below the fold with the evidence, never above it, and they
  buy no extra room in `lead` or `index`.

## What captures the shot — one verb, and it is not the extension

```bash
slopweaver browser shot --url <address> --out $SLOPWEAVER_HOME/proof/<slug>/<file.png> [--target <adapter:target>] [--readiness-timeout <ms>] [--caption <text>]
slopweaver browser shot --url <address> --out $SLOPWEAVER_HOME/proof/<slug>/<file.png> --raw [--settle <ms>]    # diagnostic; never attachable
```

**That is the capture route; the Claude-in-Chrome extension is not**, so
every call to it is refused categorically with no override. A capture that needs the page moved first (a
picker opened, a panel marked) is `slopweaver browser open` then `act --do <kind>`, each interaction
photographing its own result; see [the browser skill](../../browser/SKILL.md). Slopweaver's Playwright route serves everything, with no
need for Claude in Chrome. Three sessions once — a bot turn, a demo-readiness pass and `datadog shot` — each
reported a screenshot leg BLOCKED because `list_connected_browsers` returned `[]`, while the Playwright
extension relay was attached to the same Chrome and filing PNGs for every atlas walk on the machine.

`browser shot` drives the relay from a Node process — the owner's own real Chrome, the recorded work profile, no
second browser and no launched one — so **the leg does not care whether the extension is connected**.

**By default it WAITS, CROPS, FRAMES, CAPTIONS and MEASURES.** The
incident images were this verb's own output: `goto`, a flat 20-second settle, a whole-page stitch, and
`6 service values found` above a panel that had not rendered, at 4032x6722. So the default profile:

- **waits for a closed, source-owned TARGET to render**, polling every 500ms: exactly one target element, no
  loading indicator inside it, the network quiet for 1.5s, the results summary present, the chart's own
  canvases carrying drawn pixels, and the geometry unchanged across two polls. The target is inferred from
  the address (`datadog-logs-v1:timeseries`, `datadog-apm-traces-v1:timeseries` — a delivery failure is a
  SPAN, in no log) or named with `--target`; each is zoomed to 0.7 for the shutter because the owner's window is 662
  CSS px tall and neither stack fits it, an address no adapter covers is `unsupported-target`, and there is
  no selector flag, on purpose — certifying the loaded sidebar IS the incident;
- **photographs the VIEWPORT, scrolled to frame the chart, the summary, the query and the time range**.
  Never full-page: measured on the incident's own address, a stitch resizes the viewport, the canvases clear
  on the resize, and it photographed them BLANK while the page reported them drawn — most likely what the
  incident image was, a loaded panel blanked by the capture;
- **crops to that union** in Node from the page's own rectangles, scans the chart's pixels as a second
  witness (blank pixels under a "drawn" report is `crop-refused`), frames the chart in red OUTSIDE its
  pixels, and appends a caption band carrying the summary, the time range, the query and the capture
  instant — so a preview that cannot show the axis labels still shows the numbers;
- **measures prominence on the final bytes** against a declared 1400x900 desktop box, and writes a FAILED
  image record for bytes that fail it (`evidence-unfit`), so they can never be attached by any lane — and
  if that record cannot be written, DELETES the image, because bytes measured unreadable and carrying no
  record would otherwise fall to the hatchable missing-record arm;
- **writes a capture receipt** (`$SLOPWEAVER_HOME/visual-evidence/captures/<captureId>.json`) with every stage's
  identity and the exact frame text the crop shows, and reports `captured` (`readback-pending`): the FINAL PNG still has
  to be opened by you and recorded with `browser image-record` naming its `captureId`. The whole-page
  capture is kept beside it as `<out>.raw.png` for diagnosis; it carries no record and no form attaches it.

What it hands back is a named state rather than a silence: `captured`, `target-not-ready` (with WHICH
condition never held), `page-moved`, `unsupported-target`, `crop-refused`, `evidence-unfit`, `record-failed`,
`reached-not-photographed`, `navigation-failed`, `relay-unavailable`, `session-lost`, `off-lease-origin` or
`doored-provider` — and `photographed` under `--raw`, whose output is named as unattachable. Quote that word
when a capture did not happen; it is the difference between "no browser was connected", "the panel never
loaded" and "the capture wedged". **Never raise a settle to
fix a not-ready target**: `--settle` belongs to `--raw` alone and the default path refuses it, because
lengthening a sleep is what produced the incident. Raise `--readiness-timeout` if the console is slow.

**What it deliberately cannot do**, so you know when to stop asking it: it navigates, observes the one
target its adapter names, scrolls, and photographs — no click, no typed text, no caller-supplied page
script, no network read. A picture that needs a time-range picker moved or a panel marked first is not this
verb's: a monitor's backtest panel is `slopweaver datadog shot monitor --id <id> --out <dir>`, which runs its
own declared relay arm, proves the seven-day window and files the graded PNG. The address's own origin is
the whole lease, so a redirect to a sign-in on another host comes back `off-lease-origin`, not a login form. One adapter exists today, the Log Explorer
timeseries; a second is an adapter module with its own measured fixture, never a flag.

**Never sign in or switch accounts to get a shot**, and never treat a capture you could not take as a reason
to weaken the claim it would have backed. Say what you could not see instead.

## An image nobody wrote down cannot be attached

Two full-page Datadog screenshots the owner's own bot posted into the owner's DM, one of them photographed
before its panel had rendered, were unacceptable, and repeating the mistake is made structurally impossible.

The investigation is the reason this section is shaped the way it is, and it contradicts the obvious
hypothesis. **The worker DID read both pictures back** — three `Read` calls in its own transcript — and it
had already raised the settle to `--settle 20000`. Shipping them anyway is what happened. So "read it back"
was never the missing property; it was that looking leave a RECORD something can refuse on.

So, before an image may ride in `images`:

```bash
slopweaver browser image-record --form ./looked-at.json
```

The form names the FINAL image, what you actually saw in it (values, labels, the query — never "looks
fine"), whether the thing your claim rests on had rendered (`data`, `zero-results`, `unloaded`,
`empty-panel`), whether the crop kept the context a reader needs, and your own `passed`/`failed` call. For
a `browser shot` capture it also carries the `captureId` the verb printed, and the verb refuses a
`captureId` whose final digest is not the bytes being recorded — so the record is bound to the crop the
capture actually produced. It prints the `{ path, artifactDigest, receiptId }` to paste into `images`.

A FIRST message in a channel owes `annotations: [{ rect, note }]` (each box ALREADY drawn, by [`browser annotate`](annotating-a-picture.md)) and `obstruction: "none"`
on a `passed` form; a covered capture is `failed`, `reason: obscured`, retaken ([receipts](../../slack/reference/receipts.md#a-first-message-in-a-channel-leads-with-an-annotated-screenshot-and-its-link)).

**Two arms, and only one of them has a way past it:**

- **No record at all** is a policy refusal with a working hatch — a hand-made diagram, a photograph of
  something physical, an image from a source no verb here can capture are all real exceptions. Take it with
  `slopweaver hatch open unread-image --reason "<why>"`.
- **A `failed` record has NO hatch.** Sending a picture you have looked at and written down as unreadable is
  not okay, so it is a `hold`. Correcting it means new BYTES and a new record, never a
  waiver.

Records are keyed by the image's own `sha256`, so renaming the file, quoting another receipt, omitting the
receipt or switching upload lane all resolve the same record. Every lane crosses one boundary
(`src/visualEvidence/`), and a batch is judged whole: a good first image and a bad second upload neither.

## Never screenshot a provider that has a door

**Slack, GitHub, Linear, Notion and Vanta are off-limits to a hand-driven browser, for reads as well as
writes** — doctrine rule 3. A browser signed in as the owner has no read-only mode: `screenshot` and `type`
are the same tool, and once one missed click at a Slack search box typed a lookup into the channel
composer and posted it under the owner's name. A `PreToolUse` tripwire refuses those calls and names the door verb.

**`browser shot` reads the write-policy register**, and refuses only a platform registered
`refuse-every-write` that has a door — an arm the register leaves uninhabited today, since the
category move put all five on `read-before-write` ([browser-route](../../../docs/browser-route/doored-provider-writes.md#and-then-all-five-moved)). So the
verb WILL photograph a doored provider (taking a screenshot is still a read), and the table below is an evidence-QUALITY judgement rather than a refusal it
enforces. Hand-driven stays refused, reads included: a doored page is reached only through a `slopweaver
browser` verb, and every Claude in Chrome call is refused.

This costs almost nothing, and the number is why the rule could be written at all. Measured across a whole
day — the same pipeline as the gap above, over 15 answers — **28 visual-evidence
links: 23 doorless (Datadog logs, metrics, monitors, dashboards) and 5 on a doored provider, every one of
them GitHub** (4 Actions runs, 1 pull-request diff). Zero Slack, Linear or Notion.

So: **capture the doorless surfaces exactly as before** — that is where the pictures live. **Reach for the
door verb first anyway**, on evidence quality rather than permission: a run's status and a diff are text, and
text is better evidence than a photograph of text.

| Instead of a shot of…      | Use                                      |
| -------------------------- | ---------------------------------------- |
| a CI run or a failing job  | `slopweaver github checks`               |
| a pull request or its diff | `slopweaver github read`                 |
| a Slack thread             | `slopweaver slack read-thread`           |
| an issue, project or page  | `slopweaver linear read` / `notion read` |

**Vanta is the exception, because its picture route is a VERB rather than a substitute for one.**
`slopweaver atlas vanta shot --control <id>` photographs ONE control at its own address and records that
address as a `browser-discovered` deep link, taking the id a document prints (`DCH-108`) or the one the URL
needs (`0syn0001`) and refusing an id the atlas cannot place rather than photographing another control. A
picture of the controls INDEX proves nothing about one control, and the Manage API hands back no per-control
URL at all, so this is how an ISO answer cites one with evidence ([atlases](../../../docs/atlases/nouns.md)).
`atlas vanta vulnerabilities --html` covers the findings list, `atlas vanta render` what a walk already
stored. `shot` once shipped without telling any composing surface, so a Vanta control answered with no
screenshot stayed current behaviour for a week. Keep the permalink either way,
and where you genuinely could not capture what the claim rests on, name it in
`grounding.evidence.couldNotSee` — never weaken the claim, and never reach for the browser to get around this.
