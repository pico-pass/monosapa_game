/** 관리자는 이 계정 하나뿐이다(ESCN). 환경 변수로 늘리지 않고 코드에 고정한다. */
export const ADMIN_EMAIL = 'lsh34206@gmail.com';

/** 구글에서 확인된 이메일이 관리자 계정이면 true. 확인되지 않은 이메일은 저장되지 않으므로(null) 항상 false다. */
export const isAdminEmail = (email: string | null | undefined): boolean => !!email && email.trim().toLowerCase() === ADMIN_EMAIL;
