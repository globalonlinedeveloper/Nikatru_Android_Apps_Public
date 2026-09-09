#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render-splash.mjs — the LAUNCH SCREEN, derived from the app's own 1024 master.
//
// 🔴 WHY THIS EXISTS — measured on the real tree 2026-09-09, not read anywhere.
// Every launch-screen asset `apps/subscriptiontracker` shipped was Flutter's
// placeholder, on both platforms that have a launch screen at all:
//
//   ios    LaunchImage.png / @2x / @3x   68 bytes each, md5
//          978c1bee49d7ad5fc1a4d81099b13e18 — one 1x1 FULLY TRANSPARENT pixel,
//          which is what `flutter create` writes. The storyboard meanwhile
//          declared `<image name="LaunchImage" width="168" height="185"/>`, a
//          size no file in the imageset has ever had. iOS therefore rendered a
//          blank white screen for the whole of the engine's cold start.
//   android drawable/launch_background.xml and drawable-v21/launch_background.xml
//          were stock, byte for byte: a background colour layer with the bitmap
//          item STILL COMMENTED OUT, and no `launch_image` drawable anywhere in
//          the tree to have referenced.
//
// Web was already right (`web/index.html`'s branded `#boot` loader), and macOS,
// Windows and Linux have no launch-screen concept. So this is an iOS + Android
// gap, and it is the first thing a user sees every single time they open the
// app — for longer on the cold start of a cheap Android phone than on anything
// a reviewer will look at twice.
//
// 🔬 AND IT IS A FACTORY DEFECT, exactly like the launcher icons.
// `tooling/bricks/app/__brick__/apps/{{app_id}}/` carries NO native platform
// folders; the owner adds them with `flutter create . --platforms=…` after
// stamping, which is precisely the command that writes the placeholder. So all
// 50 planned apps are born with a blank splash. Fixing Subly alone fixes one
// instance of something the template reproduces on demand — which is why
// `assert-launcher-icons.mjs` grew limb 8 in the same commit as these bytes.
//
// ── DERIVED, NEVER HAND-PLACED ──────────────────────────────────────────────
// Same reasoning as render-linux-icons.mjs, and the same master: the ONE file
// `assets/icon/app_icon_1024.png` that every other platform's mark comes from.
// A separate splash source image would be a second place the brand lives, and
// two copies of one fact is how the wrong one ships. Because these are derived,
// limb 8 can RE-DERIVE them and compare decoded pixels — a strictly stronger
// claim than "not Flutter's", which a blank square would also satisfy.
//
// The master carries its own background (the brand tile gradient, see
// assets/icon/app_icon_background.svg), so one asset reads correctly on both
// launch backgrounds without a second light/dark variant: iOS's storyboard is
// white, and Android's `drawable-v21` layer is `?android:colorBackground`, which
// follows the system theme. That theme-following layer is kept exactly as it
// was — replacing it with a fixed brand colour would make the splash the one
// surface in the app that ignores dark mode.
//
// ── 🔴 THE RESAMPLE IS EXACT-AREA, AND boxDownscale COULD NOT DO IT ─────────
// render-linux-icons.mjs's `boxDownscale` averages whole f×f blocks and refuses
// a size that does not divide the master. That is right for the hicolor theme,
// whose four sizes are all powers of two. It cannot express an iOS `@3x`: a 3x
// asset is three times a point size, and 3·N never divides 1024. Rounding the
// 3x to the nearest divisor would ship an asset iOS renders at the wrong point
// size — a bigger mark on exactly the newest phones.
//
// So [areaResample] below computes each output pixel as the exact area-weighted
// mean of the source pixels it covers, in INTEGER arithmetic (every weight is a
// difference of integers; every accumulator stays far below 2^53). It agrees
// with `boxDownscale` wherever the factor is a whole number, and it is
// bit-reproducible on every machine — which is the property the whole
// re-derivation argument rests on.
//
// Usage:  node tooling/store/render-splash.mjs [--app subscriptiontracker] [--check]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { decodeRgba, encodeRgba, PngUnreadable } from './png-codec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));

