const siteEl = document.getElementById("site");
const powerButton = document.getElementById("power");
const stateEl = document.getElementById("state");
const messageEl = document.getElementById("message");

let currentTabId = null;
let enabled = false;

function render(isEnabled) {
  enabled = isEnabled;

  powerButton.textContent = enabled ? "ON" : "OFF";
  powerButton.setAttribute("aria-pressed", String(enabled));

  stateEl.textContent = enabled ? "Activated" : "Inactive";
  stateEl.classList.toggle("on", enabled);
}

function showMessage(text) {
  messageEl.textContent = text ?? "";
  messageEl.hidden = !text;
}

async function request(message) {
  const result = await chrome.runtime.sendMessage(message);

  if (!result?.ok) {
    throw new Error(result?.error ?? "Extension request failed.");
  }

  return result;
}

async function initialize() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error("No active tab.");
  }

  currentTabId = tab.id;

  try {
    siteEl.textContent =
      (tab.url && new URL(tab.url).hostname) || "Current tab";
  } catch {
    siteEl.textContent = "Current tab";
  }

  const status = await request({
    type: "get-status",
    tabId: currentTabId
  });

  render(Boolean(status.enabled));
  powerButton.disabled = false;
}

powerButton.addEventListener("click", async () => {
  if (currentTabId === null) {
    return;
  }

  powerButton.disabled = true;
  showMessage(null);

  try {
    const result = await request({
      type: "set-enabled",
      tabId: currentTabId,
      enabled: !enabled
    });

    render(Boolean(result.enabled));
  } catch (error) {
    showMessage(error?.message ?? String(error));
  } finally {
    powerButton.disabled = false;
  }
});

initialize().catch((error) => {
  powerButton.disabled = true;
  showMessage(error?.message ?? String(error));
});
