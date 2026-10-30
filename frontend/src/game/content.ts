import type { AlbumType, CampaignId, CardRarity, DialogueTone, Persona, PostKind, SnackId, StageId, StreamPlatform, ThemeId, Vibe, VirtualComment } from './types';

/* 대사·제목·댓글·공연장 이름. 모두 게임용 창작 문구이며 실제 인물의 곡·발언이 아니다.
   가상의 상대·자기디스·황당한 상황만 다루고, 현실 이용자나 실제 인물을 겨냥하지 않는다. */

export type Situation =
  | 'idle'
  | 'work'
  | 'release'
  | 'buy'
  | 'heat'
  | 'micSeized'
  | 'concertWin'
  | 'concertLose';

export const SITUATIONS: readonly Situation[] = [
  'idle',
  'work',
  'release',
  'buy',
  'heat',
  'micSeized',
  'concertWin',
  'concertLose',
];

/** o: 원래 톤, s: 순화 톤(없으면 o 그대로). 보상·성장에는 영향이 없다. */
export interface Line {
  o: string;
  s?: string;
}

export const DIALOGUE: Record<Persona, Record<Situation, readonly Line[]>> = {
  normal: {
    idle: [
      { o: '오늘 하루 어땠어. 길게 말하기 힘들면 그냥 여기 앉아 있어도 돼.' },
      { o: '기분을 설명할 말이 안 떠오르는 날도 있지. 천천히 생각해.' },
      { o: '사람들 앞에서 웃느라 피곤했겠다. 여기서는 표정 신경 안 써도 돼.' },
      { o: '답장 하나 보내는 일도 버거웠으면, 오늘은 그만큼 힘든 날이었겠지.' },
      { o: '혼자 있고 싶은 마음이랑 누가 찾아줬으면 하는 마음이 같이 들 때가 있어.' },
      { o: '좋아하는 노래 하나 틀어둘까. 말은 조금 있다가 해도 되니까.' },
      { o: '아직 하루가 남았네. 따뜻한 거 마시고 잠깐 쉬어갈래?' },
    ],
    work: [
      { o: '오늘은 한 줄만 써보자. 마음에 드는 단어 하나로 시작해도 좋아.' },
      { o: '쓰다가 지워도 돼. 어떤 말을 하고 싶었는지 조금은 알게 됐으니까.' },
      { o: '남들 속도까지 보면서 작업하면 숨차잖아. 우리 곡부터 들어보자.' },
      { o: '말로 꺼내기 어려우면 멜로디부터 흥얼거려볼까.' },
      { o: '이 부분 좋다. 네가 조심스럽게 꺼낸 마음이 들리는 것 같아.' },
      { o: '자꾸 같은 생각으로 돌아오면 잠깐 저장하자. 이어서 할 자리는 남아 있어.' },
      { o: '오늘 집중한 만큼만 남겨두자. 내일의 네가 이어갈 수 있게.' },
    ],
    release: [
      { o: '발매됐네. 혼자 듣던 노래를 세상에 내보내는 건 꽤 떨리는 일이야.' },
      { o: '반응 확인하기 무서우면 조금 있다 보자. 우선 우리끼리 한 번 들어볼래?' },
      { o: '이 곡 쓰던 날 기억나? 그날의 네 마음이 여기 남았네.' },
      { o: '누군가는 집에 돌아가는 길에 이 노래를 듣겠지. 조용히 곁에 있어주면 좋겠다.' },
      { o: '첫 댓글이 달렸어. 급하게 답하지 않아도 돼. 천천히 읽어보자.' },
      { o: '기다리던 반응이 아직 없어도, 오늘 발매한 기쁨은 조금 누렸으면 해.' },
      { o: '끝까지 들었어. 네가 어떤 마음으로 불렀는지 더 알고 싶어졌어.' },
    ],
    buy: [
      { o: '새 마이크 왔네. 작은 목소리로 불러도 잘 담기는지 들어볼까.' },
      { o: '의자부터 편하게 맞추자. 오래 앉아 있으면 몸도 지치니까.' },
      { o: '이 조명 마음에 든다. 밤에 작업할 때 눈이 조금 편하겠어.' },
      { o: '오래 고민해서 골랐잖아. 오늘은 새 장비 만져보는 재미 좀 누리자.' },
      { o: '한꺼번에 다 갖출 필요는 없어. 다음에 필요한 건 써보면서 알게 되겠지.' },
      { o: '방음이 좋아졌네. 이제 눈치 보느라 삼켰던 부분도 편하게 불러보자.' },
      { o: '이 방에 네가 좋아하는 것들이 하나씩 늘어나네. 쉬는 자리도 마련할까?' },
    ],
    heat: [
      { o: '지금은 소리가 조금 크게 느껴진다. 볼륨부터 낮춰볼까.' },
      { o: '생각이 너무 빠르게 지나가면 붙잡기 어렵지. 떠오른 말만 짧게 적어두자.' },
      { o: '계속 괜찮다고 말하느라 애쓰지 않아도 돼. 잠깐 멈춰도 괜찮아.' },
      { o: '어깨에 힘이 많이 들어갔네. 물 한 모금 마시고 자세 바꿔볼래?' },
      { o: '지금 당장 답을 내야 할 일인지, 조금 쉬고 같이 살펴보자.' },
      { o: '마음에 걸리는 게 많구나. 한 번에 다 이야기하지 않아도 들을게.' },
      { o: '오늘 해야 할 목록을 조금 줄여볼까. 남은 힘도 생각해주면 좋겠어.' },
    ],
    micSeized: [
      { o: '마이크는 여기 둘게. 다시 부르고 싶어질 때까지 잠깐 쉬자.' },
      { o: '갑자기 조용해지니까 어색하지. 반주도 작게 줄여둘게.' },
      { o: '아직 하고 싶은 말이 남았으면 적어두자. 서두르지 않고 읽어보고 싶어.' },
      { o: '방금 일은 조금 진정된 다음에 생각하자. 지금은 편하게 앉아 있어.' },
      { o: '쉬는 동안에도 네가 만든 곡은 그대로 있어. 돌아와서 이어 들으면 돼.' },
      { o: '누군가와 이야기하고 싶어지면 편한 사람에게 연락해봐도 좋겠다.' },
      { o: '다시 시작할 준비가 됐는지 네 마음도 물어보자. 조금 더 쉬고 싶을 수도 있으니까.' },
    ],
    concertWin: [
      { o: '끝났다. 마지막 소절까지 부르던 네 표정이 아직 기억나.' },
      { o: '저기 따라 부르는 사람 봤어? 네 노래를 기억하고 있었나 봐.' },
      { o: '기뻐서 말이 안 나오면 그냥 웃고 있어도 돼. 사진 한 장 남겨둘까?' },
      { o: '무대 오르기 전에 많이 떨었잖아. 내려왔으니까 이제 숨 좀 돌리자.' },
      { o: '오늘 좋았던 순간 하나만 골라볼래? 나는 네가 관객을 보고 웃던 순간.' },
      { o: '박수 받으니까 어색해? 천천히 받아도 돼. 다들 잘 들었다고 전하는 것 같아.' },
      { o: '공연 끝나고 마음이 허전해질 수도 있겠다. 정리하고 따뜻한 밥 먹으러 가자.' },
    ],
    concertLose: [
      { o: '기대했던 만큼 속상하겠다. 지금 바로 다음 공연 얘기는 안 해도 돼.' },
      { o: '실수한 부분이 자꾸 떠오르지. 오늘 밤 내내 돌려보지는 않았으면 해.' },
      { o: '괜찮다는 말이 아직 안 나오면 안 해도 돼. 아쉬웠다고 말해도 들을게.' },
      { o: '무대에서 내려올 때 힘들었겠다. 일단 장비는 내가 같이 정리할게.' },
      { o: '다시 해보고 싶은 부분은 기억해두자. 연습은 좀 쉰 다음에 해도 늦지 않아.' },
      { o: '오늘의 너한테 너무 모진 말은 하지 않았으면 해. 많이 긴장하고 애썼잖아.' },
      { o: '다음 무대가 무서워졌다면 작은 연습부터 같이 해보자. 날짜는 천천히 정해도 돼.' },
    ],
  },
  dark: {
    idle: [
      { o: '니애미 보지털도 가르마 타는데 내 가사는 왜 정리가 안 되냐 씨발.', s: '내 머리카락도 가르마 타는데 가사는 왜 정리가 안 되냐.' },
      { o: '뭘 봐 씨발. 내 얼굴에 니애미 와이파이 비밀번호라도 적혀 있냐?', s: '뭘 봐. 내 얼굴에 와이파이 비밀번호라도 적혀 있냐?' },
      { o: '오늘은 섹스 말고 음악 생각한다. 아 씨발 첫 단어부터 실패했네.', s: '오늘은 딴생각 말고 음악 생각한다. 아 첫 단어부터 실패했네.' },
      { o: '아 섹스하고싶다. 근데 먹을만한 봊이가 없네.', s: '하고싶다. 근데 먹을만한 조개가 없네.' },
      { o: '소음순 너덜너덜 히힣ㅋㅋㅋ', s: '소음순 너덜너덜 히힣ㅋㅋㅋ.' },
      { o: '보지털로 높은음자리표 만들 생각 하지 마. 씨발 내가 먼저 했으니까.', s: '머리카락으로 높은음자리표 만들 생각 하지 마. 내가 먼저 했으니까.' },
      { o: '내 곡이 저급해? 그럼 꺼져 씨발!!', s: '내 곡이 저급해? 그럼 꺼져.' },
    ],
    work: [
      { o: '작업 버튼 적당히 눌러 씨발. 마우스랑 섹스하냐?', s: '작업 버튼 적당히 눌러. 마우스랑 결혼했냐?' },
      { o: '가사 엉킨 거 봐라. 니애미 보지털도 이것보단 체계적이겠다.', s: '가사 엉킨 거 봐라. 이어폰 줄도 이것보단 체계적이겠다.' },
      { o: '니애미로 시작해서 니애미로 끝나네. 씨발 수미상관 배웠다.', s: '같은 말로 시작해서 같은 말로 끝나네. 수미상관 배웠다.' },
      { o: '벌써 손 놨냐? 작업까지 조루면 앨범은 누가 내 씨발.', s: '벌써 손 놨냐? 작업을 이렇게 빨리 끝내면 앨범은 누가 내.' },
      { o: '텔그에서 여자가 말해 브 액을 가져와', s: '텔그에서 여자가 말해 브 액을 가져와.' },
      { o: '갑자기 궁금해진건데, 오늘 몇번 뺏냐?', s: '갑자기 궁금해진건데, 오늘 몇번 뺏냐?' },
      { o: '내 곡은 어둠속성이지. 그치? 빨리 대답해 새꺄!!', s: '내 곡은 어둠속성이지.' },
    ],
    release: [
      { o: '니애미도 들을 수 있게 전 세계 발매했다. 불효도 글로벌이다 씨발.', s: '전 세계 발매했다. 이제 내 흑역사도 글로벌이다.' },
      { o: '제목에 보지털 넣지 말랬더니 괄호 안에 넣었네. 씨발 협상 잘하네.', s: '제목에서 빼랬더니 괄호 안에 넣었네. 협상 잘하네.' },
      { o: '이번 곡 존나 야한데 통장은 아직 동정이다. 입금 경험이 없어.', s: '이번 곡은 관심을 끄는데 통장에는 아직 입금 경험이 없어.' },
      { o: '니애미 부계정으로 스트리밍하지 마. 가족 추천란에 나 뜬다고 씨발.', s: '가족 계정으로 스트리밍하지 마. 가족 추천란에 나 뜬다고.' },
      { o: '섹스 넣으면 조회수 나온다더니 왜 성인용품 광고만 붙냐 씨발.', s: '자극적인 제목이면 조회수 나온다더니 광고만 이상해졌네.' },
      { o: '믹싱이 니애미 보지털처럼 엉켰는데 일단 예술이라고 써놨다.', s: '믹싱이 이어폰 줄처럼 엉켰는데 일단 예술이라고 써놨다.' },
      { o: '청취자 한 명? 니애미냐? 어머니 다음 곡은 더 좆같습니다.', s: '청취자 한 명? 가족인가? 다음 곡은 더 요란합니다.' },
    ],
    buy: [
      { o: '마이크에 콘돔 씌우지 마 씨발. 윈드스크린은 따로 판다고!', s: '마이크에 이상한 거 씌우지 마. 윈드스크린은 따로 판다고!' },
      { o: '방음재 샀다. 이제 니애미 보지털 얘기가 옆집까지 안 간다.', s: '방음재 샀다. 이제 이상한 가사가 옆집까지 안 간다.' },
      { o: '보지털로 팝필터 만들자는 새끼 누구야. 예산 부족이랑 위생은 별개야 씨발.', s: '먼지로 팝필터 만들자는 사람 누구야. 예산 부족이랑 위생은 별개야.' },
      { o: '니애미가 가격표 보면 가족회의 연다. 마이크가 냉장고보다 비싸 씨발.', s: '가족이 가격표 보면 회의 열린다. 마이크가 냉장고보다 비싸.' },
      { o: '장비는 프로인데 가사는 보지털이네. 씨발 해상도 높은 개소리 완성.', s: '장비는 프로인데 가사는 헛소리네. 해상도 높은 헛소리 완성.' },
      { o: '스피커 샀다! 야동용 아니라고 씨발! 음악 폴더부터 열라고!', s: '스피커 샀다! 딴 거 말고 음악 폴더부터 열라고!' },
      { o: '홍보비 결제했다. 니애미 폰에도 내 얼굴 뜨면 효도라고 생각해라.', s: '홍보비 결제했다. 가족 폰에도 내 얼굴 뜨면 효도라고 생각해라.' },
    ],
    heat: [
      { o: '이건 성욕이 아니라 창작욕이야 씨발! 왜 둘 다 밤에만 오냐고!', s: '이건 딴생각이 아니라 창작욕이야! 왜 밤에만 오냐고!' },
      { o: '니애미 보지털로 냉각팬 만들자는 소리 나오기 전에 에어컨 켜라.', s: '종이로 냉각팬 만들자는 소리 나오기 전에 에어컨 켜라.' },
      { o: 'CPU는 뜨겁고 가사는 야하고 잔액은 차갑네. 씨발 삼위일체다.', s: 'CPU는 뜨겁고 가사는 요란하고 잔액은 차갑네. 삼위일체다.' },
      { o: '니애미한테 전화하지 마! 나 멀쩡해! 왜 말끝마다 보지털이 나오냐고 묻지 마!', s: '가족한테 전화하지 마! 나 멀쩡해! 말이 이상한 건 묻지 마!' },
      { o: '과열 99? 씨발 69인 줄 알고 좋아했잖아. 숫자 똑바로 띄워!', s: '과열 99? 66인 줄 알고 좋아했잖아. 숫자 똑바로 띄워!' },
      { o: '보지털로 오선지 그리라는 게 아니라! 아 씨발 내가 그렇게 말했네!', s: '머리카락으로 오선지 그리라는 게 아니라! 아 내가 그렇게 말했네!' },
      { o: '식힐 시간 없어! 니애미 벌스가 아직 두 절 남았다고 씨발!', s: '식힐 시간 없어! 문제의 벌스가 아직 두 절 남았다고!' },
    ],
    micSeized: [
      { o: '마이크 놔 씨발! 니애미가 아직 후렴에 안 나왔는데 어떻게 끝내!', s: '마이크 놔! 문제의 주인공이 아직 후렴에 안 나왔는데 어떻게 끝내!' },
      { o: '보지털 한 번 말했다고 압수냐? 열일곱 번? 씨발 세고 있었어?', s: '이상한 말 한 번 했다고 압수냐? 열일곱 번? 세고 있었어?' },
      { o: '콘돔 광고 아니고 앨범 소개였다니까! 문맥을 들어 씨발!', s: '이상한 광고 아니고 앨범 소개였다니까! 문맥을 들어!' },
      { o: '니애미도 내 마이크는 안 뺏겠다! 아 어머니가 압수 요청하셨다고?', s: '가족도 내 마이크는 안 뺏겠다! 아 가족이 압수 요청했다고?' },
      { o: '마이크 뺏어도 보지털은 가사장에 남는다. 씨발 문학은 안 죽어.', s: '마이크 뺏어도 가사는 가사장에 남는다. 문학은 안 죽어.' },
      { o: '20초 금욕하라고? 음악을 쉬라는 거였어? 씨발 설명을 똑바로 해!', s: '20초 참으라고? 음악을 쉬라는 거였어? 설명을 똑바로 해!' },
      { o: '니애미 벌스만 지우면 돌려준다고? 그럼 씨발 반주만 남는데?', s: '문제의 벌스만 지우면 돌려준다고? 그럼 반주만 남는데?' },
    ],
    concertWin: [
      { o: '니애미도 앵콜 외친다! 어머니 아까는 가족관계 끊는다면서요!', s: '가족도 앵콜 외친다! 아까는 모르는 사이라면서요!' },
      { o: '보지털로 라임 맞췄는데 떼창을 하네. 씨발 관객도 정상은 아니구나!', s: '이상한 단어로 라임 맞췄는데 떼창을 하네. 관객도 만만치 않구나!' },
      { o: '팬티 던지지 말고 응원봉 흔들어 씨발! 여긴 세탁소가 아니야!', s: '옷 던지지 말고 응원봉 흔들어! 여긴 세탁소가 아니야!' },
      { o: '니애미 앞에서 불러도 되냐고? 지금 앞줄에서 가사 제일 정확하시다!', s: '가족 앞에서 불러도 되냐고? 지금 앞줄에서 가사 제일 정확하시다!' },
      { o: '섹스보다 공연이 좋다! 씨발 비교 자료는 없는데 아무튼 그렇다고!', s: '공연이 세상에서 제일 좋다! 비교 자료는 없는데 아무튼 그렇다고!' },
      { o: '보지털 외쳤더니 함성이 터졌어. 씨발 다음부터 가사에 샴푸도 넣는다!', s: '머리카락 외쳤더니 함성이 터졌어. 다음부터 가사에 샴푸도 넣는다!' },
      { o: '앵콜은 니애미 리믹스다! 가족석 표정이 왜 그래 씨발, 아직 제목이야!', s: '앵콜은 문제의 리믹스다! 가족석 표정이 왜 그래, 아직 제목이야!' },
    ],
    concertLose: [
      { o: '니애미도 박수 치다 말았네. 씨발 가족 할인도 소용없구나.', s: '가족도 박수 치다 말았네. 가족 할인도 소용없구나.' },
      { o: '박자가 보지털처럼 엉켰다. 씨발 빗이라도 가져와!', s: '박자가 이어폰 줄처럼 엉켰다. 누가 좀 풀어봐!' },
      { o: '벌스가 조루였네. 씨발 반주 시작하자마자 끝나버렸어.', s: '벌스가 너무 짧았네. 반주 시작하자마자 끝나버렸어.' },
      { o: '니애미만 웃고 있어. 비웃는 거야? 씨발 어머니 판정 냉정하시네.', s: '가족만 웃고 있어. 비웃는 거야? 판정 냉정하시네.' },
      { o: '섹드립이 안 먹혔다고? 씨발 박자에 맞춰야 드립도 들어가는구나.', s: '농담이 안 먹혔다고? 박자에 맞춰야 농담도 들어가는구나.' },
      { o: '가사 까먹어서 보지털만 네 번 외쳤다. 씨발 제모 광고인 줄 알겠네.', s: '가사 까먹어서 머리카락만 네 번 외쳤다. 샴푸 광고인 줄 알겠네.' },
      { o: '니애미한테는 공연 취소됐다고 해. 씨발 영상 보내지 말고!', s: '가족한테는 공연 취소됐다고 해. 영상 보내지 말고!' },
    ],
  },
};

