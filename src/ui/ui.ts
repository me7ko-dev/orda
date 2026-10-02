import * as THREE from 'three';
import { audioUnlock, isMuted, setMuted, sfx } from '../audio/sfx';
import { IS_TOUCH, type Engine, type Quality } from '../engine/engine';
import { BACKPACK, MAX_TIER, TIERS, WEAPONS, weaponStats, type Item } from '../game/data';
import type { Game, Stats } from '../game/game';
import { weaponIcon } from './icons';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class UI {
  root = $('#ui');
  hud!: HTMLElement;
  hpFill!: HTMLElement;
  hpText!: HTMLElement;
  timeEl!: HTMLElement;
  waveEl!: HTMLElement;
  killsEl!: HTMLElement;
  armsEl!: HTMLElement;
  banner!: HTMLElement;
  hurt!: HTMLElement;
  arrow!: HTMLElement;
  bossBar!: HTMLElement;
  bossFill!: HTMLElement;
  hint!: HTMLElement;
  joy!: HTMLElement;
  knob!: HTMLElement;
  menu!: HTMLElement;
  over!: HTMLElement;
  pauseEl!: HTMLElement;
  pack!: HTMLElement;
  toastEl!: HTMLElement;
  private keys = new Set<string>();
  private joyVec = { x: 0, z: 0 };
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private offers: Item[] = [];
  private offerTaken = false;
  private hintStep = 0;
  private tutorial = true;

  constructor(public game: Game, public engine: Engine) {
    try { this.tutorial = localStorage.getItem('orda-tut') !== 'done'; } catch { /* */ }
    this.build();
    this.bindInput();
    game.onBanner = (t, k) => this.showBanner(t, k);
    game.onHurt = () => {
      this.hurt.classList.remove('on');
      void this.hurt.offsetWidth;
      this.hurt.classList.add('on');
      if (navigator.vibrate && IS_TOUCH) navigator.vibrate(30);
    };
    game.onPack = (offers) => this.openPack(offers);
    game.onOver = (s) => this.showOver(s);
    engine.onUpdate(() => this.tick());
    this.showMenu();
  }

  private build() {
    const r = this.root;
    // горна лента
    this.hud = el('div', 'hud hidden');
    this.hud.innerHTML = `
      <div class="hp"><div class="hp-ic">❤</div><div class="hp-bar"><i></i><span></span></div></div>
      <div class="mid"><div class="wave">Вълна 1</div><div class="time">0:00</div></div>
      <div class="right">
        <div class="kills"><b>☠</b><span>0</span></div>
        <button class="btn-ic btn-zoom" title="Камера: близо/далеч (колелцето)">🔍</button>
        <button class="btn-ic btn-pack" title="Раница (B)">🎒<em>1</em></button>
        <button class="btn-ic btn-pause" title="Пауза (Esc)">⏸</button>
      </div>`;
    r.appendChild(this.hud);
    this.hpFill = $('.hp-bar i', this.hud);
    this.hpText = $('.hp-bar span', this.hud);
    this.timeEl = $('.time', this.hud);
    this.waveEl = $('.wave', this.hud);
    this.killsEl = $('.kills span', this.hud);
    this.armsEl = $('.btn-pack em', this.hud);
    $('.btn-pause', this.hud).onclick = () => this.togglePause();
    $('.btn-pack', this.hud).onclick = () => this.game.openPack(false);
    $('.btn-zoom', this.hud).onclick = () => {
      const z = this.game.zoom;
      const next = z < 0.85 ? 1 : z < 1.15 ? 1.3 : 0.75;
      this.game.setZoom(next);
      this.toast(next < 0.85 ? 'Камера: близо' : next < 1.15 ? 'Камера: средно' : 'Камера: далеч');
    };

    this.bossBar = el('div', 'boss hidden', '<div class="boss-name">БОС</div><div class="boss-bar"><i></i></div>');
    this.bossFill = $('i', this.bossBar);
    r.appendChild(this.bossBar);

    this.banner = el('div', 'banner');
    r.appendChild(this.banner);
    this.hurt = el('div', 'hurt');
    r.appendChild(this.hurt);
    this.arrow = el('div', 'chest-arrow hidden', '<div class="ca-ic">🎁</div><div class="ca-tri"></div>');
    r.appendChild(this.arrow);
    this.hint = el('div', 'hint hidden');
    r.appendChild(this.hint);
    this.toastEl = el('div', 'toast');
    r.appendChild(this.toastEl);

    this.joy = el('div', 'joy hidden', '<div class="joy-knob"></div>');
    this.knob = $('.joy-knob', this.joy);
    r.appendChild(this.joy);

    this.menu = el('div', 'screen menu hidden');
    r.appendChild(this.menu);
    this.over = el('div', 'screen over hidden');
    r.appendChild(this.over);
    this.pauseEl = el('div', 'screen pause hidden');
    this.pauseEl.innerHTML = `<div class="panel"><h2>Пауза</h2><button class="big go">Продължи</button><button class="small menu-btn">Към менюто</button></div>`;
    $('.go', this.pauseEl).onclick = () => this.togglePause();
    $('.menu-btn', this.pauseEl).onclick = () => { this.pauseEl.classList.add('hidden'); this.game.state = 'menu'; this.game.engine.timeScale = 1; this.showMenu(); };
    r.appendChild(this.pauseEl);
    this.pack = el('div', 'screen pack hidden');
    r.appendChild(this.pack);
  }

  // ---------- меню ----------
  showMenu() {
    this.hud.classList.add('hidden');
    this.hint.classList.add('hidden');
    this.bossBar.classList.add('hidden');
    let best = { time: 0, kills: 0 };
    try { best = JSON.parse(localStorage.getItem('orda-best') || '{"time":0,"kills":0}'); } catch { /* */ }
    const q = this.engine.quality;
    const qName: Record<Quality, string> = { high: 'Висока', medium: 'Средна', low: 'Ниска' };
    this.menu.innerHTML = `
      <div class="title"><span>ОРДА</span><small>оцелей по покривите</small></div>
      <button class="big play">ИГРАЙ</button>
      ${best.time > 0 ? `<div class="best">Рекорд: <b>${fmtTime(best.time)}</b> · <b>${best.kills}</b> зомбита</div>` : ''}
      <div class="how">
        <div>🕹️ ${IS_TOUCH ? 'Плъзни пръст — героят тича' : 'WASD / стрелките — героят тича'}</div>
        <div>🔫 Механичните ръце стрелят сами</div>
        <div>🏢 Стигни ръба на покрива — скача до съседния</div>
        <div>🎁 Сандъци „Подобрение“ — нови оръжия</div>
        <div>✨ Две еднакви оръжия в раницата = по-силно</div>
      </div>
      <div class="opts">
        <button class="small q">Графика: ${qName[q]}</button>
        <button class="small snd">Звук: ${isMuted() ? 'изкл.' : 'вкл.'}</button>
      </div>`;
    this.menu.classList.remove('hidden');
    $('.play', this.menu).onclick = () => {
      audioUnlock();
      this.menu.classList.add('hidden');
      this.over.classList.add('hidden');
      this.hud.classList.remove('hidden');
      this.game.newGame();
      this.hintStep = 0;
      if (this.tutorial) this.setHint(IS_TOUCH ? 'Плъзни пръст по екрана, за да тичаш' : 'Тичай с WASD или стрелките');
    };
    $('.q', this.menu).onclick = () => {
      const order: Quality[] = ['high', 'medium', 'low'];
      this.engine.setQuality(order[(order.indexOf(q) + 1) % 3]);
    };
    $('.snd', this.menu).onclick = () => { setMuted(!isMuted()); this.showMenu(); };
  }

  private showOver(s: Stats) {
    this.hud.classList.add('hidden');
    this.bossBar.classList.add('hidden');
    this.hint.classList.add('hidden');
    const recT = s.time > s.best.time, recK = s.kills > s.best.kills;
    this.over.innerHTML = `
      <div class="panel">
        <h2>Ордата те погълна</h2>
        <div class="stats">
          <div><small>Оцеля</small><b>${fmtTime(s.time)}</b>${recT ? '<em>рекорд!</em>' : ''}</div>
          <div><small>Зомбита</small><b>${s.kills}</b>${recK ? '<em>рекорд!</em>' : ''}</div>
          <div><small>Вълна</small><b>${s.wave}</b></div>
        </div>
        <button class="big again">Пак!</button>
        <button class="small menu-btn">Меню</button>
      </div>`;
    this.over.classList.remove('hidden');
    $('.again', this.over).onclick = () => {
      this.over.classList.add('hidden');
      this.hud.classList.remove('hidden');
      this.game.newGame();
    };
    $('.menu-btn', this.over).onclick = () => { this.over.classList.add('hidden'); this.game.state = 'menu'; this.showMenu(); };
  }

  private togglePause() {
    if (this.game.state === 'play') { this.game.pause(true); this.pauseEl.classList.remove('hidden'); }
    else if (this.game.state === 'paused') { this.game.pause(false); this.pauseEl.classList.add('hidden'); }
  }

  private showBanner(text: string, kind: 'wave' | 'boss' | 'info' = 'wave') {
    this.banner.textContent = text;
    this.banner.className = 'banner ' + kind;
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
  }

  private setHint(t: string | null) {
    if (!t) { this.hint.classList.add('hidden'); return; }
    this.hint.textContent = t;
    this.hint.classList.remove('hidden');
  }

  // ---------- управление ----------
  private bindInput() {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.game.state === 'pack') this.closePack();
        else this.togglePause();
      }
      if (e.code === 'KeyB') {
        if (this.game.state === 'play') this.game.openPack(false);
        else if (this.game.state === 'pack') this.closePack();
      }
      if (e.code === 'Space' && this.game.state === 'menu') ($('.play', this.menu) as HTMLButtonElement | null)?.click();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    const canvas = this.engine.renderer.domElement;
    const start = (e: PointerEvent) => {
      if (this.game.state !== 'play' || this.joyId !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      audioUnlock();
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joy.style.left = e.clientX + 'px';
      this.joy.style.top = e.clientY + 'px';
      this.knob.style.transform = 'translate(-50%,-50%)';
      this.joy.classList.remove('hidden');
      canvas.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
      const R = 58;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        // джойстикът „влачи“ след пръста
        this.joyOrigin.x += (dx / d) * (d - R);
        this.joyOrigin.y += (dy / d) * (d - R);
        this.joy.style.left = this.joyOrigin.x + 'px';
        this.joy.style.top = this.joyOrigin.y + 'px';
        dx = (dx / d) * R; dy = (dy / d) * R;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // пълна скорост още при 70% от хода
      if (Math.hypot(dx, dy) < 6) { this.joyVec.x = this.joyVec.z = 0; }
      else {
        this.joyVec.x = (dx / R) * 1.4;
        this.joyVec.z = (dy / R) * 1.4;
        const l = Math.hypot(this.joyVec.x, this.joyVec.z);
        if (l > 1) { this.joyVec.x /= l; this.joyVec.z /= l; }
      }
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.joyVec.x = this.joyVec.z = 0;
      this.joy.classList.add('hidden');
    };
    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (this.game.state !== 'play') return;
      e.preventDefault();
      this.game.setZoom(this.game.zoom * (e.deltaY > 0 ? 1.08 : 1 / 1.08));
    }, { passive: false });
  }

  private readInput() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    const l = Math.hypot(x, z);
    if (l > 0) { x /= l; z /= l; }
    if (this.joyId !== null) { x = this.joyVec.x; z = this.joyVec.z; }
    // пишем само ако има управление (или току-що е пуснато) — така и тестовете могат да управляват
    const has = x !== 0 || z !== 0;
    if (has || this.hadInput) {
      this.game.input.x = x;
      this.game.input.z = z;
    }
    this.hadInput = has;
  }
  private hadInput = false;

  // ---------- всеки кадър ----------
  private v = new THREE.Vector3();
  private tick() {
    this.readInput();
    const g = this.game;
    if (g.state === 'menu') return;
    const h = g.hero;
    const f = h.hp / h.maxHp;
    this.hpFill.style.width = f * 100 + '%';
    this.hpFill.classList.toggle('low', f < 0.3);
    this.hpText.textContent = String(Math.ceil(h.hp));
    this.timeEl.textContent = fmtTime(g.time);
    this.waveEl.textContent = 'Вълна ' + g.wave;
    this.killsEl.textContent = String(g.kills);
    this.armsEl.textContent = String(g.arms.arms.length);

    // бос
    if (g.boss >= 0 && g.horde.state[g.boss] !== 0 && g.horde.state[g.boss] !== 5) {
      this.bossBar.classList.remove('hidden');
      this.bossFill.style.width = Math.max(0, (g.horde.hp[g.boss] / g.horde.maxHp[g.boss]) * 100) + '%';
    } else this.bossBar.classList.add('hidden');

    // стрелка към сандъка
    const c = g.chest;
    if (c && g.state === 'play') {
      this.v.set(c.x, c.b.h + 1, c.z).project(this.engine.camera);
      const W = innerWidth, H = innerHeight;
      let sx = (this.v.x * 0.5 + 0.5) * W, sy = (-this.v.y * 0.5 + 0.5) * H;
      const behind = this.v.z > 1;
      if (behind) { sx = W - sx; sy = H - sy; }
      const m = 46, top = 86;
      const inside = !behind && sx > m && sx < W - m && sy > top && sy < H - m;
      if (inside) this.arrow.classList.add('hidden');
      else {
        const cx = W / 2, cy = H / 2;
        const dx = sx - cx, dy = sy - cy;
        const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m - (top - m) / 2) / Math.abs(dy || 1e-6));
        const ax = cx + dx * k, ay = cy + dy * k + (top - m) / 4;
        this.arrow.classList.remove('hidden');
        this.arrow.style.left = ax + 'px';
        this.arrow.style.top = ay + 'px';
        ($('.ca-tri', this.arrow)).style.transform = `rotate(${Math.atan2(dy, dx)}rad) translateX(30px)`;
      }
    } else this.arrow.classList.add('hidden');

    // подсказки (само първия път)
    if (this.tutorial && g.state === 'play') {
      if (this.hintStep === 0 && Math.hypot(g.input.x, g.input.z) > 0.3) { this.hintStep = 1; this.setHint('Ръцете стрелят сами. Тичай до ръба — ще скочиш на съседния покрив!'); }
      else if (this.hintStep === 1 && g.hero.leap) { this.hintStep = 2; this.setHint(g.chest ? 'Стигни до сандъка „Подобрение“ 🎁' : null); }
      else if (this.hintStep === 2 && !g.chest && g.chestsOpened > 0) { this.hintStep = 3; this.setHint(null); }
      else if (this.hintStep === 1 && g.chest && g.time > 12) this.setHint('Скочи до покрива със сандъка „Подобрение“ 🎁');
    }
  }

  // ---------- раницата ----------
  private openPack(offers: Item[] | null) {
    this.offers = offers ?? [];
    this.offerTaken = false;
    this.pack.classList.remove('hidden');
    this.hint.classList.add('hidden');
    this.renderPack();
  }

  private closePack() {
    this.pack.classList.add('hidden');
    if (this.tutorial && this.hint.textContent) this.hint.classList.remove('hidden');
    this.game.closePack();
    if (this.tutorial && this.game.chestsOpened > 0) {
      this.tutorial = false;
      try { localStorage.setItem('orda-tut', 'done'); } catch { /* */ }
      this.setHint(null);
    }
  }

  private itemHTML(it: Item, extra = '') {
    const T = TIERS[it.tier];
    return `<div class="item t${it.tier} ${extra}" style="--tc:${T.color}">
      <img src="${weaponIcon(it.kind, it.tier)}" draggable="false" alt="">
      <div class="lvl">${'★'.repeat(it.tier)}</div>
    </div>`;
  }

  private renderPack() {
    const g = this.game;
    const n = BACKPACK.cols * BACKPACK.rows;
    const showOffers = this.offers.length > 0 && !this.offerTaken;
    let cells = '';
    for (let i = 0; i < n; i++) {
      const it = g.slots[i];
      cells += `<div class="cell" data-slot="${i}">${it ? this.itemHTML(it) : ''}</div>`;
    }
    const offers = showOffers
      ? this.offers
          .map((it, k) => {
            const T = TIERS[it.tier];
            return `<div class="offer" data-offer="${k}">
              ${this.itemHTML(it, 'large')}
              <div class="tag" style="background:${T.color}">${T.name}</div>
              <div class="oname">${WEAPONS[it.kind].name}</div>
            </div>`;
          })
          .join('')
      : '';
    const count = g.slots.filter(Boolean).length;
    this.pack.innerHTML = `
      <div class="pack-wrap">
        <div class="pack-title">${showOffers ? 'Избери оръжие!' : 'Раница'}</div>
        <div class="pack-sub">${showOffers ? 'Плъзни го в раницата · две еднакви = по-силно' : 'Плъзни еднакви едно върху друго, за да ги слееш'}</div>
        <div class="bag"><div class="bag-grid">${cells}</div></div>
        <div class="pack-info">Ръце: <b>${count}</b> / ${n}</div>
        <div class="offers">${offers}</div>
        <div class="pack-btns">
          <div class="trash" title="Изхвърли">🗑️</div>
          <button class="big go">${showOffers ? 'Пропусни' : 'Продължи'}</button>
        </div>
        <div class="details"></div>
      </div>`;
    $('.go', this.pack).onclick = () => this.closePack();
    this.bindDrag();
  }

  private showDetails(it: Item) {
    const d = $('.details', this.pack);
    const s = weaponStats(it.kind, it.tier);
    const w = WEAPONS[it.kind];
    const extra = w.mode === 'pellets' ? ` · ${s.pellets} сачми` : s.pierce ? ` · пробива ${s.pierce}` : s.aoe ? ` · взрив ${s.aoe.toFixed(1)} м` : '';
    d.innerHTML = `<b style="color:${TIERS[it.tier].color}">${w.name}</b> — ${TIERS[it.tier].name}<br>щета ${Math.round(s.dmg)} · ${s.rate.toFixed(1)}/сек · обхват ${Math.round(s.range)} м${extra}${it.tier < MAX_TIER ? '<br><small>Слей с още едно такова → ' + TIERS[it.tier + 1].name + '</small>' : ''}`;
  }

  private bindDrag() {
    const g = this.game;
    type Src = { type: 'offer' | 'slot'; idx: number; item: Item };
    let src: Src | null = null;
    let ghost: HTMLElement | null = null;
    let sx = 0, sy = 0, moved = false;
    let over: HTMLElement | null = null;

    const targetAt = (x: number, y: number) => {
      const e = document.elementFromPoint(x, y) as HTMLElement | null;
      return (e?.closest('.cell, .trash') as HTMLElement | null) ?? null;
    };
    const highlight = (on: boolean) => {
      if (!src) return;
      this.pack.querySelectorAll<HTMLElement>('.cell').forEach((c) => {
        const it = g.slots[+c.dataset.slot!];
        const same = !!it && it.kind === src!.item.kind && it.tier === src!.item.tier && it.tier < MAX_TIER && !(src!.type === 'slot' && +c.dataset.slot! === src!.idx);
        c.classList.toggle('mergeable', on && same);
      });
    };

    const down = (e: PointerEvent, s: Src, node: HTMLElement) => {
      e.preventDefault();
      src = s;
      sx = e.clientX; sy = e.clientY; moved = false;
      ghost = node.querySelector('.item')!.cloneNode(true) as HTMLElement;
      ghost.classList.add('ghost');
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
      document.body.appendChild(ghost);
      ghost.style.display = 'none';
      node.classList.add('lifting');
      highlight(true);
      this.showDetails(s.item);
      addEventListener('pointermove', mv);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    };
    const mv = (e: PointerEvent) => {
      if (!ghost) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { moved = true; ghost.style.display = ''; }
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
      const t = targetAt(e.clientX, e.clientY);
      if (t !== over) { over?.classList.remove('over'); over = t; over?.classList.add('over'); }
    };
    const up = (e: PointerEvent) => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      ghost?.remove();
      ghost = null;
      over?.classList.remove('over');
      over = null;
      highlight(false);
      const s = src;
      src = null;
      this.pack.querySelectorAll('.lifting').forEach((n) => n.classList.remove('lifting'));
      if (!s) return;
      if (!moved) {
        // докосване: оферта → сама в раницата
        if (s.type === 'offer') this.autoPlace(s.item);
        return;
      }
      const t = targetAt(e.clientX, e.clientY);
      if (!t) return;
      if (t.classList.contains('trash')) {
        if (s.type === 'slot') { g.remove(s.idx); sfx.drop(); this.renderPack(); }
        return;
      }
      const slot = +t.dataset.slot!;
      const res = g.put(s.item, slot, s.type === 'slot' ? s.idx : null);
      if (res) {
        if (s.type === 'offer') this.offerTaken = true;
        this.afterPut(res, slot);
      }
    };

    this.pack.querySelectorAll<HTMLElement>('.offer').forEach((o) => {
      const k = +o.dataset.offer!;
      o.onpointerdown = (e) => down(e, { type: 'offer', idx: k, item: this.offers[k] }, o);
    });
    this.pack.querySelectorAll<HTMLElement>('.cell').forEach((c) => {
      const i = +c.dataset.slot!;
      const it = g.slots[i];
      if (it) c.onpointerdown = (e) => down(e, { type: 'slot', idx: i, item: it }, c);
    });
  }

  private afterPut(res: 'place' | 'merge' | 'swap', slot: number) {
    if (res === 'merge') sfx.merge(); else sfx.pick();
    this.renderPack();
    const cell = this.pack.querySelector(`.cell[data-slot="${slot}"]`);
    if (res === 'merge' && cell) {
      cell.classList.add('merged');
      const it = this.game.slots[slot]!;
      this.toast(`${WEAPONS[it.kind].name} → ${TIERS[it.tier].name}!`);
      this.showDetails(it);
    }
  }

  private autoPlace(item: Item) {
    const g = this.game;
    let slot = g.slots.findIndex((s) => s && s.kind === item.kind && s.tier === item.tier && s.tier < MAX_TIER);
    if (slot < 0) slot = g.slots.findIndex((s) => !s);
    if (slot < 0) {
      this.toast('Раницата е пълна — слей еднакви или изхвърли нещо');
      return;
    }
    const res = g.put(item, slot, null);
    if (res) {
      this.offerTaken = true;
      this.afterPut(res, slot);
    }
  }
}
