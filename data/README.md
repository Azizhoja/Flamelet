# Data

`psi/` holds the only NASA files the site is built from, copied unchanged from NASA's Physical Sciences Informatics (PSI) repository (<https://psi.nasa.gov>, combustion science), downloaded 2026-11-13. PSI data is CC0-1.0.

`node site_build/build_data.mjs` reads them and writes `site/data/codex-data.js`, the single data file the page loads. Every test in it keeps the file name and line it came from (line 1 is the header), so any number on screen can be traced back to a cell here.

| File | Investigation | Used for |
|---|---|---|
| `PSI-69_Experimental table_FLEX.csv` | FLEX | droplet tests, burning rates, flame-out diameters |
| `PSI-39_Experimental table_CFI.csv` | CFI | droplet tests, conditions only |
| `PSI-159_Experimental table_CFI-G_Normal Flames.csv` | CFI-G | gas flames |
| `PSI-159_Experimental table_CFI-G_Inverse Flames.csv` | CFI-G | burner-oxygen (inverse) flames |
| `PSI-10_Experimental table_Flame Design_Normal Flame.csv` | Flame Design | gas flames |
| `PSI-10_Experimental table_Flame Design_Inverse Flame.csv` | Flame Design | burner-oxygen (inverse) flames |
| `PSI-25_Experimental table_BASS-II.csv` | BASS-II | solids |
| `PSI-99_Experimental table_SAFFIRE-2.csv` | Saffire-II | solids |
| `investigations_index.csv` | all PSI | names, platforms, DOIs, publication counts |
| `investigations_objectives.json` | the 24 combustion investigations | the `objective` field of each investigation's PSI record, extracted unchanged from `investigations/PSI-N.json` (the full records are 21 MB, mostly file listings the site does not use) |

## SHA-256

```
3ac0c4b7e3ca1d65c75f2ad76162fbc83e39cc2630356642857b4543e50f2fd7  psi/investigations_index.csv
615ab413dc7dea5abda279151ba848c25c0be2d30d9b291949724dfb7e338238  psi/investigations_objectives.json
97933ee9ae0b9ebc6b948a67485a0fe2f8218f753253a4f2be93c40d374c44e4  psi/PSI-10_Experimental table_Flame Design_Inverse Flame.csv
4a663292bd3f65201943cc71bd661a70383639276a9176f64105b285bf0b6deb  psi/PSI-10_Experimental table_Flame Design_Normal Flame.csv
d4d44f8b9896936728748e34d1b6ad0812032a92fa5289599b708c138e3a9b39  psi/PSI-159_Experimental table_CFI-G_Inverse Flames.csv
d95a621c3fbd27d204dd32ed29fa17d68f2b779d6a523cde8479ed7ebaa5251a  psi/PSI-159_Experimental table_CFI-G_Normal Flames.csv
71e792bf6b5fb5ea620c5dd70fbbac05515992e12aefcf5dff47312caa48c042  psi/PSI-25_Experimental table_BASS-II.csv
fb898e28762353aa132c16b886dbd207a024b1dd3c9bed5928d70d8036d2ec7e  psi/PSI-39_Experimental table_CFI.csv
37c88ce8ae9391b7544ff630a45ce87543d04d317cdbfbed104fe7d5c27e1b96  psi/PSI-69_Experimental table_FLEX.csv
3c24390b9ef86f3d1ebaab911a1a3cc95a8759aebf42062371370e6d4b31b8ac  psi/PSI-99_Experimental table_SAFFIRE-2.csv
```
