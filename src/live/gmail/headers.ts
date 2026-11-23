/**
 * The headers a `metadata` fetch asks Gmail for — everything a listing line renders, plus the four mailing-list
 * headers `gmail triage` reads to tell a person from a sender that mails on a schedule.
 *
 * A leaf of its own rather than a constant inside `./api.ts`, because `api.ts` sits on the file-size ratchet and
 * the triage lane widened this list: `List-Id` names the list a message came through, `List-Unsubscribe` says a
 * sender offers a way out, `List-Unsubscribe-Post` says that way out is RFC 8058's one-click POST, and `List-Post`
 * (RFC 2369) says members can post — a discussion list, where the `From` is a person. A listing that renders none
 * of the four pays a few header bytes per message for them, which is the price of one list.
 */
export const LISTING_HEADERS: readonly string[] = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "List-Id",
  "List-Unsubscribe",
  "List-Unsubscribe-Post",
  "List-Post",
];
