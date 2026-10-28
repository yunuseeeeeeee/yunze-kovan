// builds kovan.umd.js from index.mjs (for script tags and require)
const fs = require('fs');
const src = fs.readFileSync('index.mjs', 'utf8');
const names = [...src.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const body = src.replace(/^export /gm, '');

fs.writeFileSync('kovan.umd.js', `(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Kovan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
${body}
  return { ${names.join(', ')} };
});
`);
console.log('built kovan.umd.js');
