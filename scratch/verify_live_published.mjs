async function verifyDomains() {
  const [f, g] = await Promise.all([
    fetch('https://marianayhernan.web.app/').then(r => r.text()),
    fetch('https://regalos.hgstack.com/').then(r => r.text())
  ]);

  console.log('Firebase length:', f.length, 'GitHub Pages length:', g.length);
  const fNorm = f.replace(/\r\n/g, '\n');
  const gNorm = g.replace(/\r\n/g, '\n');
  console.log('Normalized parity (index.html):', fNorm === gNorm);

  const v81InFirebase = f.includes('V09-081');
  const v81InGithub = g.includes('V09-081');
  console.log('V09-081 in Firebase index.html:', v81InFirebase);
  console.log('V09-081 in GitHub Pages index.html:', v81InGithub);

  // Extract catalog from Firebase index.html
  const catIdx = f.indexOf('const __CATALOG__=');
  const endIdx = f.lastIndexOf('];');
  const catalog = JSON.parse(f.slice(catIdx + 18, endIdx + 1));
  console.log('Catalog count in published index.html:', catalog.length);
  const item4 = catalog.find(x => x.id === 'V09-081');
  console.log('V09-081 in published index.html:', JSON.stringify(item4));
}
verifyDomains().catch(console.error);
