/**
 * Mandelbrot arithmetic, independent of the DOM.
 *
 * Navigation stores decimal coefficients as BigInts and a separate decimal
 * exponent. It never adds tiny camera movements to an IEEE-754 center. Deep
 * renders use a BigInt reference orbit and extended-exponent perturbation;
 * pixels with reference cancellation are recomputed with BigInt arithmetic.
 * There is no configured zoom limit. Finite memory, iteration budgets, and
 * computation time still limit any real device; more zoom does not itself
 * guarantee that a finite iteration budget will resolve new detail.
 */

const LN2 = Math.LN2;
const LOG2_10 = Math.LOG2E * Math.LN10;
const ZERO = Object.freeze({ coefficient: 0n, exponent: 0 });
// A radius well above 2 also avoids equality at the endpoint c=-2 when tiny
// perturbations are smaller than the double representation of its orbit.
export const ESCAPE_RADIUS_SQUARED = 256;

function normalizeDecimal(coefficient, exponent) {
  if (coefficient === 0n) return ZERO;
  while (coefficient % 10n === 0n) {
    coefficient /= 10n;
    exponent += 1;
  }
  return { coefficient, exponent };
}

export function parseDecimal(value) {
  const match = String(value).trim().match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || !(match[2] || match[3])) throw new TypeError('Invalid decimal coordinate');
  const exponent = Number(match[4] || 0) - (match[3] || '').length;
  if (!Number.isSafeInteger(exponent)) throw new RangeError('Coordinate exponent exceeds this runtime’s numeric range');
  return normalizeDecimal(BigInt(`${match[1]}${match[2] || '0'}${match[3] || ''}`), exponent);
}

export function decimalToString(decimal) {
  const { coefficient, exponent } = normalizeDecimal(decimal.coefficient, decimal.exponent);
  if (coefficient === 0n) return '0';
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString();
  const point = digits.length + exponent;
  const sign = negative ? '-' : '';
  if (point > 0 && point <= 24 && exponent >= 0) return sign + digits + '0'.repeat(exponent);
  if (point > 0 && point < digits.length && digits.length <= 80) return sign + digits.slice(0, point) + '.' + digits.slice(point);
  if (point <= 0 && point > -8 && digits.length <= 80) return sign + '0.' + '0'.repeat(-point) + digits;
  return `${sign}${digits[0]}${digits.length > 1 ? '.' + digits.slice(1) : ''}e${point - 1}`;
}

function power10(exponent) {
  if (!Number.isSafeInteger(exponent) || exponent < 0) throw new RangeError('Required decimal precision exceeds this runtime’s numeric range');
  return 10n ** BigInt(exponent);
}

function roundAt(decimal, exponent) {
  if (decimal.coefficient === 0n || decimal.exponent >= exponent) return decimal;
  const difference = exponent - decimal.exponent;
  const length = (decimal.coefficient < 0n ? -decimal.coefficient : decimal.coefficient).toString().length;
  if (difference > length) return ZERO;
  const divisor = power10(difference);
  const sign = decimal.coefficient < 0n ? -1n : 1n;
  return normalizeDecimal((decimal.coefficient + sign * (divisor / 2n)) / divisor, exponent);
}

function addDecimal(a, b, minimumExponent) {
  if (minimumExponent !== undefined) {
    a = roundAt(a, minimumExponent);
    b = roundAt(b, minimumExponent);
  }
  if (a.coefficient === 0n) return b;
  if (b.coefficient === 0n) return a;
  const exponent = Math.min(a.exponent, b.exponent);
  return normalizeDecimal(a.coefficient * power10(a.exponent - exponent) + b.coefficient * power10(b.exponent - exponent), exponent);
}

function multiplyNumber(decimal, value) {
  if (!Number.isFinite(value)) throw new RangeError('Movement must be finite');
  if (value === 0) return ZERO;
  const multiplier = parseDecimal(value.toPrecision(17));
  return normalizeDecimal(decimal.coefficient * multiplier.coefficient, decimal.exponent + multiplier.exponent);
}

