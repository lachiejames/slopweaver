/**
 * The six flags `handover ask` and `handover register` refuse an ask without: the shape (a recorded ask
 * the owner has to parse is a defect) and its stakes (risk, blast radius and whether it is still real are what
 * the owner wants at a glance).
 *
 * Every subprocess case in this directory registers a row as a FIXTURE for some other property: what
 * `settle` prints over an open run, what `rule` derives, what `close` writes. Spelling the shape here
 * rather than opening `SLOPWEAVER_ALLOW_UNSHAPED_ASK` in each of them keeps those cases running over the
 * row a session really records — a row built through the hatch is the one shape none of them ever meets.
 *
 * It is a shared constant rather than four copies because the shape's own refusals are proved where they
 * belong (`unit/handover/askShapeGate.test.ts`), and a fixture repeated four times drifts three ways.
 */

/** The shape and its stakes, ready to spread into an argv. */
export const ASK_SHAPE: readonly string[] = [
  "--problem",
  "the doc cites two base branches and names neither as the one to use",
  "--options",
  "main :: every other run is on it\nthe release branch :: this doc cites it once",
  "--lean",
  "main — the one citation reads like a typo",
  "--risk",
  "a run starts on the wrong base and its diff is unreviewable",
  "--blast-radius",
  "this one doc and whichever run picks it up",
  "--still-real",
  "the doc still cites both branches",
  // The concrete example every new ask carries — the same fixture reason as the shape above.
  "--example",
  "You open the run's PR and it sits on the release branch the doc cites once. Should it be on main?",
];
