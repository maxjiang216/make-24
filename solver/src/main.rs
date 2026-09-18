// Exhaustive Make-24 solver + root-strategy census over exact rationals.
//
// Every solution is a binary tree whose leaves are the 4 cards. The "strategy" of a
// solution is its ROOT node: the operator plus the values its two subtrees evaluate to
// (6*4), together with how the leaves split at that root (2+2 or 1+3).
//
// Writes ../web/solutions.js and ../web/strategies.json; prints a census to stdout.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;

/* ---------------- exact rationals ---------------- */

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Rat {
    n: i64,
    d: i64, // always > 0
}

fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 { a.abs() } else { gcd(b, a % b) }
}

impl Rat {
    fn new(n: i64, d: i64) -> Rat {
        let s = if d < 0 { -1 } else { 1 };
        let g = gcd(n, d).max(1);
        Rat { n: s * n / g, d: s * d / g }
    }
    fn int(n: i64) -> Rat { Rat { n, d: 1 } }
    fn add(self, o: Rat) -> Rat { Rat::new(self.n * o.d + o.n * self.d, self.d * o.d) }
    fn sub(self, o: Rat) -> Rat { Rat::new(self.n * o.d - o.n * self.d, self.d * o.d) }
    fn mul(self, o: Rat) -> Rat { Rat::new(self.n * o.n, self.d * o.d) }
    fn div(self, o: Rat) -> Option<Rat> {
        if o.n == 0 { None } else { Some(Rat::new(self.n * o.d, self.d * o.n)) }
    }
    fn is_24(self) -> bool { self.d == 1 && self.n == 24 }
}

impl fmt::Display for Rat {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        if self.d == 1 { write!(f, "{}", self.n) } else { write!(f, "{}/{}", self.n, self.d) }
    }
}

/* ---------------- expression terms (for producing one sample solution) ---------------- */

#[derive(Clone)]
struct Term {
    v: Rat,
    e: String,
    atom: bool,
}

fn wrap(t: &Term) -> String {
    if t.atom { t.e.clone() } else { format!("({})", t.e) }
}

fn combine(a: &Term, b: &Term, out: &mut Vec<Term>) {
    let ops: [(&str, fn(Rat, Rat) -> Option<Rat>); 6] = [
        ("+", |x, y| Some(x.add(y))),
        ("*", |x, y| Some(x.mul(y))),
        ("-", |x, y| Some(x.sub(y))),
        ("-r", |x, y| Some(y.sub(x))),
        ("/", |x, y| x.div(y)),
        ("/r", |x, y| y.div(x)),
    ];
    for (sym, f) in ops {
        if let Some(v) = f(a.v, b.v) {
            // Negative intermediates are never needed: any solution using one has a
            // positive rewrite, e.g. (1-13)+(4*9) becomes (4*9)-(13-1).
            if v.n < 0 { continue; }
            let (l, r, s) = if sym.ends_with('r') { (b, a, &sym[..1]) } else { (a, b, sym) };
            out.push(Term { v, e: format!("{}{}{}", wrap(l), s, wrap(r)), atom: false });
        }
    }
}

fn solve(terms: &[Term]) -> Option<String> {
    if terms.len() == 1 {
        return if terms[0].v.is_24() { Some(terms[0].e.clone()) } else { None };
    }
    for i in 0..terms.len() {
        for j in (i + 1)..terms.len() {
            let mut merged = Vec::new();
            combine(&terms[i], &terms[j], &mut merged);
            let rest: Vec<Term> = terms
                .iter()
                .enumerate()
                .filter(|(k, _)| *k != i && *k != j)
                .map(|(_, t)| t.clone())
                .collect();
            for m in merged {
                let mut next = rest.clone();
                next.push(m);
                if let Some(s) = solve(&next) { return Some(s); }
            }
        }
    }
    None
}

/* ---------------- reachable values of a sub-multiset ---------------- */

