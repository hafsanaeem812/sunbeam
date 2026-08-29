/* =====================================================================
   AI TRAVEL — frontend logic
   No frameworks. Talks to the Flask backend at POST /api/generate-trip.
   ===================================================================== */

(() => {
  "use strict";

  // ---------------------------------------------------------------- state
  const state = {
    selectedVibes: new Set(),
    lastPayload: null,
  };

  // ---------------------------------------------------------------- elements
  const views = {
    planner: document.getElementById("planner-view"),
    loading: document.getElementById("loading-view"),
    error: document.getElementById("error-view"),
    results: document.getElementById("results-view"),
  };

  const form = document.getElementById("trip-form");
  const formError = document.getElementById("form-error");
  const vibeChips = Array.from(document.querySelectorAll(".vibe-chip"));
  const loadingMessageEl = document.getElementById("loading-message");
  const errorMessageEl = document.getElementById("error-message");
  const errorRetryBtn = document.getElementById("error-retry");
  const resultsContent = document.getElementById("results-content");
  const topbarMeta = document.getElementById("topbar-meta");

  const startDateInput = document.getElementById("start_date");
  const endDateInput = document.getElementById("end_date");

  // ---------------------------------------------------------------- setup
  function init() {
    const today = new Date().toISOString().split("T")[0];
    startDateInput.min = today;
    endDateInput.min = today;

    startDateInput.addEventListener("change", () => {
      endDateInput.min = startDateInput.value;
    });

    vibeChips.forEach((chip) => {
      chip.addEventListener("click", () => toggleVibe(chip));
    });

    form.addEventListener("submit", onSubmit);
    errorRetryBtn.addEventListener("click", () => showView("planner"));
  }

  function toggleVibe(chip) {
    const vibe = chip.dataset.vibe;
    if (state.selectedVibes.has(vibe)) {
      state.selectedVibes.delete(vibe);
      chip.classList.remove("is-selected");
      chip.setAttribute("aria-pressed", "false");
    } else {
      state.selectedVibes.add(vibe);
      chip.classList.add("is-selected");
      chip.setAttribute("aria-pressed", "true");
    }
  }

  function showView(name) {
    Object.entries(views).forEach(([key, el]) => {
      el.classList.toggle("view--active", key === name);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------------------------------------------------------------- validation
  function validateForm(data) {
    if (!data.origin.trim()) return "Please enter a starting location.";
    if (!data.destination.trim()) return "Please enter a destination.";
    if (!data.start_date || !data.end_date) return "Please choose your travel dates.";
    if (data.end_date <= data.start_date) return "Your return date must be after your departure date.";
    if (!data.budget || Number(data.budget) <= 0) return "Please enter a budget greater than zero.";
    if (!data.travelers || Number(data.travelers) < 1) return "Please enter at least one traveler.";
    if (data.vibes.length === 0) return "Please select at least one travel vibe.";
    return null;
  }

  // ---------------------------------------------------------------- submit flow
  async function onSubmit(e) {
    e.preventDefault();
    formError.textContent = "";

    const formData = new FormData(form);
    const payload = {
      origin: formData.get("origin") || "",
      destination: formData.get("destination") || "",
      start_date: formData.get("start_date") || "",
      end_date: formData.get("end_date") || "",
      budget: formData.get("budget") || "",
      currency: formData.get("currency") || "USD",
      travelers: formData.get("travelers") || "1",
      vibes: Array.from(state.selectedVibes),
    };

    const validationError = validateForm(payload);
    if (validationError) {
      formError.textContent = validationError;
      return;
    }

    state.lastPayload = payload;
    showView("loading");
    startLoadingMessages();

    // Guard against a stalled request (e.g. an outbound weather/flight
    // lookup silently hanging on a restrictive network) so the user always
    // sees an error instead of an infinite loading screen.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch("/api/generate-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      let body;
      try {
        body = await response.json();
      } catch (_parseErr) {
        throw new Error("The server sent back something unexpected. Please try again.");
      }

      if (!response.ok) {
        throw new Error(body.error || "We couldn't build your itinerary. Please try again.");
      }

      stopLoadingMessages();
      renderResults(body, payload);
      showView("results");
    } catch (err) {
      stopLoadingMessages();
      if (err.name === "AbortError") {
        errorMessageEl.textContent = "This is taking much longer than expected — the server may be unreachable or stuck. Check that it's still running, then try again.";
      } else {
        errorMessageEl.textContent = err.message || "A network error occurred. Please check your connection and try again.";
      }
      showView("error");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ---------------------------------------------------------------- loading rotation
  const LOADING_MESSAGES = [
    "Checking your preferences…",
    "Looking up your route and stay options…",
    "Checking the weather at your destination…",
    "Building your itinerary…",
    "Finding experiences that match your vibe…",
    "Balancing your budget…",
    "Preparing backup options…",
  ];
  let loadingInterval = null;

  function startLoadingMessages() {
    let i = 0;
    loadingMessageEl.textContent = LOADING_MESSAGES[0];
    loadingInterval = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      loadingMessageEl.style.opacity = 0;
      setTimeout(() => {
        loadingMessageEl.textContent = LOADING_MESSAGES[i];
        loadingMessageEl.style.opacity = 1;
      }, 200);
    }, 1600);
  }
  function stopLoadingMessages() {
    if (loadingInterval) clearInterval(loadingInterval);
    loadingInterval = null;
  }

  // ---------------------------------------------------------------- formatting helpers
  function money(value, currency) {
    const n = Number(value) || 0;
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    } catch (_e) {
      return `${currency} ${n.toFixed(0)}`;
    }
  }
  function fmtDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
  }

  // ---------------------------------------------------------------- render results
  function renderResults(apiResponse, payload) {
    const trip = apiResponse.itinerary;
    const meta = apiResponse.meta || {};
    const currency = trip.trip_summary?.currency || payload.currency;

    topbarMeta.textContent = `${trip.trip_summary?.origin || payload.origin} → ${trip.trip_summary?.destination || payload.destination}`;

    const budget = trip.budget_breakdown || {};
    const totalCost = Number(budget.total_estimated_cost || 0);
    const requestedBudget = Number(payload.budget);
    const percentUsed = budget.percent_used != null ? Number(budget.percent_used) : Math.round((totalCost / requestedBudget) * 100);
    const isOver = percentUsed > 100;

    const html = `
      ${renderDemoBanner(meta)}
      ${renderTripHeader(trip, payload)}
      ${renderBudgetBlock(budget, currency, percentUsed, isOver)}
      ${renderFlightSection(trip.flight, currency)}
      ${renderAccommodationSection(trip.accommodation, currency)}
      ${renderItinerarySection(trip.daily_itinerary, currency)}
      ${renderRestaurantsSection(trip.restaurants)}
      ${renderBackupSection(trip.backup_options)}
      ${renderTipsSection(trip.travel_tips)}
      <div class="results-actions">
        <button type="button" class="secondary-btn" id="plan-another-btn">PLAN ANOTHER TRIP</button>
      </div>
    `;

    resultsContent.innerHTML = html;
    document.getElementById("plan-another-btn").addEventListener("click", () => {
      showView("planner");
    });
  }

  function renderDemoBanner(meta) {
    if (!meta.demo_mode) return "";
    return `<div class="demo-banner">⚠ Demo mode: no AI API key is configured on the server, so this itinerary uses sample data. See the README to enable real generation.</div>`;
  }

  function renderTripHeader(trip, payload) {
    const s = trip.trip_summary || {};
    const vibes = (s.vibes && s.vibes.length ? s.vibes : payload.vibes).join(" · ");
    return `
      <div class="trip-header">
        <p class="trip-header-eyebrow">BOARDING PASS &middot; ${escapeHtml((s.origin || payload.origin).toUpperCase())} → ${escapeHtml((s.destination || payload.destination).toUpperCase())}</p>
        <h2>${escapeHtml(s.destination || payload.destination)}</h2>
        <div class="trip-meta-row">
          <span class="trip-meta-chip">${escapeHtml(fmtDate(s.start_date || payload.start_date))} — ${escapeHtml(fmtDate(s.end_date || payload.end_date))}</span>
          <span class="trip-meta-chip">${escapeHtml(String(s.travelers || payload.travelers))} traveler${Number(s.travelers || payload.travelers) > 1 ? "s" : ""}</span>
          <span class="trip-meta-chip">${escapeHtml(vibes)}</span>
        </div>
        ${s.overview ? `<p style="color:var(--muted); max-width: 62ch; line-height:1.6; margin-top:16px;">${escapeHtml(s.overview)}</p>` : ""}
      </div>
    `;
  }

  function renderBudgetBlock(budget, currency, percentUsed, isOver) {
    const remaining = budget.remaining_budget != null ? budget.remaining_budget : 0;
    const clampedWidth = Math.min(Math.max(percentUsed, 0), 100);
    return `
      <div class="budget-block">
        <div class="budget-stat">
          <p class="budget-stat-label">Total estimated cost</p>
          <p class="budget-stat-value">${money(budget.total_estimated_cost, currency)}</p>
        </div>
        <div class="budget-stat ${isOver ? "is-over" : ""}">
          <p class="budget-stat-label">${isOver ? "Over budget by" : "Remaining budget"}</p>
          <p class="budget-stat-value">${money(Math.abs(remaining), currency)}</p>
        </div>
        <div class="budget-stat">
          <p class="budget-stat-label">Budget used</p>
          <p class="budget-stat-value">${percentUsed}%</p>
        </div>
      </div>
      <div class="budget-bar-wrap">
        <div class="budget-bar-track">
          <div class="budget-bar-fill ${isOver ? "is-over" : ""}" style="width:${clampedWidth}%"></div>
        </div>
        <p class="budget-bar-caption">FLIGHTS ${money(budget.flights, currency)} · STAY ${money(budget.accommodation, currency)} · FOOD ${money(budget.food, currency)} · ACTIVITIES ${money(budget.activities, currency)} · LOCAL TRANSPORT ${money(budget.local_transport, currency)} · MISC ${money(budget.miscellaneous, currency)}</p>
      </div>
      ${budget.optimization_note ? `<div class="optimization-note">${escapeHtml(budget.optimization_note)}</div>` : ""}
    `;
  }

  function renderFlightSection(flight, currency) {
    if (!flight) return "";
    return `
      <div class="section-block">
        <p class="section-eyebrow">TRANSPORT</p>
        <h3 class="section-title">Flight</h3>
        <div class="ticket-card flight-card">
          <span class="flight-label">${escapeHtml(flight.summary || "Estimated flight information")}</span>
          <div class="flight-route">
            <span class="flight-route-point">${escapeHtml(flight.departure || "")}</span>
            <span class="flight-route-line"></span>
            <span class="flight-route-point">${escapeHtml(flight.arrival || "")}</span>
          </div>
          <div class="flight-details">
            <div>
              <p class="flight-detail-label">Duration</p>
              <p class="flight-detail-value">${escapeHtml(flight.duration || "—")}</p>
            </div>
            <div>
              <p class="flight-detail-label">Stops</p>
              <p class="flight-detail-value">${flight.stops === 0 ? "Nonstop" : escapeHtml(String(flight.stops))}</p>
            </div>
            <div>
              <p class="flight-detail-label">Per person</p>
              <p class="flight-detail-value">${money(flight.estimated_price_per_person, currency)}</p>
            </div>
            <div>
              <p class="flight-detail-label">Total</p>
              <p class="flight-detail-value">${money(flight.estimated_total, currency)}</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderAccommodationSection(list, currency) {
    if (!list || !list.length) return "";
    const cards = list.map((stay) => `
      <div class="ticket-card stay-card">
        <div>
          <p class="stay-name">${escapeHtml(stay.name)}</p>
          <p class="stay-area">${escapeHtml(stay.area || "")}</p>
        </div>
        <div class="stay-price">
          <div class="stay-price-total">${money(stay.total_price, currency)}</div>
          <div class="stay-price-nightly">${money(stay.nightly_price, currency)} / night</div>
        </div>
        <p class="stay-why">${escapeHtml(stay.why_it_fits || "")}</p>
      </div>
    `).join("");
    return `
      <div class="section-block">
        <p class="section-eyebrow">STAY</p>
        <h3 class="section-title">Accommodation</h3>
        ${cards}
      </div>
    `;
  }

  function renderItinerarySection(days, currency) {
    if (!days || !days.length) return "";
    const cards = days.map((day) => {
      const items = (day.items || []).map((item) => `
        <div class="day-item">
          <div class="day-item-time">${escapeHtml(item.time || "")}</div>
          <div>
            <span class="day-item-category">${escapeHtml(item.category || "")}</span>
            <p class="day-item-name">${escapeHtml(item.name || "")}</p>
            <p class="day-item-desc">${escapeHtml(item.description || "")}</p>
            ${item.vibe_reason ? `<p class="day-item-vibe">${escapeHtml(item.vibe_reason)}</p>` : ""}
          </div>
          <div class="day-item-cost">${item.estimated_cost ? money(item.estimated_cost, currency) : "—"}</div>
        </div>
      `).join("");
      return `
        <div class="ticket-card day-card">
          <div class="day-card-head">
            <div class="day-card-head-left">
              <span class="day-number">DAY ${escapeHtml(String(day.day))}</span>
              <h4 class="day-title">${escapeHtml(day.title || "")}</h4>
            </div>
            <span class="day-date">${escapeHtml(fmtDate(day.date))}</span>
          </div>
          ${day.weather_note ? `<div style="padding: 10px 24px 0;"><p class="day-weather">${escapeHtml(day.weather_note)}</p></div>` : ""}
          <div class="day-items">${items}</div>
        </div>
      `;
    }).join("");
    return `
      <div class="section-block">
        <p class="section-eyebrow">SCHEDULE</p>
        <h3 class="section-title">Day-by-day itinerary</h3>
        ${cards}
      </div>
    `;
  }

  function renderRestaurantsSection(list) {
    if (!list || !list.length) return "";
    const cards = list.map((r) => `
      <div class="ticket-card restaurant-card">
        <p class="restaurant-name">${escapeHtml(r.name)}</p>
        <p class="restaurant-meta">${escapeHtml(r.cuisine || "")} &middot; ${escapeHtml(r.price_level || "")}</p>
        <p class="restaurant-why">${escapeHtml(r.why_it_fits || "")}</p>
      </div>
    `).join("");
    return `
      <div class="section-block">
        <p class="section-eyebrow">FOOD</p>
        <h3 class="section-title">Restaurant recommendations</h3>
        <div class="restaurant-grid">${cards}</div>
      </div>
    `;
  }

  function renderBackupSection(list) {
    if (!list || !list.length) return "";
    const cards = list.map((b) => `
      <div class="ticket-card backup-card">
        <div>
          <p class="backup-col-label">Primary</p>
          <p class="backup-primary">${escapeHtml(b.primary_activity)}</p>
          <p class="backup-time">${escapeHtml(b.primary_time || "")}</p>
        </div>
        <div>
          <p class="backup-col-label">Backup</p>
          <p class="backup-alt">${escapeHtml(b.backup_activity)}</p>
        </div>
        <p class="backup-reason">BACKUP SUGGESTED BECAUSE: ${escapeHtml(b.reason || "")}</p>
      </div>
    `).join("");
    return `
      <div class="section-block">
        <p class="section-eyebrow">JUST IN CASE</p>
        <h3 class="section-title">Backup options</h3>
        ${cards}
      </div>
    `;
  }

  function renderTipsSection(tips) {
    if (!tips || !tips.length) return "";
    const items = tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    return `
      <div class="section-block">
        <p class="section-eyebrow">GOOD TO KNOW</p>
        <h3 class="section-title">Travel tips</h3>
        <ul class="ticket-card tips-list">${items}</ul>
      </div>
    `;
  }

  init();
})();
