#!/usr/bin/env bash
# Launch wmptrs-sim. Uses the prebuilt binary for this machine from dist/,
# or builds from source when none matches and Go is installed.
# Any arguments are passed through, e.g.  ./run.sh --no-tui --seed 7
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in
  mingw* | msys* | cygwin*) os=windows ;;
esac
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
esac

bin="$here/dist/wmptrs-sim-$os-$arch"
[ "$os" = windows ] && bin="$bin.exe"

if [ -f "$bin" ]; then
  if [ "$os" = darwin ]; then
    # binaries downloaded as a zip are quarantined by Gatekeeper
    xattr -d com.apple.quarantine "$bin" 2>/dev/null || true
  fi
  chmod +x "$bin" 2>/dev/null || true
  exec "$bin" "$@"
elif command -v go >/dev/null 2>&1; then
  echo "No prebuilt binary for $os/$arch, building from source..." >&2
  cd "$here"
  exec go run ./cmd/wmptrs-sim "$@"
else
  echo "No prebuilt binary for $os/$arch and Go is not installed." >&2
  echo "Install Go 1.23+ from https://go.dev/dl, then re-run this script." >&2
  exit 1
fi