// Every value a group of cards can evaluate to, using each card once.
fn reachable(vals: &[Rat], memo: &mut HashMap<Vec<Rat>, BTreeSet<Rat>>) -> BTreeSet<Rat> {
    if vals.len() == 1 {
        return [vals[0]].into_iter().collect();
    }
    let mut key = vals.to_vec();
    key.sort();
    if let Some(hit) = memo.get(&key) { return hit.clone(); }

    let mut out = BTreeSet::new();
    // Split the group into two non-empty halves; every value is (left op right).
    let n = vals.len();
    for mask in 1..(1u32 << n) - 1 {
        if (mask & 1) == 0 { continue; } // fix card 0 on the left, so each split is seen once
        let left: Vec<Rat> = (0..n).filter(|i| mask >> i & 1 == 1).map(|i| vals[i]).collect();
        let right: Vec<Rat> = (0..n).filter(|i| mask >> i & 1 == 0).map(|i| vals[i]).collect();
        let (ls, rs) = (reachable(&left, memo), reachable(&right, memo));
        for &a in &ls {
            for &b in &rs {
                let mut keep = |v: Rat| { if v.n >= 0 { out.insert(v); } };
                keep(a.add(b));
                keep(a.mul(b));
                keep(a.sub(b));
                keep(b.sub(a));
                if let Some(v) = a.div(b) { keep(v); }
                if let Some(v) = b.div(a) { keep(v); }
            }
        }
    }
    memo.insert(key, out.clone());
    out
}

/* ---------------- root strategies ---------------- */

// Operand text for a strategy label: parenthesise anything that isn't a plain
// non-negative integer, so 12/(1/2) and 12-(-12) can't be misread.
fn operand(r: Rat) -> String {
    if r.d == 1 && r.n >= 0 { r.to_string() } else { format!("({})", r) }
}

// All distinct root nodes of solutions for this multiset, as ("6*4", "2+2") labels.
fn strategies(cards: [i64; 4], memo: &mut HashMap<Vec<Rat>, BTreeSet<Rat>>) -> BTreeSet<(char, String, String)> {
    let vals: Vec<Rat> = cards.iter().map(|&c| Rat::int(c)).collect();
    let mut out = BTreeSet::new();
    for mask in 1..15u32 {
        if (mask & 1) == 0 { continue; } // card 0 always on the left half
        let left: Vec<Rat> = (0..4).filter(|i| mask >> i & 1 == 1).map(|i| vals[i]).collect();
        let right: Vec<Rat> = (0..4).filter(|i| mask >> i & 1 == 0).map(|i| vals[i]).collect();
        let shape = {
            let (a, b) = (left.len().min(right.len()), left.len().max(right.len()));
            format!("{}+{}", a, b)
        };
        let (ls, rs) = (reachable(&left, memo), reachable(&right, memo));
        let push = |op: char, x: Rat, y: Rat, out: &mut BTreeSet<(char, String, String)>| {
            out.insert((op, format!("{}{}{}", operand(x), op, operand(y)), shape.clone()));
        };
        for &a in &ls {
            for &b in &rs {
                // commutative ops: canonicalise operand order so 6*4 and 4*6 are one label
                if a.add(b).is_24() {
                    let (x, y) = if a <= b { (a, b) } else { (b, a) };
                    push('+', x, y, &mut out);
                }
                if a.mul(b).is_24() {
                    let (x, y) = if a <= b { (a, b) } else { (b, a) };
                    push('*', x, y, &mut out);
                }
                if a.sub(b).is_24() { push('-', a, b, &mut out); }
                if b.sub(a).is_24() { push('-', b, a, &mut out); }
                if a.div(b).map_or(false, |v| v.is_24()) { push('/', a, b, &mut out); }
                if b.div(a).map_or(false, |v| v.is_24()) { push('/', b, a, &mut out); }
            }
        }
    }
    out
}

/* ---------------- canonical (trainer) strategy ---------------- */

// One label per set: the strategy a player should be trained to SEE first.
// Ordered ladder, first match wins — reorder CANON_ORDER to change the teaching priority.
const CANON_ORDER: &[&str] = &[
    "double factor",
    "pair cancel",
    "234",
    "direct 3x8", "direct 4x6", "direct 2x12",
    "sum",
    "split 4x6", "split 3x8", "split 2x12",
    "25-1", "35-11", "33-9", "15+9", "28-4",
    "48/2", "72/3", "96/4", "120/5", "144/6", "168/7", "192/8",
    "216/9", "240/10", "264/11", "288/12", "312/13",
    "product", "sum-pair", "difference", "quotient",
    "fractional",
];

fn reach(vals: &[Rat], memo: &mut HashMap<Vec<Rat>, BTreeSet<Rat>>) -> BTreeSet<Rat> {
    reachable(vals, memo)
}

