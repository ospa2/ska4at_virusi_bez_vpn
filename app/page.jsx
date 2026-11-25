//page.js
"use client";
import { useState, useCallback, useRef, useMemo, useEffect, memo } from "react";
import { classifyHosts, GEO_RU, GEO_OTHER, GEO_UNKNOWN } from "./geoRu.jsx";
import { parseAndDedupe, toCopyString } from "./proxyParsing.js";
const BG = "#0b0e11";
const BORDER = "#1e2a38";
const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const RED = "#ef4444";
const BLUE = "#38bdf8";
const MUTED = "#4b5a6e";
const TEXT = "#c9d8e8";
const MONO = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";
​
// Имена файлов из присланного списка Hidashimora, без предположений о
// существовании других файлов. При изменении каталога список нужно обновить.
const HIDASHIMORA_IDS = [
   ...[1, 2, 3, 5, 6, 8, 9, 11, 13, 14, 15, 17, 19, 20, 21, 22,
      23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34].map(String),
   ...Array.from({ length: 26 }, (_, index) => `1.${index + 1}`),
   ...Array.from({ length: 25 }, (_, index) => index + 2)
      .flatMap((number) => [`${number}.1`, `${number}.2`]),
   ...[28, 32, 33].flatMap((number) => [`${number}.1`, `${number}.2`]),
];
​
// Публичные подписки. Содержимое считается недоверенным.
const PUBLIC_SOURCES = [
   ["merge-vpn", "https://raw.githubusercontent.com/xenon-jpg/merge-vpn/refs/heads/main/merged.txt"],
   ["ASTROVPNLINK_VPN", "https://raw.githubusercontent.com/Incognito-vpn/ASTROVPNLINK_VPN/refs/heads/main/VPN"],
   ["vpn-vless-configs-russia", "https://raw.githubusercontent.com/kort0881/vpn-vless-configs-russia/refs/heads/main/output/vless.txt"],
   ["all_subs", "https://raw.githubusercontent.com/solovyov-jenya2004/all_subs/refs/heads/main/final_sorted"],
   ["vpn-free-russia", "https://raw.githubusercontent.com/aviamastersgh/vpn-free-russia/refs/heads/main/all_configs.txt"],
   ["китайское чето там", "https://raw.githubusercontent.com/cbusifabcap/daily_free_vpn/refs/heads/main/Z.txt"],
   ["tot чето от то", "https://raw.githubusercontent.com/Maskkost93/kizyak-vpn-4.0/refs/heads/main/kizyakbeta7.txt"],
   ['2фыв', "https://raw.githubusercontent.com/Maskkost93/kizyak-vpn-4.0/refs/heads/main/kizyakbeta8.txt"],
   ['sda', 'https://raw.githubusercontent.com/Fakeonomics/libre-configs/refs/heads/main/special/anchor'],
   ['chlen1', 'https://raw.githubusercontent.com/mfuu/FreeProxies/master/sub'],
['chlen1', 'https://raw.githubusercontent.com/pojiezhiyuanjun/freev2/master/1225.txt'],
['chlen2', 'https://raw.githubusercontent.com/ermaozi/get_subscribe/main/subscribe/v2ray.txt'],
['chlen3', 'https://raw.githubusercontent.com/learnhard-cn/free_proxy_ss/main/free'],
['chlen4', 'https://www.xrayvip.com/free.txt'],
['chlen5', 'https://raw.githubusercontent.com/zhuhaiuk/free-nodes/main/nodes.txt'],
['chlen6', 'https://raw.githubusercontent.com/free18/v2ray/main/v.txt'],
['chlen7', 'https://raw.githubusercontent.com/free-nodes/v2rayfree/main/sub'],
   // ...Array.from({ length: 26 }, (_, index) => {
   //    const i = index + 1;
   //    return [
   //       `FreeProxyList-${i}`,
   //       `https://raw.githubusercontent.com/nikita29a/FreeProxyList/refs/heads/main/mirror/${i}.txt`,
   //    ];
   // }),
   ...HIDASHIMORA_IDS.map((id) => [
      `Hidashimora-${id}`,
      `https://raw.githubusercontent.com/Hidashimora/free-vpn-anti-rkn/refs/heads/main/configs/${id}.txt`,
   ]),
];
const SOURCE_TIMEOUT_MS = 45000;
// Отдельный лимит скачивания файлов, не влияет на число потоков проверки.
const SOURCE_LOAD_CONCURRENCY = 8;
// Начальная оценка каждой пачки перед расстановкой приоритетов.
const SOURCE_SAMPLE_SIZE = 100;
// Постоянный цвет для каждого источника, независимо от сортировки.
const sourceColor = (index) => `hsl(${Math.round((index * 137.508) % 360)} 78% 55%)`;
​
// ─── Tuning ────────────────────────────────────────────────────────────────────
const ROW_H = 34; // fixed row height (virtualization relies on it)
const VIEW_H = 560; // visible table body height
const OVERSCAN = 12; // extra rows rendered above/below viewport
const FLUSH_MS = 250; // how often check results are pushed into React state
​
// status codes (typed arrays instead of an object-of-objects)
const ST_NONE = 0,
   ST_CHECKING = 1,
   ST_ONLINE = 2,
   ST_TIMEOUT = 3,
   ST_ERROR = 4,
   ST_UNTESTABLE = 5; // <- add
const ST_CODE = {
   checking: ST_CHECKING,
   online: ST_ONLINE,
   timeout: ST_TIMEOUT,
   error: ST_ERROR,
   untestable: ST_UNTESTABLE, // <- add
};
​
const COLS =
   "44px minmax(160px,1.4fr) 190px 52px 90px 90px 80px minmax(100px,1fr) 110px 110px 60px";
