# vless-ws-relay

给 Render 免费 Web Service 用的最小 VLESS-over-WebSocket 中继（只做 TCP）。

## 环境变量

| 变量 | 说明 |
|---|---|
| `UUID` | 32 位十六进制（去掉连字符的 uuid4），客户端要一致 |
| `WS_PATH` | 例如 `/aBcD1234`，客户端 `ws-opts.path` 要一致 |
| `PORT` | Render 自动注入，不用设 |

## 客户端（mihomo / Clash.Meta）

```yaml
- name: rendercf
  type: vless
  server: <你的服务>.onrender.com
  port: 443
  uuid: <UUID>
  tls: true
  servername: <你的服务>.onrender.com
  udp: false          # 本中继只支持 TCP
  network: ws
  ws-opts:
    path: /<WS_PATH>
    headers:
      Host: <你的服务>.onrender.com
```

## 说明

- 证书、TLS 终止由 Render 负责，不用自备证书。
- 免费实例空闲 15 分钟会休眠，下一次请求要冷启动（约 30-60 秒）；
  用一个每 10 分钟打 `/health` 的定时任务可以保持常醒。
- 免费额度：750 实例小时/月、每月出站带宽有上限。
