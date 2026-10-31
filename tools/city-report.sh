#!/bin/zsh
# Bake one region and put it through everything that decides whether it is fit to be in the game:
#
#   zsh tools/city-report.sh <region> [seeds]      e.g. zsh tools/city-report.sh leeds 10
#
#   0. elevation-check   the height grid is complete (a quota failure would bake a flat city)
#   1. region-data.mjs   bake public/assets/<region>/region.json from the fetched OSM + elevation
#   2. lanes-check       lane counts and connectivity
#   3. testgen-check     can it plan a fair test, and how varied are the routes it plans
#   4. lesson-check      can the autopilot DRIVE those routes: the number that matters
#
# The bar is Kent under the SAME route generator a city uses, which is autoPool, not Kent's two
# hand-authored pools. Measure it with `--gen auto --region kent`, not `--gen both`: on the same map
# and harness those score 4 of 10 fault-free and 8 of 10 respectively, because the authored pools
# produce routes autoPool never would. A city has no authored pools, so only the first is comparable.
# Set `ready` in tools/regions.mjs only for a region that clears it, and set its measured `timeK`
# first (the drive output prints both the planned and the driven minutes).
set -u
cd "${0:a:h}/.." || exit 1
R=${1:?usage: city-report.sh <region> [seeds]}
N=${2:-10}

print -r -- "===== $R: elevation the bake will use"
node tools/elevation-check.mjs "$R" || exit 1
print -r -- "\n===== $R: bake"
node tools/region-data.mjs "$R" || exit 1
print -r -- "\n===== $R: lanes and connectivity"
node tools/lanes-check.mjs "public/assets/$R/region.json"
print -r -- "\n===== $R: routes it plans (fairness and variety)"
node tools/testgen-check.mjs "$R" --seeds "$N"
print -r -- "\n===== $R: routes it drives (bar: Kent under autoPool, not --gen both -- see the header)"
node tools/lesson-check.mjs --gen auto --region "$R" --gseeds "1-$N" --quiet
