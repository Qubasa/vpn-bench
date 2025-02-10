#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(realpath "$(dirname "${BASH_SOURCE[0]}")")"

nix run --extra-experimental-features 'nix-command flakes' "path:${SCRIPT_DIR}/../..#nixos-anywhere" -- "${args[@]}"
