# Sourced by the scripts next to it. `quiet <name> <mode> <command...>` runs a command with all its output in
# .logs/<name>.log and prints one line: OK, or FAILED with the lines that say why (scripts/lib/summarize.mjs picks
# them by <mode>) and the path of the log. It returns the command's result, 0 or 1.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

quiet() {
  local name=$1 mode=$2
  shift 2
  local log="$LOGS/$name.log" start=$SECONDS
  if (cd "$ROOT" && "$@") >"$log" 2>&1; then
    echo "✓ $name: OK ($((SECONDS - start))s)"
    return 0
  fi
  echo "✗ $name: FAILED ($((SECONDS - start))s)"
  node "$ROOT/scripts/lib/summarize.mjs" "$mode" "$log"
  echo "  log: .logs/$name.log"
  return 1
}
