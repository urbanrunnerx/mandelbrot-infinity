import { createView, zoomView, panView, randomView } from './math.js';
import { GpuPreview } from './gpu-preview.js';

const $ = id => document.getElementById(id);
const canvas = $('fractal');
const surface = $('canvas-wrap');
const context = canvas.getContext('2d', { alpha: false });
const gpuCanvas = $('gpu-fractal');
let gpuPreview = null;
try { gpuPreview = new GpuPreview(gpuCanvas); } catch { /* The worker also supports devices without WebGL. */ }
const preferencesKey = 'mandelbrot-infinity-preferences-v1';
const iterations = [128, 256, 512, 1024, 2048, 4096, 8192, 16384];
let preferences = { palette: 'aurora', detail: 3, randomStart: false };
try {
  const saved = JSON.parse(localStorage.getItem(preferencesKey) || '{}');
  if (['aurora', 'ember', 'ocean', 'mono'].includes(saved.palette)) preferences.palette = saved.palette;
  if (Number.isInteger(saved.detail) && saved.detail >= 0 && saved.detail < iterations.length) preferences.detail = saved.detail;
  preferences.randomStart = saved.randomStart === true;
} catch { /* Storage can be unavailable in private or embedded browsing. */ }

let view = preferences.randomStart ? randomView() : createView();
let revision = 0;
let worker = null;
let renderTimer = null;
let refinementTimer = null;
let imageTransform = { scale: 1, x: 0, y: 0 };
let interacted = false;
let holding = null;
let lastTap = null;
let resizeTimer = null;
let currentRender = null;
let previewActive = false;
let previewAnimation = null;
const pointers = new Map();
const viewport = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });

function savePreferences() {
  try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch { /* Optional persistence. */ }
}

function coordinateLabel(value) {
  const string = String(value);
  if (string.length <= 22) return string.replace('-', '−');
  return `${string.slice(0, 20).replace('-', '−')}…`;
}

function updateReadout() {
  const zoom = view.logZoom;
  let zoomText;
  if (zoom >= -2 && zoom < 6) {
    const amount = Math.pow(10, zoom);
    zoomText = amount >= 100 ? Math.round(amount).toLocaleString() : amount.toLocaleString(undefined, { maximumFractionDigits: amount < 1 ? 3 : 2 });
  } else {
    const exponent = Math.floor(zoom);
    const mantissa = Math.pow(10, zoom - exponent);
    zoomText = `${mantissa.toFixed(2)}e${exponent < 0 ? '−' : '+'}${Math.abs(exponent).toLocaleString()}`;
  }
  $('zoom-number').textContent = zoomText;
  $('real-coordinate').textContent = coordinateLabel(view.cx);
  $('imag-coordinate').textContent = coordinateLabel(view.cy);
  $('real-coordinate').title = view.cx;
  $('imag-coordinate').title = view.cy;
}

function setStatus(text, state = 'idle', progress = null) {
  $('status-text').textContent = text;
  $('status-dot').className = `status-dot${state === 'idle' ? '' : ` ${state}`}`;
  $('progress-bar').style.opacity = state === 'busy' ? '1' : '0';
  if (progress !== null) $('progress-bar').style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
}

function applyImageTransform() {
  if (previewAnimation !== null) return;
  previewAnimation = requestAnimationFrame(() => {
    previewAnimation = null;
    const { scale, x, y } = imageTransform;
    const safe = Number.isFinite(scale) && Number.isFinite(x) && Number.isFinite(y) && scale > 1e-8 && scale < 1e8;
    canvas.style.transform = safe ? `matrix(${scale}, 0, 0, ${scale}, ${x}, ${y})` : 'none';
    canvas.style.visibility = safe ? 'visible' : 'hidden';
    if (previewActive && gpuPreview) {
      gpuCanvas.hidden = false;
      try { gpuCanvas.hidden = !gpuPreview.draw(view, preferences.palette, Math.min(iterations[preferences.detail], 512)); }
      catch { gpuCanvas.hidden = true; }
    } else gpuCanvas.hidden = true;
  });
}

