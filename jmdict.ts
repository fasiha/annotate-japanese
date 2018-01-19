var fs = require('fs');
import allSubstrings from './allSubstrings';
interface Kana {
  common: boolean;
  text: string;
  tags: any;
  appliesToKanji: string[];
}
interface Kanji {
  common: boolean;
  text: string;
  tags: any;
}
interface Gloss {
  lang: string;
  text: string;
}
interface Sense {
  partOfSpeech: string[];
  gloss: Gloss[];
  appliesToKanji?: string[];
  appliesToKana?: string[];
  related?: any;
  antonym?: any;
  field?: any;
  dialect?: any;
  misc?: any;
  info?: any;
}
interface Entry {
  kana: Kana[];
  kanji: Kanji[];
  sense: Sense[];
}
interface Dictionary {
  version: string;
  "jmdict-date": string;
  "jmdict-revisions": string[];
  tags: any;
  words: Entry[];
}

export const jmdict: Dictionary = JSON.parse(fs.readFileSync('jmdict_eng.json', 'utf8'));

export function displayWord(w: Entry) {
  return w.kanji.map(k => k.text).join('・') + '「' + w.kana.map(k => k.text).join('・') + '」：' +
         w.sense.map(sense => sense.gloss.map(gloss => gloss.text).join('/')).join('; ');
}

// This contains *ALL* substrings of kana and kanji in JMdict! It will have ~2million
// string keys and each value will be an array of numbers (indexes into jmdict.words).
// This lets us search for text anywhere inside JMdict, so searching this for `PQ`
// will find `aPQy`.
export let substrToIdx: Map<string, Set<number>> = new Map();

// This will contain only full kana and kanji strings. Stringy keys and each value is
// a number[]. This lets us limit search to whole words only.
export let strToIdx: Map<string, Set<number>> = new Map();

for (let i = 0; i < jmdict.words.length; i++) {
  const w = jmdict.words[i];
  const ks = w.kanji.concat(w.kana);
  if (typeof substrToIdx !== 'undefined') {
    ks.forEach(k => allSubstrings(k.text).forEach(x => {
      const val = substrToIdx.get(x);
      if (val) {
        val.add(i);
      } else {
        substrToIdx.set(x, new Set([i]));
      }
    }));
  }
  if (typeof strToIdx !== 'undefined') {
    ks.forEach(k => {
      let x = k.text;
      const val = strToIdx.get(x);
      if (val) {
        val.add(i);
      } else {
        strToIdx.set(x, new Set([i]));
      }
    });
  }
}
// this allSubstrings of all kana and kanji in JMdict has ~2mil entries and takes ~8 seconds to build...!

var v = 'さっさ';
v = '災難';

let res = substrToIdx.get(v);
if (res) {
  console.log(res.size, 'hits found');
  for (let r of Array.from(res)) { console.log(displayWord(jmdict.words[r])); }
} else {
  console.log('no hits')
}

res = strToIdx.get(v);
if (res) {
  console.log(res.size, 'hits found');
  for (let r of Array.from(res)) { console.log(displayWord(jmdict.words[r])); }
} else {
  console.log('no hits')
}