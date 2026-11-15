function refreshState() {
  chrome.runtime.sendMessage({ type: 'POPUP_GET_STATE' }, (res) => {
    const pill = document.getElementById('status-pill');
    const sessionCard = document.getElementById('session-card');
    const jobCard = document.getElementById('job-card');
    if (!res) return;

    if (res.session?.authenticated) {
      pill.textContent = 'Connected';
      pill.className = 'pill ok';
      sessionCard.textContent = res.session.ownerUsername
        ? `Signed in to Instagram as @${res.session.ownerUsername}`
        : `Signed in to Instagram (User ID ${res.session.ownerUserId})`;
    } else {
      pill.textContent = 'Sign In Needed';
      pill.className = 'pill warn';
      sessionCard.textContent =
        res.session?.error || 'Open instagram.com and sign in first.';
    }

    const job = res.activeJobState;
    jobCard.textContent = job?.running
      ? `Running (${job.phase}): ${job.message}`
      : `Job status: ${job?.message || 'Idle'}`;
  });
}

document.getElementById('open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://a-vip.github.io/ig-relationship-auditor/' });
});

document.getElementById('abort-job').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'POPUP_ABORT' }, () => refreshState());
});

refreshState();
