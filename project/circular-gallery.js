import { Camera, Mesh, Plane, Program, Renderer, Texture, Transform } from 'https://cdn.jsdelivr.net/npm/ogl@1.0.11/+esm';

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function lerp(p1, p2, t) {
  return p1 + (p2 - p1) * t;
}

const DEFAULT_FONT = 'bold 30px Figtree';

function deriveFontFamilyFromUrl(url) {
  const fileName = (url.split('/').pop() || 'custom-font').split('?')[0];
  const base = fileName.replace(/\.(woff2?|ttf|otf|eot)$/i, '');
  return base.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'CircularGalleryFont';
}

async function loadFontFromStylesheet(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch font stylesheet (' + response.status + ')');
  const cssText = await response.text();
  const faceBlocks = cssText.match(/@font-face\s*{[^}]*}/g) || [];
  let family = null;
  const fontFaces = [];
  for (const block of faceBlocks) {
    const familyMatch = block.match(/font-family:\s*['"]?([^;'"]+)['"]?/);
    const urlMatch = block.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
    if (!familyMatch || !urlMatch) continue;
    family = familyMatch[1].trim();
    const descriptors = {};
    const weightMatch = block.match(/font-weight:\s*([^;]+);/);
    if (weightMatch) descriptors.weight = weightMatch[1].trim();
    fontFaces.push(new FontFace(family, 'url(' + urlMatch[1] + ')', descriptors));
  }
  if (!family) throw new Error('No @font-face rule found');
  await Promise.allSettled(fontFaces.map(async face => { await face.load(); document.fonts.add(face); }));
  return family;
}

async function resolveFont(font, fontUrl) {
  if (!fontUrl) {
    if (document.fonts && document.fonts.load) {
      try { await document.fonts.load(font); await document.fonts.ready; } catch (e) {}
    }
    return font;
  }
  try {
    await loadFontFromStylesheet(fontUrl);
  } catch (error) {
    console.error('CircularGallery: unable to load font', error);
  }
  return font;
}

/* ---------- Card compositing (photo + text baked into one canvas) ---------- */

function drawCover(ctx, img, x, y, w, h) {
  const ir = img.naturalWidth / img.naturalHeight;
  const r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) { sh = img.naturalHeight; sw = sh * r; sx = (img.naturalWidth - sw) / 2; sy = 0; }
  else { sw = img.naturalWidth; sh = sw / r; sx = 0; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = words[i];
      y += lineH;
      lines++;
      if (lines >= maxLines) return;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const CARD_W = 720;
const CARD_H = 960;

function buildCardCanvas(photoImg, item, theme) {
  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = CARD_H;
  const ctx = c.getContext('2d');

  // white card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // photo header
  const photoH = 520;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CARD_W, photoH);
  ctx.clip();
  if (photoImg) {
    drawCover(ctx, photoImg, 0, 0, CARD_W, photoH);
  } else {
    // Fallback header when the photo fails to load
    const bg = ctx.createLinearGradient(0, 0, CARD_W, photoH);
    bg.addColorStop(0, theme.dark);
    bg.addColorStop(1, theme.accent);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CARD_W, photoH);
  }
  // subtle dark gradient at the bottom of the photo for badge legibility
  const grad = ctx.createLinearGradient(0, photoH - 160, 0, photoH);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, photoH - 160, CARD_W, 160);
  ctx.restore();

  // badge pill over photo
  const badge = (item.badge || '').toUpperCase();
  if (badge) {
    ctx.font = '700 26px Jost, sans-serif';
    const padX = 26;
    const bw = ctx.measureText(badge).width + padX * 2;
    const bh = 54;
    const bx = 44;
    const by = photoH - bh - 36;
    ctx.fillStyle = theme.accent;
    roundRectPath(ctx, bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(badge, bx + padX, by + bh / 2 + 1);
  }

  // title
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.dark;
  ctx.font = '700 56px Jost, sans-serif';
  wrapText(ctx, item.title || '', 44, photoH + 84, CARD_W - 88, 62, 2);

  // description
  ctx.fillStyle = theme.gray;
  ctx.font = '400 30px "Plus Jakarta Sans", sans-serif';
  wrapText(ctx, item.desc || '', 44, photoH + 158, CARD_W - 88, 42, 5);

  return c;
}

/* ---------- WebGL media ---------- */

