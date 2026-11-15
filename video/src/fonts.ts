import {continueRender, delayRender, staticFile} from 'remotion';

// Load the bundled Arabic font (Cairo, variable weight) before rendering,
// so Arabic glyphs are present in the headless browser.
const handle = delayRender('load-arabic-font');

try {
  const cairo = new FontFace(
    'Cairo',
    `url(${staticFile('fonts/cairo-var.ttf')}) format('truetype')`,
    {weight: '200 900', style: 'normal'},
  );
  cairo
    .load()
    .then((loaded) => {
      // @ts-expect-error document.fonts exists in the render browser
      document.fonts.add(loaded);
      continueRender(handle);
    })
    .catch(() => continueRender(handle));
} catch {
  continueRender(handle);
}

export const ARABIC_FONT = 'Cairo';
