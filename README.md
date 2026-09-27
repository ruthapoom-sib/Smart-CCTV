# กล้องจราจรฉะเชิงเทรา

หน้าเว็บหน้าเดียวรวมภาพสดกล้อง CCTV จราจร 40 จุด ในเขตเทศบาลเมืองฉะเชิงเทรา
- สตรีม HLS จาก ITIC ข้อมูลกล้องมาจาก [ccs-cctv](https://sites.google.com/view/ccs-cctv)
- เลือกแสดงได้ 4 / 9 / 16 จอ หรือ "ทั้งหมด" ในจอเดียว (ทั้ง 40 จุดใช้เน็ตราว 18 Mbps)
- เปิดหน้ามาจะไม่วนหน้าเอง ถ้าต้องการให้วน กดปุ่ม "วนอัตโนมัติ"
- ถ้า iPhone ขึ้นว่า "แตะเพื่อเล่นภาพสด" (เช่นเปิดโหมดประหยัดพลังงานอยู่) ให้แตะที่จอ 1 ครั้ง

## เปิดในเครื่อง

```
python -m http.server 8000
```

เปิด http://localhost:8000 หรือดับเบิลคลิก `index.html` ก็ได้

- ตรวจ logic: เปิด `http://localhost:8000/index.html#test` ชื่อแท็บต้องเป็น `TEST PASS`
- คีย์ลัด: Space = วนอัตโนมัติ, ← → = เปลี่ยนหน้า, F = เต็มจอ, Esc = ยกเลิกการขยาย

## Deploy บน Vercel

1. เข้า https://vercel.com/new?teamSlug=ruthapoom แล้ว Import repo `ruthapoom-sib/Smart-CCTV`
2. Framework Preset: **Other** และเว้น Build Command กับ Output Directory ว่าง
3. กด Deploy หลังจากนั้นทุกครั้งที่ push ขึ้น `main` จะ deploy ให้อัตโนมัติ

## เพิ่มหรือแก้กล้อง

แก้ array `GROUPS` ใน `index.html` ในรูปแบบ `[ชื่อทางแยก, [[รหัส, ชื่อจุด], …]]` รหัสคือตัวเลขใน `ccsNN.m3u8`
