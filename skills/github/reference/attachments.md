# Attaching an image or a video to a pull request

`github attach` mints the one URL form that renders inline everywhere, public or private, for every viewer.
The rule — never substitute a link for the image, and an expired session is never a reason to ship less — is
in [SKILL.md](../SKILL.md).

`raw.githubusercontent.com` does not work for this. On a PRIVATE repository a `raw.` link renders as a broken
image for every other viewer — measured the hard way on five real pull requests. Neither does a `<video>`
tag: GitHub strips it out of a pull-request body, so the video renders as nothing at all. The form that
renders inline everywhere, public or private, for every viewer, is a
`https://github.com/user-attachments/assets/<uuid>` URL, and `github attach` is how you mint one.

**Proof lives in the description, as a user attachment, and nowhere else.** Proof is never put in a release, a PR
comment or a proof folder committed with git. Every write door and the CI gate enforce it (`src/outbound/github/formRules.ts`): an image run off
`user-attachments/assets/` is `IMAGE_NOT_USER_ATTACHMENT`, and an evidence link to a release download, a comment or a
committed media file is `EVIDENCE_RELEASE_DOWNLOAD`, `EVIDENCE_COMMENT_LINK` or `EVIDENCE_COMMITTED_MEDIA`, each
naming this verb.

```bash
slopweaver browser profile --set Default                         # once per machine: which of YOUR Chrome profiles
github attach status                                             # which account it is signed in as, and when it lapses
github attach status --org <slug>                                # ask GitHub: is it authorised for that org? non-zero when not
github attach upload --file shot.png --repo owner/name --number 123 --proves "<one line>" --dry-run
github attach upload --file shot.png --repo owner/name --number 123 --proves "<one line>"
github attach upload --file shot.png --repo owner/name --number 123 --proves "<one line>" --acknowledge "<why the real surface was unavailable>"
```

## Attach upload is closed until the owner's ruling permits it

`attach upload` sends nothing until the latest live `--attach-upload` ruling (by decision, then recorded instant)
says `permitted` (`src/handover/attachUploadRuling.ts`). No ruling refuses, as does a journal that may name one and
will not read whole: its lost line may be the newer `refused`. It runs before the file is read; `--dry-run` prints the
same block (`refusalLines` in `--json`). No hatch, no env override; `refused` closes it again:

```bash
slopweaver handover rule <slug> --anchor <where the owner said it> --words "<the owner's words>" --attach-upload permitted
```

While closed, a picture stays local and its proof says so; `github pr review-prepare` tells the reviewer that is honest.

## Only a file a capture verb wrote is sent

`attach upload` finds the file's **capture receipt by its bytes' digest**, never its path, and refuses (a door
`hold`, which `--acknowledge` cannot waive) unless every check below passes. A renamed or copied file resolves to
the same receipt; a file edited after capture has new bytes and none.

- **Only `browser console-shot` is admitted** (`src/outbound/github/attachCaptureVerb.ts`): a throwaway store of the
  synthetic `acme` organisation, so no figure from the operator's own accounts. `browser shot`, `terminal-shot`,
  `redact` (even over a console-shot parent) and `proof cassette` hold as `attach.capture-verb` until a figure check
  exists — the text scan sees private words, never a balance or a total — so their proof stays local; the other checks
  still run beside it. `browser shot --raw`, `slack shot`, `datadog shot`, `atlas vanta shot`, `browser annotate`
  output and a hand-made picture write no version-2 receipt at all.
- **`--proves "<line>"` is required**: one line, at most 200 characters, saying what the picture proves.
- **The scan reads every word a reader meets**: the receipt's frame text (the page's visible text, the terminal's
  drawn lines, or a recording's transcript), the `--proves` line and the alt text, through one injected port
  (`AttachTextScan`, `src/outbound/github/attachEvidence.ts`) whose default is the hygiene leak scan over the
  private denylist and the private terms, forgiving no installation identifier. Both load before the session is read,
  so a policy that did not load (private terms absent included) refuses a dry run or an upload before GitHub is
  contacted. Frame text the capture could not read whole is `incomplete` and refused.
- **A PNG's pixels are read too**, on this machine by macOS Vision (`src/visualEvidence/imageTextRecognition.ts`, no
  egress, no model): once per upload, from the very buffer sent, scanned as the `pixel-text` surface and judged by
  the dead-host check. A hit holds `attach.scan.pixel-text`, naming the class only; a read that failed, timed out or
  ran off macOS holds `attach.pixel-text-unread` — fail closed, nothing sent. Recognition cannot see a face, a map, a
  photographed place, a logo, handwriting, or text too small, blurred, rotated or low-contrast to read, nor a term
  split across lines: those stay the rule that no capture shows the owner's real Queue, calls or home. A recording's
  pixels are not read; its transcript is its text.
- **The five image checks** (viewed, rendered, legible, context, unobstructed; `IMAGE_CHECKS` in
  `src/visualEvidence/imageChecks.ts`) read the image records `browser image-record` writes: open the file, look,
  record what was seen. For a recording, read the transcript `proof cassette` wrote beside it.
