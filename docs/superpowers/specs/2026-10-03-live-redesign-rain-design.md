# หน้าหลักใหม่และป้ายฝนตกรายกล้อง

วันที่: 2026-10-03
สถานะ: แบบในบทสนทนาได้รับการตอบรับ; เอกสารนี้รอผู้ใช้ตรวจ ก่อนจัดทำ implementation plan

## สิ่งที่ผู้ใช้ต้องการ

ปรับหน้าหลักที่แสดงกล้องให้สวยและใช้งานง่ายขึ้น เมื่อกล้องใดเริ่มเห็นฝนให้ขึ้นข้อความ **“ฝนตก”** ที่กล้องนั้น เก็บผลย้อนหลังสำหรับวิเคราะห์ในเมนู Analysis ที่มีอยู่ ผู้ใช้ยืนยันว่าใช้เพียงข้อความบนหน้าจอ ไม่ต้องเพิ่มเสียง การแจ้งเตือนเบราว์เซอร์ หรือ LINE ในงานนี้

ความสำเร็จคือภาพกล้องมีพื้นที่มากขึ้น เครื่องมือสแกนเข้าใจง่าย ป้ายฝนสัมพันธ์กับรหัสกล้องจริง และเปิดประวัติของกล้องนั้นได้ ผลฝนและน้ำท่วมเป็นข้อมูลคนละชนิด แต่ใช้ทะเบียน 40 รหัสกล้องร่วมกัน รหัสที่อยู่หลายกลุ่มต้องประมวลผลและนับครั้งเดียว

## สภาพปัจจุบันที่ตรวจจากโค้ด

- เว็บ static ใช้ HTML/CSS/JavaScript และ hls.js; หน้าภาพสดมี header, navigation, filters และ workspace tools ซ้อนหลายแถว
- ภาพทดสอบจริงที่ 1440×900 แสดง 4 กล้อง แต่พื้นที่วิดีโอเตี้ยและมีขอบดำด้านข้างกว้าง ภาพมือถือ 390×844 มีเครื่องมือกินพื้นที่ส่วนบนมาก
- มี API, SQLite, worker, ROI editor และ Analysis สำหรับน้ำท่วมแล้วใน `backend/flood/` และ `scripts/`
- การ capture ปัจจุบันอ่านภาพเดียวต่อรอบ ตัว segmentation ตรวจพื้นที่น้ำ ไม่มีสัญญาผลตรวจฝน
- โหมดทั้งหมดมี 40 tiles และจำกัด player ที่มองเห็นสูงสุด 9 ตัว ต้องรักษาพฤติกรรมนี้
- โมเดลน้ำท่วมเคยติดปัญหาดาวน์โหลดน้ำหนักจาก TLS; ความพร้อมของตัวตรวจฝนต้องวัดแยกจากความพร้อมโมเดลน้ำท่วม

## ทางเลือกและข้อสรุป

เลือกตัวตรวจจากวิดีโอสั้นบน backend โดยเริ่มด้วยตัวตรวจลักษณะเส้นฝนและความเปลี่ยนแปลงระหว่างเฟรมที่ประเมินผลบนคลิปจริงได้ ใช้ CPU และ OpenCV มีรุ่น algorithm กับค่าตั้งกำกับทุก observation เหมาะกับการเพิ่มข้อความเดียวและการเก็บประวัติบนเครื่องที่มีอยู่ ข้อจำกัดคือฝนบางเบาหรือเส้นฝนที่มองไม่เห็น และรถ แสงสะท้อน กลางคืน หรือหยดติดเลนส์อาจรบกวน ต้องปรับบริเวณตรวจและวัด false positives ก่อนเปิดใช้รายกล้อง

ทางเลือก 3D CNN ที่ฝึกสำหรับ rain/no-rain อาจให้ผลดีกว่า แต่ต้องมี checkpoint ที่ตรวจสิทธิ์และดาวน์โหลดได้ รวมถึงประเมินกับมุมกล้องจริง เป็น adapter ที่เปลี่ยนแทนตัวตรวจรุ่นแรกภายหลังได้ งานนี้ไม่อ้างว่ามี checkpoint หรือผลความแม่นยำพร้อมแล้ว

