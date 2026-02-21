import * as alphaTab from '@coderline/alphatab';
import * as fs from 'fs';

export async function loadScore(filePath) {
  const fileData = await fs.promises.readFile(filePath);
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
    new Uint8Array(fileData),
    settings
  );
  return { score, settings };
}
