import Phaser from "phaser";
import {
  GRID_SIZE,
  ISO_W,
  ISO_H,
  MAX_LEVEL,
  blockPolys,
  buildingHit,
  canPlace,
  collectYield,
  depthOf,
  findDef,
  gridToScreen,
  pendingYield,
  placeBuilding,
  screenToGrid,
  sellBuilding,
  sellRefund,
  upgradeBuilding,
  upgradeCost,
  type BuildingDef,
  type GameState,
  type HealthResponse,
  type PlacedBuilding,
  type Pt,
} from "@ck/shared";
import { loadBuildingDefs } from "../data";
import { loadState, saveState } from "../save";
import { Fx, css } from "../fx";

const COLORS: Record<string, number> = { coin: 0xf2c94c, material: 0xc98f5a, crystal: 0x6ad1ff };
const RES_LABEL: Record<string, string> = { coin: "Coin", crystal: "Crystal", material: "Material" };
/** 화면 x가 음수가 되지 않도록 월드 원점을 오른쪽으로 밀다 */
const OX = (GRID_SIZE * ISO_W) / 2;

const toWorld = (gx: number, gy: number): Pt => {
  const s = gridToScreen(gx, gy);
  return { x: s.x + OX, y: s.y };
};
const toGrid = (wx: number, wy: number): Pt => screenToGrid(wx - OX, wy);

function shade(c: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}

function blockHeight(d: BuildingDef, b: PlacedBuilding): number {
  return 18 + 8 * Math.max(d.size.w, d.size.h) + 4 * (b.level - 1);
}

interface Placing {
  def: BuildingDef;
  moveUid?: string;
}

interface Visual {
  g: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Image;
}

export class KingdomScene extends Phaser.Scene {
  private defs: BuildingDef[] = [];
  private state!: GameState;
  private fx!: Fx;
  private visuals = new Map<string, Visual>();
  private hud!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private menu: Phaser.GameObjects.Text[] = [];
  private panel: Phaser.GameObjects.Text[] = [];
  private panelInfo!: Phaser.GameObjects.Text;
  private navBtn!: Phaser.GameObjects.Text;
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
    this.fx = new Fx(this);
    this.defs = loadBuildingDefs();
    this.state = loadState();
    this.visuals.clear();
    this.placing = null;
    this.selectedUid = null;
    this.uiClick = false;
    this.dragged = false;
    this.menu = [];
    this.panel = [];

    this.drawGround();
    this.ghost = this.add.graphics().setDepth(10000);

    const cam = this.cameras.main;
    cam.setBounds(-150, -250, GRID_SIZE * ISO_W + 300, GRID_SIZE * ISO_H + 500);
    const c = toWorld(GRID_SIZE / 2, GRID_SIZE / 2);
    cam.centerOn(c.x, c.y);
    cam.setZoom(1);

    this.setupInput(cam);
    this.setupUi();
    const onResize = () => this.layout();
    this.scale.on("resize", onResize);
    this.events.once("shutdown", () => this.scale.off("resize", onResize));
    this.layout();

    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
    this.time.addEvent({ delay: 5000, loop: true, callback: () => saveState(this.state) });
    this.tick();
    this.checkServer();
    this.fx.ambient();
    this.fx.fadeIn();

