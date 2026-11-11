import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "Loading...", { color: "#ffffff", fontSize: "24px" })
      .setOrigin(0.5);
    this.time.delayedCall(300, () => this.scene.start("Kingdom"));
  }
}