const HEADERS = [
   "#",
   "Название",
   "Хост : Порт",
   "Geo",
   "Протокол",
   "Транспорт",
   "Security",
   "SNI",
   "Auth",
   "Статус",
   "",
];
​
// ─── Colors ────────────────────────────────────────────────────────────────────
const PROTO_COLORS = {
   vless: { bg: "#0d1f38", text: "#38bdf8" },
   vmess: { bg: "#1a1038", text: "#a78bfa" },
   trojan: { bg: "#1f1010", text: "#f87171" },
   ss: { bg: "#0f2818", text: "#4ade80" },
   shadowsocks: { bg: "#0f2818", text: "#4ade80" },
   hysteria: { bg: "#1f1a08", text: "#fbbf24" },
   hysteria2: { bg: "#1f1a08", text: "#fcd34d" },
   hy2: { bg: "#1f1a08", text: "#fcd34d" },
   tuic: { bg: "#0d2020", text: "#2dd4bf" },
   socks: { bg: "#181818", text: "#9ca3af" },
   socks5: { bg: "#181818", text: "#9ca3af" },
   http: { bg: "#181818", text: "#9ca3af" },
};
const TRANSPORT_COLORS = {
   ws: { bg: "#1a0c3b", text: "#a78bfa" },
   httpupgrade: { bg: "#0c1f3b", text: "#38bdf8" },
   grpc: { bg: "#0c3b3b", text: "#34d399" },
   tcp: { bg: "#161616", text: "#6b7280" },
   udp: { bg: "#1a1008", text: "#f59e0b" },
   quic: { bg: "#0d1f10", text: "#4ade80" },
   h2: { bg: "#0c1f3b", text: "#60a5fa" },
};
const SEC_COLORS = {
   tls: { bg: "#0c3b2e", text: "#22c55e" },
   reality: { bg: "#0c1f3b", text: "#38bdf8" },
   none: { bg: "#2a1a0a", text: "#f59e0b" },
};
​
// ─── Connectivity check ────────────────────────────────────────────────────────
// `inflight` holds an abort fn per running check so [stop] can cancel everything
// instantly. Every check always releases its socket (fetch abort / ws.close).
function checkProxy(proxy, timeoutMs, inflight) {
   if (proxy.untestable)
      return Promise.resolve({ status: "untestable", latency: null }); // <- add
   return new Promise((resolve) => {
      const start = performance.now();
      const elapsed = () => Math.round(performance.now() - start);
      let finished = false;
      let cleanup = () => {};
​
      const finish = (status, latency = null) => {
         if (finished) return;
         finished = true;
         clearTimeout(tid);
         inflight.delete(abort);
         try {
            cleanup();
         } catch {}
         resolve({ status, latency });
      };
      const abort = () => finish("aborted");
      const tid = setTimeout(() => finish("timeout"), timeoutMs);
      inflight.add(abort);
​
      const transport = proxy.transport?.toLowerCase();
      const isUDP =
         transport === "udp" ||
         transport === "quic" ||
         ["hysteria", "hysteria2", "tuic"].includes(proxy.proto);
​
      if (!isUDP && (transport === "ws" || transport === "httpupgrade")) {
         const tls = proxy.security === "tls";
         const addr = tls ? proxy.sni || proxy.host : proxy.host;
         try {
            const ws = new WebSocket(
               `${tls ? "wss" : "ws"}://${addr}:${proxy.port}${proxy.path || "/"}`,
            );
            cleanup = () => {
               ws.onopen = ws.onerror = ws.onclose = null;
               ws.close();
            };
            ws.onopen = () => finish("online", elapsed());
            ws.onerror = () => finish("error");
            ws.onclose = () => finish("error");
         } catch {
            finish("error");
         }
         return;
      }
​
      // TCP / UDP-ish → fetch no-cors. A fast failure means something answered on the port.
      const ctrl = new AbortController();
      cleanup = () => ctrl.abort();
      const fastLimit = timeoutMs - (isUDP ? 500 : 300);
      fetch(
         `${proxy.security === "tls" ? "https" : "http"}://${proxy.host}:${proxy.port}`,
         {
            mode: "no-cors",
            signal: ctrl.signal,
            cache: "no-store",
            credentials: "omit",
         },
      )
         .then(() => finish("online", elapsed()))
         .catch((error) => {
            // Отмена уже обрабатывается через finish() или таймаут.
            if (error?.name === "AbortError") return;
​
            finish("error");
         });
   });
}
​
// Worker pool. Stops launching new checks as soon as ctx.stopped is set.
async function runChecks(proxies, indices, concurrency, timeoutMs, ctx) {
   let cursor = 0;
   const worker = async () => {
      while (!ctx.stopped) {
         const k = cursor++;
         if (k >= indices.length) return;
         const i = indices[k];
         ctx.onResult(i, "checking", null);
         const r = await checkProxy(proxies[i], timeoutMs, ctx.inflight);
         if (ctx.stopped) return;
         ctx.onResult(i, r.status, r.latency);
      }
   };
   await Promise.all(
      Array.from({ length: Math.min(concurrency, indices.length) }, worker),
   );
}
​
// Сначала проверяем до SOURCE_SAMPLE_SIZE записей из каждой пачки, затем
// каждый освободившийся поток выбирает пачку с наибольшей долей ответов.
// Заблокированные браузером порты не участвуют в расчёте процента.
async function runPrioritizedChecks(proxies, indices, groups, concurrency, timeoutMs, ctx, onSampled, statuses) {
   const eligible = new Uint8Array(proxies.length);
   for (const i of indices) eligible[i] = 1;
​
   const sourceForRow = new Int32Array(proxies.length).fill(-1);
   const sources = groups.map((group, sourceNumber) => {
      const rows = [];
      let online = 0;
      let measured = 0;
      for (let i = group.start; i < group.end && i < proxies.length; i++) {
         if (eligible[i]) {
            rows.push(i);
            sourceForRow[i] = sourceNumber;
         } else if (statuses[i] === ST_ONLINE || statuses[i] === ST_TIMEOUT || statuses[i] === ST_ERROR) {
            // При частичной проверке учитываем сохранённые результаты в показателе пачки.
            measured++;
            if (statuses[i] === ST_ONLINE) online++;
         }
      }
      return { ...group, rows, samples: [], pending: [], cursor: 0, online, measured };
   });
​
   // Если диапазоны повреждены или не охватывают список, не теряем проверки.
   if (indices.some((i) => sourceForRow[i] < 0)) {
      onSampled();
      await runChecks(proxies, indices, concurrency, timeoutMs, ctx);
      return;
   }
​
   const sampled = new Uint8Array(proxies.length);
   for (const source of sources) {
      const candidates = source.rows.filter((i) => !proxies[i].untestable);
      const n = Math.min(SOURCE_SAMPLE_SIZE, candidates.length);
      for (let j = 0; j < n; j++) {
         // Равномерно по всей пачке, а не только её первые строки.
         const i = candidates[Math.floor((j + 0.5) * candidates.length / n)];
         sampled[i] = 1;
         source.samples.push(i);
      }
      source.pending = source.rows.filter((i) => !sampled[i]);
      source.rows = null;
   }
​
   // Перемежаем источники, чтобы первые результаты были видны быстрее.
   const sampleIndices = [];
   for (let j = 0; j < SOURCE_SAMPLE_SIZE; j++) {
      for (const source of sources) {
         if (j < source.samples.length) sampleIndices.push(source.samples[j]);
      }
   }
​
   const originalOnResult = ctx.onResult;
   ctx.onResult = (i, status, latency) => {
      originalOnResult(i, status, latency);
      const source = sources[sourceForRow[i]];
      if (source && (status === "online" || status === "timeout" || status === "error")) {
         source.measured++;
         if (status === "online") source.online++;
      }
   };
​
   try {
      await runChecks(proxies, sampleIndices, concurrency, timeoutMs, ctx);
      if (ctx.stopped) return;
      onSampled();
​
      const worker = async () => {
         while (!ctx.stopped) {
            let best = null;
            let bestRate = -2;
            for (const source of sources) {
               if (source.cursor >= source.pending.length) continue;
               const rate = source.measured ? source.online / source.measured : -1;
               if (
                  best === null || rate > bestRate ||
                  (rate === bestRate && (source.total < best.total ||
                     (source.total === best.total && source.sourceIndex < best.sourceIndex)))
               ) {
                  best = source;
                  bestRate = rate;
               }
            }
            if (!best) return;
            const i = best.pending[best.cursor++];
            ctx.onResult(i, "checking", null);
            const result = await checkProxy(proxies[i], timeoutMs, ctx.inflight);
            if (ctx.stopped) return;
            ctx.onResult(i, result.status, result.latency);
         }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, indices.length) }, worker));
   } finally {
      ctx.onResult = originalOnResult;
   }
}
​
// ─── Small components ──────────────────────────────────────────────────────────
const Badge = ({ colors, fallback, children, upper }) => {
   const c = colors ?? fallback;
   return (
      <span
         style={{
            background: c.bg,
            color: c.text,
            fontSize: 10,
            padding: "2px 7px",
            borderRadius: 4,
            fontFamily: MONO,
            letterSpacing: "0.04em",
            textTransform: upper ? "uppercase" : "none",
         }}
      >
         {children}
      </span>
   );
};
​
const statusColor = (s) =>
   ({
      [ST_ONLINE]: GREEN,
      [ST_TIMEOUT]: AMBER,
      [ST_ERROR]: RED,
      [ST_CHECKING]: BLUE,
      [ST_UNTESTABLE]: MUTED, // <- add
   })[s] ?? MUTED;
