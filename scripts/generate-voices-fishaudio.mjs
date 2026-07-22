#!/usr/bin/env node
// ─── generate-voices-fishaudio.mjs: character voices via Fish Audio ─────────
// Same output contract as the other two generate-voices scripts
// (audio/voices/<id>.m4a) so the app needs zero code changes. Used for Snape,
// Nick, and Hagrid — McGonagall/Dumbledore/Voldemort still run through the
// ElevenLabs script on Sean's own account.
//
// Requires FISHAUDIO_API_KEY in the environment (never hardcode it here).
//   export FISHAUDIO_API_KEY=...
//   node scripts/generate-voices-fishaudio.mjs --search "stern professor" --tag male   # find a reference_id
//   node scripts/generate-voices-fishaudio.mjs --sample <reference_id> "Some text"     # one-off preview clip
//   node scripts/generate-voices-fishaudio.mjs                # generate any missing cast lines
//   node scripts/generate-voices-fishaudio.mjs --force        # also overwrite clips that exist
//   node scripts/generate-voices-fishaudio.mjs --only snape,nick

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'audio', 'voices');
const API_KEY = process.env.FISHAUDIO_API_KEY;
// Free tier model — swap to 's1'/'s2-pro'/'s2.1-pro' if the account has paid credit.
const MODEL = process.env.FISHAUDIO_MODEL || 's2.1-pro-free';

if (!API_KEY) {
  console.error('❌ Set FISHAUDIO_API_KEY in your environment first (export FISHAUDIO_API_KEY=...). Never paste it into a file.');
  process.exit(1);
}