export function spanDecimal(logZoom) {
  if (!Number.isFinite(logZoom)) throw new RangeError('Zoom must be finite');
  const whole = Math.floor(logZoom);
  const fraction = logZoom - whole;
  const mantissa = parseDecimal((3.6 * Math.pow(10, -fraction)).toPrecision(17));
  return { coefficient: mantissa.coefficient, exponent: mantissa.exponent - whole };
}

function validateView(view) {
  if (!view || !Number.isFinite(view.logZoom)) throw new TypeError('Invalid view');
  parseDecimal(view.cx);
  parseDecimal(view.cy);
}

export function createView() {
  return { cx: '-0.5', cy: '0', logZoom: 0 };
}

/** factor > 1 zooms in. px/py are viewport fractions, with +py downward. */
export function zoomView(view, factor, px = 0, py = 0, aspect = 1) {
  validateView(view);
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(aspect) || aspect <= 0) throw new RangeError('Invalid zoom factor or aspect ratio');
  const logZoom = view.logZoom + Math.log10(factor);
  if (!Number.isFinite(logZoom)) throw new RangeError('Zoom exceeds this runtime’s numeric range');
  if (px === 0 && py === 0) return { ...view, logZoom };
  const movement = multiplyNumber(spanDecimal(view.logZoom), 1 - 1 / factor);
  const exponent = -Math.ceil(Math.max(view.logZoom, logZoom)) - 32;
  return {
    cx: decimalToString(addDecimal(parseDecimal(view.cx), multiplyNumber(movement, px * aspect), exponent)),
    cy: decimalToString(addDecimal(parseDecimal(view.cy), multiplyNumber(movement, -py), exponent)),
    logZoom,
  };
}

/** dx/dy are drag distances divided by viewport width/height. */
export function panView(view, dx, dy, aspect = 1) {
  validateView(view);
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError('Invalid aspect ratio');
  if (dx === 0 && dy === 0) return { ...view };
  const span = spanDecimal(view.logZoom);
  const exponent = -Math.ceil(view.logZoom) - 32;
  return {
    cx: decimalToString(addDecimal(parseDecimal(view.cx), multiplyNumber(span, -dx * aspect), exponent)),
    cy: decimalToString(addDecimal(parseDecimal(view.cy), multiplyNumber(span, dy), exponent)),
    logZoom: view.logZoom,
  };
}

const DESTINATIONS = [
  ['-0.75', '0.1', 0.7],
  ['-0.7435', '0.1314', 2.8],
  ['-0.743643887037151', '0.131825904205330', 7.2],
  ['-0.1011', '0.9563', 2.4],
  ['-0.7453', '0.1127', 2.7],
  ['-0.16', '1.0405', 2.5],
  ['-1.25066', '0.02012', 2.8],
  ['-0.39054', '-0.58679', 2.6],
  ['-0.15652', '1.03225', 2.4],
  ['-1.768778833', '0.001738996', 5.7],
];

/** Randomized landmarks keep starts near the boundary instead of empty space. */
export function randomView(random = Math.random) {
  const choice = DESTINATIONS[Math.min(DESTINATIONS.length - 1, Math.floor(random() * DESTINATIONS.length))];
  const cy = random() < 0.5 ? choice[1] : decimalToString(multiplyNumber(parseDecimal(choice[1]), -1));
  const view = { cx: choice[0], cy, logZoom: choice[2] + (random() - 0.5) * 0.4 };
  return panView(view, (random() - 0.5) * 0.025, (random() - 0.5) * 0.025, 1);
}

export function serializeView(view) {
  validateView(view);
  return JSON.stringify({ cx: String(view.cx), cy: String(view.cy), logZoom: view.logZoom });
}

function insideKnownComponent(cx, cy) {
  const x = cx - 0.25;
  const y2 = cy * cy;
  const q = x * x + y2;
  return q * (q + x) < 0.25 * y2 || (cx + 1) * (cx + 1) + y2 < 0.0625;
}

function smoothEscape(iterations, normSquared) {
  const value = iterations + 1 - Math.log(Math.log(Math.sqrt(normSquared))) / LN2;
  return value === 0 ? Number.EPSILON : value;
}