class Media {
  constructor({ geometry, gl, item, index, length, scene, screen, viewport, bend, borderRadius, theme }) {
    this.extra = 0;
    this.geometry = geometry; this.gl = gl; this.item = item; this.index = index; this.length = length;
    this.scene = scene; this.screen = screen; this.viewport = viewport;
    this.bend = bend; this.borderRadius = borderRadius; this.theme = theme;
    this.createShader(); this.createMesh(); this.onResize();
  }
  createShader() {
    const texture = new Texture(this.gl, { generateMipmaps: false });
    this.program = new Program(this.gl, {
      depthTest: false, depthWrite: false,
      vertex: 'precision highp float;attribute vec3 position;attribute vec2 uv;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;uniform float uTime;uniform float uSpeed;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;p.z=(sin(p.x*3.0+uTime)+cos(p.y*2.0+uTime))*(0.04+abs(uSpeed)*0.4);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}',
      fragment: 'precision highp float;uniform vec2 uImageSizes;uniform vec2 uPlaneSizes;uniform sampler2D tMap;uniform float uBorderRadius;uniform float uLoaded;varying vec2 vUv;float roundedBoxSDF(vec2 p,vec2 b,float r){vec2 d=abs(p)-b;return length(max(d,vec2(0.0)))+min(max(d.x,d.y),0.0)-r;}void main(){vec2 ratio=vec2(min((uPlaneSizes.x/uPlaneSizes.y)/(uImageSizes.x/uImageSizes.y),1.0),min((uPlaneSizes.y/uPlaneSizes.x)/(uImageSizes.y/uImageSizes.x),1.0));vec2 uv=vec2(vUv.x*ratio.x+(1.0-ratio.x)*0.5,vUv.y*ratio.y+(1.0-ratio.y)*0.5);vec4 color=texture2D(tMap,uv);float d=roundedBoxSDF(vUv-0.5,vec2(0.5-uBorderRadius),uBorderRadius);float edgeSmooth=0.002;float alpha=1.0-smoothstep(-edgeSmooth,edgeSmooth,d);gl_FragColor=vec4(color.rgb,alpha*uLoaded);}',
      uniforms: {
        tMap: { value: texture },
        uPlaneSizes: { value: [0, 0] },
        uImageSizes: { value: [CARD_W, CARD_H] },
        uSpeed: { value: 0 },
        uTime: { value: 100 * Math.random() },
        uBorderRadius: { value: this.borderRadius },
        uLoaded: { value: 0 }
      },
      transparent: true
    });
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = this.item.image;
    const buildAndShow = (photo) => {
      try {
        const card = buildCardCanvas(photo, this.item, this.theme);
        texture.image = card;
        this.program.uniforms.uImageSizes.value = [card.width, card.height];
      } catch (e) {}
      this.program.uniforms.uLoaded.value = 1;
    };
    img.onload = () => buildAndShow(img);
    img.onerror = () => buildAndShow(null);
  }
  createMesh() {
    this.plane = new Mesh(this.gl, { geometry: this.geometry, program: this.program });
    this.plane.setParent(this.scene);
  }
  update(scroll, direction) {
    this.plane.position.x = this.x - scroll.current - this.extra;
    const x = this.plane.position.x;
    const H = this.viewport.width / 2;
    if (this.bend === 0) {
      this.plane.position.y = 0;
      this.plane.rotation.z = 0;
    } else {
      const B_abs = Math.abs(this.bend);
      const R = (H * H + B_abs * B_abs) / (2 * B_abs);
      const effectiveX = Math.min(Math.abs(x), H);
      const arc = R - Math.sqrt(R * R - effectiveX * effectiveX);
      if (this.bend > 0) {
        this.plane.position.y = -arc;
        this.plane.rotation.z = -Math.sign(x) * Math.asin(effectiveX / R);
      } else {
        this.plane.position.y = arc;
        this.plane.rotation.z = Math.sign(x) * Math.asin(effectiveX / R);
      }
    }
    this.speed = scroll.current - scroll.last;
    this.program.uniforms.uTime.value += 0.04;
    this.program.uniforms.uSpeed.value = this.speed;
    const planeOffset = this.plane.scale.x / 2;
    const viewportOffset = this.viewport.width / 2;
    this.isBefore = this.plane.position.x + planeOffset < -viewportOffset;
    this.isAfter = this.plane.position.x - planeOffset > viewportOffset;
    if (direction === 'right' && this.isBefore) { this.extra -= this.widthTotal; this.isBefore = this.isAfter = false; }
    if (direction === 'left' && this.isAfter) { this.extra += this.widthTotal; this.isBefore = this.isAfter = false; }
  }
  onResize({ screen, viewport } = {}) {
    if (screen) this.screen = screen;
    if (viewport) this.viewport = viewport;
    this.scale = this.screen.height / 1500;
    this.plane.scale.y = (this.viewport.height * (CARD_H * this.scale)) / this.screen.height;
    this.plane.scale.x = (this.viewport.width * (CARD_W * this.scale)) / this.screen.width;
    this.plane.program.uniforms.uPlaneSizes.value = [this.plane.scale.x, this.plane.scale.y];
    this.padding = 1.6;
    this.width = this.plane.scale.x + this.padding;
    this.widthTotal = this.width * this.length;
    this.x = this.width * this.index;
  }
}

