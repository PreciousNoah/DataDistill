import assert from 'node:assert';
import { generate, parseInput } from './generator.js';

const full = `Name: API Debugger
Does: Takes broken JSON or API error responses and returns a diagnosis and a corrected version. Built for developers.
Input: broken JSON; an API error message
Output: diagnosis; corrected JSON
Price: $0.05
Delivery: 30 min
Limitations: Cannot fix semantic errors
Tags: Development & Code`;
const r = generate(full);
assert(r.report.includes('LISTING PACK for: API Debugger'));
assert.equal(r.form.price, '0.05');
assert.equal(r.form.slaMin, 30);
assert(r.tags.includes('Development & Code'));
assert(/^[\x00-\x7F]*$/.test(r.report), 'ascii only');

const bare = generate('A bot that summarises long crypto whale alerts into short daily emails for traders and explains each move clearly.');
assert(bare.warnings.length > 0);
assert(bare.report.includes('[9] CHECKLIST'));

assert.equal(parseInput('').labelled, 0);
assert(generate('').report.length > 0);
const smart = generate('Name: Test \u201cBot\u201d \u2014 \ud83d\ude80\nDoes: does things for people who need things done quickly and well every day.');
assert(/^[\x00-\x7F]*$/.test(smart.report));
console.log('All tests passed');

// flattened input (buyer form removed line breaks)
const flat = generate('Name: Midnight Muse Does: Turns a messy brain-dump of ideas into three punchy, ready-to-post social media captions with hooks, hashtags and a suggested posting time. Built for indie creators and small brands. Input: a rough idea or brain-dump; target platform; desired tone Output: three captions; hashtag set; best posting time; one hook line Price: 0.05 USDC Delivery: 20 min Limitations: English only; does not post on your behalf; no image generation Tags: Content & Creative Examples: - Launching a handmade candle shop, cozy autumn vibe, Instagram, playful tone - Our SaaS just hit 1000 users, LinkedIn, humble but excited');
assert(flat.report.includes('LISTING PACK for: Midnight Muse\n'));
assert.equal(flat.form.price, '0.05');
assert.equal(flat.form.slaMin, 20);
assert(flat.report.includes('1. Launching a handmade candle shop, cozy autumn vibe, Instagram, playful tone\n2. Our SaaS'));
assert(flat.report.includes('- English only\n- does not post on your behalf'));
assert(!flat.report.includes('missing'));
console.log('Flattened-input tests passed');

// ---- regression tests from stress run ----
const lf = generate('name: PriceWatch does: Tracks token prices and alerts you when a token moves more than 5% in an hour so traders never miss a pump. input: token symbol; threshold output: alert summary price: $0.10 delivery: 2 hours tags: DeFi & Trading');
assert(lf.report.includes('LISTING PACK for: PriceWatch\n'));
assert.equal(lf.form.price, '0.10');
assert.equal(lf.form.slaHr, 2);
assert(lf.tags.includes('DeFi & Trading'));

const pr = generate('I built an agent that reads GitHub pull requests and writes a plain English changelog for each release. Buyers paste the PR list and get a changelog back in about 15 minutes for 0.50 USDC.');
assert.equal(pr.form.price, '0.50');
assert.equal(pr.form.slaMin, 15);
assert(!pr.report.includes('0.\n') && !pr.report.includes('- 50 USDC.'));

assert(generate('Meme Maker').report.includes('LISTING PACK for: Meme Maker\n'));

const ng = generate('Name: RocketBot\nDoes: Takes goals and returns a roadmap with milestones and risks for founders every single time.\nPrice: \u20a6500');
assert(ng.warnings.some((w) => /not in USDC/.test(w)));

const nt = generate('Name: Doc Helper\nDoes: Explains legal documents. Note: not legal advice. Summarises clauses, flags unusual terms and lists obligations.');
assert(nt.report.includes('- Not legal advice.'));
assert(!/FEATURES[\s\S]*Note:[\s\S]*HOW TO USE/.test(nt.report));

const ln = generate('Name: The Ultimate Super Duper Mega Automated Research and Analysis Assistant Bot\nDoes: Does research for you across many topics and returns a nicely organised brief with sources.');
assert(ln.form.serviceName.length <= 40 && !/\s$/.test(ln.form.serviceName));
assert(ln.warnings.some((w) => /name is long/.test(w)));

assert(generate('Name: A\nName: B\nDoes: One thing done well for many people who need it done quickly today.').report.includes('LISTING PACK for: A\n'));
console.log('AgentScribe stress regression tests passed');

const tg = generate('name: PriceWatch does: Tracks token prices and alerts you when a token moves more than 5% in an hour so traders never miss a pump. input: token symbol output: alert summary price: $0.10 delivery: 2 hours tags: DeFi & Trading');
assert.deepEqual(tg.tags, ['DeFi & Trading']);
assert.deepEqual(generate('Name: X\nDoes: Tracks token prices for traders every hour with alerts.\nTags: defi &amp; trading, DeFi & Trading').tags, ['defi & trading']);
console.log('Tag dedupe tests passed');
