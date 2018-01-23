const getStdin = require('get-stdin');
const readFile = require('fs').readFile;
const promisify = require('util').promisify;
import * as jmdict from './jmdict';
import * as namedict from './enamdict';
import * as unidic from './mecabUnidic';
import * as dbutils from './db';

function cumsum(arr: number[]) { return arr.reduce((p, c) => p.concat(c + (p[p.length - 1] || 0)), [] as number[]); }

interface Hits {
  substring: string;
  fullHits: number[]|Int32Array;
  partialHits: number[]|Int32Array;
  nameHits: number[]|Int32Array;
  start: number;
  len: number;
}
export async function analyzeLine(line: string, dictdb: dbutils.Db, namedb: dbutils.Db,
                                  morphemes: unidic.MaybeMorpheme[]) {
  // Search morphemes' lemmas (lexemes, base) in dictionary
  let lemmaHits = await Promise.all(
      morphemes.map(morpheme => jmdict.queryKeyToIntegerArr(dictdb, 'full-' + (morpheme ? morpheme.lemma : ''))));

  // Search runs of text starting at morpheme-starts and as long as possible
  let morphemeStarts = morphemes.map(morpheme => morpheme ? morpheme.literal.length : 0)
                           .reduce((p, c) => p.concat(p[p.length - 1] + c), [0]);
  morphemeStarts.pop(); // drop last element, which points to the length of the string
  let flexHits: Hits[][] = [];
  for (let start of morphemeStarts) {
    let hits: Hits[] = [];
    for (let len = 1; len <= line.length - start; len++) {
      const substring = line.substr(start, len);
      const fullHits = await jmdict.queryKeyToIntegerArr(dictdb, 'full-' + substring);
      const partialHits = await jmdict.queryKeyToIntegerArr(dictdb, 'partial-' + substring);
      const nameHits = await namedict.queryKeyToIntegerArr(namedb, 'full-' + substring);
      if (Math.max(partialHits.length, fullHits.length, nameHits.length) <= 0) { break; }
      hits.push({substring, fullHits, partialHits, nameHits, start, len});
    }
    hits.reverse(); // so longest hits come first
    flexHits.push(hits);
  }
  return {line, hits: lemmaHits.map((lemmaHits, i) => ({morpheme: morphemes[i], lemmaHits, flexHits: flexHits[i]}))};
}

export async function analyzeText(text: string, dictdb: dbutils.Db, namedb: dbutils.Db) {
  let lines = text.trim().split('\n');
  let morphemesPerLine = unidic.parseMecab(text, await unidic.invokeMecab(text));
  if (lines.length !== morphemesPerLine.length) {
    // It will simplify life if both of these are the same length.
    if (lines.length < morphemesPerLine.length) {
      // if there are trailing [null] morphemes (MeCab EOS), just trim them, from the end
      for (let i = morphemesPerLine.length - 1; i >= lines.length; i--) {
        if (morphemesPerLine[i].length === 1 && morphemesPerLine[i][0] === null) { morphemesPerLine.splice(i, 1); }
      }
    }
    // Recheck
    if (lines.length !== morphemesPerLine.length) {
      console.log(lines);
      console.log(morphemesPerLine);
      throw new Error('# MeCab lines != # input lines');
    }
  }
  return Promise.all(morphemesPerLine.map((morphemes, i) => analyzeLine(lines[i], dictdb, namedb, morphemes)));
}

if (require.main === module) {
  (async function() {
    let {db: dictdb, tags} = await jmdict.load('./level-jmdict', 'jmdict_eng.json');
    let namedb = await namedict.load('./level-names', 'JMnedict.xml');

    let text = '今日は　良い天気だ。\n\nたのしいですか。\n\n何できた？';
    if (process.argv.length <= 2) {
      // no arguments, read from stdin. If stdin is empty, use default.
      text = (await getStdin()) || text;
    } else {
      const readFileAsync = promisify(readFile);
      text =
          (await Promise.all(process.argv.slice(2).map(f => readFileAsync(f, 'utf8')))).join('\n').replace(/\r/g, '');
    }
    let res = await analyzeText(text, dictdb, namedb);
    for (let {line, hits} of res) {
      let indexesSeen: Set<number> = new Set();
      if (line.length === 0) { continue; }
      console.log('# ' + line + ' (line)');

      // Each morpheme boundary
      for (let {morpheme, lemmaHits, flexHits} of hits) {
        if (morpheme && morpheme.partOfSpeech.join('').indexOf('supplementary_symbol') >= 0) { continue; }

        // Show title: the morpheme
        if (lemmaHits.length || flexHits.length) {
          console.log('\n## ' + (morpheme ? morpheme.literal : '') + ' (' +
                      `lexeme: ${morpheme ? morpheme.lemma : ''}/${morpheme ? morpheme.pronunciation : ''}, ` +
                      `part of speech: ${morpheme ? morpheme.partOfSpeech.join('/') : ''}` +
                      ')');
          for (let n of lemmaHits) {
            indexesSeen.add(n);
            console.log('- ' + jmdict.displayWordDetailed(await jmdict.queryIdToEntry(dictdb, n), tags));
          }
        }

        // Show the longest text-based runs found in the dictionary
        if (flexHits.length) {
          console.log('');
          for (let flexHit of flexHits) {
            console.log('### Text-based searches: ' + flexHit.len + (flexHit.len > 1 ? ' characters' : ' character'));
            // Here are the names
            if (flexHit.nameHits.length) {
              console.log('- ' + flexHit.substring + ` (${flexHit.nameHits.length} **names**)`);
              for (let n of flexHit.nameHits) {
                console.log('  - ' + namedict.displayEntry(await namedict.queryEntseqToEntry(namedb, n)));
              }
            }

            // These are the JMdict entries that exactly match the substrings searched
            if ((flexHit.fullHits as number[]).filter((n: number) => !indexesSeen.has(n)).length) {
              console.log('- ' + flexHit.substring + ' (**related**)');
              for (let n of flexHit.fullHits) {
                if (indexesSeen.has(n)) { continue; }
                indexesSeen.add(n);
                console.log('  - ' + jmdict.displayWordDetailed(await jmdict.queryIdToEntry(dictdb, n), tags));
              }
            }
            // Whereas these are entries that have the substring appear somewhere in them.
            if (flexHit.partialHits.length) {
              console.log('- ' + flexHit.substring + ` (**possibly related;** ${flexHit.partialHits.length} matches)`);
              for (let n of flexHit.partialHits.slice(0, 10)) {
                if (indexesSeen.has(n)) { continue; }
                indexesSeen.add(n);
                console.log('  - ' + jmdict.displayWordDetailed(await jmdict.queryIdToEntry(dictdb, n), tags));
              }
            }
          }
        }
      }
      console.log('');
    }
  })();
}
