export default function allSubstrings(s: string) {
    const slen = s.length;
    let ret: Set<string> = new Set();
    for (let start = 0; start < slen; start++) {
        for (let length = 1; length <= slen - start; length++) {
            ret.add(s.substr(start, length));
        }
    }
    return ret;
}