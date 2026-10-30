#!/usr/bin/env bash
# Ask Codex and Gemini the same question independently; save both answers.
# Usage: scripts/council.sh <slug> "<question>"
set -u
slug=$1; q=$2
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/research/council/$(date +%H%M)-$slug.md"
brief="You are on a review council for Kacheri Court (read docs/COURT.md, docs/DECISIONS.md and research/round2/context.md for context). Read files only; do not edit anything or run state-changing commands. Answer independently and concisely (max 200 words): RECOMMENDATION first, then reasons, then risks. Question: $q"
( cd "$root" && codex exec --sandbox read-only "$brief" </dev/null 2>/dev/null | awk '/^codex$/{b=""} {b=b"\n"$0} END{print b}' | sed '/^tokens used/,$d' > "$out.codex" ) &
# Gemini cannot run commands headlessly, so it gets the context inline instead of reading files.
ctx=$(cat "$root/docs/COURT.md"; echo; tail -n 12 "$root/docs/DECISIONS.md"; echo; cat "$root/research/round2/context.md")
( cd "$root" && ~/.local/bin/agy -p "Do not run shell commands, do not read or write files; everything you need is below. $brief

CONTEXT:
$ctx" --print-timeout 600s </dev/null > "$out.gemini" 2>&1 ) &
wait
{ echo "# Council: $slug"; echo; echo "Q: $q"; echo; echo "## Codex"; cat "$out.codex"; echo; echo "## Gemini"; cat "$out.gemini"; } > "$out"
rm -f "$out.codex" "$out.gemini"
echo "$out"
