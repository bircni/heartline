#!/bin/sh
# Reports the age of the newest file in $STATUS_ARG_PATH.
set -eu
dir="${STATUS_ARG_PATH}"
max="${STATUS_ARG_MAX_AGE_HOURS:-26}"
warn="${STATUS_ARG_WARN_AGE_HOURS:-20}"

if [ ! -d "$dir" ]; then
  echo "{\"status\":\"down\",\"message\":\"directory $dir does not exist\"}"
  exit 1
fi

newest=$(find "$dir" -type f -exec stat -c '%Y' {} + 2>/dev/null || find "$dir" -type f -exec stat -f '%m' {} +)
newest=$(printf '%s\n' "$newest" | sort -n | tail -1)
if [ -z "$newest" ]; then
  echo '{"status":"down","message":"no backups found"}'
  exit 1
fi

age_h=$(( ($(date +%s) - newest) / 3600 ))
if [ "$age_h" -ge "$max" ]; then
  echo "{\"status\":\"down\",\"message\":\"newest backup is ${age_h} h old (limit ${max} h)\"}"
  exit 1
fi
if [ "$age_h" -ge "$warn" ]; then
  echo "{\"status\":\"degraded\",\"message\":\"newest backup is ${age_h} h old\"}"
  exit 2
fi
echo "{\"status\":\"up\",\"message\":\"newest backup is ${age_h} h old\"}"
