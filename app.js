const STORAGE_KEY = "safety-observation-state-v1";
const SUPABASE_URL = "https://bwgznqgisfmhxhpqcjoi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_RbUyN4maE8lXsGsle4o6Jg_V85BK3Kh";
const SUPABASE_TABLE = "safety_observations";
const SUPABASE_GROUP_ID = "main";
const CATEGORY_COLORS = {
  "Near Miss": "#f59e0b",
  "Unsafe Act": "#dc2626",
  "Unsafe Condition": "#2563eb",
  "Good Observation": "#16a34a"
};

const defaultState = {
  setupComplete: false,
  role: "member",
  deviceId: crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}`,
  groupId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
  groupName: "Safety Observation Group",
  defaultEmail: "",
  observations: []
};

let state = loadState();
let photoDataUrl = "";
let deferredInstallPrompt = null;
let graphFilter = null;
let chartHitRegions = [];
let showExcluded = false;
let supabaseClient = null;
let remoteSyncReady = false;
let currentUser = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  setupPanel: $("#setupPanel"),
  authPanel: $("#authPanel"),
  authForm: $("#authForm"),
  authEmail: $("#authEmailInput"),
  authPassword: $("#authPasswordInput"),
  passwordToggle: $("#passwordToggleButton"),
  authDisplayName: $("#authDisplayNameInput"),
  signUp: $("#signUpButton"),
  signOut: $("#signOutButton"),
  userBadge: $("#userBadge"),
  roleBadge: $("#roleBadge"),
  form: $("#observationForm"),
  date: $("#dateInput"),
  time: $("#timeInput"),
  photo: $("#photoInput"),
  cameraPhoto: $("#cameraPhotoInput"),
  photoPreview: $("#photoPreview"),
  photoPreviewImage: $("#photoPreviewImage"),
  removePhoto: $("#removePhotoButton"),
  takePhoto: $("#takePhotoButton"),
  recipient: $("#recipientInput"),
  observerCanClose: $("#observerCloseInput"),
  observerCloseoutPanel: $("#observerCloseoutPanel"),
  reportCloseoutAction: $("#reportCloseoutActionInput"),
  reportCloseoutPhoto: $("#reportCloseoutPhotoInput"),
  reportCloseoutCamera: $("#reportCloseoutCameraInput"),
  takeReportCloseoutPhoto: $("#takeReportCloseoutPhotoButton"),
  submitObservation: $("#submitObservationButton"),
  notice: $("#appNotice"),
  period: $("#periodSelect"),
  from: $("#fromInput"),
  to: $("#toInput"),
  stats: $("#statsGrid"),
  chart: $("#categoryChart"),
  list: $("#observationList"),
  resultCount: $("#resultCount"),
  groupName: $("#groupNameInput"),
  defaultEmail: $("#defaultEmailInput"),
  qrImage: $("#qrImage"),
  qr: $("#qrCanvas"),
  toast: $("#toast"),
  install: $("#installButton")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  applyInviteFromUrl();
  setCurrentDateTime();
  setDefaultPeriod();
  clearPhoto();
  bindEvents();
  renderAll();
  registerServiceWorker();
  initSupabase();
  await initAuth();
  await loadRemoteObservations();
}

function bindEvents() {
  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $$("[data-role-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      state.role = button.dataset.roleChoice;
      state.setupComplete = true;
      saveState();
      renderAll();
      showToast(state.role === "admin" ? "Admin mode enabled." : "Observer mode enabled.");
    });
  });

  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.passwordToggle.addEventListener("click", togglePasswordVisibility);
  elements.signOut.addEventListener("click", handleSignOut);
  elements.form.addEventListener("submit", handleSubmit);
  elements.photo.addEventListener("change", handlePhotoChange);
  elements.cameraPhoto.addEventListener("change", handlePhotoChange);
  elements.removePhoto.addEventListener("click", clearPhoto);
  elements.takePhoto.addEventListener("click", () => elements.cameraPhoto.click());
  elements.takeReportCloseoutPhoto.addEventListener("click", () => elements.reportCloseoutCamera.click());
  elements.observerCanClose.addEventListener("change", updateObserverCloseoutPanel);
  elements.reportCloseoutAction.addEventListener("input", updateObserverCloseoutPanel);
  elements.period.addEventListener("change", () => {
    graphFilter = null;
    updatePeriodDates();
    renderDashboard();
  });
  elements.from.addEventListener("change", () => {
    graphFilter = null;
    renderDashboard();
  });
  elements.to.addEventListener("change", () => {
    graphFilter = null;
    renderDashboard();
  });
  elements.list.addEventListener("submit", handleCloseoutSubmit);

  $("#emailReportButton").addEventListener("click", emailReport);
  $("#printReportButton").addEventListener("click", () => window.print());
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#showExcludedButton").addEventListener("click", toggleShowExcluded);
  $("#clearGraphFilterButton").addEventListener("click", clearGraphFilter);
  elements.chart.addEventListener("click", handleChartClick);
  $("#copyInviteButton").addEventListener("click", copyInviteLink);
  $("#saveSettingsButton").addEventListener("click", saveSettings);
  $("#resetSetupButton").addEventListener("click", resetSetup);
  $("#seedButton").addEventListener("click", seedDemoData);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.install.hidden = false;
  });

  elements.install.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.install.hidden = true;
  });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const merged = { ...defaultState, ...saved };
    const observations = (saved?.observations || []).map((item) => normalizeObservation(item, merged.deviceId));
    return { ...merged, observations };
  } catch {
    return { ...defaultState };
  }
}

function normalizeObservation(item, deviceId = state?.deviceId || defaultState.deviceId) {
  return {
    observerId: deviceId,
    observerUserId: "",
    observerEmail: "",
    observerName: "",
    excludedFromDashboard: false,
    closeoutAction: "",
    closeoutPhoto: "",
    closeoutSubmittedAt: "",
    emailPreparedAt: "",
    ...item
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function initSupabase() {
  if (!window.supabase?.createClient) {
    setNotice("Online sync is not loaded. The app is using this device only.");
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

async function initAuth() {
  if (!supabaseClient) return;

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    renderAuthState();
    if (currentUser) {
      await loadRemoteObservations();
    }
  });
  renderAuthState();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const action = event.submitter?.value || "signin";
  if (action === "signup") {
    await handleSignUp();
    return;
  }
  await handleSignIn();
}

async function handleSignIn() {
  if (!supabaseClient) {
    showToast("Online login is not available.");
    return;
  }

  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    showToast(error.message);
    return;
  }
  elements.authPassword.value = "";
  showToast("Signed in.");
}

async function handleSignUp() {
  if (!supabaseClient) {
    showToast("Online login is not available.");
    return;
  }

  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  const displayName = elements.authDisplayName.value.trim();
  if (!email || password.length < 6) {
    showToast("Enter an email and a password of at least 6 characters.");
    return;
  }
  if (!displayName) {
    showToast("Enter a short name.");
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName
      }
    }
  });
  if (error) {
    showToast(error.message);
    return;
  }
  elements.authPassword.value = "";
  if (!data.session) {
    setNotice("Account created. Check your email to confirm, then sign in.");
  } else {
    showToast("Account created and signed in.");
  }
}

async function handleSignOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentUser = null;
  renderAuthState();
  showToast("Signed out.");
}

function togglePasswordVisibility() {
  const isHidden = elements.authPassword.type === "password";
  elements.authPassword.type = isHidden ? "text" : "password";
  elements.passwordToggle.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  elements.passwordToggle.title = isHidden ? "Hide password" : "Show password";
}

function renderAuthState() {
  const signedIn = Boolean(currentUser);
  elements.authPanel.hidden = signedIn;
  elements.userBadge.textContent = signedIn ? getObserverName() : "Not signed in";
  elements.signOut.hidden = !signedIn;
  elements.form.querySelectorAll("input, textarea, button").forEach((control) => {
    if (control.id === "installButton") return;
    control.disabled = !signedIn;
  });
  if (signedIn) {
    updateObserverCloseoutPanel();
  }
}

function getObserverName() {
  return currentUser?.user_metadata?.display_name || currentUser?.email?.split("@")[0] || "Observer";
}

async function loadRemoteObservations() {
  if (!supabaseClient || !currentUser) return;

  const { data, error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .select("id,payload,updated_at")
    .eq("group_id", SUPABASE_GROUP_ID)
    .order("updated_at", { ascending: false });

  if (error) {
    setNotice(`Online sync is not ready yet: ${error.message}`);
    return;
  }

  remoteSyncReady = true;
  state.observations = (data || []).map((row) => normalizeObservation(row.payload, state.deviceId));
  saveState();
  renderDashboard();
  renderNotice();
}

async function saveObservationRemote(item) {
  if (!supabaseClient || !currentUser || !remoteSyncReady) return;

  const { error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .upsert({
      id: item.id,
      group_id: SUPABASE_GROUP_ID,
      payload: item,
      updated_at: new Date().toISOString()
    });

  if (error) {
    setNotice(`Saved on this device. Online sync failed: ${error.message}`);
  }
}

function applyInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const groupId = params.get("group");
  const role = params.get("role");
  if (!groupId || state.setupComplete) return;
  state.groupId = groupId;
  state.role = role === "admin" ? "admin" : "member";
  state.setupComplete = true;
  saveState();
}

function setCurrentDateTime() {
  const now = new Date();
  elements.date.value = formatDate(now);
  elements.time.value = now.toTimeString().slice(0, 5);
}

function setDefaultPeriod() {
  updatePeriodDates();
}

function updatePeriodDates() {
  if (elements.period.value === "custom") return;
  const now = new Date();
  const start = new Date(now);
  if (elements.period.value === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  } else {
    start.setDate(1);
  }
  elements.from.value = formatDate(start);
  elements.to.value = formatDate(now);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function switchView(view) {
  $$(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.toggle("is-active", panel.id === `${view}View`));
  if (view === "dashboard") renderDashboard();
  if (view === "admin") renderAdmin();
}

async function handlePhotoChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  photoDataUrl = await resizeImage(file, 1200, 0.75);
  elements.photoPreviewImage.src = photoDataUrl;
  elements.photoPreview.hidden = false;
}

function resizeImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function clearPhoto() {
  photoDataUrl = "";
  elements.photo.value = "";
  elements.cameraPhoto.value = "";
  elements.photoPreviewImage.removeAttribute("src");
  elements.photoPreview.hidden = true;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!currentUser) {
    showToast("Sign in before submitting an observation.");
    return;
  }

  const data = new FormData(elements.form);
  const observerCloseoutAction = data.get("reportCloseoutAction")?.trim() || "";
  const observerCloseoutPhotoFile = data.get("reportCloseoutPhoto")?.size
    ? data.get("reportCloseoutPhoto")
    : data.get("reportCloseoutCameraPhoto");
  const observerCloseoutPhoto = elements.observerCanClose.checked && observerCloseoutPhotoFile?.size
    ? await resizeImage(observerCloseoutPhotoFile, 1200, 0.75)
    : "";
  const observation = {
    id: crypto.randomUUID ? crypto.randomUUID() : `obs-${Date.now()}`,
    date: data.get("date"),
    time: data.get("time"),
    category: data.get("category"),
    observation: data.get("observation").trim(),
    action: data.get("action").trim(),
    recipient: data.get("recipient").trim(),
    observerCanClose: elements.observerCanClose.checked,
    photo: photoDataUrl,
    status: observerCloseoutAction ? "Close-out Submitted" : "Action Required",
    closeoutAction: observerCloseoutAction,
    closeoutPhoto: observerCloseoutPhoto,
    closeoutSubmittedAt: observerCloseoutAction ? new Date().toISOString() : "",
    emailPreparedAt: "",
    createdByRole: state.role,
    observerId: state.deviceId,
    observerUserId: currentUser.id,
    observerEmail: currentUser.email,
    observerName: getObserverName(),
    createdAt: new Date().toISOString(),
    closedAt: ""
  };

  state.observations.unshift(observation);
  saveState();
  await saveObservationRemote(observation);
  elements.form.reset();
  setCurrentDateTime();
  elements.recipient.value = state.defaultEmail;
  elements.observerCanClose.checked = true;
  elements.reportCloseoutAction.value = "";
  elements.reportCloseoutPhoto.value = "";
  elements.reportCloseoutCamera.value = "";
  updateObserverCloseoutPanel();
  clearPhoto();
  renderDashboard();
  showToast("Observation submitted.");

  if (observation.recipient) {
    openObservationEmail(observation);
  } else {
    setNotice("Observation saved in the app. It will stay here when you close and reopen.");
  }
}

function renderAll() {
  elements.setupPanel.hidden = state.setupComplete;
  elements.roleBadge.textContent = state.role === "admin" ? "Admin" : "Observer";
  elements.recipient.value = state.defaultEmail;
  elements.groupName.value = state.groupName;
  elements.defaultEmail.value = state.defaultEmail;
  $("[data-view='admin']").hidden = state.role !== "admin";
  renderNotice();
  updateObserverCloseoutPanel();
  renderDashboard();
  renderAdmin();
}

function updateObserverCloseoutPanel() {
  const enabled = elements.observerCanClose.checked;
  const hasCloseoutAction = Boolean(elements.reportCloseoutAction.value.trim());
  elements.observerCloseoutPanel.classList.toggle("is-disabled", !enabled);
  elements.reportCloseoutAction.disabled = !enabled;
  elements.reportCloseoutPhoto.disabled = !enabled;
  elements.reportCloseoutCamera.disabled = !enabled;
  elements.takeReportCloseoutPhoto.disabled = !enabled;
  elements.submitObservation.textContent = enabled && hasCloseoutAction
    ? "Submit observation for approval"
    : "Submit observation";
  if (!enabled) {
    elements.reportCloseoutAction.value = "";
    elements.reportCloseoutPhoto.value = "";
    elements.reportCloseoutCamera.value = "";
  }
}

function renderDashboard() {
  const observations = getFilteredObservations().filter((item) => showExcluded || !item.excludedFromDashboard);
  const visibleObservations = applyGraphFilter(observations);
  renderStats(observations);
  renderChart(observations);
  renderObservationList(visibleObservations);
  renderGraphFilterState();
  $("#showExcludedButton").textContent = showExcluded ? "Hide excluded" : "Show excluded";
}

function getFilteredObservations() {
  const from = elements.from.value || "0000-01-01";
  const to = elements.to.value || "9999-12-31";
  return state.observations.filter((item) => item.date >= from && item.date <= to);
}

function renderStats(observations) {
  const counts = getCounts(observations);
  const stats = [
    ["Total", observations.length],
    ["Open / Pending", getOpenCount(counts)],
    ["Close-out Submitted", counts.status["Close-out Submitted"] || 0],
    ["Closed", counts.status.Closed || 0],
    ["Unsafe + Near Miss", (counts.category["Unsafe Act"] || 0) + (counts.category["Unsafe Condition"] || 0) + (counts.category["Near Miss"] || 0)]
  ];

  elements.stats.innerHTML = stats.map(([label, value]) => `
    <div class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function getCounts(observations) {
  return observations.reduce((acc, item) => {
    acc.category[item.category] = (acc.category[item.category] || 0) + 1;
    acc.status[item.status] = (acc.status[item.status] || 0) + 1;
    return acc;
  }, { category: {}, status: {} });
}

