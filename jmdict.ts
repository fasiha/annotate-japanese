var fs = require('fs');
var levelup = require('levelup');
var leveldown = require('leveldown');
// const encode = require('encoding-down');
import allSubstrings from './allSubstrings';
import readPartialFile from './readPartialFile';
import {promisify} from 'util';
export interface Kana {
  common: boolean;
  text: string;
  tags: any;
  appliesToKanji: string[];
}
export interface Kanji {
  common: boolean;
  text: string;
  tags: any;
}
export interface Gloss {
  lang: string;
  text: string;
}
export interface Sense {
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
export interface Entry {
  kana: Kana[];
  kanji: Kanji[];
  sense: Sense[];
}
export interface Dictionary {
  version: string;
  "jmdict-date": string;
  "jmdict-revisions": string[];
  tags: any;
  words: Entry[];
}

const circledNumbers = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳".split('');
const prefixNumber = (n: number) => circledNumbers[n] || '⓪';

export function displayWord(w: Entry) {
  return w.kanji.map(k => k.text).join('・') + '「' + w.kana.map(k => k.text).join('・') + '」：' +
         w.sense.map((sense, n) => prefixNumber(n) + ' ' + sense.gloss.map(gloss => gloss.text).join('/')).join('; ');
}

export function displayWordPos(w: Entry, dict: Dictionary) {
  return w.kanji.map(k => k.text).join('・') + '「' + w.kana.map(k => k.text).join('・') + '」：' +
         w.sense
             .map((sense, n) => prefixNumber(n) + ' ' + sense.gloss.map(gloss => gloss.text).join('/') + ' {*' +
                                sense.partOfSpeech.map(pos => dict.tags[pos]).join('; ') + '*}')
             .join('; ');
}

export async function slurpDict(jmdictpath: string): Promise<Dictionary> {
  return JSON.parse(await promisify(fs.readFile)(jmdictpath, 'utf8'));
}

export interface KV {
  key: string;
  value: any;
}
export interface Db {
  get: any;
  put: any;
  batch: any;
  createReadStream: any;
  del: any;
}

export async function load(jmdictpath: string, dbpath: any) {
  let jmdict: Dictionary = await slurpDict(jmdictpath);
  let db = levelup((leveldown(dbpath)));

  let ver: string;
  try {
    ver = (await db.get('version')).toString();
  } catch (e) {
    if (e.type === 'NotFoundError') {
      console.error('No "version" key found, rebuilding Leveldb.');
      await rebuilddb(jmdict, db);
      ver = (await db.get('version')).toString();
    } else {
      throw e;
    }
  }

  if (jmdict.version !== ver) {
    console.error(`Leveldb version (${ver}) out of date with JSON ${jmdict.version}, rebuilding`);
    await rebuilddb(jmdict, db);
  }

  return {jmdict, db};
}

const integerArrToBuffer = (arr: number[]) => Buffer.from(new Int32Array(arr).buffer);
const bufferToIntegerArr = (buf: Buffer) => new Int32Array(buf.buffer);

export async function queryIntegerArr(db: Db, key: string) {
  let res = new Int32Array([]);
  try {
    res = bufferToIntegerArr(await db.get(key));
  } catch (e) {
    if (e.type !== 'NotFoundError') { throw e; }
  }
  return res;
}

function purgedb(db: Db): Promise<any> {
  return new Promise((resolve, reject) => {
    let promises: Promise<any>[] = [];
    db.createReadStream({values: false})
        .on('data', (data: KV) => promises.push(db.del(data.key)))
        .on('error', (err: any) => reject(err))
        .on('close', () => resolve(Promise.all(promises)))
        .on('end', () => resolve(Promise.all(promises)));
  });
}

// this allSubstrings of all kana and kanji in JMdict has ~2mil entries and takes ~8 seconds to build...!
export async function rebuilddb(jmdict: Dictionary, db: Db) {
  // Delete everything in the database
  await purgedb(db);

  // This contains *ALL* substrings of kana and kanji in JMdict! It will have ~2million
  // string keys and each value will be an array of numbers (indexes into jmdict.words).
  // This lets us search for text anywhere inside JMdict, so searching this for `PQ`
  // will find `aPQy`.
  let substrToIdx: Map<string, Set<number>> = new Map();

  // This will contain only full kana and kanji strings. Stringy keys and each value is
  // a number[]. This lets us limit search to whole words only.
  let strToIdx: Map<string, Set<number>> = new Map();

  for (let i = 0; i < jmdict.words.length; i++) {
    const w = jmdict.words[i];
    const ks = w.kanji.concat(w.kana);
    ks.forEach(k => allSubstrings(k.text).forEach(x => {
      const val = substrToIdx.get(x);
      if (val) {
        val.add(i);
      } else {
        substrToIdx.set(x, new Set([i]));
      }
    }));
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
  console.error('Done building all sub/fullstrings');

  const bulkchunks = 5000;
  let bulk = [];
  for (let [key, set] of substrToIdx) {
    bulk.push({type: 'put', key: 'partial-' + key, value: integerArrToBuffer(Array.from(set))});
    if (bulk.length >= bulkchunks) {
      await db.batch(bulk);
      bulk = [];
    }
  }
  console.error('Done committing bulk/sub');

  for (let [key, set] of strToIdx) {
    bulk.push({type: 'put', key: 'full-' + key, value: integerArrToBuffer(Array.from(set))});
    if (bulk.length >= bulkchunks) {
      await db.batch(bulk);
      bulk = [];
    }
  }
  console.error('Done committing bulk/full');

  bulk.push({type: 'put', key: 'version', value: jmdict.version});
  bulk.push({type: 'put', key: 'jmdict-date', value: jmdict['jmdict-date']});
  return db.batch(bulk);
}

if (require.main === module) {
  (async function() {
    const {jmdict, db} = await load('jmdict_eng.json', './jmdict-level');
    var v = 'さっさ';
    v = '災難';

    let partials = await queryIntegerArr(db, 'partial-' + v);
    if (partials) {
      console.log('' + partials.length + ' hits found');
      for (let r of partials) { console.log(displayWord(jmdict.words[r])); }
    } else {
      console.log('no hits')
    }

    let fulls = await queryIntegerArr(db, 'full-' + v);
    if (fulls) {
      console.log('' + fulls.length + ' hits found');
      for (let r of fulls) { console.log(displayWord(jmdict.words[r])); }
    } else {
      console.log('no hits')
    }
  })();
}