function markInteraction() {
  if (!interacted) {
    interacted = true;
    $('gesture-hint').style.opacity = '0';
  }
}

function cancelRender() {
  clearTimeout(renderTimer);
  clearTimeout(refinementTimer);
  worker?.terminate();
  worker = null;
  currentRender = null;
}

function scheduleRender(delay = 110) {
  revision++;
  cancelRender();
  updateReadout();
  previewActive = true;
  applyImageTransform();
  setStatus('Exploring…', 'busy', 0);
  renderTimer = setTimeout(() => beginRender(false), delay);
}

function renderDimensions(refined) {
  const { width, height } = viewport();
  const deep = view.logZoom > 10;
  const close = view.logZoom > 5;
  const baseline = deep ? (refined ? 120000 : 20000) : close ? (refined ? 300000 : 60000) : (refined ? 1050000 : 170000);
  const detailScale = Math.min(1, Math.sqrt(512 / iterations[preferences.detail]));
  const pixels = Math.max(refined ? 24000 : 6000, baseline * detailScale);
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(deviceScale, Math.sqrt(pixels / Math.max(1, width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function beginRender(refined) {
  const id = revision;
  const dimensions = renderDimensions(refined);
  currentRender = { id, refined, startedAt: performance.now() };
  setStatus(refined ? 'Refining detail…' : 'Finding the boundary…', 'busy', 0);
  try {
    worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      const data = event.data;
      if (data.id !== revision || data.id !== id || !currentRender) return;
      if (data.error) {
        handleRenderError(data.error);
        return;
      }
      if (!data.done) {
        if (data.progress !== undefined) {
          const duration = (performance.now() - currentRender.startedAt) / 1000;
          let label = refined ? 'Refining' : 'Rendering';
          if (data.backend === 'bigint') label = 'Deep precision';
          setStatus(`${label} · ${Math.round(data.progress * 100)}%${duration > 15 ? ' · please wait' : ''}`, 'busy', data.progress);
        }
        return;
      }
      if (!data.pixels) return;
      canvas.width = data.width;
      canvas.height = data.height;
      context.putImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0);
      imageTransform = { scale: 1, x: 0, y: 0 };
      previewActive = false;
      gpuCanvas.hidden = true;
      applyImageTransform();
      worker?.terminate();
      worker = null;
      const deep = data.backend === 'bigint';
      if (!refined) {
        setStatus('Preview ready', 'busy', 1);
        refinementTimer = setTimeout(() => { if (revision === id) beginRender(true); }, 140);
      } else {
        const seconds = Math.max(0.1, (data.elapsedMs || performance.now() - currentRender.startedAt) / 1000);
        setStatus(deep ? `${data.precisionDigits || 'Deep'} digit precision` : `Rendered · ${seconds.toFixed(1)}s`);
      }
    };
    worker.onerror = event => {
      if (id !== revision) return;
      event.preventDefault();
      handleRenderError(event.message || 'Rendering could not finish.');
    };
    worker.postMessage({ id, ...dimensions, view, maxIterations: iterations[preferences.detail], palette: preferences.palette });
  } catch (error) {
    handleRenderError(error.message);
  }
}

function handleRenderError(message) {
  worker?.terminate();
  worker = null;
  setStatus('Try less detail or Home', 'error');
  $('status-text').title = String(message);
  console.error('Mandelbrot renderer:', message);
}

function zoom(factor, clientX = canvas.clientWidth / 2, clientY = canvas.clientHeight / 2) {
  if (!Number.isFinite(factor) || factor <= 0) return;
  const { width, height } = viewport();
  const x = clientX - width / 2;
  const y = clientY - height / 2;
  try {
    view = zoomView(view, factor, x / width, y / height, width / height);
  } catch (error) { handleRenderError(error.message); return; }
  imageTransform.x = factor * imageTransform.x + (1 - factor) * x;
  imageTransform.y = factor * imageTransform.y + (1 - factor) * y;
  imageTransform.scale *= factor;
  applyImageTransform();
  markInteraction();
  $('location-name').textContent = 'Following the boundary';
  scheduleRender();
}

function pan(dx, dy) {
  const { width, height } = viewport();
  try { view = panView(view, dx / width, dy / height, width / height); }
  catch (error) { handleRenderError(error.message); return; }
  imageTransform.x += dx;
  imageTransform.y += dy;
  applyImageTransform();
  markInteraction();
  scheduleRender();
}

function goToView(nextView, name) {
  stopHolding();
  view = nextView;
  imageTransform = { scale: 1, x: 0, y: 0 };
  applyImageTransform();
  context.fillStyle = '#080d12';
  context.fillRect(0, 0, canvas.width, canvas.height);
  $('location-name').textContent = name;
  markInteraction();
  scheduleRender(0);
}

function goHome() { goToView(createView(), 'The Mandelbrot set'); }
function goRandom() { goToView(randomView(), 'A new place to get lost'); }

surface.addEventListener('wheel', event => {
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
  zoom(Math.exp(-Math.max(-180, Math.min(180, event.deltaY * unit)) * .0035), event.clientX, event.clientY);
}, { passive: false });

function pointerGeometry() {
  const [a, b] = [...pointers.values()];
  if (!a) return null;
  if (!b) return { x: a.x, y: a.y, distance: 0 };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}

surface.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  canvas.focus({ preventScroll: true });
  surface.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, startTime: performance.now(), moved: false });
});