async function tts(referenceId, text) {
  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      model: MODEL,
    },
    body: JSON.stringify({
      text,
      reference_id: referenceId,
      format: 'mp3',
      mp3_bitrate: 128,
      normalize: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Fish Audio ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function searchModels({ title, tag, pageSize = 10 }) {
  const params = new URLSearchParams({ page_size: String(pageSize), sort_by: 'score' });
  if (title) params.set('title', title);
  if (tag) params.set('tag', tag);
  const res = await fetch(`https://api.fish.audio/model?${params}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`Fish Audio ${res.status} ${res.statusText}`);
  return res.json();
}

if (process.argv.includes('--search')) {
  const i = process.argv.indexOf('--search');
  const title = process.argv[i + 1];
  const tagIdx = process.argv.indexOf('--tag');
  const tag = tagIdx !== -1 ? process.argv[tagIdx + 1] : undefined;
  const data = await searchModels({ title, tag });
  console.log(`${data.total} match(es), showing ${data.items.length}:\n`);
  for (const m of data.items) {
    console.log(`${m._id}  "${m.title}"  [${(m.tags || []).join(', ')}]  ${(m.languages || []).join('/')}  ♥${m.like_count}`);
    if (m.description) console.log(`   ${m.description.slice(0, 140)}`);
  }
  process.exit(0);
}

if (process.argv.includes('--sample')) {
  const i = process.argv.indexOf('--sample');
  const referenceId = process.argv[i + 1];
  const text = process.argv[i + 2] || 'Wrong. Do concentrate.';
  const audio = await tts(referenceId, text);
  const out = path.join('/tmp', `sample-${referenceId}.mp3`);
  writeFileSync(out, audio);
  console.log(`✅ Sample saved to ${out}`);
  process.exit(0);
}

// ─── cast: character → Fish Audio reference_id ──────────────────────────────
// Fill in once a voice is picked via --search / --sample.
const CAST = {
  snape: process.env.FISHAUDIO_SNAPE_ID || '',
  nick: process.env.FISHAUDIO_NICK_ID || '',
  hagrid: process.env.FISHAUDIO_HAGRID_ID || '',
};

// [id, character, spokenText] — name-free (see scripts/generate-voices.mjs
// header for why); the app falls back to tuned Web Speech with the real
// {name} if a clip is ever missing.
const LINES = [
  ['grade-p-snape', 'snape', 'Poor. I confess myself… entirely unsurprised.'],
  ['grade-d-snape', 'snape', 'Dreadful. Tell me — did you open the book at all, or merely admire the cover?'],
  ['grade-t-snape', 'snape', 'Troll. Astonishing. I did not think it could be done.'],
  ['first-wrong-snape', 'snape', 'Wrong. Do concentrate.'],

  ['grade-a-nick', 'nick', 'Perfectly respectable. Not everyone can be top of the class — or keep their head.'],
  ['first-wrong-nick', 'nick', "Don't lose your head over one mistake — I speak from experience."],

  ['grade-e-hagrid', 'hagrid', 'Knew yeh had it in yeh! Great one, that was!'],
  ['grade-t-hagrid', 'hagrid', "Don' worry. Firs' tries never count. Have a rock cake an' go again."],
  ['streak-3-hagrid', 'hagrid', 'Three in a row! Yer a natural, no mistake!'],
  ['card-legendary-hagrid', 'hagrid', "Blimey — I haven't seen a card like that since I was a boy!"],
  ['journey-intro-1', 'hagrid', "Blimey! Welcome ter Hogwarts. I'm Hagrid — I'll show yeh the ropes."],
  ['journey-intro-2', 'hagrid', "Yeh're here ter learn. Each Year has a few lessons — ten questions apiece. Get six right an' yeh pass."],
  ['journey-intro-3', 'hagrid', "Finish all a Year's lessons an' yeh can sit the Final Exam. Pass that, an' yeh move up a Year."],
  ['journey-intro-4', 'hagrid', "Yeh'll earn spells along the way. Tap one ter see what it does, then tap again ter cast it — handy in a tight spot."],
  ['journey-intro-5', 'hagrid', "Every answer earns House Points fer the House Cup. An' keep yer eyes peeled — the Golden Snitch an' Hedwig turn up now an' then. Catch 'em fer a reward!"],
  ['journey-intro-6', 'hagrid', 'Right then. Off yeh go. Make us proud.'],
  ['first-year-done-1', 'hagrid', "Yeh did it! A whole Year behind yeh. Onwards — it only gets more int'restin' from here."],
  ['quick-intro-1', 'hagrid', "Oh, just after a quick round, are yeh? Ten questions, pick yer difficulty, an' off yeh go."],
  ['quick-intro-2', 'hagrid', "Keep an eye out fer the Golden Snitch an' Hedwig — catch 'em fer a bonus spell charge or two."],
  ['quick-intro-3', 'hagrid', "An' if yeh declare a House up top, yeh'll get their special perk fer this round. Go on then — good luck!"],
];

mkdirSync(OUT_DIR, { recursive: true });

const FORCE = process.argv.includes('--force');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx !== -1 ? (process.argv[onlyIdx + 1] || '').split(',').filter(Boolean) : null;

let ok = 0, failed = 0, skipped = 0;
for (const [id, char, text] of LINES) {
  const referenceId = CAST[char];
  if (!referenceId) { skipped++; continue; } // no voice picked for this character yet
  if (ONLY && !ONLY.includes(char)) { skipped++; continue; }
  const mp3 = path.join(OUT_DIR, `${id}.mp3`);
  const m4a = path.join(OUT_DIR, `${id}.m4a`);
  if (existsSync(m4a) && !FORCE) { skipped++; continue; } // already generated
  try {
    const audio = await tts(referenceId, text);
    writeFileSync(mp3, audio);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', mp3, m4a]);
    if (existsSync(mp3)) rmSync(mp3);
    console.log(`✅ ${id}`);
    ok++;
  } catch (e) {
    console.error(`❌ FAILED: ${id} — ${e.message}`);
    failed++;
  }
}

console.log(`\n✅ Generated ${ok} clip(s) into ${path.relative(process.cwd(), OUT_DIR)}/`);
if (failed) console.log(`❌ ${failed} failed`);
if (skipped) console.log(`⏭️  ${skipped} skipped (no voice picked yet, or filtered by --only, or already exists)`);
