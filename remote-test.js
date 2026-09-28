// 直接对 Render 上的节点做端到端验证（手机本地跑，不经过电脑）
// 用法：UUID=xx WS_PATH=/xx node remote-test.js
const WebSocket = require('ws');

const HOST = process.env.NODE_HOST || 'vless-ws-relay.onrender.com';
const UUID = (process.env.UUID || '').replace(/-/g, '');
const WS_PATH = process.env.WS_PATH;
if (!UUID || !WS_PATH) { console.log('NEED UUID/WS_PATH'); process.exit(2); }

function probe(target, port, req, uuid) {
  return new Promise((resolve) => {
    const dom = Buffer.from(target, 'utf8');
    const head = Buffer.alloc(1 + 16 + 1 + 1 + 2 + 1 + 1 + dom.length);
    let o = 0;
    head[o++] = 0;
    Buffer.from(uuid, 'hex').copy(head, o); o += 16;
    head[o++] = 0;
    head[o++] = 1;
    head.writeUInt16BE(port, o); o += 2;
    head[o++] = 2;
    head[o++] = dom.length;
    dom.copy(head, o);

    const ws = new WebSocket(`wss://${HOST}${WS_PATH}`, { handshakeTimeout: 20000 });
    let out = Buffer.alloc(0);
    const t0 = Date.now();
    const done = (tag) => {
      const s = out.toString('utf8');
      const body = s.split('\r\n\r\n')[1] || '';
      console.log(`${tag} | ${Date.now() - t0}ms | ${s.split('\r\n')[0] || '(no response)'} | ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
      resolve();
    };
    ws.on('open', () => { ws.send(head); ws.send(Buffer.from(req)); });
    ws.on('message', (m) => { out = Buffer.concat([out, Buffer.from(m)]); });
    ws.on('close', () => done(target));
    ws.on('error', (e) => { console.log(`${target} | WS_ERROR ${e.message}`); resolve(); });
    setTimeout(() => { try { ws.close(); } catch (e) {} done(target + ' (timeout)'); }, 30000);
  });
}

(async () => {
  await probe('ip-api.com', 80, 'GET /line/?fields=query,country,isp,as HTTP/1.1\r\nHost: ip-api.com\r\nConnection: close\r\n\r\n', UUID);
  await probe('www.google.com', 80, 'GET / HTTP/1.1\r\nHost: www.google.com\r\nConnection: close\r\n\r\n', UUID);
  await probe('www.baidu.com', 80, 'GET / HTTP/1.1\r\nHost: www.baidu.com\r\nConnection: close\r\n\r\n', UUID);
  await probe('ip-api.com', 80, 'GET /line/?fields=query HTTP/1.1\r\nHost: ip-api.com\r\nConnection: close\r\n\r\n', '00'.repeat(16));
  process.exit(0);
})();
