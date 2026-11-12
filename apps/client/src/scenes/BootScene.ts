import Phaser from "phaser";
import { session } from "../session";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "Loading...", { color: "#ffffff", fontSize: "24px" })
      .setOrigin(0.5);
    // wait for the server handshake, but never longer than 4s: the game falls back to the local save
    const wait = Promise.race([session().start(), new Promise<void>((r) => setTimeout(r, 4000))]);
    void Promise.all([wait, new Promise<void>((r) => setTimeout(r, 300))]).then(() => this.scene.start("Kingdom"));
  }
}
