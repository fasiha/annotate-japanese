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
- [MeCab](https://github.com/taku910/mecab) and [Unidic](https://osdn.net/projects/unidic/): Japanese language processing tools (morphological parsing, part-of-speech tagging). Both readily available on macOS via [homebrew](https://brew.sh/).
- JMdict, Jim Breen and friends' Japanese dictionary: https://github.com/scriptin/jmdict-simplified/releases/tag/1.1.1 (this repackages the original [JMdict](http://www.edrdg.org/jmdict/j_jmdict.html)'s XML file into nice JSON).
- [JMnedict](http://www.edrdg.org/enamdict/enamdict_doc.html), Jim Breen and friends' compilation of Japanese names (people, places, stations, etc.): http://ftp.monash.edu/pub/nihongo/JMnedict.xml.gz and gunzip to get the XML.


## Other helpful tools

`$ echo 田中です。| node mecabUnidic.js` as an alternative to the MeCab-Unidic output (this will Englishfy the parts of speech, etc.).

Consider https://raw.githubusercontent.com/Kalamandea/Rikaichan/master/ext/bg/lang/deinflect.json

Consider https://www.kanshudo.com/grammar/overview
