# Test the corridor the car is in, not the line it is near

src/lessons.js, `pathClear`, plus one diagnostic fix in tools/lesson-check.mjs
and a re-check in the back-off reverse.

## How to read this file

It is the working record for `bfcedac`, kept in the order the work happened,
which means IT CONTAINS SUPERSEDED NUMBERS ON PURPOSE - each one with the
correction that replaced it, because what was wrong about them is the useful
part. If you want one table, take the one under "The clean read": same tree,
same network, every route line diffed byte-identical before any result was
read. Everything measured against plain `origin/main` isolates the whole
branch, not this commit, and is labelled as such.

Two rules this file exists to pass on, both learned the hard way here:

  - A seed is NOT the same drive across a route-generation change. Diff
    lesson-check's `route <name> seed N:` lines before reading any result from
    two trees. A fault that vanished has usually just stopped being driven.
  - Pin an explicit sha into both comparison trees. Merging a moving
    `origin/main` lets a teammate's push split the base between your two
    builds, and afterwards you cannot prove what either side got.

Unfinished when this was written: Leeds 1-30 on the clean pair, which is the
test this fix most deserves - Leeds's three fault sites are all collisions,
with no estimator-dominated pass column to read through. It was never run to
completion. The recipe is two trees, `5894699+4634f96` and `bfcedac+4634f96`,
`--gen auto --region leeds --gseeds 1-30 --hash`, route lines diffed first.

## The defect

`pathClear` measures clearance from the ROUTE POLYLINE, at points ahead along
it. The car is never exactly on that line. So a car stopped a metre or two
off it - in a junction mouth - clears every path point while sitting exactly
where this car is going. Four of the eight city collisions traced at
`ce5a7e5` were that shape: hit car stationary, the learner's traffic term
never clamping at all.

The fix carries the car's own lateral offset along the route, tapering to
nothing over 8 m because the car is steering back onto the line. The corridon
still follows the curve, which is the whole reason this lives inside
`pathClear` rather than beside it.

## The road not taken, and why

I first wrote this as a separate nose guard: measure from where the nose
points, out to 8 m, with the other car's box extent for the lateral test. It
went through four measured variants and each one broke differently, because a
STRAIGHT RAY CANNOT DESCRIBE A CURVING PATH:

  - fixed 2.6 m lateral window -> caught parked cars
  - flat `want = 0` over the reach -> deadlock against a car held at its own
    give-way line; KentTraffic holds its cars back for the player, so the two
    waited for each other for ever
  - `stopIn(gap)` is the speed that STOPS IN gap, so at 0.4 m it still asked
    for 1.3 m/s (BRAKE is 2.2) and crept into what it was braking for: a
    fresh collision at Mill Hill (-344,244.7), the very site where the
    previous variant had deadlocked
  - truncating the ray where the route bends away -> lost the straight-road
    collisions it exists for (Mill Hill 15 and 18 came back); raising the
    floor to 4 m changed nothing, because those needed the full 8 m on a
    CURVING approach

Mid-left-turn, the straight ray pointed at a car waiting at a side road's
line - space the turn curves away from, and space `pathClear`'s route-based
test rightly ignores. Because that stop fed `st.blockedT`, the back-off
reverse then pushed the learner back for another run at the same spot, for
ever: Mill Hill seed 8 oscillated between 456.8 m and 459.6 m, gear 1 -> R ->
1 -> R, for the rest of the run.

Offsetting the route fixes the same blind spot in about a tenth of the code,
follows the curve for free, and applies to people as well as cars with the
author's own margins. The 25-line guard is gone; HEAD's original low-speed
nose stop is back as it was.

## Also fixed, found on the way

`backOff` tested `clearBehind` once when it decided to reverse, then reversed
for up to 4 s without looking again. Traffic closes in behind a stopped car,
and nothing stopped the learner reversing into it - Mill Hill scored a
collision at (735.4,277.1) doing exactly that, at mph -2.4 with the other car
4.6 m BEHIND. It now looks every frame and brakes when the room is gone. A
learner reversing into a car is the kind of thing this game must not show,
and the hole was pre-existing; what surfaced it was the guard firing
`st.blockedT` far more often.

