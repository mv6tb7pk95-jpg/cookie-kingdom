import Phaser from "phaser";
import {
  TEAM_SIZE,
  TICK_RATE,
  buildTeam,
  castSkill,
  createBattle,
  defaultTeam,
  isStageUnlocked,
  settleBattle,
  starRating,
  step,
  type BattleEvent,
  type BattleState,
  type CharacterDef,
  type Combatant,
  type GameState,
  type Rarity,
  type Settlement,
  type SkillDef,
  type StageDef,
} from "@ck/shared";
import { loadCharacterDefs, loadSkillDefs, loadStageDefs } from "../data";
import { loadState, saveState } from "../save";
import { Fx } from "../fx";

type Mode = "select" | "fight" | "result";

const CHIP_BG: Record<Rarity, string> = { common: "#4a4a55", rare: "#2f5f99", epic: "#6b3a99", legendary: "#99700a" };
const POS_COLOR = { front: 0x5aa0e8, middle: 0x6cc27a, back: 0xe8b04a } as const;
const ENEMY_COLOR = { front: 0xc2524f, middle: 0xb0467a, back: 0x8a4fc2 } as const;
const COLUMN = { front: 0, middle: 1, back: 2 } as const;
const stars = (n: number) => "*".repeat(n) + "-".repeat(3 - n);

export class BattleScene extends Phaser.Scene {
  private chars: CharacterDef[] = [];
  private skills: SkillDef[] = [];
  private stages: StageDef[] = [];
  private state!: GameState;
  private fx!: Fx;
  private mode: Mode = "select";
  private objs: Phaser.GameObjects.GameObject[] = [];
  private toast!: Phaser.GameObjects.Text;

  // fight
  private battle: BattleState | null = null;
  private stage: StageDef | null = null;
  private gfx!: Phaser.GameObjects.Graphics;
  private names = new Map<string, Phaser.GameObjects.Text>();
  private flash = new Map<string, number>();
  private skillBtns: { uid: string; t: Phaser.GameObjects.Text }[] = [];
  private speed = 1;
  private acc = 0;
  private speedBtn?: Phaser.GameObjects.Text;
  private retreatBtn?: Phaser.GameObjects.Text;
  private autoBtn?: Phaser.GameObjects.Text;
  private timerText?: Phaser.GameObjects.Text;
  private ending = false;

  constructor() {
    super("Battle");
  }