/** A zero result means unresolved at this iteration budget, not proven inside. */
export function escapeDouble(cx, cy, maxIterations = 600) {
  if (insideKnownComponent(cx, cy)) return 0;
  let zr = 0;
  let zi = 0;
  for (let n = 1; n <= maxIterations; n++) {
    const nextR = zr * zr - zi * zi + cx;
    zi = 2 * zr * zi + cy;
    zr = nextR;
    const norm = zr * zr + zi * zi;
    if (norm > ESCAPE_RADIUS_SQUARED) return smoothEscape(n, norm);
  }
  return 0;
}

export function decimalToFixed(value, digits) {
  const decimal = typeof value === 'object' ? value : parseDecimal(value);
  const shift = decimal.exponent + digits;
  if (shift >= 0) return decimal.coefficient * power10(shift);
  const length = (decimal.coefficient < 0n ? -decimal.coefficient : decimal.coefficient).toString().length;
  if (-shift > length) return 0n;
  return decimal.coefficient / power10(-shift);
}

function fixedToNumber(value, digits) {
  if (value === 0n) return 0;
  const negative = value < 0n;
  const text = (negative ? -value : value).toString();
  return (negative ? -1 : 1) * Number(`${text[0]}.${text.slice(1, 17)}e${text.length - digits - 1}`);
}

function fixedKnownInterior(cx, cy, scale) {
  const y2 = cy * cy;
  const scale2 = scale * scale;
  if (16n * ((cx + scale) * (cx + scale) + y2) < scale2) return true;
  const x = cx - scale / 4n;
  const q = x * x + y2;
  return 4n * q * (q + x * scale) < y2 * scale2;
}

export function escapeFixed(cx, cy, digits = 60, maxIterations = 600, existingScale) {
  const scale = existingScale || power10(digits);
  cx = typeof cx === 'bigint' ? cx : decimalToFixed(cx, digits);
  cy = typeof cy === 'bigint' ? cy : decimalToFixed(cy, digits);
  if (fixedKnownInterior(cx, cy, scale)) return 0;
  const escapeThreshold = 256n * scale * scale;
  let zr = 0n;
  let zi = 0n;
  for (let n = 1; n <= maxIterations; n++) {
    const nextR = (zr * zr - zi * zi) / scale + cx;
    zi = (2n * zr * zi) / scale + cy;
    zr = nextR;
    if (zr * zr + zi * zi > escapeThreshold) {
      const dr = fixedToNumber(zr, digits);
      const di = fixedToNumber(zi, digits);
      return smoothEscape(n, dr * dr + di * di);
    }
  }
  return 0;
}

export function createReferenceOrbit(view, maxIterations) {
  const digits = Math.max(40, Math.ceil(view.logZoom) + 32);
  const scale = power10(digits);
  const cx = decimalToFixed(view.cx, digits);
  const cy = decimalToFixed(view.cy, digits);
  const span = decimalToFixed(spanDecimal(view.logZoom), digits);
  const real = new Float64Array(maxIterations + 1);
  const imaginary = new Float64Array(maxIterations + 1);
  let zr = 0n;
  let zi = 0n;
  let length = 1;
  for (let n = 1; n <= maxIterations; n++) {
    const nextR = (zr * zr - zi * zi) / scale + cx;
    zi = (2n * zr * zi) / scale + cy;
    zr = nextR;
    real[n] = fixedToNumber(zr, digits);
    imaginary[n] = fixedToNumber(zi, digits);
    length = n + 1;
    if (real[n] * real[n] + imaginary[n] * imaginary[n] > 65536) break;
  }
  const binaryLog = -view.logZoom * LOG2_10;
  const exponent = Math.floor(binaryLog);
  return { digits, scale, cx, cy, span, real, imaginary, length, exponent, mantissa: 3.6 * Math.pow(2, binaryLog - exponent) };
}

/**
 * Delta = (dr + i*di) * 2^exponent. The separate exponent allows pixel
 * differences far smaller than Number.MIN_VALUE, without converting the
 * absolute high-precision center to a double.
 * null requests a direct BigInt recomputation for an unstable pixel.
 */
