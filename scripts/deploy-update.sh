#!/usr/bin/env bash
# Yalnızca kurulmuş Linux/systemd sunucusunda çalışır; ilk kurulum değildir.
set -euo pipefail
umask 077

fail() { printf 'Hata: %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || fail 'Bu güncelleme betiğini sudo ile çalıştırın.'
finance_install_root="${FINANCE_INSTALL_ROOT:-/opt/finance}"
finance_env_file="${FINANCE_ENV_FILE:-/etc/finance/finance.env}"
finance_build_user="${FINANCE_BUILD_USER:-finance-build}"
finance_service_user="${FINANCE_SERVICE_USER:-finance}"
finance_service_name="${FINANCE_SERVICE_NAME:-finance.service}"
[[ "$finance_install_root" == /* && "$finance_install_root" != / ]] || fail 'Kurulum kökü mutlak ve güvenli bir yol olmalıdır.'
[[ -f "$finance_env_file" ]] || fail 'Harici finance.env bulunamadı; hiçbir değişiklik yapılmadı.'
[[ "$(stat -c %u "$finance_env_file")" == 0 ]] || fail 'finance.env root sahibi olmalıdır.'
[[ "$(stat -c %a "$finance_env_file")" == 600 ]] || fail 'finance.env izinleri 600 olmalıdır.'
# Bu root sahipli dosya yalnızca KEY=value satırları içermelidir.
# shellcheck source=/dev/null
source "$finance_env_file"
finance_node_bin="${FINANCE_NODE_BIN:-/opt/finance/runtime/node/bin/node}"
finance_npm_bin="$(dirname "$finance_node_bin")/npm"
finance_runtime_path="$(dirname "$finance_node_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
[[ -x "$finance_node_bin" && -x "$finance_npm_bin" ]] || fail 'Ayrı Node.js 22 runtime bulunamadı.'
[[ "$("$finance_node_bin" -p 'Number(process.versions.node.split(".")[0])')" == 22 ]] || fail 'Güncelleme Node.js 22 gerektirir.'
for finance_command in git tar runuser systemctl flock curl mktemp readlink; do
  command -v "$finance_command" >/dev/null || fail "Gerekli komut bulunamadı: $finance_command"
done
id "$finance_build_user" >/dev/null 2>&1 || fail 'finance-build kullanıcısı bulunamadı.'
id "$finance_service_user" >/dev/null 2>&1 || fail 'finance hizmet kullanıcısı bulunamadı.'
[[ -n "${FINANCE_DB:-}" && -n "${FINANCE_AUTH_DB:-}" ]] || fail 'FINANCE_DB ve FINANCE_AUTH_DB açıkça belirtilmelidir.'
[[ "${FINANCE_PUBLIC_URL:-}" == https://* ]] || fail 'FINANCE_PUBLIC_URL geçerli HTTPS kaynağı olmalıdır.'
finance_repository="$finance_install_root/repo"
finance_releases="$finance_install_root/releases"
finance_current="$finance_install_root/current"
[[ -d "$finance_repository/.git" && -L "$finance_current" ]] || fail 'repo/current kurulumu eksik; bu betik ilk kurulum yapmaz.'
[[ -f "$FINANCE_DB" && -f "$FINANCE_AUTH_DB" ]] || fail 'Finans/kimlik veritabanları bulunamadı; boş veriyle güncellenmedi.'
finance_db_path="$(readlink -f "$FINANCE_DB")"
finance_auth_path="$(readlink -f "$FINANCE_AUTH_DB")"
finance_previous="$(readlink -f "$finance_current")"
[[ "$finance_previous" == "$finance_releases/"* ]] || fail 'current hedefi releases klasörünün içinde olmalıdır.'
for finance_private_path in "$finance_db_path" "$finance_auth_path" "$(readlink -f "$finance_env_file")"; do
  [[ "$finance_private_path" != "$finance_install_root/"* ]] || fail 'Veri ve gizli ortam dosyası kaynak/release ağacının dışında olmalıdır.'
done
exec 9>"$finance_install_root/.update.lock"
flock -n 9 || fail 'Başka bir güncelleme çalışıyor.'
repo_git() { runuser -u "$finance_build_user" -- git -C "$finance_repository" "$@"; }
[[ -z "$(repo_git status --porcelain)" ]] || fail 'Kaynakta yerel değişiklik var; korunarak güncelleme durduruldu.'
finance_branch="$(repo_git branch --show-current)"
[[ -n "$finance_branch" ]] || fail 'Detached HEAD güncellenmez; kaynak dalını seçin.'
[[ -f "$finance_previous/scripts/backup-auth.mjs" ]] || fail 'Çalışan sürümde kimlik yedekleme yardımcısı bulunamadı.'

# Kaynak veya hizmet değişmeden önce iki ayrı tutarlı SQLite yedeği.
(
  cd "$finance_previous"
  runuser -u "$finance_service_user" -- env PATH="$finance_runtime_path" FINANCE_DB="$finance_db_path" FINANCE_AUTH_DB="$finance_auth_path" \
    "$finance_node_bin" --import tsx server/cli.ts backup --json
  runuser -u "$finance_service_user" -- env PATH="$finance_runtime_path" FINANCE_DB="$finance_db_path" FINANCE_AUTH_DB="$finance_auth_path" \
    "$finance_node_bin" scripts/backup-auth.mjs
)
repo_git pull --ff-only origin "$finance_branch"
finance_revision="$(repo_git rev-parse --short=12 HEAD)"
mkdir -p "$finance_releases"
finance_stage="$(mktemp -d "$finance_releases/.build-XXXXXXXX")"
finance_release="$finance_releases/$(date -u +%Y%m%dT%H%M%SZ)-$finance_revision-$$"
finance_link_temporary="$finance_install_root/.current-$$"
cleanup() {
  rm -f -- "$finance_link_temporary"
  if [[ -n "$finance_stage" && -d "$finance_stage" ]]; then rm -rf -- "$finance_stage"; fi
}
trap cleanup EXIT
repo_git archive --format=tar HEAD | tar -xf - -C "$finance_stage"
chown -R --no-dereference "$finance_build_user:$finance_build_user" "$finance_stage"
(
  cd "$finance_stage"
  for finance_npm_action in ci test build; do
    if [[ "$finance_npm_action" == ci ]]; then
      runuser -u "$finance_build_user" -- env -u FINANCE_DB -u FINANCE_AUTH_DB -u FINANCE_PUBLIC_URL -u FINANCE_PORT -u FINANCE_SESSION_SECRET \
        PATH="$finance_runtime_path" NODE_ENV=development "$finance_npm_bin" ci --include=dev --cache /var/cache/finance-build/npm
    else
      runuser -u "$finance_build_user" -- env -u FINANCE_DB -u FINANCE_AUTH_DB -u FINANCE_PUBLIC_URL -u FINANCE_PORT -u FINANCE_SESSION_SECRET \
        PATH="$finance_runtime_path" NODE_ENV=development "$finance_npm_bin" run "$finance_npm_action"
    fi
  done
)
[[ -f "$finance_stage/dist/index.html" ]] || fail 'Derleme çıktısı bulunamadı; çalışan sürüm korunuyor.'
chown -R --no-dereference root:"$finance_service_user" "$finance_stage"
chmod -R g+rX,o-rwx "$finance_stage"
mv -- "$finance_stage" "$finance_release"
finance_stage=''
ln -s "$finance_release" "$finance_link_temporary"
mv -Tf -- "$finance_link_temporary" "$finance_current"

finance_public_host="${FINANCE_PUBLIC_URL#https://}"
finance_public_host="${finance_public_host%%/*}"
health_check() {
  curl --fail --silent --show-error --max-time 5 \
    -H "Host: $finance_public_host" -H 'X-Forwarded-Proto: https' \
    "http://127.0.0.1:${FINANCE_PORT:-4317}/api/health" >/dev/null 2>&1
}
finance_ready=0
if systemctl restart "$finance_service_name"; then
  for finance_attempt in {1..20}; do
    if systemctl is-active --quiet "$finance_service_name" && health_check; then finance_ready=1; break; fi
    sleep 1
  done
fi
if [[ "$finance_ready" != 1 ]]; then
  ln -s "$finance_previous" "$finance_link_temporary"
  mv -Tf -- "$finance_link_temporary" "$finance_current"
  systemctl restart "$finance_service_name" || true
  fail 'Yeni sürüm sağlıklı başlamadı. Önceki kaynak sürümüne dönüldü; veritabanları otomatik geri alınmadı. Yedekleri ve hizmet günlüklerini kontrol edin.'
fi
printf 'Güncelleme tamamlandı: %s\n' "$finance_revision"
