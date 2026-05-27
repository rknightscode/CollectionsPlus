'use strict';

// Alt+Shift+R on selected text → open RegexPlus with selection
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
    const text = window.getSelection()?.toString().trim();
    if (text) {
      chrome.runtime.sendMessage({ type: 'OPEN_WITH_SELECTION', text }).catch(() => {});
    }
  }
});
