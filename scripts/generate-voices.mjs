#!/usr/bin/env node
// ─── generate-voices.mjs: pre-record character dialogue with macOS `say` ────
// No API keys, no network, no npm deps — uses the system's built-in `say`
// (TTS) and `afconvert` (format conversion) binaries. Re-run this whenever a
// line's spoken text below changes; it overwrites audio/voices/<id>.m4a.
//
// These lines are deliberately name-free ("spoken" variants) — the app's
// dialogue.js interpolates the player's real {name} into the ON-SCREEN text,
// but a fixed recorded clip can't say an arbitrary name, so the audio omits
// it while the text bubble keeps it. If a clip is ever missing (id typo, not
// yet generated), the app falls back to tuned Web Speech with the real name.
//
// Usage: node scripts/generate-voices.mjs [--voice-list]
//   --voice-list   just print the installed `say` voices and exit (for
//                  picking replacements if a cast voice isn't installed)

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'audio', 'voices');

if (process.argv.includes('--voice-list')) {
  execFileSync('say', ['-v', '?'], { stdio: 'inherit' });
  process.exit(0);
}

// ─── voice cast (installed macOS system voices — no downloads needed) ──────
const VOICE_CAST = {
  hagrid:     { voice: 'Rocko (English (UK))',   rate: 155 }, // big, warm, unhurried
  mcgonagall: { voice: 'Shelley (English (UK))', rate: 205 }, // crisp, brisk, precise
  dumbledore: { voice: 'Grandpa (English (UK))', rate: 150 }, // warm, elderly, measured
  snape:      { voice: 'Reed (English (UK))',    rate: 158 }, // low, deliberate, dry
  hat:        { voice: 'Eddy (English (UK))',    rate: 165 }, // thoughtful, a little strange
  voldemort:  { voice: 'Daniel',                 rate: 138 }, // cold, slow, formal
  nick:       { voice: 'Sandy (English (UK))',   rate: 185 }, // light, airy — a ghost
};

