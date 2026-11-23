/**
 * The docs sidebar, ordered by the question a reader arrives with rather than alphabetically.
 *
 * Six groups, and the order is the ladder: what it does, then how the console at `/` is derived, then what
 * it knows, then what it is allowed to do, then how it runs itself, then how it is built. A reader who
 * stops after the first group has a true picture; one who reads all six has the whole one.
 *
 * The live pages themselves are not here: they are the console, served at `/` outside these docs, and
 * `console/` holds only the page that says how each is derived.
 */
export default {
  index: "What the bot does",
  console: { title: "The console" },
  phases: { title: "The three phases" },
  model: { title: "What it knows" },
  trust: { title: "What it may do" },
  fleet: { title: "How the fleet runs" },
  build: { title: "How it is built" },
  showcase: "Showcase",
};
