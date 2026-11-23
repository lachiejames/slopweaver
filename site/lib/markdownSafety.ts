/**
 * What the console's markdown renderer (Streamdown, under AI Elements) may never draw.
 *
 * The markdown it renders is a session's own transcript, and a transcript can name a remote image in
 * ordinary text. A rendered `<img>` — or a `<video>`, an `<iframe>` — is a request the BROWSER makes on its
 * own, the moment the page draws it, to whatever host the text named: an egress nobody chose, from a console
 * whose whole contract is that nothing leaves the machine unless the owner presses for it (`docs/security.md`).
 * Every element that fetches on render is therefore dropped before render. A link is not on the list: it
 * fetches nothing until the owner follows it.
 */
export const NO_REMOTE_MEDIA: readonly string[] = [
  "img",
  "video",
  "audio",
  "iframe",
  "source",
  "picture",
  "object",
  "embed",
];