export function lineText(line: Line, tone: DialogueTone): string {
  return tone === 'soft' && line.s ? line.s : line.o;
}

export interface PickedLine {
  key: string;
  text: string;
}

/** 직전과 같은 대사는 고르지 않는다. rng는 테스트용으로 주입할 수 있다. */
export function pickLine(
  persona: Persona,
  situation: Situation,
  tone: DialogueTone,
  lastKey: string | null,
  rng: () => number = Math.random,
): PickedLine {
  const lines = DIALOGUE[persona][situation];
  const candidates = lines.map((_, i) => i).filter((i) => `${persona}.${situation}.${i}` !== lastKey);
  const idx = candidates[Math.floor(rng() * candidates.length) % candidates.length];
  return { key: `${persona}.${situation}.${idx}`, text: lineText(lines[idx], tone) };
}

export function dialogueCount(): number {
  return SITUATIONS.reduce((sum, s) => sum + DIALOGUE.normal[s].length + DIALOGUE.dark[s].length, 0);
}

/* ---------- 곡 제목 ---------- */

const SINGLE_TITLES: Record<Persona, readonly string[]> = {
  // 일반속성 싱글은 이 순서대로 발매된다. 목록이 끝나면 처음부터 다시 돌고 제목 뒤에 번호가 붙는다.
  normal: [
    '출애굽기',
    '너와 내가 좋았던 건 너와 나라서 좋았던 거지',
    '꿈0H서날보러오r줘 (feat. 새림)',
    '릭오웬스 (feat. †昇天†, 루루)',
    '그럼에도 (feat. uruma)',
    '허우적(feat. †昇天†)',
    '꺼져(feat.Upia)',
    '지못미ㅠㅅㅠ',
    '미안해',
    '죽지마',
    '모노사파떈스!',
    '칼끝 (feat. 루루)',
    '추위어린사랑(feat.Odd95)',
    '잘자',
    '君が死ぬ時 / seoul',
    '무성애자',
    '그저 흔해 빠진 슬픈 얘기 안의 결말처럼',
    '이리와',
    'Draco!',
    '편린',
    '안단테',
    'i been always abandoned by ( )',
    '사랑은 펜타닐 같지 않아',
    '너가 짐꾼은 아닌 걸 알아',
    '내가 널 사랑하는게 어떻게 비즈니스야',
    '파워레인저(들)',
    '용서해줘',
    'Sweet Spot',
    '너는 포차코를 좋아하지 (feat. †昇天†)',
    '쓰레기통에서 돌아왔다 이 씨발',
    '사랑해그니까내앞에서울지마',
    '흙 (Death)',
    '윤석열 구속기념',
    '잘자 (들)',
    'Voyage Theme',
    'Love: Rockstar(feat. 루루)',
    '憎惡는 愛着의 충분조건이다',
    'KISS HEELS',
    'Celine & Dior',
    
  ],
  // 어둠속성 싱글도 이 순서대로 발매된다. (제작자가 지정한 목록)
  dark: [
    '정신병자러브',
    '이상형이 정신병자면 어떡해요',
    '외모정병내가고쳐준다니(feat.ruletheworldboi)',
    '망할세상내가터뜨리고말거야(feat.ruletheworldboi)',
    '빠라삐리삐리뽀',
    '유골함',
    '하치와레씨발년아(feat.korean sexy boy)',
    '발달장애',
    '니엄마와 함꼐하는 크리스마스',
    '루삥빵삥뽕',
    '어둠속성모노사파사클데뷔!!느그엄마다죽이고은퇴해이씨발년아그래안그래개새끼야니엄마스폰지바아아압~',
    '계엄령',
    '유체이탈',
    '[속보]너네엄마가스머프라고?!!!! 이씨발련이!!!!!!!!',
    '니엄마의배꼽에다나는송곳을박아',
    '니엄마대가리에서눈이와',
    '니엄마한테위고비를맞혀',
    'sarin(mono sapa remix)',
    '나니가스키',
    '니엄마차차',
    '니엄마는매독',
    '영아이스엄마강간살해하고부르는노래',
    '니엄마대나무행주',
    '니엄마로요리하기!',
    '굽네자지엽기보지',
    '보지털',
    '토레타',
    '마약을빌려',
    '질방구',
    '추억의플레시게임',
    '이재명엄마',
    '바로 창녀촌 정상화',
    '번지점프',
    '니애미골반이멈추지않는탓일까ㅜ.ㅜ',
    '불타는찌찌 한번만대줘잉',
    '내맘대로살거야',
    '할매보지가좋더라',
    '커비보댕이',
    '트롯사파1',
    '트롯사파2',
    '야르렁니엄마',
    '섹스하고싶다',
    'L을가져와(feat.강*유시)',
    '슬레이어보지',
    '니엄마빨통',
  ],
};

