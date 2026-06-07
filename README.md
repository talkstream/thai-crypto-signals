[![CI](https://github.com/talkstream/thai-crypto-signals/actions/workflows/ci.yml/badge.svg)](https://github.com/talkstream/thai-crypto-signals/actions/workflows/ci.yml)
[![CodeQL](https://github.com/talkstream/thai-crypto-signals/actions/workflows/codeql.yml/badge.svg)](https://github.com/talkstream/thai-crypto-signals/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/talkstream/thai-crypto-signals/badge)](https://scorecard.dev/viewer/?uri=github.com/talkstream/thai-crypto-signals)
[![Coverage 100%](https://img.shields.io/badge/coverage-100%25%20live%20code-brightgreen)](#quality)
[![Tests: real D1+KV · no module mocks](https://img.shields.io/badge/tests-real%20D1%2BKV%20%C2%B7%20no%20module%20mocks-success)](#quality)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](#quality)
[![Biome](https://img.shields.io/badge/code%20style-Biome-60a5fa?logo=biome&logoColor=white)](#quality)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fe5196?logo=conventionalcommits&logoColor=white)](#quality)
[![Renovate](https://img.shields.io/badge/Renovate-enabled-brightgreen?logo=renovatebot&logoColor=white)](#quality)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

**ไทย** · [English](./README.en.md) · [Русский](./README.ru.md)

> 🇹🇭 **ฉบับร่างจากชุมชน — รอการตรวจทานจากเจ้าของภาษา.** เอกสารภาษาไทยฉบับนี้เขียนขึ้นอย่างตั้งใจ
> แต่ยังรอการตรวจทานขั้นสุดท้ายจากผู้ที่เป็นเจ้าของภาษา หากพบคำผิดหรือสำนวนที่ไม่เป็นธรรมชาติ
> ขอความกรุณาช่วยเสนอแก้ไขผ่าน GitHub ครับ — ฉบับภาษาอังกฤษคือฉบับอ้างอิงหลัก

# Thai Crypto Signals — คู่มือปฏิบัติ: เก็บอัตราแลกเปลี่ยนคริปโตด้วย Cloudflare Workers

> **Repository:** https://github.com/talkstream/thai-crypto-signals ·
> **ตัวอย่างที่รันจริง:** https://thai-crypto-signals.mommyslittlehelper.workers.dev

บริการขนาดเล็กระดับ production ที่ดึงราคาคริปโทเคอร์เรนซีจาก public API ของ **Bitkub** ทุก 2 นาที
จัดเก็บอย่างแม่นยำ แล้วเปิดให้เรียกดูผ่าน read API ขนาดเล็ก ทั้งหมดทำงานบน **Cloudflare Workers**
นอกจากนี้ยังเป็นตัวอย่างเรียนรู้แบบลงมือทำที่เปิดให้ฟรี: วิธีเชื่อมต่อ public API บนโครงสร้าง
serverless ด้วยความถูกต้องแม่นยำที่บริการจริงต้องมี ผมแบ่งปันสิ่งนี้ด้วยความหวังว่าจะเป็นประโยชน์
ต่อผู้ที่กำลังเรียนรู้

> **เพื่อการศึกษาเท่านั้น** ไม่ใช่คำแนะนำด้านการเงินหรือการลงทุน และไม่ใช่การรับรองว่าเป็นไปตาม
> กฎเกณฑ์ของหน่วยงานกำกับดูแล การซื้อขายสินทรัพย์ดิจิทัลมีความเสี่ยงสูง รายละเอียดอยู่ในหัวข้อ
> [คำเตือนเรื่องความเสี่ยง](#risk-notice) ด้านล่าง

---

## เหมาะกับใคร

นักศึกษาหรือนักพัฒนาที่เพิ่งเริ่มต้น ซึ่งอ่าน **JavaScript/TypeScript** พื้นฐานได้และใช้ terminal เป็น
ไม่จำเป็นต้องมีพื้นฐาน Cloudflare หรือบล็อกเชนมาก่อน ส่วนที่เหลือจะอธิบายไปทีละขั้น

**สิ่งที่ต้องเตรียม**
- ติดตั้ง Node.js **22+**, **pnpm** และ **git** (ตรวจสอบด้วย `node -v`, `pnpm -v`, `git -v`)
- สำหรับหัวข้อ deploy ซึ่งเป็นทางเลือก: บัญชี Cloudflare แบบฟรี และความคุ้นเคยเล็กน้อยในการแก้ไฟล์
  config แบบ JSON

**เวลาที่ใช้:** ประมาณ 30 นาทีในการอ่านและรันบนเครื่องตัวเอง หากติดตั้งเครื่องมือไว้แล้ว ครั้งแรก
อาจนานกว่านั้นระหว่างที่ติดตั้ง Node และ pnpm ส่วนหัวข้อ deploy เพิ่มอีกราวครึ่งชั่วโมง

## สิ่งที่จะได้เรียนรู้

1. โครงสร้างของ **public API ของตลาดซื้อขาย** เป็นอย่างไร และจะอ่านราคาอย่างไรให้อยู่ในกติกาของมัน
2. **serverless cron** รันโค้ดตามตารางเวลาได้อย่างไรโดยไม่ต้องดูแลเซิร์ฟเวอร์เอง
3. ทำไมจึงควรเก็บค่าเงินเป็น **จำนวนเต็ม** ไม่ใช่ float — และทำอย่างไร
4. ทำงานที่รันซ้ำให้ **idempotent** (รันสองครั้งก็ปลอดภัย) ด้วยฐานข้อมูลได้อย่างไร
5. ทดสอบโค้ดกับ **โครงสร้างจริง** แทนการใช้ของปลอม (mock) ได้อย่างไร

### อภิธานศัพท์สั้น ๆ
- **API** — วิธีมาตรฐานให้โปรแกรมหนึ่งขอข้อมูลจากอีกโปรแกรมหนึ่งผ่านเครือข่าย
- **Endpoint** — URL เฉพาะของ API ที่คืนข้อมูลชนิดหนึ่ง (เช่น ราคาปัจจุบันทั้งหมด)
- **Serverless / Cloudflare Workers** — คุณอัปโหลดฟังก์ชัน แล้วแพลตฟอร์มรันให้ตามคำขอและตามเวลาที่ตั้งไว้
  ไม่มีเครื่องที่คุณต้องดูแล
- **cron** — ตารางเวลาสำหรับรันงาน (เช่น "ทุก 2 นาที")
- **D1** — ฐานข้อมูล SQL ในตัวของ Cloudflare (SQLite)
- **KV** — แคชแบบ key-value ที่รวดเร็วของ Cloudflare
- **bigint** — ชนิดจำนวนเต็มของ JavaScript ที่ไม่มีขีดจำกัดขนาด ต่างจาก `number` ปกติ
- **minor units (หน่วยย่อย)** — หน่วยจำนวนเต็มที่เล็กที่สุดของค่าเงิน (เช่น สตางค์ หรือ satoshi)
  เก็บเป็นจำนวนเต็มเพื่อไม่ให้เศษส่วนหายไป
- **idempotent** — การทำงานที่รันกี่ครั้งก็ให้ผลเท่ากับรันครั้งเดียว ทำซ้ำได้อย่างปลอดภัย
- **time bucket** — เวลาที่ปัดลงเป็นช่วงคงที่ (ที่นี่คือช่วง 2 นาที) ใช้จัดกลุ่มและกันข้อมูลซ้ำในแต่ละรอบ
- **OHLC** — Open/High/Low/Close สี่ตัวเลขที่สรุปราคาในช่วงเวลาหนึ่ง (แท่งเทียน)

---

## พื้นฐาน: ส่วนประกอบต่าง ๆ

**API ของตลาด.** Bitkub เปิด public API แบบอ่านอย่างเดียว (read-only) ให้ใช้ฟรี ในที่นี้ใช้ 3 endpoint
และไม่มีอันไหนต้องใช้ key:
- `GET /api/v3/market/symbols` — รายการตลาดที่ซื้อขายได้ (เช่น `BTC_THB`) และ **price scale** ของ
  แต่ละตลาด (ราคาใช้ทศนิยมกี่ตำแหน่ง)
- `GET /api/v3/market/ticker` — ภาพรวมปัจจุบันของ **ทุก** ตลาดในคำขอ **เดียว**
- `GET /api/v3/servertime` — เวลาของเซิร์ฟเวอร์ตลาด หน่วยเป็นมิลลิวินาที

**ใช้อย่างสุภาพ.** public API เป็นทรัพยากรส่วนรวม โปรเจกต์นี้จึงเรียกข้อมูลตามตารางที่ไม่หักโหม
(ทุก 2 นาที) ส่ง `User-Agent` ที่ระบุตัวตนชัดเจน ดึงทุกตลาดในคำขอเดียวแทนการยิงทีละสัญลักษณ์
และเรียกเฉพาะ endpoint สาธารณะเท่านั้น ก่อนเขียนระบบอัตโนมัติบน API ใด ควรอ่าน Terms of Service ของ
API นั้นก่อนเสมอ

**Serverless.** แทนที่จะเช่าเครื่องที่เปิดทั้งวัน เราอัปโหลด **Worker** เพียงตัวเดียว Cloudflare จะรันมัน
ตาม 3 ตารางเวลา (เก็บข้อมูล, สรุปเป็นแท่ง, ดูแลรักษา) และทุกครั้งที่มี HTTP request เข้ามา

## ทำงานอย่างไร

```
cron */2 (ทุก 2 นาที)   ─▶  collector  ──GET──▶  Bitkub /market/ticker   (all markets, 1 request)
                              │  pin a time "bucket" (rounded timestamp) to Bitkub's clock
                              │  validate each entry · convert prices to integer "minor units"
                              └─▶ D1 (one atomic write) + KV hot-cache + metrics
cron hourly             ─▶  roll snapshots up into 1-hour, then 1-day OHLC candles
cron daily             ─▶  refresh the market catalogue · delete data past its retention window
HTTP request           ─▶  read API: /health · /v1/symbols · /v1/tickers/latest · …/:symbol · …/rollups
```

ทั้งหมดคือ Worker ตัวเดียว ที่มีงานตามตารางเวลา 3 งานและตัวจัดการ HTTP โดยแบ่งเป็นส่วนเล็ก ๆ
ที่อ่านและทดสอบแยกกันได้

### read API

| เส้นทาง (route) | คืนค่าอะไร |
| --- | --- |
| `GET /health` | ความสดของข้อมูลล่าสุด จำนวนสัญลักษณ์ และตัวนับความผิดปกติ |
| `GET /v1/symbols` | รายการตลาดที่ติดตาม |
| `GET /v1/tickers/latest` | ภาพรวมล่าสุดของทุกตลาด |
| `GET /v1/tickers/:symbol?from=&to=&limit=` | ข้อมูลย้อนหลังของตลาดเดียว |
| `GET /v1/tickers/:symbol/rollups?interval=1h\|1d` | แท่งเทียน OHLC |

---

## เดินชมโค้ด — 5 บทเรียน เชื่อมโยงกับซอร์ส

นี่คือส่วนของโค้ดที่ให้บทเรียนมากที่สุด แต่ละข้อเป็นบทเรียนที่นำไปใช้กับโปรเจกต์อื่นได้ และบอกว่าควรดูตรงไหน
ในไฟล์:

1. **เลขจำนวนเต็มสำหรับค่าเงิน** — [`src/domain/price.ts`](./src/domain/price.ts) ราคามาเป็นสตริง
   ทศนิยม (`"2017050.88"`) การเก็บเป็น float จะสูญเสียความแม่นยำเมื่อค่ามาก จึงแปลงแต่ละราคาเป็น
   **bigint ในหน่วยย่อย** และคงเป็นจำนวนเต็มตลอด *ดูที่:* `parseDecimalToMinor` (สตริง → bigint)
   และ `formatMinorToDecimal` (กลับเป็นสตริง) อ่านคอมเมนต์ส่วนหัวของไฟล์ก่อน
2. **รู้ขีดจำกัดของฐานข้อมูล** — [`src/adapters/storage/d1.ts`](./src/adapters/storage/d1.ts) D1 ไม่
   รับ `bigint` ใน bind และคืนค่าคอลัมน์จำนวนเต็มมาเป็น JS `number` ซึ่งแม่นยำได้ถึง 2⁵³−1 เท่านั้น
   ค่าจึงถูกตรวจกับขอบเขตนี้ตอน parse *ดูที่:* คอมเมนต์ส่วนหัวสั้น ๆ ที่อธิบายขอบเขตและเหตุผล
   *บทเรียน: วัดพฤติกรรมจริงของที่เก็บข้อมูลก่อน แล้วจึงออกแบบให้สอดคล้องกับข้อจำกัดนั้น*
3. **Idempotency** —
   [`src/adapters/storage/collect-store.ts`](./src/adapters/storage/collect-store.ts) ตารางเวลาอาจ
   ทำงานซ้ำสองครั้งสำหรับ time bucket เดียวกัน snapshot เขียนด้วย `INSERT OR IGNORE` ส่วนแถวบันทึก
   การรัน (ledger) มี unique key เข้มงวดที่ผูกกับ bucket ดังนั้นการรันรอบที่สองของ bucket เดิมจะชน
   ข้อจำกัดนั้นและทั้ง batch ถูก roll back การรันซ้ำจึงไม่เปลี่ยนข้อมูล *ดูที่:* `commitCollect`
   และการตรวจ `isUniqueConstraintError`
4. **คณิตศาสตร์ของเวลาที่ไม่คลาดเคลื่อน** — [`src/config/cadence.ts`](./src/config/cadence.ts) คาบ
   การเก็บต้องหาร 60 ลงตัว (1, 2, 3, 4, 5, …) ค่าอย่าง 7 หรือ 13 จะทำให้จังหวะ cron กับการคำนวณ
   bucket ไม่ตรงกันที่ต้นชั่วโมง *ดูที่:* `cronExprFor` (โยน error เมื่อคาบผิด ตั้งแต่ตอนเริ่ม) และ
   `bucketTsFor` (ปัดเวลาลงให้เป็น bucket ของมัน)
5. **ทนต่อข้อมูลที่ไม่ดี** — [`src/collector/collect.ts`](./src/collector/collect.ts) +
   [`src/adapters/bitkub/schemas.ts`](./src/adapters/bitkub/schemas.ts) ticker ถูกตรวจทีละรายการ
   รายการที่เสียหรือไม่รู้จักจะถูกนับและข้าม ส่วนอีกราว 440 รายการที่ดีก็ผ่านไป *ดูที่:* ลูปต่อรายการ
   ที่ `continue` ใน `collect.ts` และ `safeParseTickerEntry` ที่คืน `null` สำหรับรายการที่เสีย

---

## ลองรันเอง

มี 2 แนวทาง แนวทาง **local** ไม่ต้องใช้บัญชี Cloudflare ส่วนแนวทาง **deploy** เป็นทางเลือก

### แนวทาง local (ไม่ต้องมีบัญชี)

```bash
git clone https://github.com/talkstream/thai-crypto-signals
cd thai-crypto-signals
pnpm install
pnpm cf-typegen                                                      # สร้าง type ของ binding
pnpm exec wrangler d1 migrations apply thai-crypto-signals --local   # สร้างตารางในเครื่อง
pnpm test:coverage                                                   # รันชุดทดสอบ
```

ชุดทดสอบสร้าง **D1 และ KV จริงในเครื่อง** (Miniflare) และรันโค้ดของเราจริง ๆ — ไม่มีการ mock โมดูลใดเลย
(ไม่มี `vi.mock`/`vi.spyOn` ทั้งชุด) ขอบเขตภายนอกเพียงจุดเดียวคือตัวแลกเปลี่ยน ซึ่ง**ถูกฉีดเข้ามาเป็น `fetcher`
ที่เล่นคำตอบจริงที่บันทึกไว้** (contract replay ไม่ใช่พฤติกรรมที่กุขึ้น) ส่วนโครง signals phase-2 ที่หลับอยู่ไม่ถูกรัน
ในเทสต์เลย — มันถูกแช่แข็งและตรวจด้วยชนิดข้อมูลแทน ดู `src/signals/contract.ts` นี่คือความหมายของ
"การทดสอบกับโครงสร้างจริง" และเป็นเหตุผลที่ชุดทดสอบจับ bug จริงได้

ตอนนี้รัน Worker ในเครื่องและสั่งให้เก็บข้อมูล 1 รอบด้วยตัวเอง:

```bash
pnpm exec wrangler dev --test-scheduled                     # เปิดที่ http://localhost:8787
# ใน terminal ที่สอง — สั่งงานเก็บข้อมูล */2 หนึ่งครั้ง:
curl "http://localhost:8787/__scheduled?cron=*/2+*+*+*+*"
# จากนั้นอ่านข้อมูลที่เพิ่งเก็บจาก API จริงของ Bitkub:
curl http://localhost:8787/health
curl http://localhost:8787/v1/tickers/latest
```

**✓ จุดตรวจสอบ.** `/health` ควรหน้าตาประมาณนี้:

```json
{
  "ok": true,
  "nowMs": 1780772708158,
  "lastCollectBucketTs": 1780772640000,
  "lastCollectStatus": "partial",
  "lastObservedMs": 1780772647007,
  "symbolCount": 454,
  "recentDrift": 3,
  "recentScaleOverflow": 0
}
```

`ok: true` พร้อม `symbolCount` มากกว่า 0 แปลว่าสำเร็จ ถ้า `symbolCount: 0` มักหมายความว่าข้าม
ขั้นตอน `/__scheduled` ไป — ฐานข้อมูลจะว่างจนกว่าจะมีการเก็บข้อมูล 1 รอบ (`partial` และ `recentDrift`
เล็กน้อยถือเป็นปกติ เพราะมีบางรายการที่ผิดรูปแบบหรือไม่อยู่ในแคตาล็อกจึงถูกข้าม ส่วนตลาดที่มีฝั่งเดียวจะถูกเก็บไว้โดยฝั่ง bid หรือ ask เป็น null)

*หมายเหตุ:* local dev ส่งคำขอ **จริง** ไปยัง Bitkub จากเครื่องของคุณ จึงควรสั่งเท่าที่จำเป็น

**แก้ปัญหาเบื้องต้น**
- `command not found: wrangler` → ให้รันผ่าน `pnpm exec wrangler …` เพราะ Wrangler เป็น dependency
  ของโปรเจกต์ ไม่ใช่โปรแกรมส่วนกลาง
- migrations ผิดพลาด → คำที่สามในคำสั่งต้องเป็น `thai-crypto-signals` พอดี ตรงกับชื่อใน `wrangler.jsonc`
- `/health` ว่าง → สั่ง `/__scheduled` ก่อน (ดูด้านบน) แล้วค่อยอ่านใหม่

### แนวทาง deploy (บัญชี Cloudflare ของคุณเอง, ทางเลือก)

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create my-crypto-db
pnpm exec wrangler kv namespace create CACHE
pnpm exec wrangler queues create my-signals          # และ my-signals-dlq เป็น dead-letter queue
# แก้ wrangler.jsonc: ใส่ database_id / id ของ KV / ชื่อ queue ของคุณแทนค่าเดิม
pnpm exec wrangler d1 migrations apply my-crypto-db --remote
pnpm deploy
```

**✓ จุดตรวจสอบ.** เปิด `https://<worker-ของคุณ>.workers.dev/health` ควรได้รูปแบบเดียวกับจุดตรวจสอบ
แบบ local ให้ cron `*/2` ทำงาน 1 รอบ (ราว 2 นาที) เพื่อเติมข้อมูล หากเจอหน้า error ของ Worker
มักเป็นเพราะยังไม่ได้ apply migrations ด้วย `--remote` หรือ id ของ binding ใน `wrangler.jsonc`
ยังเป็นค่าเดิมไม่ใช่ของคุณ

**ค่าใช้จ่าย.** ฝั่งคำขอนั้นใจกว้าง — requests ของ Workers, cron, KV และ (ตั้งแต่กุมภาพันธ์ 2026) Queues ที่ 10,000
operations ต่อวัน ล้วนอยู่ในโควต้า **ฟรี** ของ Cloudflare แต่ขีดจำกัดจริงคือ **การเขียนลง D1**: ที่คาบเริ่มต้น (ทุก 2 นาที
× ~440 ตลาด) ตัวเก็บข้อมูลเขียนราว 316,000 แถวต่อวัน ซึ่งสูงกว่าลิมิตของ D1 แบบฟรีที่ **100,000 แถวที่เขียนต่อวัน** มาก
(และมากขึ้นอีกเมื่อนับอินเด็กซ์ของ snapshot สองตัว) **ดังนั้นตามค่าที่ตั้งไว้ โปรเจกต์นี้ต้องใช้แพ็กเกจ Workers Paid** เพราะ D1
หากต้องการรันบนโควต้าฟรี ให้ลดปริมาณการเขียนให้ต่ำกว่า 100,000 ต่อวัน เช่น เพิ่มคาบ cron เป็นตัวหารของ 60 ที่ใหญ่ขึ้น
(~20 นาที) และ/หรือเก็บตลาดให้น้อยลง (เช่น เฉพาะคู่ที่อ้างอิง THB)

**เก็บกวาด (เพื่อไม่ให้มีทรัพยากรค้างทำงาน)**

```bash
pnpm exec wrangler delete                             # ตัว Worker
pnpm exec wrangler d1 delete my-crypto-db
pnpm exec wrangler kv namespace delete --namespace-id <id>
pnpm exec wrangler queues delete my-signals
pnpm exec wrangler queues delete my-signals-dlq
```

---

## <a id="risk-notice"></a>คำเตือนเรื่องความเสี่ยง — โปรดอ่าน

เนื้อหานี้ **เพื่อการศึกษาทั่วไปเท่านั้น** ไม่ใช่คำแนะนำด้านการเงินหรือการลงทุน และ **ไม่ใช่** การรับรอง
ว่าเป็นไปตามกฎเกณฑ์ใด ๆ รวมถึงกฎของสำนักงาน ก.ล.ต. ไทย (https://www.sec.or.th) เอกสารนี้ไม่ได้แนะนำ
ให้ซื้อ ขาย หรือถือสินทรัพย์ดิจิทัลใด ๆ การซื้อขายสินทรัพย์ดิจิทัลเช่นคริปโทเคอร์เรนซีมี **ความเสี่ยงสูง
ถึงขั้นสูญเงินลงทุนทั้งหมด** โปรดศึกษาแหล่งข้อมูลทางการและปรึกษาผู้เชี่ยวชาญที่ได้รับอนุญาตก่อนตัดสินใจ
ทางการเงินทุกครั้ง ผู้เขียนและผู้มีส่วนเกี่ยวข้องไม่ได้สนับสนุนการซื้อขาย และไม่รับผิดชอบต่อการนำโค้ดนี้
ไปใช้

---

## แบบฝึกหัด

ลองทำเพื่อให้เข้าใจแนวคิดด้วยตัวเอง แต่ละข้อบอกระดับความยากและคำใบ้

1. **(ง่าย)** เพิ่มตัวกรอง `?quote=THB` ให้ `GET /v1/symbols` เพื่อคืนเฉพาะตลาดที่อ้างอิงสกุลที่ระบุ
   *คำใบ้:* กรองรายการใน `src/api/router.ts` ก่อน serialize
2. **(ปานกลาง)** เพิ่มช่วงสรุปแบบ 15 นาที ควบคู่กับ 1h/1d *คำใบ้:* การสรุปเป็น SQL แบบ set-based ใน
   `src/collector/rollup-job.ts` อย่าลืมกฎ "หาร 60 ลงตัว" ตอนเลือกช่วง
3. **(ปานกลาง)** เขียนเทสต์สำหรับกรณีล้มเหลวแบบใหม่ เช่น ticker คืน HTTP 500 *คำใบ้:* ขอบเขตเดียวที่ถูกแทนคือ
   `fetcher` ที่ฉีดเข้ามา (คำตอบที่บันทึกไว้ ส่งให้ `BitkubAdapter`) ดูตัวอย่างใน `test/integration/collect.test.ts`
4. **(ขั้นสูง)** เปิดใช้งานโครง **signals** ที่ปิดอยู่ และส่งข้อความ Telegram หนึ่งครั้งเมื่อราคาขยับ
   เกิน X% *คำใบ้:* `src/signals/` มีอยู่แล้ว แต่ยังไม่ได้ต่อเข้ากับเส้นทางการเก็บข้อมูล และยังไม่มีโค้ดไหน
   อ่านค่า `SIGNALS_ENABLED` เลย การต่อ producer เข้าไป (และผูกไว้กับแฟล็กนั้น) คือโจทย์ของแบบฝึกหัดนี้
   secret ใส่ด้วย `pnpm exec wrangler secret put …` ทำอย่างสุภาพและจำกัดอัตราการส่ง

---

## ทบทวนตัวเอง

ถ้าตอบได้โดยไม่ต้องเปิดอ่านซ้ำ แสดงว่าบทเรียนติดตัวแล้ว:

- ทำไม float จึงไม่เหมาะกับการเก็บราคา
- อะไรทำให้งานเก็บข้อมูลปลอดภัยเมื่อรันซ้ำในนาทีเดียวกัน
- ทำไมคาบการเก็บจึงต้องหาร 60 ลงตัว
- รายการที่เสียหนึ่งรายการใน ticker ที่มีราว 440 ตลาด เกิดอะไรขึ้น
- โปรเจกต์นี้ปลอมอะไรในเทสต์ และคงอะไรไว้ให้เป็นของจริง

## สรุปและก้าวต่อไป

นี่คือบริการ serverless ที่สมบูรณ์ ทดสอบแล้ว และ deploy ได้ เล็กพอจะอ่านจบได้ภายในวันเดียว ลองรันในเครื่อง
ทำแบบฝึกหัดสักข้อ แล้วเปิดไฟล์จากหัวข้อเดินชมโค้ด แต่ละไฟล์สั้นและเขียนไว้ให้อ่านเข้าใจ

## <a id="quality"></a>คุณภาพและมาตรฐาน

โปรเจกต์เพื่อการเรียนรู้ แต่ยึดมาตรฐานวิศวกรรมระดับ production — และทุกข้อด้านล่าง **ตรวจสอบได้จริง ไม่ใช่แค่ป้ายประดับ**
(รันคำสั่งจากรากของ repo):

| มาตรฐาน / แนวปฏิบัติ | สถานะ | วิธีตรวจสอบ |
|---|---|---|
| ความครอบคลุมเทสต์ของโค้ดที่ใช้งานจริง | ✅ 100% (446/196/90/411) | `pnpm test:coverage` — เกณฑ์กำหนดใน `vitest.config.ts` |
| ไม่ม็อกโมดูล · เทสต์บนโครงสร้างจริง | ✅ | ไม่มีการ **เรียกใช้** `vi.mock`/`vi.spyOn`/`vi.fn` เลย (ชื่อเหล่านี้ปรากฏแค่ในคอมเมนต์); D1+KV เป็นของจริง (Miniflare); ตัวแลกเปลี่ยนคือ `Fetcher` ที่ฉีดเข้ามาพร้อมคำตอบที่บันทึกไว้ |
| TypeScript แบบ strict | ✅ | `tsconfig.json` → `"strict": true`; `pnpm typecheck` (`tsgo --noEmit`) |
| Lint + format (Biome) | ✅ | `pnpm check` — คอนฟิกใน `biome.json` |
| สถาปัตยกรรม Hexagonal (ports & adapters) | ✅ | ขอบเขต hexagon คือ `src/domain/ports.ts`; adapters อยู่ใน `src/adapters/*` |
| Conventional Commits | ✅ | `git log` — บังคับด้วย `commitlint` ผ่าน husky |
| GitHub Actions ตรึงด้วย SHA | ✅ | ทุก `uses:` ใน `.github/workflows/*` เป็น commit SHA พร้อมคอมเมนต์เวอร์ชัน |
| OpenSSF Scorecard | ✅ เผยแพร่แล้ว | ดูแบดจ์ด้านบน → รายงานเต็มที่ [scorecard.dev](https://scorecard.dev/viewer/?uri=github.com/talkstream/thai-crypto-signals) |
| การสแกนโค้ด CodeQL | ✅ 0 รายการ | `.github/workflows/codeql.yml`; ผลอยู่ในแท็บ Security |
| สัญญาอนุญาต Apache-2.0 | ✅ | [`LICENSE`](./LICENSE) |
| สุขอนามัยของ dependency | ✅ | `renovate.json` — ตรึง digests ของ actions และอัปเดต dependency |

**ขอบเขต พูดกันตรง ๆ** "State-of-the-art" ในที่นี้หมายถึง **วิธีการทางวิศวกรรม** — ความครอบคลุม 100% บนรันไทม์จริง,
การทดสอบแบบ contract โดยไม่ม็อก, ดีไซน์ hexagonal และการรีวิวแบบปะทะหลายโมเดล — ไม่ใช่การทำ supply-chain ให้สุดทาง
การเสริมความแข็งแรงของ supply-chain จงใจอยู่ระดับกลาง: ยังไม่มี SLSA-provenance, SBOM หรือ signed releases และ
branch protection ปิดอยู่ เพราะบริการดีพลอยด้วยการ push ตรงเข้า `main` (คะแนน Scorecard สะท้อนสิ่งเหล่านี้อย่างตรงไปตรงมา)

## แหล่งอ้างอิงและเครดิต

- เอกสาร API ทางการของ Bitkub — https://github.com/bitkub/bitkub-official-api-docs
- เอกสาร Cloudflare Workers — https://developers.cloudflare.com/workers/
- ก.ล.ต. ไทย (สินทรัพย์ดิจิทัล) — https://www.sec.or.th
- สร้างด้วย TypeScript, Cloudflare Workers (Cron, D1, KV, Queues, Analytics Engine), Vitest, Zod
  และ Biome ขอบคุณโปรเจกต์โอเพนซอร์สและเอกสารต่าง ๆ ที่ทำให้สิ่งนี้เป็นไปได้

## สัญญาอนุญาต

[Apache-2.0](./LICENSE) ยินดีให้ศึกษา รัน fork และใช้สอนจาก repository นี้
