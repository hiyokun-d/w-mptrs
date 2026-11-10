#!/usr/bin/env bash
# Run the tests, then cross-compile wmptrs-sim into dist/.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v go >/dev/null 2>&1; then
  echo "Go 1.23+ is required to build: https://go.dev/dl" >&2
  exit 1
fi

echo "==> go test ./..."
go test ./...

mkdir -p dist
for target in darwin/arm64 darwin/amd64 linux/amd64 windows/amd64; do
  os=${target%/*}
  arch=${target#*/}
  ext=""
  [ "$os" = windows ] && ext=".exe"
  out="dist/wmptrs-sim-$os-$arch$ext"
  echo "==> $out"
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags "-s -w" -o "$out" ./cmd/wmptrs-sim
done
chmod +x dist/wmptrs-sim-*
(cd dist && shasum -a 256 wmptrs-sim-* > SHA256SUMS)
echo "==> done"
ls -lh dist
