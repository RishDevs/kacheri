#!/usr/bin/env bash
# One full verification cycle (free: no paid API calls). Usage: scripts/cycle.sh <n>
set -u
n=${1:-1}; root=$(cd "$(dirname "$0")/.." && pwd); cd "$root"
log=research/cycles/cycle-$n.log; mkdir -p research/cycles; : > "$log"
step() { local name=$1; shift; local t0=$(date +%s); if "$@" >>"$log" 2>&1; then echo "PASS $name ($(( $(date +%s)-t0 ))s)"; else echo "FAIL $name (see $log)"; fail=1; fi; }
fail=0
step typecheck npx tsc -p tsconfig.json --noEmit
step unit-tests npx vitest run
step web-build env VITE_DEMO=1 npm -w @kacheri/web run build
step demo-data node -e "const fs=require('fs');const d='packages/web/public/demo/cases';for(const f of fs.readdirSync(d)){const r=JSON.parse(fs.readFileSync(d+'/'+f));if(!r.charges||!r.rulings||!r.status)throw new Error(f+' is not a CaseRecord')}"
# Replay a recorded live case through the real engine (KACHERI_LLM=replay: recorded Nemotron replies, no API calls).
if [ -d fixtures/llm ] && [ -d packages/bench/fixtures/repos/ef06f10e06ad ]; then
  # Exit 1 means "conviction", which is a valid verdict; only 2 (case error) fails the step.
  step replay-case bash -c 'KACHERI_LLM=replay KACHERI_FIXTURES=fixtures/llm npx tsx packages/court/src/cli.ts --repo packages/bench/fixtures/repos/ef06f10e06ad --base d74a32e --head ec3ab37 --title "Refactor URL normalization edge handling" --test-cmd "node --test" --out /tmp/kacheri-replay.json; [ $? -le 1 ]' 
fi
step daemon-api bash -c 'KACHERI_LLM=replay npx tsx packages/daemon/src/main.ts >/tmp/kd.log 2>&1 & p=$!; for i in $(seq 20); do curl -sf 127.0.0.1:4317/api/tasks >/dev/null && break; sleep 0.5; done; curl -sf 127.0.0.1:4317/api/cases >/dev/null; r=$?; kill $p; rm -f kacheri.sqlite; exit $r'
step repo-clean bash -c 'test -z "$(git status --porcelain -- packages docs scripts)"'
echo "cycle $n: $([ $fail = 0 ] && echo ALL PASS || echo FAILURES)"
