#!/usr/bin/env bash
# 모노사파 키우기 배포: 테스트 → 빌드 → 백업 → 정적 파일 교체(nginx) → 백엔드 재시작(pm2, 바뀐 경우만) → 검증.
#
#   ./deploy.sh                    배포
#   ./deploy.sh --skip-tests       테스트를 건너뛰고 배포
#   ./deploy.sh --dry-run          빌드까지만 하고 무엇이 바뀔지 보여 준다 (서버는 건드리지 않는다)
#   ./deploy.sh rollback [폴더]    프런트를 백업으로 되돌린다 (폴더를 안 주면 가장 최근 백업)
#
# nginx 설정은 이 스크립트가 관리하지 않는다(정적 파일만 바뀌므로 reload도 필요 없다).
# 환경 변수로 바꿀 수 있다: WEB_ROOT, DOMAIN, PM2_NAME, BACKUP_ROOT, KEEP_BACKUPS
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="${WEB_ROOT:-/var/www/monosapa}"
DOMAIN="${DOMAIN:-monogame69.net}"
PM2_NAME="${PM2_NAME:-monosapa-backend}"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/deploy-backup}"
KEEP_BACKUPS="${KEEP_BACKUPS:-10}"

log() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

run_tests=1
dry_run=0
mode=deploy
rollback_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests) run_tests=0 ;;
    --dry-run) dry_run=1 ;;
    rollback) mode=rollback; rollback_dir="${2:-}"; [ $# -gt 1 ] && shift ;;
    -h | --help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "알 수 없는 옵션: $1 (./deploy.sh --help)" ;;
  esac
  shift
done

for cmd in rsync curl npm pm2; do
  command -v "$cmd" >/dev/null || die "$cmd 가 필요해요."
done
[ -d "$WEB_ROOT" ] || die "웹 루트가 없어요: $WEB_ROOT"

# 웹 루트에 쓸 수 있으면 그대로, 아니면 sudo (소유자는 root로 맞춘다)
if [ -w "$WEB_ROOT" ]; then
  SUDO=()
  OWNER=()
else
  SUDO=(sudo)
  OWNER=(--chown=root:root)
fi
# -c: 빌드마다 바뀌는 수정 시각이 아니라 내용으로 비교해서, 그대로인 파일(mp3 등)은 다시 복사하지 않는다.
RSYNC=("${SUDO[@]}" rsync -ac "${OWNER[@]}" --chmod=D755,F644)

verify_live() {
  local expect="$1" live="" i
  log "검증: https://$DOMAIN"
  if [ -n "$expect" ]; then
    live="$(curl -fsS --max-time 20 "https://$DOMAIN/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1 || true)"
    if [ "$live" != "$expect" ]; then
      warn "서비스 중인 번들이 달라요: ${live:-(없음)} (기대: $expect)"
      return 1
    fi
    echo "  번들 $live 가 서비스되고 있어요."
  fi
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 10 "https://$DOMAIN/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
      echo "  /api/health 정상"
      return 0
    fi
    sleep 1
  done
  return 1
}

if [ "$mode" = rollback ]; then
  if [ -z "$rollback_dir" ]; then
    rollback_dir="$(ls -1d "$BACKUP_ROOT"/monosapa-* 2>/dev/null | sort | tail -1 || true)"
  fi
  [ -n "$rollback_dir" ] || die "백업이 없어요: $BACKUP_ROOT"
  [ -f "$rollback_dir/index.html" ] && [ -d "$rollback_dir/assets" ] || die "백업 폴더가 올바르지 않아요: $rollback_dir"
  log "롤백: $rollback_dir → $WEB_ROOT"
  "${RSYNC[@]}" "$rollback_dir/assets/" "$WEB_ROOT/assets/"
  "${RSYNC[@]}" "$rollback_dir/index.html" "$WEB_ROOT/index.html"
  "${RSYNC[@]}" --delete "$rollback_dir/assets/" "$WEB_ROOT/assets/"
  verify_live "$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$rollback_dir/index.html" | head -1)" || die "롤백 뒤 검증에 실패했어요."
  warn "프런트만 되돌렸어요. 백엔드(pm2)는 그대로예요."
  exit 0
