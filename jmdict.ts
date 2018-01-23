var fs = require('fs');
var levelup = require('levelup');
var leveldown = require('leveldown');

import allSubstrings from './allSubstrings';
import readPartialFile from './readPartialFile';
import {promisify} from 'util';
import * as dbutils from './db';

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
  id: number;
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

export function displayWordDetailed(w: Entry, tags: any) {
  return w.kanji.map(k => k.text).join('・') + '「' + w.kana.map(k => k.text).join('・') + '」：' +
         w.sense
             .map((sense, n) => prefixNumber(n) + ' ' + sense.gloss.map(gloss => gloss.text).join('/') + ' {*' +
                                sense.partOfSpeech.map(pos => tags[pos]).join('; ') + '*}')
             .join('; ') +
         ' #' + w.id;
}

export async function slurpDict(jmdictpath: string): Promise<Dictionary> {
  return JSON.parse(await promisify(fs.readFile)(jmdictpath, 'utf8'));
}

export async function load(dbpath: string, jmdictpath: string): Promise<{db: dbutils.Db, tags: any}> {
  let db: dbutils.Db = levelup(leveldown(dbpath));

  let fileVersion = 'versionInFileUninitialized';
  {
    const fileHead: string = (await readPartialFile(jmdictpath, 0, 1000, 'utf8')) as string;
    const fileVersionMatch = fileHead.match(/"version"\s*:\s*"([0-9-.]+)/);
    if (fileVersionMatch) { fileVersion = fileVersionMatch[1]; }
  }

  let ver: string = 'versionInDbUninitialized';
  let tags;
  try {
    ver = (await db.get('version')).toString();
    tags = JSON.parse((await db.get('tags')).toString());
  } catch (e) {
    if (e.type === 'NotFoundError') {
      console.error('No "version" key found, rebuilding Leveldb.');
      await rebuilddb(db, jmdictpath);
      ver = (await db.get('version')).toString();
      tags = JSON.parse((await db.get('tags')).toString());
    } else {
      throw e;
    }
  }

  if (fileVersion !== ver) {
    console.error(`Leveldb version (${ver}) out of date with JSON ${fileVersion}, rebuilding`);
    await rebuilddb(db, jmdictpath);
  }
  if (!tags) {
    console.error('Could not find `tags` info in Leveldb, rebuilding');
    await rebuilddb(db, jmdictpath);
  }
  tags = JSON.parse((await db.get('tags')).toString());
  return {db, tags};
}

export async function queryIdToEntry(db: dbutils.Db, id: number): Promise<Entry> {
  let buffer = await db.get('id-' + id);
  return JSON.parse(buffer.toString());
}

export async function queryKeyToIntegerArr(db: dbutils.Db, key: string) {
  let res = new Int32Array([]);
  try {
    res = dbutils.bufferToIntegerArr(await db.get(key));
  } catch (e) {
    if (e.type !== 'NotFoundError') { throw e; }
  }
  return res;
}

// this allSubstrings of all kana and kanji in JMdict has ~2mil entries and takes ~8 seconds to build...!
export async function rebuilddb(db: dbutils.Db, jmdictpath: string) {
  // Slurp the database
  let jmdict: Dictionary = await slurpDict(jmdictpath);

  // Delete everything in the database
  await dbutils.purgedb(db);

  // This contains *ALL* substrings of kana and kanji in JMdict! It will have ~2million
  // string keys and each value will be an array of numbers (indexes into jmdict.words).
  // This lets us search for text anywhere inside JMdict, so searching this for `PQ`
  // will find `aPQy`.
  let substrToIdx: Map<string, Set<number>> = new Map();

  // This will contain only full kana and kanji strings. Stringy keys and each value is
  // a number[]. This lets us limit search to whole words only.
  let strToIdx: Map<string, Set<number>> = new Map();

  // Leveldb/Node has a problem where if you try to `Promise.all` a million promises, it hangs. Ugh. So we manually keep
  // track of a few thousand promises at a time, and then wait for these to complete. It's not so terrible. `bulk`
  // here will contain the batch objects Leveldb needs.
  const bulkchunks = 5000;
  let bulk = [];

  // First thing to queue up: the tags info
  bulk.push({type: 'put', key: 'tags', value: JSON.stringify(jmdict.tags)});

  for (let widx = 0; widx < jmdict.words.length; widx++) {
    const w = jmdict.words[widx];

    // Queue the entry to be written to leveldb.
    bulk.push({type: 'put', key: 'id-' + w.id, value: JSON.stringify(w)});
    // If enough have been queued, execute the batch operation and wait for it to complete.
    if (bulk.length > bulkchunks) {
      await db.batch(bulk);
      bulk = [];
    }

    // Accumulate substrings of kanji and readings, but we can't write these to leveldb yet because we have to look at
    // all the entries before we can know which entries contain which kanji/reading substrings.
    const ks = w.kanji.concat(w.kana);
    ks.forEach(k => allSubstrings(k.text).forEach(x => {
      const val = substrToIdx.get(x);
      if (val) {
        val.add(w.id);
      } else {
        substrToIdx.set(x, new Set([w.id]));
      }
    }));
    ks.forEach(k => {
      let x = k.text;
      const val = strToIdx.get(x);
      if (val) {
        val.add(w.id);
      } else {
        strToIdx.set(x, new Set([w.id]));
      }
    });
  }
  console.error('Done building all sub- & full-strings maps, and writing all entries');

  for (let [key, set] of substrToIdx) {
    bulk.push({type: 'put', key: 'partial-' + key, value: dbutils.integerArrToBuffer(Array.from(set))});
    if (bulk.length >= bulkchunks) {
      await db.batch(bulk);
      bulk = [];
    }
  }
  console.error('Done committing bulk/sub');

  for (let [key, set] of strToIdx) {
    bulk.push({type: 'put', key: 'full-' + key, value: dbutils.integerArrToBuffer(Array.from(set))});
    if (bulk.length >= bulkchunks) {
      await db.batch(bulk);
      bulk = [];
    }
  }
  console.error('Done committing bulk/full');

  // `bulk` will likely have some leftover uncommitted entries (less than bulkchunks), so append the version information
  // and batch everything.
  bulk.push({type: 'put', key: 'version', value: jmdict.version});
  bulk.push({type: 'put', key: 'jmdict-date', value: jmdict['jmdict-date']});
  return db.batch(bulk);
}

if (require.main === module) {
  (async function() {
    let {db, tags} = await load('./level-jmdict', 'jmdict_eng.json');
    var v = 'さっさ';
    v = '災難';

    let partials = await queryKeyToIntegerArr(db, 'partial-' + v);
    console.log('' + partials.length + ' PARTIAL hits found');
    for (let r of partials) { console.log('- ' + displayWordDetailed(await queryIdToEntry(db, r), tags)); }

    let fulls = await queryKeyToIntegerArr(db, 'full-' + v);
    console.log('' + fulls.length + ' *EXACT* hits found');
    for (let r of fulls) { console.log('- ' + displayWordDetailed(await queryIdToEntry(db, r), tags)); }
  })();
}