// Listen for clicks on the extension button
chrome.action.onClicked.addListener((tab) => {
  // Get the current tab's URL
  const currentUrl = tab.url;
  
  // Check if the URL is valid (not a chrome:// or edge:// page)
  if (currentUrl.startsWith('http://') || currentUrl.startsWith('https://')) {
    // Remove the protocol from the URL
    const urlWithoutProtocol = currentUrl.replace(/^https?:\/\//, '');
    
    // Create the archive.is URL
    const archiveUrl = `https://archive.is/${urlWithoutProtocol}`;
    
    // Navigate to the archive.is URL in the current tab
    chrome.tabs.update(tab.id, { url: archiveUrl });
  } else {
    // If it's not a valid web page, show an error
    console.log('Cannot archive this type of page');
  }
});