  create() {
    this.fx = new Fx(this);
    this.chars = loadCharacterDefs();
    this.skills = loadSkillDefs(this.chars);
    this.stages = loadStageDefs(this.skills);
    this.state = loadState();
    this.mode = "select";
    this.objs = [];
    this.battle = null;
    this.stage = null;
    this.names.clear();
    this.flash.clear();
    this.skillBtns = [];
    this.speed = 1;
    this.acc = 0;
    this.ending = false;
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
  private clear() {
    for (const o of this.objs) {
      this.tweens.killTweensOf(o);
      o.destroy();
    }
    this.objs = [];
    this.names.clear();
    this.skillBtns = [];
    this.speedBtn = undefined;
    this.retreatBtn = undefined;
    this.autoBtn = undefined;
    this.timerText = undefined;
  }

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

  private currentTeam(): string[] {
    const ids = buildTeam(this.state.roster, this.chars, this.state.team);
    return ids.length > 0 ? ids : defaultTeam(this.state.roster, this.chars);
  }

  private render() {
    if (this.mode === "select") this.renderSelect();
    else if (this.mode === "fight") this.layoutFight();
    else this.renderResult();
  }

  // ---------- select ----------
  private renderSelect() {
    this.clear();
    const { width } = this.scale;
    const r = this.state.resources;
    const hud = this.txt(8, 8, `Coin ${r.coin}   Crystal ${r.crystal}   Material ${r.material}`, "#fff", 16, "#000000aa");
    let y = this.bottom(hud, 8);
    const back = this.btn(0, y, "Kingdom", () => {
      saveState(this.state);
      this.fx.fadeTo("Kingdom");
    });
    back.setX(width - back.width - 8);
    const title = this.txt(8, y, "Battle", "#ffe36b", 20);
    y = this.bottom(back, 12);

    // team
    const team = this.currentTeam();
    const owned = this.chars.filter((c) => this.state.roster[c.id]);
    this.txt(8, y, `Team (${team.length}/${TEAM_SIZE}) - tap to add or remove`, "#ddd", 14);
    y += 22;
    if (owned.length === 0) {
      const t = this.txt(8, y, "No characters yet. Pull some in Collection first.", "#ffb0b0", 14);
      y = this.bottom(t, 12);
    } else {
      let x = 8;
      let rowH = 0;
      for (const c of owned) {
        const o = this.state.roster[c.id];
        const on = team.includes(c.id);
        const chip = this.btn(0, 0, `${c.name} Lv.${o.level}`, () => this.toggleTeam(c.id), on ? CHIP_BG[c.rarity] : "#2a2236");
        chip.setColor(on ? "#ffe36b" : "#8a8498");
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
    }

    // stages
    this.txt(8, y, "Stages", "#ddd", 14);
    y += 22;
    this.stages.forEach((s, i) => {
      const open = isStageUnlocked(this.state, this.stages, i);
      const best = this.state.cleared[s.id] ?? 0;
      const label = open
        ? `${i + 1}. ${s.name}${s.boss ? " [BOSS]" : ""}   ${stars(best)}`
        : `${i + 1}. Locked`;
      const b = this.btn(8, y, label, () => (open ? this.startFight(s) : this.say("Clear the previous stage first")), open ? (s.boss ? "#8a2b2b" : "#4a3566") : "#2a2236");
      if (!open) b.setColor("#7a7490");
      y = this.bottom(b, 6);
    });
  }

  private toggleTeam(id: string) {
    const team = this.currentTeam();
    const i = team.indexOf(id);
    if (i >= 0) {
      if (team.length <= 1) {
        this.say("At least one character");
        return;
      }
      team.splice(i, 1);
    } else {
      if (team.length >= TEAM_SIZE) {
        this.say(`Max ${TEAM_SIZE} characters`);
        return;
      }
      team.push(id);
    }
    this.state.team = team;
    saveState(this.state);
    this.renderSelect();
  }

  // ---------- fight ----------
  private startFight(stage: StageDef) {
    const team = this.currentTeam();
    if (team.length === 0) {
      this.say("Pull a character first");
      return;
    }
    this.stage = stage;
    this.battle = createBattle(this.state.roster, this.chars, this.skills, team, stage, (Math.random() * 2 ** 31) | 0, true);
    this.mode = "fight";
    this.acc = 0;
    this.ending = false;
    this.flash.clear();
    this.clear();
    this.gfx = this.add.graphics().setDepth(1);
    this.objs.push(this.gfx);

    for (const u of this.battle.units) {
      const t = this.add.text(0, 0, u.name, { color: "#fff", fontSize: "12px", align: "center", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(3);
      this.names.set(u.uid, t);
      this.objs.push(t);
    }

    const head = this.txt(8, 8, `${stage.name}${stage.boss ? "  [BOSS]" : ""}`, "#fff", 16, "#000000aa");
    head.setDepth(10);
    this.timerText = this.txt(0, 8, "", "#ddd", 14, "#000000aa").setDepth(10);

    this.speedBtn = this.btn(0, 0, "Speed x1", () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
      this.speedBtn?.setText(`Speed x${this.speed}`);
    }).setDepth(10);
    this.autoBtn = this.btn(0, 0, "Auto: ON", () => {
      if (!this.battle) return;
      this.battle.auto = !this.battle.auto;
      this.autoBtn?.setText(`Auto: ${this.battle.auto ? "ON" : "OFF"}`);
    }).setDepth(10);
    this.retreatBtn = this.btn(0, 0, "Retreat", () => this.retreat(), "#6b2b2b").setDepth(10);

    this.skillBtns = [];
    for (const u of this.battle.units.filter((v) => v.side === "ally")) {
      if (!u.skill) continue;
      const t = this.btn(0, 0, u.name, () => {
        if (!this.battle) return;
        if (!castSkill(this.battle, u.uid)) this.say(u.hp <= 0 ? "Defeated" : "Skill not ready");
      }).setDepth(10);
      this.skillBtns.push({ uid: u.uid, t });
    }
    this.layoutFight();
  }

  private retreat() {
    this.mode = "select";
    this.battle = null;
    this.render();
  }

  private unitPos(u: Combatant): { x: number; y: number } {
    const { width, height } = this.scale;
    const b = this.battle!;
    const same = b.units.filter((v) => v.side === u.side && v.position === u.position);
    const idx = same.indexOf(u);
    const cx = width / 2;
    const span = Math.min(width * 0.42, 330);
    const col = COLUMN[u.position];
    const dx = 50 + col * (span / 2.4);
    const x = u.side === "ally" ? cx - dx : cx + dx;
    const top = height * 0.2;
    const area = height * 0.42;
    const y = top + ((idx + 1) * area) / (same.length + 1) + (u.side === "ally" ? 0 : 0);
    return { x, y };
  }

  private layoutFight() {
    if (this.mode !== "fight" || !this.battle) return;
    const { width, height } = this.scale;
    this.timerText?.setPosition(width - this.timerText.width - 8, 8);
    let y = height - 8;
    if (this.retreatBtn && this.speedBtn && this.autoBtn) {
      this.retreatBtn.setPosition(8, y - this.retreatBtn.height);
      this.speedBtn.setPosition(this.retreatBtn.x + this.retreatBtn.width + 6, y - this.speedBtn.height);
      this.autoBtn.setPosition(this.speedBtn.x + this.speedBtn.width + 6, y - this.autoBtn.height);
      y -= this.retreatBtn.height + 8;
    }
    // skill buttons wrap into rows, stacked upward from y
    const rows: Phaser.GameObjects.Text[][] = [[]];
    let x = 8;
    for (const s of this.skillBtns) {
      if (x + s.t.width > width - 8 && x > 8) {
        rows.push([]);
        x = 8;
      }
      s.t.setX(x);
      rows[rows.length - 1].push(s.t);
      x += s.t.width + 6;
    }
    const h = this.skillBtns[0]?.t.height ?? 0;
    const top = y - rows.length * (h + 4);
    rows.forEach((r, i) => r.forEach((t) => t.setY(top + i * (h + 4))));
  }

  update(_t: number, delta: number) {
    if (this.mode !== "fight" || !this.battle) return;
    const b = this.battle;
    if (!b.result) {
      this.acc += (delta / 1000) * TICK_RATE * this.speed;
      let guard = 0;
      while (this.acc >= 1 && !b.result && guard++ < 30) {
        this.acc -= 1;
        this.handle(step(b));
      }
      if (b.result) this.acc = 0;
    }
    this.draw();
    if (b.result && !this.ending) {
      this.ending = true;
      this.time.delayedCall(900, () => this.finish());
    }
  }

  private handle(events: BattleEvent[]) {
    const b = this.battle!;
    const find = (uid: string) => b.units.find((u) => u.uid === uid)!;
    for (const e of events) {
      if (e.t === "attack") {
        const to = find(e.to);
        const p = this.unitPos(to);
        this.flash.set(to.uid, 4);
        this.fx.floatText(p.x, p.y - 30, `${e.amount}`, e.crit ? "#ffd34d" : "#ffffff", e.crit ? 22 : 16);
      } else if (e.t === "skill") {
        const from = find(e.from);
        const fp = this.unitPos(from);
        this.fx.ring(fp.x, fp.y + 24, e.heal ? 0x7dffa0 : 0xffd34d, 4);
        this.fx.floatText(fp.x, fp.y - 52, e.name, e.heal ? "#7dffa0" : "#ffd34d", 14);
        for (const h of e.hits) {
          const to = find(h.to);
          const p = this.unitPos(to);
          if (e.heal) {
            this.fx.burst(p.x, p.y, 0x7dffa0, 8, 30);
            this.fx.floatText(p.x, p.y - 30, `+${h.amount}`, "#7dffa0", 16);
          } else {
            this.flash.set(to.uid, 6);
            this.fx.burst(p.x, p.y, from.side === "ally" ? 0xffd34d : 0xff6b6b, 10, 40);
            this.fx.floatText(p.x, p.y - 30, `${h.amount}`, h.crit ? "#ffd34d" : "#ffe9a0", h.crit ? 24 : 18);
          }
        }
      } else if (e.t === "death") {
        const p = this.unitPos(find(e.uid));
        this.fx.burst(p.x, p.y, 0xcccccc, 14, 50);
      }
    }
  }

  private draw() {
    const b = this.battle!;
    const g = this.gfx;
    g.clear();
    const { width, height } = this.scale;
    // ground line
    g.fillStyle(0x000000, 0.18);
    g.fillRect(0, height * 0.2 + height * 0.42 + 24, width, 3);
    g.fillStyle(0xffffff, 0.06);
    g.fillRect(width / 2 - 1, height * 0.12, 2, height * 0.58);

    for (const u of b.units) {
      const p = this.unitPos(u);
      const boss = !!this.stage?.boss && u.side === "enemy" && u.position === "front" && u.maxHp >= 20000;
      const w = boss ? 64 : 40;
      const h = boss ? 64 : 44;
      const dead = u.hp <= 0;
      const f = this.flash.get(u.uid) ?? 0;
      if (f > 0) this.flash.set(u.uid, f - 1);
      const base = u.side === "ally" ? POS_COLOR[u.position] : ENEMY_COLOR[u.position];
      g.fillStyle(0x000000, dead ? 0.1 : 0.3);
      g.fillEllipse(p.x, p.y + h / 2, w + 10, 12);
      g.fillStyle(f > 0 ? 0xffffff : base, dead ? 0.2 : 1);
      g.fillRoundedRect(p.x - w / 2, p.y - h / 2, w, h, 8);
      g.lineStyle(2, 0x000000, dead ? 0.1 : 0.35);
      g.strokeRoundedRect(p.x - w / 2, p.y - h / 2, w, h, 8);
      if (!dead) {
        const ratio = u.hp / u.maxHp;
        g.fillStyle(0x000000, 0.6);
        g.fillRect(p.x - w / 2, p.y - h / 2 - 10, w, 6);
        g.fillStyle(u.side === "ally" ? 0x6be07a : 0xe05a5a, 1);
        g.fillRect(p.x - w / 2, p.y - h / 2 - 10, w * ratio, 6);
        if (u.skill) {
          const cdRatio = 1 - Math.min(1, u.skillCd / u.skill.cooldown);
          g.fillStyle(0xffd34d, 1);
          g.fillRect(p.x - w / 2, p.y - h / 2 - 4, w * cdRatio, 2);
        }
      }
      const label = this.names.get(u.uid);
      label?.setPosition(p.x, p.y + h / 2 + 12).setAlpha(dead ? 0.3 : 1);
    }

    for (const s of this.skillBtns) {
      const u = b.units.find((v) => v.uid === s.uid)!;
      let text: string;
      let bg: string;
      if (u.hp <= 0) {
        text = `${u.name}  down`;
        bg = "#2a2236";
      } else if (u.skillCd > 0) {
        text = `${u.name}  ${Math.ceil(u.skillCd / TICK_RATE)}s`;
        bg = "#3a2b52";
      } else {
        text = `${u.name}  READY`;
        bg = "#b0548c";
      }
      if (s.t.text !== text) {
        s.t.setText(text);
      }
      s.t.setBackgroundColor(bg);
    }
    this.timerText?.setText(`${Math.floor(b.tick / TICK_RATE)}s / 90s`);
    this.layoutFight();
  }

  // ---------- result ----------
  private lastSettlement: Settlement | null = null;

  private finish() {
    if (!this.battle || !this.stage) return;
    this.lastSettlement = settleBattle(this.state, this.stage, this.battle);
    saveState(this.state);
    this.mode = "result";
    this.renderResult();
    if (this.battle.result === "win") {
      this.fx.confetti(this.lastSettlement.stars >= 3 ? 80 : 40);
      this.fx.flash(0xffd34d, 300);
    } else {
      this.fx.shake(250, 0.006);
    }
  }

  private renderResult() {
    this.clear();
    const b = this.battle;
    const stage = this.stage;
    if (!b || !stage) {
      this.mode = "select";
      this.renderSelect();
      return;
    }
    const { width } = this.scale;
    const win = b.result === "win";
    const s = this.lastSettlement;
    let y = 16;
    const title = this.txt(8, y, win ? "VICTORY" : "DEFEAT", win ? "#ffd34d" : "#ff8a8a", 32);
    y = this.bottom(title, 4);
    y = this.bottom(this.txt(8, y, `${stage.name}   ${Math.floor(b.tick / TICK_RATE)}s`, "#ddd", 15), 10);
    if (win && s) {
      y = this.bottom(this.txt(8, y, `Rating  ${stars(starRating(b))}`, "#ffe36b", 20), 8);
      const lines = [`Coin +${s.coin}`, `Material +${s.material}`];
      if (s.firstClear) lines.push(`First clear: Crystal +${s.crystal}`);
      y = this.bottom(this.txt(8, y, lines.join("\n"), "#fff", 16, "#000000aa"), 12);
    } else {
      const alive = b.units.filter((u) => u.side === "ally" && u.hp > 0).length;
      const why = alive > 0 ? "Time ran out." : "Your team was defeated.";
      y = this.bottom(this.txt(8, y, `${why}\nLevel up your characters or change the team, then try again.`, "#ddd", 15), 12);
    }

    const idx = this.stages.findIndex((x) => x.id === stage.id);
    const next = this.stages[idx + 1];
    const again = this.btn(8, y, "Retry", () => this.startFight(stage), "#b0548c");
    let x = 8 + again.width + 8;
    if (win && next) {
      const nx = this.btn(x, y, "Next stage", () => this.startFight(next));
      x += nx.width + 8;
    }
    const sel = this.btn(x, y, "Stage select", () => {
      this.mode = "select";
      this.battle = null;
      this.renderSelect();
    }, "#3a2b52");
    if (x + sel.width > width - 8) sel.setPosition(8, y + again.height + 6);
  }
}