const statusLabel = (s, lat) => {
   if (s === ST_ONLINE) return lat >= 0 ? `✓ ${lat}ms` : "✓ online";
   if (s === ST_TIMEOUT) return "⏱ timeout";
   if (s === ST_ERROR) return "✗ error";
   if (s === ST_CHECKING) return "… checking";
   if (s === ST_UNTESTABLE) return "– blocked port"; // <- add
   return "–";
};
​
const cell = {
   padding: "0 12px",
   overflow: "hidden",
   whiteSpace: "nowrap",
   textOverflow: "ellipsis",
};
​
// Memoized: status, latency, copy-state and selection are passed per row.
const Row = memo(function Row({
   p,
   row,
   idx,
   geo,
   status,
   latency,
   copied,
   selected,
   copyFormat,
   onCopy,
}) {
   return (
      <div
         className="prow"
         data-result-row={row}
         data-selected={selected ? "true" : "false"}
         style={{
            position: "absolute",
            top: row * ROW_H,
            left: 0,
            right: 0,
            height: ROW_H,
            display: "grid",
            gridTemplateColumns: COLS,
            alignItems: "center",
            borderBottom: "1px solid #0e161f",
            background: selected ? "#153452" : undefined,
            boxShadow: selected ? `inset 3px 0 ${BLUE}` : undefined,
            fontSize: 11,
         }}
      >
         <div style={{ ...cell, color: MUTED }}>{idx + 1}</div>
         <div
            style={{ ...cell, display: "flex", alignItems: "center", gap: 6 }}
         >
            <span
               title={p.name}
               style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: TEXT,
               }}
            >
               {p.name}
            </span>
            {p.merged > 1 && (
               <span
                  title={`Объединено ${p.merged} дубликатов:\n${p.aliases.join("\n")}`}
                  style={{
                     background: "#2a1a0a",
                     color: AMBER,
                     fontSize: 9,
                     padding: "1px 6px",
                     borderRadius: 10,
                     flexShrink: 0,
                     cursor: "help",
                  }}
               >
                  ×{p.merged}
               </span>
            )}
         </div>
         <div style={cell}>
            <span style={{ color: TEXT }}>{p.host}</span>
            <span style={{ color: MUTED }}>:{p.port}</span>
         </div>
         <div style={cell}>
            {geo === GEO_RU ? (
               <Badge colors={{ bg: "#2b0c0c", text: RED }}>RU</Badge>
            ) : geo === GEO_OTHER ? (
               <span style={{ color: GREEN, fontSize: 10 }}>non-RU</span>
            ) : (
               <span style={{ color: MUTED, fontSize: 10 }}>
                  {geo === GEO_UNKNOWN ? "?" : "…"}
               </span>
            )}
         </div>
         <div style={cell}>
            <Badge
               upper
               colors={PROTO_COLORS[p.proto?.toLowerCase()]}
               fallback={{ bg: "#1a1a1a", text: "#9ca3af" }}
            >
               {p.proto === "shadowsocks" ? "ss" : p.proto}
            </Badge>
         </div>
         <div style={cell}>
            <Badge
               colors={TRANSPORT_COLORS[p.transport?.toLowerCase()]}
               fallback={TRANSPORT_COLORS.tcp}
            >
               {p.transport || "tcp"}
            </Badge>
         </div>
         <div style={cell}>
            <Badge
               colors={SEC_COLORS[p.security?.toLowerCase()]}
               fallback={SEC_COLORS.none}
            >
               {p.security || "none"}
            </Badge>
         </div>
         <div style={{ ...cell, color: MUTED, fontSize: 10 }} title={p.sni}>
            {p.sni || "—"}
         </div>
         <div
            style={{ ...cell, color: MUTED, fontSize: 10 }}
            title={p.login ? `${p.login}:${p.password}` : ""}
         >
            {p.login ? `${p.login}:••••` : "—"}
         </div>
         <div style={{ ...cell, color: statusColor(status) }}>
            {statusLabel(status, latency)}
         </div>
         <div style={{ padding: "0 8px" }}>
            <button
               onClick={() => onCopy(toCopyString(p, copyFormat), idx)}
               title={
                  copyFormat === "uri"
                     ? "скопировать как URI"
                     : "скопировать как ip:port:login:pass"
               }
               style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  background: copied ? "#0c2b14" : "transparent",
                  color: copied ? GREEN : MUTED,
                  border: `1px solid ${copied ? "#1a5c2a" : BORDER}`,
                  borderRadius: 6,
               }}
            >
               {copied ? "✓" : "copy"}
            </button>
         </div>
      </div>
   );
});
​
function Stat({ label, value, color }) {
   return (
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
         <span style={{ fontSize: 9, color: MUTED, letterSpacing: "0.1em" }}>
            {label}
         </span>
         <span style={{ fontSize: 20, fontWeight: 600, color, lineHeight: 1 }}>
            {value}
         </span>
      </div>
   );
}
​
function Pill({ label, active, onClick, color = BLUE, wide }) {
   return (
      <button
         onClick={onClick}
         style={{
            padding: wide ? "5px 12px" : "4px 11px",
            fontSize: wide ? 11 : 10,
            borderRadius: wide ? 6 : 20,
            border: `1px solid ${active ? color : BORDER}`,
            background: active ? color + "18" : "transparent",
            color: active ? color : MUTED,
         }}
      >
         {label}
      </button>
   );
}
​
const PLACEHOLDER = `vless://uuid@1.2.3.4:443?type=ws&security=tls&sni=example.com#MyVless
vmess://eyJhZGQiOiIxLjIuMy40IiwicG9ydCI6NDQzLCJuZXQiOiJ3cyIsInRscyI6InRscyIsInBhdGgiOiIvIn0=
trojan://password@1.2.3.4:443?sni=example.com#MyTrojan
ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@1.2.3.4:8388#MySS
hysteria2://password@1.2.3.4:443?sni=example.com#MyHy2
tuic://uuid:password@1.2.3.4:443?sni=example.com#MyTuic
1.2.3.4:1080:login:password`;
​
const SUPPORTED = [
   "vless",
   "vmess",
   "trojan",
   "ss",
   "hysteria",
   "hysteria2",
   "hy2",
   "tuic",
   "socks",
   "socks5",
   "http",
   "https",
   "ip:port[:login:pass]",
];
​
// Selection uses proxy indices, not mounted DOM rows, so virtualization is safe.
function useRowSelection(liveOrder, proxies, copyFormat) {
   const [selected, setSelected] = useState(() => new Set());
   const [dragOrder, setDragOrder] = useState(null);
   const [copyMessage, setCopyMessage] = useState("");
   const viewportRef = useRef(null);
   const selectedRef = useRef(selected);
   const dragRef = useRef(null);
   const anchorRef = useRef(null);
   const rafRef = useRef(null);
   const order = dragOrder ?? liveOrder;
​
   const commit = useCallback((next) => {
      selectedRef.current = next;
      setSelected(next);
      setCopyMessage("");
   }, []);
   const clear = useCallback(() => {
      commit(new Set());
      anchorRef.current = null;
   }, [commit]);
   useEffect(() => {
      // An asynchronously loaded replacement list invalidates all old indices.
      const pointerId = dragRef.current?.pointerId;
      dragRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setDragOrder(null);
      clear();
      const el = viewportRef.current;
      if (pointerId !== undefined && el?.hasPointerCapture(pointerId)) {
         el.releasePointerCapture(pointerId);
      }
   }, [proxies, clear]);
   useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
​
   const updateRange = useCallback(() => {
      const drag = dragRef.current;
      const el = viewportRef.current;
      if (!drag || !el) return;
      const rect = el.getBoundingClientRect();
      const y = Math.max(0, Math.min(el.clientHeight - 1, drag.y - rect.top));
      const last = Math.max(
         0,
         Math.min(
            drag.order.length - 1,
            Math.floor((el.scrollTop + y) / ROW_H),
         ),
      );
      if (last === drag.last) return;
      drag.last = last;
      const next = new Set(drag.base);
      const lo = Math.min(drag.anchor, last);
      const hi = Math.max(drag.anchor, last);
      for (let row = lo; row <= hi; row++) next.add(drag.order[row]);
      commit(next);
   }, [commit]);
​
   const onPointerDown = useCallback(
      (e) => {
         if (
            e.button !== 0 ||
            (e.pointerType !== "mouse" && e.pointerType !== "pen")
         )
            return;
         if (e.target.closest("button, a, input, textarea, select")) return;
         const rowEl = e.target.closest("[data-result-row]");
         if (!rowEl || !liveOrder.length) return;
         const el = e.currentTarget;
         const row = Number(rowEl.dataset.resultRow);
         let anchor = e.shiftKey ? liveOrder.indexOf(anchorRef.current) : row;
         if (anchor < 0) anchor = row;
         if (!e.shiftKey || anchorRef.current === null)
            anchorRef.current = liveOrder[anchor];
         // Freeze ordering only during the gesture; checks continue in the background.
         const snapshot = liveOrder.slice();
         dragRef.current = {
            pointerId: e.pointerId,
            y: e.clientY,
            order: snapshot,
            anchor,
            last: -1,
            base:
               e.ctrlKey || e.metaKey
                  ? new Set(selectedRef.current)
                  : new Set(),
         };
         setDragOrder(snapshot);
         e.preventDefault();
         el.focus({ preventScroll: true });
         el.setPointerCapture(e.pointerId);
         updateRange();
         let previousTime = null;
         const autoScroll = (time) => {
            const drag = dragRef.current;
            if (!drag) return;
            const rect = el.getBoundingClientRect();
            const edge = 36;
            const above = Math.max(0, rect.top + edge - drag.y);
            const below = Math.max(
               0,
               drag.y - (rect.top + el.clientHeight - edge),
            );
            const speed = Math.max(-900, Math.min(900, (below - above) * 18));
            const dt =
               previousTime === null ? 16 : Math.min(40, time - previousTime);
            previousTime = time;
            if (speed) el.scrollTop += (speed * dt) / 1000;
            updateRange();
            rafRef.current = requestAnimationFrame(autoScroll);
         };
         rafRef.current = requestAnimationFrame(autoScroll);
      },
      [liveOrder, updateRange],
   );
​
   const onPointerMove = useCallback(
      (e) => {
         if (dragRef.current?.pointerId !== e.pointerId) return;
         dragRef.current.y = e.clientY;
         updateRange();
      },
      [updateRange],
   );
   const finishDrag = useCallback(
      (e) => {
         if (!dragRef.current || dragRef.current.pointerId !== e.pointerId)
            return;
         if (e.type === "pointerup") {
            dragRef.current.y = e.clientY;
            updateRange();
         }
         dragRef.current = null;
         cancelAnimationFrame(rafRef.current);
         setDragOrder(null);
         if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
         }
      },
      [updateRange],
   );
