#!/bin/bash
# vpncmd_api.sh - API shell para gestionar usuarios SSTP en SoftEther
# Usado por el backend de FASTISP para provisionar/revocar túneles
#
# Uso:
#   vpncmd_api.sh create_user <username> <password>
#   vpncmd_api.sh delete_user <username>
#   vpncmd_api.sh list_users
#   vpncmd_api.sh user_exists <username>
#   vpncmd_api.sh list_sessions
#   vpncmd_api.sh kick_user <username>
#   vpncmd_api.sh server_status

VPNCMD=""
for candidate in /usr/vpnserver/vpncmd /opt/vpnserver/vpncmd /usr/local/vpnserver/vpncmd; do
  if [ -x "$candidate" ]; then
    VPNCMD="$candidate"
    break
  fi
done

if [ -z "$VPNCMD" ]; then
  echo '{"error": "vpncmd binary not found in container"}' >&2
  exit 1
fi

HOST="localhost:${SOFTETHER_MGMT_PORT:-5555}"
ADMIN_PASS="${SOFTETHER_ADMIN_PASSWORD:-FastISP_VPN_2026!}"
HUB="${SOFTETHER_HUB_NAME:-FASTISP}"
HUB_PASS="${SOFTETHER_HUB_PASSWORD:-FastISP_Hub_2026!}"

run_vpncmd() {
  local output
  output=$(echo "$@" | $VPNCMD "$HOST" /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1)
  local status=$?
  echo "$output"
  if [ $status -ne 0 ]; then
    return $status
  fi
  if echo "$output" | grep -Eqi "error occurred|error:|failed"; then
    return 1
  fi
  return 0
}

CMD="$1"
USERNAME="$2"
PASSWORD="$3"

case "$CMD" in

  create_user)
    if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
      echo '{"error": "username y password requeridos"}' >&2
      exit 1
    fi
    CREATE_OUTPUT=$(run_vpncmd UserCreate "$USERNAME" /GROUP:none /REALNAME:"MikroTik SSTP" /NOTE:"Provisioned by FASTISP") || {
      echo "$CREATE_OUTPUT" >&2
      exit 1
    }
    PASSWORD_OUTPUT=$(run_vpncmd UserPasswordSet "$USERNAME" /PASSWORD:"$PASSWORD") || {
      echo "$PASSWORD_OUTPUT" >&2
      exit 1
    }
    echo '{"status": "ok", "action": "created", "username": "'"$USERNAME"'"}'
    ;;

  delete_user)
    if [ -z "$USERNAME" ]; then
      echo '{"error": "username requerido"}' >&2
      exit 1
    fi
    # Desconectar sesiones activas del usuario
    echo "SessionList" | $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1 | \
      grep -i "$USERNAME" | awk '{print $1}' | while read session; do
        echo "SessionDelete /NAME:$session" | $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1 || true
      done
    # Eliminar usuario
    DELETE_OUTPUT=$(run_vpncmd UserDelete "$USERNAME") || {
      echo "$DELETE_OUTPUT" >&2
      exit 1
    }
    echo '{"status": "ok", "action": "deleted", "username": "'"$USERNAME"'"}'
    ;;

  update_password)
    if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
      echo '{"error": "username y password requeridos"}' >&2
      exit 1
    fi
    PASSWORD_OUTPUT=$(run_vpncmd UserPasswordSet "$USERNAME" /PASSWORD:"$PASSWORD") || {
      echo "$PASSWORD_OUTPUT" >&2
      exit 1
    }
    echo '{"status": "ok", "action": "password_updated", "username": "'"$USERNAME"'"}'
    ;;

  user_exists)
    if [ -z "$USERNAME" ]; then
      echo '{"error": "username requerido"}' >&2
      exit 1
    fi
    RESULT=$(echo "UserGet $USERNAME" | $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1)
    if echo "$RESULT" | grep -q "User Name"; then
      echo '{"exists": true, "username": "'"$USERNAME"'"}'
    else
      echo '{"exists": false, "username": "'"$USERNAME"'"}'
    fi
    ;;

  list_users)
    OUTPUT=$(echo "UserList" | $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1)
    USERS=$(echo "$OUTPUT" | grep "^User Name" | awk -F': ' '{print $2}' | tr '\n' ',' | sed 's/,$//')
    echo '{"users": ['"$(echo $USERS | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/')"']}'
    ;;

  list_sessions)
    OUTPUT=$(echo "SessionList" | $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1)
    echo "$OUTPUT"
    ;;

  kick_user)
    if [ -z "$USERNAME" ]; then
      echo '{"error": "username requerido"}' >&2
      exit 1
    fi
    echo "SessionList" | $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1 | \
      grep -i "$USERNAME" | awk '{print $1}' | while read session; do
        echo "SessionDelete /NAME:$session" | $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1
      done
    echo '{"status": "ok", "action": "kicked", "username": "'"$USERNAME"'"}'
    ;;

  server_status)
    OUTPUT=$(echo "ServerStatus" | $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" 2>&1)
    SESSIONS=$(echo "SessionList" | $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1 | grep -c "^SES" || echo 0)
    echo '{"status": "running", "active_sessions": '"$SESSIONS"'}'
    ;;

  *)
    echo '{"error": "Comando desconocido: '"$CMD"'", "available": ["create_user", "delete_user", "update_password", "user_exists", "list_users", "list_sessions", "kick_user", "server_status"]}' >&2
    exit 1
    ;;
esac
