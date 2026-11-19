// DataDistill engine: deterministic, no LLM, no network.
// Input: messy free text. Output: JSON and/or CSV of structured data.

export function norm(s) {
  return String(s ?? '')
    .replace(/\u20a6/g, 'NGN ').replace(/\u20ac/g, 'EUR ').replace(/\u00a3/g, 'GBP ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ').replace(/\r/g, '')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[^\x00-\x7F]/g, '');
}

// ---- helpers ----
function scan(state, re, fn) {
  re.lastIndex = 0;
  const src = state.t, out = [];
  let m;
  while ((m = re.exec(src))) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const r = fn(m);
    if (r !== null && r !== undefined) {
      if (typeof r === 'object') r._i = m.index;
      out.push(r);
      state.t = state.t.slice(0, m.index) + ' '.repeat(m[0].length) + state.t.slice(m.index + m[0].length);
    }
  }
  return out;
}
const strip = (arr) => arr.sort((a, b) => a._i - b._i).map(({ _i, ...rest }) => rest);
const uniq = (arr) => [...new Set(arr)];

const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WD_ALT = WD.join('|');

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(s) { return new Date(s + 'T00:00:00Z').getUTCDay(); }
const pad = (n) => String(n).padStart(2, '0');

// ---- dates ----
function findDates(state, today) {
  const yr = +today.slice(0, 4);
  const out = [];
  const add = (a) => out.push(...a);

  add(scan(state, /\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => {
    const v = iso(+m[1], +m[2], +m[3]);
    return v ? { raw: m[0], iso: v, kind: 'absolute' } : null;
  }));

  add(scan(state, /\b(\d{1,2})([\/.-])(\d{1,2})\2(\d{4}|\d{2})\b/g, (m) => {
    if (m[2] === '-' && m[4].length !== 4) return null;
    const a = +m[1], b = +m[3]; let y = +m[4]; if (y < 100) y += 2000;
    if (a > 12) { const v = iso(y, b, a); return v ? { raw: m[0], iso: v, kind: 'absolute' } : null; }
    if (b > 12) { const v = iso(y, a, b); return v ? { raw: m[0], iso: v, kind: 'absolute' } : null; }
    return { raw: m[0], iso: null, kind: 'ambiguous', note: 'dd/mm or mm/dd' };
  }));

  const monthDay = new RegExp('\\b(' + MONTH_ALT + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'gi');
  const dayMonth = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + MONTH_ALT + ')\\b\\.?(?:,?\\s+(\\d{4}))?', 'gi');
  const build = (mo, d, y) => {
    if (mo.toLowerCase() === 'may' && mo[0] !== 'M') return null;
    const v = iso(y || yr, MONTHS[mo.toLowerCase()], +d);
    if (!v) return null;
    return { iso: v, kind: 'absolute', ...(y ? {} : { year_assumed: true }) };
  };
  add(scan(state, monthDay, (m) => { const r = build(m[1], m[2], m[3] ? +m[3] : 0); return r ? { raw: m[0], ...r } : null; }));
  add(scan(state, dayMonth, (m) => { const r = build(m[2], m[1], m[3] ? +m[3] : 0); return r ? { raw: m[0].trim(), ...r } : null; }));

  add(scan(state, new RegExp('\\b(' + MONTH_ALT + ')\\.?,?\\s+(\\d{4})\\b', 'gi'), (m) =>
    (m[1].toLowerCase() === 'may' && m[1][0] !== 'M') ? null : ({ raw: m[0], iso: m[2] + '-' + pad(MONTHS[m[1].toLowerCase()]), kind: 'month' })));

  const rel = new RegExp('\\b(today|tonight|tomorrow|tomorow|tmrw|tmr|2moro|yesterday|(?:next|this|coming)\\s+(?:' + WD_ALT + ')|' + WD_ALT + '|next week|next month|end of (?:the )?(?:month|week))\\b', 'gi');
  add(scan(state, rel, (m) => {
    const w = m[1].toLowerCase().replace(/\s+/g, ' ');
    let v;
    if (w === 'today' || w === 'tonight') v = today;
    else if (/^(tomorrow|tomorow|tmrw|tmr|2moro)$/.test(w)) v = addDays(today, 1);
    else if (w === 'yesterday') v = addDays(today, -1);
    else if (w === 'next week') v = addDays(today, 7);
    else if (w === 'next month') { const d = new Date(today + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); v = d.toISOString().slice(0, 10); }
    else if (w.startsWith('end of') && w.endsWith('month')) { const d = new Date(today + 'T00:00:00Z'); v = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); }
    else if (w.startsWith('end of')) { v = addDays(today, ((5 - dow(today) + 7) % 7)); }
    else {
      const name = w.split(' ').pop();
      const target = WD.indexOf(name);
      const ahead = (target - dow(today) + 7) % 7;
      v = addDays(today, w.startsWith('next') && ahead === 0 ? 7 : ahead);
    }
    return { raw: m[0], iso: v, kind: 'relative' };
  }));
  add(scan(state, /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/gi, (m) => {
    const day = +m[1]; if (day < 1 || day > 31) return null;
    let y = yr, mo = +today.slice(5, 7);
    if (day < +today.slice(8, 10)) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
    const v = iso(y, mo, day);
    return v ? { raw: m[0], iso: v, kind: 'relative' } : null;
  }));
  return strip(out);
}

