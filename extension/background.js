// Background worker: takes the screenshot for a sighting photo. Only the tab
// that asked, only when a bird is clicked; the image goes straight back to
// that tab, which blurs and crops it and throws the full screenshot away.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'perch:capture' || !sender.tab) return false;
  chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 80 })
    .then((dataUrl) => reply({ dataUrl }))
    .catch((e) => reply({ error: String(e?.message ?? e) }));
  return true; // reply asynchronously
});
