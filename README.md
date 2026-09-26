# Make 24

Static web app for the Make-24 card game, plus a Rust solver that precomputes every
4-card multiset (A..K = 1..13) exactly, over rationals.

## Solver

    cd solver
    cargo run --release > ../web/solutions.json   # then wrap as `const SOLUTIONS = ...;` in web/solutions.js

1362 of the 1820 multisets are solvable. `web/solutions.js` is the generated table
(`"1-5-5-5": "5*(5-(1/5))"`, or `null` when unsolvable).

## Web app

No build step. Serve the folder:

    cd web && python3 -m http.server 8000

- **Single**: one 4-card set at a time, drawn uniformly from the 1362 solvable
  multisets (suits assigned at random, distinct per repeated rank). Per-set timer,
  mo3 / ao5 / ao12 (olympic average — drop best and worst) and overall mean, saved
  in localStorage. Enter submits, Enter again deals the next set, Esc gives up
  (DNF, shows a solution).
- **Deck**: a shuffled 52-card deck as 13 sets against one running clock. Type `u`
  for a set you believe is unsolvable; the run is valid only if every set you marked
  really is unsolvable.

- **Solver**: type four cards as `1 2 3 4`, `1,2,3,4`, or `1234` (no separator means one
  character per card; `0` = 10, `A T J Q K` also work, so `j0q3` is 11 10 12 3).
  "solvable?" only says yes/no. "all solutions" lists one row per equivalence class
  (same tree up to commutativity, associativity and inverses; dividing by something equal
  to 1 counts as multiplying by it, e.g. `/1` ~ `*1`), shown in a standard form:
  added terms then subtracted terms, each largest value first (same for `*` then `/`),
  applied at every level. Classes are ordered so similar ones sit next to each other; a
  bar on the left joins neighbours, brighter the smaller the change between them
  (rebuild one piece from the same cards to the same value, swap two equal-valued
  pieces, or move a +0 / ×1 piece), with a gap between unrelated groups. Expand a row to see every
  written form in that class. Also shows the set's canonical strategy label.

- **Train** (`train.html`): flash cards over all 1820 sets, with no daily schedule.
  *Solvable?* (all sets; answer `→` solvable / `←` unsolvable, checked automatically) and
  *Solve* (the 1362 solvable sets; any key stops the clock and shows every solution, then
  you grade yourself). The next set is the weakest one by rolling accuracy, then rolling
  time; a just-answered set sits out a few turns after a miss, longer after each fast
  right answer in a row. New sets enter (hardest first, easiest first, or by strategy)
  once everything available is right and fast. A filter narrows the deck by ranks, face
  cards, number of solutions (distinct, or a range of total written forms), and strategy
  (canonical, or any solution's).
  Progress lives in localStorage with CSV export/import.
  `web/difficulty.js` comes from `node scripts/class-counts.js`; `web/strategy-tags.js`
  (every canonical-ladder strategy that applies to a set) comes from the Rust solver.

- **Survey** (`survey.html`): one timed pass through all 1362 solvable sets in a fixed
  random order. The first key turns the cards over; after that, each key press records
  the time and deals the next set at once (`←` instead flags a miss). The set just done
  is shown underneath with its time, solution count, strategy and a solution. Nothing is
  graded. The pass resumes after a reload and exports as CSV (order, set, ms, flagged,
  distinct and written solution counts, strategy).

Input accepts `+ - * /`, parentheses, and `A J Q K` (or `1 11 12 13`). Fractions are
exact, so `(5-1/5)*5` is accepted.

## Deploying to Vercel

Import the repo in Vercel with the default settings (framework preset "Other", no build
command, root directory = repo root). `vercel.json` rewrites `/` and every path to `web/`,
so the app is served at the site root and `multiplayer/` can still load `/shared/`.