function renderChart(observations) {
  const ctx = elements.chart.getContext("2d");
  const width = elements.chart.width;
  const height = elements.chart.height;
  chartHitRegions = [];
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const categories = Object.keys(CATEGORY_COLORS);
  const days = getWeekDays();
  const dayCounts = days.map((day) => {
    const items = observations.filter((item) => item.date === day.date);
    return {
      ...day,
      total: items.length,
      counts: categories.reduce((acc, category) => {
        acc[category] = items.filter((item) => item.category === category).length;
        return acc;
      }, {})
    };
  });
  const max = Math.max(1, ...dayCounts.map((day) => day.total));
  const left = 54;
  const right = 24;
  const top = 52;
  const bottom = 88;
  const chartHeight = height - top - bottom;
  const chartWidth = width - left - right;
  const slotWidth = chartWidth / days.length;
  const barWidth = Math.min(54, slotWidth * 0.58);

  ctx.font = "700 18px system-ui";
  ctx.fillStyle = "#17201d";
  ctx.fillText("Days 1 to 7", 22, 28);
  ctx.strokeStyle = "#d8e1de";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, top + chartHeight);
  ctx.lineTo(left + chartWidth, top + chartHeight);
  ctx.stroke();

  dayCounts.forEach((day, dayIndex) => {
    const x = left + dayIndex * slotWidth + (slotWidth - barWidth) / 2;
    let y = top + chartHeight;

    categories.forEach((category) => {
      const value = day.counts[category] || 0;
      if (!value) return;
      const segmentHeight = Math.max(4, (value / max) * chartHeight);
      y -= segmentHeight;
      ctx.fillStyle = CATEGORY_COLORS[category];
      ctx.fillRect(x, y, barWidth, segmentHeight);
      chartHitRegions.push({ x, y, width: barWidth, height: segmentHeight, date: day.date, category });
    });

    ctx.fillStyle = "#17201d";
    ctx.font = "800 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(String(day.total), x + barWidth / 2, Math.max(18, y - 8));
    ctx.fillStyle = "#475569";
    ctx.font = "700 12px system-ui";
    ctx.fillText(`Day ${dayIndex + 1}`, x + barWidth / 2, top + chartHeight + 24);
    ctx.fillText(day.label, x + barWidth / 2, top + chartHeight + 42);
  });

  ctx.textAlign = "left";
  let legendX = 22;
  const legendY = height - 22;
  categories.forEach((category) => {
    ctx.fillStyle = CATEGORY_COLORS[category];
    ctx.fillRect(legendX, legendY - 12, 12, 12);
    ctx.fillStyle = "#34423e";
    ctx.font = "700 12px system-ui";
    ctx.fillText(category, legendX + 18, legendY - 2);
    legendX += ctx.measureText(category).width + 46;
  });
}

