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

test('Catalog has exactly 65 active experiences', () => {
  assert.equal(catalog.length, 65, `Expected 65 items, got ${catalog.length}`);
});

test('Active experience IDs are unique, valid and exclude editorially archived IDs', () => {
  const ids = catalog.map(x => x.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, 65, 'All IDs must be unique');

  for (const id of ids) {
    assert.match(id, /^V09-\\d{3}$/, 'Malformed experience ID: ' + id);
  }
  const archived = new Set(["V09-002","V09-005","V09-013","V09-016","V09-025","V09-032","V09-035","V09-037","V09-038","V09-049","V09-052","V09-060","V09-062","V09-073","V09-079"]);
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

test('Photographs: all 65 active items have valid distinct HTTPS photo URLs', () => {
  const urls = catalog.map(x => x.photo);
  for (const item of catalog) {
    assert.ok(item.photo.startsWith('https://'), `Photo must be HTTPS for ${item.id}: ${item.photo}`);
    assert.ok(
      item.photo.includes('unsplash.com') || item.photo.includes('wikimedia.org'),
      `Photo source should be Unsplash or Wikimedia Commons for ${item.id}: ${item.photo}`
    );
  }
  const uniqueUrls = new Set(urls);
  assert.equal(uniqueUrls.size, 65, `Expected 65 distinct photos, found ${uniqueUrls.size}`);
});

test('Bilingual content: titles and descriptions in ES and PT', () => {
  for (const item of catalog) {
    assert.ok(item.title && item.title.trim().length > 0, `Missing ES title in ${item.id}`);
    assert.ok(item.titlePt && item.titlePt.trim().length > 0, `Missing PT title in ${item.id}`);
    assert.ok(item.description && item.description.trim().length > 0, `Missing ES description in ${item.id}`);
    assert.ok(item.descriptionPt && item.descriptionPt.trim().length > 0, `Missing PT description in ${item.id}`);
  }
});
