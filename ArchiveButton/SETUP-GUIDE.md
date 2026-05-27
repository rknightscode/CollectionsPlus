# Archive.is Button Extension - Setup Guide

## Overview
This extension adds a button to your Edge browser toolbar that instantly archives the current page using archive.is. Simply click the button and the page will be redirected to `https://archive.is/[current-url]`.

## Files Included
- `manifest.json` - Extension configuration file
- `background.js` - Script that handles the archive button click
- `generate-icons.html` - Tool to create the required icon files
- `SETUP-GUIDE.md` - This setup guide

## Installation Steps

### Step 1: Create the Extension Folder
1. Create a new folder anywhere on your computer (e.g., `C:\Users\YourName\Documents\ArchiveButton`)
2. Copy all the extension files into this folder:
   - `manifest.json`
   - `background.js`
   - `generate-icons.html`

### Step 2: Generate the Icon Files
1. Open `generate-icons.html` in your Edge browser (double-click the file)
2. Click the "Download All Icons" button (or download each icon individually)
3. Save all 4 icon files to the same folder as your other extension files:
   - `icon16.png`
   - `icon32.png`
   - `icon48.png`
   - `icon128.png`

Your folder should now contain:
```
ArchiveButton/
├── manifest.json
├── background.js
├── generate-icons.html
├── icon16.png
├── icon32.png
├── icon48.png
└── icon128.png
```

### Step 3: Load the Extension in Edge
1. Open Microsoft Edge
2. Navigate to `edge://extensions/` (type this in the address bar)
3. Enable "Developer mode" using the toggle in the bottom-left corner
4. Click "Load unpacked" button
5. Browse to your extension folder and select it
6. Click "Select Folder"

### Step 4: Verify Installation
You should now see:
- "Archive.is Button" appears in your extensions list
- A green circular icon with lines appears in your toolbar (you may need to click the extensions puzzle icon and pin it)
- The extension status shows as "On"

## How to Use

### Basic Usage
1. Navigate to any webpage you want to archive
2. Click the Archive.is Button icon in your toolbar
3. The page will automatically redirect to `https://archive.is/[current-page-url]`
4. Archive.is will either show you an existing archive or create a new one

### Tips
- The extension works on any `http://` or `https://` page
- It won't work on Edge's internal pages (like `edge://extensions`)
- If archive.is hasn't archived the page before, it may take a few seconds to create a new archive
- You can save archived pages for future reference

## Troubleshooting

### Extension doesn't appear
- Make sure "Developer mode" is enabled in `edge://extensions/`
- Verify all 7 files are in the extension folder
- Try removing and re-adding the extension

### Button doesn't work
- Check that the page URL starts with `http://` or `https://`
- The extension can't archive internal browser pages (edge://, chrome://, etc.)
- Open the browser console (F12) and check for error messages

### Icons not showing
- Make sure all 4 icon PNG files are in the extension folder
- Verify the filenames exactly match: `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`
- Try reloading the extension (click the refresh button in edge://extensions)

### "Manifest file is invalid" error
- Make sure `manifest.json` hasn't been modified
- Check that the file is saved with UTF-8 encoding
- Verify there are no extra characters or line breaks

## Customization

### Change the Icon
1. Replace the `icon16.png`, `icon32.png`, `icon48.png`, and `icon128.png` files with your own PNG images
2. Make sure they are exactly the sizes indicated by the filenames
3. Reload the extension in `edge://extensions/`

### Change the Extension Name or Description
1. Open `manifest.json` in a text editor
2. Modify the `name` or `description` fields
3. Save the file
4. Reload the extension in `edge://extensions/`

### Open in New Tab Instead of Current Tab
1. Open `background.js` in a text editor
2. Replace the line:
   ```javascript
   chrome.tabs.update(tab.id, { url: archiveUrl });
   ```
   With:
   ```javascript
   chrome.tabs.create({ url: archiveUrl });
   ```
3. Save the file
4. Reload the extension in `edge://extensions/`

## Updating the Extension

If you make any changes to the extension files:
1. Go to `edge://extensions/`
2. Find "Archive.is Button"
3. Click the refresh/reload icon
4. Test the changes

## Uninstalling

To remove the extension:
1. Go to `edge://extensions/`
2. Find "Archive.is Button"
3. Click "Remove"
4. Confirm the removal
5. Optionally delete the extension folder from your computer

## Privacy & Security

This extension:
- ✅ Only activates when you click the button
- ✅ Only accesses the current tab's URL
- ✅ Doesn't collect or transmit any data
- ✅ Doesn't require any external servers
- ✅ Runs entirely locally on your computer
- ✅ Is private to you (not published to any store)

## About Archive.is

Archive.is (also known as archive.today) is a service that creates permanent snapshots of web pages. It's useful for:
- Preserving content that might change or be deleted
- Accessing pages behind paywalls (sometimes)
- Creating a permanent record of web content
- Sharing content without giving traffic to the original site

---

**Version:** 1.0  
**For:** Microsoft Edge (Chromium-based)  
**Platform:** Windows 11
