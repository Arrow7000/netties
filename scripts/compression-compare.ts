/** Run: npx vite-node scripts/compression-compare.ts [link.txt [text.txt]]
 * Benchmarks only: compares legacy JSON, experiments, and the current text envelope.
 */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { deflateRawSync, inflateRawSync, brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { examples } from '../src/core/examples';
import { print, parse } from '../src/core/text';
import { decode, toShareHash, type Doc } from '../src/state/persist';
import { sharePayload } from '../src/state/shareFormat';

// Fixed vocabulary, independent of the supplied comparison document.
const words = 'agent filled >< => ~ + - γ δ ε directions types optional required ports number expression';
const keys = 'v system net mode positions components groups types rules typing id name symbol arity filled box ports pol type label left right agents wires kind index slot side ends free dirs names'.split(' ');
const dictionary = Buffer.from(words + ' ' + keys.map(k => `"${k}":`).join(' ') + ' "kind":"agent","index": "kind":"iface","side": "kind":"port","agent": "kind":"free","name":');
const shortKeys = new Map(keys.map((k, i) => [k, String.fromCharCode(65 + i)]));
const longKeys = new Map([...shortKeys].map(([a,b]) => [b,a]));
function rename(value: any, map: Map<string,string>): any {
  if (Array.isArray(value)) return value.map(v => rename(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [map.get(k) ?? k, rename(v,map)]));
  return value;
}
function deflate(s: string, dict?: Buffer, level = 6) {
  const b = deflateRawSync(s, { level, dictionary: dict });
  assert.equal(inflateRawSync(b, { dictionary: dict }).toString(), s);
  return b.toString('base64url').length;
}
function measure(name: string, doc: Doc, text: string) {
  const json = JSON.stringify(doc);
  const compact = JSON.stringify(rename(doc, shortKeys));
  assert.deepEqual(rename(JSON.parse(compact), longKeys), doc);
  const brotli = brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  assert.equal(brotliDecompressSync(brotli).toString(), json);
  // Parse text to check validity, without claiming it preserves all session data.
  parse(text);
  return { name, jsonBytes: Buffer.byteLength(json), textBytes: Buffer.byteLength(text),
    json: deflate(json), shared: deflate(JSON.stringify(sharePayload(doc))), level9: deflate(json, undefined, 9),
    dictionary: deflate(json, dictionary), shortKeys: deflate(compact),
    shortKeysDict: deflate(compact, dictionary), brotli: brotli.toString('base64url').length,
    text: deflate(text), textDict: deflate(text, dictionary) };
}
const linkPath = process.argv[2] ?? new URL('../src/state/fixtures/share-v1.txt', import.meta.url);
const url = readFileSync(linkPath, 'utf8').trim();
const payload = url.split('#n=')[1]!;
const doc = JSON.parse(inflateRawSync(Buffer.from(payload,'base64url')).toString()) as Doc;
const decoded = decode(doc);
const text = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : print(decoded.system, decoded.net);
const supplied = measure('Supplied pair', doc, text);
console.log('URL characters:', url.length, 'payload:', payload.length);
console.table([supplied]);
console.log('Supplied text matches text printed from link:', print(decoded.system, decoded.net).trim() === text.trim());
const corpus = examples.map(ex => {
  const sys = ex.system(); const net = ex.net(sys);
  return measure(ex.name, { v: 1, system: sys.toJSON(), net: net.toJSON(), mode: 'auto' } as Doc, print(sys, net));
});
console.log(`\n${corpus.length} built-in starting examples; characters of base64url payload (excludes address/version prefix).`);
const methods = ['json','shared','level9','dictionary','shortKeys','shortKeysDict','brotli','text','textDict'] as const;
console.table(methods.map(method => {
  const total = corpus.reduce((s,r) => s+r[method],0);
  const base = corpus.reduce((s,r) => s+r.json,0);
  const savings = corpus.map(r => 100*(1-r[method]/r.json)).sort((a,b)=>a-b);
  return {method,total,saving: `${(100*(1-total/base)).toFixed(1)}%`, medianSaving: `${savings[Math.floor(savings.length/2)]!.toFixed(1)}%`, range: `${savings[0]!.toFixed(1)}–${savings.at(-1)!.toFixed(1)}%`};
}));
console.log('All compression/decompression and key-renaming round trips passed. Text rows compare a narrower representation.');

console.log('Actual supplied link payload: legacy', payload.length, 'current', (await toShareHash(doc)).slice(3).length);
