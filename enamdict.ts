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
  let objects: any = await Promise.all(bulkPromises);
  let bulk = [];
  for (let o of objects) { bulk.push({type: 'put', key: 'ent_seq-' + o.ent_seq, value: JSON.stringify(o)}); }
  return db.batch(bulk);
};
export async function rebuilddb(filepath: string, db: dbutils.Db) {
  let entries: string[] =
      (await promisify(fs.readFile)(filepath, 'utf8')).replace(/\n/g, '').match(/<entry>.*?<\/entry>/g) || [];
  await dbutils.purgedb(db);

  // JMnedict created

  const bulkchunks = 50000;
  let bulkPromises = [];
  let i = 0;
  for (let entry of entries) {
    bulkPromises.push(
        promisify(parseString)(entry.replace(/<name_type>&/g, '<name_type>')).then((o: any) => cleanEntryObject(o)));
    if (bulkPromises.length >= bulkchunks) {
      await fulfillPromises(bulkPromises, db);
      bulkPromises = [];
      console.log(i);
      i += bulkchunks;
    }
  }
  await fulfillPromises(bulkPromises, db);

  return new Promise((resolve, reject) => {
    let bulk = [];
    let rmap: Map<string, Set<number>> = new Map();
    let kmap: Map<string, Set<number>> = new Map();
    let stream = db.createValueStream({gt: 'ent_seq-', lte: 'ent_seq-\uffff'});
    stream.on('data', (value: Buffer) => {
      let o = JSON.parse(value.toString());
      o.k_ele.forEach((k: any) => {
        let key = k.keb;
        let val = kmap.get(key);
        if (val) {
          val.add(o.ent_seq);
        } else {
          kmap.set(key, new Set([o.ent_seq]));
        }
      });
      o.r_ele.forEach((r: any) => {
        let key = r.reb;
        let val = rmap.get(key);
        if (val) {
          val.add(o.ent_seq);
        } else {
          rmap.set(key, new Set([o.ent_seq]));
        }
      });
    });

    stream.on('end', async () => {
      let bulks = [];
      const bulkchunks = 5000;
      let i = 0;
      for (let [k, v] of rmap) {
        bulks.push({type: 'put', key: 'r-' + k, value: dbutils.integerArrToBuffer(Array.from(v))});
        if (bulks.length > bulkchunks) {
          await db.batch(bulks);
          bulks = [];
          console.log(i);
          i += bulkchunks;
        }
      }
      for (let [k, v] of kmap) {
        bulks.push({type: 'put', key: 'k-' + k, value: dbutils.integerArrToBuffer(Array.from(v))});
        if (bulks.length > bulkchunks) {
          await db.batch(bulks);
          bulks = [];
          console.log(i);
          i += bulkchunks;
        }
      }
      await db.batch(bulks);
      resolve(true);
    });
  });
}

if (require.main === module) {
  (async function() {
    let db = levelup(leveldown('level-names'));
    // await rebuilddb("JMnedict.xml", db);
    console.log((await db.get('ent_seq-5717163')).toString());

    dbutils.bufferToIntegerArr(await db.get('r-あいか')).forEach(async (n) => {
      console.log((await db.get('ent_seq-' + n)).toString());
    });

    dbutils.bufferToIntegerArr(await db.get('k-智')).forEach(async (n) => {
      console.log((await db.get('ent_seq-' + n)).toString());
    });
  })();
}
// util.promisify(parseString)(s.replace(/&(?!(?:apos|quot|[gl]t|amp);|#)/g, '&amp;'), {normalize:true}).then(x=>t=(x))