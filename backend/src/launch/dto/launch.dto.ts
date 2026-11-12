/** POST /api/launch/enter 응답 */
export class LaunchEnterDto {
  /** 정식 출시 초기화가 끝났는가 */
  launched!: boolean;
  /** 저장 세대(초기화할 때마다 올라간다) */
  epoch!: number;
  /** 정식 출시 시각(ms). 아직이면 null */
  launchedAt!: number | null;
  /** 환영 팝업을 보여 줄 때인가(출시 뒤 일정 기간) */
  popup!: boolean;
  /** 스타트 패키지 내용 */
  starter!: { coins: number; diamonds: number };
  /** 이번 호출로 스타트 패키지 우편이 새로 왔는가(출시 뒤 가입한 신규 계정의 첫 접속) */
  granted!: boolean;
}
