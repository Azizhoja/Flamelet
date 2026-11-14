# Codex of Fire

What does NASA know about fire in the air people will breathe? Pick a cabin (ISS, EVA prep, Moon base, spacesuit, Apollo 1) and every flame in NASA's PSI repository relights for it: the investigations are ranked, each test opens at true scale, and the air nobody has tested is explored with a flame model that is labelled as one.

## Repository layout

| Path | What |
|---|---|
| `site/` | The website, deployable as is (static files plus one optional serverless function in `site/api/`) |
| `site_build/` | Node scripts with no npm packages: data build, checks, local server, screenshots |
| `data/psi/` | The NASA PSI tables the site is built from, unchanged (see `data/README.md`) |

## Run it

| How | Command | What works |
|---|---|---|
| Open the file | `site/index.html` in a browser | Everything except Ogonek's follow-up answers |
| Local server | `node site_build/serve.mjs` then <http://127.0.0.1:8080/> | Same, plus follow-ups once a key is set (below) |
| Follow-up answers | copy `.env.example` to `.env` (gitignored) and set `GEMINI_API_KEY`, then `node site_build/serve.mjs` | Ogonek answers questions from the facts on screen |
| Deploy | Point Vercel (or any static host) at `site/`. Vercel runs `api/ogonek.mjs` as a function; set `GEMINI_API_KEY` there, plus `KV_REST_API_URL` and `KV_REST_API_TOKEN` (Vercel KV / Upstash Redis) so the follow-up limits hold across instances | All of it |

Follow-up limits: 12 questions a minute per visitor and `OGONEK_DAILY_LIMIT` (default 1000) a day for the whole site. Without the KV variables each serverless instance counts on its own and a cold start resets it, so they are only a per-instance brake. Set a spending quota on the API key in Google Cloud before sharing the link.

No build step. The page is plain HTML, CSS and JavaScript; no npm packages. The optional follow-up endpoint uses plain `fetch`.

## Links to each prototype frame

| Frame | URL hash |
|---|---|
| 01 Cabin · Moon base | `#cabin=moon` |
| 02 Cabin · Spacesuit | `#cabin=suit` |
| 03 Investigation · FLEX | `#cabin=moon&inv=PSI-69` |
| 04 Test · 196F001 | `#cabin=moon&inv=PSI-69&test=196F001` |
| 05 What-if · CO₂ 20 % | `#cabin=moon&inv=PSI-69&test=196F001&dil=CO2&frac=20` |
| 06 Test · C08H201 | `#cabin=moon&inv=PSI-69&test=C08H201` |
| 07 Ogonek explains | 06, then click or right-click "Fuel left at flame-out" |

Keys: Ctrl K / ⌘K search, Esc steps back, Shift F10 explains the focused element.

## Where every number comes from

| On screen | Source |
|---|---|
| Tests, conditions, outcomes | The experimental tables of FLEX (PSI-69), CFI (PSI-39), CFI-G (PSI-159), Flame Design (PSI-10), BASS-II (PSI-25) and Saffire-II (PSI-99), copied unchanged into `data/psi/` and read by `site_build/build_data.mjs`. Every test keeps its file and line |
| Investigation records | `investigations_index.csv` and `investigations/PSI-N.json` |
| `ƒ` computed | Pressure in psi; fuel left at flame-out = (D_ext ÷ D₀)³; cabin membership and gaps (`site/js/select.js`); a FLEX end time NASA did not log, by the d² law from its burning rate and diameters (`site/js/burn.js`) |
| Not counted | Burner-oxygen flames, and the 59 CFI-G runs logged as never lighting ("Hot ignition" No, burn time 0 or blank, no cool flame noted). They stay in the tables, in groups of their own |
| `≈ model` | Flame size and colour: Fire-X lite (`site/model/`). What-if burning rate: least-squares fit to 257 FLEX tests, r² 0.727, refitted on every data build |
| `∅` | No test in PSI, or a value NASA did not record |
| Ogonek | Explanations are written by code from the rows. Follow-up answers use the same facts and may require independent verification |

## Checks

```
node site_build/build_data.mjs   # rebuild site/data/codex-data.js from data/psi/
node site_build/verify.mjs       # 51 checks: the spec's numbers, reproduced by the page's own code
node site_build/interact.mjs     # 31 steps through the seven frames and the fixed bugs, in headless Edge
node site_build/shots.mjs        # screenshots of the seven frames → site_build/shots/
```

## Licences

NASA PSI data: CC0-1.0. Fonts (Geist, Geist Mono, Instrument Serif, Instrument Sans, Inria Sans): SIL Open Font License. Flame model after Wrede et al., "Fire-X", ACM TOG 44(6), 2025 (CC BY 4.0).
