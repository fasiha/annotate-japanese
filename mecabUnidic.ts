var promisify = require('util').promisify;
let spawn = require('child_process').spawn;

function invokeMecab(line: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let spawned = spawn('mecab', ['-d', '/usr/local/lib/mecab/dic/unidic']);
        spawned.stdin.write(line);
        spawned.stdin.write('\n'); // necessary, otherwise MeCab says `input-buffer overflow.`
        spawned.stdin.end();
        let arr: string[] = [];
        spawned.stdout.on('data', (data: Buffer) => arr.push(data.toString('utf8')));
        spawned.stderr.on('data', (data: Buffer) => {
            console.log('stderr', data.toString());
            reject(data);
        });
        spawned.on('close', (code: number) => {
            if (code !== 0) {
                reject(code);
            }
            resolve(arr.join(''));
        });
    });
}

function parseMecab(original: string, result: string) {
    let pieces = result.trim().split('\n').map(line => line.split('\t'));
    return pieces;
}

if (require.main === module) {
    (async function() {
        const text = '今日は　良い天気だ。\n\nたのしいですか。';
        console.log(parseMecab(text, await invokeMecab(text)));
    })();
}

module.exports = { invokeMecab, parseMecab };