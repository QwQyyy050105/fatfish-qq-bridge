// Account identity is independent from ownerQQ and must match on each transport.
export function expectedBotQQ(cfg) {
  const value = cfg?.snowluma?.expectedQQ ?? cfg?.expectedQQ ?? '';
  if (value === '' || value === null || value === undefined) return '';
  const qq = String(value).trim();
  if (!/^[1-9]\d{4,15}$/.test(qq)) throw new Error('snowluma.expectedQQ 必须是有效的机器人 QQ 号');
  return qq;
}

export function assertBotIdentity(expected, actual) {
  if (!expected || String(actual ?? '') === expected) return;
  const error = new Error(`机器人账号不匹配：要求 ${expected}，实际 ${String(actual ?? '') || '未知'}；已拒绝操作`);
  error.statusCode = 503;
  throw error;
}

export function createAccountGuard(getConfig, rawFetch = globalThis.fetch) {
  const check = (actual) => assertBotIdentity(expectedBotQQ(getConfig()), actual);
  const acceptEvent = (event) => {
    try { check(event?.self_id); return true; } catch { return false; }
  };
  const guardedFetch = async (input, init) => {
    const cfg = getConfig();
    const expected = expectedBotQQ(cfg);
    const base = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    const target = String(input);
    if (expected && (target === base || target.startsWith(`${base}/`))) {
      const response = await rawFetch(`${base}/get_login_info`, {
        method: 'POST', headers: { ...init?.headers, 'content-type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(4000),
      });
      const body = await response.json();
      if (!response.ok || body.status !== 'ok' || body.retcode !== 0) throw new Error('机器人账号验证失败，已拒绝 OneBot 请求');
      check(body.data?.user_id);
    }
    return rawFetch(input, init);
  };
  const wrapClient = (bot) => {
    const rawRequest = bot.request.bind(bot);
    bot.request = async (action, ...args) => {
      if (expectedBotQQ(getConfig()) && !['get_login_info', 'get_status'].includes(action)) {
        const response = await rawRequest('get_login_info', {});
        if (response?.status !== 'ok' || response?.retcode !== 0) throw new Error('WebSocket 账号验证失败，已拒绝操作');
        check(response.data?.user_id);
      }
      return rawRequest(action, ...args);
    };
    return bot;
  };
  return { check, acceptEvent, fetch: guardedFetch, wrapClient };
}
