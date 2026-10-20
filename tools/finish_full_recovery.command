#!/bin/bash
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
if [ "$#" -ne 3 ]; then
  printf 'Usage: finish_full_recovery.command KEY_FILE ENCRYPTED_KIT NEW_OUTPUT_FILE\n'
  exit 2
fi

PYTHON="${RECOVERY_PYTHON:-python3}"
if ! "$PYTHON" -c 'import cryptography, pgpy' >/dev/null 2>&1; then
  printf 'Preparing the private recovery reader...\n'
  "$PYTHON" -m venv "$ROOT/.recovery-reader"
  PYTHON="$ROOT/.recovery-reader/bin/python3"
  "$PYTHON" -m pip install -r "$HERE/recovery-requirements.txt"
fi

printf '\nFinish the encrypted portfolio recovery kit\n\n'
printf 'This checks credentials and reads configuration only. It sends no messages.\n'
printf 'Paste credentials only into this private window, never into the chat.\n\n'
"$PYTHON" "$HERE/portfolio_full_recovery.py" complete --key-file "$1" --kit "$2" --output "$3"
printf '\nKeep the unlock key separately in your password manager.\n'
printf 'Press Return to close.\n'
read -r _
