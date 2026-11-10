async function check() {
  const [f, g] = await Promise.all([
    fetch('https://marianayhernan.web.app/preview.html').then(r => r.text()),
    fetch('https://regalos.hgstack.com/preview.html').then(r => r.text())
  ]);
  const needle = "alert('Modo vista previa: pagos y reservas deshabilitados.');";
  console.log('Firebase has 54da6319:', f.includes(needle));
  console.log('GitHub Pages has 54da6319:', g.includes(needle));
  const fNorm = f.replace(/\r\n/g, '\n');
  const gNorm = g.replace(/\r\n/g, '\n');
  console.log('Parity (normalized):', fNorm === gNorm);
}
check();
