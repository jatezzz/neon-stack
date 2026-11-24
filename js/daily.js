/*
    Daily challenge, sharing and anonymous measurement for Neon Stack.

    - Every calendar day has one challenge, the same for everyone: the same block speeds, the same starting sides
      and the same golden blocks, generated from the date.
    - Best score of the day, attempts and the streak of days played are kept in this browser only
      (localStorage). There are no accounts and no cookies.
    - The game-over screen shares the result as plain text. Every shared link points to the portal,
      whichever copy of the game it was shared from.
    - Events are anonymous counters sent to the portal (no identifier, no cookie). They are skipped
      when the browser sends "Do Not Track" and on local development hosts. See docs/DAILY.md.
*/
(function () {
    'use strict';

    var CONFIG = {
        game: 'neon-stack',              // sent with every counter, so the portal can tell the games apart
        portal: 'https://games.johnandrestrujillo.com',
        portalHost: 'games.johnandrestrujillo.com',
        playPath: '/play/neon-stack',
        eventsPath: '/e',
        firstDay: '2026-11-22',          // challenge #1 (launch day)
        buttonsDelayMs: 700,             // game-over buttons ignore taps at first (players are still tapping)
        //  Games recommended on the game-over screen; one per day, in turn.
        recommend: [            // the other Neon games: one universe
            { id: 'neon-raiders', title: 'Neon Raiders', emoji: '👾' },
            { id: 'neon-bricks', title: 'Neon Bricks', emoji: '🧱' },
            { id: 'neon-command', title: 'Neon Command', emoji: '⚔️' }
        ]
    };

    var I = window.NeonI18n;
    var embedded = false;
    try { embedded = window.self !== window.top; } catch (err) { embedded = true; }
    var onPortal = window.location.hostname === CONFIG.portalHost;
    //  Another portal hosts this copy (window.NEON_HOST, set by its build, e.g. 'crazygames'): no links out, no own counters.
    var hosted = String(window.NEON_HOST || '');
    var debug = /[?&]debug=true\b/.test(window.location.search);

    //  Hosted: in-page actions (mute, music, today's challenge) stay actions but are not links (some portals forbid <a href>).
    function unlink() {
        [].forEach.call(document.querySelectorAll('a[href="#"]'), function (a) {
            a.removeAttribute('href'); a.setAttribute('role', 'button'); a.tabIndex = 0; a.style.cursor = 'pointer';
            a.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.click(); } });
        });
    }
    if (hosted) {
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', unlink); } else { unlink(); }
        new MutationObserver(unlink).observe(document.documentElement, { childList: true, subtree: true });
    }

    // ---------------------------------------------------------------- dates and random numbers

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function dayKey(date) {
        var d = date || new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function toUtcDays(key) {
        var p = key.split('-');
        return Math.round(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 86400000);
    }

    //  ?day=YYYY-MM-DD together with ?debug=true plays another day's challenge (for tests).
    var forcedDay = debug ? (window.location.search.match(/[?&]day=(\d{4}-\d{2}-\d{2})\b/) || [])[1] : null;

    //  A shared result carries its challenge day (?d=YYYY-MM-DD). Whoever opens the link plays THAT challenge,
    //  whatever their own date or time zone, so the two scores can be compared. Inside a portal the parameter is
    //  on the page around the game.
    function readSharedDay() {
        var search = window.location.search;
        try { if (embedded && window.top.location.search) { search = window.top.location.search; } } catch (err) { /* other origin */ }
        var day = (search.match(/[?&]d=(\d{4}-\d{2}-\d{2})(?:&|$)/) || [])[1];
        if (!day) { return null; }
        try { if (window.sessionStorage.getItem('ns.today') === '1') { return null; } } catch (err) { /* no storage */ }
        var p = day.split('-'), probe = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
        if (isNaN(probe.getTime()) || dayKeyUtc(probe) !== day) { return null; }                 // not a real date
        var ahead = toUtcDays(day) - toUtcDays(dayKey());
        if (toUtcDays(day) < toUtcDays(CONFIG.firstDay) || ahead > 1) { return null; }          // before #1, or in the future
        return day === dayKey() ? null : day;
    }
    function dayKeyUtc(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    var sharedDay = forcedDay ? null : readSharedDay();

    //  The challenge being played: today's, unless a shared link (or a test) asks for another day.
    function today() { return forcedDay || sharedDay || dayKey(); }
    function otherDay() { return !!(forcedDay || sharedDay); }

    //  A link can also carry a score to beat (?vs=915, and &by=bot when the score is the auto-player's).
    //  A score that arrives in a link is only DECLARED: anybody can type a number in a link. It counts as VERIFIED
    //  only when it matches a run on record below (a recorded run that can be played back or repeated).
    var VERIFIED = [
        { day: '2026-11-22', score: 785, by: 'bot' }      // the auto-player (tests/autoplayer.js, 40 ms timing error) on tower #1: best of five seeds (785, 685, 595, 415, 415)
    ];
    function readTarget() {
        var search = window.location.search;
        try { if (embedded && window.top.location.search) { search = window.top.location.search; } } catch (err) { /* other origin */ }
        var score = Number((search.match(/[?&]vs=(\d{1,6})(?:&|$)/) || [])[1]);
        if (!score) { return null; }
        var by = (search.match(/[?&]by=(bot)(?:&|$)/) || [])[1] || 'player';
        var verified = VERIFIED.some(function (v) { return v.day === today() && v.score === score && v.by === by; });
        return { score: score, by: by, verified: verified };
    }
    var target = readTarget();

    //  'win', 'tie' or 'lose' against the score to beat; null when the link carried none.
    function outcome(score) {
        if (!target) { return null; }
        return score > target.score ? 'win' : (score === target.score ? 'tie' : 'lose');
    }

    //  Leave a shared challenge and play today's.
    function playToday() {
        try { window.sessionStorage.setItem('ns.today', '1'); } catch (err) { /* no storage */ }
        window.location.reload();
    }
    function challengeNumber(key) { return toUtcDays(key || today()) - toUtcDays(CONFIG.firstDay) + 1; }

    function hash(str) {                       // FNV-1a, 32 bits
        var h = 2166136261;
        for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }

    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            var t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    //  A random generator for today's challenge. The same tag gives the same sequence to everyone.
    function rng(tag) { return mulberry32(hash(today() + '|' + tag)); }

    // ---------------------------------------------------------------- local progress

    function read(key, fallback) {
        try { var v = JSON.parse(window.localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; }
        catch (err) { return fallback; }
    }
    function write(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode: play without progress */ }
    }

    //  Progress of the challenge being played. A shared challenge of another day has its own record, so it never
    //  replaces today's best score.
    function progressKey() { return otherDay() ? 'ns.shared' : 'ns.day'; }

    function todayProgress() {
        var p = read(progressKey(), null);
        if (!p || p.day !== today()) { p = { day: today(), best: 0, bestWall: 0, attempts: 0 }; }
        return p;
    }

    //  Days in a row with at least one finished game, counting today if already played.
    function currentStreak() {
        var s = read('ns.streak', null);
        if (!s || typeof s.count !== 'number') { return 0; }
        var gap = toUtcDays(today()) - toUtcDays(s.last);
        return gap === 0 || gap === 1 ? s.count : 0;
    }

    function recordRun(result) {
        var p = todayProgress();
        p.attempts += 1;
        var isBest = result.score > p.best;
        if (isBest) { p.best = result.score; p.bestWall = result.wall; }
        var streak = currentStreak();
        if (!otherDay()) {                      // only today's challenge keeps the streak going
            var s = read('ns.streak', null);
            if (!s || s.last !== today()) { streak += 1; write('ns.streak', { last: today(), count: streak }); }
        }
        if (!forcedDay) { write(progressKey(), p); }
        return { best: p.best, bestWall: p.bestWall, attempts: p.attempts, isBest: isBest, streak: Math.max(streak, 1) };
    }

    // ---------------------------------------------------------------- links, sharing

    function withUtm(url, source, medium) {
        var from = onPortal ? 'portal' : (window.location.hostname.indexOf('github.io') >= 0 ? 'ghpages' : 'other');
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'utm_source=' + source + '&utm_medium=' + medium +
            '&utm_campaign=d' + today().replace(/-/g, '') + '&utm_content=' + from;
    }

    //  The link of a shared result names its challenge day, so the other person plays the same tower.
    //  It also dares the next person to beat this score (declared, as any score in a link).
    function shareUrl(score) {
        return withUtm(CONFIG.portal + CONFIG.playPath + '?d=' + today() + (score ? '&vs=' + score : ''), 'share', 'score');
    }

    //  One square per ten floors, then the fall.
    function wallRow(floors) {
        var cleared = Math.floor(floors / 10), row = '';
        for (var i = 0; i < Math.min(cleared, 9); i++) { row += '🟩'; }
        return row + '💥';
    }

    function shareText(result, summary) {
        var lines = [
            I.t('share.head', { n: challengeNumber(), date: I.shortDate(today()) }),
            '🟦 ' + I.t('share.line', { s: I.number(result.score), w: result.wall }) +
                (result.maxCombo > 1 ? ' · ✨×' + result.maxCombo : '') +
                (summary.streak > 1 ? ' · 🔥 ' + I.t('share.streak', { n: summary.streak }) : ''),
            wallRow(result.wall)
        ];
        var o = outcome(result.score);
        if (o) {
            lines.push(I.t('share.' + o + '.' + target.by, { t: I.number(target.score), n: I.number(Math.abs(result.score - target.score)) }));
        }
        lines.push(result.score > 0 ? I.t('share.dare.score', { s: I.number(result.score) }) : I.t('share.dare'));
        return lines.join('\n');
    }

    // ---------------------------------------------------------------- anonymous events

    function trackingAllowed() {
        if (hosted) { return false; }
        if (navigator.doNotTrack === '1' || window.doNotTrack === '1') { return false; }
        var h = window.location.hostname;
        return window.location.protocol === 'https:' && h !== 'localhost' && h !== '127.0.0.1';
    }

    var sent = [];      // kept for tests and debugging

    function track(name, props) {
        var q = 'ev=' + encodeURIComponent(name) + '&g=' + CONFIG.game + '&d=' + today() + '&h=' + encodeURIComponent(window.location.hostname) +
            '&m=' + (embedded ? 'embed' : 'page') + '&l=' + I.lang;
        Object.keys(props || {}).forEach(function (k) { if (props[k] !== '') { q += '&' + k + '=' + encodeURIComponent(props[k]); } });
        sent.push(q);
        if (!trackingAllowed()) { return; }
        var url = CONFIG.portal + CONFIG.eventsPath + '?' + q;
        try {
            if (navigator.sendBeacon) { navigator.sendBeacon(url); } else { (new Image()).src = url; }
        } catch (err) { /* measurement must never break the game */ }
    }

    //  Count arrivals that came from a tagged link (shared result, article, another copy of the game).
    function trackArrival() {
        var search = window.location.search;
        try { if (embedded && window.top.location.search) { search = window.top.location.search; } } catch (err) { /* other origin */ }
        var src = (search.match(/[?&]utm_source=([\w-]+)/) || [])[1];
        if (src) { track('arrive', { src: src, med: (search.match(/[?&]utm_medium=([\w-]+)/) || [])[1] || '' }); }
    }

    // ---------------------------------------------------------------- game-over screen

    var overlay = null, lastShare = null, shownAt = 0;

    function el(id) { return document.getElementById(id); }

    function recommended() {
        return CONFIG.recommend[Math.abs(challengeNumber()) % CONFIG.recommend.length];
    }

    function showFallback(text) {
        var box = el('goFallback');
        box.hidden = false;
        el('goText').value = text;
        el('goWhatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(text);
        if (hosted) { el('goWhatsapp').remove(); }    // a hosting portal: no way out of the game
    }

    function share() {
        if (!lastShare || Date.now() - shownAt < CONFIG.buttonsDelayMs) { return; }
        var text = hosted ? lastShare.text : lastShare.text + '\n' + lastShare.url;
        track('share_tap', {});
        if (navigator.share) {
            navigator.share({ text: text }).then(function () { track('share', { how: 'native' }); })
                .catch(function (err) { if (!err || err.name !== 'AbortError') { showFallback(text); } });
        } else {
            showFallback(text);
        }
    }

    function copy() {
        var text = el('goText').value;
        function done() { el('goCopy').textContent = I.t('over.copied'); track('share', { how: 'copy' }); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () { el('goText').select(); });
        } else {
            el('goText').select();
            try { if (document.execCommand('copy')) { done(); } } catch (err) { /* the text stays selected to copy by hand */ }
        }
    }

    function bind() {
        overlay = el('gameover');
        if (!overlay) { return; }
        el('goShare').addEventListener('click', share);
        el('goCopy').addEventListener('click', copy);
        el('goWhatsapp').addEventListener('click', function () { track('share', { how: 'whatsapp' }); });
        el('goAgain').addEventListener('click', function () {
            if (Date.now() - shownAt < CONFIG.buttonsDelayMs) { return; }
            window.game.restart();
        });
        el('goRec').addEventListener('click', function () { track('rec', { to: recommended().id }); });
        el('goMore').addEventListener('click', function () { track('more', {}); });
    }

    //  Called by the game when a run ends.
    function onGameOver(game) {
        //  wall = floors stacked, bricks = perfect drops, maxCombo = longest perfect streak, powers = golden blocks.
        var result = { score: game.score, wall: game.floors, bricks: game.stats.perfects, maxCombo: game.stats.bestStreak,
                       powers: game.stats.golden };
        var summary = recordRun(result);
        var o = outcome(result.score);
        //  One of three lines per outcome, picked by the score so the same result always reads the same.
        var joke = o ? I.t('joke.' + o + '.' + target.by + '.' + (result.score % 3)) : '';
        var headline = o ? I.t('over.' + o, { t: I.number(target.score), n: I.number(Math.abs(result.score - target.score)) }) : '';
        lastShare = { text: shareText(result, summary), url: shareUrl(result.score), outcome: o, headline: headline, joke: joke };
        track('over', { s: result.score, w: result.wall, k: result.bricks, c: result.maxCombo, p: result.powers, n: summary.attempts,
                        o: o || '', vs: target ? target.score : '' });
        //  A portal that embeds the game with its SDK shows its own game-over screen over this one.
        //  The shared celebration (js/neon-fx.js, one for every Neon game): a win or a tie against a score to beat,
        //  a new best of the day, or a loss against a score to beat. On the card, or over the game inside a portal.
        var fx = o === 'win' || o === 'tie' ? 'win' : (summary.isBest && result.score > 0 ? 'best' : (o === 'lose' ? 'lose' : null));
        var fxOnCard = !!overlay && !(embedded && window.PortalSDK);
        if (fx && window.NeonFx && !fxOnCard) { window.NeonFx.celebrate(fx, false); }
        if (!overlay || (embedded && window.PortalSDK)) { return summary; }

        el('goTitle').textContent = I.t('over.title', { n: challengeNumber(), date: I.shortDate(today()) });
        //  Different card for a win, a loss and a tie against the score to beat.
        overlay.className = o ? 'outcome-' + o : '';
        el('goOutcome').hidden = !o; el('goJoke').hidden = !o;
        el('goOutcome').textContent = headline; el('goJoke').textContent = joke;
        el('goScore').textContent = I.number(result.score);
        el('goMeta').textContent = I.t(result.maxCombo > 1 ? 'over.meta' : 'over.meta.plain', { w: result.wall, k: result.bricks, c: result.maxCombo });
        el('goRow').textContent = wallRow(result.wall);
        el('goBest').textContent = (summary.isBest ? I.t('over.newbest') : I.t('over.best', { best: I.number(summary.best) })) +
            ' · 🔥 ' + I.t(summary.streak === 1 ? 'over.streak.one' : 'over.streak.many', { n: summary.streak });
        el('goFallback').hidden = true;
        el('goCopy').textContent = I.t('over.copy');

        //  Inside the portal the page around the game already lists the other games.
        var rec = recommended(), links = el('goLinks');
        if (links) { links.hidden = (embedded && onPortal) || !!hosted; }
        if (hosted) { if (links) { links.remove(); } } else {   // a hosting portal: no links to other games or sites
            el('goRec').href = withUtm(CONFIG.portal + '/play/' + rec.id, 'game', 'gameover');
            el('goRecEmoji').textContent = rec.emoji;
            el('goRecTitle').textContent = rec.title;
            el('goRecHook').textContent = I.t('rec.' + rec.id);
            el('goMore').href = withUtm(CONFIG.portal + '/play', 'game', 'gameover-more');
            el('goMore').textContent = I.t('over.more', { host: CONFIG.portalHost });
        }

        shownAt = Date.now();
        overlay.hidden = false;
        if (el('goFx')) { el('goFx').hidden = true; }
        if (fx && window.NeonFx) { window.NeonFx.celebrate(fx, true); }
        document.body.classList.add('over');
        return summary;
    }

    //  The full text of the last result, link included (for portals that show their own share button).
    function shareMessage() { return lastShare ? lastShare.text + '\n' + lastShare.url : null; }
    //  For portals: the headline and the line of the last result ('win', 'tie', 'lose' or null).
    function lastResult() { return lastShare ? { outcome: lastShare.outcome, headline: lastShare.headline, joke: lastShare.joke } : null; }

    function hideOverlay() {
        if (overlay) { overlay.hidden = true; }
        document.body.classList.remove('over');
    }

    //  True while the game-over buttons and the restart key are still locked.
    function locked() { return Date.now() - shownAt < CONFIG.buttonsDelayMs; }

    function onRunStart() {
        hideOverlay();
        if (window.NeonFx) { window.NeonFx.preload(); }
        //  "Did this player come back?" without knowing who they are: the run reports how many different days this
        //  browser has played (dp) and the current streak (st). They are counts, not identifiers.
        var days = read('ns.days', null);
        if (!days || typeof days.count !== 'number') { days = { last: '', count: 0 }; }
        if (!otherDay() && days.last !== today()) { days = { last: today(), count: days.count + 1 }; write('ns.days', days); }
        track('run', { n: todayProgress().attempts + 1, sh: sharedDay ? 1 : '', dp: Math.max(days.count, 1), st: currentStreak(),
                       vs: target ? target.score : '' });
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', bind); } else { bind(); }

    window.NeonDaily = {
        CONFIG: CONFIG, today: today, challengeNumber: challengeNumber, rng: rng,
        sharedDay: sharedDay, otherDay: otherDay, playToday: playToday, target: target, outcome: outcome, lastResult: lastResult,
        todayProgress: todayProgress, currentStreak: currentStreak, recordRun: recordRun,
        shareText: shareText, shareUrl: shareUrl, shareMessage: shareMessage, withUtm: withUtm, wallRow: wallRow,
        track: track, trackArrival: trackArrival, sent: sent,
        onRunStart: onRunStart, onGameOver: onGameOver, hideOverlay: hideOverlay, locked: locked,
        embedded: embedded, onPortal: onPortal, hosted: hosted
    };
})();
