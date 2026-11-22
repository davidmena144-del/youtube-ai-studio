# Video identity: glass and glow (chosen by the owner, 22 Nov)

The owner rejected the light "sticker" look and the hybrid dark look (`identity-v2.md`) and chose the look of the
`glass-glow-film` skill as it is, in a vertical 9:16 layout. This replaces the earlier explainer look for new videos.

## The film (33.7 s, 1080x1920, 30 fps)

Eight beats, fixed order: choices (five icons roll into a glass bar) -> pick (cursor stops on the hero) -> name
(icon + one or two words, eclipse rim) -> ask (prompt pill over blue fog) -> typing (one short request) -> reveal
(photo grows out of the send button to full frame) -> fact (one line in a glass pill over the photo) -> end card
(icon, name, then the handle `@takka.a` in a small glass pill).

## Look

- Canvas `#000`. Light only from soft indigo glows (white-lavender core -> periwinkle -> deep indigo). Accent `#2f55e6`.
- Glass: black shapes with a 1.5 px white rim and a lavender halo. No fills, no cards, no second hue in the interface.
- Icons: single-colour glyphs (`fluent-emoji-high-contrast`). The hero is white, the others carry holographic gradients.
- Type: Kufam for Arabic, Inter for Latin. Name 84 px/600, pill text 30 px, fact line 46 px, icons 100 px (hero 140 px).
- Motion: one thing moves at a time, slow camera drift, no bounces or flashes. Sound: ticks, clicks, whooshes, shimmer.
  No music, no narration, no mascot, no logo inside the film.
- The only colour photograph is the reveal.

## Copy rules (Egyptian Arabic)

- Four texts only: name (1-2 words), placeholder, prompt (<= 30 characters, starts with a request word), fact
  (<= 40 characters, a number or a surprise). One film = one hero and one fact; several facts = a series.
- The full fact, three hashtags and the follow line go in the post caption, not in the film.

## Photo

- Real or photoreal, 1080x1920, subject centred, calm area in the lower third for the fact pill (pill centre y = 1650).
- Sources in order: a photo from the owner, public-domain images (NASA), one generated image. No real people,
  no images without a licence that allows publishing.

## Engine

- The skill's `engine.html` + `make.py`, with a vertical re-layout (`engine_v.html`, `make_v.py`): world coordinates
  shifted to a 1080x1920 stage, bar width 960, taller wipe sheet, stretched fog, fact pill lower, handle pill on the
  end card. Checked with stills at every beat.
- The vertical engine and the rendered films are not in the repo yet (the session could not push binaries).

## First series: space tech (same five icons in every film, a different hero each time)

Bar: rocket, robot, satellite, satellite antenna, telescope.

| Film | Prompt | Fact | Photo (NASA, public domain) |
|---|---|---|---|
| satellite | وريني قمر صناعي حقيقي | هابل… بيلف حوالين الأرض من ١٩٩٠ | Hubble, STS-125 (HST-SM4.jpeg) |
| rocket | وريني صاروخ رايح القمر | ساتورن ٥… أطول من عمارة ٣٦ دور | Apollo 11 launch (GPN-2000-000630) |
| robot | وريني روبوت على المريخ | كيوريوسيتي… على المريخ من ٢٠١٢ | Curiosity self-portrait (PIA16239) |
| dish | وريني دِش بيكلّم الفضاء | دِش جولدستون… بيكلّم مركبات الفضاء | Goldstone DSN antenna |
