"use strict";
var test = require('tape');

var partitionBy = require('../partitionBy').default;

test('basic', function(t) {
  let arr = [ 0, 0, 0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 0, 0, 1, 0, 1, 0, 0, 0, 0 ];
  let res = partitionBy(arr, x => !x); // break at 0s
  // The resulting partitions should start at 0 and the 2nd element should be non-zero (because if the 2nd element was
  // 0, it should have been in a separate partition)
  t.equal(0, res.filter(sub => !(sub[0] === 0 && (sub.length > 1 ? sub[1] !== 0 : true))).length);

  t.end();
});