function uniqueTitle(base: string, existing: readonly string[]): string {
  const count = existing.filter((t) => t === base || t.startsWith(`${base} (`)).length;
  return count === 0 ? base : `${base} (${count + 1})`;
}

/** 발매 미리보기와 실제 발매가 같은 제목을 쓰도록 결정적으로 고른다. */
export function singleTitle(persona: Persona, personaIndex: number, existingTitles: readonly string[]): string {
  const list = SINGLE_TITLES[persona];
  // 두 자아 모두 지정된 목록 순서 그대로 발매한다. 끝나면 처음부터 다시 돌고 번호가 붙는다.
  return uniqueTitle(list[personaIndex % list.length], existingTitles);
}

/* ---------- 앨범 카탈로그 ---------- */

export interface AlbumTrack {
  title: string;
  /** 타이틀곡 표시 */
  isTitle?: boolean;
}

/**
 * 발매할 수 있는 앨범은 여기에 적은 묶음뿐이고, 위에서부터 차례로 낸다. (발매한 싱글과 무관)
 * type은 앨범의 속성(일반/어둠)이다. 지금은 효과 차이 없이 표시에만 쓴다.
 */
export interface AlbumDef {
  id: string;
  kind: 'EP' | '싱글';
  title: string;
  type: AlbumType;
  tracks: readonly AlbumTrack[];
}

export const ALBUM_CATALOG: readonly AlbumDef[] = [
  {
    id: 'album-1',
    kind: 'EP',
    title: 'SAPA',
    type: 'normal',
    tracks: [
      { title: 'outro (항해사랑빈칸)' },
      { title: 'draco !' },
      { title: 'i been always abandoned by ( )' },
      { title: '편린' },
      { title: 'Keep it mono - Intro' },
    ],
  },
  {
    id: 'album-2',
    kind: 'EP',
    title: 'MONO',
    type: 'normal',
    tracks: [
      { title: '이리 와', isTitle: true },
      { title: '무성애자' },
      { title: 'Andante (Feat. OIHYUN)' },
      { title: 'BLANK: 론리청춘 (Feat. pshine (피샤인), uruma)' },
      { title: '그저 흔해 빠진 슬픈 얘기 안의 결말처럼' },
    ],
  },
  {
    id: 'album-3',
    kind: '싱글',
    title: 'cybergirl.vst3',
    type: 'normal',
    tracks: [
      { title: 'what was i lived before' },
      { title: 'cybergirl.vst3', isTitle: true },
      { title: 'i wanna livin in your pathos' },
    ],
  },
];

