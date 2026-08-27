const maxDays = 30;

// Client-side-only list of user-added URLs to track, stored in this browser's
// localStorage. Nothing here is persisted to urls.cfg or the git repo, and no
// credentials are collected or stored - this is purely a personal, local
// convenience list scoped to the current browser/device.
const CUSTOM_URLS_KEY = "statuspage_custom_urls";

function getCustomUrls() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_URLS_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function saveCustomUrls(list) {
  localStorage.setItem(CUSTOM_URLS_KEY, JSON.stringify(list));
}

function addCustomUrl(key, url) {
  const list = getCustomUrls();
  if (!key || !url || list.some((entry) => entry.key === key)) {
    return false;
  }
  list.push({ key, url });
  saveCustomUrls(list);
  return true;
}

function removeCustomUrl(key) {
  saveCustomUrls(getCustomUrls().filter((entry) => entry.key !== key));
}

async function genReportLog(container, key, url, isCustom) {
  const response = await fetch("logs/" + key + "_report.log");
  let statusLines = "";
  if (response.ok) {
    statusLines = await response.text();
  }

  const normalized = normalizeData(statusLines);
  const statusStream = constructStatusStream(key, url, normalized, isCustom);
  container.appendChild(statusStream);
}

function constructStatusStream(key, url, uptimeData, isCustom) {
  let streamContainer = templatize("statusStreamContainerTemplate");
  for (var ii = maxDays - 1; ii >= 0; ii--) {
    let line = constructStatusLine(key, ii, uptimeData[ii]);
    streamContainer.appendChild(line);
  }

  const lastSet = uptimeData[0];
  const color = getColor(lastSet);

  const container = templatize("statusContainerTemplate", {
    title: key,
    url: url,
    color: color,
    status: getStatusText(color),
    upTime: uptimeData.upTime,
  });

  const checkNowButton = container.querySelector(".checkNowButton");
  const todaySquare = streamContainer.lastElementChild;
  checkNowButton.addEventListener("click", () =>
    checkNow(checkNowButton, url, isCustom, todaySquare)
  );

  if (isCustom) {
    const statusHeader = container.querySelector(".statusHeader");
    const removeButton = create("button", "removeUrlButton");
    removeButton.type = "button";
    removeButton.innerText = "Remove";
    removeButton.addEventListener("click", () => {
      removeCustomUrl(key);
      renderAllReports();
    });
    statusHeader.appendChild(removeButton);
  }

  container.appendChild(streamContainer);
  return container;
}

// Performs a live, browser-side reachability check against `url` and updates
// the button label, status headline, and today's status square with the
// result. This is a manual, ad-hoc check only: it is not persisted to logs/
// and does not affect the historical squares for tracked (non-custom)
// services - those revert back after a few seconds since the log-derived
// data remains the source of truth for them. For custom (browser-only)
// entries there is no log data at all, so the check result is kept as the
// displayed status until the next check or page reload. Because most
// third-party sites block cross-origin reads, the request is made in
// "no-cors" mode, so we can only detect whether the request settled
// (reachable) or threw/timed out (unreachable) - not the exact HTTP status.
async function checkNow(button, url, isCustom, todaySquare) {
  const container = button.closest(".statusContainer");
  const headline = container.querySelector(".statusHeadline");
  const originalLabel = button.innerText;
  const originalHeadlineText = headline.innerText;
  const originalHeadlineColor = ["success", "failure", "nodata", "partial"].find(
    (c) => headline.classList.contains(c)
  );
  const originalSquareColor = todaySquare
    ? ["success", "failure", "nodata", "partial"].find((c) =>
        todaySquare.classList.contains(c)
      )
    : null;

  button.disabled = true;
  button.innerText = "Checking...";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  const setHeadline = (color, text) => {
    headline.classList.remove("success", "failure", "nodata", "partial");
    headline.classList.add(color);
    headline.innerText = text;
  };

  const setSquare = (color) => {
    if (!todaySquare) {
      return;
    }
    todaySquare.classList.remove("success", "failure", "nodata", "partial");
    todaySquare.classList.add(color);
  };

  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal });
    button.innerText = "✓ Reachable";
    setHeadline("success", "Reachable (just now)");
    setSquare("success");
  } catch (e) {
    button.innerText = "✗ Unreachable";
    setHeadline("failure", "Unreachable (just now)");
    setSquare("failure");
  } finally {
    clearTimeout(timeout);
    button.disabled = false;
    if (!isCustom) {
      setTimeout(() => {
        button.innerText = originalLabel;
        setHeadline(originalHeadlineColor, originalHeadlineText);
        setSquare(originalSquareColor);
      }, 5000);
    } else {
      setTimeout(() => {
        button.innerText = originalLabel;
      }, 5000);
    }
  }
}

