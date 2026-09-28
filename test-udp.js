// UDP/DNS 自检：用 VLESS cmd=2 走本机 server.js，看 DNS 答复能不能正常回来
const WebSocket = require('ws');

const UUID = (process.env.UUID || '').replace(/-/g, '');
const WS_PATH = process.env.WS_PATH || '/ws';
const PORT = process.env.PORT || 18140;
const NAME = process.argv[2] || 'www.youtube.com';

function dnsQuery(name, id) {
  const parts = [];
  for (const l of name.split('.')) parts.push(Buffer.from([l.length]), Buffer.from(l, 'utf8'));
  const qname = Buffer.concat([...parts, Buffer.from([0])]);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(0x0100, 2); // 标准查询，期望递归
  head.writeUInt16BE(1, 4);      // qdcount
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(1, 0);      // qtype A
  tail.writeUInt16BE(1, 2);      // qclass IN
  return Buffer.concat([head, qname, tail]);
}

function parseAnswers(buf) {
  const id = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  const qd = buf.readUInt16BE(4), an = buf.readUInt16BE(6);
  // 跳过 question
  let p = 12;
  while (p < buf.length && buf[p] !== 0) p += 1 + buf[p];
  p += 5; // 结尾 0 + qtype + qclass
  const ips = [];
  for (let i = 0; i < an && p + 12 <= buf.length; i++) {
    const type = buf.readUInt16BE(p + 2);
    const rdlen = buf.readUInt16BE(p + 10);
    if (type === 1 && rdlen === 4) ips.push(buf.subarray(p + 12, p + 16).join('.'));
    p += 12 + rdlen;
  }
  return { id, rcode: flags & 0x0f, qd, an, ips };
}

const id = 0x4321;
const q = dnsQuery(NAME, id);

const head = Buffer.alloc(1 + 16 + 1 + 1 + 2 + 1 + 4);
let o = 0;
head[o++] = 0;
Buffer.from(UUID, 'hex').copy(head, o); o += 16;
head[o++] = 0;
head[o++] = 2;                       // cmd=2 UDP
head.writeUInt16BE(53, o); o += 2;   // port 53
head[o++] = 1;                       // atyp IPv4
Buffer.from([8, 8, 8, 8]).copy(head, o);

const NODE_HOST = process.env.NODE_HOST || '';
const url = NODE_HOST ? `wss://${NODE_HOST}${WS_PATH}` : `ws://127.0.0.1:${PORT}${WS_PATH}`;
const ws = new WebSocket(url);
let acc = Buffer.alloc(0);
const t0 = Date.now();
ws.on('open', () => {
  ws.send(head);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(q.length, 0);
  ws.send(Buffer.concat([len, q]));
});
ws.on('message', (m) => {
  acc = Buffer.concat([acc, Buffer.from(m)]);
  if (acc.length < 2) return;
  const vlessVer = acc[0], addonLen = acc[1];
  if (vlessVer !== 0) { console.log('BAD_VLESS_VERSION=' + vlessVer); process.exit(1); }
  const body = acc.subarray(2 + addonLen);
  if (body.length < 2) return;
  const l = body.readUInt16BE(0);
  if (body.length < 2 + l) return;
  const dns = body.subarray(2, 2 + l);
  const r = parseAnswers(dns);
  console.log(`DNS_OK name=${NAME} id_match=${r.id === id} rcode=${r.rcode} answers=${r.an} ips=${r.ips.join(',') || '(none)'} ${Date.now() - t0}ms`);
  process.exit(r.id === id && r.an > 0 ? 0 : 1);
});
ws.on('error', (e) => { console.log('WS_ERROR ' + e.message); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 20000);