/**
 * The launch mark's size in POINTS (iOS) / density-independent pixels
 * (Android), and THE ONE PLACE IT IS DECLARED.
 *
 * 96 rather than something larger: a launch screen is a held breath, not a
 * poster. The mark has to read instantly at arm's length on a 4.7" phone and
 * must not look like a modal on a 12.9" iPad, where the same 96pt sits in the
 * middle of a much larger field. It is also the size Android's own splash-screen
 * guidance uses for a full-bleed icon.
 */
export const SPLASH_POINT_SIZE = 96;

/**
 * iOS: `<scale suffix>` → pixel size, straight off [SPLASH_POINT_SIZE].
 *
 * The empty suffix is the 1x file. All three are listed rather than computed at
 * the call site so that the imageset's `Contents.json`, the storyboard's
 * declared size and this table cannot drift apart silently.
 */
export const IOS_SCALES = [
  { suffix: '', scale: 1 },
  { suffix: '@2x', scale: 2 },
  { suffix: '@3x', scale: 3 },
];

/** Where the iOS launch imageset lives inside an app. */
export const IOS_IMAGESET = 'ios/Runner/Assets.xcassets/LaunchImage.imageset';

/** The storyboard that names it. Limb 8 reads the size it declares. */
export const IOS_STORYBOARD = 'ios/Runner/Base.lproj/LaunchScreen.storyboard';

/**
 * Android: density bucket → pixels per [SPLASH_POINT_SIZE] dp.
 *
 * The standard multipliers (mdpi = 1×, hdpi = 1.5×, xhdpi = 2×, xxhdpi = 3×,
 * xxxhdpi = 4×). ldpi is deliberately absent: Google's own dashboard has not
 * reported a measurable ldpi population for years, and an unused density is a
 * file nobody looks at that still has to be regenerated forever.
 */
export const ANDROID_DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

/** Where the Android launch drawable lives, per density bucket. */
export const ANDROID_RES = 'android/app/src/main/res';

/** The drawable name both `launch_background.xml` files must reference. */
export const ANDROID_DRAWABLE_NAME = 'launch_image';

/** The two stock launch backgrounds `flutter create` writes. Both are checked:
 *  `drawable-v21/` wins on every device this app supports, and the un-qualified
 *  one is the fallback that would otherwise stay stock forever. */
export const ANDROID_BACKGROUNDS = [
  `${ANDROID_RES}/drawable/launch_background.xml`,
  `${ANDROID_RES}/drawable-v21/launch_background.xml`,
];

export class SplashBrandUnavailable extends Error {
  constructor(lines) {
    super(lines[0]);
    this.lines = lines;
  }
}

// ── the one image operation this generator owns ─────────────────────────────

/**
 * Exact area-weighted downscale of a square RGBA image to `size`×`size`.
 *
 * 🔴 INTEGER WEIGHTS, NOT A KERNEL. Output pixel `x` covers the source interval
 * `[x·W/size, (x+1)·W/size)`. Multiplying both ends by `size` turns every
 * boundary into a whole number, so each source pixel's contribution is a
 * difference of integers — no phase, no rounding policy, no invented tolerance,
 * and the same answer on every machine. That reproducibility is not a nicety:
 * it is what allows `assert-launcher-icons.mjs` limb 8 to RE-DERIVE these files
 * and compare them, rather than merely trusting whatever is committed.
 *
 * RGB is accumulated ALPHA-WEIGHTED and then un-premultiplied, for the reason
 * `boxDownscale` records: averaging colour straight drags a mark's edge toward
 * whatever sits under a fully transparent pixel — usually black — and paints a
 * dark halo that only appears at small sizes, i.e. exactly where nobody looks.
 *
 * Upscaling is REFUSED rather than supported. Every size here is smaller than
 * the 1024 master by construction, and a silent upscale would turn a master
 * somebody shrank into a soft splash nothing complains about.
 */
