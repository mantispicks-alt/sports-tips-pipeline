import { chromium } from 'playwright';
const urls = {
  betclan: 'https://www.betclan.com/',
};
for (const [id, url] of Object.entries(urls)) {
  try {
    const b = await chromium.launch();
    const p = await b.newPage({ userAgent: 'Mozilla/5.0' });
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await p.waitForTimeout(3500);
    const txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    console.log(`\n### ${id} — ${txt.length} chars\n${txt.slice(0, 1400)}`);
    await b.close();
  } catch (e) { console.log(`\n### ${id} — ERR ${String(e?.message || e).slice(0, 80)}`); }
}
