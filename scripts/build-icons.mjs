#!/usr/bin/env node
/**
 * Builds the icon library bundles in public/icons/ from upstream sources:
 *
 *  - Azure:  Microsoft Azure Architecture Icons (official SVG zip)
 *            https://learn.microsoft.com/azure/architecture/icons/
 *            Terms: permitted for architecture diagrams, training materials and documentation.
 *  - SAP:    SAP BTP solution diagram assets (Apache-2.0): BTP service icons, product logos
 *            (SAP logo + product name, as SAP's diagram guideline asks) and generic icons
 *            https://github.com/SAP/btp-solution-diagrams
 *  - Logos:  gilbarbara/logos via @iconify-json/logos (CC0-1.0) — databases, AWS, GCP,
 *            dev tools, SaaS products, languages...
 *
 * Output: public/icons/index.json + one <set>.json per set ({ id, name, category, svg }[]).
 * Re-run with `npm run icons` to refresh (e.g. when Microsoft publishes a new icon version).
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');

const AZURE_ZIP = process.env.AZURE_ICONS_URL ?? 'https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V25.zip';
const SAP_REPO = 'SAP/btp-solution-diagrams';
const SAP_DIR = 'assets/shape-libraries-and-editable-presets/svg/';

/** Shrink an SVG: drop prolog, comments, metadata, editor cruft and redundant whitespace. */
function cleanSvg(svg) {
  return svg
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/\s(xmlns:(?:sketch|inkscape|sodipodi|serif)|sketch:\w+|inkscape:\w+|sodipodi:\w+|serif:\w+)="[^"]*"/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const titleCase = (s) =>
  s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

