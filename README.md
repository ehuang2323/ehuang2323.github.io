# personal site

A terminal-style personal website, with an ASCII farmer fishing by a lake in the background. The rain and comets are Poisson processes. It's static HTML/CSS/JS with no build step, so GitHub Pages serves it as is.

## Edit content (no code needed)

| What | File |
|---|---|
| Name, education, major, email, bio, links | `content/site.json` |
| Projects | `content/projects.json` |
| Papers | `content/papers.json` + PDFs in `assets/papers/` |
| Resume | replace `assets/resume.pdf` |

Projects and papers are JSON lists, so adding one means copying an entry and changing it. Removing one means deleting it; `[]` means the list is empty. Each entry needs a unique `slug`, which becomes its "filename" in the terminal (`cat projects/<slug>`). Papers show as `"Title of paper" [pdf]`. To add one, drop the PDF in `assets/papers/` and add an entry:

```json
{ "slug": "my-paper", "title": "Title of paper", "pdf": "assets/papers/my-paper.pdf" }
```

`abstract` is optional and only appears for `cat papers/<slug>`.

If the page shows "failed to load content: invalid JSON", look for a trailing comma or missing quote in the file it names.

## Preview locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` straight from disk won't work, because browsers block `fetch` of local files.

## Deploy on GitHub Pages

1. Create a repo named `<your-username>.github.io` (or any name; the site then lives at `/<repo>/`).
2. `git init && git add . && git commit -m "site" && git branch -M main`
3. `git remote add origin git@github.com:<you>/<you>.github.io.git && git push -u origin main`
4. On GitHub, go to **Settings → Pages → Build and deployment**, set Source to *Deploy from a branch*, and pick `main` / root.

To update the site later, edit a JSON file, commit and push. Pages redeploys in about a minute.

## Terminal commands

`help`, `ls [-l]`, `cd <dir>`, `cat <file>`, `open <file>`, `pwd`, `whoami`, `email`, `history`, `clear`, `theme green|amber|ice`, `hide` / `show` (or Esc)

The scene has its own commands:

- `rain [λ|auto|off]` sets drops per second. New drops per frame are drawn as Poisson(λ·dt).
- `comets [μ|off]` sets the comet rate. Comets form a Poisson process with gaps drawn from Exp(μ).
- `comet` summons one now.
- `wind <x>` blows the rain sideways.
- `stats` compares the observed counts with theory (var/mean ≈ 1 for Poisson, mean gap ≈ 1/μ).
- `pause` / `play` freeze and restart the scene.

Section links work as URL hashes, e.g. `/#projects`. The scene shows a still frame for visitors who have "reduce motion" turned on.

## Layout

```
index.html        page shell
style.css         theme tokens + terminal styles
js/scene.js       ASCII scene + Poisson simulation (window.Scene API)
js/terminal.js    fake shell over content/*.json
content/*.json    your content
assets/resume.pdf your resume
```

## Under construction

Sections listed in `content/site.json` under `"under_construction"` (now `projects`, `papers`, `resume`) show a construction sign instead of their files. The resume sign also shows the email address. Remove a name from the list to bring that section back; its JSON content is untouched.

## Blog + private journal

A star lies glowing on the dock to the right of the farmer. It brightens as your cursor nears; drag it anywhere and it stays there (remembered across visits). Drop it into the farmer's hands: it climbs the rod and blooms, and a window slides in on the right. Close it (red dot) and the star arcs back to wherever it was resting. The window can be dragged by its title bar, resized from any edge or corner, maximized with green or a title-bar double-click, and minimized to a tab with yellow. Drag it against the right screen edge to dock it again.

**Visitors** get the *blog*: they can read, search, sort and filter posts by tag, but can't write. Posts come from `content/blog.json` in this repo.

**You** press *✎ write* and enter your passkey to get the full *journal*:

- Every entry (diary and blog) lives in `journal.json` in a separate **private** repo.
- When you push, entries marked **blog · public** are also written to `content/blog.json` in this site's repo, so readers see them about a minute later, once Pages redeploys. **diary · private** entries never leave the private repo.
- The GitHub token is stored on your device **encrypted with your passkey** (PBKDF2 + AES-GCM, via the browser's Web Crypto), as is any unpushed draft. The passkey itself is never stored. Nothing secret is in this site's source.

Setup, once per device:

1. Create a private repo (e.g. `notes`) with a README.
2. GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repository access: **only** the private repo **and** this site's repo. Permissions: **Contents: Read and write**.
3. Drag the star to the farmer, press *✎ write*, fill in both repos, paste the token, and choose a passkey (8+ characters). From then on that device only asks for the passkey.

*lock* returns to read-only and keeps the saved credentials. *forget this device* wipes them. A forgotten passkey can't be recovered: choose *forget this device*, then set up again with the token.

**Because the site publishes posts by committing to this repo, run `git pull` before pushing your own changes to the site.**

Editing: bold ⌘B, italic ⌘I, underline ⌘U, highlight ⌘⇧H, link ⌘K (⌘-click opens a link), bullets, numbered lists, indent Tab / outdent ⇧Tab, tags (type and press enter; *manage tags* renames or deletes them). **push** or ⌘S commits. If two devices push, entries merge by last edit. All entry HTML goes through an allowlist sanitizer on load, paste and publish.
