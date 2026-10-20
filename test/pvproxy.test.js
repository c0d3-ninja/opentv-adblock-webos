'use strict';
// End-to-end test: a fake Amazon server behind pvproxy. Run with: node test/pvproxy.test.js
var http = require('http');
var zlib = require('zlib');
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var os = require('os');
var execFileSync = require('child_process').execFileSync;
var pv = require('../src/pvproxy.js');

var PROXY_PORT = 18888;
var UPSTREAM_PORT = 18999;

// Shape of a real GetVodPlaybackResources response (values made up).
function sample() {
  return {
    sessionization: {},
    cuepointPlaylist: [1],
    vodPlaylistedPlaybackUrls: { result: { playbackUrls: {
      fullTitleDurationMs: 6000000,
      pauseBehavior: { x: 1 },
      pauseAdsResolution: { y: 1 },
      intraTitlePlaylist: [
        { type: 'Remote', shouldShowOnScrubBar: true, urlsInPriorityOrder: ['/cdp/getVideoAds?a=1'] },
        { type: 'Main', startMs: 0, endMs: 3000000, urls: ['main-1'] },
        { type: 'Remote', shouldShowOnScrubBar: true, urlsInPriorityOrder: ['/cdp/getVideoAds?a=2'] },
        { type: 'Main', startMs: 3000000, endMs: 6000000, urls: ['main-2'] }
      ]
    } } },
    playbackData: {}
  };
}

var seen = {};
var upstream = http.createServer(function (req, res) {
  var b = '';
  req.on('data', function (c) { b += c; });
  req.on('end', function () {
    seen = { url: req.url, body: b };
    if (/notjson/.test(req.url)) { res.writeHead(200); return res.end('GetVodPlaybackResources <xml/>'); }
    if (/GetVodPlaybackResources/.test(req.url)) {
      var z = zlib.gzipSync(JSON.stringify(sample()));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': z.length });
      return res.end(z);
    }
    res.writeHead(200); res.end('ok');
  });
});

function get(p, method, body) {
  return new Promise(function (resolve, reject) {
    var q = http.request({
      host: '127.0.0.1', port: PROXY_PORT, method: method || 'GET',
      path: 'http://127.0.0.1:' + UPSTREAM_PORT + p,
      headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}
    }, function (res) {
      var d = [];
      res.on('data', function (c) { d.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(d).toString() }); });
    });
    q.on('error', reject);
    if (body) q.write(body);
    q.end();
  });
}

function unit() {
  // uBlock-only mode keeps the ad entries but hides markers and pause ads.
  var r = pv.editPlaybackJson(JSON.stringify(sample()), false);
  var pu = JSON.parse(r.body).vodPlaylistedPlaybackUrls.result.playbackUrls;
  assert.strictEqual(pu.intraTitlePlaylist.length, 4);
  assert(pu.intraTitlePlaylist.every(function (x) { return !('shouldShowOnScrubBar' in x); }));
  assert(!('pauseBehavior' in pu));

  // Never strip everything: a playlist of only ads is left as is.
  var onlyAds = { vodPlaylistedPlaybackUrls: { result: { playbackUrls: { intraTitlePlaylist: [{ type: 'Remote' }] } } } };
  var r2 = pv.editPlaybackJson(JSON.stringify(onlyAds), true);
  assert.strictEqual(r2.body, null);

  assert.strictEqual(pv.rewritePath('/x?a=1&deviceAdInsertionTypeOverride=SSAI&r=A%2CCuepointPlaylist'), '/x?a=1&r=A');
  assert.strictEqual(pv.editPlaybackJson('<xml/>').error, 'not JSON');

  // primeconfig keeps existing keys and adds the proxy options.
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otv-'));
  fs.writeFileSync(path.join(tmp, 'orig.json'), '{"log-level":"ALL:WARNING"}');
  execFileSync(process.execPath, [path.join(__dirname, '../src/primeconfig.js'), path.join(tmp, 'orig.json'), path.join(tmp, 'out.json'), '9999']);
  var cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'out.json'), 'utf8'));
  assert.deepStrictEqual(cfg, { 'log-level': 'ALL:WARNING', 'http-proxy-server': '127.0.0.1:9999', 'disable-ssl-cert': true });
  execFileSync(process.execPath, [path.join(__dirname, '../src/primeconfig.js'), path.join(tmp, 'missing.json'), path.join(tmp, 'out2.json'), '8888']);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'out2.json'), 'utf8'))['http-proxy-server'], '127.0.0.1:8888');
  console.log('PASS unit');
}

function testTls() {
  // Throwaway self-signed certificate for the proxy's TLS listener.
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otv-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=test',
    '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem')], { stdio: 'ignore' });
  return { key: fs.readFileSync(path.join(tmp, 'key.pem')), cert: fs.readFileSync(path.join(tmp, 'cert.pem')) };
}

function e2e() {
  var proxy = pv.start(testTls(), PROXY_PORT, '127.0.0.1');
  return new Promise(function (r) { setTimeout(r, 300); })
    .then(function () {
      return get('/playback/prs/GetVodPlaybackResources?deviceID=1&deviceAdInsertionTypeOverride=SSAI&desiredResources=PlaybackUrls%2CCuepointPlaylist%2CSubtitleUrls',
        'POST', 'desiredResources=PlaybackUrls,CuepointPlaylist&deviceAdInsertionTypeOverride=SSAI&x=1');
    })
    .then(function (r) {
      var j = JSON.parse(r.body);
      var pl = j.vodPlaylistedPlaybackUrls.result.playbackUrls;
      assert.strictEqual(pl.intraTitlePlaylist.length, 2);
      assert(pl.intraTitlePlaylist.every(function (x) { return x.type === 'Main' && !('shouldShowOnScrubBar' in x); }));
      assert(!('pauseBehavior' in pl) && !('pauseAdsResolution' in pl) && !('cuepointPlaylist' in j));
      assert(!/deviceAdInsertionTypeOverride|CuepointPlaylist/i.test(seen.url), seen.url);
      assert(!/deviceAdInsertionTypeOverride|CuepointPlaylist/i.test(seen.body), seen.body);
      assert(!r.headers['content-encoding']);
      console.log('PASS playback response edited and request cleaned');
      return get('/cdp/getVideoAds?x=1');
    })
    .then(function (r) {
      assert.strictEqual(r.status, 403);
      console.log('PASS getVideoAds blocked');
      return get('/x/GetVodPlaybackResources/notjson');
    })
    .then(function (r) {
      assert.strictEqual(r.body, 'GetVodPlaybackResources <xml/>');
      console.log('PASS unparseable response passed through unchanged');
      return get('/other');
    })
    .then(function (r) {
      assert.strictEqual(r.body, 'ok');
      console.log('PASS other traffic untouched');
      proxy.close();
    });
}

upstream.listen(UPSTREAM_PORT, '127.0.0.1', function () {
  try { unit(); } catch (e) { console.error(e); process.exit(1); }
  e2e().then(function () { console.log('all tests passed'); process.exit(0); },
    function (e) { console.error(e); process.exit(1); });
});
setTimeout(function () { console.error('timeout'); process.exit(1); }, 15000);