- **The crop rule**: a picture's kept rectangle must be strictly smaller than the frame it was cut from, so a whole
  screen or viewport never passes. A cassette is exempt: its terminal showed only what the tape typed.
- **No metadata**: a PNG carries pixel chunks only. A cassette's container is stripped by the verb.
- **The declared type is the verb's**: `.png` for the picture verbs, `.mp4` for `proof cassette`. A GIF, a WebM or a
  video no verb recorded has no receipt and is refused.

**After the upload, the asset is fetched back.** The asset address must be exactly
`https://github.com/user-attachments/assets/<id>` before the session cookie goes to it, and the cookie goes nowhere
else. The redirect is read by hand, its host must be one of `GITHUB_READ_BACK_REDIRECT_HOSTS` spelled as the bare
host, and the second hop carries no cookie. Measured live, a private repository's asset redirected to
GitHub's own bucket, `github-production-user-asset-6210df.s3.amazonaws.com`, trusted by that exact name and never a
pattern over `amazonaws.com`. Only bytes identical to the ones checked earn an **upload receipt** (`upl-<uuid>`, under
`$SLOPWEAVER_HOME/visual-evidence/uploads/`, `src/outbound/github/attachReceipt.ts`), which `attach upload` prints and
a description cites. A mismatch writes no receipt and says the asset must not be embedded.

**A lapsed session is NEVER a reason to ship less**: do not substitute a link for the image and footnote it. The
session is read from the Chrome you are signed in to all day, so the failure this rule exists for, a captured
session quietly ageing out in a profile nobody looks at, **cannot occur at all**.

The residue: when you genuinely are signed out of github.com in your own browser, `attach upload` cannot fix
that itself. It refuses in one line naming the exact action, and publishes `needs-owner-login` on the
supervisor stream — `slopweaver events tail --source github-attach` is where a briefing reads that the owner
is the blocker. `attach status` publishes the clearing event when the browser holds a session again.

**Nothing here drives a browser**, so Google's refusal to authenticate inside a CDP-controlled browser
(`accounts.google.com/v3/signin/rejected`) cannot reach it. You sign in to GitHub the way you already do, in
your own window.

Two steps, deliberately: `attach upload` prints the URL and the markdown, then `pr update --edit` embeds it as
an `{ "kind": "image" }` run in an evidence field — a Before-and-after cell, the click-through destination, or
the `proven` claim the screenshot proves, where it renders as the picture beside its claim (media is never
folded, so a note refuses one). Attaching does not touch the description, so the form's own edit path is reused rather than
duplicated.

**The upload door refuses an INVENTED visual.** A shot of a page served from this
machine — `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]` or a `file://` path — a page or vector handed to an
image slot, and a chart a plotting library drew are each refused by name, with the real path back in the same
line: capture the provider's OWN surface through the doored browser route, or link the deployed thing. This
holds even when a slopweaver verb rendered the page and its data came through the door — measured, that is
exactly the shot the owner rejected. `--dry-run` reports the same finding fully offline, before a session is looked
for.

`--acknowledge "<reason>"` is the break-glass, and it needs the REASON in at least four words — a bare marker
waives nothing. It waives only the upload it is typed on, and the door writes the waived code to the ledger,
so an acknowledged send stays findable afterwards. Reach for it when the local render honestly is the only
surface there is (`slopweaver atlas vanta vulnerabilities --html` over a doorless provider is the worked case),
never to get past a refusal you did not read. The same gate runs on the answer form and on a pull-request
description, where the hatch is the door override token and an `<!-- invented-visual-ack: <reason> -->`
comment respectively.

**A GIF is refused**: a reader gets no timeline controls and no indicator of how long it goes for or whether it
loops, and no capture verb writes one, so it has no receipt. The animated-GIF gate
(`src/outbound/github/animatedGif.ts`) still names the problem by its frames. A recording is a cassette:

```bash
slopweaver proof cassette --tape demo.tape --out ~/.slopweaver/proof/<pr>/demo.mp4
```

