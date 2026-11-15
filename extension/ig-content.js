// Content script running inside https://www.instagram.com/* for DOM fallback verification & safe button clicks.
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findProfileFollowButtons() {
    const buttons = Array.from(document.querySelectorAll('header button, main button'));
    return buttons.filter((b) => {
      const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
      return (
        txt === 'following' ||
        txt === 'requested' ||
        txt === 'follow' ||
        txt === 'follow back'
      );
    });
  }

  async function inspectDomProfile(expectedUsername) {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    if (
      bodyText.includes("sorry, this page isn't available") ||
      bodyText.includes('the link you followed may be broken')
    ) {
      return {
        accountExists: false,
        youFollow: false,
        followsYou: false,
        resolvedUsername: expectedUsername,
      };
    }

    const buttons = findProfileFollowButtons();
    const texts = buttons.map((b) => (b.innerText || '').trim().toLowerCase());
    const youFollow = texts.includes('following') || texts.includes('requested');
    const followsYouHint = texts.includes('follow back');

    return {
      accountExists: true,
      youFollow,
      followsYou: followsYouHint ? true : undefined,
      resolvedUsername: expectedUsername,
    };
  }

  async function unfollowViaDom() {
    const buttons = findProfileFollowButtons();
    const targetBtn = buttons.find((b) => {
      const t = (b.innerText || '').trim().toLowerCase();
      return t === 'following' || t === 'requested';
    });

    if (!targetBtn) {
      const alreadyUnfollowed = buttons.some((b) => {
        const t = (b.innerText || '').trim().toLowerCase();
        return t === 'follow' || t === 'follow back';
      });
      return {
        ok: alreadyUnfollowed,
        verifiedFollowing: false,
        error: alreadyUnfollowed ? undefined : 'Could not locate Following button in profile DOM',
      };
    }

    targetBtn.click();
    await sleep(900);

    // Locate confirmation modal "Unfollow" button
    const dialogButtons = Array.from(
      document.querySelectorAll('div[role="dialog"] button, button'),
    );
    const confirmBtn = dialogButtons.find((b) => {
      const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
      return txt === 'unfollow';
    });

    if (!confirmBtn) {
      return { ok: false, error: 'Could not locate Unfollow confirmation button in dialog' };
    }

    confirmBtn.click();
    await sleep(1400);

    const postButtons = findProfileFollowButtons().map((b) =>
      (b.innerText || '').trim().toLowerCase(),
    );
    const stillFollowing = postButtons.includes('following');
    return {
      ok: !stillFollowing,
      verifiedFollowing: stillFollowing,
      error: stillFollowing ? 'Button still displays Following after click' : undefined,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'IG_DOM_CHECK_PROFILE') {
      inspectDomProfile(msg.username).then(sendResponse);
      return true;
    }
    if (msg?.type === 'IG_DOM_UNFOLLOW') {
      unfollowViaDom().then(sendResponse);
      return true;
    }
    return false;
  });
})();
