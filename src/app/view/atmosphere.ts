import {
  type Camera,
  Color3,
  DefaultRenderingPipeline,
  type DirectionalLight,
  DynamicTexture,
  type Engine,
  ImageProcessingConfiguration,
  type Mesh,
  MeshBuilder,
  type Scene,
  type ShadowGenerator,
  SSAO2RenderingPipeline,
  StandardMaterial,
} from '@babylonjs/core';

/** 그래픽 품질. 낮음은 저사양 PC용, 높음은 음영과 빛 번짐까지 켠다 */
export type Quality = 'low' | 'medium' | 'high';
export const QUALITY_NAMES: Record<Quality, string> = { low: '낮음', medium: '보통', high: '높음' };
/** 지평선 색. 안개와 화면 바탕도 이 색으로 맞춘다 */
export const HORIZON = new Color3(0.84, 0.9, 0.95);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 구름 낀 하늘을 그린 큰 공. 사진 없이 그림으로 만든다 */
export function makeSky(scene: Scene): Mesh {
  const tex = new DynamicTexture('skyTex', { width: 2048, height: 1024 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  // 이 그림은 공에 위아래가 뒤집혀 붙는다. 미리 뒤집어 그려서 하늘이 위로 가게 한다
  ctx.translate(0, 1024);
  ctx.scale(1, -1);
  const grad = ctx.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, '#2f6fc0');
  grad.addColorStop(0.3, '#5d9bdc');
  grad.addColorStop(0.45, '#8fbde9');
  grad.addColorStop(0.492, '#bfd8ef');
  grad.addColorStop(0.5, '#d9e6f2');
  grad.addColorStop(0.52, '#cfd9df');
  grad.addColorStop(1, '#b9c2c6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2048, 1024);
  // 구름: 흰 얼룩 여러 개를 겹쳐 뭉게구름처럼 만든다. 지평선 가까이는 납작하게
  const rand = rng(20261125);
  for (let c = 0; c < 46; c++) {
    const cx = rand() * 2048;
    const cy = 150 + rand() * 330;
    const size = 40 + rand() * 90;
    const flat = 0.35 + (1 - cy / 480) * 0.35;
    for (let b = 0; b < 9; b++) {
      const x = cx + (rand() - 0.5) * size * 2.6;
      const y = cy + (rand() - 0.5) * size * flat;
      const r = size * (0.5 + rand() * 0.6);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, flat);
      ctx.translate(-x, -y);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
    }
  }
  tex.update();
  // 화면 전체의 밝기 보정(노출)이 하늘에도 걸리므로, 하늘 그림은 미리 어둡게 해 둔다. 안 그러면 하얗게 날아간다
  tex.level = 0.62;
  const mat = new StandardMaterial('skyMat', scene);
  mat.emissiveTexture = tex;
  // 조명을 끈 재질은 바탕색이 그대로 더해진다. 검게 해 두어야 하늘 그림만 보인다
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.fogEnabled = false;
  const sky = MeshBuilder.CreateSphere('sky', { diameter: 760, segments: 24 }, scene);
  sky.material = mat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.applyFog = false;
  return sky;
}

/**
 * 흙의 잔무늬와 요철. 꼭짓점 색에 곱해져 흙 알갱이처럼 보이게 한다.
 * tile: 무늬 한 장이 덮는 넓이에 맞춘 반복 수
 */
export function applySoil(mat: StandardMaterial, scene: Scene, tile: number): void {
  const size = 256;
  const rand = rng(777);
  const coarse = new Float32Array(33 * 33).map(() => rand());
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 굵은 얼룩(부드럽게 이은 것) + 고운 알갱이 + 드문 자갈
      const gx = (x / size) * 32;
      const gy = (y / size) * 32;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const tx = gx - ix;
      const ty = gy - iy;
      const at = (i: number, j: number) => coarse[(j % 32) * 33 + (i % 32)];
      const big = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
      let v = big * 0.55 + rand() * 0.45;
      if (rand() < 0.012) v = rand() < 0.5 ? 0.05 : 1;
      height[y * size + x] = v;
    }
  }
  const diffuse = new DynamicTexture('soilTex', size, scene, true);
  const bump = new DynamicTexture('soilBump', size, scene, true);
  const dctx = diffuse.getContext() as unknown as CanvasRenderingContext2D;
  const bctx = bump.getContext() as unknown as CanvasRenderingContext2D;
  const dimg = dctx.createImageData(size, size);
  const bimg = bctx.createImageData(size, size);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = (y * size + x) * 4;
      const v = 196 + h(x, y) * 59;
      dimg.data[k] = v;
      dimg.data[k + 1] = v * 0.985;
      dimg.data[k + 2] = v * 0.96;
      dimg.data[k + 3] = 255;
      const dx = (h(x + 1, y) - h(x - 1, y)) * 1.6;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 1.6;
      const len = Math.hypot(dx, dy, 1);
      bimg.data[k] = (-dx / len) * 127 + 128;
      bimg.data[k + 1] = (-dy / len) * 127 + 128;
      bimg.data[k + 2] = (1 / len) * 127 + 128;
      bimg.data[k + 3] = 255;
    }
  }
  dctx.putImageData(dimg, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  diffuse.update();
  bump.update();
  for (const t of [diffuse, bump]) {
    t.uScale = tile;
    t.vScale = tile;
  }
  mat.diffuseTexture = diffuse;
  mat.bumpTexture = bump;
  bump.level = 0.9;
  mat.specularColor = new Color3(0.04, 0.04, 0.04);
}

