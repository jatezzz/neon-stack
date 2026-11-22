import subprocess, sys, time, base64
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8098", "-d", "/site"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
BOT = open("/site/tests/autoplayer.js").read()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1200, "height": 630})
    pg.goto("http://127.0.0.1:8098/tools/og.html"); pg.wait_for_timeout(500)
    pg.locator("#c").screenshot(path="/out/og.png")
    # a 4:3 card screenshot: the bot's tower about 25 floors up, mid-game
    pg = b.new_page(viewport={"width": 400, "height": 760}, device_scale_factor=2)
    pg.goto("http://127.0.0.1:8098/index.html?debug=true&day=2026-11-22&lang=es"); pg.wait_for_timeout(600)
    pg.add_script_tag(content=BOT)
    pg.evaluate("() => { game.frame = function () {}; NSBot.install(game, {seed: 2, k: 0.04}); while (game.floors < 24 && game.state !== 'over') game.update(1/120); for (let i = 0; i < 40; i++) game.update(1/120); game.draw(); }")
    pg.locator("#gameCanvas").screenshot(path="/out/shot-raw.png")
    b.close()
srv.terminate(); print("og + shot done")
