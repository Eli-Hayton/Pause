chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'PAUSE_CLOSE_TAB' && sender.tab?.id != null) {
    chrome.tabs.remove(sender.tab.id);
  }
});