การใช้ข้อมูลอากาศระดับพื้นที่ไม่ตอบคำถามว่าภาพกล้องนี้เห็นฝนหรือไม่ จึงเลือกตรวจจากภาพของแต่ละกล้องตามเจตนาผู้ใช้

## หน้าหลักและพฤติกรรม

โทนกรมท่า–เขียวมิ้นต์ ใช้ภาพกล้องจริงเป็นองค์ประกอบหลัก พื้นหลังและเส้นแบ่งเรียบ ข้อมูลแน่นแต่ชัดเจน

1. Desktop: รวมแบรนด์ เมนู **ภาพสด / Analysis น้ำท่วมและฝน** และเวลาไว้แถบบนเดียว ใช้แถวเครื่องมือสำหรับค้นหา ทางแยก กล้องโปรด และจำนวนจอ จัดสถานะการเล่นและ pagination ให้มีตำแหน่งคงที่
2. ปรับพื้นที่ grid และ caption ให้ภาพสูงขึ้นในขนาดหน้าจอเดิม รักษา `object-fit: contain` เพื่อเห็นภาพครบ ไม่ขยายด้วยการตัดส่วนของถนนออก ขนาดจอ 1/4/9/16 ยังเลือกได้; บางสัดส่วนมี letterboxing ตามแหล่งวิดีโอ
3. ใต้ภาพรวมรหัส ชื่อกล้อง ทางแยก สถานะการเล่น ปุ่มโปรด และสถานะเฝ้าระวังเป็นบริเวณที่อ่านต่อกันได้ ป้าย **ฝนตก** อยู่ใกล้ชื่อกล้องและไม่ปิดทับภาพ ข้อความกับไอคอนต้องสื่อได้โดยไม่พึ่งสีอย่างเดียว
4. สำหรับผล `dry` ใช้ข้อความรอง “ไม่พบฝน”; `unknown` ใช้ “ประเมินฝนไม่ได้”; `unconfigured` ใช้ “ยังไม่เปิดตรวจฝน” ป้ายเน้นใช้เฉพาะ `rainy` ไม่มีป้ายแดงแทนสถานะน้ำท่วม
5. กดผลฝนเพื่อดูเวลาตรวจล่าสุด เหตุผลเมื่อประเมินไม่ได้ ภาพหลักฐาน และลิงก์ Analysis ของกล้อง ไม่แสดงคะแนน algorithm เป็นเปอร์เซ็นต์ความแม่นยำ
6. Mobile: แบรนด์และเมนูเห็นชัด ตัวกรองขึ้นบรรทัดตามความกว้าง ปุ่มแตะอย่างน้อย 44px ภาพเดียวและ swipe ทำงานเดิม โหมดทั้งหมดเป็นรายการสองคอลัมน์ที่เลื่อนได้
7. ใช้ transition สั้นสำหรับเมนู สถานะ hover/focus และการเปิดรายละเอียด รองรับ reduced motion ไม่กระพริบป้ายฝนซ้ำทุกครั้งที่ polling

ไม่มี KPI ตกแต่ง ตัวเลขฝนจำลอง หรือภาพ placeholder ที่ทำให้เข้าใจว่าเป็นกล้องจริง การค้นหา โปรด tour fullscreen keyboard shortcuts และการปล่อย player เมื่อเปลี่ยนหน้าใช้พฤติกรรมเดิม

## ส่วนประกอบและการไหลของข้อมูล

เพิ่ม `backend/rain/` ที่แยก contracts, capture, detector, classification, store, analytics และ worker; ใช้ทะเบียนกล้องและการ resolve FFmpeg เดิม API rain ลงทะเบียนใน FastAPI process เดิม ส่วน rain worker เป็น process ต่างหาก ใช้ฐานข้อมูล `runtime/rain/rain.sqlite3` เพื่อไม่ต้องเปลี่ยน schema ของข้อมูลน้ำท่วมเดิม

เส้นทางข้อมูล: ทะเบียนกล้อง → capture คลิปสั้น → ตรวจคุณภาพ → ตัวตรวจฝนในบริเวณที่กำหนด → ยืนยันสถานะ → transaction เก็บ observation/เหตุการณ์ → API → ป้ายหน้า Live และกราฟ Analysis

