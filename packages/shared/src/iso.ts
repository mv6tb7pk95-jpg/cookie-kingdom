/** 아이소메트릭(2:1 마름모) 좌표 변환과 판정. 화면 코드와 분리해 단독 검증 가능하게 둔다. */
export const ISO_W = 64;
export const ISO_H = 32;

export interface Pt {
  x: number;
  y: number;
}

/** 격자 좌표(소수 허용) -> 화면 좌표 (원점은 격자 0,0의 위쪽 꼭짓점) */
export function gridToScreen(gx: number, gy: number): Pt {
  return { x: ((gx - gy) * ISO_W) / 2, y: ((gx + gy) * ISO_H) / 2 };
}

/** 화면 좌표 -> 격자 좌표(소수). 칸 번호는 Math.floor로 얻는다. */
export function screenToGrid(sx: number, sy: number): Pt {
  const a = sx / (ISO_W / 2);
  const b = sy / (ISO_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export interface BlockPolys {
  top: Pt[];
  left: Pt[];
  right: Pt[];
}

/** w x h 칸을 차지하는 높이 `height`(px)짜리 입체 블록의 세 면 */
export function blockPolys(x: number, y: number, w: number, h: number, height: number): BlockPolys {
  const N = gridToScreen(x, y);
  const E = gridToScreen(x + w, y);
  const S = gridToScreen(x + w, y + h);
  const W = gridToScreen(x, y + h);
  const up = (p: Pt): Pt => ({ x: p.x, y: p.y - height });
  return {
    top: [N, E, S, W].map(up),
    left: [W, S, up(S), up(W)],
    right: [S, E, up(E), up(S)],
  };
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 화면 점이 블록(윗면 + 두 벽)에 닿는지 */
export function buildingHit(p: Pt, x: number, y: number, w: number, h: number, height: number): boolean {
  const polys = blockPolys(x, y, w, h, height);
  return pointInPoly(p, polys.top) || pointInPoly(p, polys.left) || pointInPoly(p, polys.right);
}

/** 그리기 순서 값. 클수록 앞(화면 아래쪽)이라 위에 그려진다. */
export function depthOf(x: number, y: number, w: number, h: number): number {
  return x + w - 1 + (y + h - 1) + x * 0.001;
}
