#!/usr/bin/env bash
# Double-click in Finder to open wmptrs-sim in Terminal.
cd "$(dirname "$0")"
# ask Terminal/iTerm for a roomier window (ignored where unsupported)
printf '\e[8;34;120t'
./run.sh "$@"
status=$?
echo
read -n 1 -s -r -p "Press any key to close this window..."
exit $status
