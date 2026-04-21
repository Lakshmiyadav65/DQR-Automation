(() => {
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  const dryRunEl = document.getElementById('dryRun');
  const skipSaveEl = document.getElementById('skipSave');
  const onlyEl = document.getElementById('onlyCard');

  function setStatus(kind, message) {
    statusEl.className = 'status ' + kind;
    statusEl.textContent = message;
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function hostLooksRight(url) {
    return /nextechltd\.in/i.test(url || '');
  }

  startBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      setStatus('error', 'No active tab.');
      return;
    }
    if (!hostLooksRight(tab.url)) {
      setStatus('error', 'Open the EnviGuide app in the current tab first.');
      return;
    }

    const options = {
      dryRun: dryRunEl.checked,
      skipSave: skipSaveEl.checked,
      only: (onlyEl.value || '').trim() || null,
    };

    setStatus('running', 'Starting…');
    startBtn.disabled = true;
    stopBtn.disabled = false;

    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'start', options });
      if (res && res.ok) {
        setStatus('running', 'Running. Watch the overlay on the page.');
      } else {
        setStatus('error', (res && res.error) || 'Unknown response');
        startBtn.disabled = false;
        stopBtn.disabled = true;
      }
    } catch (e) {
      setStatus(
        'error',
        'Could not reach the page. Reload the DQR page (Ctrl+R) so the extension loads, then try again.',
      );
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  stopBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'stop' });
      setStatus('idle', 'Stop requested.');
    } catch {
      setStatus('idle', 'Could not reach the content script.');
    }
    startBtn.disabled = false;
    stopBtn.disabled = true;
  });

  // On popup open, check if a run is already in progress and sync buttons.
  (async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id || !hostLooksRight(tab.url)) {
      setStatus('idle', 'Open the EnviGuide app first.');
      return;
    }
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
      if (res && res.running) {
        setStatus('running', 'A run is already in progress.');
        startBtn.disabled = true;
        stopBtn.disabled = false;
      }
    } catch {
      // Content script not loaded yet — page probably needs a reload.
      setStatus('idle', 'Ready. (Tip: if START fails, reload the page once.)');
    }
  })();
})();
