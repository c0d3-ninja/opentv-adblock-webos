'use strict';
/*
 * Writes SHA256SUMS: the checksums install.sh uses to check the files it downloads.
 * Run after changing any of the files below:  npm run sums
 * (npm test fails while SHA256SUMS is out of date.)
 */
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
// Keep in sync with FILES in install.sh
var FILES = ['src/pvproxy.js', 'src/primeconfig.js', 'src/ctl.sh', 'src/hosts.blocklist', 'uninstall.sh'];

function sums() {
  return FILES.map(function (f) {
    var h = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
    return h + '  ' + f;
  }).join('\n') + '\n';
}

module.exports = { FILES: FILES, sums: sums, file: path.join(ROOT, 'SHA256SUMS') };

if (require.main === module) {
  fs.writeFileSync(module.exports.file, sums());
  console.log('SHA256SUMS updated');
}