export const albumDefById = (id: string): AlbumDef | undefined => ALBUM_CATALOG.find((d) => d.id === id);

/* ---------- 가상 댓글 ---------- */

const COMMENTS: Record<Persona, readonly VirtualComment[]> = {
  normal: [
    { nick: '밤하늘고래', text: '이 사람 어제랑 같은 사람 맞음?' },
    { nick: '이어폰한짝', text: '멜로디 좋은데 왜 불안하지.' },
    { nick: '새벽세시', text: '가사 좋다… 근데 마지막 줄에서 왜 울컥하지.' },
    { nick: '빈방탐험가', text: '이 곡 들으면서 정리했더니 방이 반만 정리됨.' },
  ],
  dark: [
    { nick: '채널잘못들어옴', text: '방금 감성곡 듣고 왔는데 채널 잘못 들어옴?' },
    { nick: '무대뒤스태프', text: '공연장이 아니라 가족관계증명서 발급소네.' },
    { nick: '믹싱하다웃음', text: '믹싱하다 웃어서 파일 두 번 날림.' },
    { nick: '라임감별사', text: '이 벌스 무허가인데 허가해줌.' },
  ],
};

export function pickComments(persona: Persona, singleIndex: number): VirtualComment[] {
  const list = COMMENTS[persona];
  const first = list[(singleIndex * 3) % list.length];
  if (singleIndex % 2 !== 0) return [first];
  return [first, list[(singleIndex * 3 + 1) % list.length]];
}

/* ---------- 공연장 · 장비 · 안내 문구 ---------- */

export const STAGE_TEXT: Record<StageId, { name: string; blurb: string }> = {
  room: { name: '방구석 라이브', blurb: '카메라 한 대, 관객 몇 명. 이불은 무대 장치.' },
  club: { name: '지하 클럽', blurb: '계단이 가파르다. 음향은 더 가파르다.' },
  hall: { name: '소형 공연장', blurb: '조명이 진짜 무대용이다. 긴장도 진짜다.' },
  solo: { name: '단콘', blurb: '처음으로 내 이름만 걸린 공연. 관객이 전부 내 노래를 안다.' },
  medium: { name: '중형 공연장', blurb: '객석이 층으로 나뉜다. 맨 뒷줄까지 목소리가 닿아야 한다.' },
  large: { name: '중대형 공연장', blurb: '스태프가 오십 명이다. 실수도 오십 명 앞에서 한다.' },
  arena: { name: '대형 콘서트', blurb: '전광판에 내 얼굴이 뜬다. 숨을 곳이 없다.' },
  world: { name: '월클 콘서트', blurb: '세계가 같은 박자로 손을 흔든다. 여기가 끝이자 시작이다.' },
  rooftop: { name: '심야 옥상', blurb: '비공개 공연. 난간 너머로 도시가 꺼지지 않는다. 어둠속성만 올라올 수 있다.' },
  ruins: { name: '폐건물 지하', blurb: '전기가 끊긴 지 오래다. 박자만 살아 있다. 어둠속성만 들어올 수 있다.' },
  garage: { name: '지하주차장 라이브', blurb: '울림이 전부 내 목소리로 돌아온다. 어둠속성만 설 수 있는 마지막 무대.' },
};

export const EQUIPMENT_TEXT = {
  mic: { name: '마이크', effect: '생산배율 +0.15 / 레벨', icon: '🎤' },
  studio: { name: '작업실', effect: '생산배율 +0.05 / 레벨 · 5레벨마다 방이 바뀐다', icon: '🏠' },
  promotion: { name: '홍보', effect: '인세 배율 계수 +0.20 / 레벨', icon: '📣' },
} as const;

/** 클릭 업그레이드 카드 문구. 장비와 달리 최대 레벨이 없다. 일반속성은 순수 음악력, 어둠속성은 음지 드립력이다. */
export const CLICK_POWER_TEXT: Record<Persona, { name: string; short: string; effect: string; icon: string }> = {
  normal: { name: '순수 음악력', short: '음악력', effect: '작업하기 한 번에 얻는 기본 라임 +1 / 레벨 (생산배율이 곱해져요)', icon: '🎼' },
  dark: { name: '음지 드립력', short: '드립력', effect: '작업하기 한 번에 얻는 기본 라임 +1 / 레벨 (생산배율이 곱해져요)', icon: '🕶️' },
};

/** 스트리밍 통계 화면의 플랫폼 표시. 로고 대신 이모지와 막대 색만 쓰고, 색은 구분하기 쉽게 고른 값이다. */
export const STREAM_PLATFORM_TEXT: Record<StreamPlatform, { name: string; icon: string; color: string }> = {
  spotify: { name: 'Spotify', icon: '🟢', color: '#1db954' },
  ytmusic: { name: 'YT Music', icon: '▶️', color: '#ff4545' },
  melon: { name: 'Melon', icon: '🍈', color: '#b6e32d' },
  applemusic: { name: 'Apple Music', icon: '🍎', color: '#ff6fae' },
};

export const PERSONA_TEXT: Record<Persona, { name: string; short: string; poster: string; sub: string }> = {
  normal: { name: '일반속성모노사파', short: '일반', poster: '오늘도 작업중', sub: 'MONO SAPA · 새벽 라이브' },
  dark: { name: '어둠속성모노사파', short: '어둠', poster: '무허가 CYPHER', sub: 'DARK SAPA · 광기 영업중' },
};

export const TUTORIAL_FLAGS = ['work', 'release', 'buy', 'switch', 'album'] as const;
export type TutorialFlag = (typeof TUTORIAL_FLAGS)[number];

/* ---------- 상점 ---------- */

export const SNACK_TEXT: Record<SnackId, { name: string; icon: string; blurb: string }> = {
  kimbap: { name: '삼각김밥', icon: '🍙', blurb: '전자레인지 30초. 일단 먹고 쓴다.' },
  coffee: { name: '캔커피', icon: '🥫', blurb: '달고 진하다. 새벽 작업의 기본.' },
  energy: { name: '에너지드링크', icon: '🥤', blurb: '심장이 박자보다 빨리 뛴다.' },
  lunchbox: { name: '편의점 도시락', icon: '🍱', blurb: '오늘만큼은 제대로 먹고 쓴다.' },
};

export const CAMPAIGN_TEXT: Record<CampaignId, { name: string; icon: string; blurb: string }> = {
  flyer: { name: '길거리 전단지', icon: '📄', blurb: '역 앞에서 손으로 나눠 준다.' },
  insta: { name: '모노그램 광고', icon: '📱', blurb: '타임라인에 내 얼굴이 자꾸 뜬다.' },
  billboard: { name: '옥외 전광판', icon: '🌆', blurb: '횡단보도 건너편에서 내가 노래한다.' },
};

export const THEME_TEXT: Record<ThemeId, { name: string; icon: string; blurb: string }> = {
  default: { name: '기본', icon: '🎨', blurb: '일반은 라벤더, 어둠은 심야 보라.' },
  pastel: { name: '파스텔 지뢰계', icon: '🎀', blurb: '분홍과 하늘색, 리본, 새벽에도 귀엽게.' },
  mono: { name: '흑백 레트로', icon: '📼', blurb: '낡은 카세트처럼 회색조로.' },
  neon: { name: '야광 네온', icon: '🌃', blurb: '어두운 방에서 혼자 빛나는 색.' },
};

/* ---------- 모노그램 ---------- */

export const POST_TEXT: Record<PostKind, { name: string; icon: string; blurb: string }> = {
  lyric: { name: '가사 한 줄', icon: '📝', blurb: '지우려다 올려 버린 한 줄.' },
  selfie: { name: '셀카', icon: '🤳', blurb: '다크서클도 필터 안에서는 분위기.' },
  reels: { name: '작업 릴스', icon: '🎞️', blurb: '작업실에서 비트에 맞춰 끄덕이는 영상.' },
};

export const POST_RESULT_COMMENTS: Record<'normal' | 'viral' | 'hate', readonly string[]> = {
  normal: ['좋아요가 차곡차곡 쌓였어요.', '"오늘 분위기 좋다" 댓글이 달렸어요.', '저장 수가 조용히 늘었어요.'],
  viral: ['알고리즘이 터졌어요! 모르는 계정이 다 공유했어요.', '새벽에 올린 게 아침에 떡상했어요.', '인기 게시물 탭에 올라갔어요!'],
  hate: ['악플이 달렸어요. 그래도 누군가는 저장했어요.', '"감성팔이" 댓글에 좋아요 두 개… 반응은 줄었어요.', '악플러가 몰렸지만 팬들이 지켜 줬어요.'],
};

