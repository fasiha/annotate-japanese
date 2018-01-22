export interface KV {
  key: string;
  value: any;
}
export interface Db {
  get: any;
  put: any;
  batch: any;
  createReadStream: any;
  createKeyStream: any;
  createValueStream: any;
  del: any;
}

export function purgedb(db: Db): Promise<any> {
  return new Promise((resolve, reject) => {
    let promises: Promise<any>[] = [];
    db.createReadStream({values: false})
        .on('data', (data: KV) => promises.push(db.del(data.key)))
        .on('error', (err: any) => reject(err))
        .on('close', () => resolve(Promise.all(promises)))
        .on('end', () => resolve(Promise.all(promises)));
  });
}
export function integerArrToBuffer(arr: number[]) { return Buffer.from(new Int32Array(arr).buffer); }
export function bufferToIntegerArr(buf: Buffer) { return new Int32Array(buf.buffer); }
