// 本地自检：用 VLESS-over-WS 协议连本机 server.js，再走 TCP 取一个真实网页
const WebSocket = require('ws');

const uuid = (process.argv[2] || '').replace(/-/g, '');
const path = process.argv[3] || '/ws';
const target = process.argv[4] || 'example.com';
const tport = parseInt(process.argv[5] || '80', 10);
const port = process.env.PORT || 18123;

const dom = Buffer.from(target, 'utf8');
const head = Buffer.alloc(1 + 16 + 1 + 1 + 2 + 1 + 1 + dom.length);
let o = 0;
head[o++] = 0;                                   // version
Buffer.from(uuid, 'hex').copy(head, o); o += 16;  // uuid
head[o++] = 0;                                   // addon len
head[o++] = 1;                                   // cmd TCP
head.writeUInt16BE(tport, o); o += 2;            // port
head[o++] = 2;                                   // atyp domain
head[o++] = dom.length;
dom.copy(head, o);

const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
let out = Buffer.alloc(0);
ws.on('open', () => {
  ws.send(head);
  ws.send(Buffer.from(`GET / HTTP/1.1\r\nHost: ${target}\r\nConnection: close\r\n\r\n`));
});
ws.on('message', (m) => { out = Buffer.concat([out, Buffer.from(m)]); });
ws.on('close', () => {
  const s = out.subarray(2).toString("utf8");
  const first = s.split('\r\n')[0];
  console.log('SERVER_REPLY_FIRST_LINE=' + first);
  console.log('BYTES=' + out.length);
  process.exit(first.includes('200') ? 0 : 1);
});
ws.on('error', (e) => { console.log('WS_ERROR=' + e.message); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 15000);