/* ---------- 팬 DM ---------- */

export type MailKind = 'support' | 'empathy' | 'anti';
export type MailTier = 'cheer' | 'thanks' | 'heart' | 'cool' | 'ignore' | 'empathize' | 'clap';

export interface MailReply {
  text: string;
  tier: MailTier;
  /** 답장을 보낸 뒤 보여 주는 한 줄 */
  reaction: string;
}
export interface MailTemplate {
  id: string;
  kind: MailKind;
  text: string;
  replies: readonly MailReply[];
}

export const MAIL_KIND_TEXT: Record<MailKind, { name: string; icon: string }> = {
  support: { name: '응원', icon: '💌' },
  empathy: { name: '공감', icon: '🫂' },
  anti: { name: '안티', icon: '💢' },
};

export const MAIL_NICKS: readonly string[] = [
  '새벽세시_구독자',
  'sleepless_mi',
  '이어폰한쪽',
  '달달한라임',
  '막차놓친사람',
  'lofi_앓이',
  '비오는날_재생목록',
  '무한반복중',
  '야간자율학습',
  '헤드셋_두고옴',
  '밤새는중',
  '나만_아는_가수',
  '조용한_팬',
  '오늘도_재생',
];

export const MAIL_TEMPLATES: readonly MailTemplate[] = [
  {
    id: 'sup-1',
    kind: 'support',
    text: '오빠가 있기에 내가 살아.. 사랑해💕🫂',
    replies: [
      { text: '나도 너 덕분에 살아 💕 진짜 고마워', tier: 'heart', reaction: '"오빠가 답장했어ㅠㅠㅠ" 팬이 화면을 껴안고 한참 울었어요.' },
      { text: '사랑한다 🫂 오늘도 같이 버티자', tier: 'thanks', reaction: '팬이 "버틸게.." 하고 하트 열 개를 보냈어요.' },
      { text: 'ㅇㅇ 고맙다', tier: 'cool', reaction: '"츤데레 오빠 좋아ㅠ" 팬이 오히려 더 좋아해요.' },
    ],
  },
  {
    id: 'sup-2',
    kind: 'support',
    text: '사파형 개귀여워!!!',
    replies: [
      { text: '귀엽다고? 고마워 ㅋㅋ 너도 귀엽다', tier: 'heart', reaction: '"방금 귀엽대!!!" 팬이 방을 뛰어다니고 있어요.' },
      { text: 'ㅋㅋㅋ 고마워', tier: 'thanks', reaction: '팬이 "웃는 이모티콘 받았다" 하고 자랑하고 있어요.' },
      { text: '이거 놀리는 거지?', tier: 'cool', reaction: '팬이 "아니라고오오!!" 하며 답장을 세 번 보냈어요.' },
    ],
  },
  {
    id: 'sup-3',
    kind: 'support',
    text: '오빠노래듣고 힘내고있어 항상 응원할게!',
    replies: [
      { text: '힘내줘서 고마워. 나도 힘내볼게', tier: 'heart', reaction: '"같이 힘내는 거다?" 팬이 응원봉을 꺼냈어요.' },
      { text: '응원 잘 받을게 🔥', tier: 'thanks', reaction: '팬이 "오빠 화이팅!!!" 하고 소리 없이 외쳤어요.' },
      { text: '너도 화이팅', tier: 'cheer', reaction: '짧은 한마디에 팬이 프로필 문구를 바꿨어요.' },
    ],
  },
  {
    id: 'sup-4',
    kind: 'support',
    text: '사파형 노래 들으면서 시험공부했는데 처음으로 끝까지 풀었어ㅠㅠ 고마워😭💗',
    replies: [
      { text: '대단하다 진짜.. 이제 푹 쉬어 💗', tier: 'heart', reaction: '"쉬라고 했어.." 팬이 이불 속에서 답장을 캡처했어요.' },
      { text: '고생했어. 시험 잘 보고 와', tier: 'thanks', reaction: '팬이 "다녀올게!!" 하고 책상에서 일어났어요.' },
      { text: '나 덕분 아니고 네가 한 거야', tier: 'cool', reaction: '"멋있다.. 이 오빠.." 팬이 한 번 더 반했어요.' },
    ],
  },
  {
    id: 'sup-5',
    kind: 'support',
    text: '오빠 이번 곡 진짜 미쳤다ㅠㅠㅠ 하루종일 무한반복중🎧🔁',
    replies: [
      { text: '무한반복이라니 감동이다.. 고마워 🎧', tier: 'heart', reaction: '팬이 재생 횟수를 캡처해서 보내 줬어요.' },
      { text: '귀 아프지 않게 쉬면서 들어 ㅋㅋ', tier: 'thanks', reaction: '"이어폰 뺄게요 ㅋㅋㅋ" 팬이 웃으며 답했어요.' },
      { text: 'ㅋㅋ 고마워', tier: 'cheer', reaction: '팬이 "오빠가 웃었다" 하고 좋아하고 있어요.' },
    ],
  },
  {
    id: 'sup-6',
    kind: 'support',
    text: '사파형 오늘도 작업하고 있지?? 밥은 먹고 해😭🍙 건강 챙겨!!',
    replies: [
      { text: '방금 삼각김밥 먹었어 🍙 걱정해줘서 고마워', tier: 'heart', reaction: '"먹었대!!" 팬이 친구들에게 소식을 퍼뜨렸어요.' },
      { text: '챙겨 먹을게. 너도 밥 먹어', tier: 'thanks', reaction: '팬이 "저도 먹을게요ㅠ" 하고 라면 물을 올렸어요.' },
      { text: '작업 중이라 나중에 답할게', tier: 'cool', reaction: '"바쁜 오빠 응원해요!" 팬이 기다리기로 했어요.' },
    ],
  },
  {
    id: 'sup-7',
    kind: 'support',
    text: '오빠 목소리 들으면 마음이 편해져.. 잠 안 올 때마다 틀어놔🌙💤',
    replies: [
      { text: '잠 안 오는 밤에 내가 옆에 있을게 🌙', tier: 'heart', reaction: '"오늘은 잘 수 있을 것 같아.." 팬이 조용히 눈을 감았어요.' },
      { text: '편해진다니 다행이다. 푹 자', tier: 'thanks', reaction: '팬이 "굿나잇 오빠💤" 하고 답장을 남겼어요.' },
      { text: 'ㅋㅋ 자장가로 쓰지 마', tier: 'cool', reaction: '팬이 "자장가 맞는데요?" 하고 능청을 떨었어요.' },
    ],
  },
  {
    id: 'sup-8',
    kind: 'support',
    text: '사파형 사랑해애애ㅠㅠ 나 오빠 팬 된 거 인생에서 제일 잘한 일이야💕',
    replies: [
      { text: '나야말로 너 같은 팬 만난 게 제일 잘한 일이야 💕', tier: 'heart', reaction: '"이건 박제각" 팬이 답장을 고정해 뒀어요.' },
      { text: '사랑해줘서 고마워', tier: 'thanks', reaction: '팬이 "저도요 평생 해요" 하고 답했어요.' },
      { text: '평생이라니 부담스럽다 ㅋㅋ', tier: 'cool', reaction: '"그럼 반평생만.." 팬이 한 발 물러났어요.' },
    ],
  },
  {
    id: 'sup-9',
    kind: 'support',
    text: '친구한테 오빠 노래 영업했더니 걔도 입덕했어ㅋㅋㅋ 같이 응원할게!!🔥',
    replies: [
      { text: '영업까지 해줬어? 친구한테도 안부 전해줘 🔥', tier: 'heart', reaction: '입덕한 친구가 팔로우를 눌렀어요.' },
      { text: '고마워. 둘이 같이 와', tier: 'thanks', reaction: '둘이 같은 이어폰으로 노래를 들었대요.' },
      { text: '영업비 줘야겠네 ㅋㅋ', tier: 'cheer', reaction: '"영업비는 사랑으로 받겠습니다" 팬이 답했어요.' },
    ],
  },
  {
    id: 'sup-10',
    kind: 'support',
    text: '오빠 힘든 일 있으면 우리한테 말해줘.. 우리가 항상 오빠 편이야🫶',
    replies: [
      { text: '고마워.. 너희 덕분에 버텨 🫶', tier: 'heart', reaction: '"우리가 편이래" 팬들이 응원 글을 줄줄이 남겼어요.' },
      { text: '괜찮아, 너희 보니까 힘나', tier: 'thanks', reaction: '팬이 "그럼 됐어요!" 하고 안심했어요.' },
      { text: '걱정 마. 별일 아니야', tier: 'cool', reaction: '"그래도 말하고 싶으면 와요" 팬이 한마디 더 남겼어요.' },
    ],
  },
  {
    id: 'sup-11',
    kind: 'support',
    text: '사파형 꼭 대박나서 월클 가자!!! 난 끝까지 따라갈 거야🌍✨',
    replies: [
      { text: '같이 월클 가자 🌍 끝까지 따라와', tier: 'heart', reaction: '"약속했다?" 팬이 새끼손가락 이모티콘을 보냈어요.' },
      { text: '응원 잘 받았어. 열심히 할게', tier: 'thanks', reaction: '팬이 "오빠 믿어요!" 하고 외쳤어요.' },
      { text: '월클은 무슨 ㅋㅋ', tier: 'cool', reaction: '"무슨 소리예요 갈 건데요?" 팬이 진지해졌어요.' },
    ],
  },
  {
    id: 'sup-12',
    kind: 'support',
    text: '오빠 오늘 학교 끝나고 노래 들으면서 걸어가는데 눈물났어.. 위로해줘서 고마워🥹',
    replies: [
      { text: '울어도 돼. 걸으면서 들어줘서 고마워 🥹', tier: 'heart', reaction: '"울어도 된대.." 팬이 한 번 더 울고 웃었어요.' },
      { text: '오늘 고생했어. 집 가서 쉬자', tier: 'thanks', reaction: '팬이 "네 쉬어요" 하고 걸음을 재촉했어요.' },
      { text: '위로한 적 없는데 ㅋㅋ', tier: 'cool', reaction: '"그냥 존재가 위로예요" 팬이 대꾸했어요.' },
    ],
  },
  {
    id: 'sup-13',
    kind: 'support',
    text: '사파형 오늘도 존잘이다.. 출근길에 노래 들으면서 심장 부여잡았어💓',
    replies: [
      { text: '출근길에 심장 조심해 💓 오늘도 화이팅', tier: 'heart', reaction: '팬이 "오빠가 걱정해줬다!!" 하고 지하철에서 웃었어요.' },
      { text: '존잘은 무슨 ㅋㅋ 고마워', tier: 'thanks', reaction: '"거울 보세요 오빠" 팬이 단호하게 답했어요.' },
      { text: '출근 늦지 마', tier: 'cheer', reaction: '팬이 "넵!!" 하고 뛰어갔어요.' },
    ],
  },
  {
    id: 'emp-1',
    kind: 'empathy',
    text: '요즘 아무것도 하기 싫은데 음악만 틀어요. 그래도 괜찮은 거죠?',
    replies: [
      { text: '괜찮아요. 음악이라도 틀었으면 충분해요', tier: 'heart', reaction: '"충분하대…" 팬이 오랜만에 웃었어요.' },
      { text: '나도 그런 날 있어요', tier: 'thanks', reaction: '같은 마음이라는 답에 위로를 받았어요.' },
      { text: '푹 쉬어요', tier: 'cheer', reaction: '"쉬었다 올게요"라는 답장이 왔어요.' },
    ],
  },
  {
    id: 'emp-2',
    kind: 'empathy',
    text: '새벽 세 시마다 이 노래를 들어요. 다들 자는데 나만 깨 있는 기분이 덜 외로워져요.',
    replies: [
      { text: '나도 지금 작업 중이에요. 같이 깨 있어요', tier: 'heart', reaction: '"같이 깨 있대"가 태그를 탔어요.' },
      { text: '잠은 자야 해요 ㅎㅎ', tier: 'thanks', reaction: '"네네…" 하고 이어폰을 뺐어요.' },
      { text: '외롭지 않아요, 여기 있어요', tier: 'cheer', reaction: '팬이 답장을 저장했어요.' },
    ],
  },
  {
    id: 'emp-3',
    kind: 'empathy',
    text: '가사 때문에 울었어요. 근데 울고 나니까 좀 후련해요. 이상하죠?',
    replies: [
      { text: '이상하지 않아요. 울어도 돼요', tier: 'heart', reaction: '"울어도 된대…" 하고 한 번 더 울었어요.' },
      { text: '후련해졌다니 다행이에요', tier: 'thanks', reaction: '팬이 곡을 한 번 더 재생했어요.' },
    ],
  },
  {
    id: 'emp-4',
    kind: 'empathy',
    text: '저도 모노사파처럼 두 사람이 사는 기분이에요. 낮의 나와 밤의 나요.',
    replies: [
      { text: '둘 다 진짜 나예요. 같이 가요', tier: 'heart', reaction: '"둘 다 나"가 프로필 문구가 됐어요.' },
      { text: '밤의 당신도 응원해요', tier: 'thanks', reaction: '밤의 팬이 하트를 보냈어요.' },
      { text: '낮에는 푹 자요', tier: 'cool', reaction: '"웃겼다"며 이모티콘이 도착했어요.' },
    ],
  },
  {
    id: 'anti-1',
    kind: 'anti',
    text: '랩이 너무 감성팔이 같아요. 솔직히 별로예요.',
    replies: [
      { text: '들어 줘서 고마워요. 다음엔 더 잘할게요', tier: 'empathize', reaction: '안티가 "…다음 곡 기다릴게요"라고 했어요.' },
      { text: '그럼 이건 어때? (받아치기)', tier: 'clap', reaction: '' },
      { text: '(읽씹)', tier: 'ignore', reaction: '조용히 지나갔어요.' },
    ],
  },
  {
    id: 'anti-2',
    kind: 'anti',
    text: '이 정도로 팬이 많은 게 이해가 안 되네요. 다들 속은 거 아니에요?',
    replies: [
      { text: '의견 감사해요. 라이브 한번 와 주세요', tier: 'empathize', reaction: '"…한번 가 볼게요"라는 답이 왔어요.' },
      { text: '속았는지는 직접 들어 보세요 (받아치기)', tier: 'clap', reaction: '' },
      { text: '무시', tier: 'ignore', reaction: '댓글은 조용히 묻혔어요.' },
    ],
  },
  {
    id: 'anti-3',
    kind: 'anti',
    text: '일반이랑 어둠 둘 다 컨셉 같아서 가식적이에요.',
    replies: [
      { text: '둘 다 진짜 저예요. 들어 주셔서 고마워요', tier: 'empathize', reaction: '안티가 "그럴 수도 있겠네요"라고 했어요.' },
      { text: '가식이면 이 정도로 안 힘들어요 (받아치기)', tier: 'clap', reaction: '' },
      { text: '차단', tier: 'ignore', reaction: '차단했어요. 마음은 편해요.' },
    ],
  },
];