​
   const selectedCount = order.reduce(
      (n, idx) => n + Number(selected.has(idx)),
      0,
   );
   const getCopyText = () =>
      order
         .filter((idx) => selectedRef.current.has(idx))
         .map((idx) => toCopyString(proxies[idx], copyFormat))
         .join("\n");
   const onCopy = (e) => {
      const text = getCopyText();
      if (!text) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", text);
   };
   const copySelected = async () => {
      const text = getCopyText();
      if (!text) return;
      try {
         await navigator.clipboard.writeText(text);
         setCopyMessage("Скопировано");
      } catch {
         setCopyMessage(
            "Нет доступа к буферу: выделите строки и нажмите Ctrl+C / ⌘C",
         );
      }
   };
   const onKeyDown = (e) => {
      // Leave keyboard interaction with per-row copy buttons unchanged.
      if (e.target !== e.currentTarget) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
         e.preventDefault();
         commit(new Set(order));
      } else if (e.key === "Escape") {
         e.preventDefault();
         clear();
      }
   };
   return {
      order,
      selected,
      selectedCount,
      copyMessage,
      copySelected,
      clear,
      viewportRef,
      onPointerDown,
      onPointerMove,
      finishDrag,
      onCopy,
      onKeyDown,
      updateRange,
   };
}
​
// ─── Main component ────────────────────────────────────────────────────────────
export default function ProxyChecker() {
   const [input, setInput] = useState("");
   const [proxies, setProxies] = useState([]);
   const [version, setVersion] = useState(0); // bumped on each batched flush
   const [running, setRunning] = useState(false);
   const [parsing, setParsing] = useState(false);
   const [publicLoading, setPublicLoading] = useState(false);
   const [publicProgress, setPublicProgress] = useState(null);
   const [publicGroups, setPublicGroups] = useState([]);
   const [priorityReady, setPriorityReady] = useState(false);
   const [publicMessage, setPublicMessage] = useState(null);
   const [sortMode, setSortMode] = useState("latency");
   const [concurrency, setConcurrency] = useState(150);
   const [timeoutMs, setTimeoutMs] = useState(2000);
   const [filterProto, setFilterProto] = useState("all");
   const [onlyOnline, setOnlyOnline] = useState(false);
   const [ruMode, setRuMode] = useState("hide"); // "hide" | "all" | "only"
   const [geoBusy, setGeoBusy] = useState(false);
   const [plainProto, setPlainProto] = useState("socks5");
   const [copyFormat, setCopyFormat] = useState("uri");
   const [copied, setCopied] = useState(null);
   const [copiedAll, setCopiedAll] = useState(false);
   const [autoMode, setAutoMode] = useState(true);
   const [clipError, setClipError] = useState(null);
   const [firstRow, setFirstRow] = useState(0);
​
   // Results live OUTSIDE React state: typed arrays mutated in place by workers.
   const statusRef = useRef(new Uint8Array(0));
   const latencyRef = useRef(new Int32Array(0));
   const proxiesRef = useRef([]);
   const geoRef = useRef(new Uint8Array(0));
   const geoPromiseRef = useRef(Promise.resolve());
   const ruModeRef = useRef("hide");
   ruModeRef.current = ruMode;
   const ctxRef = useRef(null);
   const flushTimer = useRef(null);
   const parseToken = useRef(0);
   const publicAbortRef = useRef(null);
​
   const flush = useCallback(() => setVersion((v) => v + 1), []);
   useEffect(
      () => () => {
         parseToken.current++;
         publicAbortRef.current?.abort();
         publicAbortRef.current = null;
         const ctx = ctxRef.current;
         if (ctx) {
            ctx.stopped = true;
            [...ctx.inflight].forEach((abort) => abort());
         }
         clearInterval(flushTimer.current);
      },
      [],
   );
​
   const setList = useCallback(
      (list) => {
         proxiesRef.current = list;
         statusRef.current = new Uint8Array(list.length);
         latencyRef.current = new Int32Array(list.length).fill(-1);
         geoRef.current = new Uint8Array(list.length);
         setProxies(list);
         setFirstRow(0);
         flush();
      },
      [flush],
   );
​
   // Offline range lookup for IP hosts; one DoH query per unique domain.
   const runGeo = useCallback(
      (list) => {
         setGeoBusy(true);
         const stale = () => proxiesRef.current !== list;
         const p = classifyHosts(
            list.map((x) => x.host),
            { onTick: flush, isStale: stale },
         ).then((codes) => {
            if (stale()) return;
            geoRef.current = codes;
            setGeoBusy(false);
            flush();
         });
         geoPromiseRef.current = p;
         return p;
      },
      [flush],
   );
​
   const stopCheck = useCallback(() => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      ctx.stopped = true;
      [...ctx.inflight].forEach((abort) => abort()); // frees sockets immediately
      const st = statusRef.current;
      for (let i = 0; i < st.length; i++)
         if (st[i] === ST_CHECKING) st[i] = ST_NONE;
      clearInterval(flushTimer.current);
      ctxRef.current = null;
      setRunning(false);
      flush();
   }, [flush]);
​
   // indices === undefined → check everything
   const startCheck = useCallback(
      async (indices, ignoreGeoFilter = false, explicitGroups = null) => {
         const list = proxiesRef.current;
         if (!list.length) return;
         if (ctxRef.current) stopCheck();
         if (!ignoreGeoFilter && ruModeRef.current === "hide") await geoPromiseRef.current; // need geo before deciding what to skip
         if (proxiesRef.current !== list) return;
         let idx = indices ?? Array.from({ length: list.length }, (_, i) => i);
         if (!ignoreGeoFilter && ruModeRef.current === "hide")
            idx = idx.filter((i) => geoRef.current[i] !== GEO_RU); // RU proxies never hit the network
         if (!idx.length) return;
​
         for (const i of idx) {
            statusRef.current[i] = ST_NONE;
            latencyRef.current[i] = -1;
         }
         const ctx = {
            stopped: false,
            inflight: new Set(),
            onResult: (i, status, latency) => {
               statusRef.current[i] = ST_CODE[status] ?? ST_ERROR;
               latencyRef.current[i] = latency ?? -1;
            },
         };
         const priorityGroups = explicitGroups ?? (indices === undefined ? publicGroups : []);
         const usePriority = priorityGroups.length > 0;
         if (usePriority) setPriorityReady(false);
         ctxRef.current = ctx;
         setRunning(true);
         clearInterval(flushTimer.current);
         flushTimer.current = setInterval(flush, FLUSH_MS);
​
         if (usePriority) {
            await runPrioritizedChecks(list, idx, priorityGroups, concurrency, timeoutMs, ctx, () => {
               if (!ctx.stopped && ctxRef.current === ctx) {
                  setPriorityReady(true);
                  flush();
               }
            }, statusRef.current);
         } else {
            await runChecks(list, idx, concurrency, timeoutMs, ctx);
         }
​
         if (ctxRef.current === ctx) {
            clearInterval(flushTimer.current);
            ctxRef.current = null;
            setRunning(false);
            flush();
         }
      },
      [concurrency, timeoutMs, flush, stopCheck, publicGroups],
   );
   const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
   const load = useCallback(
      async (text, autoCheck, checkAllCountries = false) => {
         if (!text?.trim()) return 0;
         stopCheck();
         const token = ++parseToken.current;
         setParsing(true);
         await tick(); // let "parsing…" paint first
         const parsed = await parseAndDedupe(
            text,
            plainProto,
            () => token !== parseToken.current,
         );
         if (!parsed || token !== parseToken.current) return 0;
         setParsing(false);
         setPublicGroups([]);
         setPriorityReady(false);
         setList(parsed);
         runGeo(parsed);
         setFilterProto("all");
         setSortMode(autoCheck ? "index" : "latency");
         if (autoCheck && parsed.length) startCheck(undefined, checkAllCountries, []);
         return parsed.length;
      },
      [plainProto, setList, runGeo, startCheck, stopCheck],
   );
