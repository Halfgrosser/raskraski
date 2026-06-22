const data = window.__RASKRASKI_DATA__;

const chart = document.querySelector("#chart");
const filter = document.querySelector("#series-filter");
const card = document.querySelector("#episode-card");
const bars = document.querySelector("#year-bars");
const rubricStats = document.querySelector("#rubric-stats");
const ruDate = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const EISNER_FORMAT = "Премия Айснера";
const MAIN_FORMAT = "Раскрашенные Раскраски";
const rubricOrder = [MAIN_FORMAT, "РР на пульсе", "РР+", "РР на Канобу", "Прямые эфиры"];
const rubricNames = {
  [MAIN_FORMAT]: "Раскрашенные раскраски",
};

const formatNames = {
  all: "Все форматы",
};

if (!data?.episodes?.length) {
  chart.innerHTML = '<p class="error">Не удалось загрузить данные выпусков. Запустите <code>npm run sync</code>.</p>';
  throw new Error("Episode data is missing");
}

const episodes = data.episodes
  .map((episode) => ({ ...episode, date: new Date(`${episode.publication}T12:00:00`) }))
  .sort((a, b) => a.date - b.date);

const formats = [...new Set(episodes.map((episode) => episode.podcast))];
filter.innerHTML = ["all", ...formats]
  .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(formatNames[name] || name)}</option>`)
  .join("");

document.querySelector("#updated-at").textContent = `Данные обновлены ${ruDate.format(new Date(`${data.updatedAt}T12:00:00`))}`;

filter.addEventListener("change", render);
renderRubrics();
render();

function render() {
  const selected = filter.value || "all";
  const visible = selected === "all" ? episodes : episodes.filter((episode) => episode.podcast === selected);
  renderChart(visible);
  renderStats(visible);
  renderBars(visible);
  card.hidden = true;
}

function renderChart(visible) {
  const now = startOfWeek(new Date());
  const first = startOfWeek(episodes[0].date);
  const firstYear = isoWeekInfo(first).year;
  const currentYear = isoWeekInfo(now).year;
  const byWeek = new Map();

  for (const episode of visible) {
    const key = weekKey(episode.date);
    const bucket = byWeek.get(key) || [];
    bucket.push(episode);
    byWeek.set(key, bucket);
  }

  const rows = [];
  for (let year = currentYear; year >= firstYear; year -= 1) {
    const weeks = [];
    for (let week = 1; week <= 52; week += 1) {
      const date = dateFromIsoWeek(year, week);
      const key = `${year}-W${String(week).padStart(2, "0")}`;
      const found = byWeek.get(key) || [];
      const isBeforeFirst = date < first;
      const isFuture = date > now;
      const state = isBeforeFirst || isFuture ? "is-future" : found.length ? "is-release" : "is-hiatus";
      const emptyLabel = isBeforeFirst ? "до старта подкаста" : isFuture ? "будущая неделя" : "без выпуска";
      const label = found.length
        ? `${week}-я неделя ${year}: ${found.map(episodeLabel).join(", ")}`
        : `${week}-я неделя ${year}: ${emptyLabel}`;
      weeks.push(
        `<button class="week ${state}${found.length > 1 ? " is-multi" : ""}" data-date="${date.toISOString()}" data-key="${key}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"></button>`,
      );
    }
    rows.push(`<div class="chart-row"><span class="chart-year">${year}</span><div class="weeks">${weeks.join("")}</div></div>`);
  }

  chart.innerHTML = rows.join("");
  chart.querySelectorAll("button.week").forEach((button) => {
    button.addEventListener("click", () => {
      chart.querySelector(".is-selected")?.classList.remove("is-selected");
      button.classList.add("is-selected");
      showWeek(button.dataset.date, byWeek.get(button.dataset.key) || []);
    });
  });
}

function showWeek(isoDate, found) {
  const monday = new Date(isoDate);
  const containsMergedWeek = found.some((episode) => isoWeekInfo(episode.date).week === 53);
  const sunday = addDays(monday, containsMergedWeek ? 13 : 6);
  card.hidden = false;
  card.classList.toggle("is-pause", !found.length);

  if (!found.length) {
    card.innerHTML = `
      <div class="episode-card__date">${ruDate.format(monday)} — ${ruDate.format(sunday)}</div>
      <h3>Неделя без выпуска</h3>
      <p>В выбранном формате публикаций не было.</p>`;
    return;
  }

  card.innerHTML = `
    <div class="episode-card__date">${ruDate.format(monday)} — ${ruDate.format(sunday)}</div>
    ${found
      .map(
        (episode) => `<div class="episode-line">
          <h3>${escapeHtml(episodeLabel(episode))}</h3>
          <p class="episode-topics">${escapeHtml(episode.topics.join(" · ") || "Комиксы не перечислены")}</p>
        </div>`,
      )
      .join("")}`;
}

function renderRubrics() {
  const counts = new Map(rubricOrder.map((name) => [name, 0]));
  for (const episode of episodes) {
    const name = episode.podcast === EISNER_FORMAT ? MAIN_FORMAT : episode.podcast;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  rubricStats.innerHTML = rubricOrder
    .map((name) => {
      const count = counts.get(name) || 0;
      return `<article class="rubric-card">
        <strong>${count}</strong>
        <span>${escapeHtml(rubricNames[name] || name)}</span>
      </article>`;
    })
    .join("");
}

function renderStats(visible) {
  const now = startOfWeek(new Date());
  const weekSet = new Set(visible.map((episode) => rawWeekKey(episode.date)));
  const first = visible[0]?.date;
  const latest = visible.at(-1);
  let longest = 0;
  let run = 0;

  if (first) {
    for (let cursor = startOfWeek(first); cursor <= now; cursor = addDays(cursor, 7)) {
      if (weekSet.has(rawWeekKey(cursor))) {
        run = 0;
      } else {
        run += 1;
        longest = Math.max(longest, run);
      }
    }
  }

  const latestWeek = latest ? startOfWeek(latest.date) : now;
  const current = Math.max(0, Math.round((now - latestWeek) / 604800000));
  setText("stat-releases", visible.length);
  setText("stat-releases-note", plural(visible.length, "выпуск", "выпуска", "выпусков"));
  setText("stat-current", current);
  setText("stat-current-note", plural(current, "полная неделя", "полные недели", "полных недель"));
  setText("stat-longest", longest);
  setText("stat-longest-note", plural(longest, "неделя без выпусков", "недели без выпусков", "недель без выпусков"));
  setText("stat-latest", latest ? (latest.number ? `#${latest.number}` : latest.podcast) : "—");
  setText("stat-latest-note", latest ? `${latest.podcast} · ${ruDate.format(latest.date)}` : "Нет выпусков");
}

