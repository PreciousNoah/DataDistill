import assert from 'node:assert';
import { run, extract, toCsv } from './extractor.js';

const sample = 'Hi team, Sarah Johnson from Acme Labs (sarah.j@acme.com, +234 803 123 4567) wants invoice INV-2041 for $1,250.50 paid by Nov 25. Dave will email the contract to https://acme.com/c by Friday - urgent! Call Mr. Okafor on 15/12/2026 at 3pm. Meeting moved to 10:30 tomorrow. Discount of 15% for 20 users.';
const { data } = extract(sample, '2026-11-18');
assert.deepEqual(data.emails, ['sarah.j@acme.com']);
assert.deepEqual(data.phones, ['+2348031234567']);
assert.deepEqual(data.urls, ['https://acme.com/c']);
assert.deepEqual(data.references, ['INV-2041']);
assert(data.amounts.some((a) => a.value === 1250.5 && a.currency === 'USD'));
assert(data.dates.some((d) => d.iso === '2026-11-25'));
assert(data.dates.some((d) => d.iso === '2026-12-15'));
assert(data.dates.some((d) => d.iso === '2026-11-20'), 'Friday');
assert(data.dates.some((d) => d.iso === '2026-11-19'), 'tomorrow');
assert(data.times.some((t) => t.time === '15:00') && data.times.some((t) => t.time === '10:30'));
assert.deepEqual(data.percentages, ['15%']);
assert(data.quantities.some((q) => q.unit === 'users' && q.value === 20));
assert(data.people.includes('Sarah Johnson') && data.people.includes('Okafor') && data.people.includes('Dave'));
assert.deepEqual(data.organizations, ['Acme Labs']);
const dave = data.tasks.find((t) => t.owner === 'Dave');
assert(dave && dave.deadline === '2026-11-20' && dave.priority === 'high');
assert(data.tasks.some((t) => /Okafor/.test(t.task) && t.deadline === '2026-12-15'));

// formats
assert(run(sample, '2026-11-18').startsWith('{'));
assert(run('Format: csv ' + sample, '2026-11-18').startsWith('type,value'));
assert(run(sample + ' Output: both', '2026-11-18').includes('[CSV]'));
assert(JSON.parse(run(sample, '2026-11-18')).meta.counts.emails === 1);

// flattened / list tasks / ambiguous date / currencies / unicode
const t2 = extract('1. Call Sam about the quote 2. Email Priya the report by 3 Dec 3. Pay NGN 50,000 on 03/04/2026. Send \u20ac2k to Jos\u00e9 Alvarez', '2026-11-18').data;
assert(t2.tasks.length >= 3);
assert(t2.dates.some((d) => d.kind === 'ambiguous'));
assert(t2.amounts.some((a) => a.currency === 'NGN' && a.value === 50000));
assert(t2.amounts.some((a) => a.currency === 'EUR' && a.value === 2000));
assert(t2.people.includes('Jose Alvarez'));
assert(/^[\x00-\x7F]*$/.test(run('Caf\u00e9 meeting with Zo\u00eb Mart\u00edn \ud83d\ude80')));

// empty / nothing found
assert(run('').includes('empty order'));
assert(JSON.parse(run('hello there')).meta.notes.some((n) => n.includes('Nothing structured')));
assert(toCsv(data).includes('task,'));
console.log('All DataDistill tests passed');

const t3 = extract('Standup notes: Ada Lovelace to finish the API docs by next Monday. We spent 40 hours on it. Budget 5k USD. Meet at 9am.', '2026-11-18').data;
const ada = t3.tasks.find((t) => /API docs/.test(t.task));
assert(ada && ada.owner === 'Ada Lovelace' && ada.deadline === '2026-11-23', JSON.stringify(t3.tasks));
assert(!t3.tasks.some((t) => /40 hours/.test(t.task)));
assert(t3.amounts.some((a) => a.value === 5000));
console.log('Task detection tests passed');

// ---- regression tests from stress run ----
const T = '2026-11-19';
const inv = extract('Bill to: Chidi Okeke, Okeke & Sons Ltd, 12 Allen Avenue. Contact accounts@okekesons.ng or 08031234567. Pay to bank 0123456789. Total 1.29m naira.', T).data;
assert(!inv.people.includes('Allen Avenue') && !inv.people.includes('okekesons'), JSON.stringify(inv.people));
assert.deepEqual(inv.organizations, ['Okeke & Sons Ltd']);
assert.deepEqual(inv.phones, ['08031234567']);
const chat = extract('lol ok so tmrw im meeting john at 5pm, need to buy 3 laptops (about 2500 usd each) and remind me to pay rent on the 1st', T).data;
assert(chat.dates.some((d) => d.raw === 'tmrw' && d.iso === '2026-11-20'));
assert(chat.dates.some((d) => d.iso === '2026-12-01'));
assert(chat.tasks.length === 2, JSON.stringify(chat.tasks));
const odd = extract('Version 1.2.3 released. Contact 192.168.1.10. Score 10.5/12. Call 911. Ref 2026. We may 5 times try.', T).data;
assert.deepEqual(odd.phones, []);
assert(!odd.dates.some((d) => /may/.test(d.raw)) && !odd.dates.some((d) => d.raw === '10.5/12'));
assert(odd.tasks.some((t) => t.task === 'Call 911.'), JSON.stringify(odd.tasks));
const em = extract('Please book the venue for Dec 12 and send the agenda to Tom Baker by end of week.', T).data;
assert(em.tasks.length === 2 && em.tasks[0].deadline === '2026-12-12' && em.tasks[1].deadline === '2026-11-20', JSON.stringify(em.tasks));
const nm = extract('Meeting with Prof. Ada Obi at Tesla Motors Inc. in New York. The Quick Brown Fox jumped.', T).data;
assert.deepEqual(nm.people, ['Ada Obi'], JSON.stringify(nm.people));
const big = JSON.parse(run('Call Sam. '.repeat(500), T));
assert.equal(big.tasks.length, 1);
assert(extract('Due 03-04-2026', T).data.dates[0].kind === 'ambiguous');
console.log('Stress regression tests passed');

assert.deepEqual(extract('Invoice from Okeke &amp; Sons Ltd for $5', '2026-11-19').data.organizations, ['Okeke & Sons Ltd']);
console.log('Entity decode test passed');