export function areaResample({ width, height, rgba }, size) {
  if (width !== height) {
    throw new SplashBrandUnavailable([`master is ${width}x${height}, not square`]);
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new SplashBrandUnavailable([`${size} is not a positive whole pixel count`]);
  }
  if (size > width) {
    throw new SplashBrandUnavailable([
      `refusing to UPSCALE ${width}px to ${size}px.`,
      'Every splash size is smaller than the master by construction. A silent upscale would turn a master',
      'somebody shrank into a soft launch screen that nothing in the tree complains about.',
    ]);
  }
  // span[i] = the integer interval [lo, hi) this output row/column covers, in
  // units of 1/size of a source pixel. Computed once per axis: the image is
  // square, so both axes use it.
  const span = [];
  for (let i = 0; i < size; i++) span.push([i * width, (i + 1) * width]);

  const out = Buffer.alloc(size * size * 4);
  const total = width * width; // sum of (wx·wy) over the covered block
  for (let y = 0; y < size; y++) {
    const [ylo, yhi] = span[y];
    const sy0 = Math.floor(ylo / size);
    const sy1 = Math.ceil(yhi / size);
    for (let x = 0; x < size; x++) {
      const [xlo, xhi] = span[x];
      const sx0 = Math.floor(xlo / size);
      const sx1 = Math.ceil(xhi / size);
      let r = 0;
      let g = 0;
      let b = 0;
      // sum of (weight · alpha). It is BOTH the divisor that un-premultiplies
      // the colour sums and the numerator of the output alpha — the same
      // quantity, used twice, so there is nothing for a second accumulator to
      // drift from.
      let aw = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const wy = Math.min(yhi, (sy + 1) * size) - Math.max(ylo, sy * size);
        if (wy <= 0) continue;
        for (let sx = sx0; sx < sx1; sx++) {
          const wx = Math.min(xhi, (sx + 1) * size) - Math.max(xlo, sx * size);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (sy * width + sx) * 4;
          const av = rgba[i + 3];
          r += rgba[i] * av * w;
          g += rgba[i + 1] * av * w;
          b += rgba[i + 2] * av * w;
          aw += av * w;
        }
      }
      const d = (y * size + x) * 4;
      out[d] = aw === 0 ? 0 : Math.round(r / aw);
      out[d + 1] = aw === 0 ? 0 : Math.round(g / aw);
      out[d + 2] = aw === 0 ? 0 : Math.round(b / aw);
      out[d + 3] = Math.round(aw / total);
    }
  }
  return { width: size, height: size, rgba: out };
}

// ── reading the app's own master ────────────────────────────────────────────

/** The 1024 master every platform's mark comes from. */
export function splashMasterPath(appDir) {
  return join(appDir, 'assets', 'icon', 'app_icon_1024.png');
}

/** appDir → decoded master. Memoised: `assert-launcher-icons.mjs` and this
 *  file's own test both derive more than once per process, and decoding a
 *  4 MB RGBA buffer out of a 1024x1024 PNG in pure JS is the expensive half. */
const masterCache = new Map();

function readMaster(appDir) {
  if (masterCache.has(appDir)) return masterCache.get(appDir);
  const masterPath = splashMasterPath(appDir);
  if (!existsSync(masterPath)) {
    throw new SplashBrandUnavailable([
      `${masterPath} does not exist.`,
      'It is the SAME master the launcher icons are generated from, deliberately: a separate splash source',
      'image would be a second place the brand lives, and two copies of one fact is how the wrong one ships.',
    ]);
  }
  let decoded;
  try {
    decoded = decodeRgba(readFileSync(masterPath));
  } catch (e) {
    if (!(e instanceof PngUnreadable)) throw e;
    throw new SplashBrandUnavailable([`${masterPath} could not be decoded — ${e.lines[0]}`, ...e.lines.slice(1)]);
  }
  masterCache.set(appDir, decoded);
  return decoded;
}