​
   // Останавливает загрузку подписок или их разбор до запуска проверок.
   const cancelPublicLoading = useCallback(() => {
      const controller = publicAbortRef.current;
      if (!controller) return;
      publicAbortRef.current = null;
      controller.abort();
      parseToken.current++;
      setParsing(false);
      setPublicLoading(false);
      setPublicMessage("Загрузка источников отменена.");
   }, []);
​
   const loadPublicSources = useCallback(async () => {
      if (publicAbortRef.current) return;
      stopCheck();
      const controller = new AbortController();
      publicAbortRef.current = controller;
      setPublicLoading(true);
      setPublicMessage(null);
      setClipError(null);
      setPublicProgress({ done: 0, total: PUBLIC_SOURCES.length });
      let done = 0;
​
      try {
         const downloads = new Array(PUBLIC_SOURCES.length);
         let nextSource = 0;
         async function downloadWorker() {
            while (!controller.signal.aborted) {
               const sourceIndex = nextSource++;
               if (sourceIndex >= PUBLIC_SOURCES.length) return;
               const [name, url] = PUBLIC_SOURCES[sourceIndex];
               const request = new AbortController();
               const abortRequest = () => request.abort();
               if (controller.signal.aborted) abortRequest();
               else controller.signal.addEventListener("abort", abortRequest, { once: true });
               const timer = setTimeout(abortRequest, SOURCE_TIMEOUT_MS);
               try {
                  const response = await fetch(url, {
                     signal: request.signal,
                     cache: "no-store",
                     credentials: "omit",
                  });
                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  downloads[sourceIndex] = { name, sourceIndex, text: await response.text() };
               } catch {
                  downloads[sourceIndex] = { name, error: true };
               } finally {
                  clearTimeout(timer);
                  controller.signal.removeEventListener("abort", abortRequest);
                  done++;
                  if (publicAbortRef.current === controller && !controller.signal.aborted) {
                     setPublicProgress({ done, total: PUBLIC_SOURCES.length });
                  }
               }
            }
         }
         await Promise.all(
            Array.from(
               { length: Math.min(SOURCE_LOAD_CONCURRENCY, PUBLIC_SOURCES.length) },
               () => downloadWorker(),
            ),
         );
​
         if (controller.signal.aborted || publicAbortRef.current !== controller) return;
         const failed = downloads.filter((item) => item.error).map((item) => item.name);
         const successful = downloads.filter((item) => !item.error);
         if (!successful.length) {
            setPublicMessage("Не удалось загрузить ни один источник. Проверьте сеть и CORS.");
            return;
         }
​
         // Сначала считаем распознанные записи каждого источника, включая
         // повторы внутри него. Это даёт настоящий порядок от меньшего к большему.
         const token = ++parseToken.current;
         const isStale = () => controller.signal.aborted ||
            publicAbortRef.current !== controller || token !== parseToken.current;
         setParsing(true);
         setPublicProgress({ done: 0, total: successful.length, stage: "parse" });
         await tick();
         const parsedSources = [];
         for (let i = 0; i < successful.length; i++) {
            if (isStale()) return;
            const item = successful[i];
            const parsed = await parseAndDedupe(item.text, plainProto, isStale);
            item.text = null; // Освобождаем текст по мере разбора.
            if (!parsed || isStale()) return;
            const total = parsed.reduce((sum, p) => sum + p.merged, 0);
            parsedSources.push({
               name: item.name,
               sourceIndex: item.sourceIndex,
               color: sourceColor(item.sourceIndex),
               total,
               parsed,
            });
            setPublicProgress({ done: i + 1, total: successful.length, stage: "parse" });
            await tick();
         }
​
         parsedSources.sort((a, b) => a.total - b.total || a.sourceIndex - b.sourceIndex);
​
         // Глобальная дедупликация: запись относится к первому (наименьшему)
         // источнику, где она встретилась. Число merged и имена сохраняются.
         const seen = new Map();
         const list = [];
         const groups = [];
         let steps = 0;
         for (const source of parsedSources) {
            const start = list.length;
            for (const proxy of source.parsed) {
               if (isStale()) return;
               const existing = seen.get(proxy.key);
               if (existing) {
                  existing.merged += proxy.merged;
                  for (const alias of proxy.aliases) {
                     if (existing.aliases.length >= 50) break;
                     if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
                  }
               } else {
                  seen.set(proxy.key, proxy);
                  list.push(proxy);
               }
               if (++steps % 1500 === 0) await tick();
            }
            groups.push({
               name: source.name,
               sourceIndex: source.sourceIndex,
               color: source.color,
               total: source.total,
               start,
               end: list.length,
            });
            source.parsed = null;
         }
         if (isStale()) return;
         setParsing(false);
         if (!list.length) {
            setPublicMessage("В загруженных источниках нет распознанных прокси." +
               (failed.length ? ` Не загрузились: ${failed.join(", ")}.` : ""));
            return;
         }
​
         // Проверяем все страны; список уже сгруппирован в порядке проверки.
         ruModeRef.current = "all";
         setRuMode("all");
         setOnlyOnline(false);
         setFilterProto("all");
         setSortMode("index");
         setList(list);
         setPublicGroups(groups);
         runGeo(list);
         startCheck(undefined, true, groups);
​
         setPublicMessage(`Загружено источников: ${successful.length}/${PUBLIC_SOURCES.length}; уникальных записей: ${list.length}.` +
            (failed.length ? ` Не загрузились: ${failed.join(", ")}.` : ""));
      } catch {
         if (publicAbortRef.current === controller && !controller.signal.aborted) {
            setParsing(false);
            setPublicMessage("Ошибка обработки источников. Попробуйте ещё раз.");
         }
      } finally {
         if (publicAbortRef.current === controller) {
            publicAbortRef.current = null;
            setPublicLoading(false);
         }
      }
   }, [plainProto, setList, runGeo, startCheck, stopCheck]);
​
   const handlePaste = useCallback(
      (e) => {
         if (!autoMode || publicLoading) return;
         const pasted = e.clipboardData?.getData("text");
         if (!pasted?.trim()) return;
         e.preventDefault();
         setInput(pasted);
         load(pasted, true);
      },
      [autoMode, load, publicLoading],
   );
​
   const pasteFromClipboard = useCallback(async () => {
      setClipError(null);
      try {
         const text = await navigator.clipboard.readText();
         if (!text?.trim()) return setClipError("буфер обмена пуст");
         setInput(text);
         const n = await load(text, true);
         if (!n) setClipError("в буфере нет распознанных прокси-строк");
      } catch {
         setClipError("нет доступа к буферу — разрешите вставку в браузере");
      }
   }, [load]);
​
   const copyUri = useCallback((uri, idx) => {
      navigator.clipboard.writeText(uri).then(() => {
         setCopied(idx);
         setTimeout(() => setCopied((c) => (c === idx ? null : c)), 1500);
      });
   }, []);
