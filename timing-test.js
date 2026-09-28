const WebSocket = require('ws');
const HOST = process.env.NODE_HOST || 'vless-ws-relay.onrender.com';
const UUID = (process.env.UUID || '').replace(/-/g,'');
const WS_PATH = process.env.WS_PATH;
function probe(target, port, n) {
  return new Promise((resolve) => {
    const dom = Buffer.from(target,'utf8');
    const head = Buffer.alloc(1+16+1+1+2+1+1+dom.length); let o=0;
    head[o++]=0; Buffer.from(UUID,'hex').copy(head,o); o+=16; head[o++]=0; head[o++]=1;
    head.writeUInt16BE(port,o); o+=2; head[o++]=2; head[o++]=dom.length; dom.copy(head,o);
    const t0=Date.now(); let tOpen=0,tFirst=0,bytes=0;
    const ws=new WebSocket(`wss://${HOST}${WS_PATH}`,{handshakeTimeout:30000});
    ws.on('open',()=>{ tOpen=Date.now()-t0; ws.send(head);
      ws.send(Buffer.from(`GET / HTTP/1.1\r\nHost: ${target}\r\nConnection: close\r\n\r\n`)); });
    ws.on('message',(m)=>{ if(!tFirst) tFirst=Date.now()-t0; bytes+=m.length; });
    const fin=()=>{ console.log(`${n} ${target}: ws_open=${tOpen}ms first_byte=${tFirst}ms total=${Date.now()-t0}ms bytes=${bytes}`); resolve(); };
    ws.on('close',fin); ws.on('error',(e)=>{console.log(`${n} ERR ${e.message}`);resolve();});
    setTimeout(()=>{try{ws.close()}catch(e){} fin();},45000);
  });
}
(async()=>{
  for (let i=1;i<=3;i++) await probe('example.com',80,'#'+i);
  await probe('www.google.com',80,'#4');
  process.exit(0);
})();
