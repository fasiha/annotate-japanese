# Annotate Japanese

The idea is, to take a file, any text file, say, an subtitle (SRT) file like
```
1
00:00:40,525 --> 00:00:44,363
＜（宇佐）中学の俺は
災難続きだった＞

2
00:00:44,363 --> 00:00:46,865
＜あの３年間は忘れて＞

3
00:00:46,865 --> 00:00:49,801
＜高校生活は　心地よく＞

4
00:00:49,801 --> 00:00:52,101
＜穏やかに過ごしたい…＞
```
and inject into it the results of parsing & JMDICT lookups via Markdown-ready markers. Maybe something like
```
1
00:00:40,525 --> 00:00:44,363
＜（宇佐）中学の俺は
災難続きだった＞

- Result: [宇佐]{うさ}: Name
- Result: [中学]{ちゅうがく}: middle school; junior high school
- Result: [俺]{おれ}: I; me
- Result: [災難]{...}: ...
```

`

## Requirements

https://github.com/scriptin/jmdict-simplified/releases/tag/1.1.1

MeCab and Unidic

## Other helpful tools

`$ echo 田中です。| node mecabUnidic.js | clang-format -assume-filename=foo.js`