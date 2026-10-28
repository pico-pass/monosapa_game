/** GET /api/health 응답 */
export class HealthStatusDto {
  constructor(
    readonly status: 'ok',
    readonly service: string,
    /** 응답을 만든 시각(ISO 8601) */
    readonly time: string,
  ) {}
}
