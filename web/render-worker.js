import { renderMandelbrot } from './math.js';

self.onmessage = ({ data }) => {
  const started = performance.now();
  try {
    const result = renderMandelbrot(data, progress => self.postMessage({ id: data.id, ...progress }));
    self.postMessage({ id: data.id, ...result, elapsedMs: Math.round(performance.now() - started), done: true }, [result.pixels]);
  } catch (error) {
    self.postMessage({ id: data.id, done: true, error: error instanceof Error ? error.message : String(error) });
  }
};
