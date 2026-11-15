// Content script injected into GitHub Pages & localhost auditor tabs.
// Bridges window.postMessage requests <-> chrome.runtime.sendMessage cleanly.
(function () {
  const REQ_CHANNEL = 'IG_AUDITOR_EXT_REQ';
  const RES_CHANNEL = 'IG_AUDITOR_EXT_RES';
  const EVT_CHANNEL = 'IG_AUDITOR_EXT_EVT';

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || typeof event.data !== 'object') return;
    if (event.data.channel !== REQ_CHANNEL) return;

    const { requestId, action, payload } = event.data;
    chrome.runtime.sendMessage({ type: 'AUDITOR_COMMAND', action, payload }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        window.postMessage(
          {
            channel: RES_CHANNEL,
            requestId,
            ok: false,
            error: lastError.message,
          },
          window.location.origin,
        );
        return;
      }

      window.postMessage(
        {
          channel: RES_CHANNEL,
          requestId,
          ok: Boolean(response?.ok),
          payload: response?.payload,
          error: response?.error,
        },
        window.location.origin,
      );
    });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'AUDITOR_PROGRESS') {
      window.postMessage(
        {
          channel: EVT_CHANNEL,
          payload: msg.payload,
        },
        window.location.origin,
      );
    }
  });
})();
