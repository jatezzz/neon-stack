"""Smoke test for Neon Stack (Playwright, game mounted at /site). Prints a JSON report; screenshots in /out."""
import json, subprocess, sys, time
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8099", "-d", "/site"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
BASE = "http://127.0.0.1:8099/index.html"
BOT = open("/site/tests/autoplayer.js").read()
R = {"errors": [], "checks": {}, "failed": []}
def check(name, ok, detail=None):
    R["checks"][name] = {"ok": bool(ok), "detail": detail}
    if not ok: R["failed"].append(name)
RUN = """([seed]) => { NSBot.install(game, {seed}); let n = 0; while (game.state !== 'over' && n < 120 * 600) { game.update(1/120); n++; }
  return {score: game.score, floors: game.floors, perfects: game.stats.perfects, streak: game.stats.bestStreak, golden: game.stats.golden, seconds: Math.round(n/120), state: game.state}; }"""
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(**p.devices["iPhone 13"], locale="es-EC"); pg = ctx.new_page()
    pg.on("pageerror", lambda e: R["errors"].append(str(e)))
    pg.on("console", lambda m: m.type == "error" and R["errors"].append(m.text))
    pg.goto(BASE + "?debug=true&day=2026-11-22"); pg.wait_for_timeout(800)
    check("title", pg.evaluate("game.state") == "title")
    size = pg.evaluate("(() => { const r = document.getElementById('gameCanvas').getBoundingClientRect(); return [r.width, r.height, innerWidth, innerHeight, document.documentElement.scrollHeight]; })()")
    check("canvas fits phone", size[0] <= size[2] and size[1] <= size[3] and size[4] <= size[3] + 1, size)
    pg.screenshot(path="/out/s01-title.png")
    pg.touchscreen.tap(195, 300); pg.wait_for_timeout(400)
    check("tap starts", pg.evaluate("game.state") == "play")
    for i in range(4):
        pg.touchscreen.tap(195, 300); pg.wait_for_timeout(450)
    st = pg.evaluate("({state: game.state, floors: game.floors})")
    check("taps drop blocks", st["floors"] >= 1 or st["state"] in ("falling", "over"), st)
    pg.screenshot(path="/out/s02-play.png")
    if pg.evaluate("game.state") == "play":
        pg.locator("#pauseBtn").dispatch_event("pointerdown"); pg.wait_for_timeout(200)
        x0 = pg.evaluate("game.block && game.block.x"); pg.wait_for_timeout(400); x1 = pg.evaluate("game.block && game.block.x")
        check("pause freezes the block", pg.evaluate("game.paused") and x0 == x1, [x0, x1])
        pg.touchscreen.tap(195, 300); pg.wait_for_timeout(200)
        check("tap resumes", not pg.evaluate("game.paused"))
    # bot run to the end, on a page with a score to beat
    pg.goto(BASE + "?debug=true&day=2026-11-22&vs=300&by=bot"); pg.wait_for_timeout(500)
    pg.add_script_tag(content=BOT)
    r = pg.evaluate(RUN, [1]); R["bot"] = r
    check("bot stacks and the run ends", r["state"] == "over" and r["floors"] >= 10, r)
    pg.wait_for_timeout(300)
    # let the page loop draw the zoomed-out tower and the card
    pg.wait_for_timeout(1200)
    check("game-over card", pg.evaluate("!document.getElementById('gameover').hidden"))
    share = pg.evaluate("NeonDaily.shareMessage()"); R["share"] = share
    check("share text", share and "Neon Stack · Torre #1" in share and "/play/neon-stack?d=2026-11-22" in share, share)
    pg.screenshot(path="/out/s03-over.png")
    pg.locator("#goAgain").click(); pg.wait_for_timeout(300)
    check("play again", pg.evaluate("game.state") == "play")
    ctx.close()
    # same plan for a day, a different plan another day
    plans = {}
    for day in ("2026-11-22", "2026-11-22", "2026-11-23"):
        c = b.new_context(); q = c.new_page(); q.goto(BASE + "?debug=true&day=" + day); q.wait_for_timeout(300)
        plans.setdefault(day, []).append(q.evaluate("(() => { const pl = NeonStack.dayPlan(); return pl.hue + ':' + pl.floors.slice(0, 30).map(f => Math.round(f.speed) + (f.fromLeft ? 'L' : 'R') + (f.golden ? 'G' : '')).join(','); })()"))
        c.close()
    check("same day, same tower", plans["2026-11-22"][0] == plans["2026-11-22"][1])
    check("other day differs", plans["2026-11-23"][0] != plans["2026-11-22"][0])
    # desktop
    c = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US"); q = c.new_page()
    q.on("pageerror", lambda e: R["errors"].append(str(e)))
    q.goto(BASE + "?debug=true&day=2026-11-22"); q.wait_for_timeout(500)
    q.keyboard.press("Space"); q.wait_for_timeout(300)
    check("space starts", q.evaluate("game.state") == "play")
    q.keyboard.press("Escape"); q.wait_for_timeout(100)
    check("esc pauses", q.evaluate("game.paused"))
    check("english", q.evaluate("document.title") == "Neon Stack: daily challenge")
    q.screenshot(path="/out/s04-desktop.png")
    c.close(); b.close()
srv.terminate()
print(json.dumps(R, indent=1, ensure_ascii=False))
