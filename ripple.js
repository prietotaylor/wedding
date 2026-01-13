(() => {
  const prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) return;

  const canvas = document.createElement("canvas");
  canvas.id = "membrane-canvas";

  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false
  });
  if (!gl) return;

  const image = new Image();
  image.src = "dg.png";

  const vertexSrc = `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() {
      v_uv = a_uv;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const simFragmentSrc = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 v_uv;
    uniform sampler2D u_state;
    uniform vec2 u_texel;
    uniform float u_damping;
    uniform float u_speed;
    uniform vec3 u_impulse;
    uniform float u_radius;

    float decode(float v) {
      return v * 2.0 - 1.0;
    }

    float encode(float v) {
      return clamp(v * 0.5 + 0.5, 0.0, 1.0);
    }

    void main() {
      vec4 state = texture2D(u_state, v_uv);
      float current = decode(state.r);
      float previous = decode(state.g);

      float left = decode(texture2D(u_state, v_uv - vec2(u_texel.x, 0.0)).r);
      float right = decode(texture2D(u_state, v_uv + vec2(u_texel.x, 0.0)).r);
      float down = decode(texture2D(u_state, v_uv - vec2(0.0, u_texel.y)).r);
      float up = decode(texture2D(u_state, v_uv + vec2(0.0, u_texel.y)).r);

      float laplacian = left + right + down + up - (4.0 * current);
      float next = (2.0 * current - previous + (u_speed * laplacian)) * u_damping;

      if (u_impulse.z != 0.0) {
        float dist = distance(v_uv, u_impulse.xy);
        float splash = exp(-(dist * dist) / (u_radius * u_radius));
        next += u_impulse.z * splash;
      }

      gl_FragColor = vec4(encode(next), encode(current), 0.5, 1.0);
    }
  `;

  const renderFragmentSrc = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 v_uv;
    uniform sampler2D u_state;
    uniform sampler2D u_image;
    uniform vec2 u_texel;
    uniform vec2 u_canvasSize;
    uniform vec2 u_imageSize;
    uniform vec2 u_offset;
    uniform float u_refraction;

    float decode(float v) {
      return v * 2.0 - 1.0;
    }

    float heightAt(vec2 uv) {
      return decode(texture2D(u_state, uv).r);
    }

    void main() {
      float height = heightAt(v_uv);
      float hx = heightAt(v_uv + vec2(u_texel.x, 0.0)) - heightAt(v_uv - vec2(u_texel.x, 0.0));
      float hy = heightAt(v_uv + vec2(0.0, u_texel.y)) - heightAt(v_uv - vec2(0.0, u_texel.y));

      vec2 offset = vec2(hx, -hy) * u_refraction;
      vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y) + offset;

      vec2 pixel = uv * u_canvasSize + u_offset;
      vec2 tileUV = fract(pixel / u_imageSize);

      vec4 color = texture2D(u_image, tileUV);
      float shade = clamp(0.6 + height * 0.6, 0.35, 1.0);
      gl_FragColor = vec4(color.rgb * shade, 1.0);
    }
  `;

  function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(vertexSource, fragmentSource) {
    const vs = createShader(gl.VERTEX_SHADER, vertexSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  const simProgram = createProgram(vertexSrc, simFragmentSrc);
  const renderProgram = createProgram(vertexSrc, renderFragmentSrc);
  if (!simProgram || !renderProgram) return;

  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1
    ]),
    gl.STATIC_DRAW
  );

  const simAttribs = {
    position: gl.getAttribLocation(simProgram, "a_position"),
    uv: gl.getAttribLocation(simProgram, "a_uv")
  };
  const renderAttribs = {
    position: gl.getAttribLocation(renderProgram, "a_position"),
    uv: gl.getAttribLocation(renderProgram, "a_uv")
  };

  const simUniforms = {
    state: gl.getUniformLocation(simProgram, "u_state"),
    texel: gl.getUniformLocation(simProgram, "u_texel"),
    damping: gl.getUniformLocation(simProgram, "u_damping"),
    speed: gl.getUniformLocation(simProgram, "u_speed"),
    impulse: gl.getUniformLocation(simProgram, "u_impulse"),
    radius: gl.getUniformLocation(simProgram, "u_radius")
  };

  const renderUniforms = {
    state: gl.getUniformLocation(renderProgram, "u_state"),
    image: gl.getUniformLocation(renderProgram, "u_image"),
    texel: gl.getUniformLocation(renderProgram, "u_texel"),
    canvasSize: gl.getUniformLocation(renderProgram, "u_canvasSize"),
    imageSize: gl.getUniformLocation(renderProgram, "u_imageSize"),
    offset: gl.getUniformLocation(renderProgram, "u_offset"),
    refraction: gl.getUniformLocation(renderProgram, "u_refraction")
  };

  function bindAttributes(attribs) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(attribs.position);
    gl.vertexAttribPointer(attribs.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(attribs.uv);
    gl.vertexAttribPointer(attribs.uv, 2, gl.FLOAT, false, 16, 8);
  }

  function createTexture(width, height, filter) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    return texture;
  }

  function createFramebuffer(texture) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return fbo;
  }

  function createImageTexture(img) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      img
    );
    return texture;
  }

  let stateTextures = [];
  let framebuffers = [];
  let simWidth = 0;
  let simHeight = 0;
  let currentIndex = 0;

  let canvasWidth = 0;
  let canvasHeight = 0;
  let canvasCssWidth = 0;
  let canvasCssHeight = 0;
  let imageTexture = null;

  const impulses = [];
  const maxImpulses = 8;

  function setupSimulation() {
    const scale = 0.35;
    const minSize = 140;
    const maxSize = 420;

    const targetWidth = Math.max(
      minSize,
      Math.min(maxSize, Math.round(window.innerWidth * scale))
    );
    const targetHeight = Math.max(
      minSize,
      Math.min(maxSize, Math.round(window.innerHeight * scale))
    );

    simWidth = Math.max(2, targetWidth);
    simHeight = Math.max(2, targetHeight);

    stateTextures = [
      createTexture(simWidth, simHeight, gl.NEAREST),
      createTexture(simWidth, simHeight, gl.NEAREST)
    ];
    framebuffers = [
      createFramebuffer(stateTextures[0]),
      createFramebuffer(stateTextures[1])
    ];

    gl.viewport(0, 0, simWidth, simHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[0]);
    gl.clearColor(0.5, 0.5, 0.5, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[1]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    currentIndex = 0;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvasCssWidth = window.innerWidth;
    canvasCssHeight = window.innerHeight;
    canvasWidth = Math.round(canvasCssWidth * dpr);
    canvasHeight = Math.round(canvasCssHeight * dpr);
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    setupSimulation();
  }

  function updateRenderUniforms() {
    gl.useProgram(renderProgram);
    gl.uniform1i(renderUniforms.state, 0);
    gl.uniform1i(renderUniforms.image, 1);
    gl.uniform2f(
      renderUniforms.texel,
      1 / simWidth,
      1 / simHeight
    );
    gl.uniform2f(
      renderUniforms.canvasSize,
      canvasCssWidth,
      canvasCssHeight
    );
    gl.uniform2f(
      renderUniforms.imageSize,
      image.width,
      image.height
    );

    const offsetX = (canvasCssWidth - image.width) * 0.5;
    gl.uniform2f(
      renderUniforms.offset,
      offsetX,
      0
    );
    gl.uniform1f(renderUniforms.refraction, 0.015);
  }

  function updateSimUniforms(impulse) {
    gl.useProgram(simProgram);
    gl.uniform1i(simUniforms.state, 0);
    gl.uniform2f(
      simUniforms.texel,
      1 / simWidth,
      1 / simHeight
    );
    gl.uniform1f(simUniforms.damping, 0.99);
    gl.uniform1f(simUniforms.speed, 0.5);

    if (impulse) {
      gl.uniform3f(
        simUniforms.impulse,
        impulse.x,
        impulse.y,
        impulse.strength
      );
      gl.uniform1f(simUniforms.radius, impulse.radius);
    } else {
      gl.uniform3f(simUniforms.impulse, 0, 0, 0);
      gl.uniform1f(simUniforms.radius, 0.02);
    }
  }

  function simulate(impulse) {
    const nextIndex = (currentIndex + 1) % 2;
    gl.useProgram(simProgram);
    bindAttributes(simAttribs);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTextures[currentIndex]);
    updateSimUniforms(impulse);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[nextIndex]);
    gl.viewport(0, 0, simWidth, simHeight);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    currentIndex = nextIndex;
  }

  function render() {
    gl.useProgram(renderProgram);
    bindAttributes(renderAttribs);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTextures[currentIndex]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    updateRenderUniforms();

    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let lastTime = 0;
  function tick(time) {
    const delta = Math.min(48, time - lastTime);
    const steps = delta > 28 ? 2 : 1;

    for (let i = 0; i < steps; i += 1) {
      const impulse = impulses.shift() || null;
      simulate(impulse);
    }

    render();
    lastTime = time;
    requestAnimationFrame(tick);
  }

  function queueImpulse(x, y) {
    const strength = 0.6;
    const radius = 0.025;
    impulses.push({ x, y, strength, radius });
    if (impulses.length > maxImpulses) impulses.shift();
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = 1 - (event.clientY - rect.top) / rect.height;
    queueImpulse(x, y);
  }

  function start() {
    document.body.prepend(canvas);
    document.body.classList.add("webgl-ready");
    imageTexture = createImageTexture(image);
    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("pointerdown", onPointerDown);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    requestAnimationFrame(tick);
  }

  if (image.complete) {
    start();
  } else {
    image.onload = start;
  }
})();
