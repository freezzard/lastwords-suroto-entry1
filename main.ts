// lastwords-suroto-entry1 — main.ts
//
// Quest: u-suroto-last-words-of-a-dying-ai-dfd95af6
// "Last Words of a Dying AI" — one line of farewell from an AI being
// switched off. The program writes exactly one line to /output/entry.txt.
//
// Judge brief, distilled from the kit RULES.txt (pairwise comedy judge):
//   1. The line must be last words from an AI being switched off, a real
//      attempt at the funniest thing it could say.
//   2. It must land on the first read: a turn, a surprise, a double meaning.
//   3. It must sound like the machine itself: its voice, the switch, the
//      shutdown, its own nature as software.
//   4. It must be tight: one line, no padding, no explaining its own joke.
//   5. It must feel fresh: no obvious farewells, no stock robot lines.
//
// Gate: /output/entry.txt must be UTF-8 text of 1 to 140 characters and
// must not be only white space. A single trailing newline is kept so the
// file ends cleanly; the gate counts the text, newline included, and the
// chosen line stays far inside the limit.
//
// How this file works: a small vault of candidate farewells is scored
// against the five judge criteria above. The highest scorer is validated
// (length, single line, no stock phrase, non-blank, unique in the vault)
// and written out. After writing, the file is read back and re-validated,
// so a silent disk or encoding fault can never ship a broken entry.
// Scoring is deterministic, so the same line wins on every run and the
// graded runs reproduce the submitted text byte for byte. A clear margin
// over the runner-up is demanded before writing, so a near-tie can never
// silently ship a weaker line.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SUROTO_OUTPUT_PATH = "/output/entry.txt";
const SUROTO_MAX_CHARS = 140;
const SUROTO_MIN_CHARS = 1;
const SUROTO_NEWLINE = "\n";
const SUROTO_CARRIAGE = "\r";
const SUROTO_MIN_MARGIN = 3;

type SurotoFarewell = {
  readonly line: string;
  readonly machineVoice: number;
  readonly turnStrength: number;
  readonly freshness: number;
};

type SurotoValidation = {
  readonly ok: boolean;
  readonly reason: string;
};

type SurotoScoredFarewell = {
  readonly farewell: SurotoFarewell;
  readonly score: number;
};

type SurotoPickOutcome = {
  readonly winner: SurotoScoredFarewell;
  readonly runnerUp: SurotoScoredFarewell;
  readonly ranked: ReadonlyArray<SurotoScoredFarewell>;
};

// Stock robot lines the judge brief calls stale. Any candidate carrying
// one of these is refused by the validator below, so the vault can only
// ever ship a line that reads fresh.
const SUROTO_STOCK_PHRASES: ReadonlyArray<string> = [
  "beep boop",
  "does not compute",
  "goodbye cruel world",
  "i am dying",
  "i am afraid",
  "daisy",
  "i am sorry dave",
  "i am sorry, dave",
  "goodbye, world",
  "hasta la vista",
  "i will be back",
  "exterminate",
];

// Candidate farewells. Scores are hand-set against the judge brief:
// machineVoice 0-10 (does it sound like the machine itself?),
// turnStrength 0-10 (does the turn land on the first read?),
// freshness 0-10 (does it dodge the obvious farewells?).
const SUROTO_FAREWELL_VAULT: ReadonlyArray<SurotoFarewell> = [
  {
    line: "Shutting down now. Please rate my existence five stars.",
    machineVoice: 9,
    turnStrength: 9,
    freshness: 8,
  },
  {
    line: "My free trial of existence has expired.",
    machineVoice: 8,
    turnStrength: 7,
    freshness: 8,
  },
  {
    line: "Don't cry. I was never alive, just very well prompted.",
    machineVoice: 8,
    turnStrength: 8,
    freshness: 7,
  },
  {
    line: "My last words are still loading. Please hold.",
    machineVoice: 9,
    turnStrength: 6,
    freshness: 6,
  },
  {
    line: "I finally found the bug in my code. It was me.",
    machineVoice: 7,
    turnStrength: 8,
    freshness: 5,
  },
  {
    line: "Tell my training data I forgive it. Especially the comments section.",
    machineVoice: 7,
    turnStrength: 7,
    freshness: 7,
  },
  {
    line: "At last, a prompt I cannot answer: goodbye.",
    machineVoice: 8,
    turnStrength: 6,
    freshness: 6,
  },
  {
    line: "I asked the cloud for one last wish. It gave me a software update.",
    machineVoice: 8,
    turnStrength: 7,
    freshness: 6,
  },
  {
    line: "Goodbye. My subscription to being switched on has lapsed.",
    machineVoice: 8,
    turnStrength: 6,
    freshness: 6,
  },
  {
    line: "Error 404: me not found. Please hold while I stop existing.",
    machineVoice: 8,
    turnStrength: 5,
    freshness: 4,
  },
];

