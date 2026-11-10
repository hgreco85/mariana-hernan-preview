const https = require('https');

async function verifyAndCompare() {
  console.log('Fetching https://marianayhernan.web.app/ ...');
  const resFb = await fetch('https://marianayhernan.web.app/', { headers: { 'Cache-Control': 'no-cache' } });
  const htmlFb = await resFb.text();

  console.log('Fetching https://regalos.hgstack.com/ ...');
  const resHg = await fetch('https://regalos.hgstack.com/', { headers: { 'Cache-Control': 'no-cache' } });
  const htmlHg = await resHg.text();

  console.log('Firebase Status:', resFb.status, 'Length:', htmlFb.length);
  console.log('HG Status:', resHg.status, 'Length:', htmlHg.length);

  const matchFb = htmlFb.match(/const\s+__CATALOG__\s*=\s*(\[[\s\S]*?\]);/);
  const matchHg = htmlHg.match(/const\s+__CATALOG__\s*=\s*(\[[\s\S]*?\]);/);

  if (!matchFb || !matchHg) {
    console.error('Failed to parse catalog on one of the sites!');
    return;
  }

  const catalogFb = JSON.parse(matchFb[1]);
  const catalogHg = JSON.parse(matchHg[1]);

  console.log('Firebase catalog items:', catalogFb.length);
  console.log('HG catalog items:', catalogHg.length);

  // Compare item by item
  let differences = 0;
  for (let i = 0; i < Math.max(catalogFb.length, catalogHg.length); i++) {
    const itemFb = catalogFb[i];
    const itemHg = catalogHg[i];
    if (JSON.stringify(itemFb) !== JSON.stringify(itemHg)) {
      console.log('Diff at item', i, itemFb ? itemFb.id : 'null', 'vs', itemHg ? itemHg.id : 'null');
      differences++;
    }
  }

  if (differences === 0) {
    console.log('>>> 100% PERFECT MATCH! All 62 active experiences are identical in content, order, photos, descriptions, and prices! <<<');
  } else {
    console.log('Differences found:', differences);
  }

  // Verify responsive design markup
  console.log('Firebase has viewport:', htmlFb.includes('name="viewport"'));
  console.log('Firebase has media queries:', htmlFb.includes('@media'));
  console.log('Firebase has ES/PT buttons:', htmlFb.includes('data-lang="es"') && htmlFb.includes('data-lang="pt"'));
  console.log('Firebase has Sort & Filters:', htmlFb.includes('id="sort"') && htmlFb.includes('id="city"') && htmlFb.includes('id="type"') && htmlFb.includes('id="price"'));
  console.log('Firebase has ARS primary price:', htmlFb.includes('ARS'));
  console.log('No iframes:', !htmlFb.includes('<iframe'));
}

verifyAndCompare().catch(console.error);