export function escapePerturbed(reference, offsetX, offsetY, maxIterations) {
  const cr = offsetX * reference.mantissa;
  const ci = offsetY * reference.mantissa;
  let dr = 0;
  let di = 0;
  let exponent = reference.exponent;
  let deltaScale = exponent < -1074 ? 0 : Math.pow(2, exponent);
  let cScale = 1;
  for (let n = 0; n < maxIterations; n++) {
    if (n + 1 >= reference.length) return null;
    if (exponent < reference.exponent) {
      const factor = Math.pow(2, exponent - reference.exponent);
      dr *= factor;
      di *= factor;
      exponent = reference.exponent;
      deltaScale = exponent < -1074 ? 0 : Math.pow(2, exponent);
      cScale = 1;
    }
    const rr = reference.real[n];
    const ri = reference.imaginary[n];
    const nextR = 2 * (rr * dr - ri * di) + deltaScale * (dr * dr - di * di) + cr * cScale;
    di = 2 * (rr * di + ri * dr) + deltaScale * 2 * dr * di + ci * cScale;
    dr = nextR;
    const largest = Math.max(Math.abs(dr), Math.abs(di));
    if (!Number.isFinite(largest)) return null;
    if (largest !== 0 && (largest > 1e30 || largest < 1e-30)) {
      const shift = Math.floor(Math.log2(largest));
      const factor = Math.pow(2, shift);
      dr /= factor;
      di /= factor;
      exponent += shift;
      deltaScale = exponent < -1074 ? 0 : Math.pow(2, exponent);
      cScale = Math.pow(2, reference.exponent - exponent);
    }
    const nr = reference.real[n + 1];
    const ni = reference.imaginary[n + 1];
    const zr = nr + dr * deltaScale;
    const zi = ni + di * deltaScale;
    const norm = zr * zr + zi * zi;
    const referenceNorm = nr * nr + ni * ni;
    if (!Number.isFinite(norm) || (referenceNorm > 0 && norm < 1e-8 * referenceNorm)) return null;
    if (norm > ESCAPE_RADIUS_SQUARED) return smoothEscape(n + 1, norm);
  }
  return 0;
}

export const PALETTES = {
  aurora: [[7, 11, 25], [24, 41, 83], [43, 86, 159], [91, 76, 193], [42, 181, 202], [174, 247, 222], [255, 213, 149], [97, 69, 148]],
  ember: [[14, 8, 21], [61, 18, 45], [133, 31, 57], [220, 70, 45], [251, 159, 62], [255, 235, 166], [137, 57, 59]],
  ocean: [[3, 11, 29], [9, 44, 87], [10, 104, 155], [30, 183, 190], [176, 245, 224], [68, 140, 200]],
  mono: [[7, 10, 16], [75, 89, 108], [179, 193, 209], [242, 247, 249], [88, 105, 127]],
};

function colorPixel(pixels, offset, escape, palette) {
  if (escape === 0) {
    pixels[offset] = 3;
    pixels[offset + 1] = 5;
    pixels[offset + 2] = 12;
  } else {
    const position = ((escape * 0.037) % palette.length + palette.length) % palette.length;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = palette[index];
    const b = palette[(index + 1) % palette.length];
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(a[channel] + (b[channel] - a[channel]) * fraction);
  }
  pixels[offset + 3] = 255;
}

function decimalLogAbs(decimal) {
  if (decimal.coefficient === 0n) return -Infinity;
  const text = (decimal.coefficient < 0n ? -decimal.coefficient : decimal.coefficient).toString();
  const lead = Number(text.slice(0, 16)) / Math.pow(10, Math.min(16, text.length) - 1);
  return Math.log10(lead) + text.length - 1 + decimal.exponent;
}

function ratioToSpan(decimal, logSpan) {
  if (decimal.coefficient === 0n) return 0;
  return (decimal.coefficient < 0n ? -1 : 1) * Math.pow(10, decimalLogAbs(decimal) - logSpan);
}

function logHypotDecimal(cx, cy) {
  const realLog = decimalLogAbs(cx);
  const imaginaryLog = decimalLogAbs(cy);
  const larger = Math.max(realLog, imaginaryLog);
  if (larger === -Infinity) return -Infinity;
  return larger + Math.log10(Math.hypot(Math.pow(10, realLog - larger), Math.pow(10, imaginaryLog - larger)));
}

