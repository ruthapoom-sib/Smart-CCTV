// Public settings only. Set an HTTPS API URL for a hosted deployment.
globalThis.CctvFloodConfig = {
  apiBaseUrl: ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8100' : '',
  pollMs: 15000,
  freshAgeSeconds: 180
};
