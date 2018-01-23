var fs = require('fs');
var levelup = require('levelup');
var leveldown = require('leveldown');
import {promisify} from 'util';
import * as dbutils from './db';

var parseString = require('xml2js').parseString;

export const entities: any = {
  surname: "family or surname",
  place: "place name",
  unclass: "unclassified name",
  company: "company name",
  product: "product name",
  work: "work of art, literature, music, etc. name",
  masc: "male given name or forename",
  fem: "female given name or forename",
  person: "full name of a particular person",
  given: "given name or forename, gender not specified",
  station: "railway station",
  organization: "organization name",
  ok: "old or irregular kana form",
};
function cleanEntryObject(entry: any) {
  let o = entry.entry;
  o.ent_seq = +o.ent_seq[0];
  if (!o.k_ele) { o.k_ele = []; }
  o.k_ele.forEach((k: any) => {
    k.keb = k.keb[0];
    delete k.ke_inf;
    delete k.ke_pri;
  });
  o.r_ele.forEach((r: any) => {
    r.reb = r.reb[0];
    delete r.re_restr;
    delete r.re_inf;
    delete r.re_pri;
  });
  o.trans.forEach((t: any) => { t.name_type = (t.name_type || []).map((t: string) => t.replace(';', '')); });
  return o;
}

async function fulfillPromises(bulkPromises: any, db: dbutils.Db) {
  const objects: any = await Promise.all(bulkPromises);
  let bulk = [];
  for (let o of objects) { bulk.push({type: 'put', key: 'ent_seq-' + o.ent_seq, value: JSON.stringify(o)}); }
  return db.batch(bulk);
};
export async function rebuilddb(filepath: string, db: dbutils.Db) {
  let entries: string[];
  let rev: string = '';
  let created = '';
  { // do this in a block so we can immediately release `contents` memory.
    const contents = (await promisify(fs.readFile)(filepath, 'utf8')).replace(/\n/g, '');
    const revMatch = contents.match(/<!--\s*Rev\s*([0-9.]+)/);
    if (revMatch) { rev = revMatch[1]; }
    const createdMatch = contents.match(/<!--\s*JMnedict\s*created:\s*([0-9-]+)\s*-->/);
    if (createdMatch) { created = createdMatch[1]; }
    entries = contents.match(/<entry>.*?<\/entry>/g) || [];
  }
  await dbutils.purgedb(db);

  await db.batch().put('rev', rev).put('created', created).write();

  // `JMnedict created`, `Rev`

  let stringToNumbers: Map<string, Set<number>> = new Map();

  const bulkchunks = 50000;
  let bulkPromises = [];
  let i = 0;
  for (let entry of entries) {
    // For this string, parse XML, clean it, note the reading=>ent_seq and kanji=>ent_seq, then push the entry object to
    // bulkPromises.
    bulkPromises.push(promisify(parseString)(entry.replace(/<name_type>&/g, '<name_type>')).then((raw: any) => {
      let o = cleanEntryObject(raw);
      o.k_ele.forEach((k: any) => {
        let key = k.keb;
        let val = stringToNumbers.get(key);
        if (val) {
          val.add(o.ent_seq);
        } else {
          stringToNumbers.set(key, new Set([o.ent_seq]));
        }
      });
      o.r_ele.forEach((r: any) => {
        let key = r.reb;
        let val = stringToNumbers.get(key);
        if (val) {
          val.add(o.ent_seq);
        } else {
          stringToNumbers.set(key, new Set([o.ent_seq]));
        }
      });
      return o;
    }));
    // When bulkPromises is big enough, wait for its contents to be fulfilled, then dump into leveldb, via
    // fulfillPromises (which builds a batch object for leveldb).
    if (bulkPromises.length >= bulkchunks) {
      await fulfillPromises(bulkPromises, db);
      bulkPromises = [];
      console.log(i);
      i += bulkchunks;
    }
  }
  await fulfillPromises(bulkPromises, db);
  // With the above done, all JMNedict entries are stored in leveldb, with keys as ent_seq's and values as the entry's
  // JSON. Next, we have to create the reading=>ent_seq and kanji=>ent_seq mappings in leveldb.

  // Use the same approach to throttling promises, since Node seems to choke on a million promises in-flight. bulks here
  // will contain the batch objects for leveldb. When we've accumulate denough of those, send the batch to leveldb, wait
  // for it to complete, and then resume with the next batch.
  let bulks = [];
  i = 0;
  for (let [k, v] of stringToNumbers) {
    bulks.push({type: 'put', key: 'full-' + k, value: dbutils.integerArrToBuffer(Array.from(v))});
    if (bulks.length > bulkchunks) {
      await db.batch(bulks);
      bulks = [];
      console.log(i);
      i += bulkchunks;
    }
  }
  return db.batch(bulks);
}

if (require.main === module) {
  (async function() {
    let db = levelup(leveldown('level-names'));

    let rev, created;
    try {
      rev = await db.get('rev');
      created = await db.get('created');
    } catch (e) {
      if (e.type === 'NotFoundError') {
        await rebuilddb("JMnedict.xml", db);
        rev = await db.get('rev');
        created = await db.get('created');
      } else {
        throw e;
      }
    }
    if (!rev || !created) { await rebuilddb("JMnedict.xml", db); }

    // number => entry
    console.log((await db.get('ent_seq-5717163')).toString());
    // Aika => numbers => entries
    console.log(await Promise.all(Array.from(dbutils.bufferToIntegerArr(await db.get('full-あいか')))
                                      .map(n => db.get('ent_seq-' + n).then((b: Buffer) => b.toString()))));
    // Satoshi => numbers => entries
    console.log(await Promise.all(Array.from(dbutils.bufferToIntegerArr(await db.get('full-智')))
                                      .map(n => db.get('ent_seq-' + n).then((b: Buffer) => b.toString()))));
    // Note how Int32Array.map *has* to return an Int32Array, it can't return stringy arrays, etc., so we needed
    // `Array.from(int32array)`.
  })();
}