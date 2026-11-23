# The recorded-call boundary (`refresh --source fathom`, `fathom share`, `fathom discover`)

Part of [Security & trust](../security.md).

Fathom is the meeting recorder, and it is the first source here that carries other people's SPEECH. It is
reached two ways: the API lane below, for calls the owner recorded, and a share-page read for calls somebody
else recorded and shared with the owner — the last bullet.

- **The credential is the owner's own per-user API key, and no process here can obtain one.** It is minted
  by hand at `fathom.video/customize#api-access-header` and stored with
  `slopweaver secrets set fathom-api-key`. There is no OAuth consent to drive and no cookie lane to fall
  back on: MEASURED, the owner's Chrome profile holds 2,489 cookies and ZERO for `fathom.video`, and
  every `fathom.video` URL — a `/calls/<id>` and a `/share/<token>` alike — answers a redirect to
  `/users/sign_in` for an anonymous reader. A lane with no key REFUSES, naming both of those steps.
- **The key grants exactly what its owner can already see.** Fathom's own documentation: keys are per user,
  never per org, and reach "meetings you recorded and meetings shared with you or your team. Not other
  users' private, unshared meetings." So this lane can never read a colleague's private call, whatever
  scope anyone later wants.
- **Every operation this repository can reach is a GET.** `src/live/fathom/api.ts` exposes ONE call —
  `/meetings` with `include_transcript` — and deliberately does not re-export the SDK's
  `getRecordingSummary`, `createRecordingDownload`, `createWebhook` or `deleteWebhook`. A download pulls the
  audio or video of a private conversation onto this machine; a webhook is a write to the provider. Neither
  is reachable at any price without editing that module.
- **The RAW words are stored and the provider's summary is never read.** A transcript summary
  produced by other software is not trusted as evidence. Fathom returns
  `default_summary` on every meeting; the repo's own meeting shape has no field for it
  (`src/corpus/fathom/types.ts`), so storing one means changing that file rather than forgetting a filter. A
  meeting whose transcript has not finished processing produces NO record and one warning saying so.
- **Every record is PRIVATE twice over — by source AND by kind.** `fathom` is an always-private source and
  `transcript` is an always-private kind (`src/corpus/visibility.ts`), so a recorded call reads back private
  even if a projection path forgot to stamp it. This is the strongest case for the source-level mark in the
  file: the other voices on a call are customers', vendors' and partners', captured because they agreed to
  talk to the owner rather than to be indexed.
- **`--all-sources` does not include it**, on exactly the mailbox's and the diary's terms. It is reached by
  typing `--source fathom` or it does not run.
- **Addresses are scrubbed and names are kept**, through the same bronze write path as every other source,
  `author` included. A call's author is its recorder (the API lane) or host (a shared call) by display name,
  else their address's local part (`src/corpus/personName.ts`), never the address.
- **A shared call is read through the owner's own signed-in Chrome, and nothing else.** The owner's key cannot list a call
  another person recorded, so `fathom share <url>` opens `https://fathom.video/share/<token>` through the
  browser relay (the `fathom-share-transcript` arm, [browser route](../browser-route/provider-arms.md#a-shared-call-with-no-api-what-the-fathom-share-arm-reads)), clicks nothing, and
  reads the page's own call and transcript properties. The one egress is that page load — and whatever
  requests Fathom's own page makes while it loads, which this code does not control and does not claim to.
  Fathom's own action-item notes are dropped IN the page and only their count leaves it; the summary is a
  property the snippet never reads. `fathom discover` reads Fathom's mail through the Gmail read grant
  only, to find the links. Both write the same private `fathom` transcript record the API lane writes,
  keyed on the same recording id.