async function fetchOk(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// ---------------- Azure ----------------
async function buildAzure() {
  console.log('Azure: downloading', AZURE_ZIP);
  const buf = new Uint8Array(await (await fetchOk(AZURE_ZIP)).arrayBuffer());
  const files = unzipSync(buf, { filter: (f) => f.name.toLowerCase().endsWith('.svg') });
  const seen = new Set();
  const icons = [];
  for (const [path, data] of Object.entries(files)) {
    // .../Icons/<category>/<num>-icon-service-<Name>.svg
    const parts = path.split('/');
    const file = parts.pop();
    const category = titleCase(parts.pop() ?? 'Other');
    const name = file
      .replace(/\.svg$/i, '')
      .replace(/^\d+-icon-service-/i, '')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // same service listed under several categories
    seen.add(key);
    icons.push({ id: `azure:${key.replace(/\W+/g, '-')}`, name, category, svg: cleanSvg(strFromU8(data)) });
  }
  icons.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return {
    id: 'azure',
    name: 'Azure',
    source: 'https://learn.microsoft.com/azure/architecture/icons/',
    license: 'Microsoft Azure Architecture Icons — permitted for architecture diagrams, training materials and documentation.',
    icons,
  };
}

// ---------------- SAP ----------------
const SAP_WORDS = {
  sap: 'SAP', btp: 'BTP', ai: 'AI', api: 'API', apis: 'APIs', abap: 'ABAP', ui5: 'UI5', ui: 'UI', html5: 'HTML5',
  s4hana: 'S/4HANA', hana: 'HANA', pki: 'PKI', alm: 'ALM', iot: 'IoT', it: 'IT', cx: 'CX', erp: 'ERP',
  odata: 'OData', saas: 'SaaS', paas: 'PaaS', b2b: 'B2B', b2g: 'B2G', bw: 'BW', hr: 'HR', ux: 'UX', mdm: 'MDM',
  and: 'and', for: 'for', of: 'of', the: 'the', on: 'on', to: 'to', with: 'with', in: 'in',
};
const sapName = (file) =>
  file
    .replace(/\.svg$/i, '')
    .replace(/^\d+-/, '')
    .replace(/_sd$/i, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w, i) => SAP_WORDS[w.toLowerCase()] && !(i === 0 && /^[a-z]+$/.test(SAP_WORDS[w.toLowerCase()]))
      ? SAP_WORDS[w.toLowerCase()]
      : w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** draw.io shape libraries in the same repo (found by file name, wherever they live in the tree). */
const SAP_LIBS = {
  brands: 'sap_brand_names.xml',
  generic: 'sap-generic-icons-size-M-200302.xml',
};

/** `<mxlibrary>[{title, xml?, data?, w, h}, ...]</mxlibrary>` → entries. */
function parseMxLibrary(text) {
  const json = text.trim().replace(/^<mxlibrary>/, '').replace(/<\/mxlibrary>$/, '');
  return JSON.parse(json);
}

const decodeEntities = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** SVG embedded in a draw.io cell: `image=data:image/svg+xml,<base64>` in the style, or a `data:` URI entry. */
function embeddedSvg(entry) {
  const uri = entry.data ?? /image=(data:image\/svg\+xml[^;"]*)/.exec(decodeEntities(entry.xml ?? ''))?.[1];
  if (!uri) return null;
  const m = /^data:image\/svg\+xml(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  // draw.io stores base64 without the ";base64" marker in styles; try base64 first, then URL-encoding.
  const b64 = Buffer.from(m[2], 'base64').toString('utf8');
  return b64.includes('<svg') ? b64 : decodeURIComponent(m[2]);
}

/** Make sure the root <svg> has a viewBox, so it scales once width/height are replaced. */
function ensureViewBox(svg) {
  return svg.replace(/<svg\b([^>]*)>/i, (tag, attrs) => {
    if (/viewBox=/i.test(attrs)) return tag;
    const w = /\swidth="([\d.]+)/.exec(attrs)?.[1], h = /\sheight="([\d.]+)/.exec(attrs)?.[1];
    return w && h ? `<svg${attrs} viewBox="0 0 ${w} ${h}">` : tag;
  });
}

/** Arial/Helvetica Bold advance widths (1/1000 em) for composing product lockups. */
const BOLD_WIDTHS = {
  ' ': 278, '/': 278, '-': 333, '.': 278, '&': 722,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
  n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
};
const textWidth = (s, size) => [...s].reduce((w, ch) => w + (BOLD_WIDTHS[ch] ?? (/\d/.test(ch) ? 556 : 611)), 0) * size / 1000;

/**
 * SAP products without an official lockup in the repo. Rendered the way SAP's guideline asks
 * (product name paired with the SAP logo): the logo from an official lockup + the name in bold Arial.
 */
const SAP_COMPOSED_PRODUCTS = ['Fieldglass', 'BTP', 'ECC', 'BW/4HANA', 'Business One', 'Business ByDesign', 'Analytics Cloud', 'Datasphere'];

function sapProducts(entries) {
  const out = [];
  let logoPart = null; // <defs>…</defs><polyline …/><path …white "SAP"…/> from an official lockup
  for (const e of entries) {
    const svg = embeddedSvg(e);
    if (!svg) continue; // "(Text Only)" entries are just styled text
    const name = e.title.replace(/\s*\(Default\)$/, '').trim();
    if (!logoPart && /S\/4HANA \(Default\)/.test(e.title)) {
      logoPart = /<defs>[\s\S]*?<\/defs>\s*<polyline[^>]*\/>\s*<path[^>]*fill="#fff"[^>]*\/>/.exec(svg)?.[0] ?? null;
    }
    out.push({ id: `sap:product-${name.toLowerCase().replace(/\W+/g, '-')}`, name, category: 'SAP Products', svg: cleanSvg(svg), wordmark: true });
  }
  if (logoPart) {
    // Geometry of the official lockups: 80.5×39.8 logo, product name from x≈87, cap height 24.8, colour #002a86.
    const size = 34.6, x = 87;
    for (const product of SAP_COMPOSED_PRODUCTS) {
      const name = `SAP ${product}`;
      if (out.some((i) => i.name === name)) continue;
      const w = (x + textWidth(product, size) + 1).toFixed(2);
      const text = product.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 39.832">${logoPart}` +
        `<text x="${x}" y="32.19" fill="#002a86" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}">${text}</text></svg>`;
      out.push({ id: `sap:product-${name.toLowerCase().replace(/\W+/g, '-')}`, name, category: 'SAP Products', svg, wordmark: true });
    }
  } else {
    console.warn('SAP: S/4HANA lockup not found; skipping composed product logos');
  }
  return out;
}

/** "User SAP Size M" / "AI Highlight-Size M" / "AI Agent M" → { name, variant }. */
function sapGeneric(entries) {
  const out = [];
  const seen = new Set();
  for (const e of entries) {
    const svg = embeddedSvg(e);
    if (!svg) continue;
    const t = e.title.replace(/[-\s]*Size\s+[SML]$/i, '').replace(/\s+M$/, '').trim();
    const m = /^(.*?)[\s-]+(Highlight|Non-SAP|SAP)$/i.exec(t);
    const base = (m ? m[1] : t).replace(/-/g, ' ');
    const variant = m ? m[2] : 'SAP';
    const key = `${base}-${variant}`.toLowerCase().replace(/\W+/g, '-');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `sap:generic-${key}`, name: base, category: `Generic Icons (${variant})`, svg: cleanSvg(ensureViewBox(svg)) });
  }
  return out;
}

async function buildSap() {
  console.log('SAP: listing', SAP_REPO);
  const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const tree = await (await fetchOk(`https://api.github.com/repos/${SAP_REPO}/git/trees/main?recursive=1`, { headers })).json();
  const paths = tree.tree.map((t) => t.path).filter((p) => p.startsWith(SAP_DIR) && p.endsWith('.svg'));
  console.log(`SAP: downloading ${paths.length} icons`);
  const fetched = [];
  const queue = [...paths];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let p; (p = queue.shift()); ) {
        const url = `https://raw.githubusercontent.com/${SAP_REPO}/main/${p.split('/').map(encodeURIComponent).join('/')}`;
        const svg = await (await fetchOk(url)).text();
        const file = p.slice(SAP_DIR.length);
        const name = sapName(file);
        fetched.push({ file, icon: { id: `sap:${name.toLowerCase().replace(/\W+/g, '-')}`, name, category: 'SAP BTP Services', svg: cleanSvg(svg) } });
      }
    }),
  );
  // A few services exist twice upstream under different numbers; keep the newest (highest number).
  const icons = [];
  const ids = new Set();
  for (const { icon } of fetched.sort((a, b) => b.file.localeCompare(a.file, 'en', { numeric: true }))) {
    if (ids.has(icon.id)) continue;
    ids.add(icon.id);
    icons.push(icon);
  }
  const libs = Object.fromEntries(
    await Promise.all(
      Object.entries(SAP_LIBS).map(async ([key, file]) => {
        const path = tree.tree.find((t) => t.path.endsWith(`/${file}`))?.path;
        if (!path) throw new Error(`${file} not found in ${SAP_REPO}`);
        const url = `https://raw.githubusercontent.com/${SAP_REPO}/main/${path.split('/').map(encodeURIComponent).join('/')}`;
        return [key, parseMxLibrary(await (await fetchOk(url)).text())];
      }),
    ),
  );
  const products = sapProducts(libs.brands);
  const generic = sapGeneric(libs.generic);
  console.log(`SAP: ${products.length} product logos, ${generic.length} generic icons`);
  icons.push(...products, ...generic);
  const catOrder = ['SAP Products', 'SAP BTP Services'];
  const rank = (c) => (catOrder.includes(c) ? catOrder.indexOf(c) : catOrder.length);
  icons.sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return {
    id: 'sap',
    name: 'SAP',
    source: 'https://github.com/SAP/btp-solution-diagrams',
    license: 'Apache-2.0 (SAP SE). SAP and SAP product names are trademarks of SAP SE.',
    keepCategoryOrder: true,
    icons,
  };
}

