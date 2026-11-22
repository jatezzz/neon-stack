/*
    The Neon Stack auto-player ("the bot"). It aims at the edge of the floor below with an error like a person's
    timing (k seconds of jitter at the block's speed), picked per floor from its own seeded random numbers, and drops
    when the block crosses that point. It hooks into game.update, so fast-forward and real time play the same tower.

        NSBot.install(game, { seed: 2, aim: 1.0, k: 0.04 })
*/
(function () {
    'use strict';
    function mulberry(seed) {
        var a = seed >>> 0;
        return function () { a = (a + 0x6D2B79F5) >>> 0; var t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    function install(game, opts) {
        var o = Object.assign({ seed: 1, aim: 1.0, k: 0.04 }, opts || {});
        var rng = mulberry(o.seed * 2654435761), floor = -1, target = 0;
        var orig = game.update;
        game.update = function (dt) {
            if (this.state === 'title') { this.action(); }
            var b = this.block, d0 = null;
            if (this.state === 'play' && b) {
                if (b.n !== floor) {
                    floor = b.n;
                    var top = this.tower[this.tower.length - 1], err = o.aim + o.k * b.speed;   // ~25 ms of timing error at that speed
                    target = top.x + (rng() * 2 - 1) * err;
                }
                d0 = b.x - target;
            }
            orig.call(this, dt);
            if (d0 !== null && this.state === 'play' && this.block === b) {
                var d1 = b.x - target;
                if (d1 === 0 || (d0 < 0) !== (d1 < 0)) { this.drop(); }
            }
        };
        return game;
    }
    window.NSBot = { install: install };
})();
