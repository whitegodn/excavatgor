/**
 * 버킷 옆모습(바닥판 윤곽). 단위는 버킷 길이(핀 → 날 끝) 대비 비율.
 * c: 핀에서 날 끝 방향, n: 바가지가 불룩한 쪽. 입구는 n = 0 선(핀 ↔ 날 끝)이다.
 * 화면의 버킷 모양과 지형을 깎는 모양이 같은 데이터를 쓴다.
 */
export const BUCKET_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [1.0, 0.0],
  [0.8, 0.38],
  [0.45, 0.55],
  [0.12, 0.42],
  [0.0, 0.0],
];

/** 윤곽을 step 간격으로 잘게 나눈 점들. [c0, n0, c1, n1, ...] (미터 단위) */
export function buildProfileSamples(bucketLen: number, step: number): Float64Array {
  const out: number[] = [];
  for (let s = 0; s < BUCKET_PROFILE.length - 1; s++) {
    const [c0, n0] = BUCKET_PROFILE[s];
    const [c1, n1] = BUCKET_PROFILE[s + 1];
    const len = Math.hypot(c1 - c0, n1 - n0) * bucketLen;
    const count = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < count; k++) {
      const t = k / count;
      out.push((c0 + (c1 - c0) * t) * bucketLen, (n0 + (n1 - n0) * t) * bucketLen);
    }
  }
  const last = BUCKET_PROFILE[BUCKET_PROFILE.length - 1];
  out.push(last[0] * bucketLen, last[1] * bucketLen);
  return Float64Array.from(out);
}
