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
