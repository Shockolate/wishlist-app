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
echo "extract-sourcemaps: ok"