class App {
  constructor(container, { items, bend, borderRadius = 0.06, scrollSpeed = 2, scrollEase = 0.05, theme } = {}) {
    this.container = container;
    this.scrollSpeed = scrollSpeed;
    this.scroll = { ease: scrollEase, current: 0, target: 0, last: 0 };
    this.theme = theme;
    this.paused = false;
    this.onCheckDebounce = debounce(this.onCheck.bind(this), 200);
    this.createRenderer();
    this.createCamera();
    this.createScene();
    this.onResize();
    this.createGeometry();
    this.createMedias(items, bend, borderRadius);
    this.update = this.update.bind(this);
    this.update();
    this.addEventListeners();
  }
  createRenderer() {
    this.renderer = new Renderer({ alpha: true, antialias: true, dpr: Math.min(window.devicePixelRatio || 1, 1.5) });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.canvas.style.display = 'block';
    this.gl.canvas.style.width = '100%';
    this.gl.canvas.style.height = '100%';
    this.container.appendChild(this.gl.canvas);
  }
  createCamera() {
    this.camera = new Camera(this.gl);
    this.camera.fov = 45;
    this.camera.position.z = 20;
  }
  createScene() { this.scene = new Transform(); }
  createGeometry() { this.planeGeometry = new Plane(this.gl, { heightSegments: 20, widthSegments: 20 }); }
  createMedias(items, bend = 1, borderRadius) {
    const galleryItems = items && items.length ? items : [];
    this.mediasImages = galleryItems.concat(galleryItems);
    this.medias = this.mediasImages.map((item, index) => new Media({
      geometry: this.planeGeometry, gl: this.gl, item, index, length: this.mediasImages.length,
      scene: this.scene, screen: this.screen, viewport: this.viewport, bend, borderRadius, theme: this.theme
    }));
  }
  onTouchDown(e) {
    this.isDown = true;
    this.scroll.position = this.scroll.current;
    this.start = e.touches ? e.touches[0].clientX : e.clientX;
  }
  onTouchMove(e) {
    if (!this.isDown) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const distance = (this.start - x) * (this.scrollSpeed * 0.025);
    this.scroll.target = this.scroll.position + distance;
  }
  onTouchUp() { this.isDown = false; this.onCheck(); }
  onWheel(e) {
    const delta = e.deltaY || e.wheelDelta || e.detail;
    this.scroll.target += (delta > 0 ? this.scrollSpeed : -this.scrollSpeed) * 0.2;
    this.onCheckDebounce();
  }
  onCheck() {
    if (!this.medias || !this.medias[0]) return;
    const width = this.medias[0].width;
    const itemIndex = Math.round(Math.abs(this.scroll.target) / width);
    const item = width * itemIndex;
    this.scroll.target = this.scroll.target < 0 ? -item : item;
  }
  onResize() {
    this.screen = { width: this.container.clientWidth, height: this.container.clientHeight };
    this.renderer.setSize(this.screen.width, this.screen.height);
    this.camera.perspective({ aspect: this.screen.width / this.screen.height });
    const fov = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(fov / 2) * this.camera.position.z;
    const width = height * this.camera.aspect;
    this.viewport = { width, height };
    if (this.medias) this.medias.forEach(media => media.onResize({ screen: this.screen, viewport: this.viewport }));
  }
  update() {
    this.raf = window.requestAnimationFrame(this.update);
    if (this.paused) return;
    this.scroll.current = lerp(this.scroll.current, this.scroll.target, this.scroll.ease);
    const direction = this.scroll.current > this.scroll.last ? 'right' : 'left';
    if (this.medias) this.medias.forEach(media => media.update(this.scroll, direction));
    this.renderer.render({ scene: this.scene, camera: this.camera });
    this.scroll.last = this.scroll.current;
  }
  addEventListeners() {
    this.boundOnResize = this.onResize.bind(this);
    this.boundOnWheel = this.onWheel.bind(this);
    this.boundOnTouchDown = this.onTouchDown.bind(this);
    this.boundOnTouchMove = this.onTouchMove.bind(this);
    this.boundOnTouchUp = this.onTouchUp.bind(this);
    window.addEventListener('resize', this.boundOnResize);
    this.container.addEventListener('wheel', this.boundOnWheel, { passive: true });
    this.container.addEventListener('mousedown', this.boundOnTouchDown);
    window.addEventListener('mousemove', this.boundOnTouchMove);
    window.addEventListener('mouseup', this.boundOnTouchUp);
    this.container.addEventListener('touchstart', this.boundOnTouchDown, { passive: true });
    window.addEventListener('touchmove', this.boundOnTouchMove, { passive: true });
    window.addEventListener('touchend', this.boundOnTouchUp);
  }
  destroy() {
    window.cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.boundOnResize);
    this.container.removeEventListener('wheel', this.boundOnWheel);
    this.container.removeEventListener('mousedown', this.boundOnTouchDown);
    window.removeEventListener('mousemove', this.boundOnTouchMove);
    window.removeEventListener('mouseup', this.boundOnTouchUp);
    this.container.removeEventListener('touchstart', this.boundOnTouchDown);
    window.removeEventListener('touchmove', this.boundOnTouchMove);
    window.removeEventListener('touchend', this.boundOnTouchUp);
    if (this.renderer && this.renderer.gl && this.renderer.gl.canvas.parentNode) {
      this.renderer.gl.canvas.parentNode.removeChild(this.renderer.gl.canvas);
    }
  }
}

