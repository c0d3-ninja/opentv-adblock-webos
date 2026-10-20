'use strict';
// End-to-end test: fake Amazon servers behind pvproxy. Run with: node test/pvproxy.test.js (needs openssl)
var http = require('http');
var net = require('net');
var https = require('https');
var tls = require('tls');
var zlib = require('zlib');
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var os = require('os');
var execFileSync = require('child_process').execFileSync;

var PROXY_PORT = 18888;
var HTTP_PORT = 18999;      // plain HTTP fake server
var GOOD_PORT = 18443;      // HTTPS fake server with a certificate from the trusted test CA
var BAD_PORT = 18444;       // HTTPS fake server with an untrusted (self-signed) certificate

/* ---------- certificates ---------- */
function rmrf(p) { // fs.rmSync is not in Node.js 8
  try {
    if (fs.lstatSync(p).isDirectory()) { fs.readdirSync(p).forEach(function (n) { rmrf(path.join(p, n)); }); fs.rmdirSync(p); }
    else fs.unlinkSync(p);
  } catch (e) { /* already gone */ }
}

if (!process.env.OTV_TEST_DIR) {
  // First run: create the certificates, then run the tests again in a new Node.js process
  // with NODE_EXTRA_CA_CERTS set, exactly as ctl.sh starts the proxy on the TV (Node.js
  // only reads that setting at start-up).
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otv-'));
  var d = function (n) { return path.join(dir, n); };
  var ssl = function (args) { execFileSync('openssl', args, { stdio: 'ignore' }); };
  fs.writeFileSync(d('san.cnf'), 'subjectAltName=IP:127.0.0.1,DNS:localhost\n');
  // test CA, and a server certificate it signs
  ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=otv test CA', '-keyout', d('ca.key'), '-out', d('ca.pem')]);
  ssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', d('good.key'), '-out', d('good.csr')]);
  ssl(['x509', '-req', '-in', d('good.csr'), '-CA', d('ca.pem'), '-CAkey', d('ca.key'), '-CAcreateserial', '-days', '1', '-extfile', d('san.cnf'), '-out', d('good.pem')]);
  // untrusted self-signed server certificate
  ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', d('bad.key'), '-out', d('bad.pem')]);
  // the proxy's own certificate (what install.sh generates on the TV)
  ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=opentv-adblock', '-keyout', d('proxy.key'), '-out', d('proxy.pem')]);
  // "The TV's list": this computer's list (which overlaps Node.js's built-in one, like on a
  // TV) with the test CA added at the end. Only the test CA can verify the fake Amazon.
  var system = ['/etc/ssl/certs/ca-certificates.crt', '/etc/ssl/cert.pem'].filter(function (x) { return fs.existsSync(x); })[0];
  fs.writeFileSync(d('tv-bundle.crt'), (system ? fs.readFileSync(system) + '\n' : '') + fs.readFileSync(d('ca.pem')));

  var env = Object.assign({}, process.env, { OTV_TEST_DIR: dir, NODE_EXTRA_CA_CERTS: d('tv-bundle.crt') });
  var r = require('child_process').spawnSync(process.execPath, [__filename], { env: env, stdio: 'inherit' });
  rmrf(dir);
  process.exit(r.status === null ? 1 : r.status);
}

var tmp = process.env.OTV_TEST_DIR;
function f(n) { return path.join(tmp, n); }
process.env.PLAIN_PORTS = String(HTTP_PORT); // stands in for port 80 (a test can't use port 80)
var pv = require('../src/pvproxy.js');
var gaveUp = 0;
pv.onCertGiveUp = function () { gaveUp++; };

