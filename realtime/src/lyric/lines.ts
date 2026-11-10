/**
 * 가사 빈칸 속도전의 출제 목록. 한 줄이 한 문제이고, 어디를 비울지는 서버가 라운드마다 정한다(`blank.ts`).
 * 줄을 더하려면 아래 배열에 한 줄씩 넣으면 된다(띄어쓰기는 보이는 그대로 쓰이고, 앞뒤 공백·중복은 읽을 때 걸러진다).
 */
export const LYRIC_LINES: readonly string[] = [
  '임산부한테 헌팅을해',
  '잘자베이비굿나잇',
  '나는 너의 사랑마저 전부 다가졌지만 너의 손목 지키지는 못할것 같아 미안',
  '씨발씨발거리지마 씨발씨발년아',
  '나는 매일 이런생각을 하루에 수십번도 넘게 하는데 왜 정신병이 안낫는걸까',
  '니엄마와 커플로 자해흉터가있다',
  '나는 쾌락살인을 즐겨 못생긴새꺄',
  '빨리 보지 대주란말야 왤케 비싼척을 하냐 좆같은새꺄 개새꺄',
  '니 아빠의 전립선 비대칭 내가 내가 고쳐줄게요',
  '개 좆같을땐 가슴을 펴고 외쳐보자 니엄마 창녀',
  '박근혜의 보지털을 핥고싶다 문재인의 자지를 만지고싶다',
  '훠훠 자지 만지지 마세요',
  '외모정 병 걸린 한녀랑은 안 놀아 어둠속 성 모노사파한테 집 착',
  '넌 항상 잠에 들지 못해 뭐가 널 괴롭히길래 그러는 걸까',
];

/** 앞뒤 공백을 자르고 빈 줄·중복을 뺀 출제 목록 */
export function cleanLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (line.length === 0 || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}