function wideEscape(view, normalizedCx, normalizedCy, logSpan, centerLogMagnitude, x, y, maxIterations) {
  const norm = Math.hypot(normalizedCx + x, normalizedCy + y);
  if (Number.isFinite(norm) && norm > 1e-12) {
    const logMagnitude = (logSpan + Math.log10(norm)) * Math.LN10;
    if (logMagnitude > Math.log(16)) return 2 - Math.log(logMagnitude) / LN2;
  } else if (!Number.isFinite(norm)) {
    // The center overwhelms the viewport by >308 orders of magnitude; every
    // pixel has the same resolvable exterior color, with no huge BigInt sum.
    return 2 - Math.log(centerLogMagnitude * Math.LN10) / LN2;
  }
  // Extremely distant centers, or the one pixel where large terms cancel,
  // need decimal addition. This path avoids Infinity - Infinity and NaNs.
  const span = spanDecimal(view.logZoom);
  const cx = addDecimal(parseDecimal(view.cx), multiplyNumber(span, x));
  const cy = addDecimal(parseDecimal(view.cy), multiplyNumber(span, y));
  const logMagnitude = logHypotDecimal(cx, cy);
  if (logMagnitude > 150) return 2 - Math.log(logMagnitude * Math.LN10) / LN2;
  return escapeDouble(Number(decimalToString(cx)), Number(decimalToString(cy)), maxIterations);
}

/** Synchronous inside a disposable Worker; progress carries no image copy. */
export function renderMandelbrot({ width, height, view, maxIterations = 600, palette = 'aurora' }, onProgress = () => {}) {
  validateView(view);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16777216) throw new RangeError('Invalid render dimensions');
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw new RangeError('Invalid iteration budget');
  const pixels = new Uint8ClampedArray(width * height * 4);
  const colors = PALETTES[palette] || PALETTES.aurora;
  const span = 3.6 * Math.pow(10, -view.logZoom);
  const cx = Number(view.cx);
  const cy = Number(view.cy);
  const wide = !Number.isFinite(span) || !Number.isFinite(cx) || !Number.isFinite(cy) || Math.max(Math.abs(cx), Math.abs(cy), span) > 1e140;
  const deep = !wide && view.logZoom > 10;
  const backend = deep ? 'bigint' : 'double';
  const reference = deep ? createReferenceOrbit(view, maxIterations) : null;
  const precisionDigits = reference ? reference.digits : 16;
  const logSpan = Math.log10(3.6) - view.logZoom;
  const normalizedCx = wide ? ratioToSpan(parseDecimal(view.cx), logSpan) : 0;
  const normalizedCy = wide ? ratioToSpan(parseDecimal(view.cy), logSpan) : 0;
  const centerLogMagnitude = wide ? logHypotDecimal(parseDecimal(view.cx), parseDecimal(view.cy)) : 0;
  let fallbackPixels = 0;
  const denominator = BigInt(2 * height);
  onProgress({ progress: 0, backend, precisionDigits });
  for (let y = 0; y < height; y++) {
    const offsetY = (height - 2 * y - 1) / (2 * height);
    const imaginary = cy + offsetY * span;
    for (let x = 0; x < width; x++) {
      const offsetX = (2 * x + 1 - width) / (2 * height);
      let escaped;
      if (wide) {
        escaped = wideEscape(view, normalizedCx, normalizedCy, logSpan, centerLogMagnitude, offsetX, offsetY, maxIterations);
      } else if (reference) {
        escaped = escapePerturbed(reference, offsetX, offsetY, maxIterations);
        if (escaped === null) {
          fallbackPixels++;
          const real = reference.cx + reference.span * BigInt(2 * x + 1 - width) / denominator;
          const imaginaryFixed = reference.cy + reference.span * BigInt(height - 2 * y - 1) / denominator;
          escaped = escapeFixed(real, imaginaryFixed, reference.digits, maxIterations, reference.scale);
        }
      } else {
        escaped = escapeDouble(cx + offsetX * span, imaginary, maxIterations);
      }
      colorPixel(pixels, (y * width + x) * 4, escaped, colors);
    }
    if ((y & 15) === 15 || y + 1 === height) onProgress({ progress: (y + 1) / height, backend, precisionDigits });
  }
  return { pixels: pixels.buffer, width, height, backend, precisionDigits, fallbackPixels };
}
