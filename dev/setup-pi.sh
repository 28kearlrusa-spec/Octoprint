#!/usr/bin/env bash
# One-time setup on the OctoPrint Raspberry Pi, so MakerPrint can be developed from anywhere:
#   - Tailscale (reach the printer page from any network, nothing opened to the internet)
#   - Claude Code, signed in, running Remote Control in tmux (use it from claude.ai/code or the
#     MakerPrint Claude button)
#   - the MakerPrint source in ~/makerprint, installed so OctoPrint runs it directly
#
# On the Pi:
#   curl -fsSL https://raw.githubusercontent.com/28kearlrusa-spec/Octoprint/main/dev/setup-pi.sh | bash
#
# It stops twice for a sign-in link (Tailscale, then Claude): open each on any phone or computer.
set -euo pipefail

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -m)" = "aarch64" ] || die "This Pi runs a 32-bit OS ($(uname -m)). Claude Code needs 64-bit Raspberry Pi OS / OctoPi."
[ "$(id -u)" != 0 ] || die "Run as your normal user (pi), not with sudo."

say "Packages"
sudo apt-get update -qq
sudo apt-get install -y -qq git tmux curl >/dev/null

say "Tailscale (open the link it prints and sign in)"
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --accept-dns=false
TS_IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"

say "Claude Code"
command -v claude >/dev/null || [ -x "$HOME/.local/bin/claude" ] || curl -fsSL https://claude.ai/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"

say "MakerPrint source in ~/makerprint"
if [ -d "$HOME/makerprint/.git" ]; then git -C "$HOME/makerprint" pull -q; else git clone -q https://github.com/28kearlrusa-spec/Octoprint.git "$HOME/makerprint"; fi
PIP="$HOME/oprint/bin/pip"
[ -x "$PIP" ] || PIP="$(dirname "$(readlink -f "$(command -v octoprint)")")/pip"
[ -x "$PIP" ] || die "Couldn't find OctoPrint's pip. Install by hand: <octoprint venv>/bin/pip install -e ~/makerprint"
"$PIP" install -q -e "$HOME/makerprint"
sudo systemctl restart octoprint || sudo service octoprint restart || true

say "Sign in to Claude: open the link it shows, sign in, paste the code back, then type /exit"
cd "$HOME/makerprint"
claude </dev/tty

say "Starting Claude Remote Control in the background (tmux session 'claude')"
tmux kill-session -t claude 2>/dev/null || true
tmux new-session -d -s claude -c "$HOME/makerprint" "$HOME/.local/bin/claude remote-control"
# start it again after a reboot
( crontab -l 2>/dev/null | grep -v 'makerprint-claude'; echo "@reboot sleep 30 && tmux new-session -d -s claude -c $HOME/makerprint '$HOME/.local/bin/claude remote-control' # makerprint-claude" ) | crontab -

cat <<EOF

All set. From anywhere:
  - Printer page:  http://${TS_IP:-<tailscale ip>}   (install Tailscale on your phone/laptop, same account)
  - Claude:        claude.ai/code (or the Claude app), pick this Pi's session,
                   or MakerPrint > Settings > Appearance > Claude button > Claude Code
  - On the Pi:     tmux attach -t claude   (leave again with Ctrl+B, then D)
EOF