// ---- main extraction ----
const STOP_FIRST = new Set('New Los San Las Santa Hong Saint The This That These Those Please Meeting Meet Call Email Send Dear Hi Hello Hey Thanks Thank Regards Best Also And But Or If When Then Next Last Our My Your We They Review Schedule Book Finish Submit Prepare Pay Buy Fix Update Deliver Complete Ask Confirm Order Draft Write Share Check Reply Remind Contact Dont Note Re Fwd Subject From To Cc Team Sincerely Kind Warm'.split(' '));
const DETERMINERS = new Set(['The', 'This', 'That', 'These', 'Those', 'Our', 'My', 'Your', 'Their', 'His', 'Her', 'An']);
const STOP_ANY = new Set(['Avenue', 'Street', 'Road', 'Close', 'Lane', 'Drive', 'Boulevard', 'Crescent', 'Estate', 'Island', 'City', 'State', 'Park', 'Square', 'Market', 'Airport', 'Hospital', 'Hotel', 'Plaza', 'Mall', ...WD.map((w) => w[0].toUpperCase() + w.slice(1)), ...Object.keys(MONTHS).map((w) => w[0].toUpperCase() + w.slice(1)), 'Inc', 'Ltd', 'LLC', 'Corp', 'Labs', 'Group', 'Limited', 'Technologies', 'Systems', 'Bank', 'University']);
const ORG_SUFFIX = 'Inc|Ltd|LLC|Corp|Corporation|Co|Company|Labs|Group|GmbH|Limited|Technologies|Systems|Bank|Foundation|University|Agency|Studio|Partners';

const CUR = { '$': 'USD', usd: 'USD', usdc: 'USDC', usdt: 'USDT', eur: 'EUR', gbp: 'GBP', ngn: 'NGN', dollar: 'USD', dollars: 'USD', naira: 'NGN', euro: 'EUR', euros: 'EUR' };
const MULT = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
const num = (s) => parseFloat(String(s).replace(/,+$/, '').replace(/,/g, ''));

function toTime(m) {
  let h = +m[1], min = m[2] ? +m[2] : 0; const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return pad(h) + ':' + pad(min);
}