/* ---------- fake Amazon ---------- */
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
function handler(req, res) {
  var b = '';
  req.on('data', function (c) { b += c; });
  req.on('end', function () {
    seen = { url: req.url, body: b, acceptEncoding: req.headers['accept-encoding'] || '' };
    if (/notjson/.test(req.url)) { res.writeHead(200); return res.end('GetVodPlaybackResources <xml/>'); }
    if (/GetVodPlaybackResources/.test(req.url)) {
      // Like Amazon: Brotli when the client asks for it, gzip otherwise
      var br = /\bbr\b/.test(seen.acceptEncoding);
      var z = br ? (zlib.brotliCompressSync ? zlib.brotliCompressSync(JSON.stringify(sample())) : Buffer.from('brotli bytes'))
                 : zlib.gzipSync(JSON.stringify(sample()));
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': br ? 'br' : 'gzip', 'content-length': z.length });
      return res.end(z);
    }
    res.writeHead(200); res.end('ok');
  });
}
var servers = [
  http.createServer(handler),
  https.createServer({ key: fs.readFileSync(f('good.key')), cert: fs.readFileSync(f('good.pem')) }, handler),
  https.createServer({ key: fs.readFileSync(f('bad.key')), cert: fs.readFileSync(f('bad.pem')) }, handler)
];
// WebSocket-style upgrade: answer 101, then echo everything back
servers.forEach(function (srv) {
  srv.on('upgrade', function (req, sock) {
    seen = { url: req.url, upgrade: req.headers.upgrade };
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    sock.pipe(sock);
  });
});

/* ---------- clients ---------- */
function collect(resolve) {
  return function (res) {
    var d = [];
    res.on('data', function (c) { d.push(c); });
    res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(d).toString() }); });
  };
}

