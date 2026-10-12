/* Sketchbook API (스케치북 게시판 서버)
   GET    /api/sketches          그림 목록 (누구나)
   POST   /api/sketches          그림 올리기 (비밀번호 필요)
   DELETE /api/sketches?id=...   그림 지우기 (비밀번호 필요)

   필요한 Vercel 설정 두 가지:
   - Storage에서 Blob 저장소(Public)를 만들어 이 프로젝트에 연결 → BLOB_READ_WRITE_TOKEN 자동 생성
   - Environment Variables에 SKETCH_PASSWORD (8자 이상) 추가

   그림 파일 이름 규칙:
   sketches/<시간>-<무작위8자>[--<설명(base64url)>].jpg   원본 (긴 변 최대 2000px)
   sketches/t/<시간>-<무작위8자>.jpg                        썸네일 (긴 변 720px)
*/
import { put, list, del } from '@vercel/blob';
import { timingSafeEqual, randomBytes } from 'node:crypto';

const PREFIX = 'sketches/';
const MAX_TOTAL = 4 * 1024 * 1024;   // Vercel 함수 요청 한도(4.5MB)보다 조금 작게
const MAX_CAPTION = 80;
const FULL_RE = /^sketches\/(\d{13})-([0-9a-f]{8})(?:--([A-Za-z0-9_-]+))?\.jpg$/;
const THUMB_RE = /^sketches\/t\/(\d{13})-([0-9a-f]{8})\.jpg$/;
const ID_RE = /^\d{13}-[0-9a-f]{8}$/;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const sleep = ms => new Promise(r => setTimeout(r, ms));

function setupError() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return 'Vercel Blob 저장소가 아직 연결되지 않았어요.';
  if ((process.env.SKETCH_PASSWORD || '').length < 8) return 'SKETCH_PASSWORD가 설정되지 않았거나 8자보다 짧아요.';
  return '';
}

function authorized(request) {
  const expected = Buffer.from(process.env.SKETCH_PASSWORD || '');
  const given = Buffer.from(request.headers.get('x-sketch-password') || '');
  return expected.length >= 8 && given.length === expected.length && timingSafeEqual(given, expected);
}

async function guard(request) {
  const err = setupError();
  if (err) return json({ error: err }, 503);
  if (!authorized(request)) {
    await sleep(1000); // 비밀번호 맞히기 시도를 느리게
    return json({ error: '비밀번호가 맞지 않아요.' }, 401);
  }
  return null;
}

const isJpeg = buf => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

function cleanCaption(raw) {
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, MAX_CAPTION).join('');
}

function decodeCaption(enc) {
  if (!enc) return '';
  try { return Buffer.from(enc, 'base64url').toString('utf8'); } catch { return ''; }
}

async function listAll() {
  const blobs = [];
  let cursor;
  do {
    const r = await list({ prefix: PREFIX, cursor, limit: 1000 });
    blobs.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor && blobs.length < 5000);
  return blobs;
}

function toSketches(blobs) {
  const thumbs = new Map();
  for (const b of blobs) {
    const m = b.pathname.match(THUMB_RE);
    if (m) thumbs.set(`${m[1]}-${m[2]}`, b.url);
  }
  const out = [];
  for (const b of blobs) {
    const m = b.pathname.match(FULL_RE);
    if (!m) continue;
    const id = `${m[1]}-${m[2]}`;
    out.push({ id, url: b.url, thumb: thumbs.get(id) || b.url, caption: decodeCaption(m[3]), date: new Date(Number(m[1])).toISOString() });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ ready: false, sketches: [] });
  try {
    const sketches = toSketches(await listAll());
    // 1분 동안은 Vercel이 캐시한 목록을 보여 줌 (목록 조회 횟수 아끼기). 올린 직후에는 페이지가 ?fresh=로 새로 받음.
    return json({ ready: true, sketches }, 200, { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=600' });
  } catch (e) {
    return json({ ready: false, sketches: [], error: '목록을 불러오지 못했어요.' }, 500);
  }
}

export async function POST(request) {
  const denied = await guard(request);
  if (denied) return denied;

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_TOTAL) return json({ error: '그림이 너무 커요 (4MB 이하).' }, 413);

  let form;
  try { form = await request.formData(); } catch { return json({ error: '보낸 내용을 읽지 못했어요.' }, 400); }
  const full = form.get('full');
  const thumb = form.get('thumb');
  if (!(full instanceof Blob) || !(thumb instanceof Blob)) return json({ error: '그림 파일이 없어요.' }, 400);

  const fullBuf = Buffer.from(await full.arrayBuffer());
  const thumbBuf = Buffer.from(await thumb.arrayBuffer());
  if (fullBuf.length + thumbBuf.length > MAX_TOTAL) return json({ error: '그림이 너무 커요 (4MB 이하).' }, 413);
  if (!isJpeg(fullBuf) || !isJpeg(thumbBuf)) return json({ error: 'JPG 그림만 받을 수 있어요.' }, 415);

  const caption = cleanCaption(form.get('caption'));
  const id = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const capPart = caption ? `--${Buffer.from(caption, 'utf8').toString('base64url')}` : '';
  const opts = { access: 'public', contentType: 'image/jpeg', addRandomSuffix: false };

  try {
    const t = await put(`${PREFIX}t/${id}.jpg`, thumbBuf, opts);
    const f = await put(`${PREFIX}${id}${capPart}.jpg`, fullBuf, opts);
    return json({ sketch: { id, url: f.url, thumb: t.url, caption, date: new Date(Number(id.slice(0, 13))).toISOString() } }, 201);
  } catch (e) {
    return json({ error: '저장하지 못했어요. 잠시 뒤 다시 해 주세요.' }, 500);
  }
}

export async function DELETE(request) {
  const denied = await guard(request);
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get('id') || '';
  if (!ID_RE.test(id)) return json({ error: '잘못된 요청이에요.' }, 400);

  try {
    const urls = (await listAll())
      .filter(b => b.pathname === `${PREFIX}t/${id}.jpg` || b.pathname.startsWith(`${PREFIX}${id}.`) || b.pathname.startsWith(`${PREFIX}${id}--`))
      .map(b => b.url);
    if (!urls.length) return json({ error: '그 그림을 찾지 못했어요.' }, 404);
    await del(urls);
    return json({ ok: true });
  } catch (e) {
    return json({ error: '지우지 못했어요. 잠시 뒤 다시 해 주세요.' }, 500);
  }
}
