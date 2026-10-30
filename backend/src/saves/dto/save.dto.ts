/** PUT /api/saves/me 요청 */
export class PutSaveDto {
  state!: Record<string, unknown>;
  /** 클라이언트가 마지막으로 확인한 서버 저장 버전. 서버에 저장이 없으면 0. */
  baseVersion!: number;
  /** 이 페이지 로드를 구분하는 임의 문자열 */
  writerId!: string;
}

export class SaveDto {
  state!: Record<string, unknown>;
  version!: number;
  savedAt!: number;
}

/** GET /api/saves/me 응답. 저장이 아직 없으면 save 가 null. */
export class GetSaveDto {
  save!: SaveDto | null;
}

export class PutSaveResultDto {
  version!: number;
  savedAt!: number;
}