​
   // ── Derived data (recomputed only on flush / filter / sort changes) ──
   const {
      counts,
      protoCounts,
      visible: liveVisible,
   } = useMemo(() => {
      const st = statusRef.current,
         lat = latencyRef.current;
      const n = proxies.length;
      const geo = geoRef.current;
      const c = { checked: 0, online: 0, failed: 0, untestable: 0, ru: 0 };
      const pc = {};
      const idx = [];
      for (let i = 0; i < n; i++) {
         const s = st[i];
         if (s === ST_ONLINE) {
            c.checked++;
            c.online++;
         } else if (s === ST_TIMEOUT || s === ST_ERROR) {
            c.checked++;
            c.failed++;
         }
         if (s === ST_UNTESTABLE) c.untestable++;
         const isRu = geo[i] === GEO_RU;
         if (isRu) c.ru++;
         if ((ruMode === "hide" && isRu) || (ruMode === "only" && !isRu))
            continue;
         const proto = proxies[i].proto;
         pc[proto] = (pc[proto] || 0) + 1;
         if (filterProto !== "all" && proto !== filterProto) continue;
         if (onlyOnline && s !== ST_ONLINE) continue;
         idx.push(i);
      }
      if (sortMode === "latency") {
         idx.sort(
            (a, b) =>
               (lat[a] < 0 ? 1e9 : lat[a]) - (lat[b] < 0 ? 1e9 : lat[b]) ||
               a - b,
         );
      } else if (sortMode === "status") {
         const order = [9, 1, 0, 2, 3, 4]; // was [9, 1, 0, 2, 3]
         idx.sort((a, b) => order[st[a]] - order[st[b]] || a - b);
      }
      return { counts: c, protoCounts: pc, visible: idx };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [proxies, version, sortMode, filterProto, onlyOnline, ruMode]);
​
   const selection = useRowSelection(liveVisible, proxies, copyFormat);
   const visible = selection.order;
​
   const copyAllWorking = () => {
      const st = statusRef.current;
      const out = [];
      for (let i = 0; i < proxies.length; i++)
         if (
            st[i] === ST_ONLINE &&
            !(ruMode === "hide" && geoRef.current[i] === GEO_RU)
         )
            out.push(toCopyString(proxies[i], copyFormat));
      if (!out.length) return;
      navigator.clipboard.writeText(out.join("\n")).then(() => {
         setCopiedAll(true);
         setTimeout(() => setCopiedAll(false), 2000);
      });
   };
​
   const recheckFailed = () => {
      const st = statusRef.current;
      const idx = [];
      for (let i = 0; i < proxies.length; i++)
         if (st[i] !== ST_ONLINE) idx.push(i);
      startCheck(idx);
   };
​
   const mergedCount = useMemo(
      () => proxies.reduce((a, p) => a + (p.merged - 1), 0),
      [proxies],
   );
   const availableProtos = Object.keys(protoCounts);
   const progress = proxies.length
      ? (counts.checked + counts.untestable) / proxies.length
      : 0;
   const groupProgress = useMemo(() => {
      const statuses = statusRef.current;
      const result = publicGroups.map((group) => {
         let processed = 0;
         let online = 0;
         let measured = 0;
         for (let i = group.start; i < group.end; i++) {
            const status = statuses[i];
            if (status === ST_ONLINE || status === ST_TIMEOUT ||
                status === ST_ERROR || status === ST_UNTESTABLE) processed++;
            if (status === ST_ONLINE) online++;
            if (status === ST_ONLINE || status === ST_TIMEOUT || status === ST_ERROR) measured++;
         }
         return { ...group, unique: group.end - group.start, processed, online, measured,
            rate: measured ? online / measured : null };
      });
      if (priorityReady) {
         result.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) ||
            a.total - b.total || a.sourceIndex - b.sourceIndex);
      }
      return result;
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [publicGroups, proxies, version, priorityReady]);
​
   // ── Virtual window ──
   const start = Math.max(0, firstRow - OVERSCAN);
   const end = Math.min(
      visible.length,
      firstRow + Math.ceil(VIEW_H / ROW_H) + OVERSCAN,
   );
   const st = statusRef.current,
      lat = latencyRef.current;
   const onScroll = (e) => {
      const r = Math.floor(e.currentTarget.scrollTop / ROW_H);
      setFirstRow((prev) => (prev === r ? prev : r)); // re-render only when crossing a row boundary
      selection.updateRange();
   };
