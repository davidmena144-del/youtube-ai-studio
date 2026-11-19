// title: 3 Things You Should Never Trust AI With
/* global window */
window.DATA = {
  theme: {"bg": "#0C1424", "bg2": "#050912", "glow": "255,214,10", "accent": "#FFD60A", "onAccent": "#111111", "card": "#141F36", "card2": "#1D2B49", "line": "#2F4270", "scene": "#0F182B", "text": "#F2F5FF", "muted": "#9FB0D0", "warn": "#3A3210", "endBg": "#FFF6CC", "endCard": "#FFFDF2", "endInk": "#0C1424", "endAccent": "#D98200", "pattern": "hazard", "bokeh": ["rgba(255,214,10,", "rgba(80,130,255,", "rgba(255,140,40,"]},
  font: "kufam", wordlit: true, realSfx: true, grooveFrom: 2,
  lang: "en", duration: 33, bpm: 104,
  roots: [49, 41.2, 55, 43.65], chords: [[196, 233.1, 293.7], [164.8, 196, 246.9], [220, 261.6, 329.6], [174.6, 220, 261.6]],
  caps: [
    [0.0, ""], [2.0, "[3 places] to check"],
    [3.2, "Brand-new [news]"], [4.4, "its knowledge has a cutoff"], [5.8, "so it can be [outdated]"], [7.4, "ask: where is this from?"], [8.8, "then check the [source]"], [10.2, "yourself"], [11.6, "Numbers & sources"], [12.8, "sometimes it [invents] them"], [14.2, "a stat, a book, a study"], [15.6, "with total confidence"], [16.8, "[verify] before you share"], [19.0, "Health & money"], [20.2, "it gives general info"], [21.6, "but it's not your [doctor]"], [23.0, "or your accountant"], [24.4, "big decisions?"], [25.6, "ask an [expert]"], [27.4, "Use AI the [smart] way"], [28.6, "save this video"], [29.8, "and send it to a friend"], [31.0, "follow [Takka]"]
  ],
  shots: [
    [0.0, "big", { text: "[3] places", size: 170, sub: "check these yourself" }],
    [3.2, "warn", { text: "Brand-new [news]", sub: "trained on data up to a certain date" }],
    [7.2, "type", { text: "Where did you get this? Give me the source.", cps: 22, label: "Always ask:" }],
    [10.2, "big", { text: "Check the [source]", size: 110, sub: "yourself, not its word" }],
    [11.6, "doc", { head: "An answer with numbers", foldAt: 1.1, bullets: ["A very exact number?", "A book or study title?", "A link or source?", "→ verify them"], badge: "check" }],
    [16.6, "big", { text: "[Verify] first", size: 130, sub: "before you copy or share" }],
    [19.0, "warn", { text: "Health & [money]", sub: "general info, not a decision" }],
    [23.0, "big", { text: "Ask an [expert]", size: 120, sub: "doctor, lawyer or accountant" }],
    [27.4, "save", { text: "Save this video" }],
  ],
  items: [[0, "", "", ""], [3.2, "01", "Brand-new news", "Its knowledge has a cutoff"], [11.6, "02", "Numbers & sources", "It can invent them"], [19.0, "03", "Health & money", "General info, not a decision"], [27.4, "", "", ""]],
  light: [[27.4, 99]],
  sfx: [[2.0, "hit"], [3.3, "hit"], [19.1, "hit"]],
};
// cold-open hook (hook.inject.html): the hero word's motion acts its meaning
window.HOOK = {"accent": "#FFD60A", "glow": "rgba(255,214,10,.2)", "streak": "rgba(200,215,255,.7)", "font": "Kufam", "feel": "brake", "dir": "ltr", "l1": "Before you copy that AI answer…", "s1": 58, "big": "STOP.", "l3": "It sounds sure. It can be wrong.", "s3": 58, "tease": "3 places it happens", "bg": "#070C18", "accent2": "#FFD60A"};
