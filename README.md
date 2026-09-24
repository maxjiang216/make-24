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
  applied at every level. Related classes (differ by swapping two equal-valued pieces, or
  reduce to the same expression once a +0 or ×1 piece is dropped) are listed together,
  joined by a bar. Expand a row to see every
  written form in that class. Also shows the set's canonical strategy label.

Input accepts `+ - * /`, parentheses, and `A J Q K` (or `1 11 12 13`). Fractions are
exact, so `(5-1/5)*5` is accepted.

## Deploying to Vercel

Import the repo in Vercel with the default settings (framework preset "Other", no build
command, root directory = repo root). `vercel.json` rewrites `/` and every path to `web/`,
so the app is served at the site root and `multiplayer/` can still load `/shared/`.
