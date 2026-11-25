// scripts/filter-ru.mjs
import fs from "node:fs";
import dns from "node:dns/promises";

const SUB_URL = "https://sub.vlessfo.ru/vlessforu/working_configs.txt";
const OUT_FILE = "non_ru.txt";

// ── Читаем RU_V4 / RU_V6 прямо из app/ruRanges.jsx ──
const rangesSrc = fs.readFileSync("app/ruRanges.jsx", "utf8");
const RU_V4 = rangesSrc.match(/export const RU_V4 =\s*"([^"]+)"/)?.[1];
const RU_V6 = rangesSrc.match(/export const RU_V6 =\s*"([^"]+)"/)?.[1];
if (!RU_V4 || !RU_V6) {
   throw new Error("Не удалось прочитать RU_V4/RU_V6 из app/ruRanges.jsx");
}

function decode(b64) {
   const bin = atob(b64);
   const starts = [],
      ends = [];
   let pos = 0,
      prev = 0;
   const varint = () => {
      let n = 0,
         mul = 1,
         b;
      do {
         b = bin.charCodeAt(pos++);
         n += (b & 127) * mul;
         mul *= 128;
      } while (b >= 128);
      return n;
   };
   while (pos < bin.length) {
      const s = prev + varint();
      const e = s + varint();
      starts.push(s);
      ends.push(e);
      prev = e;
   }
   return { starts: Float64Array.from(starts), ends: Float64Array.from(ends) };
}

const T4 = decode(RU_V4);
const T6 = decode(RU_V6);

function inRanges(t, x) {
   let lo = 0,
      hi = t.starts.length - 1;
   while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (x < t.starts[mid]) hi = mid - 1;
      else if (x > t.ends[mid]) lo = mid + 1;
      else return true;
   }
   return false;
}

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const FLAG_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
const stripBrackets = (h) => h.replace(/^\[|\]$/g, "");

function v6Top48(s) {
   const [h, t] = s.toLowerCase().split("::");
   const hs = h ? h.split(":") : [];
   const ts = t ? t.split(":") : [];
   const fill = s.includes("::") ? Math.max(0, 8 - hs.length - ts.length) : 0;
   const g = [...hs, ...Array(fill).fill("0"), ...ts].map((x) =>
      parseInt(x || "0", 16),
   );
   if (g.length < 3 || g.slice(0, 3).some(Number.isNaN)) return null;
   return (g[0] * 65536 + g[1]) * 65536 + g[2];
}

function isRuIp(ip) {
   ip = stripBrackets(ip);
   const m = V4_RE.exec(ip);
   if (m) {
      const o = m.slice(1).map(Number);
      if (o.some((x) => x > 255)) return null;
      return inRanges(T4, ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3]);
   }
   if (ip.includes(":")) {
      const k = v6Top48(ip);
      return k == null ? null : inRanges(T6, k);
   }
   return null;
}

function codeToFlag(code) {
   if (!code || !/^[A-Z]{2}$/i.test(code)) return "";
   const c = code.toUpperCase();
   return String.fromCodePoint(
      0x1f1e6 + c.charCodeAt(0) - 65,
      0x1f1e6 + c.charCodeAt(1) - 65,
   );
}

function parseVmess(line) {
   const raw = line.slice(8).split("#")[0].trim();
   const pad = raw + "=".repeat((4 - (raw.length % 4)) % 4);
   return JSON.parse(
      Buffer.from(pad.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
         "utf8",
      ),
   );
}

function extractFlagFromLine(line) {
   if (line.startsWith("vmess://")) {
      try {
         const obj = parseVmess(line);
         const m = FLAG_RE.exec(String(obj.ps || ""));
         return m ? m[0] : "";
      } catch {
         return "";
      }
   }
   const hashIdx = line.indexOf("#");
   if (hashIdx === -1) return "";
   const frag = line.slice(hashIdx + 1);
   let decoded = frag;
   try {
      decoded = decodeURIComponent(frag);
   } catch {}
   const m = FLAG_RE.exec(decoded);
   return m ? m[0] : "";
}

function setRemark(line, newName) {
   if (line.startsWith("vmess://")) {
      try {
         const obj = parseVmess(line);
         obj.ps = newName;
         return (
            "vmess://" +
            Buffer.from(JSON.stringify(obj), "utf8").toString("base64")
         );
      } catch {
         return line;
      }
   }
   const hashIdx = line.indexOf("#");
   const base = hashIdx === -1 ? line : line.slice(0, hashIdx);
   return `${base}#${encodeURIComponent(newName)}`;
}

