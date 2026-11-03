// 동행복권 당첨결과를 받아 data.js 를 갱신한다. 실행: node scripts/update-draws.mjs
// 기존 data.js 의 마지막 회차 다음부터 새 회차만 추가한다. Node 18+ 내장 fetch 만 사용.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const DATA_PATH = fileURLToPath(new URL('../data.js', import.meta.url));
const ENDPOINT = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do';
const DELAY_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadExisting() {
  if (!existsSync(DATA_PATH)) return [];
  const ctx = { window: {} };
  vm.runInNewContext(await readFile(DATA_PATH, 'utf8'), ctx);
  if (!Array.isArray(ctx.window.LOTTO_DRAWS)) throw new Error('data.js 형식이 올바르지 않습니다.');
  return ctx.window.LOTTO_DRAWS;
}

// center=N 요청 → N+4 ~ N-5 회차(최대 10개)
async function fetchAround(center) {
  const url = `${ENDPOINT}?srchDir=center&srchLtEpsd=${center}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (lotto data updater)',
          'Referer': 'https://www.dhlottery.co.kr/lt645/result',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list = body?.data?.list;
      if (!Array.isArray(list)) throw new Error('응답에 data.list 가 없습니다.');
      return list;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url} 요청 실패: ${e.message}`);
      await sleep(DELAY_MS * 5 * attempt);
    }
  }
}

function toRow(x) {
  const ymd = String(x.ltRflYmd);
  if (!/^\d{8}$/.test(ymd)) throw new Error(`${x.ltEpsd}회 날짜 형식 오류: ${ymd}`);
  const amt = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return [
    Number(x.ltEpsd),
    `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`,
    Number(x.tm1WnNo), Number(x.tm2WnNo), Number(x.tm3WnNo),
    Number(x.tm4WnNo), Number(x.tm5WnNo), Number(x.tm6WnNo),
    Number(x.bnsWnNo),
    amt(x.rnk1WnAmt), amt(x.rnk2WnAmt), amt(x.rnk3WnAmt),
  ];
}

function validate(rows) {
  rows.forEach((r, i) => {
    if (r[0] !== i + 1) throw new Error(`회차가 연속이 아닙니다: ${i + 1}회 자리에 ${r[0]}회`);
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(r[1])) throw new Error(`${r[0]}회 날짜 오류: ${r[1]}`);
    const nums = r.slice(2, 9);
    if (!nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 45)) throw new Error(`${r[0]}회 번호 범위 오류: ${nums}`);
    if (new Set(nums).size !== 7) throw new Error(`${r[0]}회 번호 중복: ${nums}`);
    if (!r.slice(9, 12).every((n) => Number.isInteger(n) && n >= 0)) throw new Error(`${r[0]}회 금액 오류`);
  });
}

function render(rows) {
  const lines = rows.map((r) => '  ' + JSON.stringify(r).replace(/,/g, ', ') + ',');
  return [
    '// 자동 생성 파일 — 직접 수정하지 말 것 (scripts/update-draws.mjs)',
    'window.LOTTO_DRAWS = [',
    '  // [회차, "YYYY.MM.DD", n1, n2, n3, n4, n5, n6, 보너스, 1등 1인당, 2등 1인당, 3등 1인당]',
    ...lines,
    '];',
    '',
  ].join('\n');
}

async function main() {
  const rows = await loadExisting();
  validate(rows);
  const before = rows.length;

  for (;;) {
    const next = rows.length + 1;
    const list = await fetchAround(next + 5); // next ~ next+9 를 받는다
    const fresh = list.map(toRow).filter((r) => r[0] >= next).sort((a, b) => a[0] - b[0]);
    // 연속된 회차만 추가. 추첨 전 회차는 응답에 없으므로 여기서 멈춘다.
    let added = 0;
    for (const r of fresh) {
      if (r[0] !== rows.length + 1) break;
      rows.push(r);
      added++;
    }
    if (added === 0) break;
    process.stdout.write(`\r${rows[rows.length - 1][0]}회까지 받음`);
    await sleep(DELAY_MS);
  }
  if (rows.length > before) process.stdout.write('\n');

  validate(rows);
  if (rows.length === before) {
    console.log(`새 회차 없음 (마지막 ${before}회). data.js 를 그대로 둡니다.`);
    return;
  }
  await writeFile(DATA_PATH, render(rows), 'utf8');
  console.log(`${before + 1}회 ~ ${rows.length}회 추가 (${rows.length - before}개). data.js 저장.`);
}

main().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
