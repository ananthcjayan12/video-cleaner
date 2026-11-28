# Set up a render computer (Mac or Linux)

A **render computer** takes the heavy rendering work off the PractiReel hub.

- **The hub** is the Linux laptop running https://editor.srshti.co.in. It keeps the only copy of every reel, account and setting, and runs all AI steps (transcribing, cleaning, planning, pictures, covers).
- **A render computer** runs the same repo in *node mode*. It asks the hub for work every 3 seconds, copies only the files a step needs, and runs these steps:
  - cutting;
  - captions;
  - the final video;
  - stick-figure videos.

  Then it sends the results back.
- **How many:** you can add as many render computers as you like. Each one renders one reel at a time.
- **Where to watch them:** owner console → **Computers** (online/busy/encoder, turn on or off, remove, default "where new reels render"). The owner can also choose per reel in the phone app ("Render on").

Nothing on the render computer needs to be reachable from outside. It only makes outgoing HTTPS requests to the hub. Reels made on it look the same as on the hub, because it uses the same code, fonts and brand files (copied from the hub).

> **For a Claude agent doing this setup:** follow the steps in order and run the check at the end of each step. Never print or commit the node key (`PRACTIREEL_NODE_TOKEN`), and keep it out of logs, chat and the repo. Don't change anything on the hub except step 1. If a step fails, stop and report the exact error instead of working around it.

---

## 0. Before you start: the hub must run the multi-computer version

On the hub (the Linux laptop), the `main` branch must include the render-computer code (`server/nodes.ts`).

Check with `ls ~/video-cleaner/server/nodes.ts`. The owner console should also show a **Computers** page.

## 1. Get a key for this computer (on the hub)

In the owner console, open **Computers → Add a computer** and give it a name (for example `MacBook`). Copy the three lines it shows; the key appears only once.

Or, in a terminal on the hub:

```bash
cd ~/video-cleaner && node scripts/add-render-computer.mjs "MacBook"
```

You get three lines like these:

```
PRACTIREEL_HUB_URL=https://editor.srshti.co.in
PRACTIREEL_NODE_TOKEN=prn_…
PRACTIREEL_NODE_NAME=MacBook
```

Bring them to the new computer in a private way (for example AirDrop, or type them in). Don't send them in a chat or email.

## 2. Install the tools (Mac)

1. Install **Homebrew** if `brew --version` fails: see https://brew.sh. On Apple Silicon, open a new Terminal afterwards so `/opt/homebrew/bin` is on PATH.
2. Install the tools:

   ```bash
   brew install node@22 ffmpeg git python@3.12
   brew link --overwrite node@22
   ```

   You need Node 22 or newer. Python is only the standard library; the render scripts need no pip packages.
3. Install **Google Chrome** (normal app in `/Applications`) if it isn't there. Remotion uses it to draw the captions, motion graphics and stick figures.
4. **Check:**

   ```bash
   node --version    # v22 or newer
   ffmpeg -hide_banner -encoders | grep h264_videotoolbox    # Apple hardware encoder should be listed
   ffmpeg -hide_banner -filters | grep -E ' (zscale|xfade|zoompan|alimiter) '    # all four should be listed
   python3 --version
   ls "/Applications/Google Chrome.app"
   ```

   If `zscale` is missing, use the full FFmpeg build:

   ```bash
   brew uninstall ffmpeg && brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg
   ```

On **Linux** instead, install with apt: `ffmpeg`, `git`, `python3`, Node 22+ (NodeSource) and `google-chrome-stable`. For Intel Quick Sync, also install `intel-media-va-driver-non-free`.

## 3. Get the code

The repository is private, so sign in to GitHub first:

```bash
brew install gh
gh auth login
```

Then clone it, install packages and build:

```bash
cd ~
git clone https://github.com/ananthcjayan12/video-cleaner.git
cd video-cleaner
git checkout main
npm ci
npm run build
```