Rain config แยกจาก flood ROI: `camera_id`, `enabled`, `roi` normalized polygon, `revision`, `detector_revision`, `thresholds`, `validated_at` และ `validation_id` พื้นที่สำหรับเห็นเม็ดฝนอาจต่างจากพื้นที่ถนนที่ใช้ตรวจน้ำ ไม่มีการนำ flood ROI มาใช้เป็น rain ROI โดยอัตโนมัติ กล้องใหม่เป็น `unconfigured`; ใช้หน้าตั้งพื้นที่เดิมโดยเลือกชนิดฝนหรือน้ำและส่ง config ไป endpoint ที่ตรงชนิด ผล validation ผูกกับ camera/ROI/thresholds/algorithm revision; การแก้ค่าที่มีผลต่อการตรวจทำให้ต้อง validate ใหม่

## Capture และตัวตรวจรุ่นแรก

- เริ่ม sampling เป้าหมายหนึ่งคลิปต่อกล้องทุก 60 วินาที คลิปยาว 2 วินาทีที่ 8 fps เก็บ 16 เฟรม ลดความกว้างสูงสุด 640px และรักษาสัดส่วน ตัวเลขนี้เป็นค่าตั้งต้น ต้องวัด cadence ทั้ง 40 กล้องก่อนรายงานเวลาที่ทำได้จริง
- ใช้ FFmpeg argument list ไม่ผ่าน shell รับ URL จาก catalog เท่านั้น มี capture deadline 20 วินาที จำกัดจำนวนเฟรมและขนาด output 32 MiB และตรวจ process cleanup ทั้ง timeout/output เกินขอบเขต คลิปอยู่ในหน่วยความจำและทิ้งหลังวิเคราะห์
- ตัวตรวจ CPU คำนวณ grayscale temporal median และการเปลี่ยนแปลงความสว่างระหว่างเฟรมใน rain ROI หาส่วนที่เป็นเส้นบางชั่วคราว กรองขนาด รูปร่าง ทิศทาง และการเกิดกระจายในหลายตำแหน่ง/หลายเฟรม; แยกวัตถุใหญ่ที่เคลื่อนที่ แสงทั้งภาพเปลี่ยน และกล้องเคลื่อนจากหลักฐานฝน
- ตั้งค่าความต่างความสว่างขั้นต่ำ รูปร่าง streak จำนวนตำแหน่งที่เกิด และสัดส่วนเฟรมที่ผ่านได้รายกล้อง โดยเก็บใน config revision การแปลเป็น raw rain/no-rain ใช้เกณฑ์ที่ผ่านชุดคลิป validation ของกล้องนั้น ไม่มีค่าเริ่มต้นที่อ้างว่าพิสูจน์ความแม่นยำแล้ว
- `detector_score` เป็นดัชนีหลักฐานเส้นฝนช่วง 0–1 ไม่ใช่ probability ที่ calibrated และไม่ใช่ปริมาณฝน mm/h บันทึก feature diagnostics และ revision สำหรับตรวจย้อนหลัง
- ภาพดำ เบลอมาก ROI ใช้ไม่ได้ ความสว่างเปลี่ยนทั้งภาพ หรือจำนวนเฟรมใช้งานไม่พอ ให้ `unknown` พร้อม reason การไม่มี motion ของถนนไม่ใช่หลักฐานว่ากล้องค้าง; เวลาต้นทางบันทึกเฉพาะเมื่อผูกกับเฟรมที่ decode ได้จริง
- Concurrency: rain capture สูงสุด 2, detector สูงสุด 1, pending สูงสุด 2, detector deadline 10 วินาที ใช้ monotonic scheduling และไม่จัดกล้องเดียวซ้อนกัน จึงไม่เปิดสตรีมครบ 40 ค้างไว้ Flood worker เดิมยังมี capture limit 2; รวม backend สอง worker สูงสุด 4 captures พร้อมกัน

ตัวตรวจนี้เป็น baseline เชิงทดลองจนผ่าน live validation การเดินระบบสำเร็จไม่ได้แปลว่าตรวจฝนแม่นยำ ต้องรายงานผลสองส่วนแยกกัน

## สถานะและเหตุการณ์

Rain statuses: `unconfigured`, `unknown`, `dry`, `rainy` มี timestamp ล่าสุดและ reason ร่วมด้วย