function constructStatusLine(key, relDay, upTimeArray) {
  let date = new Date();
  date.setDate(date.getDate() - relDay);

  return constructStatusSquare(key, date, upTimeArray);
}

function getColor(uptimeVal) {
  return uptimeVal == null
    ? "nodata"
    : uptimeVal == 1
    ? "success"
    : uptimeVal < 0.3
    ? "failure"
    : "partial";
}

function constructStatusSquare(key, date, uptimeVal) {
  const color = getColor(uptimeVal);
  let square = templatize("statusSquareTemplate", {
    color: color,
    tooltip: getTooltip(key, date, color),
  });

  const show = () => {
    showTooltip(square, key, date, color);
  };
  square.addEventListener("mouseover", show);
  square.addEventListener("mousedown", show);
  square.addEventListener("mouseout", hideTooltip);
  return square;
}

let cloneId = 0;
function templatize(templateId, parameters) {
  let clone = document.getElementById(templateId).cloneNode(true);
  clone.id = "template_clone_" + cloneId++;
  if (!parameters) {
    return clone;
  }

  applyTemplateSubstitutions(clone, parameters);
  return clone;
}

function applyTemplateSubstitutions(node, parameters) {
  const attributes = node.getAttributeNames();
  for (var ii = 0; ii < attributes.length; ii++) {
    const attr = attributes[ii];
    const attrVal = node.getAttribute(attr);
    node.setAttribute(attr, templatizeString(attrVal, parameters));
  }

  if (node.childElementCount == 0) {
    node.innerText = templatizeString(node.innerText, parameters);
  } else {
    const children = Array.from(node.children);
    children.forEach((n) => {
      applyTemplateSubstitutions(n, parameters);
    });
  }
}

function templatizeString(text, parameters) {
  if (parameters) {
    for (const [key, val] of Object.entries(parameters)) {
      text = text.replaceAll("$" + key, val);
    }
  }
  return text;
}

function getStatusText(color) {
  return color == "nodata"
    ? "No Data Available"
    : color == "success"
    ? "Fully Operational"
    : color == "failure"
    ? "Major Outage"
    : color == "partial"
    ? "Partial Outage"
    : "Unknown";
}

function getStatusDescriptiveText(color) {
  return color == "nodata"
    ? "No Data Available: Health check was not performed."
    : color == "success"
    ? "No downtime recorded on this day."
    : color == "failure"
    ? "Major outages recorded on this day."
    : color == "partial"
    ? "Partial outages recorded on this day."
    : "Unknown";
}

function getTooltip(key, date, quartile, color) {
  let statusText = getStatusText(color);
  return `${key} | ${date.toDateString()} : ${quartile} : ${statusText}`;
}

function create(tag, className) {
  let element = document.createElement(tag);
  element.className = className;
  return element;
}

function normalizeData(statusLines) {
  const rows = statusLines.split("\n");
  const dateNormalized = splitRowsByDate(rows);

  let relativeDateMap = {};
  const now = Date.now();
  for (const [key, val] of Object.entries(dateNormalized)) {
    if (key == "upTime") {
      continue;
    }

    const relDays = getRelativeDays(now, new Date(key).getTime());
    relativeDateMap[relDays] = getDayAverage(val);
  }

  relativeDateMap.upTime = dateNormalized.upTime;
  return relativeDateMap;
}