fn canonical(cards: [i64; 4], memo: &mut HashMap<Vec<Rat>, BTreeSet<Rat>>) -> &'static str {
    let v: Vec<Rat> = cards.iter().map(|&c| Rat::int(c)).collect();

    // 1. double factor: two copies of f, remaining x,y with x±y near t = 24/f.
    //    f*x + f*y, f + f*(x±y), or f*(x±y) - f — all consume both copies of f.
    for &f in &[2i64, 3, 4, 6, 8, 12] {
        let idx: Vec<usize> = (0..4).filter(|&i| cards[i] == f).collect();
        if idx.len() < 2 { continue; }
        let rest: Vec<i64> = (0..4).filter(|i| *i != idx[0] && *i != idx[1]).map(|i| cards[i]).collect();
        let (x, y) = (rest[0], rest[1]);
        let t = 24 / f;
        if [x + y, (x - y).abs()].iter().any(|&s| (s - t).abs() <= 1) { return "double factor"; }
    }

    // 2. pair cancel: two equal cards neutralise each other (x-x = 0, x/x = 1) and the
    //    other two already add to 24 — so 11+13 or 12+12.
    for i in 0..4 {
        for j in (i + 1)..4 {
            if cards[i] != cards[j] { continue; }
            let rest: Vec<i64> = (0..4).filter(|&k| k != i && k != j).map(|k| cards[k]).collect();
            if rest[0] + rest[1] == 24 { return "pair cancel"; }
        }
    }

    // 3. the "2 3 4" ladder: two of {2,3,4} are already cards, and the remaining two
    //    cards make the third in a single operation. 2*3*4 = 24.
    for i in 0..4 {
        for j in (i + 1)..4 {
            let rest: Vec<i64> = (0..4).filter(|&k| k != i && k != j).map(|k| cards[k]).collect();
            let (x, y) = (rest[0], rest[1]);
            if x == y || !(2..=4).contains(&x) || !(2..=4).contains(&y) { continue; }
            let missing = 9 - x - y; // {2,3,4} sums to 9
            let (a, b) = (v[i], v[j]);
            let m = Rat::int(missing);
            let one_op = a.add(b) == m || a.mul(b) == m || a.sub(b) == m || b.sub(a) == m
                || a.div(b) == Some(m) || b.div(a) == Some(m);
            if one_op { return "234"; }
        }
    }

    // 4. a base factor is on the table; the other three make its partner
    for &(f, p, name) in &[(3i64, 8i64, "direct 3x8"), (8, 3, "direct 3x8"),
                           (4, 6, "direct 4x6"), (6, 4, "direct 4x6"),
                           (2, 12, "direct 2x12"), (12, 2, "direct 2x12")] {
        for i in 0..4 {
            if cards[i] != f { continue; }
            let rest: Vec<Rat> = (0..4).filter(|&k| k != i).map(|k| v[k]).collect();
            if reach(&rest, memo).contains(&Rat::int(p)) { return name; }
        }
    }

    // 5. everything just adds up
    if cards.iter().sum::<i64>() == 24 { return "sum"; }

    // 6. one operation on each pair puts a base factor pair on the table
    for &(a, b, name) in &[(4i64, 6i64, "split 4x6"), (3, 8, "split 3x8"), (2, 12, "split 2x12")] {
        for mask in [0b0011u32, 0b0101, 0b1001] {
            let l: Vec<Rat> = (0..4).filter(|i| mask >> i & 1 == 1).map(|i| v[i]).collect();
            let r: Vec<Rat> = (0..4).filter(|i| mask >> i & 1 == 0).map(|i| v[i]).collect();
            let (ls, rs) = (reach(&l, memo), reach(&r, memo));
            if (ls.contains(&Rat::int(a)) && rs.contains(&Rat::int(b)))
                || (ls.contains(&Rat::int(b)) && rs.contains(&Rat::int(a))) { return name; }
        }
    }

    let strats = strategies(cards, memo);

    // 7. named product roots: the last TWO operations are (f1*f2) +/- adj. The first
    //    operation may build any one of the three parts, so 3*(12-1)-9 counts as 33-9.
    for &(f1, f2, adj, add, name) in &[
        (5i64, 5i64, 1i64, false, "25-1"),
        (5, 7, 11, false, "35-11"),
        (3, 11, 9, false, "33-9"),
        (5, 3, 9, true, "15+9"),
        (4, 7, 4, false, "28-4"),
    ] {
        debug_assert_eq!(f1 * f2 + if add { adj } else { -adj }, 24);
        let want = [Rat::int(f1), Rat::int(f2), Rat::int(adj)];
        // assign each card to slot 0 (f1), 1 (f2) or 2 (adj); one slot gets two cards
        'assign: for code in 0..81u32 {
            let mut slots: [Vec<Rat>; 3] = [vec![], vec![], vec![]];
            let mut c = code;
            for i in 0..4 {
                slots[(c % 3) as usize].push(v[i]);
                c /= 3;
            }
            if slots.iter().any(|s| s.is_empty()) { continue; }
            for k in 0..3 {
                if !reach(&slots[k], memo).contains(&want[k]) { continue 'assign; }
            }
            return name;
        }
    }

    // 7b. divide: last two operations are (A op B) / C, with C = d and the numerator
    //     24*d. Covers 48/2, 72/3, 96/4, 120/5, ... and additive numerators like (70+2)/3.
    //     A numerator part that is already 24 is a trivial x/x wrapper, so skip those.
    for d in 2..=13i64 {
        let want_num = Rat::int(24 * d);
        'div: for code in 0..81u32 {
            let mut slots: [Vec<Rat>; 3] = [vec![], vec![], vec![]];
            let mut c = code;
            for i in 0..4 {
                slots[(c % 3) as usize].push(v[i]);
                c /= 3;
            }
            if slots.iter().any(|s| s.is_empty()) { continue; }
            if !reach(&slots[2], memo).contains(&Rat::int(d)) { continue 'div; }
            let (ls, rs) = (reach(&slots[0], memo), reach(&slots[1], memo));
            for &a in &ls {
                for &b in &rs {
                    if a == Rat::int(24) || b == Rat::int(24) { continue; }
                    if a.add(b) == want_num || a.mul(b) == want_num
                        || a.sub(b) == want_num || b.sub(a) == want_num {
                        return match d {
                            2 => "48/2", 3 => "72/3", 4 => "96/4", 5 => "120/5",
                            6 => "144/6", 7 => "168/7", 8 => "192/8", 9 => "216/9",
                            10 => "240/10", 11 => "264/11", 12 => "288/12", _ => "312/13",
                        };
                    }
                }
            }
        }
    }

    // 8. tail: classify by the root operator, preferring integer operands
    // A root like 24*1 or 24-0 is a spare card wrapped around a subtree that already
    // made 24 — not a strategy. Skip those so the real operation underneath classifies.
    let trivial = |l: &str| {
        matches!(l, "1*24" | "24/1" | "0+24" | "24-0")
            || l.split(['+', '*']).any(|p| p == "0" || p == "1")
    };
    let integral = |l: &str| !l.contains('(');
    for &(op, name) in &[('*', "product"), ('+', "sum-pair"), ('-', "difference"), ('/', "quotient")] {
        if strats.iter().any(|(o, l, _)| *o == op && integral(l) && !trivial(l)) { return name; }
    }
    "fractional"
}