function getWeekDays() {
  const start = elements.from.value ? parseLocalDate(elements.from.value) : new Date();
  if (elements.period.value !== "week") {
    const today = new Date();
    const day = today.getDay() || 7;
    start.setFullYear(today.getFullYear(), today.getMonth(), today.getDate() - day + 1);
  }
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: formatDate(date),
      label: date.toLocaleDateString(undefined, { weekday: "short" })
    };
  });
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function handleChartClick(event) {
  const rect = elements.chart.getBoundingClientRect();
  const scaleX = elements.chart.width / rect.width;
  const scaleY = elements.chart.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const hit = chartHitRegions.find((region) => (
    x >= region.x &&
    x <= region.x + region.width &&
    y >= region.y &&
    y <= region.y + region.height
  ));
  if (!hit) return;
  graphFilter = hit;
  renderDashboard();
  document.getElementById("observationList").scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyGraphFilter(observations) {
  if (!graphFilter) return observations;
  return observations.filter((item) => item.date === graphFilter.date && item.category === graphFilter.category);
}

function clearGraphFilter() {
  graphFilter = null;
  renderDashboard();
}

function renderGraphFilterState() {
  const button = $("#clearGraphFilterButton");
  if (!graphFilter) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  elements.resultCount.textContent = `${elements.resultCount.textContent} - filtered by ${graphFilter.category} on ${graphFilter.date}`;
}

function renderObservationList(observations) {
  elements.list.innerHTML = "";
  elements.resultCount.textContent = `${observations.length} shown`;
  if (!observations.length) {
    elements.list.innerHTML = `<p class="muted">No observations in this date range yet.</p>`;
    return;
  }

  const template = $("#observationTemplate");
  observations.forEach((item) => {
    const card = template.content.cloneNode(true);
    const chip = card.querySelector(".category-chip");
    const status = card.querySelector(".status-chip");
    chip.textContent = item.category;
    chip.classList.add(slug(item.category));
    status.textContent = item.status;
    status.classList.add(slug(item.status));
    if (item.excludedFromDashboard) {
      status.textContent = "Excluded";
      status.className = "status-chip excluded";
    }
    card.querySelector("h4").textContent = item.observation;
    card.querySelector(".card-action").textContent = `Action to be taken: ${item.action}`;
    const assignedTo = item.recipient || state.defaultEmail || "Not assigned";
    const observedBy = item.observerName || item.observerEmail || "Unknown observer";
    card.querySelector(".card-meta").textContent = `${item.date} ${item.time} - Observed by: ${observedBy} - Assigned to: ${assignedTo}`;
    card.querySelector(".closeout-form").dataset.id = item.id;

    const image = card.querySelector(".card-photo");
    if (item.photo) {
      image.src = item.photo;
      image.hidden = false;
    }

    const closeoutSummary = card.querySelector(".closeout-summary");
    const closeoutImage = card.querySelector(".closeout-photo");
    if (item.closeoutAction) {
      closeoutSummary.hidden = false;
      closeoutSummary.innerHTML = `<strong>Close-out action:</strong> ${escapeHtml(item.closeoutAction)}`;
    } else {
      closeoutSummary.hidden = false;
      closeoutSummary.textContent = "Close-out action is still pending.";
    }
    if (item.closeoutPhoto) {
      closeoutImage.src = item.closeoutPhoto;
      closeoutImage.hidden = false;
    }

    const closeoutForm = card.querySelector(".closeout-form");
    const raisedByThisDevice = item.observerId === state.deviceId;
    const raisedBySignedInUser = currentUser && item.observerUserId === currentUser.id;
    const canSubmitCloseout = state.role === "admin" || raisedBySignedInUser || raisedByThisDevice || item.observerCanClose;
    closeoutForm.hidden = item.status === "Closed" || !canSubmitCloseout;
    const closeoutText = closeoutForm.querySelector("[name='closeoutAction']");
    const closeoutSubmit = closeoutForm.querySelector("button[type='submit']");
    const closeoutCameraButton = closeoutForm.querySelector(".closeout-camera-button");
    const closeoutPhotoInput = closeoutForm.querySelector("[name='closeoutPhoto']");
    const closeoutCameraInput = closeoutForm.querySelector("[name='closeoutCameraPhoto']");
    closeoutText.value = item.closeoutAction || "";
    closeoutSubmit.textContent = item.status === "Close-out Submitted" ? "Update close-out" : "Submit close-out";
    closeoutCameraButton.addEventListener("click", () => closeoutCameraInput.click());

    const approvalButton = card.querySelector(".approval-button");
    const stateButton = card.querySelector(".state-button");
    const excludeButton = card.querySelector(".exclude-button");
    const closeoutReady = item.status === "Close-out Submitted" || Boolean(item.closeoutAction?.trim());
    const canApprove = closeoutReady && (state.role === "admin" || raisedBySignedInUser || raisedByThisDevice || item.observerCanClose);
    approvalButton.textContent = item.status === "Closed" ? "Approved" : "Pending Approval";
    approvalButton.disabled = !canApprove || item.status === "Closed";
    approvalButton.classList.toggle("approved", item.status === "Closed");
    approvalButton.title = canApprove ? "Approve and close this observation" : "Submit Action taken first";
    approvalButton.addEventListener("click", () => closeObservation(item.id));

    stateButton.textContent = item.status === "Closed" ? "CLOSED" : "OPEN";
    stateButton.classList.toggle("closed-ready", item.status === "Closed");
    stateButton.disabled = true;

    excludeButton.textContent = item.excludedFromDashboard ? "Include in dashboard" : "Exclude from dashboard";
    excludeButton.addEventListener("click", () => toggleDashboardExclusion(item.id));

    const approvalHelp = card.querySelector(".approval-help");
    if (item.status === "Closed") {
      approvalHelp.textContent = "Approved and closed.";
    } else if (!closeoutReady) {
      approvalHelp.textContent = "Complete Action taken, then tap Submit close-out to unlock approval.";
    } else if (!canApprove) {
      approvalHelp.textContent = "Only the logged-in observer who raised this item or an admin can approve it.";
    } else {
      approvalHelp.textContent = "Ready for approval.";
    }

    card.querySelector(".email-button").addEventListener("click", () => openObservationEmail(item));
    elements.list.append(card);
  });
}

function toggleDashboardExclusion(id) {
  const item = state.observations.find((observation) => observation.id === id);
  if (!item) return;
  item.excludedFromDashboard = !item.excludedFromDashboard;
  saveState();
  saveObservationRemote(item);
  renderDashboard();
  showToast(item.excludedFromDashboard ? "Removed from dashboard." : "Included in dashboard.");
}

function toggleShowExcluded() {
  showExcluded = !showExcluded;
  renderDashboard();
}

async function handleCloseoutSubmit(event) {
  event.preventDefault();
  const form = event.target.closest(".closeout-form");
  if (!form) return;
  const item = state.observations.find((observation) => observation.id === form.dataset.id);
  if (!item) return;

  const data = new FormData(form);
  const action = data.get("closeoutAction").trim();
  const file = data.get("closeoutPhoto")?.size
    ? data.get("closeoutPhoto")
    : data.get("closeoutCameraPhoto");
  if (!action) {
    showToast("Type the close-out action first.");
    return;
  }

  item.closeoutAction = action;
  item.closeoutPhoto = file && file.size ? await resizeImage(file, 1200, 0.75) : item.closeoutPhoto;
  item.closeoutSubmittedAt = new Date().toISOString();
  item.status = "Close-out Submitted";
  saveState();
  await saveObservationRemote(item);
  renderDashboard();
  setNotice("Close-out submitted. The observer can now confirm and close it.");
  showToast("Close-out submitted.");
}

function closeObservation(id) {
  const item = state.observations.find((observation) => observation.id === id);
  if (!item) return;
  item.status = "Closed";
  item.closedAt = new Date().toISOString();
  saveState();
  saveObservationRemote(item);
  renderDashboard();
  showToast("Observation closed.");
}

function getOpenCount(counts) {
  return (counts.status.Pending || 0) + (counts.status["Action Required"] || 0);
}

function renderAdmin() {
  elements.groupName.value = state.groupName;
  elements.defaultEmail.value = state.defaultEmail;
  const link = getInviteLink();
  elements.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`;
  elements.qrImage.hidden = false;
  elements.qrImage.onerror = () => {
    elements.qrImage.hidden = true;
    elements.qr.hidden = false;
    renderQr(link);
  };
}

function getInviteLink() {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("group", state.groupId);
  url.searchParams.set("role", "member");
  return url.toString();
}

function renderQr(text) {
  const canvas = elements.qr;
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const cells = 29;
  const cellSize = Math.floor(size / cells);
  const offset = Math.floor((size - cells * cellSize) / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  const seed = hashText(text);
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const finder = drawFinder(ctx, x, y, cellSize, offset, cells);
      if (finder) continue;
      const value = (seed + x * 31 + y * 47 + x * y * 7) % 11;
      if (value < 5) {
        ctx.fillStyle = "#17201d";
        ctx.fillRect(offset + x * cellSize, offset + y * cellSize, cellSize, cellSize);
      }
    }
  }

  ctx.fillStyle = "#17201d";
  ctx.font = "700 12px system-ui";
  ctx.fillText("SCAN INVITE", 72, size - 10);
}

function drawFinder(ctx, x, y, cellSize, offset, cells) {
  const zones = [
    [0, 0],
    [cells - 7, 0],
    [0, cells - 7]
  ];
  for (const [zx, zy] of zones) {
    if (x >= zx && x < zx + 7 && y >= zy && y < zy + 7) {
      const localX = x - zx;
      const localY = y - zy;
      const dark = localX === 0 || localY === 0 || localX === 6 || localY === 6 || (localX >= 2 && localX <= 4 && localY >= 2 && localY <= 4);
      ctx.fillStyle = dark ? "#17201d" : "#ffffff";
      ctx.fillRect(offset + x * cellSize, offset + y * cellSize, cellSize, cellSize);
      return true;
    }
  }
  return false;
}

function hashText(text) {
  return text.split("").reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) >>> 0, 2166136261);
}

async function copyInviteLink() {
  const link = getInviteLink();
  try {
    await navigator.clipboard.writeText(link);
    showToast("Invite link copied.");
  } catch {
    prompt("Copy invite link", link);
  }
}

function saveSettings() {
  state.groupName = elements.groupName.value.trim() || "Safety Observation Group";
  state.defaultEmail = elements.defaultEmail.value.trim();
  saveState();
  renderAll();
  showToast("Settings saved.");
}

function resetSetup() {
  state.setupComplete = false;
  saveState();
  renderAll();
  switchView("report");
}

function emailReport() {
  const observations = getFilteredObservations();
  const counts = getCounts(observations);
  const subject = `${state.groupName} safety report ${elements.from.value} to ${elements.to.value}`;
  const body = [
    `Safety Observation Report`,
    `Period: ${elements.from.value} to ${elements.to.value}`,
    `Total: ${observations.length}`,
    `Open / Pending: ${getOpenCount(counts)}`,
    `Close-out Submitted: ${counts.status["Close-out Submitted"] || 0}`,
    `Closed: ${counts.status.Closed || 0}`,
    "",
    ...Object.keys(CATEGORY_COLORS).map((category) => `${category}: ${counts.category[category] || 0}`),
    "",
    "Observations:",
    ...observations.map((item) => `- [${item.status}] ${item.date} ${item.time} ${item.category}: ${item.observation} | Action: ${item.action} | Close-out: ${item.closeoutAction || "Not submitted"}`)
  ].join("\n");
  setNotice("Report email prepared. The dashboard data is still saved in the app.");
  openMail(state.defaultEmail, subject, body);
}

function openObservationEmail(item) {
  item.emailPreparedAt = new Date().toISOString();
  saveState();
  saveObservationRemote(item);
  renderNotice();
  const subject = `Safety observation close-out: ${item.category}`;
  const body = [
    `Date/Time: ${item.date} ${item.time}`,
    `Category: ${item.category}`,
    `Status: ${item.status}`,
    "",
    `Observation: ${item.observation}`,
    `Action to be taken: ${item.action}`,
    `Close-out status: ${item.status}`,
    `Close-out action: ${item.closeoutAction || "Not submitted"}`,
    "",
    "Photo is stored in the app record. Attach manually if needed."
  ].join("\n");
  setNotice("Email prepared. You can close the app now; the action remains in the dashboard until close-out is confirmed.");
  openMail(item.recipient || state.defaultEmail, subject, body);
}

function openMail(to, subject, body) {
  const params = new URLSearchParams({ subject, body });
  window.location.href = `mailto:${encodeURIComponent(to || "")}?${params.toString()}`;
}

function exportCsv() {
  const observations = getFilteredObservations();
  const headers = ["Date", "Time", "Category", "Status", "Observation", "Action To Be Taken", "Close-out Action", "Recipient", "Observer Can Close"];
  const rows = observations.map((item) => [
    item.date,
    item.time,
    item.category,
    item.status,
    item.observation,
    item.action,
    item.closeoutAction,
    item.recipient,
    item.observerCanClose ? "Yes" : "No"
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `safety-observations-${elements.from.value}-to-${elements.to.value}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value || "").replaceAll("\"", "\"\"")}"`;
}