/** The pixel size of the iOS 1x asset — the number the storyboard must declare. */
export const IOS_BASE_PX = SPLASH_POINT_SIZE;

/**
 * The launch-screen artefacts this generator owns for one app:
 * relative path → bytes.
 *
 * `platforms` narrows the result to the native folders an app actually ships,
 * so an iOS-only app is not told it is missing Android drawables. The caller
 * decides; this function does not look at the filesystem for that.
 */
export function deriveSplash(appDir, { ios = true, android = true } = {}) {
  const master = readMaster(appDir);
  // 🔴 ONE RESAMPLE PER DISTINCT SIZE, not one per file. iOS @1x/@2x/@3x and
  // Android mdpi/xhdpi/xxhdpi land on the SAME five pixel sizes (96, 144, 192,
  // 288, 384) — deriving each twice would double the cost of a limb that runs
  // once per app in CI and once per fixture in its own test file, for bytes that
  // are equal by construction. Memoised per call, so nothing survives into a
  // later invocation with a different master.
  const cache = new Map();
  const at = (size) => {
    if (!cache.has(size)) cache.set(size, encodeRgba(areaResample(master, size)));
    return cache.get(size);
  };
  const out = new Map();
  if (ios) {
    for (const { suffix, scale } of IOS_SCALES) {
      out.set(`${IOS_IMAGESET}/LaunchImage${suffix}.png`, at(SPLASH_POINT_SIZE * scale));
    }
    out.set(`${IOS_IMAGESET}/Contents.json`, Buffer.from(iosContentsJson(), 'utf8'));
  }
  if (android) {
    for (const [bucket, factor] of ANDROID_DENSITIES) {
      out.set(
        `${ANDROID_RES}/drawable-${bucket}/${ANDROID_DRAWABLE_NAME}.png`,
        at(Math.round(SPLASH_POINT_SIZE * factor)),
      );
    }
  }
  return out;
}

/**
 * The imageset's `Contents.json`, DERIVED from [IOS_SCALES] rather than left as
 * whatever Xcode last wrote.
 *
 * It is in the derivation because it is the file that says which PNG is which
 * scale. A catalogue naming a file that is not there compiles to an empty image
 * and the storyboard then renders nothing — the same blank screen, arrived at
 * from the other direction.
 */
export function iosContentsJson() {
  const images = IOS_SCALES.map(({ suffix, scale }) => ({
    idiom: 'universal',
    filename: `LaunchImage${suffix}.png`,
    scale: `${scale}x`,
  }));
  return `${JSON.stringify({ images, info: { version: 1, author: 'xcode' } }, null, 2)}\n`;
}

/**
 * The size a launch storyboard declares for `LaunchImage`, or `null`.
 *
 * 🔴 PARSED AS AN ATTRIBUTE ON THE NAMED RESOURCE, never grepped. A storyboard
 * is XML whose `<resources>` block can list several images, and a text search
 * for `width=` finds the first of them — which is how a check ends up asserting
 * something true about a file it is not looking at.
 */
export function readStoryboardImageSize(text, name = 'LaunchImage') {
  const el = new RegExp(`<image\\s[^>]*name="${name}"[^>]*/?>`).exec(text);
  if (!el) return null;
  const w = /\bwidth="(\d+(?:\.\d+)?)"/.exec(el[0]);
  const h = /\bheight="(\d+(?:\.\d+)?)"/.exec(el[0]);
  if (!w || !h) return null;
  return { width: Number(w[1]), height: Number(h[1]) };
}

/**
 * Does this `launch_background.xml` actually DRAW the splash drawable?
 *
 * 🔴 COMMENTS STRIPPED FIRST, AND THAT IS THE ENTIRE POINT. What `flutter
 * create` ships is a `<bitmap>` item inside an XML comment, above the words
 * "You can insert your own image assets here". Every bare text search for
 * `launch_image` or `<bitmap` matches the STOCK file and reports the splash as
 * wired — green over the exact defect. Android's resource compiler does not
 * read comments, so neither does this.
 */