function renderBars(visible) {
  const years = [...new Set(episodes.map((episode) => episode.date.getFullYear()))].sort((a, b) => b - a);
  const counts = new Map(years.map((year) => [year, 0]));
  visible.forEach((episode) => counts.set(episode.date.getFullYear(), (counts.get(episode.date.getFullYear()) || 0) + 1));
  const max = Math.max(1, ...counts.values());
  bars.innerHTML = years
    .map((year) => {
      const count = counts.get(year) || 0;
      return `<div class="year-bar">
        <span>${year}</span>
        <span class="year-bar__track"><i class="year-bar__fill" style="width:${(count / max) * 100}%"></i></span>
        <span class="year-bar__value">${count} ${shortEpisodePlural(count)}</span>
      </div>`;
    })
    .join("");
}

function isoWeekInfo(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return {
    year: target.getUTCFullYear(),
    week: Math.ceil(((target - yearStart) / 86400000 + 1) / 7),
  };
}

function weekKey(date) {
  const { year, week } = isoWeekInfo(date);
  return `${year}-W${String(Math.min(week, 52)).padStart(2, "0")}`;
}

function rawWeekKey(date) {
  const { year, week } = isoWeekInfo(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function startOfWeek(date) {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function dateFromIsoWeek(year, week) {
  const fourth = new Date(year, 0, 4, 12);
  return addDays(startOfWeek(fourth), (week - 1) * 7);
}

function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function episodeLabel(episode) {
  return episode.title || `${episode.podcast} ${episode.number ? `#${episode.number}` : ""}`.trim();
}

function setText(id, text) {
  document.querySelector(`#${id}`).textContent = text;
}

function plural(number, one, few, many) {
  const n10 = number % 10;
  const n100 = number % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function shortEpisodePlural(number) {
  return plural(number, "вып.", "вып.", "вып.");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
