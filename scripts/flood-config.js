(() => {
  const host = typeof location !== 'undefined' ? location.hostname : '';
  const isLocal = !host || ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(host) ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host);
  const defaultApi = isLocal ? `http://${host && host !== '[::1]' && host !== '0.0.0.0' ? host : '127.0.0.1'}:8100` : 'https://detective-seats-elimination-shaped.trycloudflare.com';

  globalThis.CctvFloodConfig = {
    apiBaseUrl: defaultApi,
    pollMs: 15000,
    freshAgeSeconds: 180
  };
})();
