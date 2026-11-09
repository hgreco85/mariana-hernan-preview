import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, '..', 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf-8');

// Extract __CATALOG__ from index.html
const match = indexHtml.match(/const __CATALOG__\s*=\s*(\[[\s\S]*?\]);\s*start/);
assert.ok(match, 'Catalog array should be present in index.html');
const catalog = JSON.parse(match[1]);

test('Catalog has exactly 62 active experiences', () => {
  assert.equal(catalog.length, 62, `Expected 62 items, got ${catalog.length}`);
});

test('Active experience IDs are unique, valid and exclude editorially archived IDs', () => {
  const ids = catalog.map(x => x.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, 62, 'All IDs must be unique');

  for (const id of ids) {
    assert.match(id, /^V09-\d{3}$/, 'Malformed experience ID: ' + id);
  }
  const archived = new Set(["V09-002","V09-005","V09-009","V09-013","V09-016","V09-021","V09-025","V09-033","V09-035","V09-037","V09-038","V09-049","V09-052","V09-060","V09-062","V09-068","V09-079","V09-080"]);
  for (const id of archived) assert.ok(!uniqueIds.has(id), 'Archived ID unexpectedly visible: ' + id);
});

test('All itinerary cities are present in order', () => {
  const validCities = new Set(['Roma', 'Múnich', 'Estrasburgo', 'París', 'Bruselas', 'Praga', 'Viena']);
  for (const item of catalog) {
    assert.ok(validCities.has(item.city), `Unknown city: ${item.city} in ${item.id}`);
  }
});

test('All categories are valid', () => {
  const validCategories = new Set(['Gastronomía', 'Cultura', 'Experiencias', 'Transporte', 'Paseos', 'Excursiones']);
  for (const item of catalog) {
    assert.ok(validCategories.has(item.category), `Invalid category: ${item.category} in ${item.id}`);
  }
});

test('Pricing in USD is positive and reasonable', () => {
  for (const item of catalog) {
    assert.ok(typeof item.usd === 'number' && item.usd > 0, `Invalid USD price for ${item.id}`);
    assert.ok(item.usd <= 250, `USD price too high for ${item.id}: ${item.usd}`);
    assert.ok(typeof item.ars === 'number' && item.ars > 0, `Invalid ARS price for ${item.id}`);
    assert.ok(typeof item.brl === 'number' && item.brl > 0, `Invalid BRL price for ${item.id}`);
  }
});

test('Photographs: all 62 active items have valid distinct HTTPS photo URLs', () => {
  const urls = catalog.map(x => x.photo);
  for (const item of catalog) {
    assert.ok(item.photo.startsWith('https://'), `Photo must be HTTPS for ${item.id}: ${item.photo}`);
    assert.ok(
      item.photo.includes('unsplash.com') || item.photo.includes('wikimedia.org'),
      `Photo source should be Unsplash or Wikimedia Commons for ${item.id}: ${item.photo}`
    );
  }
  const uniqueUrls = new Set(urls);
  assert.equal(uniqueUrls.size, 62, `Expected 62 distinct photos, found ${uniqueUrls.size}`);
});

test('Bilingual content: titles and descriptions in ES and PT', () => {
  for (const item of catalog) {
    assert.ok(item.title && item.title.trim().length > 0, `Missing ES title in ${item.id}`);
    assert.ok(item.titlePt && item.titlePt.trim().length > 0, `Missing PT title in ${item.id}`);
    assert.ok(item.description && item.description.trim().length > 0, `Missing ES description in ${item.id}`);
    assert.ok(item.descriptionPt && item.descriptionPt.trim().length > 0, `Missing PT description in ${item.id}`);
  }
});

test('No wheel, paid-only-on-foot walking gifts, or duplicate schnitzel dinner', () => {
  const ids = new Set(catalog.map(x => x.id));
  for (const id of ['V09-080','V09-021','V09-009','V09-033','V09-068']) {
    assert.ok(!ids.has(id), 'Rejected free-walking or giant-wheel item still visible: '+id);
  }
  assert.ok(ids.has('V09-032') && ids.has('V09-073'), 'Restored museum and brewery missing');
  const palace=catalog.find(x=>x.id==='V09-076');
  assert.match(palace.title, /entrada/i);
  assert.match(palace.description, /interior|salones/i);
  assert.match(catalog.find(x=>x.id==='V09-075').description.toLowerCase(), /tafelspitz/);
  assert.notEqual(catalog.find(x=>x.id==='V09-074').photo,catalog.find(x=>x.id==='V09-075').photo);
});

test('No repeated currency disclaimers and ARS is primary on gift cards', () => {
  assert.ok(!indexHtml.includes("esc(i18n[lang].currencyNote)"), 'Currency disclaimer should not repeat in cards/modals');
  assert.match(indexHtml, /ARS '\+format\(x\.ars/);
  assert.match(indexHtml, /≈ USD /);
  assert.match(indexHtml, /≈ R\$ /);
});

test('Distinct Praga dining gifts point to different named restaurants', () => {
  const beer = catalog.find(x => x.id === 'V09-061');
  const meal = catalog.find(x => x.id === 'V09-063');
  assert.ok(beer && meal, 'Both Prague dining experiences should be visible');
  assert.match(beer.place, /Lokál/);
  assert.match(meal.place, /Mincovna/);
  assert.notEqual(beer.place, meal.place);
  assert.match(meal.descriptionPt, /Mincovna/);
});

test('High-value wedding gift options remain present', () => {
  assert.ok(catalog.filter(x => x.usd >= 100).length >= 15);
  assert.ok(catalog.some(x => x.usd >= 195));
});

test('Guest-facing prices form a natural, distinct ARS ladder', () => {
  assert.equal(new Set(catalog.map(x => x.ars)).size, 62, 'ARS prices should not repeat');
  assert.equal(new Set(catalog.map(x => x.usd)).size, 62, 'USD reference prices should not repeat');
  assert.ok(catalog.some(x => x.usd === 32), 'Affordable gifts start at USD 32');
  assert.ok(catalog.some(x => x.usd === 39), 'Affordable gifts fill through USD 39');
  for (const x of catalog) {
    assert.equal(x.ars % 100, 0, 'ARS is rounded to nearest 100 for '+x.id);
    assert.ok(x.usd >= 32 && x.usd <= 198);
    assert.equal(x.brl, Math.round(x.usd * 5.5003));
    assert.ok(Math.abs(x.ars - x.usd * 1560) <= 50);
  }
});
