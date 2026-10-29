// edge-realtime/index.js — 边缘实时 hub Worker(独立承载 Durable Object, 参考 kentpan/Edgechat)
//
// 平台限制: DO 类必须由 Worker 定义并导出, Cloudflare Pages 自身无法承载 DO 类。
// 本 Worker 即配套载体, 由 .github/workflows/pages-deploy.yml 自动部署(wrangler
// deploy + migrations new_sqlite_classes)并向站点注入 REALTIME_DO 绑定。
//
// 两条调用路径:
//   ① 浏览器直连:  wss://<本worker域名>/ws?room=<房间>&auth=<JWT_SECRET>
//   ② 站点服务端:  env.REALTIME_DO 绑定(script_name) → stub.fetch(...) 广播/查询
//
// 鉴权: auth 参数必须与服务端 XY_JWT_SECRET(CI 由 JWT_SECRET 注入)一致, 否则 401。
// 免费计划要点: DO 使用 SQLite 存储(migrations new_sqlite_classes); Hibernation
// API 挂起空闲连接不计 duration; ping/pong 走 setWebSocketAutoResponsePair 不唤醒。

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const ok = (data) => new Response(JSON.stringify({ success: true, msg: 'ok', data }), { headers: JSON_HEADERS });
const fail = (msg, status = 400) => new Response(JSON.stringify({ success: false, msg, data: null }), { status, headers: JSON_HEADERS });

// 恒等时间比较, 防时序侧信道
function safeEqual(a, b) {
  const ab = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  const n = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function checkAuth(url, env) {
  const secret = env.XY_JWT_SECRET;
  if (!secret) return { valid: false, reason: 'Worker 未配置 XY_JWT_SECRET(由 CI 从 JWT_SECRET 注入, 请检查部署流程)' };
  const auth = url.searchParams.get('auth') ?? '';
  if (!auth) return { valid: false, reason: '缺少 auth 参数' };
  if (!safeEqual(auth, secret)) return { valid: false, reason: 'auth 与服务端密钥不一致' };
  return { valid: true };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return ok({ service: 'edge-realtime', room: url.searchParams.get('room') || 'default' });
    }
    if (!['/ws', '/broadcast', '/status'].includes(url.pathname)) {
      return fail('not found', 404);
    }
    const a = checkAuth(url, env);
    if (!a.valid) return fail(a.reason, 401);

    const room = url.searchParams.get('room') || 'default';
    const id = env.REALTIME_HUB.idFromName(room);
    const stub = env.REALTIME_HUB.get(id);
    const forward = new URL(url);
    if (url.pathname === '/ws') forward.pathname = '/connect';
    return stub.fetch(forward.toString(), request);
  },
};

export class EdgeRealtimeDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    state.setWebSocketAutoResponsePair(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/connect') return this.connect(request, url);
    if (url.pathname === '/broadcast') return this.broadcast(request);
    if (url.pathname === '/status') {
      return ok({ online: this.state.getWebSockets().length });
    }
    return fail('not found', 404);
  }

  connect(request, url) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return fail('expected websocket upgrade', 426);
    }
    const room = url.searchParams.get('room') || 'default';
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [room]);

    const online = this.state.getWebSockets().length;
    pair[1].send(JSON.stringify({ type: 'welcome', room, online, ts: Date.now() }));
    this._broadcastExcept(pair[1], { type: 'join', room, online, ts: Date.now() });

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async broadcast(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('body 必须是 JSON: {"message": ...}');
    }
    const online = this.state.getWebSockets().length;
    this._broadcastExcept(null, { type: 'broadcast', message: body?.message ?? body, ts: Date.now(), online });
    return ok({ delivered: online });
  }

  // 客户端消息: JSON 按 type 透传广播给房间内其他连接(Edgechat 式); 纯文本按 chat 处理
  async webSocketMessage(ws, message) {
    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      payload = { type: 'chat', text: String(message) };
    }
    if (payload.type === 'ping') {
      ws.send('pong');
      return;
    }
    if (payload.type === 'pong') return;
    const online = this.state.getWebSockets().length;
    this._broadcastExcept(ws, { ...payload, ts: Date.now(), online });
  }

  async webSocketClose() {
    this._broadcastExcept(null, { type: 'leave', online: this.state.getWebSockets().length, ts: Date.now() });
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'internal error'); } catch { /* already closed */ }
  }

  _broadcastExcept(exceptWs, obj) {
    const data = JSON.stringify(obj);
    for (const s of this.state.getWebSockets()) {
      if (s === exceptWs) continue;
      try { s.send(data); } catch { /* ignore */ }
    }
  }
}
