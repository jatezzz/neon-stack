/*
    Neon Stack: one tap drops the sliding block; whatever hangs over the floor below is cut off. A miss ends the tower.

    The day decides each floor's speed, the side it comes from and which blocks are golden (double points), so
    everyone stacks the same tower that day. Physics runs at a fixed 120 steps per second.

    Screens: title -> play -> falling (the missed block drops, the camera pulls back) -> over.
    Pause: Esc or P, the corner button, the page going to the background, or the portal's own pause button.
*/
(function () {
    'use strict';

    var W = 400, H = 640, TOP = 52;
    var STEP = 1 / 120;
    var BH = 26;                 // block height
    var START_W = 220;           // width of the first block
    var BASE_Y = 560;            // screen y of the top of the base when the tower is short
    var PERFECT = 4;             // px: a drop this close to the floor below counts as perfect and is not cut
    var GROW = 10;               // px a block grows back on a perfect streak of four or more

    var I = window.NeonI18n, D = window.NeonDaily;

    //  The stage from the game's cover (img/bg.jpg): night sky, sun and mountains, the grid floor the tower stands on.
    //  It scrolls at a quarter of the tower's speed, so climbing has depth. The plain gradient shows until it loads.
    var BACKDROP = new Image(), backdropReady = false;
    BACKDROP.onload = function () { backdropReady = true; };
    BACKDROP.src = 'img/bg.jpg?v=1';
    function t(key, vars) { return I ? I.t(key, vars) : key; }
    function num(n) { return I ? I.number(n) : String(n); }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function calm() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    function mulberry(seed) {
        var a = seed >>> 0;
        return function () { a = (a + 0x6D2B79F5) >>> 0; var x = Math.imul(a ^ (a >>> 15), a | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    }

    // ------------------------------------------------------------------------------------- the tower of the day

    //  Everything the day decides, floor by floor: speed, starting side, golden or not, and the colour of the tower.
    function dayPlan() {
        var rng = D ? D.rng('tower') : mulberry(12345);
        var hue = Math.floor(rng() * 360);
        var floors = [];
        for (var n = 1; n <= 400; n++) {
            var base = Math.min(150 + 7 * n, 470);
            floors.push({
                speed: base * (0.88 + rng() * 0.24),
                fromLeft: rng() < 0.5,
                golden: n >= 5 && rng() < 0.09
            });
        }
        return { hue: hue, floors: floors };
    }
    //  Floors walk through the universe's palette, one colour per floor like the cover; yellow is for golden blocks.
    var TOWER = ['#00f0ff', '#ff00c8', '#00ff9c', '#b14dff', '#3d8bff', '#ff4fa3'];
    function floorColor(plan, n) { return TOWER[(Math.floor(plan.hue / 60) + n) % TOWER.length]; }

    // ------------------------------------------------------------------------------------- sound

    function Sound() {
        this.mute = false;
        try { this.mute = window.localStorage.getItem('ns.mute') === '1'; } catch (err) { /* no storage */ }
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { this.ctx = null; }
    }
    Sound.prototype.tone = function (freq, seconds, type, volume, slideTo, delay) {
        if (this.mute || !this.ctx) { return; }
        try {
            var c = this.ctx, at = c.currentTime + (delay || 0);
            var o = c.createOscillator(), g = c.createGain();
            o.type = type || 'square';
            o.frequency.setValueAtTime(freq, at);
            if (slideTo) { o.frequency.exponentialRampToValueAtTime(slideTo, at + seconds); }
            g.gain.setValueAtTime(volume || 0.08, at);
            g.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
            o.connect(g); g.connect(c.destination);
            o.start(at); o.stop(at + seconds + 0.02);
        } catch (err) { /* sound must never break the game */ }
    };
    Sound.prototype.toggle = function () {
        this.mute = !this.mute;
        try { window.localStorage.setItem('ns.mute', this.mute ? '1' : '0'); } catch (err) { /* no storage */ }
        return this.mute;
    };
    Sound.prototype.unlock = function () { if (this.ctx && this.ctx.state === 'suspended') { this.ctx.resume(); } };

    // ------------------------------------------------------------------------------------- the game

    function Game(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.sound = new Sound();
        this.events = [];
        this.state = 'title';
        this.paused = false;
        this.time = 0;
        this.fx = { shake: 0, mag: 0, flash: 0, flashColor: '#ffffff' };
        this.particles = []; this.texts = []; this.pieces = [];
        this.best = D ? D.todayProgress().best : 0;
        this.streak = D ? D.currentStreak() : 0;
        this.plan = dayPlan();
        this.resetRun();
        this.resize();
    }

    Game.prototype.log = function (name, extra) {
        var e = { ev: name, at: Date.now(), t: Math.round(this.time * 1000) / 1000, score: this.score };
        if (extra) { for (var k in extra) { e[k] = extra[k]; } }
        this.events.push(e);
        if (window.NeonStage) { window.NeonStage.event(name, e); }      // the shared universe reacts (neon-stage.js)
        if (this.events.length > 4000) { this.events.shift(); }
    };

    Game.prototype.resetRun = function () {
        this.score = 0;
        this.floors = 0;
        this.tower = [{ x: (W - START_W) / 2, w: START_W, color: '#2a2f55' }];    // the base
        this.block = null;
        this.perfectStreak = 0;
        this.stats = { perfects: 0, bestStreak: 0, golden: 0 };
        this.cam = 0; this.camTarget = 0; this.zoom = 1; this.zoomTarget = 1;
        this.goalPassed = false;
        this.fallFor = 0;
        this.reported = -1;
    };

    Game.prototype.startRun = function () {
        this.resetRun();
        this.pieces = []; this.particles = []; this.texts = [];
        if (D) { D.onRunStart(); }
        this.log('run');
        this.state = 'play';
        this.nextBlock();
        this.announce();
    };

    Game.prototype.restart = function () { if (this.state === 'over') { this.startRun(); } };

    //  The next block slides in from the side the day says, as wide as the floor below.
    Game.prototype.nextBlock = function () {
        var n = this.floors + 1, f = this.plan.floors[Math.min(n, this.plan.floors.length) - 1];
        var top = this.tower[this.tower.length - 1];
        var w = top.w;
        this.block = {
            n: n, w: w, golden: f.golden,
            x: f.fromLeft ? -w * 0.5 : W - w * 0.5,
            dir: f.fromLeft ? 1 : -1,
            speed: f.speed * (f.golden ? 1.25 : 1),
            color: f.golden ? '#ffd23c' : floorColor(this.plan, n)
        };
        //  Keep the moving block about a third of the way down the screen.
        this.camTarget = Math.max(0, (this.tower.length - 12) * BH);
    };

    //  Tap: drop the block onto the floor below.
    Game.prototype.drop = function () {
        if (this.state !== 'play' || !this.block) { return; }
        var b = this.block, top = this.tower[this.tower.length - 1];
        var left = Math.max(b.x, top.x), right = Math.min(b.x + b.w, top.x + top.w);
        var overlap = right - left;
        if (overlap <= 0) { this.miss(); return; }
        var perfect = Math.abs(b.x - top.x) <= PERFECT;
        var placed;
        if (perfect) {
            this.perfectStreak += 1;
            this.stats.perfects += 1;
            if (this.perfectStreak > this.stats.bestStreak) { this.stats.bestStreak = this.perfectStreak; }
            var w = top.w;
            if (this.perfectStreak >= 4) { w = Math.min(START_W, top.w + GROW); }
            placed = { x: top.x - (w - top.w) / 2, w: w, color: b.color, golden: b.golden };
        } else {
            this.perfectStreak = 0;
            placed = { x: left, w: overlap, color: b.color, golden: b.golden };
            //  The cut-off piece falls away.
            var cutX = b.x < top.x ? b.x : right, cutW = b.w - overlap;
            this.pieces.push({ x: cutX, y: this.worldY(this.tower.length), w: cutW, vx: (b.x < top.x ? -1 : 1) * 40, vy: 0, rot: 0, vr: (b.x < top.x ? -1 : 1) * 2.5, color: b.color });
        }
        this.tower.push(placed);
        this.floors += 1;
        var points = (b.golden ? 20 : 10) + (perfect ? 5 * Math.min(this.perfectStreak, 6) : 0);
        this.addScore(points);
        if (b.golden) { this.stats.golden += 1; }
        this.log('drop', { floor: this.floors, perfect: perfect, streak: this.perfectStreak, w: Math.round(placed.w), golden: b.golden, points: points });
        //  Feel: a small shake, a pitch that climbs with a perfect streak, a burst on perfect drops.
        var y = this.screenY(this.floors) + BH / 2;
        this.burst(placed.x + placed.w / 2, y - BH / 2, '#ffdc3c', perfect ? 10 : 6);      // landing sparks, every drop
        if (perfect) {
            this.burst(placed.x + placed.w / 2, y, b.color, 14);
            this.texts.push({ x: W / 2, y: y - 30, text: t('wall.clear') + (this.perfectStreak > 1 ? ' ×' + this.perfectStreak : ''), life: 0.8, max: 0.8, color: '#ffffff' });
            this.sound.tone(440 * Math.pow(2, Math.min(this.perfectStreak, 12) / 12), 0.12, 'triangle', 0.09);
            this.ring = { x: placed.x + placed.w / 2, y: y, w: placed.w, life: 0.4 };
        } else {
            this.sound.tone(200 + Math.min(this.floors, 40) * 6, 0.07, 'square', 0.07);
        }
        if (b.golden) { this.texts.push({ x: W / 2, y: y - 54, text: t('power.wide'), life: 1, max: 1, color: '#ffd23c' }); }
        this.impact(perfect ? 2 : 1.2, 0.08);
        try { if (navigator.vibrate) { navigator.vibrate(perfect ? 15 : 8); } } catch (err) { /* not allowed */ }
        this.nextBlock();
    };

    Game.prototype.miss = function () {
        var b = this.block;
        this.pieces.push({ x: b.x, y: this.worldY(this.tower.length), w: b.w, vx: b.dir * 60, vy: 0, rot: 0, vr: b.dir * 3, color: b.color });
        this.block = null;
        this.log('miss', { floor: this.floors });
        this.impact(5, 0.3, '#ff00c8', [50, 30, 50]);
        this.sound.tone(300, 0.5, 'sawtooth', 0.08, 60);
        this.state = 'falling';
        this.fallFor = 1.6;
        //  Pull the camera back so the whole tower fits on the screen.
        var height = this.tower.length * BH + 40;
        this.zoomTarget = Math.min(1, (BASE_Y - TOP - 30) / height);
        this.camTarget = 0;
        this.announce();
    };

    Game.prototype.gameOver = function () {
        this.state = 'over';
        this.log('over', { floors: this.floors });
        this.announce();
        var share = null, last = null;
        if (D) {
            D.onGameOver(this);
            share = D.shareMessage(); last = D.lastResult();
            this.best = D.todayProgress().best; this.streak = D.currentStreak();
        }
        if (window.PortalSDK && window.PortalSDK.gameOver) {
            var sdkArgs = [this.score, { level: this.floors, share: share, outcome: last && last.outcome,
                headline: last && last.headline, joke: last && last.joke }];
            //  Let the shared celebration play over the game before the portal covers it with its own screen.
            setTimeout(function () { window.PortalSDK.gameOver.apply(window.PortalSDK, sdkArgs); }, window.NeonFx ? window.NeonFx.portalDelay() : 0);
        }
    };

    Game.prototype.addScore = function (points) {
        this.score += points;
        var goal = D && D.target;
        if (goal && !this.goalPassed && this.score > goal.score) {
            this.goalPassed = true;
            this.log('goal');
            this.texts.push({ x: W / 2, y: 140, text: t('target.passed', { t: num(goal.score) }), life: 1.6, max: 1.6, big: true, color: '#ffdc3c' });
            this.sound.tone(880, 0.25, 'triangle', 0.08, 1320);
        }
    };

    // ---------------------------------------------------------------- pause

    Game.prototype.announce = function () {
        try { document.body.setAttribute('data-state', this.paused ? 'paused' : this.state); } catch (err) { /* no page */ }
    };
    Game.prototype.pause = function () {
        if (this.paused || this.state !== 'play') { return false; }
        this.paused = true; this.log('pause'); this.announce(); return true;
    };
    Game.prototype.resume = function () {
        if (!this.paused) { return false; }
        this.paused = false; this.last = null; this.log('resume'); this.announce(); return true;
    };
    Game.prototype.requestPause = function (paused) {
        var sdk = window.PortalSDK;
        if (sdk && sdk.pause && sdk.resume) { if (paused) { sdk.pause(); } else { sdk.resume(); } }
        return paused ? this.pause() : this.resume();
    };

    // ---------------------------------------------------------------- input

    function overlayShown() { var o = document.getElementById('gameover'); return !!(o && !o.hidden); }

    //  The one action: start, drop, resume, or play again.
    Game.prototype.action = function () {
        this.sound.unlock();
        if (this.paused) { this.requestPause(false); return; }
        if (this.state === 'title') { this.startRun(); return; }
        if (this.state === 'play') { this.drop(); return; }
        if (this.state === 'over' && !(D && D.locked()) && !overlayShown()) { this.startRun(); }
    };
    Game.prototype.keyDown = function (code) {
        if (code === 27 || code === 80) { this.requestPause(!this.paused); return; }
        if (code === 32 || code === 13 || code === 40) {
            if (this.state === 'over') { if (!(D && D.locked())) { this.startRun(); } return; }
            this.action();
        }
    };
    Game.prototype.keyUp = function () {};

    // ---------------------------------------------------------------- simulation

    Game.prototype.worldY = function (k) { return -k * BH; };                   // top of floor k (0 = base), world units
    Game.prototype.screenY = function (k) { return BASE_Y + this.worldY(k) + this.cam; };

    Game.prototype.update = function (dt) {
        this.time += dt;
        if (this.state === 'play' && this.block) {
            var b = this.block;
            b.x += b.dir * b.speed * dt;
            var minX = -b.w * 0.55, maxX = W - b.w * 0.45;
            if (b.x < minX) { b.x = minX; b.dir = 1; }
            if (b.x > maxX) { b.x = maxX; b.dir = -1; }
        }
        if (this.state === 'falling') {
            this.fallFor -= dt;
            if (this.fallFor <= 0) { this.gameOver(); }
        }
        this.cam += (this.camTarget - this.cam) * Math.min(1, dt * 6);
        this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 3);
        for (var i = this.pieces.length - 1; i >= 0; i--) {
            var p = this.pieces[i];
            p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
            if (p.y > 900) { this.pieces.splice(i, 1); }
        }
        this.updateEffects(dt);
        if (window.PortalSDK && window.PortalSDK.reportScore && this.score !== this.reported && this.state !== 'title') {
            this.reported = this.score;
            window.PortalSDK.reportScore(this.score);
        }
    };

    Game.prototype.impact = function (magnitude, seconds, flashColor, vibrate) {
        if (!calm()) { this.fx.shake = seconds; this.fx.mag = magnitude; if (flashColor) { this.fx.flash = 0.2; this.fx.flashColor = flashColor; } }
        try { if (vibrate && navigator.vibrate) { navigator.vibrate(vibrate); } } catch (err) { /* not allowed */ }
    };
    Game.prototype.burst = function (x, y, color, count) {
        for (var i = 0; i < count && this.particles.length < 300; i++) {
            var a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
            this.particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.5 + Math.random() * 0.3, color: color });
        }
    };
    Game.prototype.updateEffects = function (dt) {
        if (this.fx.shake > 0) { this.fx.shake -= dt; }
        if (this.fx.flash > 0) { this.fx.flash -= dt; }
        if (this.ring) { this.ring.life -= dt; if (this.ring.life <= 0) { this.ring = null; } }
        for (var i = this.particles.length - 1; i >= 0; i--) {
            var q = this.particles[i];
            q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 500 * dt; q.life -= dt;
            if (q.life <= 0) { this.particles.splice(i, 1); }
        }
        for (var j = this.texts.length - 1; j >= 0; j--) {
            var tx = this.texts[j]; tx.life -= dt; if (!tx.big) { tx.y -= 30 * dt; }
            if (tx.life <= 0) { this.texts.splice(j, 1); }
        }
    };

    // ---------------------------------------------------------------- drawing

    Game.prototype.resize = function () {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var r = this.canvas.getBoundingClientRect();
        var cssW = r.width || W;
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssW * H / W * dpr);
        this.ratio = this.canvas.width / W;
    };

    function roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    //  A glass cube, like the cover: two faces split by a bright vertical edge, light from above, glowing rims.
    function drawBlock(ctx, x, y, w, color, glow, golden) {
        ctx.save();
        if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
        ctx.fillStyle = color; ctx.globalAlpha = 0.9;
        roundRect(ctx, x, y + 1, w, BH - 2, 3); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        var gl = ctx.createLinearGradient(0, y, 0, y + BH);
        gl.addColorStop(0, 'rgba(255,255,255,0.45)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.05)'); gl.addColorStop(1, 'rgba(0,0,0,0.3)');
        ctx.fillStyle = gl; roundRect(ctx, x, y + 1, w, BH - 2, 3); ctx.fill();
        if (w > 16) {
            ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x + 1, y + 2, w / 2 - 1, BH - 4);            // the left face, in shade
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(x + w / 2 - 0.75, y + 2, 1.5, BH - 4);  // the front edge
        }
        ctx.strokeStyle = golden ? '#ffffff' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = golden ? 2 : 1.2;
        roundRect(ctx, x + 0.6, y + 1.6, w - 1.2, BH - 3.2, 3); ctx.stroke();
        ctx.restore();
    }

    Game.prototype.draw = function () {
        var ctx = this.ctx, i;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
        //  Background: the cover's stage, scrolling slowly as the tower grows; the old gradient until it loads.
        if (backdropReady) {
            var bs = Math.max(W / BACKDROP.width, H / BACKDROP.height), bw = BACKDROP.width * bs, bh = BACKDROP.height * bs;
            var by = (H - bh) / 2 + this.cam * 0.25;
            ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, W, H);
            ctx.drawImage(BACKDROP, (W - bw) / 2, by, bw, bh);
            if (by > 0) {                       // above the picture: the sky keeps going, dark
                var sky = ctx.createLinearGradient(0, by - 40, 0, by + 30);
                sky.addColorStop(0, 'rgba(5,6,15,1)'); sky.addColorStop(1, 'rgba(5,6,15,0)');
                ctx.fillStyle = sky; ctx.fillRect(0, 0, W, by + 30);
            }
            ctx.fillStyle = 'rgba(5,6,15,0.3)'; ctx.fillRect(0, 0, W, H);
        } else {
            var g = ctx.createLinearGradient(0, 0, 0, H), heat = Math.min(this.floors / 60, 1);
            g.addColorStop(0, 'hsl(' + (235 - heat * 40) + ', 60%, ' + (4 + heat * 6) + '%)'); g.addColorStop(1, '#140a2a');
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
            ctx.strokeStyle = 'rgba(177,77,255,0.10)'; ctx.lineWidth = 1;
            var off = this.cam % 40;
            for (var gx = 0; gx <= W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, TOP); ctx.lineTo(gx, H); ctx.stroke(); }
            for (var gy = TOP + off; gy <= H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
        }

        ctx.save();
        if (this.fx.shake > 0 && !this.paused) { ctx.translate((Math.random() - 0.5) * this.fx.mag * 2, (Math.random() - 0.5) * this.fx.mag * 2); }
        //  Zoom out around the base when the tower is shown whole.
        if (this.zoom < 0.999) { ctx.translate(W / 2, BASE_Y + 20); ctx.scale(this.zoom, this.zoom); ctx.translate(-W / 2, -(BASE_Y + 20)); }

        //  The tower: only the floors on screen get a glow.
        var first = 0;
        for (i = 0; i < this.tower.length; i++) {
            var f = this.tower[i], y = this.screenY(i);
            if (this.zoom > 0.999 && (y > H + BH || y < TOP - BH)) { continue; }
            if (i === 0) {
                //  The pedestal: dark, with a neon edge, fading into the floor.
                var pg = ctx.createLinearGradient(0, y, 0, y + 90);
                pg.addColorStop(0, '#2a2f55'); pg.addColorStop(1, 'rgba(42,47,85,0)');
                ctx.fillStyle = pg; ctx.fillRect(f.x - 14, y, f.w + 28, 90);
                ctx.save(); ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 12; ctx.fillStyle = '#00f0ff';
                ctx.fillRect(f.x - 14, y, f.w + 28, 3); ctx.restore();
                continue;
            }
            first++;
            drawBlock(ctx, f.x, y, f.w, f.color, this.zoom > 0.999 && i > this.tower.length - 14 ? 10 : 0, f.golden);
        }
        //  The perfect-drop ring.
        if (this.ring) {
            ctx.save(); ctx.globalAlpha = this.ring.life / 0.4; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
            var grow = (0.4 - this.ring.life) * 60;
            roundRect(ctx, this.ring.x - this.ring.w / 2 - grow, this.ring.y - BH / 2 - grow / 2, this.ring.w + grow * 2, BH + grow, 6); ctx.stroke();
            ctx.restore();
        }
        //  The moving block.
        if (this.block && this.state === 'play') {
            var b = this.block, by = this.screenY(this.tower.length);
            drawBlock(ctx, b.x, by, b.w, b.color, 16, b.golden);
            //  A faint guide under it: where the floor below is.
            var top = this.tower[this.tower.length - 1];
            ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.setLineDash([4, 6]);
            ctx.beginPath(); ctx.moveTo(top.x, by + BH); ctx.lineTo(top.x, by); ctx.moveTo(top.x + top.w, by + BH); ctx.lineTo(top.x + top.w, by); ctx.stroke();
            ctx.setLineDash([]);
        }
        //  Falling pieces.
        for (i = 0; i < this.pieces.length; i++) {
            var p = this.pieces[i], py = BASE_Y + p.y + this.cam;
            ctx.save(); ctx.translate(p.x + p.w / 2, py + BH / 2); ctx.rotate(p.rot); ctx.globalAlpha = 0.85;
            drawBlock(ctx, -p.w / 2, -BH / 2, p.w, p.color, 0, false); ctx.restore();
        }
        ctx.restore();

        for (i = 0; i < this.particles.length; i++) {
            var q = this.particles[i];
            //  Sparks: short streaks along their motion, like the cover's landing sparks.
            ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 2)); ctx.strokeStyle = q.color; ctx.lineWidth = 2;
            var sp = Math.sqrt(q.vx * q.vx + q.vy * q.vy) || 1;
            ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx / sp * 7, q.y - q.vy / sp * 7); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        for (i = 0; i < this.texts.length; i++) {
            var tx = this.texts[i];
            ctx.globalAlpha = Math.min(1, tx.life / tx.max * 2);
            this.center(ctx, tx.text, tx.y, tx.big ? 24 : 16, tx.color, true);
        }
        ctx.globalAlpha = 1;

        this.drawHud(ctx);
        if (this.fx.flash > 0) { ctx.fillStyle = this.fx.flashColor; ctx.globalAlpha = Math.min(0.35, this.fx.flash); ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
        if (this.state === 'title') { this.drawTitle(ctx); }
        if (this.state === 'play' && this.floors < 2 && !this.paused) { this.center(ctx, t(this.touch ? 'launch.touch' : 'launch.desktop'), 150, 15, '#b0b0c0'); }
        if (this.state === 'over' || this.state === 'falling') { this.center(ctx, t('hud.wall', { n: this.floors }), 110, 30, '#ffffff', true); }
        if (this.paused) { this.drawPause(ctx); }
    };

    Game.prototype.center = function (ctx, text, y, size, color, glow) {
        if (window.NeonStage && window.NeonStage.text) { window.NeonStage.text.center(ctx, text, W / 2, y, size, color, glow); return; }      // reads on any stage (neon-stage.js)
        ctx.save();
        ctx.font = 'bold ' + size + 'px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
        ctx.fillStyle = color; ctx.fillText(text, W / 2, y);
        ctx.restore();
    };

    Game.prototype.drawHud = function (ctx) {
        ctx.fillStyle = 'rgba(5,6,15,0.85)'; ctx.fillRect(0, 0, W, TOP);
        ctx.strokeStyle = '#00f0ff'; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(0, TOP - 0.5); ctx.lineTo(W, TOP - 0.5); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.font = 'bold 22px Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff'; ctx.fillText(num(this.score), 12, 20);
        var goal = D && D.target;
        if (goal) {
            ctx.font = 'bold 12px Arial, sans-serif';
            ctx.fillStyle = this.goalPassed ? '#00ff9c' : '#ffdc3c';
            ctx.fillText(t('target.hud', { t: num(goal.score) }) + (this.goalPassed ? ' ✓' : ''), 12, 41);
        }
        ctx.textAlign = 'center'; ctx.font = 'bold 14px Arial, sans-serif'; ctx.fillStyle = '#00f0ff';
        ctx.fillText(t('hud.wall', { n: this.floors }), W / 2 - 10, 20);
        if (this.perfectStreak > 1) { ctx.fillStyle = '#ffffff'; ctx.font = 'bold 12px Arial, sans-serif'; ctx.fillText('✨×' + this.perfectStreak, W / 2 - 10, 40); }
    };

    Game.prototype.drawTitle = function (ctx) {
        //  The cover art behind the title (img/cover.jpg), dimmed; the plain dark veil until it loads.
        if (!(window.NeonStage && window.NeonStage.cover(ctx, 0, TOP, W, H - TOP, 0.5))) {
            ctx.fillStyle = 'rgba(5,6,15,0.55)'; ctx.fillRect(0, TOP, W, H - TOP);
        }
        //  The game's 3D logo (Blender, img/logo.png); the chrome words until it loads.
        if (!(window.NeonStage && window.NeonStage.text && window.NeonStage.text.logo(ctx, W / 2, 190, 320))) {
            this.center(ctx, 'NEON', 170, 54, '#ff00c8', true);
            this.center(ctx, 'STACK', 225, 54, '#00f0ff', true);
        }
        if (D) {
            this.center(ctx, t(D.otherDay() ? 'title.shared' : 'title.daily', { n: D.challengeNumber(), date: I.shortDate(D.today()) }), 285, 16, '#ffffff');
            var goal = D.target;
            if (goal) {
                this.center(ctx, t(goal.by === 'bot' ? 'target.title.bot' : 'target.title.player', { t: num(goal.score) }), 330, 18, '#ffdc3c', true);
                this.center(ctx, t(goal.verified ? 'target.verified' : 'target.declared'), 354, 12, goal.verified ? '#00ff9c' : '#b0b0c0');
            }
            if (this.best || this.streak) { this.center(ctx, t('title.status', { best: num(this.best), streak: this.streak }), 390, 13, '#b0b0c0'); }
            if (!D.onPortal && !D.hosted) { this.center(ctx, t('title.more', { host: D.CONFIG.portalHost }), 620, 12, '#00ff9c'); }
        }
        if (window.NeonStage && window.NeonStage.text) {
            window.NeonStage.text.plate(ctx, t(this.touch ? 'title.start.touch' : 'title.start.desktop'), W / 2, 450, 18, '#ffffff', Math.abs(Math.sin(this.time * 3)));
        } else {
            ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(this.time * 3));
            this.center(ctx, t(this.touch ? 'title.start.touch' : 'title.start.desktop'), 450, 18, '#ffffff', true);
            ctx.globalAlpha = 1;
        }
    };

    Game.prototype.drawPause = function (ctx) {
        ctx.fillStyle = 'rgba(5,6,15,0.6)'; ctx.fillRect(0, TOP, W, H - TOP);
        this.center(ctx, t('paused'), 300, 34, '#ffffff', true);
        this.center(ctx, t(this.touch ? 'paused.hint.touch' : 'paused.hint'), 340, 14, '#b0b0c0');
    };

    // ---------------------------------------------------------------- the loop

    Game.prototype.frame = function (now) {
        var self = this;
        if (this.last == null) { this.last = now; }
        var elapsed = Math.min((now - this.last) / 1000, 0.1);
        this.last = now;
        if (!this.paused) {
            this.acc = (this.acc || 0) + elapsed;
            while (this.acc >= STEP) { this.update(STEP); this.acc -= STEP; }
        } else {
            this.time += elapsed;
        }
        this.draw();
        window.requestAnimationFrame(function (n) { self.frame(n); });
    };

    Game.prototype.start = function () {
        var self = this;
        if (window.PortalSDK && window.PortalSDK.on) {
            window.PortalSDK.on('PAUSE', function () { self.pause(); });
            window.PortalSDK.on('RESUME', function () { self.resume(); });
        }
        this.announce();
        window.requestAnimationFrame(function (n) { self.frame(n); });
    };

    window.NeonStack = { Game: Game, dayPlan: dayPlan, W: W, H: H, BH: BH, PERFECT: PERFECT };
})();
