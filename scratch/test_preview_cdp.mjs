import { spawn } from 'node:child_process';

async function testPreviewSafety() {
  console.log('Launching headless Chrome...');
  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions'
  ], { stdio: 'ignore' });

  // Wait for Chrome to listen
  await new Promise(r => setTimeout(r, 1500));

  try {
    const listResp = await fetch('http://127.0.0.1:9222/json/list');
    const pages = await listResp.json();
    const wsUrl = pages[0]?.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('Could not get CDP wsUrl');

    console.log('Connecting WebSocket to CDP:', wsUrl);
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

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

    const interceptedRequests = [];
    const dialogs = [];

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.method === 'Network.requestWillBeSent') {
        const url = data.params.request.url;
        if (url.includes('script.google.com') || url.includes('workers.dev') || url.includes('mercadopago')) {
          interceptedRequests.push(url);
          console.log('[NETWORK REQUEST]:', url);
        }
      }
      if (data.method === 'Page.javascriptDialogOpening') {
        console.log('[ALERT DIALOG]:', data.params.message);
        dialogs.push(data.params.message);
        // Accept the dialog
        send('Page.handleJavaScriptDialog', { accept: true });
      }
    });

    await send('Network.enable');
    await send('Page.enable');
    await send('DOM.enable');

    console.log('Navigating to https://marianayhernan.web.app/preview.html...');
    await send('Page.navigate', { url: 'https://marianayhernan.web.app/preview.html' });

    // Wait for load
    await new Promise(r => setTimeout(r, 3000));

    // Click on Card #4 (V09-081)
    console.log('Clicking card V09-081 in preview...');
    const evalCard = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const card = document.querySelector('[data-gift="V09-081"]');
          if (card) { card.click(); return 'card_clicked'; }
          return 'card_not_found';
        })()
      `,
      returnByValue: true
    });
    console.log('Card click evaluation:', evalCard.result?.value);

    await new Promise(r => setTimeout(r, 1000));

    // Now click the "giftBtn" inside the dialog
    console.log('Clicking gift button #giftBtn...');
    const evalBtn = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = document.getElementById('giftBtn');
          if (btn) { btn.click(); return 'btn_clicked'; }
          return 'btn_not_found';
        })()
      `,
      returnByValue: true
    });
    console.log('Gift button evaluation:', evalBtn.result?.value);

    await new Promise(r => setTimeout(r, 2000));

    console.log('--- RESULTS ---');
    console.log('Dialogs triggered:', dialogs);
    console.log('Intercepted backend/checkout requests:', interceptedRequests);

    const safe = interceptedRequests.length === 0 && dialogs.some(d => d.includes('Modo vista previa'));
    console.log('PREVIEW TEST PASS:', safe);

    ws.close();
  } finally {
    chromeProc.kill();
  }
}

testPreviewSafety().catch(console.error);
