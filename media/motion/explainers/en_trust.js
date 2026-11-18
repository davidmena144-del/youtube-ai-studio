// title: 3 Things You Should Never Trust AI With
/* global window */
window.DATA = {
  font: "kufam",
  lang: "en", duration: 33, bpm: 104,
  roots: [49, 41.2, 55, 43.65], chords: [[196, 233.1, 293.7], [164.8, 196, 246.9], [220, 261.6, 329.6], [174.6, 220, 261.6]],
  caps: [
    [0.0, "Before you trust"], [0.7, "your next [AI answer]…"], [1.5, "know where it can [lie]"], [2.4, "[3 places]"],
    [3.2, "Brand-new [news]"], [4.4, "its knowledge has a cutoff"], [5.8, "so it can be [outdated]"], [7.4, "ask: where is this from?"], [8.8, "then check the [source]"], [10.2, "yourself"],
    [11.6, "Numbers & sources"], [12.8, "sometimes it [invents] them"], [14.2, "a stat, a book, a study"], [15.6, "with total confidence"], [16.8, "[verify] before you share"],
    [19.0, "Health & money"], [20.2, "it gives general info"], [21.6, "but it's not your [doctor]"], [23.0, "or your accountant"], [24.4, "big decisions?"], [25.6, "ask an [expert]"],
    [27.4, "Use AI the [smart] way"], [28.6, "save this video"], [29.8, "and send it to a friend"], [31.0, "follow [Takka]"],
  ],
  shots: [
    [0.0, "big", { text: "It can [lie].", size: 150, sub: "with total confidence" }],
    [1.5, "big", { text: "[3] places", size: 170, sub: "check these yourself" }],
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
  sfx: [[0.35, "hit"], [3.3, "hit"], [19.1, "hit"]],
};
