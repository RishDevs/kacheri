#!/usr/bin/env bash
# Live Nemotron run with the spending cap. Reads the key from ~/.kacheri.env (never printed).
# Usage: scripts/live.sh case <bench-item-id> [out.json]   |   scripts/live.sh bench [bench args...]
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$HOME/.kacheri.env" ] && source "$HOME/.kacheri.env"
: "${NEBIUS_API_KEY:?NEBIUS_API_KEY not set; create ~/.kacheri.env}"
export KACHERI_LLM=${KACHERI_LLM:-record} KACHERI_FIXTURES=${KACHERI_FIXTURES:-$root/fixtures/llm} KACHERI_BUDGET_USD=${KACHERI_BUDGET_USD:-20}
cmd=$1; shift
case "$cmd" in
  case)
    id=$1; out=${2:-$root/packages/web/public/demo/cases/$id.json}
    repo=$root/packages/bench/fixtures/repos/$id
    [ -d "$repo/.git" ] || (cd "$root" && npx tsx -e "import('./packages/bench/src/mutate.ts').then(m=>{const d=require('./packages/bench/fixtures/survivors.json').find(x=>x.id==='$id');m.createItemRepo(d,'$repo')})")
    item=$(cd "$root" && node -e "const d=require('./packages/bench/fixtures/survivors.json').find(x=>x.id==='$id');console.log([d.baseRef,d.headRef,d.description].join('\t'))")
    IFS=$'\t' read -r base head title <<<"$item"
    cd "$root" && npx tsx packages/court/src/cli.ts --repo "$repo" --base "$base" --head "$head" --title "$title" --test-cmd "node --test" --out "$out"
    ;;
  bench) cd "$root" && npm -w @kacheri/bench run bench -- "$@" ;;
  spent) node -e "console.log(require(require('os').homedir()+'/.kacheri/spend.json'))" ;;
esac
