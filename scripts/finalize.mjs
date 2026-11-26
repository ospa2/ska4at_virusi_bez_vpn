// scripts/finalize.mjs
import fs from "node:fs";

const MIN_DOWNLOAD_MBPS = 3; // поставьте 0, если хотите только сортировать, не удаляя медленные
function parseCsv(text) {
   const rows = [];
   let row = [];
   let field = "";
   let inQuotes = false;
   for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
         if (ch === '"') {
            if (text[i + 1] === '"') {
               field += '"';
               i++;
            } else {
               inQuotes = false;
            }
         } else {
            field += ch;
         }
      } else {
         if (ch === '"') inQuotes = true;
         else if (ch === ",") {
            row.push(field);
            field = "";
         } else if (ch === "\r") {
            // skip
         } else if (ch === "\n") {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
         } else {
            field += ch;
         }
      }
   }
   if (field.length || row.length) {
      row.push(field);
      rows.push(row);
   }
   if (!rows.length) return [];
   const headers = rows[0].map((h) => h.trim().toLowerCase());
   return rows.slice(1).map((cols) => {
      const obj = {};
      headers.forEach((h, idx) => {
         obj[h] = (cols[idx] ?? "").trim();
      });
      return obj;
   });
}

function codeToFlag(code) {
   if (!code || !/^[A-Z]{2}$/i.test(code)) return "";
   const c = code.toUpperCase();
   return String.fromCodePoint(
      0x1f1e6 + c.charCodeAt(0) - 65,
      0x1f1e6 + c.charCodeAt(1) - 65,
   );
}

function setRemark(line, newName) {
   if (line.startsWith("vmess://")) {
      try {
         const raw = line.slice(8).split("#")[0].trim();
         const pad = raw + "=".repeat((4 - (raw.length % 4)) % 4);
         const obj = JSON.parse(
            Buffer.from(
               pad.replace(/-/g, "+").replace(/_/g, "/"),
               "base64",
            ).toString("utf8"),
         );
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

async function lookupExitIps(ips) {
   const map = new Map();
   const unique = [
      ...new Set(ips.filter((x) => x && x.toLowerCase() !== "null")),
   ];
   for (let i = 0; i < unique.length; i += 100) {
      try {
         const ctrl = new AbortController();
         const tid = setTimeout(() => ctrl.abort(), 5000);
         const r = await fetch(
            "http://ip-api.com/batch?fields=status,query,countryCode",
            {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify(unique.slice(i, i + 100)),
               signal: ctrl.signal,
            },
         );
         clearTimeout(tid);
         if (r.ok) {
            for (const item of await r.json()) {
               if (item?.status === "success" && item.countryCode) {
                  map.set(item.query, item.countryCode.toUpperCase());
               }
            }
         }
      } catch {}
   }
   return map;
}

async function main() {
   if (!fs.existsSync("results.csv")) {
      fs.writeFileSync("filtered.txt", "", "utf8");
      fs.writeFileSync("filtered_b64.txt", "", "utf8");
      console.log("results.csv не найден — записан пустой список");
      return;
   }

   const rows = parseCsv(fs.readFileSync("results.csv", "utf8"));
   const passed = rows.filter(
      (r) => r.link && r.status?.toLowerCase() === "passed",
   );

   // Если location пустая/null — добираем по реальному выходному IP из отчёта
   const missingLocIps = passed
      .filter((r) => !/^[A-Z]{2}$/i.test(r.location || ""))
      .map((r) => r.ip);
   const fallbackMap = missingLocIps.length
      ? await lookupExitIps(missingLocIps)
      : new Map();

   const out = [];
   let droppedExitRu = 0;

   // Сортируем от меньшей задержки к большей
   // Сортируем от самой высокой скорости download к низкой, при равенстве — по меньшему delay
   passed.sort((a, b) => {
      const sa = Number(a.download) || 0;
      const sb = Number(b.download) || 0;
      if (sb !== sa) return sb - sa;
      return (Number(a.delay) || 99999) - (Number(b.delay) || 99999);
   });


   for (const r of passed) {
      const dl = Number(r.download) || 0;
      if (dl < MIN_DOWNLOAD_MBPS) {
         continue;
      }

      const cc = /^[A-Z]{2}$/i.test(r.location || "")
         ? r.location.toUpperCase()
         : fallbackMap.get(r.ip) || "";

      if (cc === "RU") {
         droppedExitRu++;
         continue;
      }

      const flag = codeToFlag(cc) || "🌐";
      // Если захотите видеть скорость прямо в названии, например "s🇵🇱 31M":
      // out.push(setRemark(r.link, `s${flag} ${Math.round(dl)}M`));
      out.push(setRemark(r.link, `s${flag}`));
   }

   for (const r of passed) {
      const cc = /^[A-Z]{2}$/i.test(r.location || "")
         ? r.location.toUpperCase()
         : fallbackMap.get(r.ip) || "";

      // Отсеиваем, если выходной IP оказался в RU
      if (cc === "RU") {
         droppedExitRu++;
         continue;
      }

      const flag = codeToFlag(cc) || "🌐";
      out.push(setRemark(r.link, `s${flag}`));
   }

   const unique = [...new Set(out)];
   const plain = unique.join("\n") + (unique.length ? "\n" : "");
   fs.writeFileSync("filtered.txt", plain, "utf8");
   fs.writeFileSync(
      "filtered_b64.txt",
      plain ? Buffer.from(plain, "utf8").toString("base64") : "",
      "utf8",
   );

   console.log(
      `Прошли тест: ${passed.length}, отсеяно RU (выход): ${droppedExitRu}, итого: ${unique.length}`,
   );
}

main().catch((err) => {
   console.error(err);
   process.exit(1);
});