fi

cd "$ROOT"

backend_hash() {
  if [ -d backend/dist ]; then
    (cd backend/dist && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
  else
    echo none
  fi
}

log "배포 대상: $(git rev-parse --short HEAD 2>/dev/null || echo '?') → https://$DOMAIN"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  warn "커밋하지 않은 변경이 있어요. 작업 폴더의 현재 상태가 그대로 배포돼요."
fi

if [ "$run_tests" = 1 ]; then
  log "테스트"
  npm test
fi

log "빌드"
before="$(backend_hash)"
npm run build
after="$(backend_hash)"
[ -f frontend/dist/index.html ] || die "frontend/dist/index.html 이 없어요. 빌드를 확인해 주세요."
expect_js="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' frontend/dist/index.html | head -1)"
[ -n "$expect_js" ] || die "index.html 에서 번들 경로를 찾지 못했어요."

backend_pid="$(pm2 pid "$PM2_NAME" 2>/dev/null | tr -d '[:space:]' || true)"
restart_backend=0
if [ "$before" != "$after" ]; then
  restart_backend=1
elif [ -z "$backend_pid" ] || [ "$backend_pid" = 0 ]; then
  restart_backend=1
fi

if [ "$dry_run" = 1 ]; then
  log "dry-run: 프런트 변경 목록 (서버는 건드리지 않았어요)"
  # 내용(체크섬)이 다른 파일만 나온다. 권한·소유자는 비교하지 않는다. (>f+++ 새 파일, >f.c 내용 변경, *deleting 삭제)
  changes="$(rsync -rcin --delete frontend/dist/assets/ "$WEB_ROOT/assets/" | sed 's/^/  assets\/ /'; rsync -rcin frontend/dist/index.html "$WEB_ROOT/index.html" | sed 's/^/  /')"
  echo "${changes:-  (바뀐 파일 없음)}"
  echo "  새 번들: $expect_js"
  echo "  백엔드 재시작: $([ "$restart_backend" = 1 ] && echo '필요해요' || echo '필요 없어요 (변경 없음, 실행 중)')"
  exit 0
fi

log "백업"
backup="$BACKUP_ROOT/monosapa-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a "$WEB_ROOT"/. "$backup"/
echo "  $backup"

log "프런트 교체: $WEB_ROOT"
# 새 파일을 먼저 올리고 index.html 을 마지막에 바꿔서, 중간에 깨진 페이지가 보이지 않게 한다.
"${RSYNC[@]}" frontend/dist/assets/ "$WEB_ROOT/assets/"
"${RSYNC[@]}" frontend/dist/index.html "$WEB_ROOT/index.html"
"${RSYNC[@]}" --delete frontend/dist/assets/ "$WEB_ROOT/assets/"

if [ "$restart_backend" = 1 ]; then
  log "백엔드 재시작: $PM2_NAME"
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 restart "$PM2_NAME" --update-env
  else
    pm2 start dist/main.js --name "$PM2_NAME" --cwd "$ROOT/backend"
  fi
  pm2 save >/dev/null
else
  log "백엔드: 변경 없음, 실행 중이라 그대로 둬요."
fi

if "${SUDO[@]}" nginx -t >/dev/null 2>&1; then
  echo "  nginx 설정 검사 통과"
else
  warn "nginx -t 를 확인하지 못했어요(권한이나 설정 문제일 수 있어요)."
fi

if verify_live "$expect_js"; then
  # 오래된 백업 정리 (최근 KEEP_BACKUPS 개만 남긴다)
  ls -1d "$BACKUP_ROOT"/monosapa-* 2>/dev/null | sort | head -n -"$KEEP_BACKUPS" | xargs -r -d '\n' rm -rf
  log "배포 완료 ✔  https://$DOMAIN"
else
  die "검증에 실패했어요. 되돌리려면: ./deploy.sh rollback \"$backup\""
fi
