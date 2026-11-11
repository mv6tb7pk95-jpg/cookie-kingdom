import assert from "node:assert/strict";
import { gridToScreen, screenToGrid, buildingHit, blockPolys, pointInPoly, depthOf } from "../src/iso";

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("PASS", name);
};

t("round trip 2000 random points", () => {
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * 40;
    const y = Math.random() * 40;
    const s = gridToScreen(x, y);
    const g = screenToGrid(s.x, s.y);
    assert.ok(Math.abs(g.x - x) < 1e-9 && Math.abs(g.y - y) < 1e-9);
  }
});
t("every cell center maps back to its cell", () => {
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < 40; x++) {
      const s = gridToScreen(x + 0.5, y + 0.5);
      const g = screenToGrid(s.x, s.y);
      assert.equal(Math.floor(g.x), x);
      assert.equal(Math.floor(g.y), y);
    }
});
t("tile is a 64x32 diamond", () => {
  const a = gridToScreen(0, 0);
  const b = gridToScreen(1, 0);
  const c = gridToScreen(0, 1);
  assert.deepEqual([b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y], [32, 16, -32, 16]);
});
t("building hit test", () => {
  const H = 40;
  const top = gridToScreen(6, 6);
  assert.ok(buildingHit({ x: top.x, y: top.y - H }, 5, 5, 2, 2, H));
  assert.ok(!buildingHit({ x: top.x, y: top.y - H - 60 }, 5, 5, 2, 2, H));
  assert.ok(!buildingHit({ x: 900, y: 900 }, 5, 5, 2, 2, H));
  const wall = gridToScreen(5.4, 7);
  assert.ok(buildingHit({ x: wall.x, y: wall.y - H / 2 }, 5, 5, 2, 2, H));
});
t("depth order", () => {
  assert.ok(depthOf(5, 7, 2, 2) > depthOf(5, 5, 2, 2));
  assert.ok(depthOf(5, 5, 3, 3) > depthOf(5, 5, 1, 1));
});
t("point in diamond", () => {
  const d = blockPolys(0, 0, 1, 1, 0).top;
  assert.ok(pointInPoly({ x: 0, y: 16 }, d));
  assert.ok(!pointInPoly({ x: 30, y: 2 }, d));
});
console.log(`${n} iso tests passed`);
