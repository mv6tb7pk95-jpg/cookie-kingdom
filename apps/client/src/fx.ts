import Phaser from "phaser";

/**
 * 시각 효과 도우미. 외부 이미지 없이 텍스처를 코드로 만들고,
 * 스프라이트 + 트윈만 사용한다(파티클 emitter 타입 문제를 피하기 위함).
 */
const TEX_DOT = "fx_dot";
const TEX_STAR = "fx_star";
const TEX_CONF = "fx_conf";

export const css = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

function makeTextures(scene: Phaser.Scene) {
  const tx = scene.textures;
  if (!tx.exists(TEX_DOT)) {
    const g = scene.make.graphics({}, false);
    for (let i = 0; i < 8; i++) {
      g.fillStyle(0xffffff, 0.14);
      g.fillCircle(16, 16, 16 - i * 2);
    }
    g.generateTexture(TEX_DOT, 32, 32);
    g.destroy();
  }
  if (!tx.exists(TEX_STAR)) {
    const g = scene.make.graphics({}, false);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 11 : 4.5;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push({ x: 12 + Math.cos(a) * r, y: 12 + Math.sin(a) * r });
    }
    g.fillStyle(0xffffff, 1);
    g.fillPoints(pts, true);
    g.generateTexture(TEX_STAR, 24, 24);
    g.destroy();
  }
  if (!tx.exists(TEX_CONF)) {
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 6, 10);
    g.generateTexture(TEX_CONF, 6, 10);
    g.destroy();
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Fx {
  private fading = false;

  constructor(
    private scene: Phaser.Scene,
    private depth = 9000,
  ) {
    makeTextures(scene);
  }

  private img(key: string, x: number, y: number, tint: number, scale: number, additive: boolean) {
    const s = this.scene.add.image(x, y, key).setDepth(this.depth).setTint(tint).setScale(scale);
    if (additive) s.setBlendMode(Phaser.BlendModes.ADD);
    return s;
  }

  /** 빛 점이 사방으로 퍼진다 */
  burst(x: number, y: number, color = 0xffe38a, count = 14, dist = 60) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const d = dist * rand(0.5, 1.2);
      const s = this.img(TEX_DOT, x, y, color, rand(0.5, 1), true);
      this.scene.tweens.add({
        targets: s,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d * 0.7,
        alpha: 0,
        scale: 0.1,
        duration: rand(450, 750),
        ease: "Cubic.easeOut",
        onComplete: () => s.destroy(),
      });
    }
  }

  /** 별이 위로 떠오르며 회전한다 */
  stars(x: number, y: number, count = 6, color = 0xfff08a) {
    for (let i = 0; i < count; i++) {
      const s = this.img(TEX_STAR, x + rand(-14, 14), y, color, rand(0.7, 1.3), false);
      this.scene.tweens.add({
        targets: s,
        x: s.x + rand(-40, 40),
        y: y - rand(40, 90),
        angle: rand(-180, 180),
        alpha: 0,
        duration: rand(700, 1100),
        delay: i * 40,
        ease: "Quad.easeOut",
        onComplete: () => s.destroy(),
      });
    }
  }

  /** 바닥에 퍼지는 타원 고리(2:1 아이소메트릭에 맞춤) */
  ring(x: number, y: number, color = 0xffffff, size = 5) {
    const g = this.scene.add.graphics({ x, y }).setDepth(this.depth);
    g.lineStyle(2, color, 1);
    g.strokeEllipse(0, 0, 20, 10);
    this.scene.tweens.add({
      targets: g,
      scaleX: size,
      scaleY: size,
      alpha: 0,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  /** 위로 떠오르며 사라지는 글자. fixed=true면 화면 고정 좌표 */
  floatText(x: number, y: number, text: string, color = "#ffffff", size = 20, fixed = false) {
    const t = this.scene.add
      .text(x, y, text, { color, fontSize: `${size}px`, fontStyle: "bold", stroke: "#000000", strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(this.depth + 1);
    if (fixed) t.setScrollFactor(0);
    this.scene.tweens.add({
      targets: t,
      y: y - 50,
      alpha: 0,
      duration: 1000,
      delay: 250,
      ease: "Quad.easeOut",
      onComplete: () => t.destroy(),
    });
  }

  /** 화면에 보이는 영역에서 반짝이 입자가 천천히 떠오른다. 씬이 끝나면 타이머도 함께 정리된다 */
  ambient(everyMs = 400) {
    this.scene.time.addEvent({
      delay: everyMs,
      loop: true,
      callback: () => {
        const v = this.scene.cameras.main.worldView;
        const x = v.x + rand(0, v.width);
        const y = v.y + rand(0, v.height);
        const s = this.img(TEX_DOT, x, y, 0xfff2b0, rand(0.25, 0.5), true).setAlpha(0);
        this.scene.tweens.add({
          targets: s,
          alpha: 0.8,
          y: y - 24,
          duration: 900,
          yoyo: true,
          onComplete: () => s.destroy(),
        });
      },
    });
  }

  /** 화면 전체에 색종이가 떨어진다(화면 고정) */
  confetti(count = 60) {
    const { width, height } = this.scene.scale;
    const colors = [0xff6b9a, 0xffd34d, 0x6ad1ff, 0x9be86a, 0xc58bff];
    for (let i = 0; i < count; i++) {
      const c = colors[i % colors.length];
      const s = this.scene.add
        .image(rand(0, width), -12, TEX_CONF)
        .setTint(c)
        .setScrollFactor(0)
        .setDepth(25000)
        .setAngle(rand(0, 360));
      this.scene.tweens.add({
        targets: s,
        y: height + 20,
        x: s.x + rand(-60, 60),
        angle: s.angle + rand(-360, 360),
        duration: rand(1300, 2400),
        delay: rand(0, 450),
        ease: "Quad.easeIn",
        onComplete: () => s.destroy(),
      });
    }
  }

  shake(ms = 300, intensity = 0.01) {
    this.scene.cameras.main.shake(ms, intensity);
  }

  flash(color = 0xffffff, ms = 350) {
    this.scene.cameras.main.flash(ms, (color >> 16) & 255, (color >> 8) & 255, color & 255);
  }

  fadeIn(ms = 250) {
    this.scene.cameras.main.fadeIn(ms, 0, 0, 0);
  }

  /** 화면을 어둡게 한 뒤 다른 씬으로 전환 */
  fadeTo(sceneKey: string, ms = 220) {
    if (this.fading) return;
    this.fading = true;
    const cam = this.scene.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.scene.start(sceneKey));
    cam.fadeOut(ms, 0, 0, 0);
  }
}
