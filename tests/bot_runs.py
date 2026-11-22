"""Fast-forward the auto-player on one day: score, floors and game time for seeds 1-5 at each timing error k."""
import json, subprocess, sys, time
from playwright.sync_api import sync_playwright
DAY = sys.argv[1]; KS = [float(k) for k in sys.argv[2].split(",")]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8095", "-d", "/site"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
BOT = open("/site/tests/autoplayer.js").read()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    for k in KS:
        for seed in range(1, 6):
            pg.goto(f"http://127.0.0.1:8095/index.html?debug=true&day={DAY}"); pg.wait_for_timeout(200)
            pg.add_script_tag(content=BOT)
            r = pg.evaluate("""([seed, k]) => { NSBot.install(game, {seed, k}); let n = 0; while (game.state !== 'over' && n < 120 * 900) { game.update(1/120); n++; }
                return {k, seed, score: game.score, floors: game.floors, perfects: game.stats.perfects, streak: game.stats.bestStreak, seconds: Math.round(n/120)}; }""", [seed, k])
            print(json.dumps(r), flush=True)
    b.close()
srv.terminate()
