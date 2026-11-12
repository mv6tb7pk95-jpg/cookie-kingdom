import Phaser from "phaser";
import {
  EPIC_PITY,
  LEGEND_PITY,
  MAX_STARS,
  PULL_COST,
  RATES,
  TEN_COST,
  awakenCost,
  charStats,
  levelUpCost,
  maxLevel,
  type CharacterDef,
  type GameState,
  type PullResult,
  type Rarity,
  type SkillDef,
} from "@ck/shared";
import { loadCharacterDefs, loadSkillDefs } from "../data";
import { session } from "../session";
import { Fx } from "../fx";

const TEXT_COLOR: Record<Rarity, string> = { common: "#c8c8d0", rare: "#7dbbff", epic: "#d9a0ff", legendary: "#ffcf5a" };
const CHIP_BG: Record<Rarity, string> = { common: "#4a4a55", rare: "#2f5f99", epic: "#6b3a99", legendary: "#99700a" };
const RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
const FX_COLOR: Record<Rarity, number> = { common: 0xc8c8d0, rare: 0x7dbbff, epic: 0xc58bff, legendary: 0xffcf5a };
const LINE_STEP = 80;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Tab = "gacha" | "roster";

export class CollectionScene extends Phaser.Scene {
  private defs: CharacterDef[] = [];
  private skills: SkillDef[] = [];
  private get state(): GameState {
    return session().state;
  }
  private fx!: Fx;
  private tab: Tab = "gacha";
  private selectedId: string | null = null;
  private lastPull: PullResult[] = [];
  /** 뽑기 직후 한 번만 결과 줄을 순차 등장시킨다 */
  private reveal = false;
  private objs: Phaser.GameObjects.Text[] = [];
  private toast!: Phaser.GameObjects.Text;

  constructor() {
    super("Collection");
  }

  create() {
    this.fx = new Fx(this);
    this.defs = loadCharacterDefs();
    this.skills = loadSkillDefs(this.defs);
    this.objs = [];
    this.lastPull = [];
    this.reveal = false;
    this.toast = this.add
      .text(0, 0, "", { color: "#fff", fontSize: "18px", backgroundColor: "#000000cc", padding: { x: 12, y: 8 } })
      .setDepth(100)
      .setOrigin(0.5)
      .setVisible(false);
    const onResize = () => this.render();
    this.scale.on("resize", onResize);
    this.events.once("shutdown", () => this.scale.off("resize", onResize));
    this.render();
    this.fx.fadeIn();
  }