function splitSentences(text) {
  const P = '\u0001';
  let t = text.replace(/\b(Mr|Mrs|Ms|Dr|Prof|e\.g|i\.e|vs)\./g, '$1' + P);
  const marks = [...t.matchAll(/(?:^|\s)(\d{1,2})[.)]\s+(?=[A-Z])/g)];
  let expect = 1; const cuts = [];
  for (const mk of marks) if (+mk[1] === expect) { cuts.push(mk); expect++; }
  for (const mk of cuts.reverse()) t = t.slice(0, mk.index) + '\n' + t.slice(mk.index + mk[0].length);
  t = t.replace(/\s+[-*]\s+(?=[A-Z])/g, '\n');
  return t.split(/(?<=[.!?])\s+(?=[A-Z0-9\[])|\n+/).map((s) => s.replace(new RegExp(P, 'g'), '.').trim()).filter(Boolean);
}

const VERBS = 'meet|call|email|send|schedule|book|finish|submit|review|prepare|pay|buy|fix|update|deliver|complete|ask|confirm|order|draft|write|share|check|reply|contact|arrange|renew|cancel|sign|upload|publish|plan|test|deploy|ship|invite|print|pick up|follow up|remind|organi[sz]e|read';
const IMPERATIVE = new RegExp('^(?:please\\s+)?(?:(?:-\\s*)?\\[[ x]?\\]\\s*)?(?:' + VERBS + ')\\b', 'i');
const TRIGGER = /\b(need(?:s)? to|has to|have to|must|should|will|shall|to-?do|action item|remember to|don't forget|do not forget|make sure|let's|please|follow up|remind me)\b/i;
const VERB_ANY = new RegExp('\\b(?:' + VERBS + ')\\b', 'i');

function extractTasks(text, today) {
  const tasks = [];
  const clauseRe = new RegExp('\\s+(?:and|then|also)\\s+(?=(?:please\\s+)?(?:remind me to\\s+)?(?:' + VERBS + ')\\b)', 'i');
  const parts = splitSentences(text).flatMap((x) => x.split(clauseRe));
  for (const orig of parts) {
    const isChecklist = /^\s*(?:-\s*)?\[[ x]?\]/i.test(orig) || /^\s*(?:to-?do|action)\s*:/i.test(orig);
    const s = orig.replace(/^[A-Za-z ]{1,25}:\s+(?=\S)/, (m) => (isChecklist ? m : '')).trim();
    const nameTo = new RegExp('^@?[A-Z][a-z]+(?:\\s[A-Z][a-z]+)?\\s+to\\s+(?:' + VERBS + ')\\b');
    if (!(isChecklist || IMPERATIVE.test(s) || nameTo.test(s) || (TRIGGER.test(s) && VERB_ANY.test(s)))) continue;
    let ownerM = s.match(/^@?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:will|should|needs? to|has to|must|to|shall|is going to)\b/)
      || s.match(/\b(?:assign(?:ed)? to|owner|responsible)\s*:?\s*@?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i)
      || s.match(/(?<![\w.])@(\w+)/);
    let owner = ownerM ? ownerM[1] : null;
    if (owner && (STOP_FIRST.has(owner.split(' ')[0]) || /^(We|I|You|They|He|She|It)$/.test(owner))) owner = null;
    const dates = findDates({ t: s }, today);
    const dated = dates.find((d) => d.iso);
    const deadline = dated ? dated.iso : null;
    const priority = /\b(urgent|asap|immediately|critical|top priority|high priority|right away)\b/i.test(s) ? 'high'
      : /\b(low priority|when you can|whenever|eventually|no rush|nice to have)\b/i.test(s) ? 'low' : 'normal';
    const task = s.replace(/^\s*(?:-\s*)?\[[ x]?\]\s*/i, '').replace(/^\s*(?:to-?do|action)\s*:\s*/i, '').trim().slice(0, 240);
    tasks.push({ task, owner, deadline, priority });
  }
  return tasks;
}

