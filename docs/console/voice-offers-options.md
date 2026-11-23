# "What now" gets options, and the fleet's state gets a measurement

Asking what to do next and getting a single path to agree to leaves the owner talking to a yes man, with no options
and no solutions. Without these lines the voice offered one path for the owner's yes, read the briefing's next step
back as the only one, met a question about how misaligned the fleet is with "still unknown", met a pace reproach with "I haven't checked",
and sent the owner to type in the supervisor's chat. No line in either prompt said otherwise (`src/talk/optionsLines.ts`
carries the repro).

- **A what-to-do question about the thing in hand** gets two to four options, each an act, who does it and what it
  costs, then a lean and its reason, ending on the owner's pick. A briefing's or the supervisor's next step can be one
  of them, never the only one. The owner's whole plate ("what is waiting on me") is still `action_items`.
- **A question about the fleet's state** is measured first (`talk find-card`, `board_row`, `read_supervisor`,
  `cmux list`) and answered with its source; with nothing measuring it, the answer names who is finding it and where
  it lands, or that nobody is. A pace reproach is relayed and then answered with where the work stands.
- **A frustration whose cause the owner names** ("no options", "yes man", "useless") is not an unclear annoyance and gets
  no which-part question, and "I want to talk to the supervisor directly" on a call is relayed and read back, never
  pointed at its chat. These head the precedence order in `src/talk/alignmentQuestionLines.ts`: the options end on
  the owner's pick, while a measurement goes first and ends on its offer only when nobody is on the work, so a check-in
  mid-walk still has its place after it.

## Measured

On the real delegated thread, replaying the owner's turns from the call that prompted these lines (text turns, real
reads, a relay answered with its real note and not performed), two paired runs per prompt against the fleet's later
state, not the original's. Old prompt: the misalignment question read the board and seats 0 of 2 times (one run found
an older audit page), the pace reproach said where the work stood 0 of 2, and the final turn gave no options 2 of 2,
one of them sending the owner to the supervisor's chat. New: the board and seats were read and three costed options
with a lean followed 2 of 2, the pace reproach named the record with no results and nobody assigned 2 of 2 (0 of 2
before the pace-reproach line),
and the final turn relayed, read the supervisor back and gave options 2 of 2. Text turns prove the delegated model's
answers, never the realtime voice's delivery.
