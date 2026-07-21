#!/usr/bin/env node
// ─── generate-voices-elevenlabs.mjs: real AI character voices via ElevenLabs ─
// Pilot: Hagrid only. Same output contract as scripts/generate-voices.mjs
// (audio/voices/<id>.m4a) so the app needs zero code changes — this just
// swaps the recording source for lines that have a CAST entry below.
//
// Requires ELEVENLABS_API_KEY in the environment (never hardcode it here).
//   export ELEVENLABS_API_KEY=sk_...
//   node scripts/generate-voices-elevenlabs.mjs              # generate any missing cast lines
//   node scripts/generate-voices-elevenlabs.mjs --force      # also overwrite clips that exist
//   node scripts/generate-voices-elevenlabs.mjs --only mcgonagall,voldemort  # limit to characters
//   node scripts/generate-voices-elevenlabs.mjs --list-voices # list your ElevenLabs voices
//   node scripts/generate-voices-elevenlabs.mjs --sample "voice_id" "Some text"  # one-off test clip

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'audio', 'voices');
const API_KEY = process.env.ELEVENLABS_API_KEY;

if (!API_KEY) {
  console.error('❌ Set ELEVENLABS_API_KEY in your environment first (export ELEVENLABS_API_KEY=...). Never paste it into a file.');
  process.exit(1);
}

async function tts(voiceId, text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

if (process.argv.includes('--list-voices')) {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': API_KEY } });
  const data = await res.json();
  for (const v of data.voices || []) console.log(`${v.voice_id}  ${v.name}  (${v.labels?.gender || '?'}, ${v.labels?.accent || '?'})`);
  process.exit(0);
}

if (process.argv.includes('--sample')) {
  const [, , , voiceId, text] = process.argv;
  const mp3 = await tts(voiceId, text || 'Blimey! Welcome ter Hogwarts.');
  const out = path.join('/tmp', `sample-${voiceId}.mp3`);
  writeFileSync(out, mp3);
  console.log(`✅ Sample saved to ${out}`);
  process.exit(0);
}

// ─── cast: character → ElevenLabs voice_id ──────────────────────────────────
// Add more characters here as their voices are chosen. NOTE: Hagrid's voice_id
// is from the original ElevenLabs account; the others are from the second one.
// A voice_id only resolves against the account its API key belongs to, so use
// --only to scope a run to the characters that match the key you're passing.
const CAST = {
  hagrid: 'aJ3UwUNrWz1N1aRzIawM',
  dumbledore: 'UCSBEg06RtllRTPBMOLM',
  voldemort: 'cvekPI8zzFdYmDPcvFn0',
  mcgonagall: 'CZk08oKhbaQQpNxN8UtW',
};

// [id, character, spokenText] — name-free (see scripts/generate-voices.mjs
// header for why); the app falls back to tuned Web Speech with the real
// {name} if a clip is ever missing.
const LINES = [
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

  ['grade-o-mcgonagall', 'mcgonagall', 'Outstanding. I see no reason whatsoever to hide my delight.'],
  ['grade-e-mcgonagall', 'mcgonagall', 'Exceeds Expectations. Keep this up, and your house will be very proud.'],
  ['grade-a-mcgonagall', 'mcgonagall', 'Acceptable. Which, at Hogwarts, is no small thing. More library, less Quidditch.'],
  ['grade-p-mcgonagall', 'mcgonagall', 'Poor. I expect better — because I know you are capable of better.'],
  ['streak-5-mcgonagall', 'mcgonagall', 'Five consecutive correct answers. I am rarely impressed. Consider me impressed.'],
  ['year-pass-mcgonagall', 'mcgonagall', 'You have passed the year. Report to the feast — and do try not to look smug.'],
  ['year-fail-mcgonagall', 'mcgonagall', 'You shall repeat the year. There is no shame in that — only in giving up.'],
  ['owl-intro-mcgonagall', 'mcgonagall', 'These are your O.W.L.s. I expect nothing less than your very best.'],
  ['first-exam-1', 'mcgonagall', 'This is your Final Exam — twenty questions, and fourteen correct to pass. Do concentrate.'],

  ['grade-o-dumbledore', 'dumbledore', 'I have rarely seen such a performance. Curious. Very well done indeed.'],
  ['streak-8-dumbledore', 'dumbledore', 'Remarkable. Simply remarkable.'],
  ['perfect-round-dumbledore', 'dumbledore', 'Ten out of ten. I award you the rarest thing I have — my full attention.'],
  ['duel-win-dumbledore', 'dumbledore', 'It is our choices that show what we truly are. You chose well.'],
  ['card-legendary-dumbledore', 'dumbledore', 'A legendary card? How extraordinary. Chocolate Frogs never cease to surprise even me.'],
  ['journey-complete-1', 'dumbledore', 'Seven years. You have learned that our choices reveal who we truly are. Hogwarts will always be here to welcome you home.'],

  ['duel-start-voldemort', 'voldemort', 'So. They send a child to face Lord Voldemort.'],
  ['duel-loss-voldemort', 'voldemort', 'Crawl back to your castle. We shall finish this another day.'],
  ['duel-hit-voldemort-1', 'voldemort', 'You DARE?!'],
  ['duel-hit-voldemort-2', 'voldemort', 'A lucky strike. Nothing more.'],
];

mkdirSync(OUT_DIR, { recursive: true });

// --force overwrites clips that already exist (e.g. replacing the older macOS
// `say` recordings); without it, existing clips are skipped so a re-run to add
// a few new lines never re-bills the ones already generated.
const FORCE = process.argv.includes('--force');
// --only <a,b> limits the run to those characters — keeps a run scoped to the
// account whose key you're passing, and avoids re-billing everyone else.
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx !== -1 ? (process.argv[onlyIdx + 1] || '').split(',').filter(Boolean) : null;

let ok = 0, failed = 0, skipped = 0;
for (const [id, char, text] of LINES) {
  const voiceId = CAST[char];
  if (!voiceId) { skipped++; continue; } // character not yet approved for ElevenLabs
  if (ONLY && !ONLY.includes(char)) { skipped++; continue; }
  const mp3 = path.join(OUT_DIR, `${id}.mp3`);
  const m4a = path.join(OUT_DIR, `${id}.m4a`);
  if (existsSync(m4a) && !FORCE) { skipped++; continue; } // already generated — avoid re-billing
  try {
    const audio = await tts(voiceId, text);
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
if (skipped) console.log(`⏭️  ${skipped} skipped (character not yet in CAST)`);
