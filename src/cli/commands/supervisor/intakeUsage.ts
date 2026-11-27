/**
 * The usage text of `supervisor intake` and `supervisor intake-mark` — a leaf, so `./intakeRun.ts` and
 * `./intakeMarkRun.ts` hold the verbs and not their prose.
 */

/** `supervisor intake`'s usage. */
export const INTAKE_USAGE =
  "usage: slopweaver supervisor intake [--session <id>] [--since <iso>] [--now <iso>] [--home <dir>] [--json]\n" +
  "\n" +
  "Walks the WHOLE supervisor chain — every session that has held the pin (`slopweaver supervisor chain`) —\n" +
  "and lists every turn the owner typed into any of them that nothing witnesses: no board row anchored to it,\n" +
  "no settlement naming it, no intake mark. A turn younger than one sweep tick is in grace. Each unwitnessed\n" +
  "turn prints the `handover register` line that would witness it, and a window the chain cannot reach is\n" +
  "stated rather than counted clean. --session narrows the walk to one transcript.\n" +
  "\n" +
  "Every final turn the owner TYPED to the console (`typed-owner-`, `typed-in-` segments on the owner's own\n" +
  "console) counts too, until a row anchored at its talk-call:<call>#<segment> pointer, the relay row it\n" +
  "registered, or an intake mark covers it. It is remembered by pointer in sessions/typed-intake.jsonl, so it\n" +
  "stays owed past the 24h window and across chairs. Printed as pointer and instant only, never its words;\n" +
  "`talk unread` reads them. --session leaves this half out.\n" +
  "\n" +
  "The same walk reads every message another session sent a chair. One that landed AFTER that chair's\n" +
  "successor took the pin, with no SendMessage back to its sender from any chair, is CARRIED to the live\n" +
  "chair and exits non-zero; one inside the chair's own span with no reply is listed as unanswered. Clear\n" +
  "either by replying, or with `supervisor intake-mark --turn <pointer> --as answered|no-ask`.\n" +
  "\n" +
  "example: slopweaver supervisor intake --since 2026-08-28T00:00:00Z";

/** `supervisor intake-mark`'s usage. */
export const MARK_USAGE =
  "usage: slopweaver supervisor intake-mark --turn <pointer|talk:turnId> --as card|answered|no-ask --witness <text> " +
  "[--now <iso>] [--home <dir>]\n" +
  "\n" +
  "Records what an owner turn became when it did not become a board row: `card` names the question on\n" +
  "the briefing page; `answered` names where the answer went (a run slug, a permalink); `no-ask` carries why\n" +
  "the turn asked for nothing. A turn that IS an ask wants `handover register --anchor <pointer>` instead.\n" +
  "On a talk:<turnId> pointer the relay's own row is settled too: filed into a card's row slug, else answered.\n" +
  "A transcript:<session>#<uuid> pointer must name one of the owner's turns or a message another session sent, read\n" +
  "off that transcript — a uuid naming any other record (an assistant reply, a tool result) is refused.\n" +
  "An `answered` witness naming a board row (its slug, alone or in prose) carries the owner's words at the pointer\n" +
  "onto that row as a steer before marking; when that write fails nothing is marked, and the refusal names\n" +
  "`handover quote <slug> --add-steer <pointer> --apply --home <home>`. `card` and `no-ask` carry nothing.\n" +
  "\n" +
  "Prefer a witness that IS one reference — a row slug, a URL, a PR URL or a turn pointer. A free-text\n" +
  "witness already marking three other turns is refused (SLOPWEAVER_ALLOW_INTAKE_WITNESS_REUSE=1 overrides),\n" +
  "and when a turn holds several marks a later one replaces an earlier only from the same rank or higher:\n" +
  "reference, then specific free text, then free text shared past three turns.\n" +
  "\n" +
  'example: slopweaver supervisor intake-mark --turn transcript:<session>#<turn> --as card --witness "Merge that PR tonight?"';