- ขึ้น `rainy` เมื่อ raw rain ผ่านเกณฑ์ 3 ผลต่อเนื่องที่ fresh และ config/algorithm revision เดียวกัน ระหว่างเริ่มยืนยันใช้ `unknown` reason `confirming_rain`
- ลง `dry` เมื่อ raw no-rain ผ่าน 3 ผลต่อเนื่อง ใช้ hysteresis รักษาสถานะก่อนหน้าระหว่างยืนยันหยุด หากยังไม่มีสถานะยืนยันใช้ `unknown` reason `confirming_dry`
- freshness 180 วินาที ค่าเดียวกันต้องใช้ทั้ง worker, API, browser และ analytics ผลเก่าหรือภาพ/API/worker ขัดข้องให้ unknown; reset confirmation sequence เมื่อมี invalid reading, gap เกิน 180 วินาที หรือเปลี่ยน config/algorithm
- เริ่ม event เมื่อสถานะยืนยันเปลี่ยนเป็น rainy บันทึก `first_detected_at` เป็นคลิปแรกในชุดที่ยืนยัน และ `confirmed_at` เป็นคลิปที่ทำให้ครบเกณฑ์ ทั้งสองคือเวลาสังเกต ไม่ใช่เวลาเริ่มตกทางกายภาพที่ทราบแน่นอน
- จบด้วย `end_reason=dry` เมื่อยืนยัน dry โดยใช้คลิปแรกของชุดยืนยัน dry เป็น `ended_at` จบด้วย `data_gap` ณ observation ใช้งานได้สุดท้ายเมื่อข้อมูลขาด; ปิด stale open events ได้แม้ไม่มีผลใหม่
- เมื่อเปลี่ยน config หรือ algorithm ปิด event เดิมด้วยเหตุผลที่ตรง ไม่ต่อข้าม gap ไม่เรียกการขาดข้อมูลว่าฝนหยุด ผลตอน restart ต้องไม่เปิด/แจ้งเหตุการณ์ซ้ำ

## ประวัติ หลักฐาน และ API

Observation เก็บ `camera_id`, `captured_at` (จบคลิป), `clip_started_at`, `processed_at`, `source_at` nullable, status, raw classification, reason, detector_score nullable, diagnostics, config/algorithm revisions และ evidence_id nullable ค่าที่ไม่มีข้อมูลเป็น null ไม่ใช่ 0

ใช้ SQLite WAL transaction สั้น atomic ระหว่าง observation และ event มี unique key ป้องกันการบันทึกซ้ำ indexes ตามกล้อง/เวลา และ evidence ID; schema version ปฏิเสธ schema ใหม่กว่าที่รองรับ ใช้ optimistic config revision เช่นระบบน้ำท่วม

เก็บ observations/events 30 วัน ภาพหลักฐาน 7 วัน เก็บ JPEG ตัวแทนและ overlay ตำแหน่งหลักฐานเส้นฝนตอนเข้า/ออกสถานะ rainy ส่วน raw clips ใน production ไม่เก็บถาวร มี job retention ที่ทำงานแม้ไม่มี active camera ภาพหลักฐานที่สร้างแล้วแต่บันทึก observation ไม่สำเร็จต้องลบหรือเก็บกวาดได้ เครื่องมือ calibration/validation เก็บชุดคลิปที่ติด label ใน directory แยกจากฐานข้อมูลใช้งาน และอ่านกล้องที่ยังไม่เปิดตรวจได้ผ่านคำสั่งผู้ดูแล

เพิ่ม endpoints ภายใต้ API เดิม:

- `GET /api/rain/health`: worker heartbeat, detector readiness, freshness, target และ measured cadence
- `GET /api/rain/cameras`: ผลล่าสุดของแต่ละรหัส
- `GET /api/rain/cameras/{id}/history`: ประวัติแบ่งหน้า
- `GET /api/rain/events`: เหตุการณ์แบ่งหน้าและตัวกรองกล้อง/ทางแยก/เวลา
- `GET /api/rain/analytics`: buckets สำหรับจำนวนกล้องฝนตก/ประเมินได้ และ duration ของ event
- `GET /api/rain/evidence/{id}`: JPEG หรือ overlay จาก ID ที่อ้างอิงในฐานข้อมูล
- `GET/PUT /api/rain/cameras/{id}/config` และ `POST /api/rain/cameras/{id}/snapshot`: การเขียนและ snapshot ใช้ Bearer admin token เดิม

