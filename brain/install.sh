#!/bin/sh
# Points nami's config directory at this folder, so the brain in the repo is
# the one nami actually loads (tools and agents are read from ~/.config/rsmrtk).
# Safe to re-run; the previous real tool/ directory is kept as tool.pre-brain.
set -e
here=$(cd "$(dirname "$0")" && pwd)
cfg="$HOME/.config/rsmrtk"
if [ -d "$cfg/tool" ] && [ ! -L "$cfg/tool" ]; then mv "$cfg/tool" "$cfg/tool.pre-brain"; fi
ln -sfn "$here/tool" "$cfg/tool"
ln -sfn "$here/agent" "$cfg/agent"
echo "linked $cfg/tool and $cfg/agent -> $here"
