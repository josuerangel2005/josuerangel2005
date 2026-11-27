// Renders assets/card.svg (fastfetch-style card) and assets/habits.svg
// (commit habits panel) from public GitHub data.
// Usage: GITHUB_TOKEN=... node src/generate.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const profile = JSON.parse(await readFile(new URL("src/profile.json", root), "utf8"));
const ascii = (await readFile(new URL("src/ascii.txt", root), "utf8")).replace(/\s+$/, "").split("\n");
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");

const headers = { Authorization: `bearer ${token}`, "User-Agent": "profile-card-generator" };

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

async function fetchStats(login) {
  const { user } = await gql(
    `query($login: String!) {
      user(login: $login) {
        followers { totalCount }
        contributionsCollection { contributionCalendar { totalContributions } }
        repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
          totalCount
          nodes {
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name color } }
            }
          }
        }
      }
    }`,
    { login },
  );
  const langs = new Map();
  let stars = 0;
  for (const repo of user.repositories.nodes) {
    stars += repo.stargazerCount;
    for (const { size, node } of repo.languages.edges) {
      const prev = langs.get(node.name) ?? { size: 0, color: node.color ?? "#8b949e" };
      prev.size += size;
      langs.set(node.name, prev);
    }
  }
  const total = [...langs.values()].reduce((a, l) => a + l.size, 0) || 1;
  const languages = [...langs.entries()]
    .map(([name, l]) => ({ name, color: l.color, pct: (l.size / total) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  return {
    repos: user.repositories.totalCount,
    stars,
    followers: user.followers.totalCount,
    contribs: user.contributionsCollection.contributionCalendar.totalContributions,
    languages,
  };
}

// Commits authored in the last year, bucketed by the author's local hour and weekday.
async function fetchHabits(login) {
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const hours = Array(24).fill(0);
  const days = Array(7).fill(0); // Mon..Sun
  let count = 0;
  for (let page = 1; page <= 10; page++) {
    const q = encodeURIComponent(`author:${login} author-date:>=${since}`);
    const res = await fetch(
      `https://api.github.com/search/commits?q=${q}&per_page=100&page=${page}`,
      { headers: { ...headers, Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) break;
    const { items = [] } = await res.json();
    for (const item of items) {
      // e.g. 2026-11-20T15:03:11.000-04:00 -> keep the author's local wall clock
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(item.commit.author.date);
      if (!m) continue;
      hours[Number(m[4])]++;
      const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); // 0 = Sun
      days[(dow + 6) % 7]++;
      count++;
    }
    if (items.length < 100) break;
  }
  return { hours, days, count };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Palette from the system "Gentleman-Cute" theme (ghostty.conf).
const C = {
  bg: "#060407",
  win: "#060407",
  border: "#2A1720",
  text: "#F6EFF3",
  dim: "#76616B",
  key: "#A9C7EE",
  accent: "#F095C8",
  green: "#B4E7C7",
};
const FONT = `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"`;

// Blinking block cursor. Uses a CSS animation: GitHub serves SVGs with a
// CSP that blocks SMIL (<animate>) but allows inline styles.
const cursor = (x, y, h = 14) =>
  `<rect class="cursor" x="${x}" y="${y - h + 3}" width="${Math.round(h * 0.6)}" height="${h}" fill="${C.text}"/>`;
const CURSOR_CSS = `<style>@keyframes blink{50%{opacity:0}}.cursor{animation:blink 1.06s steps(1) infinite}</style>`;

function windowFrame(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${C.win}" stroke="${C.border}"/>
  <path d="M0.5 32 H${width - 0.5}" stroke="${C.border}"/>
  ${CURSOR_CSS}
  <circle cx="20" cy="16" r="6" fill="#FF718F"/><circle cx="40" cy="16" r="6" fill="#F2B86D"/><circle cx="60" cy="16" r="6" fill="#B4E7C7"/>
  <text x="${width / 2}" y="20" text-anchor="middle" font-size="11" fill="${C.dim}" ${FONT}>${esc(title)}</text>
  ${body}
</svg>
`;
}

function renderCard(stats) {
  const W = 860;
  const artLine = 10.5;
  const artTop = 52;
  const art = ascii
    // Position each run of glyphs by column so no renderer can collapse the spaces.
    .map((l, i) =>
      [...l.matchAll(/\S+/g)]
        .map((m) => `<text x="${(24 + m.index * 6).toFixed(1)}" y="${artTop + i * artLine}" textLength="${m[0].length * 6}">${esc(m[0])}</text>`)
        .join(""),
    )
    .join("");

  const x = 400;
  let y = 60;
  const step = 19;
  const rows = [];
  const header = `${profile.login}@${profile.host}`;
  rows.push(`<text x="${x}" y="${y}" fill="${C.accent}" font-weight="bold">${esc(header)}</text>`);
  y += 8;
  rows.push(`<path d="M${x} ${y} h${header.length * 7.8}" stroke="${C.dim}"/>`);
  y += step;
  const charW = 7.9; // approx. advance of a 13px monospace glyph
  const maxChars = Math.floor((W - x - 20) / charW);
  // Wrap a value onto continuation lines aligned after "Key: ".
  const wrap = (text, first, rest) => {
    // Hard-split any single word (e.g. a URL) longer than the line.
    const words = text.split(" ").flatMap((w) => w.match(new RegExp(`.{1,${rest}}`, "g")) ?? [w]);
    const out = [];
    let cur = "";
    for (const w of words) {
      const limit = out.length ? rest : first;
      // Keep separators at the end of a line, never at the start of the next one.
      if (cur && w !== "·" && (cur + " " + w).length > limit) {
        out.push(cur);
        cur = w;
      } else cur = cur ? cur + " " + w : w;
    }
    if (cur) out.push(cur);
    return out;
  };
  const line = (k, v) => {
    const indent = k.length + 2;
    const parts = wrap(v, maxChars - indent, maxChars - indent);
    parts.forEach((p, i) => {
      const label = i === 0 ? `<tspan fill="${C.key}" font-weight="bold">${esc(k)}</tspan><tspan fill="${C.text}">: ` : `<tspan fill="${C.text}" dx="${indent * charW}">`;
      rows.push(`<text x="${x}" y="${y}">${label}${esc(p)}</tspan></text>`);
      y += step;
    });
  };
  for (const [k, v] of profile.fields) if (v) line(k, v.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));
  line("Repos", `${stats.repos} · Stars ${stats.stars} · Followers ${stats.followers} · Contribs ${stats.contribs}`);

  // Language bar
  const top = stats.languages.slice(0, 5);
  const barW = W - x - 20 - 56;
  rows.push(`<text x="${x}" y="${y}" fill="${C.key}" font-weight="bold">Langs</text>`);
  let bx = x + 56;
  for (const l of top) {
    const w = (l.pct / 100) * barW;
    rows.push(`<rect x="${bx.toFixed(1)}" y="${y - 9}" width="${Math.max(w - 2, 1).toFixed(1)}" height="9" rx="2" fill="${l.color}"/>`);
    bx += w;
  }
  y += step;
  let lx = x;
  for (const l of top) {
    const label = `● ${l.name} ${l.pct.toFixed(0)}%`;
    if (lx + label.length * 7 > W - 20) {
      lx = x;
      y += 16;
    }
    rows.push(`<text x="${lx}" y="${y}" font-size="11"><tspan fill="${l.color}">●</tspan><tspan fill="${C.text}">${esc(label.slice(1))}</tspan></text>`);
    lx += label.length * 7 + 14;
  }
  y += step + 4;
  // Color palette blocks, like fastfetch
  const palette = ["#FF718F", "#F2B86D", "#E0C27A", "#B4E7C7", "#A9C7EE", "#F095C8", "#B9E3E8", "#F6EFF3"];
  palette.forEach((c, i) => rows.push(`<rect x="${x + i * 26}" y="${y - 12}" width="26" height="14" fill="${c}"/>`));
  y += step + 6;
  rows.push(`<text x="${x}" y="${y}" fill="${C.green}">❯</text>`, cursor(x + 18, y));

  const H = Math.max(artTop + ascii.length * artLine + 20, y + 24);
  const body = `<g font-size="10" fill="${C.accent}" opacity="0.9" ${FONT}>${art}</g>
  <g font-size="13" ${FONT}>${rows.join("\n  ")}</g>`;
  return windowFrame(W, Math.ceil(H), `${profile.login}@${profile.host}: ~ — fastfetch`, body);
}

function renderHabits({ hours, days, count }) {
  const W = 860;
  const H = 320;
  const cell = 8; // square cell size
  const gap = 2;
  const parts = [];
  parts.push(
    `<text x="24" y="60" fill="${C.text}"><tspan fill="${C.green}">❯</tspan> git log --since=1.year --author=${esc(profile.login)} | habits</text>`,
  );

  // Hour histogram: each column is a stack of square cells.
  parts.push(`<text x="24" y="96" fill="${C.key}" font-weight="bold">commits by hour (author local time)</text>`);
  const maxH = Math.max(...hours, 1);
  const peak = hours.indexOf(maxH);
  const levels = 12;
  const base = 230; // bottom of the histogram
  const colW = 21;
  hours.forEach((v, i) => {
    const cx = 24 + i * colW;
    const n = v ? Math.max(1, Math.round((v / maxH) * levels)) : 0;
    if (!n) {
      parts.push(`<rect x="${cx + 4}" y="${base - 2}" width="${colW - 12}" height="1.5" fill="${C.border}"/>`);
      return;
    }
    const fill = i === peak ? C.accent : C.key;
    for (let k = 0; k < n; k++) {
      parts.push(`<rect x="${cx}" y="${base - (k + 1) * (cell + gap) + gap}" width="${colW - 4}" height="${cell}" fill="${fill}" opacity="0.9"/>`);
    }
  });
  [0, 6, 12, 18, 23].forEach((h) =>
    parts.push(`<text x="${24 + h * colW}" y="${base + 16}" font-size="10" fill="${C.dim}">${String(h).padStart(2, "0")}</text>`),
  );

  // Weekday rows: filled cells over a dim track.
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const maxD = Math.max(...days, 1);
  const busiest = days.indexOf(maxD);
  const dx = 580;
  const track = 18;
  parts.push(`<text x="${dx}" y="96" fill="${C.key}" font-weight="bold">commits by weekday</text>`);
  days.forEach((v, i) => {
    const yy = 118 + i * 18;
    const n = v ? Math.max(1, Math.round((v / maxD) * track)) : 0;
    parts.push(`<text x="${dx}" y="${yy}" fill="${C.key}" font-weight="bold">${names[i]}</text>`);
    for (let k = 0; k < track; k++) {
      const on = k < n;
      parts.push(
        `<rect x="${dx + 36 + k * (cell + 1)}" y="${yy - 10}" width="${cell}" height="11" fill="${on ? (i === busiest ? C.accent : C.key) : C.border}" opacity="${on ? 0.9 : 0.5}"/>`,
      );
    }
    parts.push(`<text x="${dx + 36 + track * (cell + 1) + 8}" y="${yy}" fill="${C.text}">${v}</text>`);
  });

  // Summary + idle prompt
  const pad = (n) => String(n).padStart(2, "0");
  const kind = peak < 6 ? "night owl" : peak < 12 ? "early bird" : peak < 19 ? "daytime coder" : "evening coder";
  const sep = `<tspan fill="${C.dim}">  ·  </tspan>`;
  parts.push(
    `<text x="24" y="276" fill="${C.text}" xml:space="preserve"><tspan fill="${C.green}">→</tspan> <tspan fill="${C.key}" font-weight="bold">${count}</tspan> commits${sep}busiest day <tspan fill="${C.key}" font-weight="bold">${names[busiest]}</tspan>${sep}peak <tspan fill="${C.key}" font-weight="bold">${pad(peak)}:00–${pad((peak + 1) % 24)}:00</tspan>${sep}<tspan fill="${C.accent}" font-weight="bold">${kind}</tspan></text>`,
  );
  parts.push(`<text x="24" y="302" fill="${C.green}">❯</text>`, cursor(24 + 16, 302, 13));
  return windowFrame(W, H, `${profile.login}@${profile.host}: ~ — git habits`, `<g font-size="12" ${FONT}>${parts.join("\n  ")}</g>`);
}

const [stats, habits] = await Promise.all([fetchStats(profile.login), fetchHabits(profile.login)]);
await mkdir(new URL("assets/", root), { recursive: true });
await writeFile(new URL("assets/card.svg", root), renderCard(stats));
await writeFile(new URL("assets/habits.svg", root), renderHabits(habits));
console.log(`card.svg + habits.svg written (${stats.repos} repos, ${habits.count} commits)`);
