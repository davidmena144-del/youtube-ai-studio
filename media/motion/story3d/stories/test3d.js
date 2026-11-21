// title: 3D test
/* global window */
window.STORY = {
  seed: 7, bpm: 84,
  cast: {
    hero: { skin: "#C98A5A", shirt: "#2F6FD0", pants: "#2B2F3A", hat: "goggles", scarf: "#F2913A" },
    guard: { skin: "#B5764A", shirt: "#1F2A44", pants: "#141A2C", hat: "cap", badge: "#E8B93A", scale: 1.12 },
    sheikh: { skin: "#D9A47A", shirt: "#F4F0E6", pants: "#F4F0E6", hat: "ghutra" },
  },
  lines: [
    { say: "في مدينة بعيدة كان كريم يمشي وحده", hl: ["كريم"], shots: [
      { mood: "day", cam: [3, 9, 30, 0, 3, 0, 46], cam2: [2, 3.4, 15, 0, 2.2, 2, 40], actors: { hero: { p: [0, -6], to: [0, 4], act: "walk" } } } ] },
    { say: "حتى أوقفه الحارس وقال له", hl: ["الحارس"], shots: [
      { mood: "day", cam: [0.1, 2.9, 17, 0.1, 2.2, 4.2, 34], cam2: [0.1, 2.8, 15.4, 0.1, 2.2, 4.2, 33], actors: { hero: { p: [-0.95, 4], ry: 0.7, act: "shock" }, guard: { p: [1.15, 4.3], ry: -0.8, act: "point", mood: "angry" } } } ] },
    { say: "انظر إلى الساعة", hl: ["الساعة"], shots: [
      { mood: "sunset", cam: [5, 2, 22, 0, 30, 0, 50], cam2: [3, 2, 18, 0, 36, 0, 46], props: { tower: [0, -4, 0, 5], sunball: [-40, 30, -90] } } ] },
    { say: "الوقت ينتهي الآن", hl: ["ينتهي"], shots: [
      { mood: "night", cam: [0, 3.4, 18, 0, 3.7, 0, 36], cam2: [0, 3.5, 16, 0, 3.8, 0, 35], props: { timer: [0, 6.2, 0, 9, "#FF4B4B"] }, actors: { sheikh: { p: [-1.15, 2], ry: 0.5, act: "talk" }, hero: { p: [1.15, 2.2], ry: -0.5, act: "sad" } }, shake: 0.05 } ] },
  ],
};
