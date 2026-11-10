import { spawn } from 'node:child_process';

async function testPilotGate() {
  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9225',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions'
  ], { stdio: 'ignore' });

  await new Promise(r => setTimeout(r, 1500));

  try {
    const listResp = await fetch('http://127.0.0.1:9225/json/list');
    const pages = await listResp.json();
    const wsUrl = pages[0]?.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('No wsUrl');

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const msgId = id++;
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === msgId) {
            ws.removeEventListener('message', handler);
            resolve(data.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Navigating to https://marianayhernan.web.app/ ...');
    await send('Page.navigate', { url: 'https://marianayhernan.web.app/' });
    await new Promise(r => setTimeout(r, 4000));

    const evalResult = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const cards = Array.from(document.querySelectorAll('.card'));
          const card4 = cards[3];
          const img = card4?.querySelector('img');
          return {
            totalCards: cards.length,
            card4: {
              id: card4?.getAttribute('data-gift'),
              title: card4?.querySelector('h3')?.textContent,
              price: card4?.querySelector('.usd')?.textContent,
              imgSrc: img?.getAttribute('src'),
              imgComplete: img?.complete,
              imgNaturalWidth: img?.naturalWidth
            },
            workerUrl: typeof WORKER_URL !== 'undefined' ? WORKER_URL : null
          };
        })()
      `,
      returnByValue: true
    });

    console.log('Pilot Preflight Result:\n', JSON.stringify(evalResult.result?.value, null, 2));
    ws.close();
  } finally {
    chromeProc.kill();
  }
}

testPilotGate().catch(console.error);