// ---------------- Logos (Iconify) ----------------
const LOGO_CATEGORIES = [
  ['Databases', /^(postgresql|mysql|mariadb|mongodb|redis|sqlite|oracle|cassandra|elasticsearch|neo4j|couchbase|couchdb|influxdb|snowflake|supabase|firebase|fauna|planetscale|cockroach|clickhouse|timescale|dgraph|arangodb|rethinkdb|realm|prisma|hasura|memcached|scylla|singlestore|tidb|yugabyte|questdb|duckdb|surrealdb|xata|neon|turso|dynamodb|aws-dynamodb|aws-rds|aws-aurora|aws-redshift|aws-elasticache|aws-documentdb|aws-neptune|aws-timestream|aws-keyspaces|google-cloud-sql|bigquery|google-bigquery|databricks|apache-druid|apache-pinot|hbase|hive|presto|trino|sap-hana|db2|ibm-db2|teradata|vertica|greenplum|pouchdb|mssql|microsoft-sql)/],
  ['AWS', /^aws/],
  ['Google Cloud', /^(google-cloud|gcp|firebase|google-bigquery|bigquery)/],
  ['Microsoft', /^(microsoft|azure|visual-studio|dotnet|c-sharp|typescript|power-bi|bing|github|xbox|windows|skype|linkedin)/],
  ['Messaging & Streaming', /^(kafka|apache-kafka|rabbitmq|nats|pulsar|apache-pulsar|activemq|zeromq|mqtt|redpanda|confluent|kinesis)/],
  ['DevOps & Infra', /^(docker|kubernetes|helm|terraform|ansible|vagrant|packer|consul|vault|nomad|jenkins|circleci|travis|gitlab|bitbucket|argo|flux|prometheus|grafana|datadog|new-relic|sentry|nginx|apache|traefik|istio|envoy|linkerd|openshift|rancher|podman|cloudflare|vercel|netlify|heroku|digital-ocean|linode|vultr|hetzner|openstack|vmware|proxmox|elastic|kibana|logstash|splunk|pagerduty|opentelemetry|jaeger)/],
  ['Languages & Frameworks', /^(python|java|javascript|typescript|go|golang|rust|ruby|php|c-plusplus|c|kotlin|swift|scala|dart|flutter|elixir|erlang|haskell|clojure|lua|perl|r-lang|julia|nodejs|deno|bun|react|vue|angular|svelte|nextjs|nuxt|remix|astro|solid|ember|spring|django|flask|fastapi|rails|laravel|symfony|express|nestjs|graphql|redux|tailwind|bootstrap|sass|webpack|vite|babel|jest|vitest|cypress|playwright|electron|tensorflow|pytorch|numpy|pandas|jupyter|openai|hugging-face|langchain)/],
];
/** Match whole dash-separated tokens: "c" matches "c" and "c-sharp" but not "clickup". */
const categoryFor = (name) =>
  LOGO_CATEGORIES.find(([, re]) => new RegExp(`${re.source}(-|$)`).test(name))?.[0] ?? 'Products & Brands';