​  
   return (
      <div
         style={{
            background: BG,
            minHeight: "100vh",
            fontFamily: MONO,
            color: TEXT,
            padding: "24px 20px",
         }}
      >
         <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0b0e11; }
        ::-webkit-scrollbar-thumb { background: #1e2a38; border-radius: 3px; }
        textarea, input[type=number] { background: #080b0e !important; color: ${TEXT} !important; border: 1px solid ${BORDER} !important; border-radius: 8px !important; font-family: ${MONO} !important; outline: none !important; resize: vertical; }
        textarea:focus, input[type=number]:focus { border-color: #2d4a6b !important; }
        button { cursor: pointer; font-family: ${MONO}; }
        .prow:hover { background: #0f1822; }
      `}</style>
​
         <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ marginBottom: 20 }}>
               <div
                  style={{
                     display: "flex",
                     alignItems: "baseline",
                     gap: 12,
                     marginBottom: 4,
                  }}
               >
                  <span
                     style={{
                        fontSize: 11,
                        color: MUTED,
                        letterSpacing: "0.15em",
                     }}
                  >
                     //
                  </span>
                  <h1
                     style={{
                        margin: 0,
                        fontSize: 18,
                        fontWeight: 600,
                        color: TEXT,
                        letterSpacing: "-0.02em",
                     }}
                  >
                     proxy checker
                  </h1>
               </div>
               <p style={{ margin: 0, fontSize: 11, color: MUTED }}>
                  поддерживает: {SUPPORTED.join(" · ")}
               </p>
            </div>
​
            <div style={{ marginBottom: 16 }}>
               <button
                  onClick={loadPublicSources}
                  disabled={publicLoading || parsing || running}
                  style={{
                     display: "flex", alignItems: "center", justifyContent: "center",
                     gap: 10, padding: "12px 20px", width: "100%",
                     background: "linear-gradient(135deg, #0c1f38, #102d4d)",
                     color: BLUE, border: "1px solid #1a3a5c", borderRadius: 10,
                     fontSize: 13, fontWeight: 500, marginBottom: 8,
                     opacity: publicLoading || parsing || running ? 0.5 : 1,
                  }}
               >
                  {publicLoading
                     ? parsing
                        ? `[ разбор источников ${publicProgress?.done || 0}/${publicProgress?.total || 0}... ]`
                        : `[ загрузка источников ${publicProgress?.done || 0}/${PUBLIC_SOURCES.length}... ]`
                     : "[ загрузить и проверить публичные источники ]"}
               </button>
               {publicLoading && (
                  <button
                     onClick={cancelPublicLoading}
                     style={{
                        width: "100%", padding: "8px 12px", marginBottom: 8,
                        background: "#2b0c0c", color: RED, border: "1px solid #5c1a1a",
                        borderRadius: 8, fontSize: 12,
                     }}
                  >
                     [ отменить загрузку ]
                  </button>
               )}
               {publicMessage && (
                  <p role="status" style={{ margin: "4px 0 8px", fontSize: 11, color: AMBER, textAlign: "center" }}>
                     {publicMessage}
                  </p>
               )}
               <button
                  onClick={pasteFromClipboard}
                  disabled={running || parsing || publicLoading}
                  style={{
                     display: "flex",
                     alignItems: "center",
                     gap: 10,
                     padding: "12px 20px",
                     background: "linear-gradient(135deg, #0a1f10, #0c2b14)",
                     color: GREEN,
                     border: "1px solid #1a5c2a",
                     borderRadius: 10,
                     fontSize: 13,
                     fontWeight: 500,
                     opacity: running || parsing || publicLoading ? 0.5 : 1,
                     width: "100%",
                     justifyContent: "center",
                  }}
               >
                  <span style={{ fontSize: 16 }}>📋</span>
                  {parsing
                     ? "[ парсинг... ]"
                     : "[ вставить из буфера и проверить ]"}
               </button>
               {clipError && (
                  <p
                     style={{
                        marginTop: 6,
                        fontSize: 11,
                        color: AMBER,
                        textAlign: "center",
                     }}
                  >
                     ⚠ {clipError}
                  </p>
               )}
            </div>
​
   
​
            <div
               style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "start",
                  marginBottom: 8,
               }}
            >
               
               <div
                  style={{
                     display: "flex",
                     flexDirection: "column",
                     gap: 8,
                     minWidth: 160,
                  }}
               >
                  <label
                     style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 10,
                        color: MUTED,
                        cursor: "pointer",
                        marginBottom: 2,
                     }}
                  >
                     <input
                        type="checkbox"
                        checked={autoMode}
                        onChange={(e) => setAutoMode(e.target.checked)}
                        style={{
                           width: 13,
                           height: 13,
                           accentColor: GREEN,
                           cursor: "pointer",
                        }}
                     />
                     авто-парсинг + чек при вставке
                  </label>
                  <button
                     onClick={() => load(input, false)}
                     disabled={!input.trim() || parsing || publicLoading}
                     style={{
                        padding: "9px 16px",
                        background: "#0c1f38",
                        color: BLUE,
                        border: "1px solid #1a3a5c",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 500,
                        opacity: !input.trim() ? 0.4 : 1,
                     }}
                  >
                     [ parse ]
                  </button>
                  <button
                     onClick={() => startCheck()}
                     disabled={!proxies.length || running || parsing || publicLoading}
                     style={{
                        padding: "9px 16px",
                        background: "#0c2b14",
                        color: running ? MUTED : GREEN,
                        border: `1px solid ${running ? MUTED : "#1a5c2a"}`,
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 500,
                        opacity: !proxies.length ? 0.4 : 1,
                     }}
                  >
                     {running ? "[ running... ]" : "[ check all ]"}
                  </button>
                  {running ? (
                     <button
                        onClick={stopCheck}
                        style={{
                           padding: "9px 16px",
                           background: "#2b0c0c",
                           color: RED,
                           border: "1px solid #5c1a1a",
                           borderRadius: 8,
                           fontSize: 12,
                        }}
                     >
                        [ stop ]
                     </button>
                  ) : (
                     <button
                        onClick={recheckFailed}
                        disabled={!counts.failed}
                        style={{
                           padding: "9px 16px",
                           background: "#1f1a08",
                           color: AMBER,
                           border: "1px solid #5c4a1a",
                           borderRadius: 8,
                           fontSize: 12,
                           opacity: counts.failed ? 1 : 0.4,
                        }}
                     >
                        [ recheck failed ]
                     </button>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                     <div style={{ flex: 1 }}>
                        <label
                           style={{
                              fontSize: 10,
                              color: MUTED,
                              display: "block",
                              marginBottom: 4,
                           }}
                        >
                           потоков
                        </label>
                        <input
                           type="number"
                           min={1}
                           max={500}
                           value={concurrency}
                           disabled={running}
                           onChange={(e) =>
                              setConcurrency(
                                 Math.max(
                                    1,
                                    Math.min(500, +e.target.value || 1),
                                 ),
                              )
                           }
                           style={{
                              width: "100%",
                              padding: "7px 10px",
                              fontSize: 12,
                           }}
                        />
                     </div>
                     <div style={{ flex: 1 }}>
                        <label
                           style={{
                              fontSize: 10,
                              color: MUTED,
                              display: "block",
                              marginBottom: 4,
                           }}
                        >
                           таймаут, мс
                        </label>
                        <input
                           type="number"
                           min={200}
                           max={10000}
                           step={100}
                           value={timeoutMs}
                           disabled={running}
                           onChange={(e) =>
                              setTimeoutMs(
                                 Math.max(
                                    200,
                                    Math.min(10000, +e.target.value || 1000),
                                 ),
                              )
                           }
                           style={{
                              width: "100%",
                              padding: "7px 10px",
                              fontSize: 12,
                           }}
                        />
                     </div>
                  </div>
               </div>
            </div>
​
            <div
               style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: "wrap",
               }}
            >
               <span style={{ fontSize: 10, color: MUTED }}>
                  строки без схемы (ip:port:login:pass) — считать как:
               </span>
               {["socks5", "http"].map((p) => (
                  <Pill
                     key={p}
                     label={p}
                     active={plainProto === p}
                     onClick={() => setPlainProto(p)}
                  />
               ))}
            </div>
​
            <div
               style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                  flexWrap: "wrap",
               }}
            >
               <span style={{ fontSize: 10, color: MUTED }}>
                  формат копирования:
               </span>
               <Pill
                  label="URI — для v2rayN"
                  color={GREEN}
                  active={copyFormat === "uri"}
                  onClick={() => setCopyFormat("uri")}
               />
               <Pill
                  label="ip:port:login:pass"
                  color={GREEN}
                  active={copyFormat === "plain"}
                  onClick={() => setCopyFormat("plain")}
               />
            </div>
​
            {proxies.length > 0 && (
               <div style={{ marginBottom: 16 }}>
                  <div
                     style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        marginBottom: 10,
                        flexWrap: "wrap",
                     }}
                  >
                     <div style={{ display: "flex", gap: 20 }}>
                        <Stat
                           label="всего"
                           value={proxies.length}
                           color={TEXT}
                        />
                        {mergedCount > 0 && (
                           <Stat
                              label="склеено"
                              value={mergedCount}
                              color={AMBER}
                           />
                        )}
                        <Stat
                           label="проверено"
                           value={counts.checked}
                           color={BLUE}
                        />
                        <Stat
                           label="доступно"
                           value={counts.online}
                           color={GREEN}
                        />
                        <Stat
                           label="ошибка / таймаут"
                           value={counts.failed}
                           color={RED}
                        />
                        {counts.untestable > 0 && (
                           <Stat label="не проверяется" value={counts.untestable} color={AMBER} />
                        )}
                        <Stat
                           label={geoBusy ? "RU (резолв…)" : "RU"}
                           value={counts.ru}
                           color={AMBER}
                        />
                     </div>
                     <div
                        style={{
                           marginLeft: "auto",
                           display: "flex",
                           gap: 8,
                           flexWrap: "wrap",
                        }}
                     >
                        {[
                           ["hide", "hide RU"],
                           ["all", "show RU"],
                           ["only", "only RU"],
                        ].map(([m, l]) => (
                           <Pill
                              wide
                              key={m}
                              label={l}
                              color={AMBER}
                              active={ruMode === m}
                              onClick={() => setRuMode(m)}
                           />
                        ))}
                        <Pill
                           wide
                           label="only online"
                           active={onlyOnline}
                           color={GREEN}
                           onClick={() => setOnlyOnline((v) => !v)}
                        />
                        {["index", "status", "latency"].map((m) => (
                           <Pill
                              wide
                              key={m}
                              label={m}
                              active={sortMode === m}
                              onClick={() => setSortMode(m)}
                           />
                        ))}
                        <button
                           onClick={copyAllWorking}
                           disabled={!counts.online}
                           style={{
                              padding: "5px 14px",
                              fontSize: 11,
                              borderRadius: 6,
                              border: `1px solid ${counts.online ? "#1a5c2a" : BORDER}`,
                              background: copiedAll
                                 ? "#0c2b14"
                                 : counts.online
                                   ? "#0a1f10"
                                   : "transparent",
                              color: counts.online ? GREEN : MUTED,
                              opacity: counts.online ? 1 : 0.4,
                           }}
                        >
                           {copiedAll
                              ? `✓ скопировано ${counts.online}`
                              : `[ copy ${counts.online} working ]`}
                        </button>
                     </div>
                  </div>
​
                  {availableProtos.length > 1 && (
                     <div
                        style={{
                           display: "flex",
                           gap: 6,
                           flexWrap: "wrap",
                           marginBottom: 10,
                        }}
                     >
                        <Pill
                           label={`all · ${proxies.length}`}
                           active={filterProto === "all"}
                           onClick={() => setFilterProto("all")}
                        />
                        {availableProtos.map((proto) => (
                           <Pill
                              key={proto}
                              label={`${proto} · ${protoCounts[proto]}`}
                              active={filterProto === proto}
                              color={PROTO_COLORS[proto]?.text}
                              onClick={() => setFilterProto(proto)}
                           />
                        ))}
                     </div>
                  )}
​
                  {groupProgress.length > 0 ? (
                     <div style={{ marginBottom: 12 }}>
                        <div
                           role="progressbar"
                           aria-label="Общий прогресс проверки по источникам"
                           aria-valuemin={0}
                           aria-valuemax={proxies.length}
                           aria-valuenow={counts.checked + counts.untestable}
                           style={{
                              height: 12, display: "flex", background: BORDER,
                              borderRadius: 4, overflow: "hidden",
                           }}
                        >
                           {groupProgress.filter((g) => g.unique > 0).map((g) => (
                              <div
                                 key={g.sourceIndex}
                                 title={`${g.name}: обработано ${g.processed}/${g.unique}; ответили ${g.online}/${g.measured}${g.rate === null ? "" : ` (${(g.rate * 100).toFixed(1)}%)`}; найдено ${g.total}`}
                                 style={{
                                    width: `${(g.unique / proxies.length) * 100}%`,
                                    height: "100%", background: "#172330",
                                    borderRight: "1px solid #0b0e11", overflow: "hidden",
                                 }}
                              >
                                 <div style={{
                                    width: `${(g.processed / g.unique) * 100}%`,
                                    height: "100%", background: g.color,
                                    transition: "width 0.3s",
                                 }} />
                              </div>
                           ))}
                        </div>
                        <details style={{ marginTop: 7, fontSize: 10, color: MUTED }}>
                           <summary style={{ cursor: "pointer", color: TEXT }}>
                              {priorityReady ? "Источники: по проценту ответов" : "Источники: начальная выборка"} · обработано {counts.checked + counts.untestable}/{proxies.length}
                           </summary>
                           <p style={{ margin: "6px 0", lineHeight: 1.5 }}>
                              Сначала проверяется до 100 записей из каждой пачки, затем приоритет
                              получают пачки с наибольшей долей успешных ответов; процент
                              пересчитывается по мере проверки. Непроверяемые порты не влияют
                              на процент. При равенстве раньше идёт меньшая пачка. Дубликат
                              относится к первому, меньшему источнику. Браузерная проверка
                              приблизительная и не подтверждает работу VPN.
                           </p>
                           <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px" }}>
                              {groupProgress.map((g) => (
                                 <div key={g.sourceIndex} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                    <span style={{
                                       width: 9, height: 9, borderRadius: 2,
                                       background: g.color, flexShrink: 0,
                                    }} />
                                    <span title={`Распознано в источнике: ${g.total}; уникальных после объединения: ${g.unique}; успешно ответили: ${g.online}`}>
                                       {g.name}: {g.rate === null ? "—" : `${(g.rate * 100).toFixed(1)}%`} ({g.online}/{g.measured}) · обработано {g.processed}/{g.unique} · найдено {g.total}
                                    </span>
                                 </div>
                              ))}
                           </div>
                        </details>
                     </div>
                  ) : running && (
                     <div style={{ height: 3, background: BORDER, borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
                        <div style={{ height: "100%", width: `${progress * 100}%`, background: GREEN, transition: "width 0.3s" }} />
                     </div>
                  )}
​
                  <div
                     style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                        marginBottom: 10,
                        fontSize: 11,
                     }}
                  >
                     <span style={{ color: MUTED }}>
                        Тяните мышью по строкам → Ctrl+C / ⌘C. Shift — диапазон,
                        Ctrl / ⌘ — добавить, Ctrl+A / ⌘A — все, Esc — снять.
                     </span>
                     <span aria-live="polite">
                        Выделено: {selection.selectedCount}
                     </span>
                     <button
                        disabled={!selection.selectedCount}
                        onClick={selection.copySelected}
                        style={{
                           padding: "5px 10px",
                           background: "#0c1f38",
                           color: BLUE,
                           border: `1px solid ${BORDER}`,
                           borderRadius: 6,
                           opacity: selection.selectedCount ? 1 : 0.4,
                        }}
                     >
                        Копировать выделенные
                     </button>
                     <button
                        onClick={selection.clear}
                        style={{
                           padding: "5px 10px",
                           background: "transparent",
                           color: MUTED,
                           border: `1px solid ${BORDER}`,
                           borderRadius: 6,
                        }}
                     >
                        Снять выделение
                     </button>
                     <span role="status" style={{ color: GREEN }}>
                        {selection.copyMessage}
                     </span>
                  </div>
​
                  {/* Virtualized table: only ~60 rows exist in the DOM regardless of list size */}
                  <div
                     style={{
                        overflowX: "auto",
                        border: `1px solid ${BORDER}`,
                        borderRadius: 10,
                     }}
                  >
                     <div style={{ minWidth: 1160 }}>
                        <div
                           style={{
                              display: "grid",
                              gridTemplateColumns: COLS,
                              height: 32,
                              alignItems: "center",
                              borderBottom: `1px solid ${BORDER}`,
                              paddingRight: 6,
                           }}
                        >
                           {HEADERS.map((h, i) => (
                              <div
                                 key={i}
                                 style={{
                                    ...cell,
                                    color: MUTED,
                                    fontSize: 10,
                                    letterSpacing: "0.08em",
                                 }}
                              >
                                 {h}
                              </div>
                           ))}
                        </div>
                        <div
                           ref={selection.viewportRef}
                           tabIndex={0}
                           role="region"
                           aria-label="Результаты тестов: выделение строк и копирование"
                           onScroll={onScroll}
                           onPointerDown={selection.onPointerDown}
                           onPointerMove={selection.onPointerMove}
                           onPointerUp={selection.finishDrag}
                           onPointerCancel={selection.finishDrag}
                           onLostPointerCapture={selection.finishDrag}
                           onCopy={selection.onCopy}
                           onKeyDown={selection.onKeyDown}
                           style={{
                              userSelect: "none",
                              WebkitUserSelect: "none",
                              height: VIEW_H,
                              overflowY: "auto",
                              position: "relative",
                           }}
                        >
                           <div
                              style={{
                                 height: visible.length * ROW_H,
                                 position: "relative",
                              }}
                           >
                              {Array.from(
                                 { length: Math.max(0, end - start) },
                                 (_, k) => {
                                    const row = start + k;
                                    const i = visible[row];
                                    return (
                                       <Row
                                          key={i}
                                          p={proxies[i]}
                                          row={row}
                                          idx={i}
                                          geo={geoRef.current[i]}
                                          status={st[i]}
                                          latency={lat[i]}
                                          copied={copied === i}
                                          selected={selection.selected.has(i)}
                                          copyFormat={copyFormat}
                                          onCopy={copyUri}
                                       />
                                    );
                                 },
                              )}
                              {visible.length === 0 && (
                                 <div
                                    style={{
                                       padding: 24,
                                       textAlign: "center",
                                       color: MUTED,
                                       fontSize: 11,
                                    }}
                                 >
                                    нет строк под текущий фильтр
                                 </div>
                              )}
                           </div>
                        </div>
                     </div>
                  </div>
​
                  <p style={{ marginTop: 10, fontSize: 10, color: MUTED }}>
                     * Это приблизительная браузерная проверка: WS/HTTPUpgrade →
                     попытка WebSocket, остальные → HTTP(S) fetch no-cors. Она не
                     проверяет работу VPN/прокси, протокол или авторизацию, а ошибки
                     браузера, CORS, TLS и сетевых политик не доказывают недоступность.
                     UDP/QUIC через HTTP не проверяется. Для настоящей проверки нужен
                     отдельный сервер с поддержкой соответствующих протоколов.
                     <br />* В режиме «URI» строки ip:port:login:pass
                     конвертируются в socks://BASE64(login:pass)@host:port или
                     http://login:pass@host:port; если v2rayN не примет ссылку,
                     переключитесь на ip:port:login:pass.
                     <br />* Geo: офлайн-таблица RU-диапазонов (RIR, IPv4 + IPv6
                     до /48); домены резолвятся через DoH (Cloudflare → Google),
                     RU если любой из A/AAAA попал в диапазон. «?» — не удалось
                     резолвить, такие не скрываются. Это страна регистрации IP,
                     а не гарантия физического расположения (CDN, relay).
                     <br />* Дубликаты (отличаются только названием, spx,
                     headerType=none и т.п.) склеиваются; бейдж ×N — число
                     склеенных строк.
                  </p>
               </div>
            )}
​
            {!proxies.length && (
               <div
                  style={{
                     border: `1px dashed ${BORDER}`,
                     borderRadius: 10,
                     padding: "40px 24px",
                     textAlign: "center",
                     color: MUTED,
                     fontSize: 12,
                  }}
               >
                  <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>
                     ⬡
                  </div>
                  <div style={{ marginBottom: 8 }}>
                     {parsing
                        ? "парсинг..."
                        : "вставьте прокси URI выше и нажмите [ parse ]"}
                  </div>
                  <div style={{ fontSize: 10, color: "#2d3d4e" }}>
                     {SUPPORTED.join("  ·  ")}
                  </div>
               </div>
            )}
         </div>
      </div>
   );
}