const dnsCache = new Map();
async function resolveHost(host) {
   if (dnsCache.has(host)) return dnsCache.get(host);
   const ips = [];
   const [v4, v6] = await Promise.allSettled([
      dns.resolve4(host),
      dns.resolve6(host),
   ]);
   if (v4.status === "fulfilled") ips.push(...v4.value);
   if (v6.status === "fulfilled") ips.push(...v6.value);

   if (!ips.length) {
      for (const type of ["A", "AAAA"]) {
         try {
            const r = await fetch(
               `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
               { headers: { accept: "application/dns-json" } },
            );
            if (r.ok) {
               const j = await r.json();
               const want = type === "A" ? 1 : 28;
               for (const a of j.Answer || []) {
                  if (a.type === want) ips.push(a.data);
               }
            }
         } catch {}
      }
   }
   dnsCache.set(host, ips);
   return ips;
}

async function lookupCountryFlags(ips) {
   const map = new Map();
   const unique = [...new Set(ips.filter(Boolean))];
   for (let i = 0; i < unique.length; i += 100) {
      const chunk = unique.slice(i, i + 100);
      try {
         const ctrl = new AbortController();
         const tid = setTimeout(() => ctrl.abort(), 5000);
         const r = await fetch(
            "http://ip-api.com/batch?fields=status,query,countryCode",
            {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify(chunk),
               signal: ctrl.signal,
            },
         );
         clearTimeout(tid);
         if (r.ok) {
            const arr = await r.json();
            for (const item of arr) {
               if (item?.status === "success" && item.countryCode) {
                  map.set(item.query, codeToFlag(item.countryCode));
               }
            }
         }
      } catch {}
   }
   return map;
}

function extractHost(line) {
   if (line.startsWith("vmess://")) {
      try {
         const json = parseVmess(line);
         return json.add ? stripBrackets(String(json.add).trim()) : null;
      } catch {
         return null;
      }
   }
   if (line.startsWith("ss://")) {
      const body = line.slice(5).split("#")[0].split("?")[0];
      if (!body.includes("@")) {
         try {
            const decoded = Buffer.from(body, "base64").toString("utf8");
            const m = /@(\[[^\]]+\]|[^:/?#]+):(\d+)/.exec(decoded);
            if (m) return stripBrackets(m[1]);
         } catch {}
      }
   }
   try {
      const u = new URL(line);
      if (u.hostname) return stripBrackets(u.hostname);
   } catch {}
   const m = /@(\[[^\]]+\]|[^:/?#]+):(\d+)/.exec(line);
   return m ? stripBrackets(m[1]) : null;
}

function decodeSubText(text) {
   const trimmed = text.trim();
   if (!trimmed.includes("://") && /^[A-Za-z0-9+/=_\-\r\n]+$/.test(trimmed)) {
      try {
         const decoded = Buffer.from(
            trimmed.replace(/\s+/g, ""),
            "base64",
         ).toString("utf8");
         if (decoded.includes("://")) return decoded;
      } catch {}
   }
   return trimmed;
}

async function main() {
   const res = await fetch(SUB_URL, {
      headers: { "User-Agent": "v2rayN/7.0" },
   });
   if (!res.ok) throw new Error(`HTTP ${res.status} при скачивании подписки`);

   const rawText = decodeSubText(await res.text());
   const lines = [
      ...new Set(
         rawText
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(
               (l) =>
                  l &&
                  !l.startsWith("#") &&
                  !l.startsWith("//") &&
                  l.includes("://"),
            ),
      ),
   ];

   const kept = [];
   let droppedRu = 0;

   for (let i = 0; i < lines.length; i += 30) {
      const chunk = lines.slice(i, i + 30);
      await Promise.all(
         chunk.map(async (line) => {
            const host = extractHost(line);
            if (!host) return;
            const lit = isRuIp(host);
            if (lit === true) {
               droppedRu++;
               return;
            }
            let ip = lit === false ? host : null;
            if (lit === null && !host.includes(":")) {
               const ips = await resolveHost(host);
               if (ips.some((x) => isRuIp(x) === true)) {
                  droppedRu++;
                  return;
               }
               ip = ips[0] || null;
            }
            kept.push({ line, ip });
         }),
      );
   }

   const flagByIp = await lookupCountryFlags(kept.map((x) => x.ip));

   const renamed = kept.map(({ line, ip }) => {
      const flag =
         (ip && flagByIp.get(ip)) || extractFlagFromLine(line) || "🌐";
      return setRemark(line, `s${flag}`);
   });

   // Дедупликация после переименования
   const uniqueOut = [...new Set(renamed)];
   fs.writeFileSync(
      OUT_FILE,
      uniqueOut.join("\n") + (uniqueOut.length ? "\n" : ""),
      "utf8",
   );
   console.log(
      `Всего: ${lines.length}, отсеяно RU: ${droppedRu}, осталось: ${uniqueOut.length}`,
   );
}

main().catch((err) => {
   console.error(err);
   process.exit(1);
});
