// Token launch radar: the entrypoint the grader runs.
//
// Reads the sealed snapshot (default /input/snapshot.json, override with
// --input <file|dir>), scores every rankable pre-token protocol with the model
// in lib/model.ts, and writes the hand-in into the output directory (default
// /output, or $MAKEFUN_OUTPUT_DIR, or --output <dir>):
//   board.json    the ranked board
//   data.js       the same numbers as a script the dashboard reads
//   dashboard/    the reader's page, copied from this repository
//   screenshots/  the three hand-in views, copied from this repository
//   dossier.json  the judge's summary, built last by the vendored library
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, dashScript, readSnapshot, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));

// The scorer's caps, mirrored from the gate so a bad hand-in fails here first.
const TEXT_CAP = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Value of --name in argv (either "--name v" or "--name=v"), else the fallback. */
function flag(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf('--' + name);
  if (at >= 0 && at + 1 < args.length) return args[at + 1] as string;
  const eq = args.find((a) => a.startsWith('--' + name + '='));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputPath)) {
  process.stderr.write(`token radar: no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = readSnapshot(readFileSync(inputPath, 'utf8'));
const { board, dash } = assemble(snap);
const problem = validateBoard(board, snap);
if (problem !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(outDir, 'data.js'), dashScript(dash));

/** Copy a directory's plain files (dotfiles skipped) into the output; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// Written last on purpose: the scorer rebuilds the dossier from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_CAP, screenshots: SHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows scored (${dash.early_size} early, ${dash.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashFiles.length} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
