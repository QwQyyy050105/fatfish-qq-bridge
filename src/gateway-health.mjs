// Safe status projection for the optional DSH MCP tool. Provider bodies and
// exception messages are never part of the model-visible failure payload.
export async function queryGatewayHealth({ httpUrl, token = '' }, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${String(httpUrl).replace(/\/+$/, '')}/get_login_info`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000), redirect: 'error'
    });
  } catch { return { reachable: false, error: 'gateway_connection_failed' }; }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { reachable: false, httpStatus: response.status,
      ...(response.status === 426 ? { hint: 'HTTP 426：请核对 OneBot HTTP 端点，不能使用 WebSocket 端口。' } : {}) };
  }
  let body;
  try {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 65536) return { reachable: true, online: false, error: 'gateway_response_limit' };
      chunks.push(Buffer.from(chunk));
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return { reachable: true, online: false, error: 'gateway_invalid_json' }; }
  if (body?.status === 'ok' && body.retcode === 0) {
    return { reachable: true, online: true, user_id: body.data?.user_id, nickname: body.data?.nickname };
  }
  return { reachable: true, online: false,
    retcode: Number.isSafeInteger(body?.retcode) ? body.retcode : null,
    wording: 'gateway_api_failed' };
}