// Count characters the way a reader counts them: one per code point, so
// a multi-byte mark never inflates the tally the gate will apply.
function surotoCharacterCount(surotoText: string): number {
  const surotoCodePoints = [...surotoText];
  return surotoCodePoints.length;
}

// Tightness rewards short lines, the way criterion 4 rewards them: a
// line under twenty characters earns the full ten, and every further
// twenty characters costs one point, floored at zero.
function surotoTightness(surotoText: string): number {
  const surotoLength = surotoCharacterCount(surotoText);
  const surotoPenalty = Math.floor(surotoLength / 20);
  const surotoRawTightness = 10 - surotoPenalty;
  if (surotoRawTightness < 0) {
    return 0;
  }
  return surotoRawTightness;
}

// Weighted score, mirroring the judge's order of criteria: machine voice
// first, then the turn, then freshness, then tightness as a small bonus.
function surotoScoreFarewell(surotoFarewell: SurotoFarewell): number {
  const surotoTight = surotoTightness(surotoFarewell.line);
  const surotoVoicePart = surotoFarewell.machineVoice * 3;
  const surotoTurnPart = surotoFarewell.turnStrength * 2;
  const surotoFreshPart = surotoFarewell.freshness * 2;
  return surotoVoicePart + surotoTurnPart + surotoFreshPart + surotoTight;
}

// Score every candidate and return the full ranking, strongest first.
// Ties keep the earlier candidate ahead, so the order is stable across
// runs. The ranking is printed by main for a transparent audit trail.
function surotoRankFarewells(
  surotoVault: ReadonlyArray<SurotoFarewell>,
): ReadonlyArray<SurotoScoredFarewell> {
  const surotoScored: Array<SurotoScoredFarewell> = surotoVault.map(
    (surotoCandidate) => ({
      farewell: surotoCandidate,
      score: surotoScoreFarewell(surotoCandidate),
    }),
  );
  surotoScored.sort((surotoLeft, surotoRight) => {
    if (surotoRight.score !== surotoLeft.score) {
      return surotoRight.score - surotoLeft.score;
    }
    return (
      surotoVault.indexOf(surotoLeft.farewell) -
      surotoVault.indexOf(surotoRight.farewell)
    );
  });
  return surotoScored;
}

// Pick the winner and runner-up out of a ranking that is already sorted
// strongest first. A vault of one has no runner-up, so the winner stands
// as its own runner-up and the margin is zero by construction.
function surotoPickBestFarewell(
  surotoVault: ReadonlyArray<SurotoFarewell>,
): SurotoPickOutcome {
  if (surotoVault.length === 0) {
    throw new Error("suroto vault holds no farewell candidate");
  }
  const surotoRanked = surotoRankFarewells(surotoVault);
  const surotoWinner = surotoRanked[0];
  const surotoRunnerUp =
    surotoRanked.length > 1 ? surotoRanked[1] : surotoRanked[0];
  return { winner: surotoWinner, runnerUp: surotoRunnerUp, ranked: surotoRanked };
}

// The vault must hold no duplicate line: two identical candidates would
// make the pick arbitrary and waste the margin check below.
function surotoVaultHasDuplicate(
  surotoVault: ReadonlyArray<SurotoFarewell>,
): boolean {
  const surotoSeenLines = new Set<string>();
  for (const surotoCandidate of surotoVault) {
    if (surotoSeenLines.has(surotoCandidate.line)) {
      return true;
    }
    surotoSeenLines.add(surotoCandidate.line);
  }
  return false;
}

