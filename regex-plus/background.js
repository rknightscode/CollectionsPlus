'use strict';

// Open side panel when toolbar button is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Set up context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'regex-plus-analyze',
    title: 'RegexPlus: Analyse "%s"',
    contexts: ['selection']
  });
});

// Handle context menu click — send selected text to the side panel
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'regex-plus-analyze' || !info.selectionText) return;

  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.warn('Could not open side panel:', e);
  }

  // Give the panel a moment to boot before sending the message
  const text = info.selectionText.trim();
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'ANALYZE_REGEX', text }).catch(() => {});
  }, 600);
});

// Relay messages from content scripts to the side panel
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'OPEN_WITH_SELECTION') {
    chrome.sidePanel.open({ tabId: sender.tab.id }).then(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'ANALYZE_REGEX', text: msg.text }).catch(() => {});
      }, 600);
    }).catch(() => {});
  }
});
