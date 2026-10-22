#!/bin/bash
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$#" -ne 2 ]; then
  printf 'Usage: test_recovery_key.command ENCRYPTED_KIT NON_SECRET_REPORT\n'
  exit 2
fi
PYTHON="${RECOVERY_PYTHON:-python3}"
printf '\nTest the recovery unlock key saved in 1Password\n\n'
status=0
"$PYTHON" "$HERE/verify_recovery_key.py" --kit "$1" --report "$2" || status=$?
printf '\nPress Return to close.\n'
read -r _ || true
exit "$status"
