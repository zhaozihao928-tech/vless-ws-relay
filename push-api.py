#!/usr/bin/env python3
# push-api.py —— 当 github.com:443 被墙（直连状态）时，改用 GitHub REST API 提交文件。
# 用法：python3 push-api.py <repo> <branch> "<提交信息>" <文件1> [文件2 ...]
# 依赖：gh CLI 已登录（用 gh auth token 取令牌）
import base64, json, os, subprocess, sys, urllib.request

def token():
    return subprocess.check_output(['gh', 'auth', 'token'], text=True).strip()

def api(url, tok, method='GET', data=None):
    req = urllib.request.Request(url, method=method)
    req.add_header('Authorization', 'Bearer ' + tok)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('User-Agent', 'push-api')
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, body, timeout=60) as r:
            return json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        if e.code == 404:
            return None
        raise SystemExit(f'HTTP {e.code}: {msg[:400]}')

def main():
    repo, branch, message = sys.argv[1], sys.argv[2], sys.argv[3]
    files = sys.argv[4:]
    tok = token()
    base = f'https://api.github.com/repos/{repo}/contents'
    for f in files:
        path = os.path.basename(f)
        with open(f, 'rb') as fh:
            content = base64.b64encode(fh.read()).decode()
        cur = api(f'{base}/{path}?ref={branch}', tok)
        payload = {'message': message, 'content': content, 'branch': branch}
        if cur and 'sha' in cur:
            payload['sha'] = cur['sha']
        res = api(f'{base}/{path}', tok, 'PUT', payload)
        sha = (res.get('commit') or {}).get('sha', '?')[:8]
        print(f'{path}: committed {sha} ({len(content)} b64 chars)')

if __name__ == '__main__':
    main()
