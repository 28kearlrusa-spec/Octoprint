# Working on MakerPrint with Claude Code on the Raspberry Pi (over SSH)

Run Claude Code on the Pi itself, in a copy of this repository that OctoPrint uses directly. Then a change shows up in the printer's web page after a reload (JavaScript and CSS) or an OctoPrint restart (Python), with no zip uploads or reinstalling.

## 1. Check the Pi can run it

Claude Code needs a **64-bit** Raspberry Pi OS (Pi 3, 4 or 5). Over SSH:

```bash
uname -m
```

`aarch64` is good. `armv7l` means a 32-bit OS: reinstall OctoPi/Raspberry Pi OS 64-bit first (back up OctoPrint from Settings > Backup & Restore).

## 2. Connect

From your Mac's Terminal (use the address you open OctoPrint with):

```bash
ssh pi@octopi.local
```

## 3. Install Claude Code and sign in

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Open a new SSH session (so `~/.local/bin` is on the PATH), then run `claude`. It prints a link: open it on your Mac or phone, sign in with your Claude account and paste the code back.

## 4. Get the MakerPrint source and make OctoPrint use it live

```bash
git clone https://github.com/28kearlrusa-spec/Octoprint.git ~/makerprint
~/oprint/bin/pip install -e ~/makerprint
sudo service octoprint restart
```

(`~/oprint` is OctoPi's OctoPrint. On another install, use the `pip` next to your `octoprint` command: `ls -l $(which octoprint)`.)

`-e` ("editable") means OctoPrint runs the files in `~/makerprint` directly. Updates now come from your edits rather than from Software Update.

## 5. Let the Pi push to GitHub (once)

```bash
git config --global user.name "MakerForge3DP"
git config --global user.email "28kearlrusa-spec@users.noreply.github.com"
```

Pushing needs a GitHub token. Create one at github.com > Settings > Developer settings > Personal access tokens > Fine-grained, for the **Octoprint** repository, with *Contents: Read and write*. The first `git push` asks for a username (your GitHub name) and a password (paste the token). To remember it:

```bash
git config --global credential.helper store
```

## 6. Work

```bash
cd ~/makerprint
claude
```

Ask for what you want, for example "make the Print page camera bigger". Then:

- **JavaScript or CSS changed:** reload the printer's page in the browser.
- **Python changed** (`octoprint_makerforge/*.py`): `sudo service octoprint restart`, or *Restart OctoPrint* from MakerPrint's system menu.
- **Klipper config changed** (`klipper/*.cfg`): copy it into place and restart Klipper: `bash klipper/install.sh` does both, keeping your calibration.

Ask Claude to run the tests before you keep a change: `python3 -m unittest discover -s tests` and `node tests/klipper.test.mjs`. Then "commit and push".

## 7. Use it from the MakerPrint page (Remote Control)

Claude Code's Remote Control lets you drive the Pi's session from claude.ai, from any network. Nothing is opened on your router: the Pi connects out to Anthropic. It needs a Pro, Max, Team or Enterprise plan, signed in with `/login` (not an API key).

Start it on the Pi inside `tmux`, so it keeps running after you close SSH:

```bash
sudo apt install -y tmux
cd ~/makerprint
tmux new -s claude 'claude remote-control --name "MakerPrint Pi"'
```

Leave it with `Ctrl+B` then `D`. It keeps running; `tmux attach -t claude` brings it back.

Then in MakerPrint: **Settings → Appearance → Claude button → Claude Code**. A Claude button appears at the bottom of the menu. It opens claude.ai/code docked beside the printer page: pick the **MakerPrint Pi** session and type what you want changed. Reload the printer page to see JavaScript and CSS changes, and restart OctoPrint for Python changes.

If the Pi reboots, SSH in and run the `tmux new ...` line again (or `claude remote-control --continue` within a few hours to pick up the same session).

## Tips

- `claude --continue` picks up where you left off.
- If the SSH connection drops, the session stops. Start it inside `tmux` to survive that: `sudo apt install tmux`, then `tmux new -s dev` (reattach with `tmux attach -t dev`).
- Klipper and OctoPrint keep printing while you work, but don't restart OctoPrint mid-print.