export const mailTemplateById = (id: string): MailTemplate | undefined => MAIL_TEMPLATES.find((t) => t.id === id);

/** 받아치기 결과 한 줄 */
export const CLAP_REACTION = {
  win: '받아치기가 통했어요! 구경하던 사람들이 팬이 됐어요.',
  lose: '받아치기가 역풍을 맞았어요. 팬 일부가 떠났어요.',
} as const;

/* ---------- 업적·미션·출석 ---------- */

export const ACHIEVEMENT_TEXT: Record<string, { name: string; desc: string; icon: string; title?: string }> = {
  'first-verse': { name: '첫 소절', desc: '작업하기를 처음 눌렀어요.', icon: '✍️' },
  hands: { name: '손에 붙은 펜', desc: '작업하기를 1,000번 눌렀어요.', icon: '🖊️' },
  grind: { name: '라임 기계', desc: '작업하기를 10,000번 눌렀어요.', icon: '⚙️', title: '라임 기계' },
  'dawn-rapper': { name: '새벽 3시의 래퍼', desc: '새벽 3시대에 작업하기를 30번 눌렀어요.', icon: '🌙', title: '새벽 3시의 래퍼' },
  debut: { name: '데뷔', desc: '첫 싱글을 발매했어요.', icon: '💿' },
  'five-singles': { name: '다작 입문', desc: '싱글 5곡을 발매했어요.', icon: '🎶' },
  'ten-singles': { name: '다작왕', desc: '싱글 10곡을 발매했어요.', icon: '🎼', title: '다작왕' },
  'album-1': { name: '첫 앨범', desc: '앨범을 처음 발매했어요.', icon: '📀' },
  'album-3': { name: '디스코그래피', desc: '앨범 3장을 모두 발매했어요.', icon: '🗂️', title: '디스코그래피' },
  'fans-100': { name: '동네 래퍼', desc: '팬 100명을 모았어요.', icon: '👥', title: '동네 래퍼' },
  'fans-1k': { name: '이름 있는 래퍼', desc: '팬 1,000명을 모았어요.', icon: '👥' },
  'fans-10k': { name: '만 명의 귀', desc: '팬 10,000명을 모았어요.', icon: '📣', title: '만 명의 귀' },
  'fans-100k': { name: '십만 팬덤', desc: '팬 100,000명을 모았어요.', icon: '🏟️', title: '십만 팬덤' },
  'level-10': { name: 'Lv.10', desc: '플레이어 레벨 10에 도달했어요.', icon: '⭐' },
  'level-30': { name: 'Lv.30', desc: '플레이어 레벨 30에 도달했어요.', icon: '🌟' },
  'level-60': { name: 'Lv.60', desc: '플레이어 레벨 60에 도달했어요.', icon: '💫', title: '전설의 레벨' },
  'seized-1': { name: '첫 압수 경험자', desc: '마이크를 처음 압수당했어요.', icon: '🎤', title: '첫 압수 경험자' },
  'seized-10': { name: '단골 용의자', desc: '마이크를 10번 압수당했어요.', icon: '🚨', title: '단골 용의자' },
  'stage-1': { name: '첫 무대', desc: '공연장을 처음 클리어했어요.', icon: '🎪' },
  tour: { name: '첫 투어 완료', desc: '소형 공연장을 클리어했어요.', icon: '🏆' },
  world: { name: '월드 스타', desc: '월클 콘서트를 클리어했어요.', icon: '🌍', title: '월드 스타' },
  'secret-1': { name: '비밀 공연', desc: '비밀 공연장을 처음 클리어했어요.', icon: '🕶️', title: '비밀 공연의 주인' },
  'secret-3': { name: '어둠의 무대', desc: '비밀 공연장 3곳을 모두 클리어했어요.', icon: '🖤', title: '어둠의 무대' },
  'equip-max': { name: '장비 만렙', desc: '장비 하나를 최대 레벨로 올렸어요.', icon: '🎛️' },
  'equip-max-3': { name: '장비 수집가', desc: '장비 3개를 최대 레벨로 올렸어요.', icon: '🎚️', title: '장비 수집가' },
  'upgrades-20': { name: '다이아 투자자', desc: '다이아 업그레이드 레벨을 합쳐 20까지 올렸어요.', icon: '💎' },
  'snack-10': { name: '편의점 단골', desc: '편의점 간식을 10번 샀어요.', icon: '🏪', title: '편의점 단골' },
  'snack-50': { name: '야식의 신', desc: '편의점 간식을 50번 샀어요.', icon: '🍱' },
  'campaign-5': { name: '광고주', desc: '홍보 캠페인을 5번 진행했어요.', icon: '📢', title: '광고주' },
  'post-1': { name: '첫 게시물', desc: '모노그램에 처음 올렸어요.', icon: '📸' },
  'post-30': { name: '인플루언서', desc: '모노그램에 30번 올렸어요.', icon: '📱', title: '인플루언서' },
  'viral-1': { name: '떡상', desc: '게시물이 처음 바이럴을 탔어요.', icon: '🔥', title: '떡상' },
  'viral-10': { name: '알고리즘의 총애', desc: '게시물이 10번 바이럴을 탔어요.', icon: '🚀', title: '알고리즘의 총애' },
  'mail-10': { name: '답장 10통', desc: '팬 DM에 10번 답장했어요.', icon: '💌' },
  'mail-50': { name: '답장 장인', desc: '팬 DM에 50번 답장했어요.', icon: '✉️', title: '답장 장인' },
  'anti-5': { name: '멘탈 단단', desc: '안티 DM에 5번 대응했어요.', icon: '🛡️', title: '멘탈 단단' },
  'mission-20': { name: '성실한 하루들', desc: '미션 보상을 20번 받았어요.', icon: '📅' },
  'mission-100': { name: '미션 마스터', desc: '미션 보상을 100번 받았어요.', icon: '🗓️', title: '미션 마스터' },
  'streak-7': { name: '개근', desc: '7일 연속 출석했어요.', icon: '📆', title: '개근' },
  'streak-30': { name: '한 달 개근', desc: '30일 연속 출석했어요.', icon: '🏅', title: '한 달 개근' },
  'themes-3': { name: '인테리어 장인', desc: '테마를 3종 모았어요.', icon: '🎨', title: '인테리어 장인' },
  'streams-100k': { name: '십만 스트리밍', desc: '누적 스트리밍 100,000회를 넘겼어요.', icon: '🎧' },
  'streams-10m': { name: '천만 스트리밍', desc: '누적 스트리밍 10,000,000회를 넘겼어요.', icon: '🎵', title: '천만 스트리머' },
  'rhythm-1': { name: '첫 리듬', desc: '리듬 모드를 처음 했어요.', icon: '🎵' },
  'rhythm-30': { name: '리듬 중독', desc: '리듬 모드를 30번 했어요.', icon: '🥁', title: '리듬 중독' },
  'survival-1': { name: '첫 새벽 생존', desc: '새벽 생존에 처음 도전했어요.', icon: '🌙' },
  'survival-s': { name: '새벽의 생존자', desc: '새벽 생존에서 S 등급을 받았어요.', icon: '🌅', title: '새벽의 생존자' },
  'lyric-1': { name: '첫 가사', desc: '가사 덱으로 곡을 한 번 완성했어요.', icon: '📝' },
  'lyric-s': { name: '라임 장인', desc: '가사 덱에서 S 등급을 받았어요.', icon: '🖋️', title: '라임 장인' },
  'tower-10': { name: '계단 10층', desc: '무한의 계단 10층을 깼어요.', icon: '🪜' },
  'tower-30': { name: '계단 30층', desc: '무한의 계단 30층을 깼어요.', icon: '🏯', title: '계단 등반가' },
  'tower-60': { name: '계단 60층', desc: '무한의 계단 60층을 깼어요.', icon: '🗼', title: '끝없는 계단' },
  'ticket-1': { name: '첫 피켓팅', desc: '피켓팅에 처음 도전했어요.', icon: '🎟️' },
  'ticket-ace': { name: '피켓팅 신', desc: '피켓팅에서 S 등급을 받았어요.', icon: '⚡', title: '피켓팅의 신' },
  'pull-10': { name: '뽑기 입문', desc: '가챠를 10번 뽑았어요.', icon: '🎰' },
  'pull-100': { name: '뽑기 중독', desc: '가챠를 100번 뽑았어요.', icon: '🎲', title: '뽑기 중독' },
  'photo-12': { name: '포카 수집가', desc: '포토카드 12종을 모았어요.', icon: '🃏' },
  'photo-36': { name: '포카 컴플리트', desc: '포토카드 36종을 모두 모았어요.', icon: '📔', title: '포카 컴플리트' },
  'photoset-1': { name: '첫 세트 완성', desc: '포토카드 세트 하나를 완성했어요.', icon: '🗂️' },
  'photoset-6': { name: '세트 마스터', desc: '포토카드 6세트를 모두 완성했어요.', icon: '🏆', title: '세트 마스터' },
  'feat-5': { name: '피처링 5명', desc: '피처링 래퍼 5명과 계약했어요.', icon: '🤝' },
  'feat-12': { name: '피처링 올스타', desc: '피처링 래퍼 12명과 모두 계약했어요.', icon: '🌟', title: '피처링 올스타' },
  'card-ssr': { name: 'SSR 곡', desc: 'SSR 등급 곡 카드를 얻었어요.', icon: '✨' },
  'pet-adult': { name: '다 큰 마스코트', desc: '마스코트를 성체까지 키웠어요.', icon: '🐇' },
  'pet-legend': { name: '전설의 마스코트', desc: '마스코트를 전설 단계까지 키웠어요.', icon: '🦄', title: '전설 조련사' },
  'pet-20': { name: '돌보미', desc: '마스코트를 20번 돌봤어요.', icon: '🍙' },
  'challenge-1': { name: '첫 한 줄', desc: '해시태그 챌린지에 처음 참여했어요.', icon: '#️⃣' },
  'challenge-10': { name: '챌린지 단골', desc: '해시태그 챌린지에 10번 참여했어요.', icon: '📣', title: '챌린지 단골' },
  'chart-10': { name: '차트 10위권', desc: '내 곡이 음원 차트 10위 안에 들었어요.', icon: '📈' },
  'chart-no1': { name: '차트 1위', desc: '내 곡이 음원 차트 1위에 올랐어요.', icon: '🥇', title: '차트 1위' },
  'trade-1': { name: '첫 교환', desc: '포토카드를 처음 교환했어요.', icon: '🔁' },
};

