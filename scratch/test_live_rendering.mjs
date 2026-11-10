import { spawn } from 'node:child_process';

async function testIndexRendering() {
  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9223',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions'
  ], { stdio: 'ignore' });

  await new Promise(r => setTimeout(r, 1500));

  try {
    const listResp = await fetch('http://127.0.0.1:9223/json/list');
    const pages = await listResp.json();
    const wsUrl = pages[0]?.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('Could not get CDP wsUrl');

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
    await new Promise(r => setTimeout(r, 3500));

    const evalResult = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const cards = Array.from(document.querySelectorAll('.card'));
          return {
            totalCards: cards.length,
            first5: cards.slice(0, 5).map((c, i) => ({
              position: i + 1,
              id: c.getAttribute('data-gift'),
              title: c.querySelector('h3')?.textContent,
              price: c.querySelector('.usd')?.textContent
            }))
          };
        })()
      `,
      returnByValue: true
    });

    console.log('Rendering evaluation result:', JSON.stringify(evalResult.result?.value, null, 2));
    ws.close();
  } finally {
    chromeProc.kill();
  }
}

testIndexRendering().catch(console.error);
