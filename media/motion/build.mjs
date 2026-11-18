// build.mjs: inline the fonts (base64 @font-face) into a motion page so rendering never falls back.
//   node build.mjs page.html out.html
// Fonts are OFL/Bitstream-licensed system fonts installed by scripts/install-media.sh (fonts-lemonada,
// fonts-noto-core) plus DejaVu Sans Mono.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
const [, , src, out] = process.argv;
const pick = (...paths) => { const p = paths.find(existsSync); if (!p) throw new Error("font not found: " + paths.join(" | ")); return p; };
const FONTS = [
  ["Lemonada", 600, pick("/usr/share/fonts/opentype/lemonada/Lemonada-SemiBold.otf"), "opentype"],
  ["Kufi", 700, pick("/usr/share/fonts/truetype/noto/NotoKufiArabic-Bold.ttf"), "truetype"],
  ["Kufi", 400, pick("/usr/share/fonts/truetype/noto/NotoKufiArabic-Regular.ttf"), "truetype"],
  ["Mono", 400, pick("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"), "truetype"],
  ["Sans", 700, pick("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"), "truetype"],
  ["Sans", 400, pick("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"), "truetype"],
  // Kufam (OFL, Google Fonts; licence in fonts/OFL-Kufam.txt): variable weight 400–900, Arabic + Latin display face
  ["Kufam", "400 900", pick(new URL("./fonts/Kufam-wght.ttf", import.meta.url).pathname), "truetype"],
];
const css = FONTS.map(([fam, w, p, fmt]) => `@font-face{font-family:"${fam}";font-weight:${w};src:url(data:font/${fmt === "opentype" ? "otf" : "ttf"};base64,${readFileSync(p).toString("base64")}) format("${fmt}")}`).join("\n");
const html = readFileSync(src, "utf8");
if (!html.includes("/*@FONTS@*/")) throw new Error("page has no /*@FONTS@*/ placeholder");
// /*@SFX@*/ (optional): inline media/motion/sfx/*.ogg as window.SFX_FILES (CC0 uisfx + MIT earshot; see sfx/CREDITS.md)
const sfxDir = new URL("./sfx/", import.meta.url).pathname;
const sfx = html.includes("/*@SFX@*/") && existsSync(sfxDir)
  ? "window.SFX_FILES = " + JSON.stringify(Object.fromEntries(readdirSync(sfxDir).filter((f) => f.endsWith(".ogg")).map((f) => [f.replace(/\.ogg$/, ""), "data:audio/ogg;base64," + readFileSync(sfxDir + f).toString("base64")]))) + ";"
  : "";
writeFileSync(out, html.replace("/*@FONTS@*/", css).replace("/*@SFX@*/", sfx));
console.log("built", out, (Buffer.byteLength(css) / 1024).toFixed(0) + " KB of fonts");