export const MISSION_TEXT: Record<string, { name: string; unit: string }> = {
  'd-work': { name: '작업하기', unit: '회' },
  'd-buy': { name: '장비·음악력 구매', unit: '회' },
  'd-concert': { name: '공연 하기', unit: '회' },
  'd-post': { name: '모노그램 게시물 올리기', unit: '개' },
  'd-mail': { name: '팬 DM 답장', unit: '통' },
  'w-work': { name: '작업하기', unit: '회' },
  'w-concert': { name: '공연 하기', unit: '회' },
  'w-post': { name: '모노그램 게시물 올리기', unit: '개' },
  'w-mail': { name: '팬 DM 답장', unit: '통' },
  'w-snack': { name: '편의점 간식 사기', unit: '번' },
  'w-claim': { name: '스트리밍 정산', unit: '번' },
  'd-arcade': { name: '아케이드 플레이', unit: '판' },
  'd-pet': { name: '마스코트 돌보기', unit: '번' },
  'w-arcade': { name: '아케이드 플레이', unit: '판' },
  'w-pull': { name: '가챠 뽑기', unit: '번' },
};

/* ---------- 콘텐츠 팩 2: 수집·육성 ---------- */

export const VIBE_TEXT: Record<Vibe, { name: string; icon: string; desc: string }> = {
  rhyme: { name: '라임', icon: '✍️', desc: '라임 생산' },
  coin: { name: '인세', icon: '🪙', desc: '인세 코인' },
  fan: { name: '팬덤', icon: '👥', desc: '팬 획득' },
  power: { name: '전투력', icon: '⚡', desc: '아케이드·계단 전투력' },
};

