// VLESS over WebSocket relay (for Render free web service)
// 环境变量：UUID=<32位hex>  WS_PATH=/<路径>  [DOH=https://1.1.1.1/dns-query]
// 支持：cmd=1 TCP（原样转发）、cmd=2 UDP（仅 DNS 端口 53，转成 DoH 发出去）
// 只在 DNS 上支持 UDP 是业界通行做法（参见 zizifn/edgetunnel）：免费平台上没有原始 UDP 出口。
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const WS_PATH = process.env.WS_PATH || '/ws';
const DOH = process.env.DOH || 'https://1.1.1.1/dns-query';
const UUID_HEX = (process.env.UUID || '').replace(/-/g, '').toLowerCase();
if (UUID_HEX.length !== 32) {
  console.error('FATAL: env UUID must be a 32-hex (uuid4 without dashes) value');
  process.exit(1);
}
const UUID_BYTES = Buffer.from(UUID_HEX, 'hex');

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === WS_PATH) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  if (!req.url || req.url.split('?')[0] !== WS_PATH) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => handle(ws));
});

// DNS over HTTPS：把 UDP:53 的载荷用 HTTPS POST 送出去，拿回二进制答复
async function dohQuery(packet) {
  const res = await fetch(DOH, {
    method: 'POST',
    headers: { 'content-type': 'application/dns-message' },
    body: packet,
  });
  if (!res.ok) throw new Error('doh http ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

function handle(ws) {
  let phase = 'header'; // header -> tcp / udp
  let buf = Buffer.alloc(0);
  let remote = null;

  let udpBuf = Buffer.alloc(0);
  let udpBusy = 0;

  ws.on('error', () => { if (remote) remote.destroy(); });
  ws.on('close', () => { if (remote) remote.destroy(); });

  function send(data) {
    if (ws.readyState === 1) ws.send(data, { binary: true });
  }
  function fail() {
    if (remote) remote.destroy();
    try { ws.close(); } catch (e) {}
  }

  // UDP：流里是「2 字节大端长度 + 数据」的连续包
  function udpFeed(data) {
    udpBuf = Buffer.concat([udpBuf, data]);
    if (udpBuf.length > 262144) { udpBuf = Buffer.alloc(0); return; }
    while (udpBuf.length >= 2) {
      const len = udpBuf.readUInt16BE(0);
      if (udpBuf.length < 2 + len) break;
      const packet = udpBuf.subarray(2, 2 + len);
      udpBuf = udpBuf.subarray(2 + len);
      udpBusy++;
      dohQuery(packet)
        .then((answer) => {
          const head = Buffer.alloc(2);
          head.writeUInt16BE(answer.length, 0);
          send(Buffer.concat([head, answer]));
        })
        .catch(() => {})
        .finally(() => { udpBusy--; });
    }
  }

  ws.on('message', (data) => {
    const d = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (phase === 'tcp') {
      if (remote && !remote.destroyed) remote.write(d);
      return;
    }
    if (phase === 'udp') {
      udpFeed(d);
      return;
    }

    buf = Buffer.concat([buf, d]);
    // VLESS 请求头：ver(1) uuid(16) addonLen(1) addons cmd(1) port(2) atyp(1) addr
    if (buf.length < 18) return;
    if (buf[0] !== 0) return fail();
    if (!buf.subarray(1, 17).equals(UUID_BYTES)) return fail();
    const addonLen = buf[17];
    let p = 18 + addonLen;
    if (buf.length < p + 4) return; // cmd + port + atyp
    const cmd = buf[p];
    const port = buf.readUInt16BE(p + 1);
    const atyp = buf[p + 3];
    p += 4;

    let host;
    if (atyp === 1) {
      if (buf.length < p + 4) return;
      host = buf.subarray(p, p + 4).join('.');
      p += 4;
    } else if (atyp === 2) {
      if (buf.length < p + 1) return;
      const len = buf[p];
      if (buf.length < p + 1 + len) return;
      host = buf.subarray(p + 1, p + 1 + len).toString('utf8');
      p += 1 + len;
    } else if (atyp === 3) {
      if (buf.length < p + 16) return;
      const seg = [];
      for (let i = 0; i < 16; i += 2) seg.push(buf.readUInt16BE(p + i).toString(16));
      host = seg.join(':');
      p += 16;
    } else {
      return fail();
    }

    const rest = buf.subarray(p);
    buf = null;

    // VLESS 响应头：版本 0 + 附加长度 0（sing-box / mihomo 都会先读这两个字节，
    // 漏了它们客户端会把载荷的第一个字节当成版本号，报 “unknown version” / “unexpected response version”）
    send(Buffer.from([0, 0]));

    if (cmd === 2) {
      if (port !== 53) {
        // 非 DNS 的 UDP（QUIC、游戏等）免费平台上没有出口，直接不回应：
        // 客户端会在超时后自动回落到 TCP，不影响网页访问
        phase = 'udp';
        return;
      }
      phase = 'udp';
      if (rest.length) udpFeed(rest);
      return;
    }
    if (cmd !== 1) return fail(); // 1 = TCP

    phase = 'tcp';

    function shutdown() {
      try { if (ws.readyState === 1) ws.close(); } catch (e) {}
      // 有些链路上 close 帧会被拖住，1.5 秒后强拆，避免大量半死连接堆积
      setTimeout(() => { try { ws.terminate(); } catch (e) {} }, 1500);
      setTimeout(() => { try { remote.destroy(); } catch (e) {} }, 1600);
    }

    remote = net.connect({ host, port }, () => {
      clearTimeout(ct);
      if (rest.length) remote.write(rest);
    });
    // 只给“建连阶段”超时，不设空闲超时（长连接代理不能被误杀）
    const ct = setTimeout(() => { try { remote.destroy(); } catch (e) {} }, 15000);
    remote.on('data', (chunk) => send(chunk));
    remote.on('close', shutdown);
    remote.on('error', shutdown);
  });
}

server.listen(PORT, '0.0.0.0', () => console.log('listening on ' + PORT + ' path ' + WS_PATH + ' doh ' + DOH));