class CircularGalleryElement extends HTMLElement {
  connectedCallback() {
    if (this._mounted) return;
    this._mounted = true;
    this.style.display = 'block';
    this.style.width = '100%';
    this.style.height = this.style.height || '100%';
    this.style.overflow = 'hidden';
    this.style.cursor = 'grab';

    let items;
    try {
      const raw = this.getAttribute('data-items');
      if (raw) items = JSON.parse(raw);
    } catch (e) { console.error('CircularGallery: bad data-items JSON', e); }
    if ((!items || !items.length) && window.GALLERY_ITEMS) items = window.GALLERY_ITEMS;

    const bend = parseFloat(this.getAttribute('bend') || '3');
    const borderRadius = parseFloat(this.getAttribute('border-radius') || '0.06');
    const scrollEase = parseFloat(this.getAttribute('scroll-ease') || '0.05');
    const scrollSpeed = parseFloat(this.getAttribute('scroll-speed') || '2');
    const font = this.getAttribute('font') || 'bold 30px Jost';
    const fontUrl = this.getAttribute('font-url') || undefined;
    const theme = {
      dark: this.getAttribute('color-dark') || '#1f2937',
      gray: this.getAttribute('color-gray') || '#667085',
      accent: this.getAttribute('color-accent') || '#DC2626'
    };

    const start = () => {
      if (!this.isConnected) return;
      if (this.clientWidth === 0 || this.clientHeight === 0) {
        requestAnimationFrame(start);
        return;
      }
      resolveFont(font, fontUrl).then(async () => {
        try { await document.fonts.ready; } catch (e) {}
        if (!this.isConnected) return;
        this._app = new App(this, { items, bend, borderRadius, scrollSpeed, scrollEase, theme });
        if (this._pendingPause != null) this._app.paused = this._pendingPause;
      });
    };
    requestAnimationFrame(start);

    // Pause rendering while the gallery is off-screen (big perf win).
    this._io = new IntersectionObserver((entries) => {
      const vis = entries[0].isIntersecting;
      if (this._app) this._app.paused = !vis;
      else this._pendingPause = !vis;
    }, { threshold: 0 });
    this._io.observe(this);
  }
  disconnectedCallback() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    if (this._app) { this._app.destroy(); this._app = null; }
    this._mounted = false;
  }
}

if (!customElements.get('circular-gallery')) {
  customElements.define('circular-gallery', CircularGalleryElement);
}