surface.addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  const before = pointerGeometry();
  const point = pointers.get(event.pointerId);
  point.x = event.clientX;
  point.y = event.clientY;
  if (Math.hypot(point.x - point.startX, point.y - point.startY) > 5) point.moved = true;
  const after = pointerGeometry();
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  if (dx || dy) pan(dx, dy);
  if (before.distance > 4 && after.distance > 4) zoom(after.distance / before.distance, after.x, after.y);
});

function endPointer(event) {
  const point = pointers.get(event.pointerId);
  const isTap = event.type === 'pointerup' && point && !point.moved && pointers.size === 1 && performance.now() - point.startTime < 280;
  pointers.delete(event.pointerId);
  if (isTap) {
    const now = performance.now();
    if (lastTap && now - lastTap.time < 350 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 28) {
      zoom(2.5, event.clientX, event.clientY);
      lastTap = null;
    } else lastTap = { time: now, x: event.clientX, y: event.clientY };
  } else lastTap = null;
  if (!pointers.size && point?.moved) scheduleRender(30);
}
surface.addEventListener('pointerup', endPointer);
surface.addEventListener('pointercancel', endPointer);
surface.addEventListener('lostpointercapture', event => { pointers.delete(event.pointerId); });
surface.addEventListener('contextmenu', event => event.preventDefault());

function stopHolding() {
  if (!holding) return;
  clearTimeout(holding.delay);
  cancelAnimationFrame(holding.animation);
  holding = null;
  scheduleRender(30);
}

function bindZoomButton(id, direction) {
  const button = $(id);
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopHolding();
    button.setPointerCapture(event.pointerId);
    zoom(Math.pow(1.7, direction));
    const hold = { delay: null, animation: null, lastTime: 0 };
    holding = hold;
    hold.delay = setTimeout(() => {
      hold.lastTime = performance.now();
      const tick = now => {
        if (holding !== hold) return;
        const elapsed = Math.min(50, Math.max(0, now - hold.lastTime));
        hold.lastTime = now;
        if (elapsed > 0) zoom(Math.exp(direction * Math.log(1.14) * elapsed / 65));
        hold.animation = requestAnimationFrame(tick);
      };
      hold.animation = requestAnimationFrame(tick);
    }, 300);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, stopHolding);
  button.addEventListener('click', event => { if (event.detail === 0) zoom(Math.pow(1.7, direction)); });
}
bindZoomButton('zoom-in', 1);
bindZoomButton('zoom-out', -1);
$('home').addEventListener('click', goHome);
$('brand-home').addEventListener('click', event => { event.preventDefault(); goHome(); });
$('random').addEventListener('click', goRandom);

