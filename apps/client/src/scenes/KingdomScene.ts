import Phaser from "phaser";
import {
  GRID_SIZE,
  TILE,
  MAX_LEVEL,
  canPlace,
  collectYield,
  findDef,
  pendingYield,
  placeBuilding,
  sellBuilding,
  sellRefund,
  upgradeBuilding,
  upgradeCost,
  type BuildingDef,
  type GameState,
  type HealthResponse,
  type PlacedBuilding,
} from "@ck/shared";
import { loadBuildingDefs } from "../data";
import { loadState, saveState } from "../save";

const COLORS: Record<string, number> = { coin: 0xf2c94c, material: 0xc98f5a, crystal: 0x6ad1ff };
const RES_LABEL: Record<string, string> = { coin: "Coin", crystal: "Crystal", material: "Material" };

interface Placing {
  def: BuildingDef;
  moveUid?: string;
}

export class KingdomScene extends Phaser.Scene {
  private defs: BuildingDef[] = [];
  private state!: GameState;
  private world!: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private hud!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private menu: Phaser.GameObjects.Text[] = [];
  private panel: Phaser.GameObjects.Text[] = [];
  private panelInfo!: Phaser.GameObjects.Text;
  private ghost!: Phaser.GameObjects.Graphics;
  private placing: Placing | null = null;
  private selectedUid: string | null = null;
  private uiClick = false;
  private downPos = new Phaser.Math.Vector2();
  private dragged = false;

  constructor() {
    super("Kingdom");
  }

  create() {
    this.defs = loadBuildingDefs();
    this.state = loadState();
    this.labels.clear();
    this.menu = [];
    this.panel = [];

    // 바닥 타일
    const g = this.add.graphics();
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        g.fillStyle((x + y) % 2 ? 0x6fae5b : 0x7bbd66, 1);
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    this.world = this.add.graphics().setDepth(1);
    this.ghost = this.add.graphics().setDepth(5);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, GRID_SIZE * TILE, GRID_SIZE * TILE);
    cam.centerOn((GRID_SIZE * TILE) / 2, (GRID_SIZE * TILE) / 2);
    cam.setZoom(0.8);

    this.setupInput(cam);
    this.setupUi();
    this.scale.on("resize", () => this.layout());
    this.layout();

    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
    this.time.addEvent({ delay: 5000, loop: true, callback: () => saveState(this.state) });
    this.tick();
    this.checkServer();