Read config เปิดเผยเฉพาะค่าที่ไม่มี secret เช่น API น้ำเดิม Query จำกัด 30 วัน, 720 buckets, หน้าละไม่เกิน 500 รายการ ตรวจ camera/group/cursor/finite timestamps และ allowlisted evidence kinds ใช้ CORS origins ที่ตั้งไว้ ไม่เปิด filesystem path/stream URL/SQL จาก client

Frontend polling ผลฝนทุก 15 วินาที มี timeout ครอบคลุม response body, cancel และ generation guard; โหลดฝนกับน้ำแยกกัน ความขัดข้องฝนไม่ล้างข้อมูลน้ำและกลับกัน พัก polling เมื่อซ่อนแท็บ แต่ worker ยังเก็บผลต่อเนื่อง เมื่อเปิดกลับให้อ่านใหม่ก่อนใช้ผลเก่า

## Analysis

ใช้เมนู Analysis เดียว เพิ่มตัวเลือก **น้ำท่วม / ฝน** ในหน้าเดียวกัน คง routes น้ำเดิม เพิ่ม hash parameter `kind=rain` สำหรับฝนและ deep link ไปกล้อง/ช่วงเวลา

กราฟฝนแสดงจำนวนรหัสกล้องที่ยืนยันฝนตกตามเวลา พร้อมจำนวนที่ประเมินได้เป็นตัวเทียบ; เมื่อเลือกกล้องเดียวแสดง timeline rainy/dry/unknown และตารางเหตุการณ์เวลาเริ่มตรวจพบ ยืนยัน สิ้นสุด ระยะเวลา และภาพหลักฐาน มีตัวกรอง 1h/24h/7d/30d ตามระบบเดิม

Count buckets ใช้ confirmed reading ล่าสุดที่ fresh ณ ปลาย bucket ของแต่ละรหัส; ถ้าไม่มีกล้องที่มีข้อมูลใช้ค่า null ให้กราฟขาด ไม่ตีความเป็น 0 กล้องฝนตก จำนวน unconfigured/unknown แสดงแยก และไม่เอาผลปัจจุบันเติมอดีต

Duration ใช้ช่วงตั้งแต่ `confirmed_at` ถึง `ended_at` ตัดตาม query range เท่านั้น ไม่รวมเวลารอเริ่มยืนยันระหว่าง `first_detected_at` กับ `confirmed_at` สำหรับ open event ใช้เวลาสุดท้ายที่มี observation ยืนยัน rainy เป็นปลายช่วง ไม่ขยายไปถึงเวลาปัจจุบัน รวมเมื่อช่วงมีข้อมูลต่อเนื่องและไม่ซ้อนกัน ไม่นับช่วง unknown/gap หรือเวลาหลัง fresh expiry; เหตุการณ์ data_gap ติดคำกำกับให้ต่างจากหยุดตก จำนวนกล้องรวม deduplicate ID เสมอ ข้อมูลฝนไม่เปลี่ยนเป็นสัดส่วนน้ำหรือความหนักของฝน

## เกณฑ์ตรวจและส่งมอบ

