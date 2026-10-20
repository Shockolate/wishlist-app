#!/usr/bin/env bash
# Verifies extract-sourcemaps.sh injects, moves every map out of the deploy output with its chunk
# copied beside it, and always leaves an artifact to upload.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
cat > "$tmp/bin/sentry-cli" <<'INNER'
#!/usr/bin/env bash
echo "sentry-cli $*" >> "$STUB_LOG"
INNER
chmod +x "$tmp/bin/sentry-cli"
export STUB_LOG="$tmp/log"
fail() { echo "extract-sourcemaps.test: $*" >&2; exit 1; }

static="$tmp/static" dest="$tmp/maps"
mkdir -p "$static/_next/static/chunks" "$static/_next/static/css"
echo 'a()' > "$static/_next/static/chunks/a.js"
echo '{}' > "$static/_next/static/chunks/a.js.map"
echo 'b()' > "$static/_next/static/chunks/b.js"
echo 'x{}' > "$static/_next/static/css/s.css"
echo '{}' > "$static/_next/static/css/s.css.map"

: > "$STUB_LOG"
PATH="$tmp/bin:$PATH" "$here/extract-sourcemaps.sh" "$static" "$dest" >/dev/null || fail "a normal output should extract"
grep -qx "sentry-cli sourcemaps inject $static" "$STUB_LOG" || fail "inject debug IDs into the output first"
[[ -f "$dest/_next/static/chunks/a.js.map" && -f "$dest/_next/static/chunks/a.js" ]] || fail "move the map, copy its chunk"
[[ -f "$dest/_next/static/css/s.css.map" ]] || fail "move CSS maps too"
[[ -f "$static/_next/static/chunks/a.js" ]] || fail "leave the chunk in the deploy output"
[[ ! -e "$dest/_next/static/chunks/b.js" ]] || fail "copy only chunks that have a map"
! find "$static" -name '*.map' | grep -q . || fail "no map may remain in the deploy output"
[[ -f "$dest/README.txt" ]] || fail "always write README.txt"

rm -rf "$static" "$dest" && mkdir -p "$static/_next" && echo 'c()' > "$static/_next/c.js"
: > "$STUB_LOG"
PATH="$tmp/bin:$PATH" "$here/extract-sourcemaps.sh" "$static" "$dest" >/dev/null || fail "an output without maps is fine"
[[ ! -s "$STUB_LOG" ]] || fail "without maps there is nothing to inject"
[[ -f "$dest/README.txt" ]] || fail "write README.txt even without maps, so the artifact exists"
# A trailing slash on <static-dir> must not change where a map lands.
slash="$tmp/slash" slashdest="$tmp/d1"
mkdir -p "$slash/_next/static/chunks"
echo 'd()' > "$slash/_next/static/chunks/d.js"
echo '{}' > "$slash/_next/static/chunks/d.js.map"
: > "$STUB_LOG"
PATH="$tmp/bin:$PATH" "$here/extract-sourcemaps.sh" "$slash/" "$slashdest" >/dev/null || fail "a trailing slash should extract"
[[ -f "$slashdest/_next/static/chunks/d.js.map" ]] || fail "with a trailing slash, the map must land at <dest>/_next/..., not under its absolute path"
[[ ! -e "$slashdest$slash" ]] || fail "with a trailing slash, no map may land under an absolute path"
# Sentry tooling must never block a release: when inject fails, or sentry-cli is missing, the maps
# are dropped from the deploy output with a warning, and the script still succeeds.
check_degraded() {
  local label="$1" path="$2" d="$tmp/deg-$1" out="$tmp/deg-$1.out"
  local st="$tmp/deg-static-$1"
  mkdir -p "$st/_next/static/chunks"
  echo 'e()' > "$st/_next/static/chunks/e.js"
  echo '{}' > "$st/_next/static/chunks/e.js.map"
  PATH="$path" "$here/extract-sourcemaps.sh" "$st" "$d" >"$out" 2>&1 || fail "$label: must exit 0 (output: $(cat "$out"))"
  grep -q '^::warning::' "$out" || fail "$label: print a ::warning:: saying why"
  ! find "$st" -name '*.map' | grep -q . || fail "$label: no map may remain in the deploy output"
  [[ "$(cat "$st/_next/static/chunks/e.js")" == 'e()' ]] || fail "$label: leave the chunk untouched"
  [[ -f "$d/README.txt" ]] || fail "$label: still write README.txt"
  grep -qi 'skipped' "$d/README.txt" || fail "$label: README.txt should note the skip"
  ! find "$d" -name '*.map' | grep -q . || fail "$label: no map may reach the artifact"
}
mkdir -p "$tmp/failbin" "$tmp/emptybin"
printf '#!/usr/bin/env bash\nexit 1\n' > "$tmp/failbin/sentry-cli"
chmod +x "$tmp/failbin/sentry-cli"
# The script's own tools must come from /usr/bin:/bin, so a PATH without sentry-cli is honest.
for tool in find grep mkdir cp mv dirname cat rm; do
  PATH=/usr/bin:/bin command -v "$tool" >/dev/null || fail "test setup: $tool not in /usr/bin:/bin"
done
! PATH="$tmp/emptybin:/usr/bin:/bin" command -v sentry-cli >/dev/null || fail "test setup: sentry-cli is on the bare PATH"
check_degraded inject-fails "$tmp/failbin:/usr/bin:/bin"
check_degraded no-sentry-cli "$tmp/emptybin:/usr/bin:/bin"
echo "extract-sourcemaps: ok"