export function backgroundDrawsSplash(text, name = ANDROID_DRAWABLE_NAME) {
  const code = stripXmlComments(text);
  return new RegExp(`android:src\\s*=\\s*"@(?:drawable|mipmap)/${name}"`).test(code);
}

/**
 * `text` with every XML comment gone, to a FIXPOINT, and truncated at any
 * comment that is never closed.
 *
 * 🔴 A LOOP RATHER THAN ONE GLOBAL `replace`, and CodeQL was right to say so
 * (js/incomplete-multi-character-sanitization, raised on this file 2026-09-09).
 * A single pass over a multi-character delimiter can leave a fresh one behind in
 * the text it has just joined up, so the only honest stopping condition is
 * "nothing changed".
 *
 * 🔴 AND AN UNCLOSED `<!--` TRUNCATES THE REST, which is the half a fixpoint
 * alone does not fix and the half that matters here. Left in place, a dangling
 * `<!--` would leave the `<bitmap>` after it looking like live markup to the
 * caller — reporting the splash as wired over a file the resource compiler
 * cannot even parse. Everything after an unterminated comment is comment as far
 * as any XML reader is concerned, so it is dropped.
 */
export function stripXmlComments(text) {
  let out = text;
  let prev;
  do {
    prev = out;
    out = out.replace(/<!--[\s\S]*?-->/, '');
  } while (out !== prev);
  const dangling = out.indexOf('<!--');
  return dangling === -1 ? out : out.slice(0, dangling);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Only when invoked directly — the guard imports the functions above, and a
// module that writes files on import would rewrite the tree it is checking.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const at = (n, d) => {
    const i = argv.indexOf(n);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
  };
  const app = at('--app', 'subscriptiontracker');
  const check = argv.includes('--check');
  const appDir = join(ROOT, 'apps', app);

  let derived;
  try {
    derived = deriveSplash(appDir, {
      ios: existsSync(join(appDir, 'ios')),
      android: existsSync(join(appDir, 'android')),
    });
  } catch (e) {
    if (!(e instanceof SplashBrandUnavailable)) throw e;
    console.error('render-splash: REFUSING');
    for (const l of e.lines) console.error(`  ${l}`);
    process.exit(1);
  }

  let drift = 0;
  for (const [rel, bytes] of derived) {
    const path = join(appDir, rel);
    // ONE read, not `existsSync` then `readFileSync` — CodeQL raised the
    // check-then-use race on this line (js/file-system-race, 2026-09-09), and
    // the fix is also the simpler code: whether the file is absent or is there
    // and unreadable, the answer this loop needs is the same one.
    let current = null;
    try {
      current = readFileSync(path);
    } catch {
      current = null;
    }
    const same = current !== null && current.equals(bytes);
    if (check) {
      if (!same) {
        drift++;
        console.error(`FAIL apps/${app}/${rel} — ${current !== null ? 'differs from' : 'is missing and would be'} the derivation`);
      }
      continue;
    }
    if (same) {
      console.log(`  = apps/${app}/${rel} (${bytes.length} bytes, unchanged)`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    console.log(`  → apps/${app}/${rel} (${bytes.length} bytes)`);
  }

  if (check && drift > 0) {
    console.error('');
    console.error(`render-splash: ${drift} artefact(s) are not what the master derives.`);
    console.error(`Regenerate with: node tooling/store/render-splash.mjs --app ${app}`);
    process.exit(1);
  }
  console.log(`render-splash: ok — ${derived.size} artefact(s)${check ? ' verified against the master' : ''}`);
  console.log(
    `  · the storyboard must declare width="${IOS_BASE_PX}" height="${IOS_BASE_PX}" for LaunchImage, and both ` +
      'launch_background.xml files must reference @drawable/' +
      `${ANDROID_DRAWABLE_NAME} OUTSIDE a comment. Those two are hand-edited once and then held by ` +
      'assert-launcher-icons.mjs limb 8 — this generator writes images, not XML it did not author.',
  );
}