1. Unit: streak geometry/temporal features, ROI, invalid images, revisions, hysteresis, unknown/gap, out-of-order/duplicate และ bounded capture cleanup ใช้ synthetic เฉพาะ fixtures แยกจากข้อมูลใช้งาน
2. SQLite/API: persist หลัง restart, ปิด stale events แม้ไม่มี reading ใหม่, retention ขณะ idle, token/CORS, query bounds/pagination, bucket counts/duration และไม่รวมข้อมูลสองชนิดผิดกัน
3. Browser: ภาพสด/Analysis, badges ไม่ทับภาพ, source ID, stale/unknown/unconfigured, evidence race, routes น้ำเดิม/ฝนใหม่, filters, โปรด, swipe, fullscreen, tour, player cleanup และ All cap 9; ตรวจ 320/390/768/1440 px กับ desktop ความสูง 650/900 px
4. Visual: เทียบ screenshot ก่อน/หลังจากกล้องจริงที่ viewport เดียวกัน พื้นที่ภาพใน 4 จอที่ 1440×900 ต้องสูงกว่าก่อน และสถานะอ่านได้ใน layout 9/16/All ไม่มี horizontal overflow
5. Live pipeline: อ่านคลิปจาก ITIC จริงอย่างน้อยหนึ่งกล้อง ตรวจ API/ประวัติ/หลักฐานหลัง restart และวัดเวลารอบครบ 40 กล้องผ่านคำสั่ง capture-only ที่ไม่เขียนผล rainy ลงฐานข้อมูล แยกเวลา capture ทั้งทะเบียนกับเวลา detector ของกล้องที่เปิดใช้งาน ไม่อ้าง latency เป้าหมายเป็นผลวัด
6. Rain accuracy: ทำชุดคลิปจริงที่มนุษย์ระบุว่าฝนตก/ไม่ตก ประกอบด้วยถนนแห้ง ถนนเปียกแต่ฝนหยุด รถ แสงสะท้อนและภาพกลางคืน แยก calibration กับ holdout ตามช่วงเหตุการณ์ เพื่อไม่แบ่งเฟรมของเหตุการณ์เดียวไปทั้งสองชุด
7. เปิดใช้กล้องที่ผ่าน validation เท่านั้น: holdout อย่างน้อย 20 rainy และ 20 no-rain clips จากอย่างน้อยสองเหตุการณ์ในแต่ละชนิด ตั้งเกณฑ์รุ่นแรก precision ≥0.90 และ recall ≥0.80 รายงาน confusion matrix, false events/hour และจำนวนคลิป นี่เป็น acceptance threshold ของงาน ไม่ใช่ผลที่วัดได้แล้ว หากยังไม่มีภาพฝนหรือไม่ผ่านให้ส่งมอบข้อจำกัดและคงกล้องนั้น unconfigured
8. กล้องที่ผ่านเฉพาะกลางวันใช้ผลเฉพาะเงื่อนไขแสงที่ประเมินไว้ กลางคืน unknown จนมีชุด validation ที่ผ่าน ไม่อนุมานว่ากล้องอื่นที่ไม่เคยประเมินพร้อมเพราะใช้ algorithm เดียวกัน

ส่งมอบ UI ใหม่และ pipeline พร้อมคู่มือตั้งพื้นที่/เปิดตรวจ/รัน worker/ต่อ API/สำรองข้อมูล และ evidence ผลทดสอบ แยกสถานะ implemented, pipeline verified และ detector validated ให้ตรวจสอบได้ งานนี้ไม่ deploy หรือส่งข้อความภายนอกโดยอัตโนมัติ

## แหล่งอ้างอิงและขอบเขตหลักฐาน

- [Haurum et al., Is it Raining Outside?](https://arxiv.org/abs/1908.04034): ศึกษาการตรวจฝนจากกล้องจราจรและความสำคัญของ ROI ไม่ใช่หลักฐานว่า baseline นี้แม่นยำกับ ITIC
- [บทความฉบับเต็ม](https://arxiv.org/pdf/1908.04034): อธิบายแนวทาง temporal streak และเปรียบเทียบกับ 3D CNN ใช้เป็นแนวคิด ไม่คัดลอกโค้ดหรือติดตั้ง checkpoint ที่ยังไม่ได้ตรวจสิทธิ์
- โค้ดที่ตรวจ: `index.html`, `styles.css`, `scripts/app.js`, `scripts/flood-ui.js`, `scripts/flood-client.js`, `scripts/analyst.js`, `backend/flood/{contracts,capture,worker,store,api,settings}.py`
- ภาพตรวจหน้าปัจจุบัน: `runtime/design-review/before-desktop.png`, `runtime/design-review/before-mobile.png` (local QA artifacts)

## การทบทวนเอกสาร

ตรวจ scope, สถานะ/เวลา, การแยกฝนกับน้ำ, freshness, data gap, NULL, capacity, validation, API compatibility และขอบเขต publication แล้ว ไม่มีการแก้ product code สำหรับงานนี้ เอกสารระบุเกณฑ์ validation ที่ยังต้องทำโดยไม่รายงานเป็นผลสำเร็จ