/** 색 보정과 화면 효과, 그림자 품질을 한곳에서 다룬다 */
export class Atmosphere {
  quality: Quality = 'medium';
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly engine: Engine,
    private readonly sun: DirectionalLight,
    private readonly shadows: ShadowGenerator,
    private readonly cameras: Camera[],
  ) {
    makeSky(scene);
    // 밝은 곳이 하얗게 날아가지 않게 눌러 주고(톤 매핑), 대비를 조금 올린다
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.55;
    ip.contrast = 1.15;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.pipeline?.dispose();
    this.pipeline = null;
    this.ssao?.dispose();
    this.ssao = null;
    this.engine.setHardwareScalingLevel(q === 'low' ? 1.35 : 1);
    this.shadows.mapSize = q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096;
    this.shadows.usePercentageCloserFiltering = q !== 'low';
    this.shadows.useBlurExponentialShadowMap = false;
    this.sun.shadowEnabled = true;
    if (q === 'low') return;
    const p = new DefaultRenderingPipeline('pipeline', q === 'high', this.scene, this.cameras);
    p.fxaaEnabled = true;
    p.imageProcessingEnabled = true;
    if (q === 'high') {
      p.bloomEnabled = true;
      p.bloomThreshold = 0.82;
      p.bloomWeight = 0.22;
      p.bloomScale = 0.5;
      p.sharpenEnabled = true;
      p.sharpen.edgeAmount = 0.18;
      p.imageProcessing.vignetteEnabled = true;
      p.imageProcessing.vignetteWeight = 1.1;
      try {
        // 구석지고 맞닿은 곳을 어둡게 해 입체감을 준다
        const ssao = new SSAO2RenderingPipeline('ssao', this.scene, { ssaoRatio: 0.5, blurRatio: 1 }, this.cameras);
        ssao.radius = 2.2;
        ssao.totalStrength = 1.05;
        ssao.samples = 12;
        ssao.maxZ = 120;
        this.ssao = ssao;
      } catch {
        this.ssao = null;
      }
    }
    this.pipeline = p;
  }

  /** 낮음 → 보통 → 높음 → 낮음 */
  cycle(): Quality {
    const order: Quality[] = ['low', 'medium', 'high'];
    this.setQuality(order[(order.indexOf(this.quality) + 1) % 3]);
    return this.quality;
  }
}
