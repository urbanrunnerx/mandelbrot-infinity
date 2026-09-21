import assert from 'node:assert/strict';
import { createView, zoomView, panView, randomView, serializeView, parseDecimal, decimalToString, decimalToFixed, spanDecimal, escapeDouble, escapeFixed, createReferenceOrbit, escapePerturbed, renderMandelbrot } from '../math.js';

const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

// Known interior components and unambiguous exterior points agree across both
// independent escape-time implementations.
for (const [cx, cy] of [[0, 0], [-1, 0], [-0.2, 0.2]]) {
  assert.equal(escapeDouble(cx, cy, 1000), 0);
  assert.equal(escapeFixed(String(cx), String(cy), 80, 1000), 0);
}
for (const [cx, cy] of [[1, 0], [0, 1.5], [-2, 0.1], [-0.75, 0.1], [-0.1011, 0.9563]]) {
  near(escapeDouble(cx, cy, 1000), escapeFixed(String(cx), String(cy), 80, 1000), 1e-7);
}

// Zoom keeps the point under the pointer stationary; pan follows the screen
// orientation and camera helpers never mutate their input.
const initial = createView();
const zoomed = zoomView(initial, 2, 0.25, -0.2, 1.5);
near(Number(zoomed.cx) + 0.25 * 1.5 * 1.8, -0.5 + 0.25 * 1.5 * 3.6);
near(Number(zoomed.cy) - (-0.2) * 1.8, -(-0.2) * 3.6);
assert.deepEqual(initial, createView());
const panned = panView(initial, 0.1, 0.2, 2);
near(Number(panned.cx), -1.22);
near(Number(panned.cy), 0.72);

// A movement 1,000 decimal places down changes the exact center even though
// an IEEE-754 representation sees no difference. Reversing it recovers center.
const deep = { cx: '-0.743643887037151', cy: '0.131825904205330', logZoom: 1000 };
const tinyPan = panView(deep, 0.25, -0.125, 1);
assert.notEqual(tinyPan.cx, deep.cx);
assert.equal(Number(tinyPan.cx), Number(deep.cx));
assert.ok(tinyPan.cx.length > 1000);
const reversed = panView(tinyPan, -0.25, 0.125, 1);
assert.equal(decimalToFixed(reversed.cx, 1032), decimalToFixed(deep.cx, 1032));
assert.equal(decimalToFixed(reversed.cy, 1032), decimalToFixed(deep.cy, 1032));
assert.equal(zoomView(deep, 100).logZoom, 1002);
assert.equal(zoomView({ ...deep, logZoom: -1000 }, 0.01).logZoom, -1002);
assert.deepEqual(JSON.parse(serializeView(deep)), deep);
for (const text of ['0', '-0.125', '1e-1200', '-12345678901234567890.0000000000001']) {
  assert.deepEqual(parseDecimal(decimalToString(parseDecimal(text))), parseDecimal(text));
}
assert.ok(decimalToFixed(spanDecimal(1000), 1032) > 0n);

// Perturbation matches independent BigInt iterations across a boundary. This
// exercises nearby coordinates that are too close for ordinary double centers.
let comparedExterior = 0;
let comparedUnresolved = 0;
for (const logZoom of [10.1, 11, 12, 13]) {
  const referenceView = { cx: '-0.743643887037151', cy: '0.131825904205330', logZoom };
  const reference = createReferenceOrbit(referenceView, 2500);
  for (let y = -3; y <= 3; y++) {
    for (let x = -3; x <= 3; x++) {
      const dx = x / 8;
      const dy = y / 8;
      const actual = escapePerturbed(reference, dx, dy, 2500);
      const expected = escapeFixed(reference.cx + reference.span * BigInt(x) / 8n, reference.cy + reference.span * BigInt(y) / 8n, reference.digits, 2500, reference.scale);
      if (actual !== null) {
        assert.equal(actual === 0, expected === 0, 'resolved/unresolved classification matches');
        near(actual, expected, 0.05);
        if (expected === 0) comparedUnresolved++;
        else comparedExterior++;
      }
    }
  }
}
assert.ok(comparedExterior > 100, 'comparison covers escaped boundary pixels');
assert.ok(comparedUnresolved > 5, 'comparison also covers unresolved boundary pixels');

// A scale below Number.MIN_VALUE remains representable in the perturbation
// engine. The orbit may remain unresolved at this finite iteration budget.
const enormousReference = createReferenceOrbit({ cx: '-2', cy: '0', logZoom: 1000 }, 100);
assert.ok(enormousReference.exponent < -1074);
assert.equal(escapePerturbed(enormousReference, 0, 0, 100), 0);
const endpointReference = createReferenceOrbit({ cx: '-2', cy: '0', logZoom: 1000 }, 2000);
for (const direction of [-1, 1]) {
  const actual = escapePerturbed(endpointReference, direction / 4, 0, 2000);
  const expected = escapeFixed(endpointReference.cx + endpointReference.span * BigInt(direction) / 4n, endpointReference.cy, endpointReference.digits, 2000, endpointReference.scale);
  assert.notEqual(actual, null);
  near(actual, expected, 1e-7);
  if (direction === -1) assert.ok(actual > 1600, 'exterior point 1,000 decimal places beyond -2 resolves');
  else assert.equal(actual, 0, 'real point just inside -2 remains bounded');
}

const frame = renderMandelbrot({ width: 48, height: 32, view: initial, maxIterations: 150 });
assert.equal(frame.pixels.byteLength, 48 * 32 * 4);
assert.equal(frame.backend, 'double');
assert.ok(new Set(new Uint8Array(frame.pixels)).size > 20);
for (const logZoom of [-400, -1000, 1000]) {
  const wide = renderMandelbrot({ width: 7, height: 7, view: { ...deep, logZoom }, maxIterations: 60 });
  const data = new Uint8Array(wide.pixels);
  assert.equal(data.length, 196);
  for (let n = 3; n < data.length; n += 4) assert.equal(data[n], 255);
}
const farFrame = renderMandelbrot({ width: 12, height: 12, view: { cx: '1e1000', cy: '-2e999', logZoom: 1000 }, maxIterations: 60 });
const farPixels = new Uint8Array(farFrame.pixels);
assert.ok(farPixels[0] + farPixels[1] + farPixels[2] > 0, 'far exterior is colored, not NaN black');
for (let n = 0; n < farPixels.length; n += 4) assert.equal(farPixels[n], farPixels[0]);
const randomized = randomView(() => 0.42);
assert.ok(Number.isFinite(randomized.logZoom));
assert.doesNotThrow(() => parseDecimal(randomized.cx));
// Every nominal random destination has visible structure at a useful budget.
for (let index = 0; index < 10; index++) {
  const values = [(index + 0.1) / 10, 0.1, 0.5, 0.5, 0.5];
  const view = randomView(() => values.shift() ?? 0.5);
  const sample = renderMandelbrot({ width: 32, height: 24, view, maxIterations: 1600 });
  assert.ok(new Set(new Uint8Array(sample.pixels)).size > 12, `random landmark ${index} has detail`);
}
assert.throws(() => zoomView(initial, 0), /Invalid/);
assert.throws(() => parseDecimal('NaN'), /Invalid/);

console.log('Mandelbrot math: exact navigation, escape times, perturbation, and extreme-scale renders passed.');