`npm ci` also fetches `@cjcut/editor` from GitHub, which uses the same `gh` login. If that fails, run `gh auth setup-git` and try again.

**Check:** `ls dist-server/index.js dist-server/nodes.js` lists both files.

Use the **same commit as the hub**. The Computers page warns "update it" when the versions differ. To check by hand, compare `git rev-parse --short HEAD` here and on the hub.

## 4. Save the key

```bash
cat > ~/.practireel-node.env <<'EOF'
PRACTIREEL_HUB_URL=https://editor.srshti.co.in
PRACTIREEL_NODE_TOKEN=prn_paste_the_key_here
PRACTIREEL_NODE_NAME=MacBook
EOF
chmod 600 ~/.practireel-node.env
```

Replace the second line with the real key from step 1.

## 5. Try it once in the foreground

```bash
cd ~/video-cleaner && ./scripts/run-render-node.sh
```

**Check:** the output should show:

```
[node] render computer for https://editor.srshti.co.in
Video Cleaner local server: http://127.0.0.1:3011 · 0 local projects restored
```

and no repeated `cannot reach the hub` lines. In the owner console → **Computers**, the computer should now show **Ready** with "Apple VideoToolbox".

Stop it with Ctrl+C.

## 6. Start it automatically (Mac: launchd)

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
cat > ~/Library/LaunchAgents/in.practireel.render-node.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>in.practireel.render-node</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HOME/video-cleaner/scripts/run-render-node.sh</string></array>
  <key>WorkingDirectory</key><string>$HOME/video-cleaner</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/practireel-render-node.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/practireel-render-node.log</string>
</dict>
</plist>
EOF
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/in.practireel.render-node.plist
```

**Check:**

```bash
launchctl print gui/$(id -u)/in.practireel.render-node | grep -E 'state|pid'
tail -f ~/Library/Logs/practireel-render-node.log
```

The service keeps the Mac awake while it runs (`caffeinate`), but only while you're logged in. If the lid is closed on battery, the Mac still sleeps. Keep it plugged in for long renders.

**Linux instead:** create a systemd user service whose `ExecStart` is `%h/video-cleaner/scripts/run-render-node.sh`, with `Restart=on-failure`, then run `systemctl --user enable --now <name>`.

## 7. Test with one reel

1. In the phone app (owner login), start a reel and set **Render on** to this computer. Or set "Where new reels render" on the Computers page.
2. After your review, the steps "Cutting, zoom and voice", "Rendering captions" and "Putting it together" show `<name>: …` while running and `· on <name>` when done.
3. Stick-figure reels also go to a free computer (the default on the Computers page).

The first reel copies its source video from the hub (about 1–2 minutes through Cloudflare for a 300 MB iPhone clip). Later steps of the same reel reuse the copy.

## Updating

Update the hub first, then each render computer:

```bash
cd ~/video-cleaner && git pull && npm ci && npm run build
launchctl kickstart -k gui/$(id -u)/in.practireel.render-node
```

## Good to know

- **Removing a computer:** Computers → Remove (its key stops working), then:

  ```bash
  launchctl bootout gui/$(id -u)/in.practireel.render-node
  rm ~/Library/LaunchAgents/in.practireel.render-node.plist ~/.practireel-node.env
  ```

- **Disk:**
  - Copies of reels are kept in `~/VideoCleaner/projects/` on the render computer and deleted after 3 days unused.
  - Finished videos are deleted right after they reach the hub.
  - `~/VideoCleaner/.practireel-sync.json` records what was copied.
- **If a render computer stops answering for 2 minutes** during a step:
  - with "Any free computer", the hub renders that step itself;
  - with a fixed choice, the step fails and the reel can be started again.
- **Forcing CPU encoding:** set `VIDEO_CLEANER_NO_HW_ENCODE=1` in `~/.practireel-node.env`.
- **What stays on the hub:** all AI steps, ChatGPT pictures and covers (they use the hub's logged-in Chrome and Claude/Codex). A render computer needs no AI logins or API keys.