function showSettings(open) {
  $('settings-panel').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('gesture-hint').style.opacity = '0';
}
$('settings-toggle').addEventListener('click', () => showSettings($('settings-panel').hidden));
$('settings-close').addEventListener('click', () => { showSettings(false); $('settings-toggle').focus(); });
document.addEventListener('pointerdown', event => {
  if (!$('settings-panel').hidden && !$('settings-panel').contains(event.target) && !$('settings-toggle').contains(event.target)) showSettings(false);
});

function syncPreferences() {
  document.querySelectorAll('[data-palette]').forEach(button => {
    const selected = button.dataset.palette === preferences.palette;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    if (selected) $('palette-name').textContent = button.textContent;
  });
  $('detail').value = preferences.detail;
  $('detail-value').value = iterations[preferences.detail].toLocaleString();
  $('random-start').checked = preferences.randomStart;
}
document.querySelectorAll('[data-palette]').forEach(button => button.addEventListener('click', () => {
  preferences.palette = button.dataset.palette;
  savePreferences();
  syncPreferences();
  scheduleRender(0);
}));
$('detail').addEventListener('input', event => {
  preferences.detail = Number(event.target.value);
  $('detail-value').value = iterations[preferences.detail].toLocaleString();
});
$('detail').addEventListener('change', () => { savePreferences(); scheduleRender(0); });
$('random-start').addEventListener('change', event => { preferences.randomStart = event.target.checked; savePreferences(); });

const dialog = $('info-dialog');
$('info-open').addEventListener('click', () => { showSettings(false); dialog.showModal(); });
$('info-close').addEventListener('click', () => dialog.close());
$('info-done').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});

if (!document.fullscreenEnabled) $('fullscreen').hidden = true;
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { $('fullscreen').hidden = true; }
});
document.addEventListener('fullscreenchange', () => $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));

document.addEventListener('keydown', event => {
  if (dialog.open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  const panDistance = event.shiftKey ? .18 : .07;
  const handled = ['+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'h', 'H', 'r', 'R', 'Escape'].includes(event.key);
  if (!handled) return;
  event.preventDefault();
  switch (event.key) {
    case '+': case '=': zoom(1.5); break;
    case '-': case '_': zoom(1 / 1.5); break;
    case 'ArrowLeft': pan(canvas.clientWidth * panDistance, 0); break;
    case 'ArrowRight': pan(-canvas.clientWidth * panDistance, 0); break;
    case 'ArrowUp': pan(0, canvas.clientHeight * panDistance); break;
    case 'ArrowDown': pan(0, -canvas.clientHeight * panDistance); break;
    case 'h': case 'H': goHome(); break;
    case 'r': case 'R': goRandom(); break;
    case 'Escape': showSettings(false); break;
  }
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => scheduleRender(0), 160);
});
window.addEventListener('blur', stopHolding);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopHolding(); cancelRender(); }
  else scheduleRender(0);
});

syncPreferences();
if (preferences.randomStart) $('location-name').textContent = 'A new place to get lost';
updateReadout();
scheduleRender(0);

// Exposed read-only snapshot supports the Android shell and reproducible bug reports.
window.mandelbrotSnapshot = () => ({ view: { ...view }, preferences: { ...preferences }, rendering: !!worker });
window.handleNativeBack = () => {
  if (dialog.open) { dialog.close(); return true; }
  if (!$('settings-panel').hidden) { showSettings(false); return true; }
  return false;
};