    // 오프라인 동안 쌓인 수확분 안내
    const waiting = this.state.buildings.filter((b) => {
      const d = findDef(this.defs, b.defId);
      return d && pendingYield(b, d, Date.now()) > 0;
    }).length;
    if (waiting > 0) this.say(`${waiting} building(s) ready to harvest`);
  }

  // ---------- 입력 ----------
  private setupInput(cam: Phaser.Cameras.Scene2D.Camera) {
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.downPos.set(p.x, p.y);
      this.dragged = false;
    });

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.placing) this.drawGhost(p);
      if (!p.isDown) return;
      if (Phaser.Math.Distance.Between(p.x, p.y, this.downPos.x, this.downPos.y) > 10) this.dragged = true;
      if (this.dragged) {
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      }
    });

    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const fromUi = this.uiClick;
      this.uiClick = false;
      if (fromUi || this.dragged) return;
      const cx = Math.floor(p.worldX / TILE);
      const cy = Math.floor(p.worldY / TILE);
      if (this.placing) this.confirmPlacing(p);
      else this.tapCell(cx, cy);
    });

    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.4, 2));
    });
  }

  private buildingAt(cx: number, cy: number): PlacedBuilding | undefined {
    return this.state.buildings.find((b) => {
      const d = findDef(this.defs, b.defId);
      return d && cx >= b.x && cx < b.x + d.size.w && cy >= b.y && cy < b.y + d.size.h;
    });
  }

  private tapCell(cx: number, cy: number) {
    const b = this.buildingAt(cx, cy);
    if (!b) {
      this.select(null);
      return;
    }
    const d = findDef(this.defs, b.defId)!;
    const got = collectYield(this.state, b, d, Date.now());
    if (got > 0 && d.produces) {
      this.say(`+${got} ${RES_LABEL[d.produces.resource]}`);
      this.changed();
    }
    this.select(b.uid);
  }

  // ---------- 배치 ----------
  private startPlacing(p: Placing) {
    this.placing = p;
    this.select(null);
    this.say(p.moveUid ? "Tap to move here" : "Tap a spot to build");
    this.refreshPanel();
  }

  private cellFromPointer(p: Phaser.Input.Pointer, def: BuildingDef) {
    const x = Math.floor(p.worldX / TILE - def.size.w / 2 + 0.5);
    const y = Math.floor(p.worldY / TILE - def.size.h / 2 + 0.5);
    return { x, y };
  }

  private drawGhost(p: Phaser.Input.Pointer) {
    this.ghost.clear();
    if (!this.placing) return;
    const { def, moveUid } = this.placing;
    const { x, y } = this.cellFromPointer(p, def);
    const ok = canPlace(this.state, this.defs, def, x, y, moveUid);
    this.ghost.fillStyle(ok ? 0x44ff88 : 0xff4466, 0.55);
    this.ghost.fillRect(x * TILE, y * TILE, def.size.w * TILE, def.size.h * TILE);
  }

  private confirmPlacing(p: Phaser.Input.Pointer) {
    if (!this.placing) return;
    const { def, moveUid } = this.placing;
    const { x, y } = this.cellFromPointer(p, def);
    if (moveUid) {
      const b = this.state.buildings.find((v) => v.uid === moveUid);
      if (b && canPlace(this.state, this.defs, def, x, y, moveUid)) {
        b.x = x;
        b.y = y;
        this.endPlacing();
        this.changed();
      } else this.say("Cannot move there");
      return;
    }
    const b = placeBuilding(this.state, this.defs, def, x, y, Date.now());
    if (b) {
      this.endPlacing();
      this.changed();
    } else if (this.state.resources.coin < def.cost.coin) this.say("Not enough coins");
    else this.say("Cannot build there");
  }

  private endPlacing() {
    this.placing = null;
    this.ghost.clear();
    this.refreshPanel();
  }

  // ---------- 선택 / 패널 ----------
  private select(uid: string | null) {
    this.selectedUid = uid;
    this.refreshPanel();
  }

  private selected(): { b: PlacedBuilding; d: BuildingDef } | null {
    if (!this.selectedUid) return null;
    const b = this.state.buildings.find((v) => v.uid === this.selectedUid);
    const d = b && findDef(this.defs, b.defId);
    return b && d ? { b, d } : null;
  }

  // ---------- UI ----------
  private button(label: string, onClick: () => void): Phaser.GameObjects.Text {
    const t = this.add
      .text(0, 0, label, {
        color: "#ffffff",
        fontSize: "16px",
        backgroundColor: "#4a3566",
        padding: { x: 10, y: 8 },
      })
      .setScrollFactor(0)
      .setDepth(20)
      .setInteractive({ useHandCursor: true });
    t.on("pointerup", () => {
      this.uiClick = true;
      if (!this.dragged) onClick();
    });
    t.on("pointerdown", () => (this.uiClick = true));
    return t;
  }

  private setupUi() {
    this.hud = this.add
      .text(0, 0, "", { color: "#fff", fontSize: "16px", backgroundColor: "#000000aa", padding: { x: 10, y: 6 } })
      .setScrollFactor(0)
      .setDepth(20);
    this.status = this.add
      .text(0, 0, "", { color: "#ddd", fontSize: "12px", backgroundColor: "#00000088", padding: { x: 6, y: 3 } })
      .setScrollFactor(0)
      .setDepth(20);
    this.toast = this.add
      .text(0, 0, "", { color: "#fff", fontSize: "18px", backgroundColor: "#000000cc", padding: { x: 12, y: 8 } })
      .setScrollFactor(0)
      .setDepth(30)
      .setOrigin(0.5)
      .setVisible(false);
    this.panelInfo = this.add
      .text(0, 0, "", { color: "#fff", fontSize: "15px", backgroundColor: "#000000bb", padding: { x: 10, y: 6 } })
      .setScrollFactor(0)
      .setDepth(20);

    for (const d of this.defs) {
      this.menu.push(this.button(`${d.name} ${d.cost.coin}`, () => this.startPlacing({ def: d })));
    }

    this.panel = [
      this.button("Upgrade", () => {
        const s = this.selected();
        if (!s) return;
        if (upgradeBuilding(this.state, s.d, s.b, Date.now())) this.changed();
        else this.say(s.b.level >= MAX_LEVEL ? "Max level" : "Not enough coins");
      }),
      this.button("Move", () => {
        const s = this.selected();
        if (s) this.startPlacing({ def: s.d, moveUid: s.b.uid });
      }),
      this.button("Sell", () => {
        const s = this.selected();
        if (!s) return;
        sellBuilding(this.state, s.d, s.b);
        this.select(null);
        this.changed();
      }),
      this.button("Cancel", () => {
        if (this.placing) this.endPlacing();
        else this.select(null);
      }),
    ];
    this.refreshPanel();
  }

  private layout() {
    const { width, height } = this.scale;
    this.hud.setPosition(8, 8);
    this.status.setPosition(8, 8 + this.hud.height + 4);
    this.toast.setPosition(width / 2, height * 0.3);

    let x = 8;
    for (const m of this.menu) {
      m.setPosition(x, height - m.height - 8);
      x += m.width + 6;
    }
    const baseY = height - (this.menu[0]?.height ?? 40) - 16;
    let px = 8;
    for (const b of this.panel) {
      b.setPosition(px, baseY - b.height - 4);
      px += b.width + 6;
    }
    this.panelInfo.setPosition(8, baseY - (this.panel[0]?.height ?? 40) - this.panelInfo.height - 10);
  }

  private refreshPanel() {
    const s = this.selected();
    const show = !!s || !!this.placing;
    for (const b of this.panel) b.setVisible(false);
    this.panelInfo.setVisible(show);
    if (this.placing) {
      this.panel[3].setVisible(true);
      this.panelInfo.setText(`${this.placing.moveUid ? "Move" : "Build"}: ${this.placing.def.name}`);
    } else if (s) {
      const next = s.b.level >= MAX_LEVEL ? "MAX" : `${upgradeCost(s.d, s.b.level)}`;
      this.panelInfo.setText(
        `${s.d.name}  Lv.${s.b.level}  | upgrade ${next} | sell +${sellRefund(s.d)}`,
      );
      for (const b of this.panel) b.setVisible(true);
    }
    this.layout();
  }

  private say(msg: string) {
    this.toast.setText(msg).setVisible(true).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1200, duration: 400 });
  }

  // ---------- 갱신 ----------
  private changed() {
    saveState(this.state);
    this.tick();
    this.refreshPanel();
  }

  private tick() {
    const r = this.state.resources;
    this.hud.setText(`Coin ${r.coin}   Crystal ${r.crystal}   Material ${r.material}`);
    this.drawBuildings();
  }

  private drawBuildings() {
    const now = Date.now();
    this.world.clear();
    const alive = new Set<string>();
    for (const b of this.state.buildings) {
      const d = findDef(this.defs, b.defId);
      if (!d) continue;
      alive.add(b.uid);
      const w = d.size.w * TILE;
      const h = d.size.h * TILE;
      const color = d.produces ? COLORS[d.produces.resource] : 0xcccccc;
      this.world.fillStyle(color, 1);
      this.world.fillRoundedRect(b.x * TILE + 3, b.y * TILE + 3, w - 6, h - 6, 10);
      if (b.uid === this.selectedUid) {
        this.world.lineStyle(4, 0xffffff, 1);
        this.world.strokeRoundedRect(b.x * TILE + 3, b.y * TILE + 3, w - 6, h - 6, 10);
      }
      const ready = pendingYield(b, d, now);
      let label = this.labels.get(b.uid);
      if (!label) {
        label = this.add.text(0, 0, "", { color: "#222", fontSize: "16px", align: "center" }).setOrigin(0.5).setDepth(2);
        this.labels.set(b.uid, label);
      }
      label.setPosition(b.x * TILE + w / 2, b.y * TILE + h / 2);
      label.setText(`${d.name}\nLv.${b.level}${ready > 0 ? `\nREADY +${ready}` : ""}`);
    }
    for (const [uid, t] of this.labels) {
      if (!alive.has(uid)) {
        t.destroy();
        this.labels.delete(uid);
      }
    }
  }

  private async checkServer() {
    try {
      const res = await fetch("/api/health");
      const data = (await res.json()) as HealthResponse;
      this.status.setText(`server ok v${data.version}`);
    } catch {
      this.status.setText("server offline (local save)");
    }
  }
}
