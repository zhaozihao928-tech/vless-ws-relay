// VLESS over WebSocket relay (for Render free web service)
// 用法：环境变量 UUID=<uuid>  WS_PATH=/<路径>  （PORT 由 Render 注入）
// 不带 UDP（只做 TCP）；客户端 mihomo 里该节点要设 udp: false。
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const WS_PATH = process.env.WS_PATH || '/ws';
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

function handle(ws) {
  let buf = Buffer.alloc(0);
  let remote = null;

  ws.on('error', () => { if (remote) remote.destroy(); });
  ws.on('close', () => { if (remote) remote.destroy(); });

  function fail() {
    if (remote) remote.destroy();
    try { ws.close(); } catch (e) {}
  }

  ws.on('message', (data) => {
    const d = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (remote) {
      if (!remote.destroyed) remote.write(d);
      return;
    }

    buf = Buffer.concat([buf, d]);
    // VLESS request: ver(1) uuid(16) addonLen(1) addons cmd(1) port(2) atyp(1) addr
    if (buf.length < 18) return;
    if (buf[0] !== 0) return fail();
    if (!buf.subarray(1, 17).equals(UUID_BYTES)) return fail();
    const addonLen = buf[17];
    let p = 18 + addonLen;
    if (buf.length < p + 4) return; // cmd + port + atyp
    const cmd = buf[p];
    if (cmd !== 1) return fail(); // 1 = TCP
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
    remote.on('data', (chunk) => {
      if (ws.readyState === 1) ws.send(chunk, { binary: true });
    });
    remote.on('close', shutdown);
    remote.on('error', shutdown);
  });
}

server.listen(PORT, '0.0.0.0', () => console.log('listening on ' + PORT + ' path ' + WS_PATH));
