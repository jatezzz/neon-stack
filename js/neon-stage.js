/*
    Neon Stage: the layer every Neon game shares so they feel like one universe (Neon Raiders, Neon Bricks,
    Neon Stack, Neon Command). The same file ships in each game; only window.NeonStageConfig changes.

    - The whole window: the game's own stage picture (img/bg.jpg, the cover's sky, sun, mountains and grid) blurred
      behind everything, a vignette, and the play area framed in neon.
    - Big moments light the edges of the whole window (pulse), the way the covers glow.
    - Music: one synthwave theme for the whole universe (the same four chords everywhere), each game in its own key and
      tempo. It follows the game: full while playing, muffled on the title and in pause, it fades at the end. It grows
      with the game (intensity). Off with the game's own mute, or with the "música" link it adds.
    - Stingers for the end of a run (win, best, lose) and for big moments, and a sound kit (sfx) in the same voice.

        window.NeonStageConfig = {
            game: 'neon-bricks',
            play: ['play', 'serve'],          // body[data-state] values where the music plays full
            over: ['over'],                   // where it fades out
            muted: function () { return game.sound.mute; }
        };
        NeonStage.event(name, data)    // the game's own events (its log) -> reactions
        NeonStage.pulse(color, strength), NeonStage.intensity(0..1), NeonStage.stinger(kind), NeonStage.sfx(name)

    Everything is optional and wrapped: if audio or the DOM is missing, the game plays as before.
    People who ask their system for less motion get no drift and softer pulses. Plain JS, no files besides bg.jpg.
*/
(function () {
    'use strict';

    var CFG = window.NeonStageConfig || {};
    var GAME = CFG.game || 'neon';
    var PLAY = CFG.play || ['play'], OVER = CFG.over || ['over'];
    var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var script = document.currentScript;
    var BASE = script && script.src ? script.src.replace(/js\/neon-stage\.js.*$/, '') : '';

    //  Each game plays the same theme in its own key (semitones from A minor) and tempo.
    var FLAVOUR = {
        'neon-raiders': { tempo: 124, shift: 2, arp: 16 },
        'neon-bricks': { tempo: 116, shift: 0, arp: 16 },
        'neon-stack': { tempo: 100, shift: 3, arp: 8, arpAlways: true },
        'neon-command': { tempo: 92, shift: -2, arp: 16, bass16: true }
    };
    var FL = FLAVOUR[GAME] || FLAVOUR['neon-bricks'];

    var COLOR = { cyan: 'rgba(0,240,255,0.9)', magenta: 'rgba(255,0,200,0.9)', gold: 'rgba(255,220,60,0.9)',
                  red: 'rgba(255,40,90,0.9)', green: 'rgba(0,255,156,0.9)' };

    function safe(fn) { return function () { try { return fn.apply(this, arguments); } catch (err) { return undefined; } }; }
    function muted() { try { return !!(CFG.muted && CFG.muted()); } catch (err) { return false; } }
    function store(k, v) { try { if (v === undefined) { return window.localStorage.getItem(k); } window.localStorage.setItem(k, v); } catch (err) { return null; } return null; }
    function lang() {
        var I = window.NeonI18n, l = I && (typeof I.lang === 'function' ? I.lang() : I.lang);
        return String(l || document.documentElement.lang || 'es').slice(0, 2);
    }

    // ------------------------------------------------------------------------------------------------ the window

    var CSS =
        '#nsBg{position:fixed;left:-40px;top:-40px;right:-40px;bottom:-40px;z-index:-1;pointer-events:none;' +
        'background:#05060f center/cover no-repeat;filter:blur(10px) brightness(.45) saturate(1.25);transform:scale(1.04)}' +
        '#nsBg::after{content:"";position:absolute;left:0;top:0;right:0;bottom:0;' +
        'background:radial-gradient(ellipse at 50% 45%,rgba(5,6,15,0) 35%,rgba(5,6,15,.8) 100%)}' +
        '@media (prefers-reduced-motion:no-preference) and (min-width:900px){#nsBg{animation:nsDrift 40s ease-in-out infinite alternate}}' +
        '@keyframes nsDrift{from{transform:scale(1.04)}to{transform:scale(1.14) translateY(-14px)}}' +
        '#nsPulse{position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:40;opacity:0}' +
        '#info{color:#c8cce0;text-shadow:0 1px 2px #05060f,0 0 10px #05060f,0 0 18px #05060f}#info p{color:#c8cce0}' +
        '#gameCanvas{box-shadow:0 0 0 1px rgba(0,240,255,.35),0 0 26px rgba(255,0,200,.3),0 0 70px rgba(0,240,255,.14)}';

    var pulseEl = null, lastPulse = 0, lastStrength = 0;

    function setupPage() {
        var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
        var bg = document.createElement('div'); bg.id = 'nsBg'; bg.setAttribute('aria-hidden', 'true');
        bg.style.backgroundImage = 'url("' + BASE + (CFG.backdrop || 'img/bg.jpg?v=1') + '")';
        document.body.insertBefore(bg, document.body.firstChild);
        document.body.style.background = 'transparent';          // the html keeps the dark colour underneath
        pulseEl = document.createElement('div'); pulseEl.id = 'nsPulse'; pulseEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(pulseEl);
        musicLink();
    }

    //  The edges of the whole window light up in a colour, then fade.
    function pulse(color, strength) {
        if (!pulseEl) { return; }
        strength = Math.max(0.1, Math.min(1, strength || 0.6));
        var now = Date.now();
        if (now - lastPulse < 160 && strength <= lastStrength) { return; }
        lastPulse = now; lastStrength = strength;
        var s = calm ? strength * 0.45 : strength;
        pulseEl.style.transition = 'none';
        pulseEl.style.boxShadow = 'inset 0 0 ' + Math.round(50 + 90 * s) + 'px ' + Math.round(8 + 28 * s) + 'px ' + (COLOR[color] || color);
        pulseEl.style.opacity = String(Math.min(1, 0.4 + 0.6 * s));
        void pulseEl.offsetWidth;
        pulseEl.style.transition = 'opacity ' + (0.35 + 0.5 * s).toFixed(2) + 's ease-out';
        pulseEl.style.opacity = '0';
    }

    // ------------------------------------------------------------------------------------------------ the sound

    var A = null, out = null;          // the live audio context and its buses
    var musicOn = store('neon.music') !== '0';
    var level = 0.35, mode = 'quiet', sched = null, nextT = 0, step = 0, stopTimer = null;

    function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

    //  The buses: music -> muffler (lowpass) -> music gain -> compressor; effects -> effects gain -> compressor.
    function buses(ctx) {
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(ctx.destination);
        var mg = ctx.createGain(); mg.gain.value = 0.0001; mg.connect(comp);
        var muff = ctx.createBiquadFilter(); muff.type = 'lowpass'; muff.frequency.value = 900; muff.connect(mg);
        var fx = ctx.createGain(); fx.gain.value = 0.9; fx.connect(comp);
        var noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = noise.getChannelData(0);
        for (var i = 0; i < d.length; i++) { d[i] = Math.random() * 2 - 1; }
        return { ctx: ctx, comp: comp, music: muff, musicGain: mg, muff: muff, fx: fx, noise: noise };
    }

    function env(g, t, attack, peak, decay) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }
    function tone(o, type, f, t, attack, peak, decay, dest, opts) {
        opts = opts || {};
        var c = o.ctx, osc = c.createOscillator(), g = c.createGain(), node = osc;
        osc.type = type; osc.frequency.setValueAtTime(f, t);
        if (opts.slideTo) { osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + attack + decay); }
        if (opts.detune) { osc.detune.value = opts.detune; }
        if (opts.cutoff) { var fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = opts.cutoff; osc.connect(fl); node = fl; }
        node.connect(g); g.connect(dest); env(g, t, attack, peak, decay);
        osc.start(t); osc.stop(t + attack + decay + 0.05);
    }
    function noise(o, t, peak, decay, dest, type, freq, sweepTo) {
        var c = o.ctx, src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
        src.buffer = o.noise; fl.type = type; fl.frequency.setValueAtTime(freq, t);
        if (sweepTo) { fl.frequency.exponentialRampToValueAtTime(sweepTo, t + decay); }
        src.connect(fl); fl.connect(g); g.connect(dest); env(g, t, 0.003, peak, decay);
        src.start(t, Math.random() * 0.5); src.stop(t + decay + 0.05);
    }

    //  The theme: Am - F - C - G, one bar each, in the game's key.
    var CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    var ROOTS = [45, 41, 48, 43];

    function playStep(o, s, t, intensity) {
        var sp = 60 / FL.tempo / 4, bar = Math.floor(s / 16) % 4, i = s % 16, sh = FL.shift, m = o.music;
        var root = ROOTS[bar] + sh, chord = CHORDS[bar];
        //  Drums.
        if (i % 4 === 0 && (intensity >= 0.3 || i % 8 === 0)) {
            var c = o.ctx, k = c.createOscillator(), kg = c.createGain();
            k.type = 'sine'; k.frequency.setValueAtTime(150, t); k.frequency.exponentialRampToValueAtTime(45, t + 0.12);
            k.connect(kg); kg.connect(m); env(kg, t, 0.002, 0.42, 0.22); k.start(t); k.stop(t + 0.3);
        }
        if (intensity >= 0.5 && i % 8 === 4) { noise(o, t, 0.22, 0.14, m, 'bandpass', 1800); }
        if (intensity >= 0.62 && i % 4 === 2) { noise(o, t, 0.07, 0.04, m, 'highpass', 7000); }
        if (intensity >= 0.88 && i % 2 === 1) { noise(o, t, 0.04, 0.03, m, 'highpass', 9000); }
        //  Bass: driving eighths (sixteenths in Command), jumping an octave.
        if (FL.bass16 || i % 2 === 0) {
            var bn = root + ((FL.bass16 ? i % 4 === 3 : i % 4 === 2) ? 12 : 0);
            tone(o, 'sawtooth', midi(bn), t, 0.005, 0.13, sp * (FL.bass16 ? 0.9 : 1.6), m, { cutoff: 420 + intensity * 500 });
        }
        //  Pad: the chord, swelling over the bar.
        if (i === 0) {
            for (var p = 0; p < chord.length; p++) {
                tone(o, 'sawtooth', midi(chord[p] + sh), t, 0.3, 0.035, sp * 15, m, { cutoff: 1300, detune: -8 });
                tone(o, 'sawtooth', midi(chord[p] + sh), t, 0.3, 0.035, sp * 15, m, { cutoff: 1300, detune: 8 });
            }
        }
        //  Arpeggio, once the game warms up (always in Stack, gently).
        var arpOn = FL.arpAlways || intensity >= 0.55, every = FL.arp === 8 ? 2 : 1;
        if (arpOn && i % every === 0) {
            var pat = [0, 1, 2, 1], n = chord[pat[(i / every) % 4]] + 12 + sh;
            tone(o, 'square', midi(n), t, 0.004, FL.arpAlways && intensity < 0.55 ? 0.022 : 0.03, sp * every * 0.8, m, { cutoff: 2600 });
        }
    }

    function stingerOn(o, kind, t) {
        var d = o.fx, sh = FL.shift, n, k;
        if (kind === 'win') {
            n = [57, 60, 64, 69, 72, 76, 81];
            for (k = 0; k < n.length; k++) { tone(o, 'square', midi(n[k] + sh), t + k * 0.07, 0.005, 0.07, 0.16, d, { cutoff: 3200 }); }
            [69, 72, 76].forEach(function (x) { tone(o, 'sawtooth', midi(x + sh), t + 0.49, 0.02, 0.05, 1.1, d, { cutoff: 2400, detune: 6 }); });
        } else if (kind === 'best') {
            n = [76, 83, 88, 95, 100];
            for (k = 0; k < n.length; k++) { tone(o, 'triangle', midi(n[k] + sh), t + k * 0.06, 0.004, 0.08, 0.3, d); }
            noise(o, t + 0.3, 0.05, 0.5, d, 'highpass', 6000);
        } else if (kind === 'lose') {
            n = [64, 62, 60, 57];
            for (k = 0; k < n.length; k++) { tone(o, 'sawtooth', midi(n[k] + sh), t + k * 0.16, 0.01, 0.07, 0.22, d, { cutoff: 1500 }); }
            tone(o, 'sawtooth', midi(45 + sh), t + 0.64, 0.01, 0.08, 0.8, d, { cutoff: 900, slideTo: midi(33 + sh) });
        } else if (kind === 'level') {
            noise(o, t, 0.12, 0.45, d, 'bandpass', 400, 5000);
            [57, 64, 69].forEach(function (x, j) { tone(o, 'square', midi(x + 12 + sh), t + 0.3 + j * 0.05, 0.005, 0.05, 0.35, d, { cutoff: 3000 }); });
        }
    }

    //  The sound kit in the universe's voice (Neon Raiders uses it instead of sampled sounds).
    var SFX = {
        shoot: function (o, t) { tone(o, 'square', 1250, t, 0.002, 0.05, 0.08, o.fx, { slideTo: 320, cutoff: 4000 }); },
        invaderkilled: function (o, t) {
            noise(o, t, 0.16, 0.12, o.fx, 'bandpass', 1400);
            tone(o, 'triangle', 760, t, 0.002, 0.12, 0.14, o.fx, { slideTo: 150 });
        },
        explosion: function (o, t) {
            noise(o, t, 0.32, 0.42, o.fx, 'lowpass', 2400, 180);
            tone(o, 'sine', 110, t, 0.002, 0.25, 0.35, o.fx, { slideTo: 40 });
        },
        bang: function (o, t) {
            tone(o, 'square', 880, t, 0.003, 0.06, 0.16, o.fx, { cutoff: 3500 });
            tone(o, 'square', 1320, t + 0.06, 0.003, 0.06, 0.2, o.fx, { cutoff: 3500 });
            noise(o, t, 0.12, 0.12, o.fx, 'highpass', 3000);
        },
        death: function (o, t) {
            tone(o, 'sawtooth', 440, t, 0.005, 0.12, 0.9, o.fx, { slideTo: 50, cutoff: 1800 });
            noise(o, t, 0.3, 0.8, o.fx, 'lowpass', 1800, 120);
        }
    };

    function ensure() {
        if (A) { return A; }
        try { var Ctx = window.AudioContext || window.webkitAudioContext; A = new Ctx(); out = buses(A); } catch (err) { A = null; out = null; }
        return A;
    }
    function canPlay() { return !!(A && out && musicOn && !muted() && !document.hidden); }

    function startLoop() {
        if (sched || !canPlay()) { return; }
        nextT = A.currentTime + 0.06; step = 0;
        sched = setInterval(safe(function () {
            while (nextT < A.currentTime + 0.14) {
                playStep(out, step, nextT, level);
                nextT += 60 / FL.tempo / 4; step++;
            }
        }), 25);
    }
    function stopLoop() { if (sched) { clearInterval(sched); sched = null; } }

    //  Music volume and muffling for each moment of the game.
    function apply() {
        if (!A || !out) { return; }
        var t = A.currentTime, g = out.musicGain.gain, f = out.muff.frequency;
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
        if (!canPlay()) { g.cancelScheduledValues(t); g.setTargetAtTime(0.0001, t, 0.05); stopTimer = setTimeout(stopLoop, 300); return; }
        g.cancelScheduledValues(t); f.cancelScheduledValues(t);
        if (mode === 'over') {
            g.setTargetAtTime(0.0001, t, 0.4);
            stopTimer = setTimeout(stopLoop, 1800);
            return;
        }
        startLoop();
        if (mode === 'play') { g.setTargetAtTime(0.42, t, 0.25); f.setTargetAtTime(9000, t, 0.2); }
        else { g.setTargetAtTime(0.26, t, 0.3); f.setTargetAtTime(700, t, 0.2); }
    }

    function stateChanged() {
        var s = document.body.getAttribute('data-state') || '';
        var m = OVER.indexOf(s) >= 0 ? 'over' : (PLAY.indexOf(s) >= 0 ? 'play' : 'quiet');
        if (m === mode) { return; }
        if (mode === 'over' && m !== 'over') { level = 0.35; }       // a new run starts calm
        mode = m; apply();
    }

    function unlock() {
        if (!ensure()) { return; }
        if (A.state === 'suspended') { A.resume().then(safe(apply), function () {}); } else { apply(); }
    }

    function musicLink() {
        var mute = document.getElementById('muteLink');
        if (!mute || !mute.parentNode) { return; }
        var a = document.createElement('a'); a.href = '#'; a.id = 'nsMusic';
        var label = function () {
            var es = lang() === 'es';
            a.textContent = es ? (musicOn ? 'música: sí' : 'música: no') : (musicOn ? 'music: on' : 'music: off');
        };
        label();
        a.addEventListener('click', function (e) {
            e.preventDefault(); musicOn = !musicOn; store('neon.music', musicOn ? '1' : '0'); label(); unlock(); apply();
        });
        mute.parentNode.insertBefore(document.createTextNode(' | '), mute.nextSibling);
        mute.parentNode.insertBefore(a, mute.nextSibling.nextSibling);
    }

    // ------------------------------------------------------------------------------------------------ reactions

    function intensity(v) { level = Math.max(0, Math.min(1, v)); }
    function stinger(kind) { if (A && out && !muted()) { stingerOn(out, kind, A.currentTime + 0.02); } }
    function big() { pulse('cyan', 1); setTimeout(function () { pulse('magenta', 0.8); }, 200); stinger('level'); }

    var REACT = {
        'neon-bricks': {
            run: function () { intensity(0.4); },
            wall: function (e) { intensity(0.4 + Math.min(0.6, (e.wall - 1) * 0.12)); },
            clear: big,
            goal: function () { pulse('gold', 0.9); },
            power: function () { pulse('green', 0.55); },
            lose: function () { pulse('red', 0.7); },
            brick: function (e) { if (e.combo && e.combo % 6 === 0) { pulse('magenta', 0.45); } }
        },
        'neon-stack': {
            run: function () { intensity(0.35); },
            drop: function (e) {
                intensity(0.35 + Math.min(0.65, e.floor / 40));
                if (e.golden) { pulse('gold', 0.8); }
                else if (e.perfect && e.streak >= 3) { pulse('cyan', 0.35 + Math.min(0.5, e.streak * 0.05)); }
                if (e.floor && e.floor % 10 === 0) { big(); }
            },
            miss: function () { pulse('red', 0.6); },
            goal: function () { pulse('gold', 0.9); }
        },
        'neon-command': {
            run: function () { intensity(0.45); },
            crystal: function (e) { if (e.side === 'you') { pulse('cyan', 0.7); intensity(level + 0.08); } else { pulse('red', 0.6); } },
            sudden: function () { pulse('magenta', 1); intensity(1); stinger('level'); },
            goal: function () { pulse('gold', 0.9); }
        },
        'neon-raiders': {
            run: function () { intensity(0.45); },
            wave: function (e) { intensity(0.45 + Math.min(0.55, (e.level - 1) * 0.12)); big(); },
            bonus: function () { pulse('gold', 0.85); },
            hit: function () { pulse('red', 0.8); }
        }
    };

    function event(name, data) {
        var r = REACT[GAME] && REACT[GAME][name];
        if (r) { r(data || {}); }
    }

    function sfx(name) {
        if (!SFX[name]) { return false; }
        if (muted()) { return true; }
        if (ensure() && out) { if (A.state === 'suspended') { A.resume(); } SFX[name](out, A.currentTime + 0.005); }
        return true;
    }

    //  For tests and previews: render the theme (and a stinger) offline, without speakers.
    function render(seconds, level0, kind) {
        var C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        var ctx = new C(1, Math.ceil(44100 * seconds), 44100), o = buses(ctx);
        o.musicGain.gain.value = 0.42; o.muff.frequency.value = 9000;
        var sp = 60 / FL.tempo / 4, n = Math.floor((seconds - (kind ? 2 : 0)) / sp);
        for (var s = 0; s < n; s++) { playStep(o, s, 0.05 + s * sp, level0); }
        if (kind) { o.musicGain.gain.setTargetAtTime(0.0001, 0.05 + n * sp, 0.3); stingerOn(o, kind, 0.1 + n * sp); }
        return ctx.startRendering();
    }

    // ------------------------------------------------------------------------------------------------ start

    safe(function () {
        setupPage();
        ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { window.addEventListener(ev, safe(unlock), true); });
        new MutationObserver(safe(stateChanged)).observe(document.body, { attributes: true, attributeFilter: ['data-state'] });
        document.addEventListener('visibilitychange', safe(apply));
        var wasMuted = muted();
        setInterval(safe(function () { var m = muted(); if (m !== wasMuted) { wasMuted = m; apply(); } }), 400);
        stateChanged();
    })();

    window.NeonStage = { event: safe(event), pulse: safe(pulse), intensity: safe(intensity), stinger: safe(stinger),
                         sfx: function (n) { try { return sfx(n); } catch (err) { return false; } },
                         render: render, flavour: FL, game: GAME,
                         state: function () { return { mode: mode, level: level, looping: !!sched, audio: A ? A.state : 'none', music: musicOn }; } };
})();