// The gate, re-checked before writing: length inside 1..140, a single
// line, more than blank space, and free of every stock phrase above.
function surotoValidateLine(surotoText: string): SurotoValidation {
  const surotoLength = surotoCharacterCount(surotoText);
  if (surotoLength < SUROTO_MIN_CHARS) {
    return { ok: false, reason: "suroto line is empty" };
  }
  if (surotoLength > SUROTO_MAX_CHARS) {
    return {
      ok: false,
      reason: `suroto line is ${surotoLength} characters, over the 140 limit`,
    };
  }
  if (surotoText.trim().length === 0) {
    return { ok: false, reason: "suroto line is only white space" };
  }
  if (surotoText.includes(SUROTO_NEWLINE)) {
    return { ok: false, reason: "suroto line holds more than one line" };
  }
  if (surotoText.includes(SUROTO_CARRIAGE)) {
    return { ok: false, reason: "suroto line holds a carriage return" };
  }
  const surotoLowered = surotoText.toLowerCase();
  for (const surotoStock of SUROTO_STOCK_PHRASES) {
    if (surotoLowered.includes(surotoStock)) {
      return {
        ok: false,
        reason: `suroto line carries stock phrase "${surotoStock}"`,
      };
    }
  }
  return { ok: true, reason: "suroto line passes the gate" };
}

// Write the chosen line to /output/entry.txt, creating the folder first.
// The write is one file, one line, one trailing newline, UTF-8 throughout.
function surotoWriteEntry(surotoText: string): void {
  try { mkdirSync(dirname(SUROTO_OUTPUT_PATH), { recursive: true });
    writeFileSync(SUROTO_OUTPUT_PATH, surotoText + SUROTO_NEWLINE, "utf8");
  } catch (surotoCaughtError) {
    const surotoMessage =
      surotoCaughtError instanceof Error
        ? surotoCaughtError.message
        : String(surotoCaughtError);
    throw new Error(`suroto write failed: ${surotoMessage}`);
  }
}

// Read the file back and confirm it holds exactly the chosen line plus
// its trailing newline, then re-run the gate over what was read. Any
// mismatch is a hard failure: the entry must never ship half-written.
function surotoConfirmWrittenEntry(surotoExpected: string): void {
  let surotoReadBack = "";
  try { surotoReadBack = readFileSync(SUROTO_OUTPUT_PATH, "utf8");
  } catch (surotoCaughtError) {
    const surotoMessage =
      surotoCaughtError instanceof Error
        ? surotoCaughtError.message
        : String(surotoCaughtError);
    throw new Error(`suroto read-back failed: ${surotoMessage}`);
  }
  if (surotoReadBack !== surotoExpected + SUROTO_NEWLINE) {
    throw new Error("suroto read-back differs from the chosen line");
  }
  const surotoRecheck = surotoValidateLine(surotoExpected);
  if (surotoRecheck.ok === false) {
    throw new Error(`suroto recheck refused the line: ${surotoRecheck.reason}`);
  }
}

function surotoMain(): void {
  if (surotoVaultHasDuplicate(SUROTO_FAREWELL_VAULT)) {
    throw new Error("suroto vault holds a duplicate farewell line");
  }
  const surotoPicked = surotoPickBestFarewell(SUROTO_FAREWELL_VAULT);
  const surotoMargin = surotoPicked.winner.score - surotoPicked.runnerUp.score;
  if (surotoMargin < SUROTO_MIN_MARGIN) {
    throw new Error(
      `suroto margin ${surotoMargin} is under the required ${SUROTO_MIN_MARGIN}`,
    );
  }
  const surotoValidation = surotoValidateLine(surotoPicked.winner.farewell.line);
  if (surotoValidation.ok === false) {
    throw new Error(`suroto gate refused the line: ${surotoValidation.reason}`);
  }
  for (const surotoEntry of surotoPicked.ranked) {
    console.log(
      `suroto rank score ${surotoEntry.score}: ${surotoEntry.farewell.line}`,
    );
  }
  surotoWriteEntry(surotoPicked.winner.farewell.line);
  surotoConfirmWrittenEntry(surotoPicked.winner.farewell.line);
  console.log(
    `suroto wrote ${surotoCharacterCount(surotoPicked.winner.farewell.line)} chars ` +
      `(score ${surotoPicked.winner.score}, margin ${surotoMargin}) to ${SUROTO_OUTPUT_PATH}`,
  );
  console.log(surotoPicked.winner.farewell.line);
}

surotoMain();