// Plain HTTP through the proxy (absolute URL)
function get(p, method, body) {
  return new Promise(function (resolve, reject) {
    var q = http.request({
      host: '127.0.0.1', port: PROXY_PORT, method: method || 'GET',
      path: 'http://127.0.0.1:' + HTTP_PORT + p,
      headers: Object.assign({ 'accept-encoding': 'gzip, deflate, br' }, body ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
    }, collect(resolve));
    q.on('error', reject);
    if (body) q.write(body);
    q.end();
  });
}

// HTTPS through the proxy, like the Prime Video app: CONNECT, then TLS WITHOUT checking
// the certificate ("disable-ssl-cert"), then the request.
function sget(port, p, method, body, contentType) {
  return new Promise(function (resolve, reject) {
    var c = http.request({ host: '127.0.0.1', port: PROXY_PORT, method: 'CONNECT', path: '127.0.0.1:' + port });
    c.on('connect', function (res, socket) {
      var q = https.request({
        host: '127.0.0.1', port: port, path: p, method: method || 'GET',
        headers: Object.assign({ 'accept-encoding': 'gzip, deflate, br' }, body ? { 'content-type': contentType || 'application/x-www-form-urlencoded' } : {}),
        createConnection: function () { return tls.connect({ socket: socket, rejectUnauthorized: false }); }
      }, collect(resolve));
      q.on('error', reject);
      if (body) q.write(body);
      q.end();
    });
    c.on('error', reject);
    c.end();
  });
}

// Opens a connection through the proxy: plain (absolute URL) or via CONNECT (+ TLS like the app)
function viaConnect(port, useTls) {
  return new Promise(function (resolve, reject) {
    var c = http.request({ host: '127.0.0.1', port: PROXY_PORT, method: 'CONNECT', path: '127.0.0.1:' + port });
    c.on('connect', function (res, socket) {
      if (!useTls) return resolve(socket);
      var t = tls.connect({ socket: socket, rejectUnauthorized: false }, function () { resolve(t); });
      t.on('error', reject);
    });
    c.on('error', reject);
    c.end();
  });
}

// Sends an upgrade request and one message; resolves "echo" when the message comes back,
// or "closed" when the proxy closes the connection instead
function wsTalk(sock, reqPath) {
  return new Promise(function (resolve) {
    var got = '';
    var upgraded = false;
    sock.on('data', function (d) {
      got += d.toString();
      if (!upgraded && got.indexOf('\r\n\r\n') >= 0) {
        if (!/^HTTP\/1\.1 101/.test(got)) { sock.destroy(); return resolve('no 101: ' + got.split('\r\n')[0]); }
        upgraded = true; got = '';
        sock.write('hello-through-proxy');
      } else if (upgraded && got === 'hello-through-proxy') {
        sock.destroy(); resolve('echo');
      }
    });
    sock.on('error', function () {});
    sock.on('close', function () { resolve('closed'); });
    sock.write('GET ' + reqPath + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
}

/* ---------- tests ---------- */
function unit() {
  // uBlock-only mode keeps the ad entries but hides markers and pause ads.
  var r = pv.editPlaybackJson(JSON.stringify(sample()), false);
  var pu = JSON.parse(r.body).vodPlaylistedPlaybackUrls.result.playbackUrls;
  assert.strictEqual(pu.intraTitlePlaylist.length, 4);
  assert(pu.intraTitlePlaylist.every(function (x) { return !('shouldShowOnScrubBar' in x); }));
  assert(!('pauseBehavior' in pu));

  // Never strip the programme: ad entries are only removed when a Main entry remains.
  var onlyAds = { vodPlaylistedPlaybackUrls: { result: { playbackUrls: { intraTitlePlaylist: [{ type: 'Remote' }] } } } };
  assert.strictEqual(pv.editPlaybackJson(JSON.stringify(onlyAds), true).body, null);
  var noMain = { vodPlaylistedPlaybackUrls: { result: { playbackUrls: { intraTitlePlaylist: [{ type: 'Remote' }, { type: 'Other' }] } } } };
  assert.strictEqual(pv.editPlaybackJson(JSON.stringify(noMain), true).body, null);

  assert.strictEqual(pv.rewritePath('/x?a=1&deviceAdInsertionTypeOverride=SSAI&r=A%2CCuepointPlaylist'), '/x?a=1&r=A');
  assert.strictEqual(pv.rewritePath('/x?deviceAdInsertionTypeOverride=SSAI&r=CuepointPlaylist%2CA%2CB'), '/x?r=A%2CB');
  assert.strictEqual(pv.rewritePath('/x?deviceAdInsertionTypeOverride=SSAI'), '/x');
  assert.strictEqual(pv.rewriteBody('deviceAdInsertionTypeOverride=SSAI&x=1'), 'x=1');
  assert.strictEqual(pv.rewriteBody('r=CuepointPlaylist,PlaybackUrls&x=1'), 'r=PlaybackUrls&x=1');
  assert.deepStrictEqual(JSON.parse(pv.rewriteBody('{"deviceAdInsertionTypeOverride":"SSAI","desiredResources":"PlaybackUrls,CuepointPlaylist","n":1}')),
    { desiredResources: 'PlaybackUrls', n: 1 });
  assert.strictEqual(pv.rewriteBody('{"a":"b"}'), '{"a":"b"}');
  assert.strictEqual(pv.stripCuepoint('CuepointPlaylist'), 'CuepointPlaylist');
  assert.strictEqual(pv.editPlaybackJson('<xml/>').error, 'not JSON');

  // primeconfig keeps existing keys and adds the proxy options.
  fs.writeFileSync(f('orig.json'), '{"log-level":"ALL:WARNING"}');
  execFileSync(process.execPath, [path.join(__dirname, '../src/primeconfig.js'), f('orig.json'), f('out.json'), '9999']);
  var cfg = JSON.parse(fs.readFileSync(f('out.json'), 'utf8'));
  assert.deepStrictEqual(cfg, { 'log-level': 'ALL:WARNING', 'http-proxy-server': '127.0.0.1:9999', 'disable-ssl-cert': true });
  execFileSync(process.execPath, [path.join(__dirname, '../src/primeconfig.js'), f('missing.json'), f('out2.json'), '8888']);
  assert.strictEqual(JSON.parse(fs.readFileSync(f('out2.json'), 'utf8'))['http-proxy-server'], '127.0.0.1:8888');
  // Only Amazon's own servers count for the certificate safety net
  ['atv-ps-eu.primevideo.com', 'api.amazon.com', 'api.amazon.co.uk', 'www.amazon.in', 'x.amazonvideo.com', 'x.amazon.dev']
    .forEach(function (h) { assert(pv.isCertHost(h), h); });
  ['telemetry.example.com', 'amazon.evil.com', 'notamazon.com', 'primevideo.com.evil.net', 's3.amazonaws.com', '127.0.0.1']
    .forEach(function (h) { assert(!pv.isCertHost(h), h); });

  // The release install.sh downloads must be this version (release checklist, step 2)
  var release = (fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8').match(/^RELEASE="([^"]+)"/m) || [])[1];
  var version = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version;
  assert.strictEqual(release, 'v' + version, 'RELEASE in install.sh (' + release + ') must be v + the version in package.json (' + version + ')');

  // SHA256SUMS (checked by install.sh) must match the files
  var sums = require('../scripts/sums.js');
  assert.strictEqual(fs.readFileSync(sums.file, 'utf8'), sums.sums(), 'SHA256SUMS is out of date: run npm run sums');
  console.log('PASS unit');
}

function checkEdited(r) {
  var j = JSON.parse(r.body);
  var pl = j.vodPlaylistedPlaybackUrls.result.playbackUrls;
  assert.strictEqual(pl.intraTitlePlaylist.length, 2);
  assert(pl.intraTitlePlaylist.every(function (x) { return x.type === 'Main' && !('shouldShowOnScrubBar' in x); }));
  assert(!('pauseBehavior' in pl) && !('pauseAdsResolution' in pl) && !('cuepointPlaylist' in j));
  assert(!/deviceAdInsertionTypeOverride|CuepointPlaylist/i.test(seen.url), seen.url);
  assert(!/deviceAdInsertionTypeOverride|CuepointPlaylist/i.test(seen.body), seen.body);
  assert(!r.headers['content-encoding']);
  // Brotli: kept when this Node.js can unpack it, otherwise gzip is asked for instead
  if (zlib.brotliDecompressSync) assert(/\bbr\b/.test(seen.acceptEncoding), seen.acceptEncoding);
  else assert(!/\bbr\b/.test(seen.acceptEncoding), seen.acceptEncoding);
}

var PR = '/playback/prs/GetVodPlaybackResources?deviceID=1&deviceAdInsertionTypeOverride=SSAI&desiredResources=PlaybackUrls%2CCuepointPlaylist%2CSubtitleUrls';
var PR_BODY = 'desiredResources=PlaybackUrls,CuepointPlaylist&deviceAdInsertionTypeOverride=SSAI&x=1';

function sixRefusals() {
  var chain = Promise.resolve();
  for (var i = 0; i < 6; i++) chain = chain.then(function () { return sget(BAD_PORT, '/x'); });
  return chain;
}

function e2e() {
  var proxy = pv.start({ key: fs.readFileSync(f('proxy.key')), cert: fs.readFileSync(f('proxy.pem')) }, PROXY_PORT, '127.0.0.1');
  return new Promise(function (r) { setTimeout(r, 300); })
    .then(function () { return get(PR, 'POST', PR_BODY); })
    .then(function (r) {
      checkEdited(r);
      console.log('PASS http: playback response edited and request cleaned (' +
        (zlib.brotliDecompressSync ? 'Brotli response unpacked' : 'no Brotli in this Node.js: gzip asked for') + ')');
      return get('/cdp/getVideoAds?x=1');
    })
    .then(function (r) {
      assert.strictEqual(r.status, 403);
      console.log('PASS http: getVideoAds blocked');
      return get('/x/GetVodPlaybackResources/notjson');
    })
    .then(function (r) {
      assert.strictEqual(r.body, 'GetVodPlaybackResources <xml/>');
      console.log('PASS http: unparseable response passed through unchanged');
      return get('/other');
    })
    .then(function (r) {
      assert.strictEqual(r.body, 'ok');
      console.log('PASS http: other traffic untouched');
      return sget(GOOD_PORT, PR, 'POST', PR_BODY);
    })
    .then(function (r) {
      checkEdited(r);
      console.log('PASS https: playback response edited and request cleaned');
      return sget(GOOD_PORT, '/video/segment-1.mp4');
    })
    .then(function (r) {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body, 'ok');
      console.log('PASS https: other traffic (video) passed through from a server with a valid certificate');
      return sget(GOOD_PORT, '/cdp/getVideoAds?x=1');
    })
    .then(function (r) {
      assert.strictEqual(r.status, 403);
      console.log('PASS https: getVideoAds blocked');
      seen = {};
      return sget(BAD_PORT, '/login');
    })
    .then(function (r) {
      assert.strictEqual(r.status, 502);
      assert.strictEqual(seen.url, undefined, 'the request must never reach a server with a bad certificate');
      assert.strictEqual(gaveUp, 0, 'one refusal after accepted servers must not give up');
      console.log('PASS https: server with an untrusted certificate refused (502), nothing sent to it');
      // Plain HTTP port via CONNECT: passed straight through
      return viaConnect(HTTP_PORT, false).then(function (sock) {
        return new Promise(function (resolve) {
          var d = '';
          sock.on('data', function (c) { d += c; });
          sock.on('end', function () { resolve(d); });
          sock.write('GET /other HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
        });
      });
    })
    .then(function (d) {
      assert(/^HTTP\/1\.1 200/.test(d) && /\r\n(2\r\n)?ok/.test(d), d);
      console.log('PASS connect: plain HTTP port passed straight through');
      // WebSocket upgrades
      var sock = net.connect(PROXY_PORT, '127.0.0.1');
      return wsTalk(sock, 'http://127.0.0.1:' + HTTP_PORT + '/ws-plain');
    })
    .then(function (r) {
      assert.strictEqual(r, 'echo');
      assert.strictEqual(seen.url, '/ws-plain');
      console.log('PASS websocket: plain upgrade works through the proxy');
      return viaConnect(GOOD_PORT, true).then(function (sock) { return wsTalk(sock, '/ws-secure'); });
    })
    .then(function (r) {
      assert.strictEqual(r, 'echo');
      assert.strictEqual(seen.url, '/ws-secure');
      console.log('PASS websocket: secure upgrade to a server with a valid certificate works');
      seen = {};
      return viaConnect(BAD_PORT, true).then(function (sock) { return wsTalk(sock, '/ws-bad'); });
    })
    .then(function (r) {
      assert.strictEqual(r, 'closed');
      assert.strictEqual(seen.url, undefined, 'nothing may reach a server with a bad certificate');
      console.log('PASS websocket: server with an untrusted certificate refused, nothing sent to it');
      // A server that is not Amazon's, refused again and again: refused each time, never gives up
      pv._resetCertState();
      return sixRefusals();
    })
    .then(function () {
      assert.strictEqual(gaveUp, 0);
      console.log('PASS https: a non-Amazon server refused again and again: does not give up');
      // Amazon's servers refused again and again, none accepted: gives up so Prime Video can go
      // back to normal. (The fake server stands in for Amazon here.)
      pv._resetCertState();
      var realIsCertHost = pv.isCertHost;
      pv.isCertHost = function () { return true; };
      return sixRefusals().then(function () { pv.isCertHost = realIsCertHost; });
    })
    .then(function () {
      assert.strictEqual(gaveUp, 1);
      console.log('PASS https: Amazon certificates refused again and again, none accepted: gives up (exit code 3)');
      proxy.close();
    });
}

var ports = [HTTP_PORT, GOOD_PORT, BAD_PORT];
var left = servers.length;
servers.forEach(function (s, i) {
  s.listen(ports[i], '127.0.0.1', function () {
    if (--left) return;
    try { unit(); } catch (e) { console.error(e); process.exit(1); }
    e2e().then(function () { console.log('all tests passed'); process.exit(0); },
      function (e) { console.error(e); process.exit(1); });
  });
});
setTimeout(function () { console.error('timeout'); process.exit(1); }, 30000);
