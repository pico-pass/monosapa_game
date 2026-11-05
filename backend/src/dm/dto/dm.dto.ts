import { PersonDto } from '../../users/person.js';

export class DmMessageDto {
  id!: string;
  mine!: boolean;
  text!: string;
  /** 보낸 시각(ms) */
  at!: number;
  /** 받은 사람이 읽었는가(내가 보낸 메시지에서 뜻이 있다) */
  read!: boolean;
}

/** GET /api/dm/:uid 응답. 오래된 것부터 최신 순서다. */
export class DmThreadDto {
  friend!: PersonDto;
  messages!: DmMessageDto[];
}

export class SendDmDto {
  text!: string;
}