function findNames(text) {
  const people = [];
  const re = /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+([A-Z][a-z'-]+(?:[ ][A-Z][a-z'-]+)?)/g;
  let m;
  while ((m = re.exec(text))) people.push(m[1]);
  const cleaned = text.replace(re, (x) => ' '.repeat(x.length));
  const seq = /\b[A-Z][a-z'-]+(?:[ ][A-Z][a-z'-]+){1,2}\b/g;
  while ((m = seq.exec(cleaned))) {
    let w = m[0].split(' ');
    if (DETERMINERS.has(w[0])) continue;
    while (w.length && STOP_FIRST.has(w[0])) w.shift();
    if (w.length < 2) continue;
    if (w.some((x) => STOP_ANY.has(x))) continue;
    people.push(w.join(' '));
  }
  return uniq(people);
}

export function extract(rawText, today) {
  today = today || new Date().toISOString().slice(0, 10);
  let text = norm(rawText).trim();
  let format = 'json';
  text = text.replace(/(?:^|\s)(?:format|output)\s*:\s*(json|csv|both)\b/i, (x, f) => { format = f.toLowerCase(); return ' '; }).trim();

  const state = { t: text };
  const emails = uniq(scan(state, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, (m) => m[0].toLowerCase().replace(/\.+$/, '')));
  const urls = uniq(scan(state, /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi, (m) => m[0].replace(/[.,;:!?]+$/, '')));
  const references = uniq([
    ...scan(state, /\b(?:INV|PO|ORD|REF|TKT|SO|CASE)[-#]?\d[\w-]{2,}\b/g, (m) => m[0]),
    ...scan(state, /\b[A-Z]{2,5}-\d{2,}\b/g, (m) => m[0]),
    ...scan(state, /#\d{3,}\b/g, (m) => m[0]),
  ]);
  scan(state, /\b\d{1,3}(?:\.\d{1,3}){3}\b/g, () => true);
  const dates = findDates(state, today);
  const times = strip(scan(state, /\b(?:(?:[01]?\d|2[0-3]):([0-5]\d)(?:\s?(am|pm))?|(?:1[0-2]|[1-9])\s?(am|pm))\b/gi, (m) => {
    const hm = m[0].match(/^(\d{1,2})(?::(\d{2}))?\s?(am|pm)?$/i);
    return hm ? { raw: m[0], time: toTime(hm) } : null;
  }));

  const moneyA = scan(state, /(\$|USDC|USDT|USD|EUR|GBP|NGN)\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|bn|million|billion|thousand)\b)?/gi, (m) => {
    const v = num(m[2]) * (m[3] ? MULT[m[3].toLowerCase()] : 1);
    return isNaN(v) ? null : { raw: m[0].trim(), value: v, currency: CUR[m[1].toLowerCase()] || m[1].toUpperCase() };
  });
  const moneyB = scan(state, /(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|bn|million|billion|thousand))?\s?(USDC|USDT|USD|EUR|GBP|NGN|dollars?|naira|euros?)\b/gi, (m) => {
    const v = num(m[1]) * (m[2] ? MULT[m[2].toLowerCase()] : 1);
    return isNaN(v) ? null : { raw: m[0].trim(), value: v, currency: CUR[m[3].toLowerCase()] || m[3].toUpperCase() };
  });
  const amounts = strip([...moneyA, ...moneyB]);
  const percentages = uniq(scan(state, /\b\d+(?:\.\d+)?\s?%/g, (m) => m[0].replace(/\s/g, '')));
  const quantities = strip(scan(state, /\b(\d+(?:\.\d+)?)\s?(kg|km|mg|lbs?|oz|miles?|hours?|hrs?|minutes?|mins?|days?|weeks?|months?|units?|pcs|pieces|items?|people|users|seats|licenses?|tickets?|orders?)\b/gi,
    (m) => ({ raw: m[0], value: parseFloat(m[1]), unit: m[2].toLowerCase() })));
  const phones = uniq(scan(state, /\+?\(?\d(?:[\s().-]{0,2}\d){7,14}/g, (m) => {
    const digits = m[0].replace(/\D/g, '');
    const ok = digits.length >= 8 && digits.length <= 15 && (/^\+/.test(m[0]) || /[\s().-]/.test(m[0]) || (/^0/.test(m[0]) && digits.length === 11));
    return ok ? (/^\+/.test(m[0]) ? '+' : '') + digits : null;
  }));

  // organisations then people (on the blanked text)
  const orgRe = new RegExp('\\b((?:(?:[A-Z][\\w\'-]*|&)[ ]){1,4}(?:' + ORG_SUFFIX + ')\\b)', 'g');
  const orgs = [];
  const forNames = state.t.replace(orgRe, (x) => {
    let w = x.split(' ');
    while (w.length > 1 && STOP_FIRST.has(w[0])) w.shift();
    orgs.push(w.join(' '));
    return ' '.repeat(x.length);
  });
  const organizations = uniq(orgs);

  const tasks = extractTasks(text, today);
  let people = findNames(forNames);
  for (const t of tasks) if (t.owner && !people.some((p) => p.split(' ').includes(t.owner))) people.push(t.owner);
  people = uniq(people);

  const data = {
    people, organizations, emails, phones, urls,
    dates, times, amounts, percentages, quantities, references, tasks,
  };
  return { data, format, today };
}

// ---- output ----
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(d) {
  const rows = [['type', 'value', 'normalized', 'extra']];
  d.people.forEach((x) => rows.push(['person', x, '', '']));
  d.organizations.forEach((x) => rows.push(['organization', x, '', '']));
  d.emails.forEach((x) => rows.push(['email', x, '', '']));
  d.phones.forEach((x) => rows.push(['phone', x, x, '']));
  d.urls.forEach((x) => rows.push(['url', x, '', '']));
  d.dates.forEach((x) => rows.push(['date', x.raw, x.iso || '', x.kind + (x.note ? ': ' + x.note : '')]));
  d.times.forEach((x) => rows.push(['time', x.raw, x.time, '']));
  d.amounts.forEach((x) => rows.push(['amount', x.raw, x.value, x.currency]));
  d.percentages.forEach((x) => rows.push(['percentage', x, x.replace('%', ''), '']));
  d.quantities.forEach((x) => rows.push(['quantity', x.raw, x.value, x.unit]));
  d.references.forEach((x) => rows.push(['reference', x, '', '']));
  d.tasks.forEach((x) => rows.push(['task', x.task, x.deadline || '', 'owner=' + (x.owner || '') + '; priority=' + x.priority]));
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export function run(raw, today) {
  if (!norm(raw).trim()) {
    return 'DataDistill received an empty order. Paste any messy text (notes, emails, messages, invoices) and optionally add "Format: json", "Format: csv" or "Format: both".';
  }
  const { data, format, today: ref } = extract(String(raw).slice(0, 100000), today);
  const seen = new Set();
  data.tasks = data.tasks.filter((t) => { const k = t.task + '|' + t.deadline; if (seen.has(k)) return false; seen.add(k); return true; });
  let truncated = false;
  for (const k of Object.keys(data)) if (data[k].length > 200) { data[k] = data[k].slice(0, 200); truncated = true; }
  const counts = {};
  let total = 0;
  for (const [k, v] of Object.entries(data)) { counts[k] = v.length; total += v.length; }
  const notes = [
    'Extraction is rule-based. Names and organisations are detected by pattern and can include false positives; check them.',
    'Relative dates (tomorrow, Friday, next week) are resolved against reference_date to the nearest upcoming day.',
  ];
  if (truncated) notes.push('Very large input: each list was capped at 200 items.');
  if (!total) notes.push('Nothing structured was found. Include names, dates, amounts, emails, phone numbers or tasks.');
  const out = { meta: { agent: 'DataDistill', format, reference_date: ref, counts, notes }, ...data };
  const json = JSON.stringify(out, null, 2);
  if (format === 'csv') return toCsv(data);
  if (format === 'both') return '[JSON]\n' + json + '\n\n[CSV]\n' + toCsv(data);
  return json;
}