    const waiting = this.state.buildings.filter((b) => {
      const d = findDef(this.defs, b.defId);
      return d && pendingYield(b, d, Date.now()) > 0;
    }).length;
    if (waiting > 0) this.say(`${waiting} building(s) ready to harvest`);
  }

  // ---------- 그리기 도우미 ----------
  private fillPoly(g: Phaser.GameObjects.Graphics, pts: Pt[], color: number, alpha = 1) {
    g.fillStyle(color, alpha);
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x + OX, p.y) : g.moveTo(p.x + OX, p.y)));
    g.closePath();
    g.fillPath();
  }

  private strokePoly(g: Phaser.GameObjects.Graphics, pts: Pt[], width: number, color: number, alpha = 1) {
    g.lineStyle(width, color, alpha);
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x + OX, p.y) : g.moveTo(p.x + OX, p.y)));
    g.closePath();
    g.strokePath();
  }

  private cellPoly(x: number, y: number, w = 1, h = 1): Pt[] {
    return [gridToScreen(x, y), gridToScreen(x + w, y), gridToScreen(x + w, y + h), gridToScreen(x, y + h)];
  }

  private drawGround() {
    const g = this.add.graphics().setDepth(-10);
    const G = GRID_SIZE;
    const drop = 24;
    const down = (p: Pt): Pt => ({ x: p.x, y: p.y + drop });
    const W = gridToScreen(0, G);
    const S = gridToScreen(G, G);
    const E = gridToScreen(G, 0);
    this.fillPoly(g, [W, S, down(S), down(W)], 0x4a3a2a);
    this.fillPoly(g, [S, E, down(E), down(S)], 0x3a2d20);
    for (let y = 0; y < G; y++) {
      for (let x = 0; x < G; x++) {
        this.fillPoly(g, this.cellPoly(x, y), (x + y) % 2 ? 0x6fae5b : 0x7bbd66);
      }
    }
  }

  /** 건물 바닥 중심 / 윗면 중심(월드 좌표) */
  private groundOf(b: PlacedBuilding, d: BuildingDef): Pt {
    return toWorld(b.x + d.size.w / 2, b.y + d.size.h / 2);
  }

  private topOf(b: PlacedBuilding, d: BuildingDef): Pt {
    const c = this.groundOf(b, d);
    return { x: c.x, y: c.y - blockHeight(d, b) };
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
      if (this.placing) this.confirmPlacing(p);
      else this.tapAt(p.worldX, p.worldY);
    });

    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.4, 2));
    });
  }

  /** 앞쪽(그려지는 순서가 뒤인) 건물부터 입체 블록 전체를 기준으로 판정 */
  private buildingAtPoint(wx: number, wy: number): PlacedBuilding | undefined {
    const pt = { x: wx - OX, y: wy };
    const list = this.state.buildings
      .map((b) => ({ b, d: findDef(this.defs, b.defId) }))
      .filter((v): v is { b: PlacedBuilding; d: BuildingDef } => !!v.d)
      .sort((a, c) => depthOf(c.b.x, c.b.y, c.d.size.w, c.d.size.h) - depthOf(a.b.x, a.b.y, a.d.size.w, a.d.size.h));
    for (const { b, d } of list) {
      if (buildingHit(pt, b.x, b.y, d.size.w, d.size.h, blockHeight(d, b))) return b;
    }
    return undefined;
  }

  private tapAt(wx: number, wy: number) {
    const b = this.buildingAtPoint(wx, wy);
    if (!b) {
      this.select(null);
      return;
    }
    const d = findDef(this.defs, b.defId)!;
    const got = collectYield(this.state, b, d, Date.now());
    if (got > 0 && d.produces) {
      this.say(`+${got} ${RES_LABEL[d.produces.resource]}`);
      const col = COLORS[d.produces.resource] ?? 0xffffff;
      const top = this.topOf(b, d);
      this.fx.burst(top.x, top.y, col, 16, 70);
      this.fx.floatText(top.x, top.y - 10, `+${got}`, css(col));
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
    const g = toGrid(p.worldX, p.worldY);
    return { x: Math.floor(g.x - def.size.w / 2 + 0.5), y: Math.floor(g.y - def.size.h / 2 + 0.5) };
  }

  private drawGhost(p: Phaser.Input.Pointer) {
    this.ghost.clear();
    if (!this.placing) return;
    const { def, moveUid } = this.placing;
    const { x, y } = this.cellFromPointer(p, def);
    const ok = canPlace(this.state, this.defs, def, x, y, moveUid);
    const poly = this.cellPoly(x, y, def.size.w, def.size.h);
    this.fillPoly(this.ghost, poly, ok ? 0x44ff88 : 0xff4466, 0.6);
    this.strokePoly(this.ghost, poly, 3, ok ? 0xffffff : 0xffcccc, 0.9);
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
        const g = this.groundOf(b, def);
        this.fx.ring(g.x, g.y, 0x9be8ff);
      } else this.say("Cannot move there");
      return;
    }
    const b = placeBuilding(this.state, this.defs, def, x, y, Date.now());
    if (b) {
      this.endPlacing();
      this.changed();
      const g = this.groundOf(b, def);
      const top = this.topOf(b, def);
      this.fx.ring(g.x, g.y, 0xffffff);
      this.fx.burst(g.x, g.y, 0xfff2b0, 18, 70);
      this.fx.floatText(top.x, top.y - 10, "Built!", "#ffffff");
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
    this.drawBuildings();
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
      .setDepth(20000)
      .setInteractive({ useHandCursor: true });
    t.on("pointerup", () => {
      this.uiClick = true;
      if (!this.dragged) onClick();
    });
    t.on("pointerdown", () => (this.uiClick = true));
    return t;
  }

  private setupUi() {
    const ui = (t: Phaser.GameObjects.Text) => t.setScrollFactor(0).setDepth(20000);
    this.hud = ui(
      this.add.text(0, 0, "", { color: "#fff", fontSize: "16px", backgroundColor: "#000000aa", padding: { x: 10, y: 6 } }),
    );
    this.status = ui(
      this.add.text(0, 0, "", { color: "#ddd", fontSize: "12px", backgroundColor: "#00000088", padding: { x: 6, y: 3 } }),
    );
    this.toast = ui(
      this.add.text(0, 0, "", { color: "#fff", fontSize: "18px", backgroundColor: "#000000cc", padding: { x: 12, y: 8 } }),
    )
      .setDepth(30000)
      .setOrigin(0.5)
      .setVisible(false);
    this.panelInfo = ui(
      this.add.text(0, 0, "", { color: "#fff", fontSize: "15px", backgroundColor: "#000000bb", padding: { x: 10, y: 6 } }),
    );

    for (const d of this.defs) {
      this.menu.push(this.button(`${d.name} ${d.cost.coin}`, () => this.startPlacing({ def: d })));
    }

    this.panel = [
      this.button("Upgrade", () => {
        const s = this.selected();
        if (!s) return;
        if (upgradeBuilding(this.state, s.d, s.b, Date.now())) {
          this.changed();
          const top = this.topOf(s.b, s.d);
          this.fx.stars(top.x, top.y, 7);
          this.fx.ring(this.groundOf(s.b, s.d).x, this.groundOf(s.b, s.d).y, 0xfff08a);
          this.fx.floatText(top.x, top.y - 10, `Lv.${s.b.level}`, "#fff08a");
        } else this.say(s.b.level >= MAX_LEVEL ? "Max level" : "Not enough coins");
      }),
      this.button("Move", () => {
        const s = this.selected();
        if (s) this.startPlacing({ def: s.d, moveUid: s.b.uid });
      }),
      this.button("Sell", () => {
        const s = this.selected();
        if (!s) return;
        const top = this.topOf(s.b, s.d);
        const refund = sellRefund(s.d);
        sellBuilding(this.state, s.d, s.b);
        this.select(null);
        this.changed();
        this.fx.burst(top.x, top.y + blockHeight(s.d, s.b) / 2, 0xd9d9d9, 18, 70);
        this.fx.floatText(top.x, top.y, `+${refund}`, "#f2c94c");
      }),
      this.button("Cancel", () => {
        if (this.placing) this.endPlacing();
        else this.select(null);
      }),
    ];
    this.navBtn = this.button("Collection", () => {
      saveState(this.state);
      this.fx.fadeTo("Collection");
    });
    this.refreshPanel();
  }

  private layout() {
    const { width, height } = this.scale;
    this.hud.setPosition(8, 8);
    this.status.setPosition(8, 8 + this.hud.height + 4);
    this.navBtn?.setPosition(width - this.navBtn.width - 8, this.hud.height + 14);
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
      this.panelInfo.setText(`${s.d.name}  Lv.${s.b.level}  | upgrade ${next} | sell +${sellRefund(s.d)}`);
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

  private makeBadge(): Phaser.GameObjects.Image {
    const badge = this.add
      .image(0, 0, "fx_dot")
      .setTint(0xffe36b)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.tweens.add({
      targets: badge,
      scale: { from: 0.8, to: 1.4 },
      alpha: { from: 0.45, to: 1 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    });
    return badge;
  }

  private drawBuildings() {
    const now = Date.now();
    const alive = new Set<string>();
    for (const b of this.state.buildings) {
      const d = findDef(this.defs, b.defId);
      if (!d) continue;
      alive.add(b.uid);

      let v = this.visuals.get(b.uid);
      if (!v) {
        v = {
          g: this.add.graphics(),
          label: this.add.text(0, 0, "", { color: "#222", fontSize: "13px", align: "center" }).setOrigin(0.5),
          badge: this.makeBadge(),
        };
        this.visuals.set(b.uid, v);
      }
      const depth = depthOf(b.x, b.y, d.size.w, d.size.h);
      const height = blockHeight(d, b);
      const base = d.produces ? COLORS[d.produces.resource] : 0xcccccc;
      const polys = blockPolys(b.x, b.y, d.size.w, d.size.h, height);

      v.g.clear().setDepth(depth);
      this.fillPoly(v.g, polys.left, shade(base, 0.7));
      this.fillPoly(v.g, polys.right, shade(base, 0.5));
      this.fillPoly(v.g, polys.top, base);
      this.strokePoly(v.g, polys.top, 1, 0x000000, 0.25);
      if (b.uid === this.selectedUid) {
        for (const poly of [polys.top, polys.left, polys.right]) this.strokePoly(v.g, poly, 3, 0xffffff, 1);
      }

      const ready = pendingYield(b, d, now);
      const c = toWorld(b.x + d.size.w / 2, b.y + d.size.h / 2);
      v.label.setPosition(c.x, c.y - height);
      v.label.setDepth(depth + 0.5);
      v.label.setText(`${d.name}\nLv.${b.level}${ready > 0 ? `\nREADY +${ready}` : ""}`);
      v.badge.setPosition(c.x, c.y - height - 44).setDepth(depth + 1).setVisible(ready > 0);
    }
    for (const [uid, v] of this.visuals) {
      if (!alive.has(uid)) {
        this.tweens.killTweensOf(v.badge);
        v.g.destroy();
        v.label.destroy();
        v.badge.destroy();
        this.visuals.delete(uid);
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