  // ---------- helpers ----------
  private txt(x: number, y: number, s: string, color = "#ffffff", size = 15, bg?: string): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, {
      color,
      fontSize: `${size}px`,
      backgroundColor: bg,
      padding: bg ? { x: 8, y: 6 } : undefined,
      wordWrap: { width: this.scale.width - 16 },
    });
    this.objs.push(t);
    return t;
  }

  private btn(x: number, y: number, label: string, onClick: () => void, bg = "#4a3566"): Phaser.GameObjects.Text {
    const t = this.txt(x, y, label, "#ffffff", 16, bg).setInteractive({ useHandCursor: true });
    t.on("pointerup", onClick);
    return t;
  }

  private bottom(t: Phaser.GameObjects.Text, gap = 6): number {
    return t.y + t.height + gap;
  }

  private say(msg: string) {
    const { width, height } = this.scale;
    this.toast.setPosition(width / 2, height * 0.18).setText(msg).setVisible(true).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1400, duration: 400 });
  }

  // ---------- layout ----------
  private render() {
    for (const o of this.objs) {
      this.tweens.killTweensOf(o);
      o.destroy();
    }
    this.objs = [];
    const { width } = this.scale;
    const r = this.state.resources;
    const hud = this.txt(8, 8, `Coin ${r.coin}   Crystal ${r.crystal}   Material ${r.material}`, "#fff", 16, "#000000aa");
    let y = this.bottom(hud, 8);

    const back = this.btn(0, y, "Kingdom", () => {
      void session().flush();
      this.fx.fadeTo("Kingdom");
    });
    back.setX(width - back.width - 8);
    const t1 = this.btn(8, y, "Gacha", () => this.setTab("gacha"), this.tab === "gacha" ? "#7a4fb0" : "#3a2b52");
    this.btn(8 + t1.width + 6, y, "Roster", () => this.setTab("roster"), this.tab === "roster" ? "#7a4fb0" : "#3a2b52");
    y = this.bottom(t1, 12);

    if (this.tab === "gacha") this.renderGacha(y);
    else this.renderRoster(y);
  }

  private setTab(t: Tab) {
    this.tab = t;
    this.reveal = false;
    this.render();
  }

  private renderGacha(y0: number) {
    const { width } = this.scale;
    const g = this.state.gacha;
    let y = y0;
    let t = this.txt(
      8,
      y,
      `Rates  Common ${RATES.common}%  Rare ${RATES.rare}%  Epic ${RATES.epic}%  Legendary ${RATES.legendary}%`,
      "#ddd",
      14,
    );
    y = this.bottom(t);
    t = this.txt(
      8,
      y,
      `Epic or better guaranteed within ${EPIC_PITY - g.sinceEpic} pull(s)\nLegendary guaranteed within ${LEGEND_PITY - g.sinceLegendary} pull(s)   Total pulls ${g.pullsTotal}`,
      "#ddd",
      14,
    );
    y = this.bottom(t, 10);

    const b1 = this.btn(8, y, `Pull x1  (${PULL_COST} crystal)`, () => void this.doPull(1), "#b0548c");
    const b2 = this.btn(0, y, `Pull x10  (${TEN_COST} crystal)`, () => void this.doPull(10), "#b0548c");
    if (8 + b1.width + 8 + b2.width > width - 8) {
      y += b1.height + 6;
      b2.setPosition(8, y);
    } else {
      b2.setPosition(8 + b1.width + 8, y);
    }
    y = this.bottom(b2, 12);

    if (this.lastPull.length === 0) {
      this.txt(8, y, "No pulls yet.", "#aaa", 14);
      return;
    }
    const animate = this.reveal;
    this.reveal = false;
    this.lastPull.forEach((p, i) => {
      const d = this.defs.find((c) => c.id === p.charId);
      const line = `${cap(p.rarity)}  ${d ? d.name : p.charId}   ${p.isNew ? "NEW" : `+${p.shards} shards`}`;
      const lineY = y;
      const text = this.txt(8, lineY, line, TEXT_COLOR[p.rarity], 15);
      y = this.bottom(text, 2);
      if (animate) {
        const delay = i * LINE_STEP;
        text.setAlpha(0).setX(-20);
        this.tweens.add({ targets: text, alpha: 1, x: 8, delay, duration: 220, ease: "Cubic.easeOut" });
        if (RANK[p.rarity] >= RANK.rare) {
          this.time.delayedCall(delay, () => {
            this.fx.burst(60, lineY + 10, FX_COLOR[p.rarity], RANK[p.rarity] >= RANK.epic ? 18 : 10, 50);
            if (RANK[p.rarity] >= RANK.epic) this.fx.stars(60, lineY + 10, 4, FX_COLOR[p.rarity]);
          });
        }
      }
    });
  }

  private pulling = false;

  private async doPull(n: number) {
    if (this.pulling) return;
    if (!session().canUseServerFeatures) {
      this.say(session().offlineMessage);
      return;
    }
    this.pulling = true;
    this.say("Pulling...");
    const reply = await session().gacha(n);
    this.pulling = false;
    if (!this.scene.isActive()) return;
    if (!reply.ok) {
      this.say(reply.error === "offline" ? session().offlineMessage : reply.error === "cannot_pull" ? "Not enough crystals" : "Could not pull, try again");
      this.render();
      return;
    }
    const res = (reply.result as { pulls: PullResult[] }).pulls;
    this.lastPull = res;
    this.reveal = true;
    this.render();

    const best = res.reduce<Rarity>((acc, p) => (RANK[p.rarity] > RANK[acc] ? p.rarity : acc), "common");
    const total = Math.min(res.length * LINE_STEP, 900);
    if (best === "epic") {
      this.time.delayedCall(total, () => {
        this.fx.flash(0xb06cff, 400);
        this.say("Epic!");
      });
    } else if (best === "legendary") {
      this.time.delayedCall(total, () => {
        this.fx.flash(0xffd34d, 500);
        this.fx.shake(350, 0.012);
        this.fx.confetti(70);
        this.say("Legendary!");
      });
    }
  }

  private renderRoster(y0: number) {
    const { width } = this.scale;
    const owned = this.state.roster;
    let y = y0;
    const have = this.defs.filter((d) => owned[d.id]).length;
    y = this.bottom(this.txt(8, y, `Collected ${have}/${this.defs.length}`, "#ddd", 14));

    const sorted = [...this.defs].sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.name.localeCompare(b.name));
    let x = 8;
    let rowH = 0;
    for (const d of sorted) {
      const o = owned[d.id];
      const label = o ? `${d.name}  Lv.${o.level}  Star ${o.stars}` : "???";
      const chip = this.btn(
        0,
        0,
        label,
        () => {
          if (!o) {
            this.say("Not collected yet");
            return;
          }
          this.selectedId = d.id;
          this.render();
        },
        o ? CHIP_BG[d.rarity] : "#2a2236",
      );
      if (d.id === this.selectedId) chip.setColor("#ffe36b");
      if (x + chip.width > width - 8 && x > 8) {
        x = 8;
        y += rowH + 6;
        rowH = 0;
      }
      chip.setPosition(x, y);
      x += chip.width + 6;
      rowH = Math.max(rowH, chip.height);
    }
    y += rowH + 14;

    const sel = this.selectedId ? this.defs.find((c) => c.id === this.selectedId) : undefined;
    const o = sel ? owned[sel.id] : undefined;
    if (!sel || !o) {
      this.txt(8, y, "Tap a collected character to see details.", "#aaa", 14);
      return;
    }
    const st = charStats(sel, o);
    const sk = this.skills.find((s) => s.id === sel.skill);
    const info = this.txt(
      8,
      y,
      `${sel.name}   (${cap(sel.rarity)}, ${cap(sel.position)}, ${cap(sel.element)})\n` +
        `Lv.${o.level}/${maxLevel(o.stars)}   Star ${o.stars}/${MAX_STARS}   Shards ${o.shards}\n` +
        `HP ${st.hp}   ATK ${st.atk}\n` +
        (sk ? `Skill: ${sk.name}  (cooldown ${sk.cooldown}s, power ${sk.power}% ATK)` : ""),
      TEXT_COLOR[sel.rarity],
      15,
      "#00000088",
    );
    y = this.bottom(info, 10);

    const lc = levelUpCost(o.level);
    const atCap = o.level >= maxLevel(o.stars);
    const lv = this.btn(
      8,
      y,
      atCap ? "Level Up  (awaken to raise cap)" : `Level Up  (${lc.coin} coin + ${lc.material} material)`,
      () => this.doGrow({ type: "levelUp", id: sel.id }),
    );
    const cost = awakenCost(o.stars);
    const aw = this.btn(
      0,
      y,
      o.stars >= MAX_STARS ? "Awaken  (max)" : `Awaken  (${o.shards}/${cost} shards)`,
      () => this.doGrow({ type: "awaken", id: sel.id }),
      "#8a5a2b",
    );
    if (8 + lv.width + 8 + aw.width > width - 8) aw.setPosition(8, y + lv.height + 6);
    else aw.setPosition(8 + lv.width + 8, y);
  }

  private doGrow(action: { type: "levelUp" | "awaken"; id: string }) {
    const kind = action.type === "levelUp" ? "level" : "awaken";
    const reply = session().act(action);
    const result = reply.ok ? "ok" : (reply.error.split("_")[1] as "max" | "funds" | "shards" | "unowned" | undefined) ?? "funds";
    const msg: Record<string, string> = {
      ok: "Done",
      max: "Already at the limit",
      funds: "Not enough coin or material",
      shards: "Not enough shards",
      unowned: "Not collected yet",
    };
    this.say(msg[result] ?? "Not possible");
    if (result === "ok") {
      const { width, height } = this.scale;
      if (kind === "awaken") {
        this.fx.flash(0xfff08a, 300);
        this.fx.stars(width / 2, height * 0.5, 10);
      } else {
        this.fx.burst(width / 2, height * 0.5, 0xfff2b0, 16, 80);
      }
    }
    this.render();
  }
}
