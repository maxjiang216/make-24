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

- **Solver**: type any four cards and get every solution that is distinct as a tree —
  results are deduped up to commutativity, associativity and inverses, so `2*3*4/1`,
  `2/1*3*4` and `3*2*(4/1)` count once. Shows the set's canonical strategy label.

Input accepts `+ - * /`, parentheses, and `A J Q K` (or `1 11 12 13`). Fractions are
exact, so `(5-1/5)*5` is accepted.
