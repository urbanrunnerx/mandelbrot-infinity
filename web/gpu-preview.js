import { PALETTES } from './math.js';

// Low-latency GPU preview. The worker always produces the final, precise image.
// Restrict ordinary GPU floats to wide views where their error stays sub-pixel.
export class GpuPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.available = false;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.lost = true; this.available = false;
      canvas.style.visibility = 'hidden';
    });
    try {
      const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl || gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision < 23) return;
      this.gl = gl;
      const shader = (type, source) => {
        const item = gl.createShader(type);
        gl.shaderSource(item, source); gl.compileShader(item);
        if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
        return item;
      };
      const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 position; void main(){gl_Position=vec4(position,0.0,1.0);}');
      const fragment = shader(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform vec2 resolution;
        uniform vec2 center;
        uniform float span;
        uniform float iterations;
        uniform vec3 stops[8];
        uniform float stopCount;
        vec3 colorAt(float index) {
          if (index < 0.5) return stops[0];
          if (index < 1.5) return stops[1];
          if (index < 2.5) return stops[2];
          if (index < 3.5) return stops[3];
          if (index < 4.5) return stops[4];
          if (index < 5.5) return stops[5];
          if (index < 6.5) return stops[6];
          return stops[7];
        }
        vec3 gradient(float t) {
          float p = mod(t * 0.037, stopCount);
          float index = floor(p);
          return mix(colorAt(index),colorAt(mod(index+1.0,stopCount)),fract(p));
        }
        void main() {
          vec2 c = center + (gl_FragCoord.xy - resolution * 0.5) / resolution.y * span;
          float q = (c.x - 0.25) * (c.x - 0.25) + c.y * c.y;
          if (q * (q + c.x - 0.25) < 0.25 * c.y * c.y || (c.x+1.0)*(c.x+1.0)+c.y*c.y < 0.0625) {
            gl_FragColor = vec4(3.0/255.0,5.0/255.0,12.0/255.0,1.0); return;
          }
          vec2 z = vec2(0.0);
          float count = 0.0;
          float magnitude = 0.0;
          bool escaped = false;
          for (int i = 0; i < 512; ++i) {
            if (float(i) >= iterations) break;
            z = vec2(z.x*z.x-z.y*z.y, 2.0*z.x*z.y) + c;
            count = float(i) + 1.0;
            magnitude = dot(z,z);
            if (magnitude > 256.0) { escaped = true; break; }
          }
          if (!escaped) { gl_FragColor=vec4(3.0/255.0,5.0/255.0,12.0/255.0,1.0); return; }
          float smoothCount = count + 1.0 - log(log(sqrt(magnitude))) / log(2.0);
          gl_FragColor = vec4(gradient(smoothCount), 1.0);
        }
      `);
      const program = gl.createProgram();
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      this.program = program;
      gl.useProgram(program);
      this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.uniforms = Object.fromEntries(['resolution','center','span','iterations','stops[0]','stopCount'].map(name => [name, gl.getUniformLocation(program, name)]));
      this.available = true;
    } catch { this.available = false; }
  }
  draw(view, palette = 'aurora', maxIterations = 512) {
    if (!this.available || this.lost || view.logZoom > 2.5 || view.logZoom < -4) return false;
    const cx = Number(view.cx), cy = Number(view.cy);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;
    const gl = this.gl, u = this.uniforms;
    const rect = this.canvas.getBoundingClientRect();
    // A bounded preview surface keeps gesture latency low on mobile GPUs.
    const scale = Math.min(1, 800 / Math.max(rect.width, rect.height));
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height); gl.useProgram(this.program);
    gl.uniform2f(u.resolution, width, height);
    gl.uniform2f(u.center, cx, cy);
    gl.uniform1f(u.span, 3.6 * 10 ** -view.logZoom);
    gl.uniform1f(u.iterations, Math.max(32, Math.min(512, maxIterations)));
    const colors = PALETTES[palette] || PALETTES.aurora;
    const values = new Float32Array(24);
    for (let i = 0; i < 8; i++) values.set(colors[i % colors.length].map(v => v / 255), i * 3);
    gl.uniform3fv(u['stops[0]'], values);
    gl.uniform1f(u.stopCount, colors.length);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return !gl.isContextLost();
  }
  dispose() {
    if (!this.gl) return;
    this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program);
    this.available = false;
  }
}
