import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { KingdomScene } from "./scenes/KingdomScene";
import { CollectionScene } from "./scenes/CollectionScene";
import { BattleScene } from "./scenes/BattleScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#2b2038",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [BootScene, KingdomScene, CollectionScene, BattleScene],
});
