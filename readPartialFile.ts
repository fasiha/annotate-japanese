var fs = require('fs');
export default async function readPartialFile(file: string, start: number = 0, end: number = -1,
                                              opts: any = {}): Promise<Buffer|string> {
  const p = new Promise((resolve, reject) => {
    if (end <= 0) { end = undefined as any; }
    if (typeof opts === 'string') { opts = {encoding: opts}; }
    const stream = fs.createReadStream(file, Object.assign(opts, {start, end}));
    let chunks: any[] = []; // could be Buffer or string
    stream.on('data', (chunk: any) => chunks.push(chunk));
    stream.on('close', () => {
      if (chunks.length === 0) {
        resolve('');
      } else if (chunks.length === 1) {
        resolve(chunks[0]);
      } else {
        resolve(typeof chunks[0] === 'string' ? chunks.join('') : Buffer.concat(chunks))
      }
    });
  });
  return p as Promise<Buffer|string>;
}