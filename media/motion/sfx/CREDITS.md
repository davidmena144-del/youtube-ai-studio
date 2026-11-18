# Sound effects in this folder

Inlined into explainer pages by `build.mjs` (pages with `/*@SFX@*/` and `DATA.realSfx: true`), played on exact event times by `sampleSfx()` in `explainer.template.html`. All files are mono 48 kHz Ogg Vorbis.

| File(s) | Source | Licence |
|---|---|---|
| `ui_*.ogg` (typing, send, copy, success, select, check, error, badge, snap) | uisfx 0.4.0, theme "studio", bundled with Clipwing real-sfx (commit edbefcb) | CC0 1.0 (audio), MIT (code). No credit needed |
| `es_swish.ogg` (swipe/flick), `es_whoosh.ogg` (pro_whoosh_big/swell), `es_hit.ogg` (cut_hit/punch), `es_impact.ogg` (impact/classic, trimmed 1.6 s with fade), `es_tok.ogg` (fit/hit/bamboo_tok) | Rendered with earshot 0.4.1 (Leon Lin, commit 4ac3d2a), `earshot sfx render ID` | MIT |

Note: these are designed (code-made) sounds, not field recordings. Freesound CC0 recordings were found through Openverse but Freesound refuses downloads from the cloud workspace (HTTP 403), so recorded sounds can be added later from a local session.