function iconifyToSvg(set, name) {
  const icon = set.icons[name];
  const w = icon.width ?? set.width ?? 16;
  const h = icon.height ?? set.height ?? 16;
  const left = icon.left ?? 0, top = icon.top ?? 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${left} ${top} ${w} ${h}" width="${w}" height="${h}">${icon.body}</svg>`;
}

async function buildLogos() {
  const set = JSON.parse(await readFile(require.resolve('@iconify-json/logos/icons.json'), 'utf8'));
  const names = Object.keys(set.icons).filter((n) => !set.icons[n].hidden);
  const icons = names.map((n) => ({
    id: `logos:${n}`,
    name: titleCase(n.replace(/-icon(-alt)?$/, '')) + (/-icon(-alt)?$/.test(n) ? ' (icon)' : ''),
    category: categoryFor(n),
    svg: iconifyToSvg(set, n),
  }));
  icons.sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: 'logos',
    name: 'Tech logos',
    source: 'https://github.com/gilbarbara/logos',
    license: 'CC0-1.0 (artwork). Logos are trademarks of their respective owners.',
    icons,
  };
}

// ---------------- main ----------------
const builders = { azure: buildAzure, sap: buildSap, logos: buildLogos };
const only = process.argv.slice(2);
await mkdir(outDir, { recursive: true });

let index = [];
try {
  index = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8')).sets ?? [];
} catch {
  /* first run */
}

for (const [id, build] of Object.entries(builders)) {
  if (only.length && !only.includes(id)) continue;
  try {
    const set = await build();
    const { keepCategoryOrder, ...data } = set;
    const categories = [...new Set(set.icons.map((i) => i.category))];
    if (!keepCategoryOrder) categories.sort();
    await writeFile(join(outDir, `${id}.json`), JSON.stringify(data));
    index = index.filter((s) => s.id !== id);
    index.push({ id, name: set.name, count: set.icons.length, categories, source: set.source, license: set.license, file: `${id}.json` });
    console.log(`${set.name}: ${set.icons.length} icons in ${categories.length} categories`);
  } catch (e) {
    console.error(`Failed to build ${id}:`, e.message);
    process.exitCode = 1;
  }
}

const order = ['azure', 'sap', 'logos'];
index.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
await writeFile(join(outDir, 'index.json'), JSON.stringify({ generated: new Date().toISOString(), sets: index }, null, 2));
