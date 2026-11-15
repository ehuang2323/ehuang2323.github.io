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

## Private journal

A star lies glowing on the dock to the right of the farmer. It brightens as your cursor nears; drag it anywhere and it stays there (remembered across visits). Drop it into the farmer's hands: it climbs the rod and blooms, and a journal window slides in on the right. Close it (red dot) and the star arcs back to wherever it was resting. The window can be dragged by its title bar, resized from any edge or corner, maximized with green or a title-bar double-click, and minimized to a tab with yellow. Drag it against the right screen edge to dock it again.

**Where entries live:** one file (`journal.json`) in a separate **private** GitHub repo, *not* in this site's repo. The page talks to the GitHub API with a fine-grained token kept only in your browser. Neither the repo name nor the token appears in this site's source, so the star is only a hidden door and the token is the actual lock.

Setup, once per device:

1. Create a private repo (e.g. `notes`) with a README.
2. GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repository access: only that repo. Permissions: **Contents: Read and write**. Pick an expiry you're fine renewing.
3. Open the journal, enter `owner/notes` and the token, then unlock. It refuses to run against a public repo.

Writing: `+ diary` / `+ blog`, date picker, tags (type and press enter; manage/rename/delete under *manage tags*), bold ⌘B, italic ⌘I, underline ⌘U, highlight ⌘⇧H, link ⌘K (⌘-click opens a link), bullets, numbered lists, indent Tab / outdent ⇧Tab. **push** (⌘S) commits to the private repo. Until you push, edits are kept as a local draft in this browser, and a draft left on a device merges in the next time you unlock there. If two devices push, entries merge by last edit. *lock & forget token* wipes the token and draft from the device.

All entry HTML goes through an allowlist sanitizer on load and on paste.