function seedDemoData() {
  const today = new Date();
  const samples = [
    ["Unsafe Act", "Worker bypassed marked pedestrian route.", "Stopped work and redirected worker to walkway.", "Action Required"],
    ["Unsafe Condition", "Loose cable crossing access path.", "Cable routed overhead and area barricaded.", "Closed"],
    ["Near Miss", "Dropped small hand tool from platform edge.", "Installed toe board and repeated tether briefing.", "Close-out Submitted"],
    ["Good Observation", "Team used spotter during reversing activity.", "Recognized crew during toolbox talk.", "Closed"]
  ];

  samples.forEach((sample, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - index * 3);
    state.observations.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}-${index}`,
      date: formatDate(date),
      time: "09:30",
      category: sample[0],
      observation: sample[1],
      action: sample[2],
      recipient: state.defaultEmail,
      observerCanClose: true,
      photo: "",
      closeoutAction: sample[3] === "Close-out Submitted" || sample[3] === "Closed" ? "Completed the corrective action and uploaded evidence." : "",
      closeoutPhoto: "",
      closeoutSubmittedAt: sample[3] === "Close-out Submitted" || sample[3] === "Closed" ? new Date().toISOString() : "",
      emailPreparedAt: "",
      status: sample[3],
      createdByRole: "member",
      observerId: state.deviceId,
      observerUserId: currentUser?.id || "",
      observerEmail: currentUser?.email || "",
      observerName: getObserverName(),
      createdAt: date.toISOString(),
      closedAt: sample[3] === "Closed" ? new Date().toISOString() : ""
    });
  });
  saveState();
  Promise.all(state.observations.slice(0, samples.length).map((item) => saveObservationRemote(item)));
  renderDashboard();
  showToast("Demo data added.");
}

function slug(value) {
  return value.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

function setNotice(message) {
  state.lastNotice = {
    message,
    createdAt: new Date().toISOString()
  };
  saveState();
  renderNotice();
}

function renderNotice() {
  if (!state.lastNotice?.message) {
    elements.notice.hidden = true;
    elements.notice.textContent = "";
    return;
  }
  elements.notice.hidden = false;
  elements.notice.textContent = state.lastNotice.message;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js");
  }
}
