const getStdin = require('get-stdin');
if (require.main === module) {
  (async function() {
    let text: string = (await getStdin()) || "";
    let data = text.trim().split('\n').map(s => JSON.parse(s));
    const formatter = (arr: any[][]) =>
        arr.map(arr => '  [ ' + arr.map(x => JSON.stringify(x)).join(',\n    ')).join(' ],\n');
    console.log(formatter(data));
  })();
}