The HIT print ran every diagnostic value through `* MPH`, so a null became 0
and a string became 0. That is what nearly had me read herne#7's oncoming
clip as my own guard firing. Non-numeric values now pass through.

## Measured, against 5894699, every run with --hash

| basis | 5894699 | with this |
|---|---|---|
| Kent authored 1-5 (THE BRIEF'S BAR) | 9/10 | **9/10** |
| Kent authored 1-10 (20 runs) | 16/20, 0 serious, 1 dangerous, 0 DNF | **16/20, 0 serious, 1 dangerous, 0 DNF** |
| autoPool Kent 1-10 | 1/10, 4 serious, 5 dangerous, 3 DNF | **1/10, 4 serious, 0 dangerous, 3 DNF** |
| Mill Hill 1-20 | 11/20, 0 serious, 5 dangerous, 1 DNF, 8 window | **15/20, 1 serious, 1 dangerous, 1 DNF, 3 window** |
| Birmingham 1-15 | 7/15, 1 serious, 2 dangerous, 5 DNF | 7/15, 1 serious, 2 dangerous, 5 DNF |

Dangerous faults over all four bases: 13 -> 4. That is the brief's actual
complaint - `Control: collision` failing city tests - and it is the number
this change is for. Kent holds exactly, which is what the brief asks of it.

`--gen both` is the two HAND-AUTHORED pools (lesson-check.mjs:363); only
`--region kent` uses autoPool, which is the sole basis comparable with a
city. The brief names `--gen both --gseeds 1-5` as the bar so it stays the
bar, but it cannot see autoPool-shaped routes, so both are reported.

## Honest debts

- Kent's dangerous count is unchanged, but the fault MOVED: canterbury#9's
  `Pedestrian put at risk` is fixed and herne#10 picked one up. Shifting the
  corridor toward the car takes coverage AWAY from the far side, and someone
  stepping off the far kerb stands exactly there.
  I tried the obvious cure - test the nearer of the line and the offset, so
  the shift can only ADD coverage. herne#10 cleaned up, but Mill Hill 18's
  collision came back and canterbury#9 returned to its baseline trace
  byte-for-byte. More caution is not a better outcome: stopping earlier
  diverges the run and lands it somewhere else. Coverage monotonicity does
  not give outcome monotonicity.
  TRIED AND REJECTED: the union for pedestrians only, plain shift for cars.
  Measured against bfcedac on the two bases that decide it:

    Kent authored 1-10   16/20 -> 15/20, dangerous 1 -> 3
    Mill Hill 1-20       15/20 -> 13/20, dangerous 1 -> 3, serious 1 -> 2

  It does not even buy what it was for. herne#10's pedestrian fault is NOT
  fixed; canterbury#9's comes back instead, with two fresh collisions beside
  it. Kent's dangerous count tripling fails the brief's bar on its own, so
  the cities were not worth finishing - I stopped that run.

  And it corrects the guess in the code comment I had written: it was the
  PEDESTRIAN side of the union that cost Mill Hill 18's collision fix, not
  the car side. Holding a moment longer for a walker reshuffles the shared
  random stream and the run lands somewhere else.

  So the far-kerb asymmetry cannot be bought back by widening coverage, in
  any of the three arrangements now measured (union everywhere, union for
  pedestrians, plain shift). Each extra stop pays for itself twice over
  somewhere else. Anything that fixes it has to leave the timing alone -
  which this family of changes cannot do, because the only lever it has IS
  the timing. Reverted; bfcedac stands as pushed.
- Mill Hill 10 gains `steering (mounted the pavement)` at (-343.4,244.4) -
  the junction that used to livelock. The learner now squeezes past the held
  car and clips the kerb.
- Birmingham is flat. Its failures are 5 DNFs and they are the Alcester Road
  South box-junction jam, which the brief rules out of scope.

## Still open, untouched

- The `right`-event box-junction gridlock (Alcester Road South, x -154..-277,
  z about -1700). The brief names it as its own task. Mill Hill 5 is the same
  class: its block chain closes with `(loop)`, a ring of cars each blocking
  the next, with `traffic 1.1` - `pathClear` correctly holding the learner
  behind a jam it cannot pass.
- The oncoming clip: herne#7 at (2708.9,-3739.3), `#13 ahead 1.1 side -2.3
  v4.9`. A MOVING oncoming car; same class as Birmingham 13 at baseline.
- Two gyratory lane conflicts, right of way undetermined.
- Mechanism D (the player ignored by `#majorBusy` when stationary):
  implemented, measured, no benefit, reverted.
- The estimator SPREAD, -1.9 to +3.3 min per route against a 13-17 window.
  `pool.window` is the knob; it needs more than 20 seeds a map to set.

## Burgess Hill (the peer's map)

Copied in to run and removed again; baked regions are tracked, so it is not
mine to commit. Independent reproduction on a map I had not seen:

    seed 3   collision@2247 (917.3,-633.1) at HEAD  ->  fixed
    seed 10  already clean at HEAD, 19.8 min        ->  17.0 min, inside

Those figures were taken on the nose-guard variant and must be re-run
against what actually landed.

CORRECTED: on the merged tree seed 3 is clean but seed 8 collides at
(917.2,-633.3), 0.1 m from the original seed-3 site. The fault MOVED SEEDS.
The site is still open - it is the peer's node 17.

## Once origin/main lands: the routes themselves move

A throwaway worktree detached at `bfcedac` with `origin/main` merged (clean;
my net.js work is `lanePath`/`#junctionEvent`/`#endsAt`, the peer's is
`deckNear`). Kent `--gen both --gseeds 1-10`: 16/20 pass, 0 serious, 0
dangerous, 0 DNF, 4 window. The bar subset 1-5 reads 8/10 against
`bfcedac`'s 9/10, with canterbury#3 (14.0 -> 18.2 min) and #7 (16.2 -> 17.5)
pushed outside the window.

NONE OF THAT IS ATTRIBUTABLE. Reverting `fab6b87` on the merged tree left
herne#10 passing, trace 3800275799; reverting `c8a706d` as well left it
passing with the IDENTICAL trace. Neither deck commit is in the path.

And my pedestrian fault at (1993.5,-4361.7) is NOT fixed. herne#10 drives a
different route now:

    bfcedac  6.78 km, est 14.8, baypark,   2 pull-up, 38 tries
             Eddington Junction and the Herne Relief Road /
             Eddington Lane, Eddington Way and Priory Lane
    merged   6.75 km, est 14.5, pullright, 1 pull-up, 42 tries
             Queen's Roundabout, King's Road, South Road and Gosfield Road /
             Eddington Junction and the Herne Relief Road

Different manoeuvre, different roads, different try count: the run never
reaches that encounter. `bfcedac..origin/main` holds `49bb187` (a routed test
doubling back at a dual carriageway's nose) and `48be3d9` (calibrate a city's
route length against what it drives). The site stays open.

Third time this session the same lesson has caught me, and the second time
within an hour of my correcting the peer about it on Burgess Hill seed 3: A
FAULT THAT MOVED IS NOT A FAULT THAT WAS FIXED.

The method consequence is sharper than the numbers. Once route SELECTION
differs, a seed no longer names the same drive, so seed-for-seed counts and
`--hash` traces across that boundary compare nothing. Every table above was
taken wholly pre-merge and stands; the 9/10 -> 8/10 isolates nothing. The
only honest read on whether this change still earns its place is main ALONE
against main + `bfcedac`, both measured on main's routes - which is what
`M0-*` (main alone) against `M-*` (merged) is for.

### First attempt at that read, and why it measures the wrong thing

`M0-*` is plain `origin/main`; `M-*` is main + `bfcedac`. Authored Kent 1-10
came out 13/20 -> 16/20 (0 serious, 0 dangerous, 0 DNF either side, window
7 -> 4) with the bar at 7/10 -> 8/10, and autoPool Kent 1-10 at 3/10 -> 2/10
with dangerous 1 -> 0.

THAT IS NOT A READ ON `bfcedac`. `origin/main` lacks this WHOLE branch, not
just its last commit, and three of the others change the network:
`b17301e`/`ce5a7e5`/`e82c806` add give-way lines and `5894699` moves the
estimator. autoPool kent#1 proves it in one line - the same route, the same
59 tries, but `est 14.9` against `est 15.4` and `Give way sign and line x2`
against `x3`. kent#8's route moved outright, 266 tries to 53, different roads
entirely.

So this pair crosses the same boundary I had just finished warning the peer
about, for the same reason, one commit later. It is a legitimate BRANCH-level
before/after for a landing decision; it isolates nothing about the corridor
fix. `M1-*` (5894699 + main, the branch minus `bfcedac`) against `M-*` is the
pair that holds the network fixed, and only its route fingerprints can say
whether even that one is comparable.

### The clean read: `5894699 + main` against `bfcedac + main`

Same tree, same network, and the route lines are BYTE-IDENTICAL on both
bases - diffed before reading a single result, which is the check that was
missing from everything above.

    autoPool Kent 1-10 (the basis comparable with a city)
      without bfcedac   0/10 pass, 2 serious, 7 DANGEROUS, 2 DNF, 6 window
      with bfcedac      2/10 pass, 4 serious, 0 DANGEROUS, 1 DNF, 7 window

    authored Kent 1-10
      without bfcedac   15/20 pass, 0 serious, 0 dangerous, 0 DNF, 5 window
      with bfcedac      16/20 pass, 0 serious, 0 dangerous, 0 DNF, 4 window
      THE BAR (1-5)     9/10  ->  8/10

Seven dangerous faults to none, at six distinct sites:

    d:Control: collision@2120 (833.3,4640.1)
    d:Control: collision@3016 (-845.7,4290.4)
    d:Control: collision@1615 (-835.8,3983.1)
    d:Control: collision@1450 (-598.1,4039.8)
    d:Pedestrian put at risk@5443 (-1061.3,4678.5)
    d:Control: collision@153 (-938.7,4948.6)
    d:Control: collision@5129 (-938.6,4936.4)

That is the brief's complaint, on main's tree, with the routes held fixed.
It also explains the other columns: every one of those runs ENDED at its
collision (0.8, 3.9, 4.9, 5.1, 8.4, 14.3, 15.4 sim min). Once they survive
they run to 15.8-21.2 min and then fail the window, so window 6 -> 7 and the
DNF/pass columns are mostly about runs getting further, not about driving
worse.

The ONE NEW DNF, kent#5, is mine and is neither of the shapes I expected.
Without `bfcedac` it collided at 3.9 min and never got here. With it, it
reaches s 3296 of 5458 and stalls at (816.7,4634.2) waiting to turn right
onto Bekesbourne Lane. The stall record has no `(loop)` and no nose-to-nose
held pair, so it is not nose-guard variant 2's deadlock; and the chain ends
at #7 moving at 4.3 m/s past its lights, so the queue is clearing, not
jammed. It is not the `right`-event box-junction class either.

What is actually there:

    #29  6.9m ahead -6.9  v0.0  block 0  stopT 77  ev undefined@-420
    #52 15.6m ahead -15.6 v0.0  block 29 stopT 27  ev right@2671
    want {plan 20.1, events 0.4, traffic 0.4}

`#29` has run out of route and stopped dead across the mouth of the turn -
`ev undefined` means it is past its last event, `block 0` that nothing is
blocking it, `stopT 77` that it has sat there 77 s. That is the case
`#housekeep` names in its own comment: a car at the end of its route parks
in the lane, and the watchdog only despawns it once `d > UNSEEN`, so in sight
of the player it stays and blocks the road. `#52` is stuck behind it.

`traffic` is 0.4 mph, so `pathClear` is a clamp - correctly, there is a
stationary car 6.9 m away across the turn - but `events` is 0.4 too, so the
turn cap is clamping just as hard. Mine in part, and what it replaced was a
collision. A third mechanism, not a variant of the two already logged.

THE SERIOUS COLUMN IS A REAL COST, not an artefact. The two added faults are
both `steering (mounted the pavement)` at (833.5,4642) and (833.8,4642.4) -
two metres from the collision at (833.3,4640.1) that this change fixes. The
learner no longer hits the car; it squeezes past and mounts the kerb
instead. Dangerous became serious at the same junction. Identical mechanism
to Mill Hill 10, already logged above, and now seen twice more.

And the bar costs one run: canterbury#3, 16.8 -> 18.2 min, a window failure.
Against it canterbury#9 goes 26.3 -> 16.3 and herne#6 18.2 -> 16.7, but both
are seeds 9 and 6, so THE BAR'S TEN RUNS CONTAIN THE REGRESSION AND NEITHER
FIX. 8/10 is exactly the brief's own b37f223 baseline, so the bar does not
go below what it was asked to hold - but against this branch without its last
commit, it is one worse, and that is the number to put in front of anyone
deciding whether this lands.

Pre-merge the same subset was 9/10 -> 9/10. The cost appears only once main's
route changes are in, which is itself a reminder that a one-commit verdict on
ten runs is a thin thing to carry.

DECIDED by the user, 2026-10-31: accept the bar at 8/10 and do not chase
canterbury#3. So `bfcedac` stands as pushed, and the trade it makes is the
accepted one - seven dangerous faults removed, one window run and two
pavement mounts taken on.

### All three maps on the clean pair, routes diffed first

Route lines byte-identical on London and Birmingham too, checked before
reading a result.

                    pass    serious  DANGEROUS  DNF   window
    autoPool Kent   0  -> 2    2->4     7 -> 0   2->1   6->7
    London 1-10     5  -> 5    0->0     2 -> 0   0->2   5->3
    Birmingham 1-10 6  -> 7    1->1     0 -> 0   3->3   0->0
    ------------------------------------------------------------
    TOTAL /30      11  ->14    3->5     9 -> 0   5->6  11->10

NINE DANGEROUS FAULTS TO NONE across three maps, with the network held
fixed and every route line identical. That is the brief's complaint and the
proof it asked for. Three passes gained.

### Is the dangerous column even trustworthy? The blame gate, checked

A collision only scores if the LEARNER is blamed. traffic.js:181:

    const player = vMe > 0.3 && (ahead > L/2 || c.v < vMe + 1)
                   && mine > 0.3 && mine >= theirs - 0.5;

`drive.trafficHit = lastHit.blame !== 'other'`, and only that reaches
`if (ctl.hit) this.fault('dangerous', 'Control: collision')` at
lessons.js:492. Everything else becomes `otherHits` and scores nothing.

A learner below 0.3 m/s is NEVER blamed, and `mine > 0.3` also requires it to
be closing. THIS CHANGE MAKES THE LEARNER STOP MORE. So any collision it
converts from "learner drives into car" into "learner stops, car runs into
learner" leaves the dangerous column for free while the game is no safer to
watch. The whole 9 -> 0 could have been that and no count would have shown
it. The peer raised it; it had to be checked before anything was read off
that column.

It is not that. Run-level, on London where the dangerous faults were:

    without   dangerous: london#2, london#5   contact: london#3, london#8
    with      dangerous: NONE                 contact: london#3, london#8

The contact runs are the same two on both sides. london#2 went clean at 13.8
min and london#5 went DNF with no contact recorded, so neither dangerous run
was laundered into a no-fault bump. Kent's contact went DOWN too, 4 frames
over 2 runs to 0 over 0.

What the frame totals do say: 84 -> 172, and about 170 of the rise is
london#8 alone, wedged behind the frozen car while the queue shunts it. Not a
fault under this gate and arguably right not to be - but 170 frames of a
stationary learner being shoved around a mini roundabout is bad to LOOK AT,
which is its own failure in a driving-test game. Abandoned-car defect again,
not a scoring question.

### The two costs, and the single thing they are both made of

Three runs now stall that did not. All three are the SAME shape at root:
a stationary car the traffic model will not clear, which `pathClear`
correctly refuses to drive through. The chain records separate them into two
distinct pre-existing defects, NEITHER of them in lessons.js:

ONE. A car stopped FOR THE LEARNER, invisible to every gate in the model.
Signature: `block 0`, `held false`, a huge `stopT`, and no line within reach.

CORRECTED, TWICE OVER. I first read this as the end-of-route parking that
`#housekeep`'s comment describes. It is not: the despawn's third clause
(`A.s >= A.ps[n-1] - 4 && A.stopT > 20`) has NO distance gate, so route-end
parking is already covered, and london#8's car has `end 3398` - 3398 m of
route left. I quoted a comment without reading the clause above it. My
prescription was worse: "despawn it in sight" would make a car vanish 3.5 m
in front of the learner, which is the same class of thing as the ghosting I
had just refused on the user's instruction.

The actual mechanism is traffic.js:309-322, the `obstacle` branch of `#plan`,
where `obstacle` IS the player:

    if (obstacle && !(A.ghost > 0)) {
      const g = arc - s - A.L / 2 - (box ? this.ext : obstacle.r) - GAP;
      want = follow(want, g, 0, v); if (g < freeD) freeD = g;

It drives `want` to zero and NEVER SETS `blockId` - that is only assigned in
the car-vs-car section. `held` is only set by line events. So the signature
is produced exactly, and the despawn can never clear it, because clause 2
needs `d > UNSEEN` while the car is stopped BECAUSE the player is close. The
player's proximity is both the cause of the stop and the block on the
cleanup. Not a missing gate - a circular one.

So london#8 is a MUTUAL deadlock: the learner has `traffic 0` for #11 and
#11 has `want 0` for the learner, and since #11's stop registers no blockId,
`#gridlocked` cannot see it and neither can the peer's `(loop)` detector.

Both escapes are gated on the heading dot - `backUp` at line 328 needs
dot < -0.5, `ghost` at 331 needs dot < 0.5 - so a car stopped for the player
and pointing roughly the SAME way falls through both. #11's heading is -133
and I ran `--hash` not `--trace`, so I do not have the learner's heading:
the mechanism is established from the code, that THIS instance sits in the
unescapable band is inferred and unverified.

Not mine to fix, and handed to the peer: it is traffic.js behaviour, they
have e5a5ed6 in flight in that very path, and the brief is explicit that a
separate traffic mechanism is its own task. Widening line 331 is also the one
thing that must not be done - it is `A.ghost = 5`, a car ghosting through the
player, which the user's standing rule forbids outright.

Also eliminated, to save repeating it: `vcap` cannot do this. The curvature
term at line 755 has no floor, but `k = dh / max(1, ds)` is bounded by pi,
so with `A_LAT` 2.6 the least it can yield is sqrt(2.6/pi) = 0.91 m/s, which
prints as v0.9, not v0.0.

    london#8  clean 13.7 min -> DNF at 4.9, at a mini roundabout mouth
      #11 3.5m ahead 1.4 v0.0 held false block 0 stopT 120 ev lights@61
      want {plan 21.4, events 13, traffic 0}   and five cars queued behind it
    kent#5    collision 3.9 min -> DNF at 15.2, at a right turn
      #29 6.9m ahead -6.9 v0.0 held false block 0 stopT 77 ev undefined@-420

`#housekeep` documents this in its own comment: a car at the end of its route
parks in the lane, and the watchdog only despawns it once `d > UNSEEN`. In
sight of the player it sits there - 120 s in london#8 - and blocks the road.
`traffic 0` means the corridor is the clamp, and the clamp is RIGHT: a car
3.5 m ahead and 1.4 m off, broadside. Driving on is a collision, and driving
through is the ghosting this game must never show.

TWO. A ring of cars each blocking the next - the `(loop)` class the brief
rules out of scope.

    london#5  collision 9.5 min -> DNF at 16.7, 489 m from the end
      nine cars round a mini roundabout, stopT 108-121, chain ends "(loop)"
      want {plan 25.2, events 24.7, traffic 1.1}

london#8 is the only run where a CLEAN pass became a stall, so it is the one
real regression in thirty runs. london#5 and kent#5 were both collisions
before and now get 93% and 60% of the way round instead.

The honest conclusion is that this change does not create these stalls, it
EXPOSES them: the polyline test used to miss a car sitting a metre or two off
the route line, so the learner drove into it and scored a collision. Now it
stops. The remaining fix belongs in KentTraffic's watchdog - despawn a car
with `block 0`, no pending line and `stopT` past the limit even in sight,
or make it move - and not in lessons.js. That is a third open mechanism,
distinct from the brief's `right`-event box junction.

### One site carries autoPool Kent, and it is not mine

Every serious fault in autoPool Kent 1-10, on BOTH trees, sits at
(830.8-831.1, 4637.5-4637.7), s about 2122, with the kerb and pavement
faults 2-3 m further on at (833, 4640):

    s:Junctions: observation (emerged without slowing to look)@2122
    m:Control: steering (hit the kerb)@2120
    s:Control: steering (mounted the pavement)@2120

kent#1 and kent#8 drive DIFFERENT routes and hit the same place, so the "4
serious" is one junction counted several times rather than four faults. It
belongs on the fault-sites list as a single open site.

CORRECTING MY OWN WORDING HERE, TWICE. I first wrote "untouched by anything
on this branch", which contradicts the clean read two sections above: the
junction and its `emerged without slowing to look` fault are not mine, but
`bfcedac` does change what happens there.

Then I described that change as "dangerous became serious two metres on" -
also wrong, and wrong in the way the peer's clustering tool exists to stop.
(830.8-831.1, 4637.5-4637.7), (833.3,4640.1) and (833.5-833.8, 4642) are all
within 5.1 m: ONE site, not two. The peer's baseline on plain main shows six
fault kinds at it across seeds 1 and 8 - `Signals: necessary`, `emerged
without slowing to look`, `hit the kerb`, `collision`, `pulled out in front
of traffic`, `mounted the pavement`. I was describing one site's internals as
if they were separate sites. The honest statement: that junction fails many
ways, `bfcedac` removes the collision from the set, and the pavement mount is
still in it.

### Where the branch stands against main, and what that comparison is worth

                                 pass  serious  DANGEROUS  DNF  window
    main alone                   3/10     4         1       1     6
    5894699+main (minus the fix) 0/10     2         7       2     6
    bfcedac+main (whole branch)  2/10     4         0       1     7

The whole branch has ZERO dangerous faults on autoPool Kent against main's
one, and is worse than main on exactly one column - the window, by one run,
which is also what costs it the pass. Serious and DNF are level.

The 1 -> 7 IS NOT ATTRIBUTABLE, for the same reason as everything else in
this file: `b17301e`/`e82c806` ARE the network change, so any before/after of
the give-way rule crosses the boundary by construction. I cannot say by seed
that my earlier commits added six collisions. Only the 7 -> 0 is clean. The
rest is aggregate across different route sets: weak, labelled as such, and
not to be leaned on.

Ten seeds also cannot separate 2 from 3. A real landing decision wants 30+
seeds on one map on the clean pair, compared in aggregate with a site-for-site
diff, not pairwise 10-seed counts.

And Kent is the wrong map to judge this on. Across the peer's eight baselines
there are 13 distinct collision sites; Kent's only non-stall site is the one
junction above, so it dominates everything measured here. Leeds (three fault
sites, all collisions) is the test this fix deserves, and it is not on
origin/main yet - which carries birmingham, burgesshill, coventry, driveuk,
kent, london, manchester, and no tools/fault-sites.mjs.
