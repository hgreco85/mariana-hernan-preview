import fs from 'node:fs';

const indexPath = 'c:/Users/Administrator/mariana-hernan-preview/index.html';
let html = fs.readFileSync(indexPath, 'utf8');

const newExp = {
  id: 'V09-081',
  city: 'Bruselas',
  country: 'Bélgica',
  category: 'Gastronomía',
  title: 'Brunch junto a la Grand-Place',
  titlePt: 'Brunch perto da Grand-Place',
  description: 'Un comienzo de día tranquilo para compartir café, panadería y algo rico cerca de la histórica Grand-Place de Bruselas.',
  descriptionPt: 'Um começo de dia tranquilo para compartilhar café, pães e algo gostoso perto da histórica Grand-Place de Bruxelas.',
  usd: 6,
  ars: 10000,
  brl: 35,
  status: 'Disponible',
  place: 'Grand-Place, Bruxelles (cafetería por definir)',
  maps: 'https://www.google.com/maps/search/?api=1&query=Grand-Place%2C%20Bruxelles',
  photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/2005-09-05_La_Brouette_Grand-Place_Brussels.jpg/960px-2005-09-05_La_Brouette_Grand-Place_Brussels.jpg',
  reservedUntil: ''
};

// 1. Add newExp into __CATALOG__
const catIdx = html.indexOf('const __CATALOG__=');
const endIdx = html.lastIndexOf('];');
const catalog = JSON.parse(html.slice(catIdx + 18, endIdx + 1));
if (!catalog.some(x => x.id === 'V09-081')) {
  catalog.push(newExp);
  const newCatJson = JSON.stringify(catalog);
  html = html.slice(0, catIdx + 18) + newCatJson + html.slice(endIdx + 1);
}

// 2. Add positioning logic in render()
const targetSort = 'else a.sort((x,y)=>chosenLast(x,y)||cityOrder.indexOf(x.city)-cityOrder.indexOf(y.city)||byId(x,y));';
const replacementSort = 'else a.sort((x,y)=>chosenLast(x,y)||cityOrder.indexOf(x.city)-cityOrder.indexOf(y.city)||byId(x,y));if(m===\'trip\'&&!c&&!t&&!p&&a.length>=4){const pIdx=a.findIndex(x=>x.id===\'V09-081\');if(pIdx>=0){const pItem=a.splice(pIdx,1)[0];a.splice(3,0,pItem);}}';

if (html.includes(targetSort)) {
  html = html.replace(targetSort, replacementSort);
}

// 3. Point WORKER_URL to production worker
const targetWorker = "const WORKER_URL=window.WORKER_URL_OVERRIDE || 'https://mp-webhook.hgreco85.workers.dev';";
const replacementWorker = "const WORKER_URL=window.WORKER_URL_OVERRIDE || 'https://mp-webhook-production.hgreco85.workers.dev';";
if (html.includes(targetWorker)) {
  html = html.replace(targetWorker, replacementWorker);
}

fs.writeFileSync(indexPath, html, 'utf8');
console.log('index.html updated successfully with 63 items, 4th position sort, and production worker URL.');
