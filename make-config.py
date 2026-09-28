#!/usr/bin/env python3
# make-config.py —— 从 ~/.config/vless-relay/creds.env 生成两样东西（密钥不写进仓库）：
#   1) phone-link.txt   : vless:// 分享链接（v2rayNG/sing-box/小火箭都能导入），并写入手机剪贴板
#   2) mihomo-render.yaml: 给 5070 用的 mihomo 节点配置（先本地端口验证，再开 TUN）
# 用法：python3 make-config.py [--no-clip]
import json, os, subprocess, sys, urllib.parse

CREDS = os.path.expanduser('~/.config/vless-relay/creds.env')
HOST = os.environ.get('NODE_HOST', 'vless-ws-relay.onrender.com')
OUTDIR = os.path.dirname(os.path.abspath(__file__))


def load():
    env = {}
    with open(CREDS) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k] = v
    return env


def main():
    env = load()
    uuid, path = env['UUID'], env['WS_PATH']

    query = urllib.parse.urlencode({
        'encryption': 'none', 'security': 'tls', 'sni': HOST, 'alpn': 'http/1.1',
        'fp': 'chrome', 'type': 'ws', 'host': HOST, 'path': path,
    }, quote_via=urllib.parse.quote, safe='/')
    link = f'vless://{uuid}@{HOST}:443?{query}#Render-SG-free'
    with open(os.path.join(OUTDIR, 'phone-link.txt'), 'w') as f:
        f.write(link + '\n')
    print('链接已生成：' + os.path.join(OUTDIR, 'phone-link.txt'))
    print('（脱敏）' + link[:30] + '...' + link[-24:])

    yaml = f"""mixed-port: 7899
allow-lan: false
mode: rule
log-level: info
external-controller: 127.0.0.1:9091
proxies:
  - name: rendernode
    type: vless
    server: {HOST}
    port: 443
    uuid: {uuid}
    tls: true
    servername: {HOST}
    client-fingerprint: chrome
    udp: false          # 本中继只支持 TCP；DNS 由客户端自己用 DoH/DoT 解决
    network: ws
    ws-opts:
      path: {path}
      headers:
        Host: {HOST}
proxy-groups:
  - name: PROXY
    type: select
    proxies: [rendernode, DIRECT]
rules:
  - MATCH,PROXY
"""
    yaml_path = os.path.join(OUTDIR, 'mihomo-render.yaml')
    with open(yaml_path, 'w') as f:
        f.write(yaml)
    os.chmod(yaml_path, 0o600)
    print('mihomo 配置已生成：' + yaml_path)

    if '--no-clip' not in sys.argv:
        try:
            subprocess.run(['termux-clipboard-set'], input=link.encode(), check=True)
            print('vless 链接已写入手机剪贴板（可直接在 v2rayNG 里「从剪贴板导入」）')
        except Exception as e:
            print('写剪贴板失败：' + str(e))


if __name__ == '__main__':
    main()
