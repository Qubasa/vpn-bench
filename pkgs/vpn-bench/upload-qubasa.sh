#!/usr/bin/env bash

set -xeuo pipefail

SRC=$(vpb build-ui)

rsync -r --delete "$SRC"/. root@gchq.icu:/var/www/blog