export const RARITY_TEXT: Record<CardRarity, { name: string }> = { N: { name: 'N' }, R: { name: 'R' }, SR: { name: 'SR' }, SSR: { name: 'SSR' } };

export const PHOTO_GRADE_NAMES: readonly string[] = ['일반', '레어', '슈퍼레어', '에픽', '레전드', '신화'];
const PHOTO_SCENES: readonly string[] = ['멍하니 앉은 컷', '마이크 앞 컷', '무대 뒤 컷', '조명 아래 컷', '우는 듯 웃는 컷', '두 자아가 겹친 컷'];

export const PHOTO_SET_TEXT: readonly { name: string; icon: string; bonus: string }[] = [
  { name: '방구석 일기', icon: '📓', bonus: '라임 생산 +5%' },
  { name: '지하 클럽', icon: '🔊', bonus: '인세 +5%' },
  { name: '새벽 3시', icon: '🌙', bonus: '팬 획득 +5%' },
  { name: '옥상의 밤', icon: '🌃', bonus: '전투력 +5%' },
  { name: '편의점 앞', icon: '🏪', bonus: '오프라인 정산 +30분' },
  { name: '두 자아', icon: '🎭', bonus: '라임·인세·팬·전투력 +3%' },
];

/** 포토카드 이름: 세트 이름 + 등급마다 정해진 장면 */
export function photoCardName(set: number, grade: number): string {
  return `${PHOTO_SET_TEXT[set - 1]?.name ?? '?'} — ${PHOTO_SCENES[grade - 1] ?? '?'}`;
}

export const FEAT_TEXT: Record<string, { name: string; blurb: string; icon: string }> = {
  'f-han': { name: '한강뷰', blurb: '한강 다리 위에서 라임을 줍는 래퍼.', icon: '🌉' },
  'f-conv': { name: '편의점 야간알바', blurb: '삼각김밥 유통기한으로 가사를 쓴다.', icon: '🍙' },
  'f-bus': { name: '막차놓침', blurb: '막차를 놓친 팬이 제일 많은 래퍼.', icon: '🚌' },
  'f-roof': { name: '옥상문 열림', blurb: '잠겨 있어야 할 문을 열고 들어온다.', icon: '🚪' },
  'f-rain': { name: '장마 3일차', blurb: '눅눅한 목소리로 박자를 적신다.', icon: '🌧️' },
  'f-pc': { name: 'PC방 야간권', blurb: '밤샘 요금으로 밤샘 작업을 한다.', icon: '🖱️' },
  'f-study': { name: '야간자율학습', blurb: '필기 대신 가사를 적는 뒷자리의 래퍼.', icon: '📚' },
  'f-diary': { name: '비공개 일기장', blurb: '아무도 못 보게 쓴 줄이 제일 잘 팔린다.', icon: '🔒' },
  'f-dawn': { name: '새벽 4시 33분', blurb: '해 뜨기 직전에만 나타나는 목소리.', icon: '🌌' },
  'f-moon': { name: '달이 두 개인 밤', blurb: '두 자아를 모두 알아보는 단 하나의 피처링.', icon: '🌗' },
  'f-heart': { name: '밤새 하트 눌러준 사람', blurb: '이름은 모르지만 늘 거기 있었다.', icon: '💗' },
  'f-void': { name: '빈 방의 목소리', blurb: '아무도 없는 방에서 대답이 돌아온다.', icon: '🕳️' },
};

export const MASCOT_TEXT: Record<Persona, { name: string; stages: readonly string[]; icons: readonly string[] }> = {
  normal: { name: '몽글이', stages: ['알', '아기 몽글이', '청소년 몽글이', '어른 몽글이', '전설의 몽글이'], icons: ['🥚', '🐣', '🐥', '🐇', '🦄'] },
  dark: { name: '까망이', stages: ['알', '아기 까망이', '청소년 까망이', '어른 까망이', '전설의 까망이'], icons: ['🥚', '🐛', '🦇', '🐈‍⬛', '🐉'] },
};

export const MOOD_TEXT: Record<'happy' | 'hungry' | 'sulk', { name: string; line: string }> = {
  happy: { name: '기분 좋음', line: '배불러서 꼬리를 흔들어요.' },
  hungry: { name: '배고픔', line: '빈 그릇만 쳐다보고 있어요. (보너스 절반)' },
  sulk: { name: '삐짐', line: '등을 돌리고 앉았어요. 간식을 주면 풀려요. (보너스 없음)' },
};

/* ---------- 콘텐츠 팩 2: 아케이드 ---------- */

export const ARCADE_TEXT: Record<'rhythm' | 'survival' | 'lyric' | 'tower' | 'ticketing', { name: string; icon: string; blurb: string }> = {
  rhythm: { name: '리듬 모드', icon: '🎵', blurb: '내가 낸 싱글이 채보가 돼요. 4개의 레인에 맞춰 눌러요.' },
  survival: { name: '새벽 생존', icon: '🌙', blurb: '3분 동안 몰려오는 악플을 마이크로 쓸어내요. 레벨업마다 가사 스킬을 골라요.' },
  lyric: { name: '가사 덱', icon: '📝', blurb: '가사 카드로 한 곡을 완성해요. 같은 모음을 이으면 라임 체인!' },
  tower: { name: '무한의 계단', icon: '🪜', blurb: '한 층씩 올라가는 자동 전투. 약점 자아로 도전하면 유리해요. 매주 월요일에 1층부터 다시 시작해요.' },
  ticketing: { name: '피켓팅', icon: '🎟️', blurb: '오픈 신호에 누르고 보안문자를 입력해요. 성공하면 다음 공연 코인이 늘어나요.' },
};

export const GRADE_TEXT: Record<'S' | 'A' | 'B' | 'C', string> = { S: 'S', A: 'A', B: 'B', C: 'C' };
export const RHYTHM_LEVEL_TEXT: Record<'easy' | 'normal' | 'hard', string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

export const SKILL_TEXT: Record<string, { name: string; icon: string; desc: string }> = {
  rate: { name: '연사', icon: '🔁', desc: '발사 간격 −20%' },
  dmg: { name: '파워 라임', icon: '💥', desc: '공격력 +0.5' },
  multi: { name: '멀티 보컬', icon: '🎶', desc: '동시에 한 발 더' },
  pierce: { name: '관통 플로우', icon: '🏹', desc: '탄이 적 한 명을 더 뚫어요' },
  speed: { name: '가벼운 발걸음', icon: '👟', desc: '이동 속도 +10%' },
  aura: { name: '사운드 오라', icon: '🔊', desc: '주변 적을 주기적으로 밀어내요' },
  heal: { name: '숨 고르기', icon: '💗', desc: '체력을 바로 회복해요' },
};

export const ENEMY_TEXT: Record<string, string> = { noise: '잡음', troll: '악플러', mob: '악플 군단', boss: '악플의 왕' };

export const VOWEL_TEXT: Record<string, string> = { a: 'ㅏ', eo: 'ㅓ', o: 'ㅗ', u: 'ㅜ', i: 'ㅣ', any: '★' };
export const LYRIC_EFFECT_TEXT: Record<string, string> = { draw: '한 장 더 뽑기', double: '다음 카드 ×2', energy: '에너지 +1', keep: '체인 끊김 한 번 막기' };
export const LYRIC_CARD_TEXT: Record<string, string> = {
  'l-a1': '창가에 앉아',
  'l-a2': '밤하늘 아래',
  'l-a3': '아무도 몰라',
  'l-eo1': '어제처럼 걸어',
  'l-eo2': '너 없는 거리',
  'l-eo3': '어디로 갈까',
  'l-o1': '혼자 노래 불러',
  'l-o2': '오늘도 노을',
  'l-o3': '모든 게 보여',
  'l-u1': '구름 위로 숨어',
  'l-u2': '우리 둘만의 숲',
  'l-u3': '두 눈에 묻은 물',
  'l-i1': '이 밤이 지나가기를',
  'l-i2': '비 오는 날의 기억',
  'l-i3': '미리 써둔 이별',
  'l-wild': '아무 말',
  'l-breath': '숨 고르기',
  'l-adlib': '애드립',
  'l-hook': '후크',
  'l-bridge': '브릿지',
  'l-sweat': '식은땀',
  'l-punch': '펀치라인',
};