function getDayAverage(val) {
  if (!val || val.length == 0) {
    return null;
  } else {
    return val.reduce((a, v) => a + v) / val.length;
  }
}

function getRelativeDays(date1, date2) {
  return Math.floor(Math.abs((date1 - date2) / (24 * 3600 * 1000)));
}

function splitRowsByDate(rows) {
  let dateValues = {};
  let sum = 0,
    count = 0;
  for (var ii = 0; ii < rows.length; ii++) {
    const row = rows[ii];
    if (!row) {
      continue;
    }

    const [dateTimeStr, resultStr] = row.split(",", 2);
    const dateTime = new Date(Date.parse(dateTimeStr.replace(/-/g, "/") + " GMT"));
    const dateStr = dateTime.toDateString();

    let resultArray = dateValues[dateStr];
    if (!resultArray) {
      resultArray = [];
      dateValues[dateStr] = resultArray;
      if (dateValues.length > maxDays) {
        break;
      }
    }

    let result = 0;
    if (resultStr.trim() == "success") {
      result = 1;
    }
    sum += result;
    count++;

    resultArray.push(result);
  }

  const upTime = count ? ((sum / count) * 100).toFixed(2) + "%" : "--%";
  dateValues.upTime = upTime;
  return dateValues;
}

let tooltipTimeout = null;
function showTooltip(element, key, date, color) {
  clearTimeout(tooltipTimeout);
  const toolTipDiv = document.getElementById("tooltip");

  document.getElementById("tooltipDateTime").innerText = date.toDateString();
  document.getElementById("tooltipDescription").innerText =
    getStatusDescriptiveText(color);

  const statusDiv = document.getElementById("tooltipStatus");
  statusDiv.innerText = getStatusText(color);
  statusDiv.className = color;

  toolTipDiv.style.top = element.offsetTop + element.offsetHeight + 10;
  toolTipDiv.style.left =
    element.offsetLeft + element.offsetWidth / 2 - toolTipDiv.offsetWidth / 2;
  toolTipDiv.style.opacity = "1";
}

function hideTooltip() {
  tooltipTimeout = setTimeout(() => {
    const toolTipDiv = document.getElementById("tooltip");
    toolTipDiv.style.opacity = "0";
  }, 1000);
}

async function genAllReports() {
  const response = await fetch("urls.cfg");
  const configText = await response.text();
  const configLines = configText.split("\n");
  const reportsContainer = document.getElementById("reports");

  // Render custom (browser-added) URLs first, newest on top, so they appear
  // above the statically configured services from urls.cfg.
  const customUrls = getCustomUrls();
  for (let ii = customUrls.length - 1; ii >= 0; ii--) {
    const { key, url } = customUrls[ii];
    await genReportLog(reportsContainer, key, url, true);
  }

  for (let ii = 0; ii < configLines.length; ii++) {
    const configLine = configLines[ii];
    const [key, url] = configLine.split("=");
    if (!key || !url) {
      continue;
    }

    await genReportLog(reportsContainer, key.trim(), url.trim(), false);
  }
}

function renderAllReports() {
  document.getElementById("reports").innerHTML = "";
  genAllReports();
}

function initAddUrlForm() {
  const addButton = document.getElementById("addUrlButton");
  if (!addButton) {
    return;
  }

  addButton.addEventListener("click", () => {
    const keyInput = document.getElementById("newUrlKey");
    const urlInput = document.getElementById("newUrlValue");
    const key = keyInput.value.trim();
    const url = urlInput.value.trim();
    const errorEl = document.getElementById("addUrlError");
    errorEl.innerText = "";

    if (!key || !url) {
      errorEl.innerText = "Please provide both a name and a URL.";
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      errorEl.innerText = "URL must start with http:// or https://.";
      return;
    }
    if (!addCustomUrl(key, url)) {
      errorEl.innerText = "That name is already in use. Choose another.";
      return;
    }

    keyInput.value = "";
    urlInput.value = "";
    renderAllReports();
  });
}
