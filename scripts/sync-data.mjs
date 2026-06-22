import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RSS_URL = process.env.RSS_URL || "https://podster.fm/rss.xml?pid=26502";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "data/episodes.js");
const rss = await loadSource(RSS_URL, process.env.SYNC_RSS_FILE);
const channelTitle = stripHtml(xmlTag(rss, "title"));
const episodes = parseRss(rss).sort(
  (a, b) => a.publication.localeCompare(b.publication) || a.number - b.number,
);

if (episodes.length < 300) {
  throw new Error(`Only ${episodes.length} episodes parsed; refusing to overwrite data`);
}

const payload = {
  source: RSS_URL,
  title: channelTitle,
  updatedAt: new Date().toISOString().slice(0, 10),
  episodes,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `window.__RASKRASKI_DATA__ = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
console.log(`Saved ${episodes.length} episodes to ${output}`);

async function loadSource(url, localPath) {
  if (localPath) return readFile(localPath, "utf8");
  const response = await fetch(url, {
    headers: { "User-Agent": "raskraski-hiatus-chart/1.0" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Podster RSS returned ${response.status}`);
  return response.text();
}

function parseRss(input) {
  return [...input.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, item], index) => {
    const title = stripHtml(xmlTag(item, "title"));
    const topics = extractComics(xmlTag(item, "description"), title);
    const episodeNumber = Number(xmlTag(item, "itunes:episode")) || null;
    return {
      id: xmlTag(item, "guid") || `episode-${index + 1}`,
      podcast: inferFormat(title),
      number: episodeNumber,
      publication: toIsoDate(xmlTag(item, "pubDate")),
      title,
      topics,
      description: topics.join(" · "),
      source: "podster-rss",
      link: xmlTag(item, "link"),
    };
  });
}

function inferFormat(title) {
  if (/айснер|eisner/i.test(title)) return "Премия Айснера";
  if (/^РР на пульсе/i.test(title)) return "РР на пульсе";
  if (/^РР\+|^Раскраски\+/i.test(title)) return "РР+";
  if (/^РР на Канобу/i.test(title)) return "РР на Канобу";
  if (/Прямые Раскраски|\bLIVE\b|\bALIVE\b|Ответы на вопросы/i.test(title)) return "Прямые эфиры";
  return "Раскрашенные Раскраски";
}

function extractComics(html, episodeTitle) {
  const text = decodeXml(html)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|li|div)>/gi, "\n")
    .replace(/<li(?:\s[^>]*)?>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ");
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const timed = [];
  const bullets = [];

  for (const line of lines) {
    const timestamp = line.match(/^\d{1,2}:\d{2}(?::\d{2})?\s*[—–-]\s*(.+)$/);
    if (timestamp) {
      const comic = cleanTimedEntry(timestamp[1]);
      if (comic) timed.push(comic);
      continue;
    }
    if (/^[-–—]\s+/.test(line)) {
      const comic = cleanBulletEntry(line.replace(/^[-–—]\s+/, ""));
      if (comic) bullets.push(comic);
    }
  }

  const titleTopic = topicFromTitle(episodeTitle);
  const topics = [...timed, ...bullets].filter(looksLikeComicTitle);
  const withoutTitleVariants = titleTopic ? topics.filter((topic) => !similar(topic, titleTopic)) : topics;
  return unique(titleTopic ? [titleTopic, ...withoutTitleVariants] : withoutTitleVariants).slice(0, 80);
}

function cleanTimedEntry(value) {
  let result = clean(value).replace(/[;,.]\s*$/, "");
  if (/^(новые\s*комиксы|комиксы недели|trash-talk|ответы|новости|перерыв)/i.test(result)) return "";
  result = result
    .replace(/^(?:мы\s+)?(?:обсуждаем|говорим про|говорим о|читаем)\s+/i, "")
    .split(/\s+(?:--|—|–)\s+|,\s+(?:говорим|обсуждаем|делимся|пытаемся|читаем|отмечаем)\b/i)[0];
  if (result.length > 120 || countWords(result) > 14) return "";
  return result;
}

function cleanBulletEntry(value) {
  let result = clean(value).replace(/[;,.]\s*$/, "");
  if (/^(поддержать|благодарности|следующие|альбом|лучш|дз\b|и другие|а также)/i.test(result)) return "";
  result = result
    .replace(/^(?:в отличие от|финал сезона|предпоследний выпуск|кроссовер)\s+/i, "")
    .replace(/^(?:в|про|обсуждаем)\s+/i, "")
    .replace(/^(?:как и|почти все|новые выпуски|очередной|первого выпуска)\s+/i, "")
    .split(/\s+(?:—|--|–)\s+|\s+(?:про|и как|и дискуссия|и история|и счастлив|наконец(?:-то)?|всё ещё|подтвердил|место для|хоть и|превратился|но теперь|как и|хорош|оказался)(?:\s|[,:;.!?-])|,\s*(?:или|но|а)(?:\s|$)/i)[0]
    .replace(/\s*\((?:[^()]*(?:\/|,|и др\.)[^()]*)\)\s*$/i, "");
  if (!/^[A-ZА-ЯЁ0-9«]/.test(result) || result.length > 100 || countWords(result) > 12) return "";
  return result;
}

function topicFromTitle(title) {
  if (/^РР на пульсе|Прямые Раскраски|\bLIVE\b|\bALIVE\b|Ответы на вопросы/i.test(title)) return "";
  const afterPrefix = title
    .replace(/^(?:РР\+?\s*)?(?:на Канобу\s*)?(?:S\d+E\d+|S\d+#\d+|Special\s*#?\d+|#\.?\d+)\s*:\s*/i, "")
    .trim();
  if (
    afterPrefix === title ||
    !afterPrefix ||
    /^(?:лучшие(?:\s|$)|айснер(?:\s|$)|разогрев$|спецвыпуск(?:\s|$)|филя братухин$|говорим о(?:\s|$))/i.test(afterPrefix)
  ) return "";
  const parentheses = [...afterPrefix.matchAll(/\(([^()]+)\)/g)].map((match) => match[1]).at(-1);
  if (parentheses && /[A-Za-z]/.test(parentheses) && !/в гостях|аудио|часть\s+\d/i.test(parentheses)) {
    return clean(parentheses);
  }
  return clean(afterPrefix.replace(/\s*\([^()]+\)\s*$/, ""));
}

function similar(left, right) {
  const normalize = (value) => value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "");
  const a = normalize(left);
  const b = normalize(right);
  return a.includes(b) || b.includes(a);
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countWords(value) {
  return value.split(/\s+/).filter(Boolean).length;
}

function looksLikeComicTitle(value) {
  if (!value || value.length > 120 || countWords(value) > 14) return false;
  return !/(отвечаем|обсуждаем|говорим|читаем|делимся|пытаемся|начинаем|рассказывает|осозна[её]м|вспоминаем|празднуем|проходимся|внезапно|вяло|подтвердил|оказался|превратился|новости|розыгрыша|рецензи[ия]|вопрос[ыа]|слушател|подкаст|комиксы недели|\sхорош$)/i.test(value);
}

function toIsoDate(value) {
  const match = value.match(/^[A-Za-z]{3},\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!match) throw new Error(`Unsupported RSS date: ${value}`);
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  return `${match[3]}-${months[match[2]]}-${match[1].padStart(2, "0")}`;
}

function xmlTag(input, tag) {
  const match = input.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return clean(decodeXml((match?.[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "")));
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function stripHtml(value) {
  return clean(decodeXml(value).replace(/<[^>]+>/g, " "));
}

function clean(value = "") {
  return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}
