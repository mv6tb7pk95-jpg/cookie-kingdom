import Phaser from "phaser";
import { GRID_SIZE, TILE, type HealthResponse } from "@ck/shared";

export class KingdomScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super("Kingdom");
  }

  create() {
    const g = this.add.graphics();
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        g.fillStyle((x + y) % 2 ? 0x6fae5b : 0x7bbd66, 1);
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    const cam = this.cameras.main;
    cam.setBounds(0, 0, GRID_SIZE * TILE, GRID_SIZE * TILE);
    cam.centerOn((GRID_SIZE * TILE) / 2, (GRID_SIZE * TILE) / 2);

    // 드래그로 카메라 이동
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });

    // 휠로 확대/축소
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.4, 2));
    });

    this.status = this.add
      .text(12, 12, "server: ...", { color: "#fff", fontSize: "16px", backgroundColor: "#00000088" })
      .setScrollFactor(0)
      .setDepth(10);

    this.checkServer();
  }

  private async checkServer() {
    try {
      const res = await fetch("/api/health");
      const data = (await res.json()) as HealthResponse;
      this.status.setText(`server: ok v${data.version}`);
    } catch {
      this.status.setText("server: offline");
    }
  }
}