`proof cassette` owns the typing speed ([proof capture](../../../docs/proof-capture.md#a-recording-a-cassette)):
measured on one 300-character prompt, VHS's 50ms default ran 16.2s as a GIF, the cassette 2.96s as an `.mp4`. It
also writes the transcript (`<out>.txt`) and files the capture receipt attach requires, the transcript as frame text.
A video converted from elsewhere with `ffmpeg` has no receipt, so it is refused: record it as a cassette instead.

- **Pass a pull-request number; an issue number needs push access.** The CSRF token and the numeric
  repository id are read off the `<file-attachment>` whose policy is `/upload/policies/assets`, and a pull
  request's default page is GitHub's React app, which renders none (measured: every upload
  `SCRAPE_FAILED` while `attach status --org` read SAML-authorised). The verb reads `pull/<n>?overview=false`,
  the classic page, instead. An issue has no classic page (the redirect drops the query), so it falls back to
  the repository's `releases/new`, served only to a pusher — and reads its release-body region, never the
  release-binaries one beside it, whose token belongs to another endpoint. `--dry-run` prints both pages.
- **An image and a video need different markdown**, and the verb prints the right one. An image is
  `![alt](url)`; a video is the **bare URL alone on its own line**, blank line either side. The same URL
  inside a sentence stays a link, which reads as a failed upload when the upload was perfect.
- **Size ceilings are enforced locally, before any byte is sent** — 10 MiB for an image, 100 MiB for a video,
  both inclusive. Those are GitHub's numbers, measured against its own policy endpoint rather than read from
  documentation, which does not state them.
- **There is no setup step, and no login.** ([browser-route](../../../docs/browser-route.md), [its cookie read](../../../docs/browser-route/proof-and-capture-verbs.md#two-mechanisms-replaced-four-private-profile-lanes)):
  the session is read out of the Chrome you are already signed in to, at the moment of the call. Record which
  of your profiles that is once with `slopweaver browser profile --set <directory>`, and that is the whole of
  it — `slopweaver browser cookies --origin https://github.com` says whether it currently holds one.
- **Only github.com cookies are ever assembled.** Your browser holds the identity provider's cookies too, in
  the same jar; the header this builds carries the github.com ones and nothing else. No cookie value is
  printed, logged, or written anywhere, and nothing lands under `$SLOPWEAVER_HOME`: a stored web session
  would be a live credential at rest.
- **Org SSO is a SEPARATE GRANT, not a shorter clock.** A session can be signed in to GitHub and still not
  be SAML-authorised for the org that owns the repo; GitHub then serves a valid 200 carrying an SSO
  interstitial and no repository content at all. Measured: 45,979 bytes of wall versus 1,935,278 bytes of
  page for the same pull request. `attach upload` names that refusal (`ORG_SSO_REQUIRED`) rather than
  reporting the misleading "this page renders no upload region".
- **Being signed in never establishes the grant.** The two are separate authorisations, so a browser that is
  perfectly signed in to github.com can still be walled for one organisation. The fleet presses that prompt
  itself: `slopweaver browser sign-in --provider github --org <org>` looks, names
  the Continue to press, and only a step that look finds the owner's is carded
  ([fleet sign-in](../../../docs/browser-route/fleet-sign-in.md)). The old `attach login` is gone because,
  against an already-signed-in profile, it captured within a second or two of the window opening — long
  before anyone could authorise an org in it — so re-running it over a SAML wall completed and changed nothing.
- **`attach status --org <slug>` is the only honest precheck**, and the plain form is a false green: parsing
  a cookie file proves the file is a session and says nothing about the separate grant that decides whether
  any upload works. With `--org` it asks GitHub and **exits non-zero on a wall**, so a script can gate on it.
- **The token and the web session carry INDEPENDENT org grants.** Every other `github` verb authenticates
  with `github-token` through Octokit; only `attach` uses the browser session. Either grant can be live while
  the other is walled, so "GitHub is refusing me" is never a whole diagnosis. Measured, both
  directions at once on the same SAML org: `github read` returned a full private pull request while
  `attach status --org` exited 1 on the same organisation. A live token does not mint an attachment: when
  the session is walled, complete the org's sign-on in your own Chrome rather than hosting the image elsewhere.
- **The recovery retries exactly ONCE.** A login that completes and leaves the session still unusable is a
  real failure and gets reported; it never reopens a browser in a loop. And it does not fire over
  `ORG_SSO_REQUIRED` — that grant is separate from the session, so a fresh login can succeed and change
  nothing (see the SSO bullet above).
- **The credential is a browser session, not `github-token`** — see `docs/security/data-flow.md` § egress 8 for what
  that file is and why it is more powerful than it looks. Plain `attach status` says whether one exists; it
  cannot say whether it is still live, because only GitHub knows that — `--org` is what asks it.

## Downloading body media

`github attach` mints an attachment; `github read <issue-or-pr-url> --media-out <dir>` fetches the ones a body
already carries, which is how a video on a private pull request reaches a Slack post. A private
`user-attachments/assets/<uuid>` URL does not answer the API token, so the verb asks GraphQL for `bodyHTML`,
where GitHub writes a short-lived SIGNED address for each one, and fetches that.

- **Only `<video src>` and `<img src>` on an exact attachment host** (`private-user-images.githubusercontent.com`,
  `user-images.githubusercontent.com`). A shields.io badge, an avatar, a camo image and a poster frame are
  not the body's media, so they are never downloaded.
- **No credential is sent and a redirect is refused.** The signed address carries its own token. Measured on a
  private pull request: the host answered the first request directly with the 922,716-byte side-by-side MP4.
- **The signed address is never printed.** `--json` and the text output list each file's kind, name, path,
  byte count and sha256; an error names the address without its query.
- **Files are numbered in body order** (`github-media-01.mp4`), extension from the content type, never from the
  address. The first failure stops the run, and files already written stay.
- **Absent and empty differ**: no `media` field means none was asked for, `media: []` means the body embeds none.
  A discussion is refused, and each file is capped at 100 MiB, GitHub's own video upload ceiling.
