// title: مدينة المصابيح
/* global window */
// An original story. Hook pattern: "My name is ..., and in my city ...".
const N = "night", D = "day", S = "sunset", M = "morning";
window.STORY = {
  seed: 7, bpm: 78, roots: [110, 87.31, 130.81, 98],
  cast: {
    salim: { skin: "#E0A878", shirt: "#F4F1EA", jacket: "#F2B33D", pants: "#2F5FA8", shoe: "#D8453A", hat: "hair", hairCol: "#3A2416", scale: 0.86 },
    dad: { skin: "#C98F62", shirt: "#3F7FBF", jacket: "#F2783A", pants: "#2B3550", hat: "cap", hatCol: "#F2B33D", mustache: "#2A1A12", scale: 1.06 },
    mom: { skin: "#E3B08A", shirt: "#B565D8", robe: "#B565D8", pants: "#7A3FA0", hat: "scarf", hatCol: "#F08AB0", scale: 0.98 },
    rich: { skin: "#E8B892", shirt: "#6B2FA0", jacket: "#3A1A5E", pants: "#3A1A5E", collar: "#F2C230", hat: "hair", hairCol: "#1A1218", mustache: "#1A1218", belly: 1, scale: 1.1, lampCol: "#FFE9A0" },
    old: { skin: "#C89A74", shirt: "#8C8C8C", pants: "#5A5A5A", hat: "hair", hairCol: "#D8D8D8", beard: "#D8D8D8", brow: "#BDBDBD", scale: 0.95 },
    g1: { skin: "#B5764A", shirt: "#1F2A44", pants: "#141A2C", hat: "cap", hatCol: "#1F2A44", badge: "#E8B93A", scale: 1.12 },
    g2: { skin: "#D8A078", shirt: "#1F2A44", pants: "#141A2C", hat: "cap", hatCol: "#1F2A44", badge: "#E8B93A", mustache: "#2A1A12", scale: 1.12 },
    gov: { skin: "#E0B090", shirt: "#B5282E", robe: "#B5282E", collar: "#F2C230", pants: "#7A1A1E", hat: "crown", hairCol: "#3A2416", beard: "#3A2416", belly: 1, scale: 1.18, lampCol: "#FFF3C4" },
    ex1: { skin: "#E8C0A0", shirt: "#3DB58A", pants: "#2B2F3A", hat: "long", hairCol: "#5A3420", scale: 0.96 },
    ex2: { skin: "#A86E48", shirt: "#E2574C", pants: "#3A3F52", hat: "hair", hairCol: "#14141C", scale: 1.02 },
  },
  lines: [
    { say: "اسمي سليم.", hl: ["سليم"], gap: 0.35, shots: [
      { mood: D, cam: [0.5, 3.5, 6.2, 0, 3.3, 0, 34], cam2: [0.3, 3.5, 5.2, 0, 3.3, 0, 33], actors: { salim: { p: [0, 0], act: "wave" } } } ] },
    { say: "وفي مدينتي، يولد كل إنسان ومصباحٌ صغيرٌ يطفو فوق رأسه.", hl: ["مصباح", "رأسه"], shots: [
      { mood: D, cam: [4, 8, 19, 0, 2.6, 0, 44], cam2: [3, 5.5, 14, 0, 2.8, 0, 42], actors: { salim: { p: [0, 1.5] }, mom: { p: [-2.6, -6], to: [-2.2, 2], act: "walk" }, dad: { p: [2.6, 9], to: [2.4, 2], act: "walk" }, ex1: { p: [-1.2, -14], to: [-1, -5], act: "walk" }, ex2: { p: [1.4, -18], to: [1.2, -9], act: "walk" }, old: { p: [3.6, -8], to: [3.4, -4], act: "walk", lamp: 0.5 } } },
      { at: 0.55, mood: D, cam: [-2.4, 4.9, 5.2, 0.2, 4.2, 0, 32], cam2: [-1.6, 4.9, 4.6, 0.2, 4.3, 0, 31], actors: { salim: { p: [0, 0], act: "look", hx: -0.2 }, ex1: { p: [1.5, -1.6], ry: -0.4 }, ex2: { p: [-1.6, -2.4], ry: 0.5 } } } ] },
    { say: "ما دام مصباحك مضيئاً، فأنت موجود.", hl: ["مضيئاً", "موجود"], shots: [
      { mood: D, cam: [1.0, 3.3, 8.6, 0, 3.2, 0, 36], cam2: [0.6, 3.3, 7.6, 0, 3.3, 0, 35], actors: { salim: { p: [0, 0], act: "reach", mood: "happy", lamp: [1, 1.6] } } } ] },
    { say: "وإذا انطفأ، نسيك الجميع، كأنك لم تكن يوماً.", hl: ["انطفأ", "نسيك"], shots: [
      { mood: S, cam: [0.6, 3.4, 6.4, 0, 3.3, 0, 34], cam2: [0.4, 3.5, 5.6, 0, 3.5, 0, 33], actors: { old: { p: [0, 0], act: "sad", lamp: [0.6, 0] } } },
      { at: 0.45, mood: S, cam: [3, 3.4, 13, 0, 2.4, 0, 38], cam2: [2.4, 3.2, 12, 0, 2.4, 0, 37], actors: { old: { p: [0, 0], act: "sad", lamp: 0, alpha: [1, 0.08] }, ex1: { p: [-2.6, -9], to: [-2.4, -1], act: "walk" }, ex2: { p: [2.6, 2], to: [2.4, -7], act: "walk" } } } ] },
    { say: "في وسط المدينة برجٌ عالٍ، اسمه برج النور.", hl: ["برج", "النور"], shots: [
      { mood: S, cam: [3.5, 2.2, 2, 0, 30, -40, 52], cam2: [2.5, 2.2, -4, 0, 52, -40, 50], props: { tower: [0, -40] }, actors: { salim: { p: [1.2, -9], ry: Math.PI, act: "look" } } } ] },
    { say: "الأغنياء يشترون منه الضوء، فتلمع مصابيحهم كالشمس.", hl: ["الأغنياء", "كالشمس"], shots: [
      { mood: D, cam: [0.9, 3.0, 9, 0, 3.0, 0, 36], cam2: [0.5, 3.2, 7.6, 0, 3.3, 0, 35], actors: { rich: { p: [0, 0], act: "talk", mood: "happy", lamp: [1.2, 2.6] } } } ] },
    { say: "أما الفقراء، فيخفت ضوؤهم يوماً بعد يوم.", hl: ["الفقراء", "يخفت"], shots: [
      { mood: S, cam: [-0.4, 3.0, 11.5, 0, 2.6, 0, 36], cam2: [-0.2, 3.0, 10.4, 0, 2.7, 0, 35], actors: { old: { p: [-1.0, 0], ry: 0.3, act: "sad", lamp: [0.45, 0.2] }, ex2: { p: [1.0, 0.3], ry: -0.3, act: "sad", lamp: [0.5, 0.25] } } } ] },
    { say: "أبي كان عاملاً بسيطاً، يصلح أعمدة الإنارة.", hl: ["أبي", "الإنارة"], shots: [
      { mood: S, cam: [-2.2, 3.4, 12.5, 0.3, 3.4, 0, 40], cam2: [-1.6, 3.6, 11, 0.4, 3.8, 0, 39], props: { lamppost: [1.3, 0, 1, 1] }, actors: { dad: { p: [0.35, 0.5], ry: 0.9, act: "fix" }, salim: { p: [-1.5, 1.6], ry: 0.6, act: "look", mood: "happy" } } } ] },
    { say: "وفي ليلةٍ باردة، انطفأ مصباحه.", hl: ["انطفأ"], gap: 0.5, shots: [
      { mood: N, cam: [0.6, 3.7, 6.6, 0, 3.6, 0, 34], cam2: [0.4, 3.8, 5.6, 0, 3.8, 0, 33], props: { lamppost: [2.2, -1.2, [1, 0]] }, actors: { dad: { p: [0, 0], act: "sad", lamp: [0.8, 0] } }, sfx: "es_impact" } ] },
    { say: "وفي الصباح، سألت أمي عنه، فقالت: من تقصد؟", hl: ["أمي", "تقصد"], shots: [
      { set: "home", mood: M, cam: [0, 3.0, 19, 0, 2.5, 6, 34], cam2: [0, 2.9, 17.6, 0, 2.5, 6, 33], props: { house: [0, 0] }, actors: { salim: { p: [-1.0, 6.2], ry: 0.8, act: "talk", mood: "worry" }, mom: { p: [1.0, 6], ry: -0.7, act: "shrug" } } } ] },
    { say: "لم يتذكره أحد. أنا وحدي ما زلت أذكره.", hl: ["وحدي"], shots: [
      { mood: D, cam: [2.5, 3.6, 13, 0, 2.6, 0, 38], cam2: [1.6, 3.4, 10, 0, 2.8, 0, 36], actors: { salim: { p: [0, 0], act: "sad" }, ex1: { p: [-2.4, -7], to: [-2.2, 6], act: "walk" }, ex2: { p: [2.3, 7], to: [2.1, -6], act: "walk" }, mom: { p: [-3.4, 8], to: [-3.2, -4], act: "walk" } } },
      { at: 0.5, mood: D, cam: [0.5, 3.2, 5.4, 0, 3.0, 0, 32], cam2: [0.3, 3.2, 4.6, 0, 3.05, 0, 31], actors: { salim: { p: [0, 0], act: "sad" } } } ] },
    { say: "فقررت أن أعرف الحقيقة: أين يذهب الضوء حين ينطفئ؟", hl: ["الحقيقة", "الضوء"], shots: [
      { mood: S, cam: [0.6, 3.3, 5.6, 0, 3.0, 0, 33], cam2: [0.4, 3.3, 4.9, 0, 3.0, 0, 32], actors: { salim: { p: [0, 0], act: "think", mood: "angry" } } },
      { at: 0.5, mood: S, cam: [1.4, 3.6, 7.5, 0, 16, -40, 46], cam2: [1.0, 3.4, 5.5, 0, 24, -40, 44], props: { tower: [0, -40] }, actors: { salim: { p: [0, 0], ry: Math.PI, act: "look" } } } ] },
    { say: "تسللت ليلاً إلى برج النور.", hl: ["ليلاً"], shots: [
      { mood: N, cam: [3.2, 4.6, 6, 0, 7, -30, 46], cam2: [2.6, 4.0, 2, 0, 9, -30, 45], props: { tower: [0, -34] }, actors: { salim: { p: [0, -4], to: [0, -11], act: "sneak" } } } ] },
    { say: "كان الحراس في كل مكان.", hl: ["الحراس"], shots: [
      { mood: N, cam: [0, 2.6, -14, 0, 2.6, -26, 40], cam2: [0, 2.6, -15.5, 0, 2.7, -26, 39], props: { tower: [0, -34] }, actors: { g1: { p: [-2.2, -27], to: [0.4, -27], act: "walk", mood: "angry" }, g2: { p: [2.4, -25.5], to: [-0.2, -25.5], act: "walk", mood: "angry" } } } ] },
    { say: "صعدت ألف درجة، حتى كاد قلبي يتوقف.", hl: ["ألف"], shots: [
      { set: "stairs", mood: "dark", cam: [1.2, 4.2, 2.6, 0, 7, -12, 48], cam2: [1.0, 8.6, -6, 0, 11.5, -19, 46], actors: { salim: { p: [0, -3.6, 1.83], to: [0, -18, 8.55], ry: Math.PI, act: "run", mood: "worry" } } } ] },
    { say: "وفي القمة، فتحت باباً حديدياً ثقيلاً.", hl: ["القمة"], shots: [
      { set: "vault", mood: "dark", cam: [0, 2.7, -3, 0, 2.7, 7, 40], cam2: [0, 2.8, -1.4, 0, 2.9, 7, 38], actors: { salim: { p: [0, 9.5], to: [0, 6.5], ry: Math.PI, act: "sneak" } } } ] },
    { say: "ورأيت ما لم يره أحدٌ من قبل.", hl: ["أحد"], gap: 0.45, shots: [
      { set: "vault", mood: "gold", cam: [0.5, 3.1, 2.4, 0, 2.95, 6.5, 32], cam2: [0.3, 3.1, 3.2, 0, 2.95, 6.5, 30], actors: { salim: { p: [0, 6.5], ry: Math.PI, act: "shock" } }, sfx: "es_hit" } ] },
    { say: "آلاف المصابيح، محبوسةٌ في أقفاصٍ زجاجية.", hl: ["آلاف", "أقفاص"], shots: [
      { set: "vault", mood: "gold", cam: [0, 7.5, 12, 0, 4.2, -12, 52], cam2: [0, 4.6, 5, 0, 4.6, -16, 50] },
      { at: 0.55, set: "vault", mood: "gold", cam: [-0.6, 3.0, 3.5, -4.6, 3.4, -5, 40], cam2: [-0.8, 3.4, -4, -4.6, 3.8, -12, 40] } ] },
    { say: "لم تنطفئ يوماً. لقد سُرقت.", hl: ["سُرقت", "سرقت"], gap: 0.45, shots: [
      { set: "vault", mood: "gold", cam: [1.2, 3.2, 3.4, -2.2, 3.0, -2.2, 36], cam2: [0.9, 3.2, 2.6, -2.2, 3.0, -2.2, 34], actors: { salim: { p: [-1.5, -1.6], ry: -1.1, act: "reach", mood: "sad" } } } ] },
    { say: "كان حاكم المدينة يسرق ضوء الفقراء، ليبيعه للأغنياء.", hl: ["حاكم", "يسرق"], shots: [
      { set: "vault", mood: "gold", cam: [0.6, 1.9, -1.2, 0, 3.4, -8, 42], cam2: [0.3, 2.2, -2.6, 0, 3.6, -8, 40], actors: { gov: { p: [0, -8], act: "talk", mood: "happy", lamp: 2.6 }, g1: { p: [-2.3, -9.4], ry: 0.2, mood: "angry" }, g2: { p: [2.3, -9.4], ry: -0.2, mood: "angry" } } } ] },
    { say: "سمعت خطوات الحراس خلفي. لم يبقَ وقت.", hl: ["الحراس", "وقت"], shots: [
      { set: "vault", mood: "gold", cam: [0, 2.5, -1, 0, 2.5, 9, 42], cam2: [0, 2.5, -0.4, 0, 2.5, 9, 42], actors: { g1: { p: [-1.2, 15], to: [-1.2, 7], act: "run", mood: "angry" }, g2: { p: [1.2, 16.5], to: [1.2, 8.5], act: "run", mood: "angry" } }, shake: 0.06 },
      { at: 0.55, set: "vault", mood: "gold", cam: [0.5, 3.1, 4.6, 0, 2.95, 0, 32], cam2: [0.3, 3.1, 4.0, 0, 2.95, 0, 31], actors: { salim: { p: [0, 0], act: "shock" } } } ] },
    { say: "فكسرت القفص الأول، ثم الثاني، ثم كلها.", hl: ["كسرت", "كلها"], shots: [
      { set: "vault", mood: "gold", cam: [1.6, 3.1, 4.2, -2.4, 2.9, -2, 38], cam2: [1.3, 3.1, 3.4, -2.4, 2.9, -2, 37], props: { cages: [0, 0.12] }, actors: { salim: { p: [-1.5, -1.2], ry: -1.2, act: "smash" } }, shake: 0.05 },
      { at: 0.5, set: "vault", mood: "gold", cam: [0, 5.5, 10, 0, 5.5, -12, 52], cam2: [0, 6.5, 12, 0, 7.5, -12, 54], props: { cages: [0.12, 1] }, actors: { salim: { p: [0, 1.5], act: "cheer" } }, shake: 0.1, sfx: "es_impact" } ] },
    { say: "طارت المصابيح من النوافذ كالنجوم، وعادت إلى أصحابها.", hl: ["كالنجوم", "أصحابها"], shots: [
      { mood: N, cam: [7, 9, 28, 0, 44, -40, 56], cam2: [5, 7, 22, 0, 38, -40, 56], props: { tower: [0, -40, 0.5], swarm: { from: [0, 62, -40], spread: 70, rise: -46, size: 3.2, stagger: 1.2, speed: 1.6 } } },
      { at: 0.5, mood: N, cam: [0.4, 3.2, 11.5, 0, 3.0, 0, 38], cam2: [0.2, 3.3, 10.4, 0, 3.2, 0, 37], props: { swarm: { from: [0, 12, 0], spread: 9, rise: -8, size: 1.3, stagger: 1.5, speed: 1.4 } }, actors: { old: { p: [-1.0, 0], ry: 0.3, act: "cheer", lamp: [0.05, 1.5] }, ex2: { p: [1.0, 0.3], ry: -0.3, act: "cheer", lamp: [0.05, 1.5] } } } ] },
    { say: "وفي الصباح، وجدت أبي واقفاً أمام البيت.", hl: ["أبي"], shots: [
      { set: "home", mood: M, cam: [-1.6, 3.2, 19, 0.2, 2.6, 6, 36], cam2: [-0.6, 3.0, 17, 0.2, 2.6, 6, 34], props: { house: [0, 0] }, actors: { dad: { p: [0.9, 5.6], ry: -0.3, act: "wave", lamp: 1.4 }, salim: { p: [-3.2, 13], to: [-0.5, 6.6], act: "run", mood: "happy" } } },
      { at: 0.6, set: "home", mood: M, cam: [0.3, 3.0, 13.6, 0.1, 2.7, 6, 32], cam2: [0.2, 3.0, 12.6, 0.1, 2.8, 6, 31], props: { house: [0, 0] }, actors: { dad: { p: [0.5, 6], ry: -1.1, act: "hug", lamp: 1.4 }, salim: { p: [-0.42, 6.05], ry: 1.1, act: "hug" }, mom: { p: [2.2, 5.2], ry: -0.6, act: "cheer" } } } ] },
    { say: "ومنذ ذلك اليوم، لا أحد يشتري الضوء في مدينتي.", hl: ["لا", "مدينتي"], shots: [
      { mood: D, cam: [3, 4, 15, 0, 2.6, 0, 42], cam2: [5, 12, 24, 0, 3, -6, 46], actors: { salim: { p: [0, 1], act: "wave" }, dad: { p: [1.5, 0.2], act: "cheer", lamp: 1.4 }, mom: { p: [-1.5, 0.2], act: "cheer" }, old: { p: [3.2, -3], act: "cheer", lamp: 1.4 }, ex1: { p: [-3.2, -3.5], act: "cheer" }, ex2: { p: [0.4, -5], act: "cheer", lamp: 1.4 } } } ] },
    { say: "فالنور، لا يُباع.", hl: ["النور", "يُباع", "يباع"], gap: 0.5, shots: [
      { mood: D, cam: [0.5, 3.4, 6.4, 0, 3.4, 0, 34], cam2: [0.3, 3.5, 5.2, 0, 3.5, 0, 33], actors: { salim: { p: [0, 0], mood: "happy", lamp: [1.2, 2.2] } } } ] },
    { say: "تابعني، لتسمع قصةً جديدةً كل يوم.", hl: ["تابعني"], shots: [
      { mood: D, cam: [0.8, 3.2, 8.6, 0, 3.0, 0, 36], cam2: [0.5, 3.2, 7.6, 0, 3.1, 0, 35], actors: { salim: { p: [0, 0], act: "wave" } } } ] },
  ],
};