fn main() {
    let mut memo: HashMap<Vec<Rat>, BTreeSet<Rat>> = HashMap::new();
    let mut sol_entries: Vec<String> = Vec::new();
    let mut strat_entries: Vec<String> = Vec::new();

    let mut label_sets: BTreeMap<String, usize> = BTreeMap::new(); // strategy -> #sets offering it
    let mut op_sets: BTreeMap<char, usize> = BTreeMap::new();
    let mut shape_sets: BTreeMap<String, usize> = BTreeMap::new();
    let mut only_one: BTreeMap<String, Vec<String>> = BTreeMap::new(); // sets with a single strategy
    let mut canon_count: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut canon_sample: BTreeMap<&'static str, Vec<String>> = BTreeMap::new();
    let mut canon_entries: Vec<String> = Vec::new();
    let (mut solvable, mut total) = (0usize, 0usize);

    for a in 1..=13i64 {
        for b in a..=13 {
            for c in b..=13 {
                for d in c..=13 {
                    total += 1;
                    let cards = [a, b, c, d];
                    let key = format!("{}-{}-{}-{}", a, b, c, d);
                    let terms: Vec<Term> = cards
                        .iter()
                        .map(|&x| Term { v: Rat::int(x), e: x.to_string(), atom: true })
                        .collect();
                    match solve(&terms) {
                        None => sol_entries.push(format!("\"{}\":null", key)),
                        Some(s) => {
                            solvable += 1;
                            sol_entries.push(format!("\"{}\":\"{}\"", key, s));

                            let strats = strategies(cards, &mut memo);
                            let labels: BTreeSet<&String> = strats.iter().map(|(_, l, _)| l).collect();
                            let shapes: BTreeSet<&String> = strats.iter().map(|(_, _, s)| s).collect();
                            let ops: BTreeSet<char> = strats.iter().map(|(o, _, _)| *o).collect();
                            for l in &labels { *label_sets.entry((*l).clone()).or_insert(0) += 1; }
                            for o in &ops { *op_sets.entry(*o).or_insert(0) += 1; }
                            for s in &shapes { *shape_sets.entry((*s).clone()).or_insert(0) += 1; }
                            if labels.len() == 1 {
                                only_one.entry((*labels.iter().next().unwrap()).clone())
                                    .or_default().push(key.clone());
                            }
                            let c = canonical(cards, &mut memo);
                            *canon_count.entry(c).or_insert(0) += 1;
                            canon_sample.entry(c).or_default().push(key.clone());
                            canon_entries.push(format!("\"{}\":\"{}\"", key, c));

                            let list: Vec<String> = strats
                                .iter()
                                .map(|(_, l, s)| format!("[\"{}\",\"{}\"]", l, s))
                                .collect();
                            strat_entries.push(format!("\"{}\":[{}]", key, list.join(",")));
                        }
                    }
                }
            }
        }
    }

    std::fs::write(
        "../web/solutions.js",
        format!("const SOLUTIONS = {{{}}};\n", sol_entries.join(",")),
    ).unwrap();
    std::fs::write(
        "../web/canonical.js",
        format!("const CANONICAL = {{{}}};\n", canon_entries.join(",")),
    ).unwrap();
    std::fs::write(
        "../web/strategies.js",
        format!("const STRATEGIES = {{{}}};\n", strat_entries.join(",")),
    ).unwrap();

    /* ---------------- census ---------------- */
    println!("{}/{} multisets solvable\n", solvable, total);

    println!("root operator (a set counts once per distinct operator it can finish with):");
    let mut ops: Vec<_> = op_sets.iter().collect();
    ops.sort_by_key(|(_, n)| std::cmp::Reverse(**n));
    for (op, n) in ops {
        println!("  {}   {:5}  {:5.1}%", op, n, 100.0 * *n as f64 / solvable as f64);
    }

    println!("\nroot split shape:");
    let mut shapes: Vec<_> = shape_sets.iter().collect();
    shapes.sort_by_key(|(_, n)| std::cmp::Reverse(**n));
    for (s, n) in shapes {
        println!("  {}  {:5}  {:5.1}%", s, n, 100.0 * *n as f64 / solvable as f64);
    }

    println!("\ntop 40 strategies by number of solvable sets that admit them:");
    let mut labels: Vec<_> = label_sets.iter().collect();
    labels.sort_by_key(|(l, n)| (std::cmp::Reverse(**n), (*l).clone()));
    for (l, n) in labels.iter().take(40) {
        println!("  {:>10}  {:5}  {:5.1}%", l, n, 100.0 * **n as f64 / solvable as f64);
    }
    println!("\n{} distinct strategies in total", label_sets.len());

    println!("\nsets with exactly ONE root strategy (the forced ones):");
    let mut forced: Vec<_> = only_one.iter().collect();
    forced.sort_by_key(|(_, v)| std::cmp::Reverse(v.len()));
    let n_forced: usize = only_one.values().map(|v| v.len()).sum();
    println!("  {} such sets", n_forced);
    for (l, sets) in forced.iter().take(15) {
        let sample: Vec<&str> = sets.iter().take(4).map(|s| s.as_str()).collect();
        println!("  {:>10}  {:4} sets   e.g. {}", l, sets.len(), sample.join("  "));
    }

    println!("\ncanonical strategy (one per set, first rule in the ladder that fires):");
    for name in CANON_ORDER {
        let n = *canon_count.get(name).unwrap_or(&0);
        if n == 0 { continue; }
        let sample: Vec<&str> = canon_sample[name].iter().take(4).map(|s| s.as_str()).collect();
        println!("  {:>12}  {:5}  {:5.1}%   e.g. {}", name, n, 100.0 * n as f64 / solvable as f64, sample.join("  "));
    }
}
