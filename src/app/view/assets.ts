import '@babylonjs/loaders/glTF';
import {
  type AssetContainer,
  type Color3,
  DynamicTexture,
  HDRCubeTexture,
  LoadAssetContainerAsync,
  type Mesh,
  PBRMaterial,
  type Scene,
  type ShadowGenerator,
  Texture,
  TransformNode,
  VertexBuffer,
} from '@babylonjs/core';

/**
 * 사진으로 만든 자료(Poly Haven, CC0): 하늘, 질감, 소품 모델.
 * 파일은 public/assets/polyhaven 아래에 있다. 읽지 못하면 코드로 그린 것을 그대로 쓴다.
 */
const BASE = 'assets/polyhaven/';

/**
 * 하늘 사진을 돌려 사진 속 해를 장면의 해(그림자 방향)와 맞추는 각도.
 * 사진의 해는 높이 48°에 있고, 장면의 해도 비슷한 높이다.
 */
export const SKY_ROTATION = -1.29;

/**
 * 사진의 명암 차이를 줄인 질감. keep = 남길 명암의 비율(1이면 원본 그대로).
 * 넓은 땅에 진흙 사진을 그대로 깔면 얼룩이 너무 짙어 구역선과 버킷이 잘 안 보인다.
 */
function softTexture(scene: Scene, url: string, tile: number, keep: number): DynamicTexture {
  const size = 1024;
  const tex = new DynamicTexture(`soft_${url}`, size, scene, true);
  tex.uScale = tile;
  tex.vScale = tile;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#6b5a48';
  ctx.fillRect(0, 0, size, size);
  tex.update();
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size);
    const px = data.data;
    const mean = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += px[i + c];
    for (let c = 0; c < 3; c++) mean[c] /= px.length / 4;
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) px[i + c] = mean[c] + (px[i + c] - mean[c]) * keep;
    ctx.putImageData(data, 0, 0);
    tex.update();
  };
  img.src = url;
  return tex;
}

export interface PhotoOptions {
  /** 색 사진의 명암을 이 비율만 남긴다 */
  soften?: number;
  /** 요철의 세기 (기본 1) */
  bump?: number;
}

/** 사진 질감을 입힌 재질: 색, 요철, 그리고 한 장에 담긴 음영·거칠기·금속 정도 */
export function photoMaterial(scene: Scene, id: string, asset: string, tile = 1, tint?: Color3, options: PhotoOptions = {}): PBRMaterial {
  const found = scene.getMaterialByName(id) as PBRMaterial | null;
  if (found) return found;
  const m = new PBRMaterial(id, scene);
  const tex = (kind: string): Texture => {
    const t = new Texture(`${BASE}tex/${asset}_${kind}.jpg`, scene);
    t.uScale = tile;
    t.vScale = tile;
    return t;
  };
  m.albedoTexture = options.soften === undefined ? tex('diff') : softTexture(scene, `${BASE}tex/${asset}_diff.jpg`, tile, options.soften);
  m.bumpTexture = tex('nor');
  if (options.bump !== undefined) m.bumpTexture.level = options.bump;
  m.metallicTexture = tex('arm');
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.metallic = 1;
  m.roughness = 1;
  if (tint) m.albedoColor = tint;
  return m;
}

/** 위에서 내려다본 좌표로 질감을 입힌다. 길처럼 납작하게 깔린 면에 쓴다. size(m)마다 무늬가 되풀이된다 */
export function planarUV(mesh: Mesh, size: number): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!pos) return;
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) {
    uv[i * 2] = pos[i * 3] / size;
    uv[i * 2 + 1] = pos[i * 3 + 2] / size;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uv);
}

/**
 * 하늘 사진을 읽어 하늘과 주변 빛으로 쓴다.
 * 다 읽으면 onReady를 부른다(그때 그림으로 그린 하늘을 치운다). 못 읽으면 아무 일도 하지 않는다.
 */
export function loadSky(scene: Scene, onReady: (sky: Mesh) => void): void {
  const hdr = new HDRCubeTexture(
    `${BASE}sky/kloofendal_48d_partly_cloudy_puresky_2k.hdr`,
    scene,
    512,
    false,
    true,
    false,
    true,
    () => {
      hdr.rotationY = SKY_ROTATION;
      scene.environmentTexture = hdr;
      // 하늘빛이 그늘을 너무 밝히면 그림자가 흐려진다
      scene.environmentIntensity = 0.55;
      const sky = scene.createDefaultSkybox(hdr, true, 500, 0, false);
      if (!sky) return;
      sky.name = 'photoSky';
      sky.applyFog = false;
      sky.isPickable = false;
      const mat = sky.material as PBRMaterial;
      mat.fogEnabled = false;
      if (mat.reflectionTexture) (mat.reflectionTexture as HDRCubeTexture).rotationY = SKY_ROTATION;
      onReady(sky);
    },
    () => undefined,
  );
}

const containers = new Map<string, Promise<AssetContainer>>();

function loadModel(scene: Scene, asset: string): Promise<AssetContainer> {
  let p = containers.get(asset);
  if (!p) {
    p = LoadAssetContainerAsync(`${BASE}models/${asset}/${asset}.gltf`, scene).then((c) => {
      // 원본은 장면에 넣되 보이지 않게 해 두고, 놓을 때마다 복제해서 쓴다
      c.addAllToScene();
      c.meshes[0].setEnabled(false);
      return c;
    });
    containers.set(asset, p);
  }
  return p;
}

export interface PropSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/**
 * 모델을 여러 자리에 놓는다. part를 주면 여러 부품이 든 모델에서 그 부품만 쓴다.
 * alive()가 false가 되면(그 사이 현장이 바뀜) 놓지 않는다. 읽지 못하면 예외를 던진다.
 */
export async function placeProps(
  scene: Scene,
  asset: string,
  spots: readonly PropSpot[],
  prefix: string,
  alive: () => boolean,
  part?: string,
): Promise<void> {
  const c = await loadModel(scene, asset);
  if (!alive()) return;
  const root = c.meshes[0];
  const sources = c.meshes.filter(
    (m) => m !== root && m.getTotalVertices() > 0 && (!part || m.name === part || m.parent?.name === part),
  );
  const shadows = (scene.getLightByName('sun')?.getShadowGenerator() ?? null) as ShadowGenerator | null;
  for (const s of spots) {
    const holder = new TransformNode(`${prefix}prop_${asset}`, scene);
    holder.position.set(s.x, s.y, s.z);
    holder.rotation.y = s.yaw;
    holder.scaling.setAll(s.scale);
    // glTF는 좌표계가 반대라서 읽을 때 맨 위 마디에 뒤집는 변환이 붙는다. 그것을 그대로 옮겨 온다
    const flip = new TransformNode(`${prefix}flip`, scene);
    flip.parent = holder;
    flip.rotationQuaternion = root.rotationQuaternion ? root.rotationQuaternion.clone() : null;
    flip.scaling.copyFrom(root.scaling);
    for (const src of sources) {
      const m = (src as Mesh).clone(`${prefix}${src.name}`, flip);
      m.position.setAll(0);
      m.isPickable = false;
      m.receiveShadows = true;
      shadows?.addShadowCaster(m);
    }
  }
}
