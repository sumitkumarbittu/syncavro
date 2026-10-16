async function toggleActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "SYNCAVRO_TOGGLE_DRAWER" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-drawer.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "SYNCAVRO_TOGGLE_DRAWER" });
  }
}

chrome.action.onClicked.addListener(toggleActiveTab);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-side-panel") return;
  await toggleActiveTab();
});
