#!/bin/bash
# vpncmd_api.sh - API shell para gestionar usuarios SSTP en SoftEther
# Usado por el backend de FASTISP para provisionar/revocar tuneles
#
# FIX: vpncmd no sale con EOF de stdin. Se usa printf "cmd\nexit\n" para
#      forzar terminacion, y timeout como red de seguridad.

VPNCMD=""
for candidate in /usr/vpnserver/vpncmd /opt/vpnserver/vpncmd /usr/local/vpnserver/vpncmd; do
  if [ -x "$candidate" ]; then
    VPNCMD="$candidate"
    break
  fi
done

if [ -z "$VPNCMD" ]; then
  echo '{"error":"vpncmd not found"}' >&2
  exit 1
fi

HOST="localhost:${SOFTETHER_MGMT_PORT:-5555}"
ADMIN_PASS="${SOFTETHER_ADMIN_PASSWORD:-FastISP_VPN_2026!}"
HUB="${SOFTETHER_HUB_NAME:-FASTISP}"
HUB_PASS="${SOFTETHER_HUB_PASSWORD:-FastISP_Hub_2026!}"
TIMEOUT_SEC=15

# run_vpncmd_hub CMD [ARGS...]
# Envia comando al hub, fuerza exit, mata si excede timeout
run_vpncmd_hub() {
  local cmd="$*"
  local output
  output=$(printf '%s\nexit\n' "$cmd" | timeout "$TIMEOUT_SEC" "$VPNCMD" "$HOST" /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1) || true
  echo "$output"
  if echo "$output" | grep -qi "error occurred"; then
    return 1
  fi
  return 0
}

# run_vpncmd_server CMD [ARGS...]
# Igual pero sin hub (para comandos de nivel servidor)
run_vpncmd_server() {
  local cmd="$*"
  local output
  output=$(printf '%s\nexit\n' "$cmd" | timeout "$TIMEOUT_SEC" "$VPNCMD" "$HOST" /SERVER /PASSWORD:"$ADMIN_PASS" 2>&1) || true
  echo "$output"
  if echo "$output" | grep -qi "error occurred"; then
    return 1
  fi
  return 0
}

CMD="$1"
USERNAME="$2"
PASSWORD="$3"

case "$CMD" in

  create_user)
    [ -z "$USERNAME" ] || [ -z "$PASSWORD" ] && { echo '{"error":"username y password requeridos"}' >&2; exit 1; }
    run_vpncmd_hub "UserCreate $USERNAME /GROUP:none /REALNAME:MikroTik_SSTP /NOTE:FASTISP" > /dev/null 2>&1
    run_vpncmd_hub "UserPasswordSet $USERNAME /PASSWORD:$PASSWORD" > /dev/null 2>&1
    echo '{"status":"ok","action":"created","username":"'"$USERNAME"'"}'
    ;;

  delete_user)
    [ -z "$USERNAME" ] && { echo '{"error":"username requerido"}' >&2; exit 1; }
    SESSIONS_OUT=$(run_vpncmd_hub "SessionList")
    echo "$SESSIONS_OUT" | grep -i "$USERNAME" | awk '{print $1}' | while read -r session; do
      [ -n "$session" ] && run_vpncmd_hub "SessionDisconnect $session" > /dev/null 2>&1 || true
    done
    run_vpncmd_hub "UserDelete $USERNAME" > /dev/null 2>&1
    echo '{"status":"ok","action":"deleted","username":"'"$USERNAME"'"}'
    ;;

  update_password)
    [ -z "$USERNAME" ] || [ -z "$PASSWORD" ] && { echo '{"error":"username y password requeridos"}' >&2; exit 1; }
    run_vpncmd_hub "UserPasswordSet $USERNAME /PASSWORD:$PASSWORD" > /dev/null 2>&1
    echo '{"status":"ok","action":"password_updated","username":"'"$USERNAME"'"}'
    ;;

  user_exists)
    [ -z "$USERNAME" ] && { echo '{"error":"username requerido"}' >&2; exit 1; }
    RESULT=$(run_vpncmd_hub "UserGet $USERNAME" 2>&1)
    if echo "$RESULT" | grep -q "User Name"; then
      echo '{"exists":true,"username":"'"$USERNAME"'"}'
    else
      echo '{"exists":false,"username":"'"$USERNAME"'"}'
    fi
    ;;

  list_users)
    OUTPUT=$(run_vpncmd_hub "UserList")
    USERS=$(echo "$OUTPUT" | grep "User Name" | awk -F'|' '{gsub(/^ +| +$/,"",$2); print $2}' | while read -r u; do [ -n "$u" ] && printf '"%s",' "$u"; done | sed 's/,$//')
    echo '{"users":['"$USERS"']}'
    ;;

  list_sessions)
    run_vpncmd_hub "SessionList" || true
    exit 0
    ;;

  kick_user)
    [ -z "$USERNAME" ] && { echo '{"error":"username requerido"}' >&2; exit 1; }
    SESSIONS_OUT=$(run_vpncmd_hub "SessionList")
    echo "$SESSIONS_OUT" | grep -i "$USERNAME" | awk '{print $1}' | while read -r session; do
      [ -n "$session" ] && run_vpncmd_hub "SessionDisconnect $session" > /dev/null 2>&1 || true
    done
    echo '{"status":"ok","action":"kicked","username":"'"$USERNAME"'"}'
    ;;

  server_status)
    SESSIONS=$(run_vpncmd_hub "SessionList" | { grep -c "^SES" || true; })
    [ -z "$SESSIONS" ] && SESSIONS=0
    echo '{"status":"running","active_sessions":'"$SESSIONS"'}'
    ;;

  *)
    echo '{"error":"Comando desconocido: '"$CMD"'"}' >&2
    exit 1
    ;;
esac