// [id, character, spokenText] — spokenText omits {name} (see header note).
const LINES = [
  // grades
  ['grade-o-mcgonagall', 'mcgonagall', 'Outstanding. I see no reason whatsoever to hide my delight.'],
  ['grade-o-dumbledore', 'dumbledore', 'I have rarely seen such a performance. Curious. Very well done indeed.'],
  ['grade-e-mcgonagall', 'mcgonagall', 'Exceeds Expectations. Keep this up, and your house will be very proud.'],
  ['grade-e-hagrid', 'hagrid', 'Knew yeh had it in yeh! Great one, that was!'],
  ['grade-a-mcgonagall', 'mcgonagall', 'Acceptable. Which, at Hogwarts, is no small thing. More library, less Quidditch.'],
  ['grade-a-nick', 'nick', 'Perfectly respectable. Not everyone can be top of the class — or keep their head.'],
  ['grade-p-snape', 'snape', 'Poor. I confess myself… entirely unsurprised.'],
  ['grade-p-mcgonagall', 'mcgonagall', 'Poor. I expect better — because I know you are capable of better.'],
  ['grade-d-snape', 'snape', 'Dreadful. Tell me — did you open the book at all, or merely admire the cover?'],
  ['grade-t-snape', 'snape', 'Troll. Astonishing. I did not think it could be done.'],
  ['grade-t-hagrid', 'hagrid', "Don' worry. Firs' tries never count. Have a rock cake an' go again."],

  // streaks
  ['streak-3-hagrid', 'hagrid', 'Three in a row! Yer a natural, no mistake!'],
  ['streak-5-mcgonagall', 'mcgonagall', 'Five consecutive correct answers. I am rarely impressed. Consider me impressed.'],
  ['streak-8-dumbledore', 'dumbledore', 'Remarkable. Simply remarkable.'],

  // first wrong answer
  ['first-wrong-nick', 'nick', "Don't lose your head over one mistake — I speak from experience."],
  ['first-wrong-snape', 'snape', 'Wrong. Do concentrate.'],

  // year pass / fail
  ['year-pass-mcgonagall', 'mcgonagall', 'You have passed the year. Report to the feast — and do try not to look smug.'],
  ['year-fail-mcgonagall', 'mcgonagall', 'You shall repeat the year. There is no shame in that — only in giving up.'],

  // O.W.L.s
  ['owl-intro-mcgonagall', 'mcgonagall', 'These are your O.W.L.s. I expect nothing less than your very best.'],

  // perfect round
  ['perfect-round-dumbledore', 'dumbledore', 'Ten out of ten. I award you the rarest thing I have — my full attention.'],

  // sorting
  ['sorting-greet-hat', 'hat', 'Ah. Plenty in this head, I see. Let us look closer…'],

  // the duel
  ['duel-start-voldemort', 'voldemort', 'So. They send a child to face Lord Voldemort.'],
  ['duel-win-dumbledore', 'dumbledore', 'It is our choices that show what we truly are. You chose well.'],
  ['duel-loss-voldemort', 'voldemort', 'Crawl back to your castle. We shall finish this another day.'],
  ['duel-hit-voldemort-1', 'voldemort', 'You DARE?!'],
  ['duel-hit-voldemort-2', 'voldemort', 'A lucky strike. Nothing more.'],

  // legendary card reveal
  ['card-legendary-dumbledore', 'dumbledore', 'A legendary card? How extraordinary. Chocolate Frogs never cease to surprise even me.'],
  ['card-legendary-hagrid', 'hagrid', "Blimey — I haven't seen a card like that since I was a boy!"],

  // guide.js walkthrough beats
  ['journey-intro-1', 'hagrid', "Blimey! Welcome ter Hogwarts. I'm Hagrid — I'll show yeh the ropes."],
  ['journey-intro-2', 'hagrid', "Yeh're here ter learn. Each Year has a few lessons — ten questions apiece. Get six right an' yeh pass."],
  ['journey-intro-3', 'hagrid', "Finish all a Year's lessons an' yeh can sit the Final Exam. Pass that, an' yeh move up a Year."],
  ['journey-intro-4', 'hagrid', "Yeh'll earn spells along the way. Tap one ter see what it does, then tap again ter cast it — handy in a tight spot."],
  ['journey-intro-5', 'hagrid', "Every answer earns House Points fer the House Cup. An' keep yer eyes peeled — the Golden Snitch an' Hedwig turn up now an' then. Catch 'em fer a reward!"],
  ['journey-intro-6', 'hagrid', 'Right then. Off yeh go. Make us proud.'],
  ['first-exam-1', 'mcgonagall', 'This is your Final Exam — twenty questions, and fourteen correct to pass. Do concentrate.'],
  ['first-year-done-1', 'hagrid', "Yeh did it! A whole Year behind yeh. Onwards — it only gets more int'restin' from here."],
  ['journey-complete-1', 'dumbledore', 'Seven years. You have learned that our choices reveal who we truly are. Hogwarts will always be here to welcome you home.'],
];

mkdirSync(OUT_DIR, { recursive: true });

let ok = 0, failed = 0, skippedCast = 0;
for (const [id, char, text] of LINES) {
  const cast = VOICE_CAST[char];
  if (!cast) {
    console.warn(`⚠️  no voice cast for character "${char}" (line "${id}") — skipped`);
    skippedCast++;
    continue;
  }
  const aiff = path.join(OUT_DIR, `${id}.aiff`);
  const m4a = path.join(OUT_DIR, `${id}.m4a`);
  try {
    execFileSync('say', ['-v', cast.voice, '-r', String(cast.rate), '-o', aiff, text]);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, m4a]);
    if (existsSync(aiff)) rmSync(aiff);
    ok++;
  } catch (e) {
    console.error(`❌ FAILED: ${id} — ${e.message}`);
    failed++;
  }
}

console.log(`\n✅ Generated ${ok} voice clips into ${path.relative(process.cwd(), OUT_DIR)}/`);
if (failed) console.log(`❌ ${failed} failed`);
if (skippedCast) console.log(`⚠️  ${skippedCast} skipped (no voice cast)`);
