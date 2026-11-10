import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

async function testHashDeeplink() {
  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9226',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions'
  ], { stdio: 'ignore' });

  await new Promise(r => setTimeout(r, 1500));

  try {
    const listResp = await fetch('http://127.0.0.1:9226/json/list');
    const pages = await listResp.json();
    const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let msgId = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        const handler = (e) => {
          const d = JSON.parse(e.data);
          if (d.id === id) {
            ws.removeEventListener('message', handler);
            resolve(d.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');

    const fileUrl = 'file:///' + htmlPath + '#V09-081';
    console.log('Navigating to ' + fileUrl + ' ...');
    await send('Page.navigate', { url: fileUrl });
    await new Promise(r => setTimeout(r, 2000));

    const evalResult = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const overlay = document.getElementById('overlay');
          const isOpen = overlay?.classList.contains('open');
          const title = overlay?.querySelector('h2')?.textContent;
          const price = overlay?.querySelector('.content h2:nth-of-type(2)')?.textContent;
          const giftBtn = document.getElementById('giftBtn');
          return {
            hash: window.location.hash,
            isOpen,
            modalTitle: title,
            modalPrice: price,
            hasGiftBtn: Boolean(giftBtn),
            giftBtnText: giftBtn?.textContent
          };
        })()
      `,
      returnByValue: true
    });

    console.log('Deeplink test evaluation:\n', JSON.stringify(evalResult.result?.value, null, 2));
    ws.close();
  } finally {
    chromeProc.kill();
  }
}

testHashDeeplink().catch(console.error);
