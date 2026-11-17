// Run: node --test firebase-shortlinks/tests/whatsapp_launcher.test.mjs
// Pure-Node tests (no network, no browser). They execute the inline script of
// public/whatsapp.html in a vm sandbox and check the generated launcher URLs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const htmlBuf = fs.readFileSync(path.join(root, 'public', 'whatsapp.html'));
const html = htmlBuf.toString('utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8')).hosting;

const HEART = '\u{1F49B}';          // 💛
const PLANE = '\u2708\uFE0F';        // ✈️ (U+2708 + VS16)
const TOKEN = 'mh27-abc123';
const PHONE = '5491122334455';

const expected = (rsvp, gifts) => `Oi! ${HEART} Finalmente chegou a hora: vamos nos casar!

Sabemos que estamos a muitos quilômetros de distância, mas seria muito especial ter vocês com a gente nesse dia. E, se não for possível vir, sabemos que de alguma forma vocês estarão com a gente mesmo de longe.

Estamos enviando o nosso convite com todos os detalhes do casamento. Para confirmar a presença, é só acessar o RSVP até o dia 30 de novembro:

RSVP ${HEART}
${rsvp}

Ter vocês com a gente nesse dia já será um presente enorme. Mas, se quiserem também nos presentear de outra forma, montamos uma lista com algumas experiências da nossa lua de mel:

Nossa viagem ${PLANE}
${gifts}

Um beijo,
Mariana & Hernán`;

function run(search) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const els = {
    status: { textContent: '' },
    'open-app': { href: '#', hidden: true },
    fallback: { href: '#', hidden: true },
  };
  const location = { search, href: 'https://marianayhernan.web.app/whatsapp' + search };
  const ctx = vm.createContext({
    location, URLSearchParams, encodeURIComponent,
    document: { getElementById: (id) => els[id] },
  });
  vm.runInContext(script, ctx);
  return { els, location };
}

test('file is valid UTF-8 without BOM / replacement chars / CRLF', () => {
  assert.notEqual(htmlBuf.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.ok(!html.includes('\uFFFD'));
  assert.ok(!html.includes('\r'));
  assert.match(html, /<meta charset="utf-8">/);
  assert.ok(html.includes(HEART) && html.includes(PLANE));
  assert.equal(htmlBuf.toString('utf8'), Buffer.from(html, 'utf8').toString('utf8'));
});

test('gifts link is regalos.hgstack.com, never the old/ typo domains', () => {
  assert.ok(html.includes("const gifts = 'https://regalos.hgstack.com';"));
  assert.ok(!/ghstack/.test(html));
  assert.ok(!/wa\.me/.test(html), 'wa.me 302-corrupts emojis; must not be used');
});

test('app + web launcher URLs decode to the exact expected message', () => {
  const { els, location } = run(`?phone=%2B${PHONE}&token=${TOKEN}`);
  const msg = expected(`https://marianayhernan.web.app/rsvp/${TOKEN}`, 'https://regalos.hgstack.com');
  assert.ok(location.href.startsWith(`whatsapp://send?phone=${PHONE}&text=`));
  for (const url of [location.href, els['open-app'].href, els.fallback.href]) {
    const u = new URL(url);
    assert.equal(u.searchParams.get('phone'), PHONE);
    assert.equal(u.searchParams.get('text'), msg);
  }
  assert.equal(els['open-app'].href, location.href);
  assert.ok(els.fallback.href.startsWith(`https://api.whatsapp.com/send?phone=${PHONE}&text=`));
  assert.equal(els['open-app'].hidden, false);
  assert.equal(els.fallback.hidden, false);
});

test('percent-encoding of emojis (UTF-8 bytes incl. VS16) and newlines', () => {
  const { location } = run(`?phone=${PHONE}&token=${TOKEN}`);
  const raw = location.href;
  assert.ok(raw.includes('%F0%9F%92%9B'), '💛 U+1F49B -> F0 9F 92 9B');
  assert.ok(raw.includes('%E2%9C%88%EF%B8%8F'), '✈️ U+2708 U+FE0F -> E2 9C 88 EF B8 8F');
  assert.ok(raw.includes('%0A%0A'), 'blank lines');
  assert.ok(!raw.includes('%0D'), 'no CR');
  assert.ok(!raw.includes('%EF%BF%BD'), 'no U+FFFD replacement char');
  assert.ok(!/[^\x00-\x7F]/.test(raw), 'URL is pure ASCII');
  assert.equal((raw.match(/%F0%9F%92%9B/g) || []).length, 2);
  assert.equal((raw.match(/%E2%9C%88%EF%B8%8F/g) || []).length, 1);
});

test('RSVP link keeps the personal token and the 30 de novembro deadline', () => {
  const { location } = run(`?phone=${PHONE}&token=${TOKEN}`);
  const text = new URL(location.href).searchParams.get('text');
  assert.ok(text.includes(`https://marianayhernan.web.app/rsvp/${TOKEN}\n`));
  assert.ok(text.includes('até o dia 30 de novembro'));
  assert.ok(text.endsWith('Mariana & Hernán'));
  const gifts = text.split('Nossa viagem')[1];
  assert.ok(gifts.includes('\nhttps://regalos.hgstack.com\n'));
});

test('invalid phone/token is rejected and nothing is opened', () => {
  for (const q of ['', `?phone=${PHONE}`, `?token=${TOKEN}`, `?phone=${PHONE}&token=evil`, `?phone=${PHONE}&token=mh27-%3Cscript%3E`, `?phone=abc&token=${TOKEN}`]) {
    const { els, location } = run(q);
    assert.equal(els.status.textContent, 'Link inválido.', q);
    assert.ok(!location.href.startsWith('whatsapp://'), q);
    assert.equal(els['open-app'].hidden, true);
  }
});

test('firebase.json (shortlinks site) config', () => {
  assert.equal(cfg.site, 'marianayhernan');
  assert.equal(cfg.public, 'public');
  const rsvp = cfg.redirects.find((r) => r.source === '/rsvp/:token');
  assert.equal(rsvp.type, 302);
  assert.equal(rsvp.destination, 'https://script.google.com/macros/s/AKfycbyK07SdGzPosMt72sCCmfr9K4wtof_TnsAjCsblhqjRmpo3jfJBeulI4dc7otZx6jFj/exec?t=:token');
  const root = cfg.redirects.find((r) => r.source === '/');
  assert.equal(root.destination, 'https://regalos.hgstack.com');
  assert.deepEqual(cfg.rewrites, [{ source: '/whatsapp', destination: '/whatsapp.html' }]);
  assert.ok(!JSON.stringify(cfg).includes('ghstack'));
});

test('deploy dir contains only whatsapp.html (no gifts/checkout/MP/Sheets code)', () => {
  assert.deepEqual(fs.readdirSync(path.join(root, 'public')), ['whatsapp.html']);
});
